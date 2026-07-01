-- One-time fix for real inbound call webhooks.
-- Run this in Supabase SQL editor after deploying the updated code.

insert into public.app_settings (key, value, updated_at) values
  ('routing.telegram_events', 'webhook.test
inbound_call.completed
inbound_call.failed
inbound_call.missed
appointment.needed
appointment.confirmed
appointment.cancelled
appointment.canceled', now()),
  ('routing.email_events', 'webhook.test
inbound_call.completed
inbound_call.failed
inbound_call.missed
appointment.needed
appointment.confirmed
appointment.cancelled
appointment.canceled', now()),
  ('routing.sms_events', 'appointment.needed', now()),
  ('template.telegram', $template$
📞 Neuer Anruf eingegangen

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

KI-Rezeption – Ihre digitale Rezeption
$template$, now()),
  ('template.email', $template$
📞 Neuer Anruf eingegangen

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

KI-Rezeption – Ihre digitale Rezeption
$template$, now())
on conflict (key) do update set
  value = excluded.value,
  updated_at = now();
