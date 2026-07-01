-- ---------------------------------------------------------------------------
-- 2026-07-01 fix: human escalation call notifications without duplicates.
--
-- Run this once after deploying the updated code.
-- It adds:
-- 1) human_escalation.requested to Email/Telegram routing
-- 2) admin-editable human escalation templates
-- 3) a smart cross-event notification receipt table so the same callId sends
--    only one Email/Telegram notification even when inbound_call.completed and
--    human_escalation.requested arrive for the same call.
-- SMS is intentionally not blocked by this table.
-- ---------------------------------------------------------------------------

create table if not exists public.webhook_notification_receipts (
  id bigserial primary key,
  notification_key text not null unique,
  user_id text not null,
  group_id text not null,
  event text,
  kind text,
  priority integer not null default 0,
  status text not null default 'reserved',
  payload jsonb,
  delivery jsonb,
  received_count integer not null default 1,
  first_received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now()
);

create index if not exists webhook_notification_receipts_user_created_idx
  on public.webhook_notification_receipts (user_id, first_received_at desc);

create index if not exists webhook_notification_receipts_group_idx
  on public.webhook_notification_receipts (user_id, group_id);

-- Add the human escalation event to Email + Telegram routing.
update public.app_settings
set value = case
  when value like '%human_escalation.requested%' then value
  else value || E'\nhuman_escalation.requested'
end,
updated_at = now()
where key in ('routing.email_events', 'routing.telegram_events')
  and value is not null;

-- Ensure appointment.requested is also present because it is another post-call
-- high-intent event that can replace a plain call-completed notification.
update public.app_settings
set value = case
  when value like '%appointment.requested%' then value
  else value || E'\nappointment.requested'
end,
updated_at = now()
where key in ('routing.email_events', 'routing.telegram_events', 'routing.sms_events')
  and value is not null;

-- Smart delay for plain call-completed notifications. This gives the system a
-- few seconds to receive human_escalation.requested / appointment.requested and
-- send the more specific template instead of two messages.
insert into public.app_settings (key, value, updated_at) values
  ('dedupe.call_completed_hold_ms', '3000', now())
on conflict (key) do nothing;

insert into public.app_settings (key, value, updated_at) values
  ('template.telegram.human_escalation', '🚨 Menschliche Hilfe angefragt

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

💬 Gesprächsauszug:
{transcript}

📞 Rückruf:
{contact_phone}

🧾 IDs:
Call ID: {call_id}
Conversation ID: {conversation_id}
Call SID: {call_sid}
Agent: {agent_name}

KI-Rezeption – Menschliche Unterstützung erforderlich', now()),
  ('template.email.human_escalation', '🚨 Menschliche Hilfe angefragt

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

💬 Gesprächsauszug:
{transcript}

📞 Rückruf:
{contact_phone}

🧾 IDs:
Call ID: {call_id}
Conversation ID: {conversation_id}
Call SID: {call_sid}
Agent: {agent_name}

KI-Rezeption – Menschliche Unterstützung erforderlich', now())
on conflict (key) do nothing;
