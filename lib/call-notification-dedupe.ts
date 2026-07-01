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
 * Returns a notification kind used for template selection and cross-event
 * suppression. This is intentionally based on both the event name and the
 * real call text, because inbound_call.completed can arrive before the more
 * specific human_escalation.requested event.
 */
export function getCallNotificationKind(eventName: string, payload: any): CallNotificationKind {
  const event = String(eventName || payload?.event || '').trim();
  const data = payload?.data || {};
  const humanEscalation = data?.humanEscalation || data?.human_escalation || {};
  const appointmentRequest = data?.appointmentRequest || data?.appointment_request || {};

  if (event === 'human_escalation.requested' || humanEscalation?.status || humanEscalation?.intent) {
    return 'human_escalation';
  }

  if (event === 'appointment.requested' || event === 'appointment.needed' || appointmentRequest?.status || appointmentRequest?.intent) {
    return 'appointment_requested';
  }

  const text = [
    humanEscalation?.intent,
    appointmentRequest?.intent,
    data?.intent,
    data?.call?.aiSummary,
    data?.call?.summary,
    data?.call?.transcript,
    data?.aiSummary,
    data?.summary,
    data?.transcript,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();

  // German + English phrases that strongly indicate the caller wants a human.
  if (
    /\b(human|person|real person|agent|operator|staff|representative)\b/.test(text) ||
    /\b(mensch|mitarbeiter|mitarbeiterin|person|kundenberater|berater|supportmitarbeiter|rezeptionist)\b/.test(text) ||
    text.includes('speak with someone') ||
    text.includes('talk to someone') ||
    text.includes('talk to a human') ||
    text.includes('speak to a human') ||
    text.includes('mit einem menschen') ||
    text.includes('mitarbeiter sprechen') ||
    text.includes('jemanden sprechen')
  ) {
    return 'human_escalation';
  }

  if (event === 'inbound_call.completed' || event === 'outbound_call.completed') {
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

  const raw = Number(settings['dedupe.call_completed_hold_ms'] || '3000');
  if (!Number.isFinite(raw)) return 0;

  // Keep this low so Vercel does not time out, but high enough to let the
  // post-call appointment/human events arrive and reserve the notification.
  return Math.max(0, Math.min(7000, Math.round(raw)));
}

export async function sleep(ms: number) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reserves the one Email/Telegram call notification for this real call.
 *
 * This does not block SMS, because SMS follow-ups are action-specific and must
 * still run for appointment.requested even when an email was already sent.
 */
export async function reserveCallNotification(input: ReserveInput): Promise<ReserveResult> {
  const groupId = extractCallGroupId(input.payload);

  // Non-call/generic payloads continue normally.
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
        reason: 'same_call_already_notified',
        existingEvent: (existing as any)?.event || '',
      };
    }

    console.error('Call notification dedupe insert failed:', error);
    return { dedupeEnabled: false, shouldSend: true, notificationKey, groupId, reason: error.message };
  } catch (error) {
    console.error('Call notification dedupe unavailable:', error);
    return { dedupeEnabled: false, shouldSend: true, notificationKey, groupId, reason: getErrorMessage(error) };
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
