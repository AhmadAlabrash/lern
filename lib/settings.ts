import { createServiceSupabaseClient } from './supabase';

export const SETTINGS_DEFAULTS: Record<string, string> = {
  'routing.telegram_events': 'webhook.test\nappointment.confirmed\nappointment.cancelled\nappointment.canceled',
  'routing.email_events': 'webhook.test\nappointment.confirmed\nappointment.cancelled\nappointment.canceled',
  'routing.sms_events': 'appointment.needed',

  'template.telegram': `📞 Neuer Anruf

{contact_name} hat Sie angerufen.

👤 Kontakt:
Name: {contact_name}
Telefon: {contact_phone}
E-Mail: {contact_email}
Firma: {company}

📝 Zusammenfassung:
{summary}

📊 Details:
Status: {status}
Dauer: {duration_minutes} Minuten
Klassifizierung: {classification}
Stimmung: {sentiment}

🕒 Zeitpunkt:
{timestamp}

📞 Rückruf:
{contact_phone}

KI-Rezeption – Ihre digitale Rezeption`,

  'template.email': `📞 Neuer Anruf

{contact_name} hat Sie angerufen.

Kontakt:
Name: {contact_name}
Telefon: {contact_phone}
E-Mail: {contact_email}
Firma: {company}

Zusammenfassung:
{summary}

Details:
Status: {status}
Dauer: {duration_minutes} Minuten
Klassifizierung: {classification}
Stimmung: {sentiment}

Zeitpunkt:
{timestamp}

Rückruf:
{contact_phone}

KI-Rezeption – Ihre digitale Rezeption`,

  'template.sms':
    'Danke für deinen Anruf. Deinen Termin kannst du hier buchen: {booking_url} Für weitere Hilfe erreichst du uns auf WhatsApp: {whatsapp_link}',


  'template.secret_email_subject': 'Ihr Webhook-Zugang für KI-Rezeption',
  'template.secret_email_text': `Guten Tag,

Ihr persönlicher Webhook-Zugang für KI-Rezeption wurde eingerichtet.

Ihr geheimer Token:
{secret}

Bitte verwenden Sie diesen Token als Bearer Token, wenn Sie Webhook-Ereignisse an unsere API senden.

Webhook-Endpunkt:
{webhook_endpoint}

Beispiel:
Authorization: Bearer {secret}

Bitte behandeln Sie diesen Token vertraulich und geben Sie ihn nicht öffentlich weiter.

Freundliche Grüße
KI-Rezeption`,

  'smtp.host': '',
  'smtp.port': '',
  'smtp.secure': '',
  'smtp.user': '',
  'smtp.pass': '',
  'smtp.from': '',

  'telegram.bot_token': '',

  'twilio.account_sid': '',
  'twilio.auth_token': '',
  'twilio.messaging_service_sid': '',
  'sms.default_provider': 'twilio',

  'plan.free_sms_limit': '0',
  'plan.pro_sms_limit': '200',
  'plan.ultimate_sms_limit': '500',

  'monitor.alert_enabled': 'false',
  'monitor.alert_telegram_chat_id': '',
  'monitor.alert_email': '',
  'monitor.retention_days': '7',
};

export async function getSettingsMap(keys?: string[]) {
  const defaults = keys
    ? Object.fromEntries(keys.map((key) => [key, SETTINGS_DEFAULTS[key] || '']))
    : { ...SETTINGS_DEFAULTS };

  try {
    const supabase = createServiceSupabaseClient();
    let query = supabase.from('app_settings').select('key,value');

    if (keys && keys.length > 0) {
      query = query.in('key', keys);
    }

    const { data, error } = await query;

    if (error) {
      return defaults;
    }

    const values = { ...defaults };

    for (const row of data || []) {
      values[row.key] = row.value ?? '';
    }

    return values;
  } catch {
    return defaults;
  }
}

export async function upsertSettings(values: Record<string, string>) {
  const supabase = createServiceSupabaseClient();

  const rows = Object.entries(values).map(([key, value]) => ({
    key,
    value,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from('app_settings').upsert(rows, { onConflict: 'key' });

  if (error) throw error;
}
