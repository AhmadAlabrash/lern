import { createServiceSupabaseClient } from './supabase';
import { getSettingsMap } from './settings';
import { sendTelegramMessage } from './telegram';
import { sendOperationalAlertEmail } from './mailer';

type LogInput = {
  channel: 'telegram' | 'email' | 'sms' | 'webhook' | string;
  eventName?: string;
  user?: any;
  message: string;
  details?: any;
};

export async function logDeliveryError(input: LogInput) {
  try {
    const supabase = createServiceSupabaseClient();

    await cleanupOldLogs();

    const row = {
      level: 'error',
      channel: input.channel,
      event: input.eventName || null,
      user_id: input.user?.id ? String(input.user.id) : null,
      user_email: input.user?.email || null,
      message: input.message,
      details: input.details || null,
    };

    await supabase.from('delivery_logs').insert(row);
    await notifyAdmin(row).catch(() => undefined);
  } catch (error) {
    console.error('Failed to write delivery log:', error);
  }
}

export async function cleanupOldLogs() {
  try {
    const settings = await getSettingsMap(['monitor.retention_days']);
    const retentionDays = Number.parseInt(settings['monitor.retention_days'] || '7', 10);
    const safeDays = Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 7;
    const threshold = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();

    const supabase = createServiceSupabaseClient();
    await supabase.from('delivery_logs').delete().lt('created_at', threshold);
  } catch {
    // Cleanup should never break webhook delivery.
  }
}

export async function getRecentLogs(limit = 100) {
  await cleanupOldLogs();

  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from('delivery_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  return data || [];
}

export async function clearLogs() {
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase.from('delivery_logs').delete().not('id', 'is', null);
  if (error) throw error;
}

async function notifyAdmin(row: any) {
  const settings = await getSettingsMap([
    'monitor.alert_enabled',
    'monitor.alert_telegram_chat_id',
    'monitor.alert_email',
  ]);

  if (settings['monitor.alert_enabled'] !== 'true') return;

  const text = `⚠️ KI-Rezeption Fehler

Kanal: ${row.channel || '-'}
Event: ${row.event || '-'}
User: ${row.user_email || row.user_id || '-'}
Fehler: ${row.message || '-'}
Zeit: ${new Date().toLocaleString('de-DE')}`;

  if (settings['monitor.alert_telegram_chat_id']) {
    await sendTelegramMessage(settings['monitor.alert_telegram_chat_id'], text).catch(() => undefined);
  }

  if (settings['monitor.alert_email']) {
    await sendOperationalAlertEmail(settings['monitor.alert_email'], text).catch(() => undefined);
  }
}
