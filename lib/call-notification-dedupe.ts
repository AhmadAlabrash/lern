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
 * suppression.
 *
 * IMPORTANT: This must be EVENT-ONLY.
 * We must not infer human escalation from transcript/summary text, because
 * inbound_call.completed can contain words like "agent", "human" or similar
 * inside normal summaries/transcripts. The sender already sends a dedicated
 * event: human_escalation.requested. Only that event should use the human
 * escalation template.
 */
export function getCallNotificationKind(eventName: string, payload: any): CallNotificationKind {
  const event = String(eventName || payload?.event || '').trim();

  if (event === 'human_escalation.requested') {
    return 'human_escalation';
  }

  if (event === 'appointment.requested' || event === 'appointment.needed') {
    return 'appointment_requested';
  }

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


function extractUserTranscriptText(transcript: any): string {
  if (transcript === undefined || transcript === null) return '';

  const raw = String(transcript);
  const lines = raw.split(/\r?\n/);
  const userLines = lines
    .filter((line) => /^\s*(USER|CUSTOMER|CALLER|ANRUFER|KUNDE)\s*(\([^)]*\))?\s*:/i.test(line))
    .map((line) => line.replace(/^\s*(USER|CUSTOMER|CALLER|ANRUFER|KUNDE)\s*(\([^)]*\))?\s*:\s*/i, '').trim())
    .filter(Boolean);

  // Only use caller/customer lines for intent detection. If no caller lines are
  // present, return an empty string instead of scanning AGENT lines.
  return userLines.join('\n');
}

function isHumanEscalationText(text: string): boolean {
  const value = String(text || '').toLowerCase();
  if (!value.trim()) return false;

  return (
    /\b(human|operator|representative|staff|receptionist)\b/.test(value) ||
    /\b(real person|live person)\b/.test(value) ||
    /\b(talk|speak|connect|transfer|reach)\b.{0,60}\b(someone|somebody|person|human|operator|representative|staff)\b/.test(value) ||
    /\b(mensch|mitarbeiter|mitarbeiterin|kundenberater|supportmitarbeiter|rezeptionist)\b/.test(value) ||
    value.includes('mit einem menschen') ||
    value.includes('mitarbeiter sprechen') ||
    value.includes('jemanden sprechen') ||
    value.includes('mit einer person sprechen')
  );
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Unknown error';
}
