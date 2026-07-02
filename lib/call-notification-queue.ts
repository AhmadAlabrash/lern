import { createServiceSupabaseClient } from './supabase';
import { CallNotificationKind } from './call-notification-dedupe';

type QueueInput = {
  userId: string;
  groupId: string;
  eventName: string;
  kind: CallNotificationKind;
  priority: number;
  payload: any;
};

export type QueuedCallNotification = {
  ok: boolean;
  queueEnabled: boolean;
  groupId: string;
  eventName: string;
  kind: CallNotificationKind;
  priority: number;
  payload: any;
  reason?: string;
};

export async function upsertCallNotificationQueue(input: QueueInput): Promise<QueuedCallNotification> {
  try {
    const supabase = createServiceSupabaseClient();
    const { data, error } = await supabase.rpc('upsert_call_notification_queue', {
      p_user_id: String(input.userId),
      p_group_id: input.groupId,
      p_event: input.eventName || 'unknown',
      p_kind: input.kind,
      p_priority: input.priority,
      p_payload: input.payload || null,
    });

    if (error) {
      console.error('Call notification queue upsert failed:', error);
      return {
        ok: false,
        queueEnabled: false,
        groupId: input.groupId,
        eventName: input.eventName,
        kind: input.kind,
        priority: input.priority,
        payload: input.payload,
        reason: error.message,
      };
    }

    const row = Array.isArray(data) ? data[0] : data;
    return normalizeQueueRow(row, input, 'upserted');
  } catch (error) {
    console.error('Call notification queue unavailable:', error);
    return {
      ok: false,
      queueEnabled: false,
      groupId: input.groupId,
      eventName: input.eventName,
      kind: input.kind,
      priority: input.priority,
      payload: input.payload,
      reason: getErrorMessage(error),
    };
  }
}

export async function claimCallNotificationQueue(userId: string, groupId: string): Promise<QueuedCallNotification | null> {
  try {
    const supabase = createServiceSupabaseClient();
    const { data, error } = await supabase.rpc('claim_call_notification_queue', {
      p_user_id: String(userId),
      p_group_id: groupId,
    });

    if (error) {
      console.error('Call notification queue claim failed:', error);
      return null;
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;

    return {
      ok: true,
      queueEnabled: true,
      groupId: String(row.group_id || groupId),
      eventName: String(row.event || ''),
      kind: normalizeKind(row.kind),
      priority: Number(row.priority || 0),
      payload: row.payload || {},
      reason: 'claimed',
    };
  } catch (error) {
    console.error('Call notification queue claim unavailable:', error);
    return null;
  }
}

export async function markCallNotificationQueueSent(userId: string, groupId: string, delivery: any, status = 'sent') {
  try {
    const supabase = createServiceSupabaseClient();
    await supabase.rpc('finish_call_notification_queue', {
      p_user_id: String(userId),
      p_group_id: groupId,
      p_status: status,
      p_delivery: delivery || null,
    });
  } catch (error) {
    console.error('Failed to finish call notification queue:', error);
  }
}

function normalizeQueueRow(row: any, input: QueueInput, reason: string): QueuedCallNotification {
  if (!row) {
    return {
      ok: true,
      queueEnabled: true,
      groupId: input.groupId,
      eventName: input.eventName,
      kind: input.kind,
      priority: input.priority,
      payload: input.payload,
      reason,
    };
  }

  return {
    ok: true,
    queueEnabled: true,
    groupId: String(row.group_id || input.groupId),
    eventName: String(row.event || input.eventName),
    kind: normalizeKind(row.kind || input.kind),
    priority: Number(row.priority || input.priority),
    payload: row.payload || input.payload,
    reason,
  };
}

function normalizeKind(value: any): CallNotificationKind {
  const kind = String(value || '').trim();
  if (kind === 'human_escalation') return 'human_escalation';
  if (kind === 'appointment_requested') return 'appointment_requested';
  if (kind === 'call_completed') return 'call_completed';
  return 'generic';
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Unknown error';
}
