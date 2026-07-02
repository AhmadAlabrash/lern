import { createServiceSupabaseClient } from './supabase';
import type { CallNotificationKind } from './call-notification-dedupe';

const DEFAULT_IGNORE_MINUTES = 2;

type GuardInput = {
  userId: string;
  groupId: string;
  eventName: string;
  kind: CallNotificationKind;
  payload: any;
};

type GuardResult = {
  enabled: boolean;
  shouldSend: boolean;
  reason: string;
  status?: string;
};

export async function prepareCallCompletedGuard(input: GuardInput): Promise<GuardResult> {
  try {
    const supabase = createServiceSupabaseClient();
    const insert = await supabase.from('webhook_call_notification_guard').insert({
      user_id: String(input.userId),
      group_id: input.groupId,
      event: input.eventName || 'unknown',
      kind: input.kind,
      status: 'inbound_pending',
      priority: 10,
      payload: input.payload || null,
      received_count: 1,
      first_received_at: new Date().toISOString(),
      last_received_at: new Date().toISOString(),
      ignore_until: expiresAt(),
    });

    if (!insert.error) return { enabled: true, shouldSend: true, reason: 'inbound_pending_created', status: 'inbound_pending' };

    if ((insert.error as any).code === '23505') {
      await incrementGuardCount(input.userId, input.groupId);
      const row = await getGuardRow(input.userId, input.groupId);
      if (!row) return { enabled: true, shouldSend: true, reason: 'conflict_but_row_missing' };
      if (row.sent_at || ['human_seen', 'human_sent', 'normal_sent'].includes(String(row.status || ''))) {
        return { enabled: true, shouldSend: false, reason: `blocked_existing_${row.status || 'sent'}`, status: row.status };
      }
      return { enabled: true, shouldSend: true, reason: `existing_${row.status || 'pending'}`, status: row.status };
    }

    console.error('Call guard insert failed:', insert.error);
    return { enabled: false, shouldSend: true, reason: insert.error.message };
  } catch (error) {
    console.error('Call guard unavailable:', error);
    return { enabled: false, shouldSend: true, reason: getErrorMessage(error) };
  }
}

export async function claimHumanEscalationGuard(input: GuardInput): Promise<GuardResult> {
  try {
    const supabase = createServiceSupabaseClient();
    const now = new Date().toISOString();
    const inserted = await supabase.from('webhook_call_notification_guard').insert({
      user_id: String(input.userId),
      group_id: input.groupId,
      event: input.eventName || 'human_escalation.requested',
      kind: 'human_escalation',
      status: 'human_sent',
      priority: 100,
      payload: input.payload || null,
      received_count: 1,
      first_received_at: now,
      last_received_at: now,
      sent_at: now,
      ignore_until: expiresAt(),
    });

    if (!inserted.error) return { enabled: true, shouldSend: true, reason: 'human_inserted_and_claimed', status: 'human_sent' };

    if ((inserted.error as any).code !== '23505') {
      console.error('Human guard insert failed:', inserted.error);
      return { enabled: false, shouldSend: true, reason: inserted.error.message };
    }

    const { data, error } = await supabase
      .from('webhook_call_notification_guard')
      .update({
        event: input.eventName || 'human_escalation.requested',
        kind: 'human_escalation',
        status: 'human_sent',
        priority: 100,
        payload: input.payload || null,
        last_received_at: now,
        sent_at: now,
        ignore_until: expiresAt(),
      })
      .eq('user_id', String(input.userId))
      .eq('group_id', input.groupId)
      .is('sent_at', null)
      .select('status,sent_at')
      .maybeSingle();

    await incrementGuardCount(input.userId, input.groupId);

    if (error) {
      console.error('Human guard claim failed:', error);
      return { enabled: false, shouldSend: true, reason: error.message };
    }
    if (data) return { enabled: true, shouldSend: true, reason: 'human_claimed_existing_pending', status: 'human_sent' };

    const row = await getGuardRow(input.userId, input.groupId);
    return { enabled: true, shouldSend: false, reason: `blocked_already_${row?.status || 'sent'}`, status: row?.status };
  } catch (error) {
    console.error('Human guard unavailable:', error);
    return { enabled: false, shouldSend: true, reason: getErrorMessage(error) };
  }
}

export async function isCallBlockedByHumanOrSent(userId: string, groupId: string): Promise<GuardResult> {
  try {
    const row = await getGuardRow(userId, groupId);
    if (!row) return { enabled: true, shouldSend: true, reason: 'no_guard_row' };
    if (row.sent_at || ['human_seen', 'human_sent', 'normal_sent'].includes(String(row.status || ''))) {
      return { enabled: true, shouldSend: false, reason: `blocked_${row.status || 'sent'}`, status: row.status };
    }
    return { enabled: true, shouldSend: true, reason: `not_blocked_${row.status || 'pending'}`, status: row.status };
  } catch (error) {
    console.error('Call guard check unavailable:', error);
    return { enabled: false, shouldSend: true, reason: getErrorMessage(error) };
  }
}

export async function claimCallCompletedGuard(input: GuardInput, finalKind: CallNotificationKind): Promise<GuardResult> {
  try {
    const supabase = createServiceSupabaseClient();
    const isHuman = finalKind === 'human_escalation';
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('webhook_call_notification_guard')
      .update({
        event: input.eventName || 'inbound_call.completed',
        kind: finalKind,
        status: isHuman ? 'human_sent' : 'normal_sent',
        priority: isHuman ? 90 : 10,
        payload: input.payload || null,
        last_received_at: now,
        sent_at: now,
        ignore_until: expiresAt(),
      })
      .eq('user_id', String(input.userId))
      .eq('group_id', input.groupId)
      .is('sent_at', null)
      .not('status', 'in', '(human_seen,human_sent,normal_sent)')
      .select('status,sent_at')
      .maybeSingle();

    if (error) {
      console.error('Call guard final claim failed:', error);
      return { enabled: false, shouldSend: true, reason: error.message };
    }
    if (data) return { enabled: true, shouldSend: true, reason: isHuman ? 'inbound_claimed_as_human' : 'inbound_claimed_as_normal', status: isHuman ? 'human_sent' : 'normal_sent' };

    const row = await getGuardRow(input.userId, input.groupId);
    return { enabled: true, shouldSend: false, reason: `blocked_before_final_send_${row?.status || 'sent'}`, status: row?.status };
  } catch (error) {
    console.error('Call guard final claim unavailable:', error);
    return { enabled: false, shouldSend: true, reason: getErrorMessage(error) };
  }
}

async function getGuardRow(userId: string, groupId: string): Promise<any | null> {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from('webhook_call_notification_guard')
    .select('status,kind,event,sent_at,ignore_until,received_count')
    .eq('user_id', String(userId))
    .eq('group_id', groupId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function incrementGuardCount(userId: string, groupId: string) {
  try {
    const supabase = createServiceSupabaseClient();
    const row = await getGuardRow(userId, groupId);
    await supabase
      .from('webhook_call_notification_guard')
      .update({ received_count: Number(row?.received_count || 1) + 1, last_received_at: new Date().toISOString() })
      .eq('user_id', String(userId))
      .eq('group_id', groupId);
  } catch {}
}

function expiresAt(minutes = DEFAULT_IGNORE_MINUTES) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Unknown error';
}
