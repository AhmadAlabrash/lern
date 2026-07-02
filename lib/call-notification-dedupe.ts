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

type ExistingNotificationRow = {
  id?: number;
  notification_key?: string;
  event?: string;
  kind?: string;
  priority?: number;
  status?: string;
  received_count?: number;
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

  // Keep the delay configurable. The default gives post-call events like
  // human_escalation.requested time to arrive and replace the plain call
  // notification before it is sent. Keep it below common webhook timeouts.
  return Math.max(0, Math.min(15000, Math.round(raw)));
}

export async function sleep(ms: number) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reserve one Email/Telegram notification for one real call.
 *
 * This version does NOT depend only on a unique-key insert conflict. It first
 * searches by (user_id, group_id). That fixes old databases where the unique
 * constraint was missing or where a previous deployment inserted duplicate
 * rows. The rule is strict:
 *
 *   one user + one callId/conversationId/callSid = one Email/Telegram notice
 *
 * Higher-priority events can upgrade a pending lower-priority reservation. If
 * a notification for the call was already processed, every later event for the
 * same call is suppressed to avoid two messages.
 *
 * SMS is intentionally separate and is not blocked by this call table.
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

    const existing = await findExistingNotification(supabase, input.userId, groupId);
    if (existing) {
      return await handleExistingNotification({
        supabase,
        existing,
        input,
        groupId,
        notificationKey,
        priority,
      });
    }

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
      const conflictExisting = await findExistingNotification(supabase, input.userId, groupId, notificationKey);
      if (conflictExisting) {
        return await handleExistingNotification({
          supabase,
          existing: conflictExisting,
          input,
          groupId,
          notificationKey,
          priority,
        });
      }
    }

    console.error('Call notification dedupe insert failed:', error);
    return { dedupeEnabled: false, shouldSend: true, notificationKey, groupId, reason: error.message };
  } catch (error) {
    console.error('Call notification dedupe unavailable:', error);
    return { dedupeEnabled: false, shouldSend: true, notificationKey, groupId, reason: getErrorMessage(error) };
  }
}

async function findExistingNotification(
  supabase: any,
  userId: string,
  groupId: string,
  notificationKey?: string
): Promise<ExistingNotificationRow | null> {
  // Prefer the real call grouping. This catches old rows even if their
  // notification_key differs because of earlier code versions.
  const { data, error } = await supabase
    .from('webhook_notification_receipts')
    .select('id,notification_key,event,kind,priority,status,received_count')
    .eq('user_id', String(userId))
    .eq('group_id', groupId)
    .order('priority', { ascending: false })
    .order('last_received_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!error && data) return data as ExistingNotificationRow;

  if (!notificationKey) return null;

  const byKey = await supabase
    .from('webhook_notification_receipts')
    .select('id,notification_key,event,kind,priority,status,received_count')
    .eq('notification_key', notificationKey)
    .maybeSingle();

  if (!byKey.error && byKey.data) return byKey.data as ExistingNotificationRow;
  return null;
}

async function handleExistingNotification({
  supabase,
  existing,
  input,
  groupId,
  notificationKey,
  priority,
}: {
  supabase: any;
  existing: ExistingNotificationRow;
  input: ReserveInput;
  groupId: string;
  notificationKey: string;
  priority: number;
}): Promise<ReserveResult> {
  const existingPriority = Number(existing.priority || 0);
  const existingStatus = String(existing.status || '');
  const existingEvent = String(existing.event || '');
  const existingKey = String(existing.notification_key || notificationKey);
  const isStillPending = existingStatus === 'reserved';
  const selector = existing.id ? { column: 'id', value: existing.id } : { column: 'notification_key', value: existingKey };

  // A higher-priority event can replace a pending lower-priority event.
  // Example: human_escalation.requested replaces inbound_call.completed while
  // the call-completed request is still sleeping.
  if (priority > existingPriority && isStillPending) {
    await supabase
      .from('webhook_notification_receipts')
      .update({
        notification_key: existingKey,
        event: input.eventName || 'unknown',
        kind: input.kind,
        priority,
        status: 'reserved',
        payload: input.payload || null,
        received_count: Number(existing.received_count || 1) + 1,
        last_received_at: new Date().toISOString(),
      })
      .eq(selector.column, selector.value);

    return {
      dedupeEnabled: true,
      shouldSend: true,
      notificationKey: existingKey,
      groupId,
      reason: 'upgraded_pending_notification',
      existingEvent,
    };
  }

  await supabase
    .from('webhook_notification_receipts')
    .update({
      received_count: Number(existing.received_count || 1) + 1,
      last_received_at: new Date().toISOString(),
    })
    .eq(selector.column, selector.value);

  return {
    dedupeEnabled: true,
    shouldSend: false,
    notificationKey: existingKey,
    groupId,
    reason: existingStatus === 'reserved' ? 'lower_or_same_priority_pending' : 'same_call_already_notified',
    existingEvent,
  };
}


export async function hasHigherPriorityCallEventReceipt(
  userId: string,
  payload: any,
  kind: CallNotificationKind
): Promise<{ found: boolean; event?: string; reason?: string }> {
  // Backup guard for the real problem seen in production:
  // human_escalation.requested can arrive as a separate webhook for the same
  // callId. Even if the notification receipt table is missing/old, the general
  // webhook_event_receipts table usually already contains that accepted event.
  // A plain inbound_call.completed notification must not be sent when a higher
  // priority event for the same call was already accepted.
  if (kind !== 'call_completed') return { found: false };

  const groupId = extractCallGroupId(payload);
  if (!groupId) return { found: false, reason: 'no_call_group' };

  try {
    const supabase = createServiceSupabaseClient();
    const { data, error } = await supabase
      .from('webhook_event_receipts')
      .select('event,status,last_received_at')
      .eq('user_id', String(userId))
      .eq('external_id', groupId)
      .in('event', ['human_escalation.requested', 'appointment.requested', 'appointment.needed'])
      .order('last_received_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return { found: false, reason: error ? error.message : 'not_found' };

    return { found: true, event: String((data as any).event || ''), reason: 'higher_priority_event_receipt_exists' };
  } catch (error) {
    console.error('Failed to check higher-priority call event receipts:', error);
    return { found: false, reason: getErrorMessage(error) };
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
