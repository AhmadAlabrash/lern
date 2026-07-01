import crypto from 'crypto';
import { createServiceSupabaseClient } from './supabase';

export type CallNotificationKind = 'human_escalation' | 'appointment_requested' | 'call_completed' | 'generic';

type ReserveInput = {
  userId: string;
  eventName: string;
  payload: any;
  kind: CallNotificationKind;
};

type ReserveResult = {
  dedupeEnabled: boolean;
  shouldSend: boolean;
  notificationKey?: string;
  groupId?: string;
  reason?: string;
  existingEvent?: string;
};

/**
 * Template selection is EVENT-ONLY.
 *
 * inbound_call.completed      -> plain call template
 * human_escalation.requested  -> human escalation template
 * appointment.requested       -> appointment/SMS flow
 *
 * Do not infer human escalation from transcript or summary here.
 */
export function getCallNotificationKind(eventName: string, payload: any): CallNotificationKind {
  const event = String(eventName || payload?.event || '').trim();

  if (event === 'human_escalation.requested') return 'human_escalation';
  if (event === 'appointment.requested' || event === 'appointment.needed') return 'appointment_requested';

  if (
    event === 'inbound_call.completed' ||
    event === 'outbound_call.completed' ||
    event === 'inbound_call.failed' ||
    event === 'inbound_call.missed' ||
    event === 'outbound_call.failed'
  ) {
    return 'call_completed';
  }

  return 'generic';
}

export function getCallNotificationPriority(kind: CallNotificationKind) {
  if (kind === 'human_escalation') return 100;
  if (kind === 'appointment_requested') return 80;
  if (kind === 'call_completed') return 10;
  return 1;
}

export function getInboundHoldMs(settings: Record<string, string>, eventName: string, kind: CallNotificationKind) {
  if (eventName !== 'inbound_call.completed' && eventName !== 'outbound_call.completed') return 0;
  if (kind !== 'call_completed') return 0;

  const raw = Number(settings['dedupe.call_completed_hold_ms'] || '8000');
  if (!Number.isFinite(raw)) return 0;

  // Keep the delay configurable. The default 8 seconds gives the post-call
  // human_escalation.requested event time to arrive and replace the plain call
  // notification before it is sent.
  return Math.max(0, Math.min(15000, Math.round(raw)));
}

export async function sleep(ms: number) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reserve one Email/Telegram notification for one real call.
 *
 * Important behavior:
 * - A plain inbound_call.completed creates a pending reservation first, then waits.
 * - If human_escalation.requested arrives during that wait with the same callId,
 *   it upgrades the reservation and sends the human template.
 * - When the plain call wakes up, it checks the reservation again. If it was
 *   upgraded, it suppresses the plain call email/Telegram.
 * - If a lower-priority or duplicate event arrives after a notification was
 *   already processed, it is suppressed so the user never gets two emails for
 *   the same callId.
 *
 * SMS is intentionally separate and not blocked by this call notification table.
 */
