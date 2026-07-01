import crypto from 'crypto';
import { createServiceSupabaseClient } from './supabase';

type ReceiptInput = {
  userId: string;
  eventName: string;
  payload: any;
};

type ReceiptResult = {
  dedupeEnabled: boolean;
  firstDelivery: boolean;
  dedupKey: string;
  externalId: string;
  reason?: string;
};

/**
 * Creates an idempotency receipt before any notification is sent.
 *
 * Why this exists:
 * - The upstream webhook sender retries when our endpoint returns 500 or is slow.
 * - Email/Telegram/SMS may have already been sent before that retry happens.
 * - This table lets us accept retries with 200 OK without sending duplicate notifications.
 *
 * If the SQL migration was not installed yet, this function fails open so the
 * public webhook endpoint does not break. Run `supabase-webhook-retry-dedupe.sql`
 * to enable real duplicate protection.
 */
export async function createWebhookReceipt(input: ReceiptInput): Promise<ReceiptResult> {
  const externalId = extractExternalEventId(input.payload) || sha256(stableStringify(input.payload)).slice(0, 40);
  const dedupKey = sha256(`${input.userId}|${input.eventName || 'unknown'}|${externalId}`);

  try {
    const supabase = createServiceSupabaseClient();

    const { error } = await supabase.from('webhook_event_receipts').insert({
      dedup_key: dedupKey,
      user_id: String(input.userId),
      event: input.eventName || 'unknown',
      external_id: externalId,
      status: 'processing',
      payload: input.payload || null,
      received_count: 1,
      first_received_at: new Date().toISOString(),
      last_received_at: new Date().toISOString(),
    });

    if (!error) {
      return { dedupeEnabled: true, firstDelivery: true, dedupKey, externalId };
    }

    // PostgreSQL unique violation: this exact event was already accepted.
    if ((error as any).code === '23505') {
      await supabase
        .from('webhook_event_receipts')
        .update({
          last_received_at: new Date().toISOString(),
          status: 'duplicate_retry_ignored',
        })
        .eq('dedup_key', dedupKey);

      // Use an RPC if it exists. If not, the duplicate is still safely ignored.
      try {
        await supabase.rpc('increment_webhook_receipt_count', { p_dedup_key: dedupKey });
      } catch {
        // ignore
      }

      return { dedupeEnabled: true, firstDelivery: false, dedupKey, externalId, reason: 'duplicate_retry_ignored' };
    }

    // If the migration is missing, do not break delivery.
    console.error('Webhook dedupe insert failed:', error);
    return { dedupeEnabled: false, firstDelivery: true, dedupKey, externalId, reason: error.message };
  } catch (error) {
    console.error('Webhook dedupe unavailable:', error);
    return { dedupeEnabled: false, firstDelivery: true, dedupKey, externalId, reason: getErrorMessage(error) };
  }
}

export async function markWebhookReceiptProcessed(dedupKey: string, delivery: any, status = 'processed') {
  if (!dedupKey) return;

  try {
    const supabase = createServiceSupabaseClient();
    await supabase
      .from('webhook_event_receipts')
      .update({
        status,
        delivery: delivery || null,
        last_received_at: new Date().toISOString(),
      })
      .eq('dedup_key', dedupKey);
  } catch (error) {
    // Receipt updates must never break the public webhook endpoint.
    console.error('Failed to update webhook receipt:', error);
  }
}

function extractExternalEventId(payload: any): string {
  const data = payload?.data || {};
  const call = data?.call || {};
  const appointment = data?.appointment || data?.booking || {};

  const candidates = [
    payload?.id,
    payload?.eventId,
    payload?.webhookId,
    data?.id,
    data?.eventId,
    data?.messageId,
    data?.callId,
    call?.id,
    call?.callId,
    data?.conversationId,
    call?.conversationId,
    data?.callSid,
    call?.sid,
    data?.appointmentId,
    data?.bookingId,
    appointment?.id,
    appointment?.appointmentId,
    appointment?.bookingId,
    data?.ticketId,
    data?.threadId,
  ];

  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null && String(candidate).trim()) {
      return String(candidate).trim();
    }
  }

  return '';
}

function stableStringify(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Unknown error';
}
