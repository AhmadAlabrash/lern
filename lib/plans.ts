import { createServiceSupabaseClient } from './supabase';
import { getSettingsMap } from './settings';

export type UserPlan = 'free' | 'pro' | 'ultimate';

export function normalizePlan(plan: string | null | undefined): UserPlan {
  if (plan === 'pro' || plan === 'ultimate') return plan;
  return 'free';
}

export function getCurrentSmsUsageMonth(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function getPlanSmsLimit(plan: string | null | undefined) {
  const normalized = normalizePlan(plan);
  const settings = await getSettingsMap([
    'plan.free_sms_limit',
    'plan.pro_sms_limit',
    'plan.ultimate_sms_limit',
  ]);

  const raw = settings[`plan.${normalized}_sms_limit`] || '0';
  const parsed = Number.parseInt(raw, 10);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export async function getMonthlySmsUsage(userId: string, month = getCurrentSmsUsageMonth()) {
  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from('sms_usage')
    .select('count')
    .eq('user_id', userId)
    .eq('month', month)
    .maybeSingle();

  if (error) {
    console.error('Failed to read SMS usage:', error);
    return 0;
  }

  return Number(data?.count || 0);
}

export async function incrementMonthlySmsUsage(userId: string, month = getCurrentSmsUsageMonth()) {
  const supabase = createServiceSupabaseClient();
  const current = await getMonthlySmsUsage(userId, month);

  const { error } = await supabase.from('sms_usage').upsert(
    {
      user_id: userId,
      month,
      count: current + 1,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,month' }
  );

  if (error) {
    console.error('Failed to increment SMS usage:', error);
  }

  return current + 1;
}