export async function reserveCallNotification(input: ReserveInput): Promise<ReserveResult> {
  const groupId = extractCallGroupId(input.payload);

  if (!groupId) {
    return { dedupeEnabled: false, shouldSend: true, reason: 'no_call_group' };
  }

  const notificationKey = sha256(`${input.userId}|call_notification|${groupId}`);
  const priority = getCallNotificationPriority(input.kind);

  try {
    const supabase = createServiceSupabaseClient();

    const { error } = await supabase.from('webhook_notification_receipts').insert({
      notification_key: notificationKey,
      user_id: String(input.userId),
      group_id: groupId,
      event: input.eventName || 'unknown',
      kind: input.kind,
      priority,
      status: 'reserved',
      payload: input.payload || null,
      received_count: 1,
      first_received_at: new Date().toISOString(),
      last_received_at: new Date().toISOString(),
    });

    if (!error) {
      return { dedupeEnabled: true, shouldSend: true, notificationKey, groupId, reason: 'reserved' };
    }

    if ((error as any).code === '23505') {
      const { data: existing } = await supabase
        .from('webhook_notification_receipts')
        .select('event,kind,priority,status,received_count')
        .eq('notification_key', notificationKey)
        .maybeSingle();

      const existingPriority = Number((existing as any)?.priority || 0);
      const existingStatus = String((existing as any)?.status || '');
      const existingEvent = String((existing as any)?.event || '');
      const isStillPending = existingStatus === 'reserved';

      // A higher-priority event can replace a pending lower-priority event.
      // Example: human_escalation.requested replaces inbound_call.completed
      // while the call-completed request is still waiting.
      if (priority > existingPriority && isStillPending) {
        await supabase
          .from('webhook_notification_receipts')
          .update({
            event: input.eventName || 'unknown',
            kind: input.kind,
            priority,
            status: 'reserved',
            payload: input.payload || null,
            received_count: ((existing as any)?.received_count || 1) + 1,
            last_received_at: new Date().toISOString(),
          })
          .eq('notification_key', notificationKey);

        return {
          dedupeEnabled: true,
          shouldSend: true,
          notificationKey,
          groupId,
          reason: 'upgraded_pending_notification',
          existingEvent,
        };
      }

      await supabase
        .from('webhook_notification_receipts')
        .update({
          received_count: ((existing as any)?.received_count || 1) + 1,
          last_received_at: new Date().toISOString(),
        })
        .eq('notification_key', notificationKey);

      return {
        dedupeEnabled: true,
        shouldSend: false,
        notificationKey,
        groupId,
        reason: existingStatus === 'reserved' ? 'lower_or_same_priority_pending' : 'same_call_already_notified',
        existingEvent,
      };
    }

    console.error('Call notification dedupe insert failed:', error);
    return { dedupeEnabled: false, shouldSend: true, notificationKey, groupId, reason: error.message };
  } catch (error) {
    console.error('Call notification dedupe unavailable:', error);
    return { dedupeEnabled: false, shouldSend: true, notificationKey, groupId, reason: getErrorMessage(error) };
  }
}

/**
 * After a delayed plain call-completed event wakes up, confirm that it still
 * owns the pending reservation. If a higher-priority event upgraded the row,
 * this returns false and the plain call notification is suppressed.
 */
export async function shouldStillSendReservedCallNotification(
  notificationKey: string | undefined,
  eventName: string,
  kind: CallNotificationKind
) {
  if (!notificationKey) return true;

  try {
    const supabase = createServiceSupabaseClient();
    const { data, error } = await supabase
      .from('webhook_notification_receipts')
      .select('event,kind,status')
      .eq('notification_key', notificationKey)
      .maybeSingle();

    if (error || !data) return true;

    return (
      String((data as any).event || '') === String(eventName || '') &&
      String((data as any).kind || '') === String(kind || '') &&
      String((data as any).status || '') === 'reserved'
    );
  } catch (error) {
    console.error('Failed to verify call notification reservation:', error);
    return true;
  }
}

export async function markCallNotificationProcessed(notificationKey: string | undefined, delivery: any, status = 'processed') {
  if (!notificationKey) return;

  try {
    const supabase = createServiceSupabaseClient();
    await supabase
      .from('webhook_notification_receipts')
      .update({
        status,
        delivery: delivery || null,
        last_received_at: new Date().toISOString(),
      })
      .eq('notification_key', notificationKey);
  } catch (error) {
    console.error('Failed to update call notification receipt:', error);
  }
}

export function extractCallGroupId(payload: any): string {
  const data = payload?.data || {};
  const call = data?.call || {};

  const candidates = [
    data?.callId,
    call?.id,
    call?.callId,
    data?.conversationId,
    call?.conversationId,
    data?.callSid,
    call?.callSid,
    call?.sid,
  ];

  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null && String(candidate).trim()) {
      return String(candidate).trim();
    }
  }

  return '';
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Unknown error';
}
