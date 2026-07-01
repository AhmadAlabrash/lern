import { createServiceSupabaseClient } from './supabase';

export const SETTINGS_DEFAULTS: Record<string, string> = {
  'routing.telegram_events': 'webhook.test\ninbound_call.completed\ninbound_call.failed\ninbound_call.missed\nappointment.needed\nappointment.requested\nhuman_escalation.requested\nappointment.confirmed\nappointment.cancelled\nappointment.canceled',
  'routing.email_events': 'webhook.test\ninbound_call.completed\ninbound_call.failed\ninbound_call.missed\nappointment.needed\nappointment.requested\nhuman_escalation.requested\nappointment.confirmed\nappointment.cancelled\nappointment.canceled',
  'routing.sms_events': 'appointment.needed\nappointment.requested',

  'template.telegram': `📞 Neuer Anruf eingegangen

Event: {event}
Richtung: {direction}
Status: {status}
Dauer: {duration}

👤 Kontakt:
Name: {contact_name}
Telefon: {contact_phone}
E-Mail: {contact_email}
Firma: {company}

📞 Nummern:
Anrufer: {from_number}
Angerufene Nummer: {to_number}

🕒 Zeitpunkt:
{timestamp}

📝 Zusammenfassung:
{summary}

💬 Transkript:
{transcript}

🔗 Aufnahme:
{recording_url}

🧾 IDs:
Call ID: {call_id}
Conversation ID: {conversation_id}
Call SID: {call_sid}
Agent ID: {agent_id}

📞 Rückruf:
{contact_phone}

KI-Rezeption – Ihre digitale Rezeption`,

  'template.email': `📞 Neuer Anruf eingegangen

Event: {event}
Richtung: {direction}
Status: {status}
Dauer: {duration}

👤 Kontakt:
Name: {contact_name}
Telefon: {contact_phone}
E-Mail: {contact_email}
Firma: {company}

📞 Nummern:
Anrufer: {from_number}
Angerufene Nummer: {to_number}

🕒 Zeitpunkt:
{timestamp}

📝 Zusammenfassung:
{summary}

💬 Transkript:
{transcript}

🔗 Aufnahme:
{recording_url}

🧾 IDs:
Call ID: {call_id}
Conversation ID: {conversation_id}
Call SID: {call_sid}
Agent ID: {agent_id}

📞 Rückruf:
{contact_phone}

KI-Rezeption – Ihre digitale Rezeption`,

  'template.telegram.human_escalation': `🚨 Menschliche Hilfe angefragt

Ein Anrufer möchte mit einem Menschen sprechen. Bitte zeitnah prüfen oder zurückrufen.

👤 Kontakt:
Name: {contact_name}
Telefon: {contact_phone}

📞 Anrufdetails:
Status: {status}
Dauer: {duration}
Anrufer: {from_number}
Angerufene Nummer: {to_number}
Zeitpunkt: {timestamp}

📝 Anliegen:
{summary}

🤖 KI Einschätzung:
{human_support_reason}

💬 Gesprächsauszug:
{transcript}

📞 Rückruf:
{contact_phone}

🧾 IDs:
Call ID: {call_id}
Conversation ID: {conversation_id}
Call SID: {call_sid}
Agent: {agent_name}

KI-Rezeption – Menschliche Unterstützung erforderlich`,

  'template.email.human_escalation': `🚨 Menschliche Hilfe angefragt

Ein Anrufer möchte mit einem Menschen sprechen. Bitte zeitnah prüfen oder zurückrufen.

👤 Kontakt:
Name: {contact_name}
Telefon: {contact_phone}

📞 Anrufdetails:
Status: {status}
Dauer: {duration}
Anrufer: {from_number}
Angerufene Nummer: {to_number}
Zeitpunkt: {timestamp}

📝 Anliegen:
{summary}

🤖 KI Einschätzung:
{human_support_reason}

💬 Gesprächsauszug:
{transcript}

📞 Rückruf:
{contact_phone}

🧾 IDs:
Call ID: {call_id}
Conversation ID: {conversation_id}
Call SID: {call_sid}
Agent: {agent_name}

KI-Rezeption – Menschliche Unterstützung erforderlich`,

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

  // Smart call notification dedupe. Normal call-completed emails wait briefly
  // so a more specific appointment/human event can take over and avoid 2 emails.
  'dedupe.call_completed_hold_ms': '3000',

  // Translation settings for webhook notification text.
  // provider: off | openai | deepl
  'translation.provider': 'off',
  'translation.translate_ai_summary': 'true',
  'translation.translate_transcript': 'false',
  'translation.target_lang': 'DE',

  // Translation credentials can be managed from the admin dashboard.
  // Environment variables still work as fallback.
  'openai.api_key': '',
  'openai.translation_model': 'gpt-4o-mini',
  'openai.analysis_model': '',
  'ai.human_support_detection_enabled': 'true',
  'ai.human_support_confidence_threshold': '0.6',
  'deepl.api_key': '',
  'deepl.api_url': '',

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
