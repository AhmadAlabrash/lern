import { createServiceSupabaseClient } from './supabase';

const DEFAULT_SIGNAL_TTL_MINUTES = 5;

type SignalInput = {
  userId: string;
  groupId: string;
  eventName: string;
  payload: any;
};

type SignalResult = {
  enabled: boolean;
  stored?: boolean;
  exists?: boolean;
  reason: string;
  signal?: any;
};

/**
 * Store human_escalation.requested as a signal only.
 * It must NOT send Email/Telegram by itself. The completed-call event later
 * checks this table and chooses the human template when needed.
 */
export async function storeHumanEscalationSignal(input: SignalInput): Promise<SignalResult> {
  try {
    const supabase = createServiceSupabaseClient();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + DEFAULT_SIGNAL_TTL_MINUTES * 60 * 1000).toISOString();

    const { error } = await supabase
      .from('webhook_human_escalation_signals')
      .upsert(
        {
          user_id: String(input.userId),
          group_id: input.groupId,
          event: input.eventName || 'human_escalation.requested',
          payload: input.payload || null,
          first_seen_at: now,
          last_seen_at: now,
          expires_at: expiresAt,
        },
        { onConflict: 'user_id,group_id' }
      );

    if (error) {
      console.error('Human escalation signal store failed:', error);
      return { enabled: false, stored: false, reason: error.message };
    }

    return { enabled: true, stored: true, reason: 'stored_signal_only' };
  } catch (error) {
    console.error('Human escalation signal unavailable:', error);
    return { enabled: false, stored: false, reason: getErrorMessage(error) };
  }
}

export async function hasHumanEscalationSignal(userId: string, groupId: string): Promise<SignalResult> {
  try {
    const supabase = createServiceSupabaseClient();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('webhook_human_escalation_signals')
      .select('event,group_id,last_seen_at,expires_at')
      .eq('user_id', String(userId))
      .eq('group_id', groupId)
      .gte('expires_at', now)
      .order('last_seen_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Human escalation signal check failed:', error);
      return { enabled: false, exists: false, reason: error.message };
    }

    if (!data) return { enabled: true, exists: false, reason: 'no_signal' };
    return { enabled: true, exists: true, reason: 'signal_found', signal: data };
  } catch (error) {
    console.error('Human escalation signal unavailable:', error);
    return { enabled: false, exists: false, reason: getErrorMessage(error) };
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Unknown error';
}
