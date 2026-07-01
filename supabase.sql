-- Enable pgcrypto for gen_random_uuid
create extension if not exists pgcrypto;

-- Table to hold webhook users
create table if not exists public.webhook_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  telegram_chat_id text,
  secret text not null unique,

  notify_email boolean not null default true,
  notify_telegram boolean not null default true,
  notify_sms boolean not null default false,

  booking_url text,
  whatsapp_number text,
  sms_provider text not null default 'twilio',
  plan text not null default 'free',

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Central admin-editable settings
create table if not exists public.app_settings (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

create table if not exists public.sms_usage (
  user_id text not null,
  month text not null,
  count integer not null default 0,
  updated_at timestamptz default now(),
  primary key (user_id, month)
);

create table if not exists public.delivery_logs (
  id bigserial primary key,
  level text not null default 'error',
  channel text,
  event text,
  user_id text,
  user_email text,
  message text not null,
  details jsonb,
  created_at timestamptz default now()
);

create index if not exists delivery_logs_created_at_idx on public.delivery_logs (created_at desc);

insert into public.app_settings (key, value) values
  ('routing.telegram_events', 'webhook.test
appointment.confirmed
appointment.cancelled
appointment.canceled'),
  ('routing.email_events', 'webhook.test
appointment.confirmed
appointment.cancelled
appointment.canceled'),
  ('routing.sms_events', 'appointment.needed'),
  ('template.sms', 'Danke für deinen Anruf. Deinen Termin kannst du hier buchen: {booking_url} Für weitere Hilfe erreichst du uns auf WhatsApp: {whatsapp_link}'),
  ('template.secret_email_subject', 'Ihr Webhook-Zugang für KI-Rezeption'),
  ('template.secret_email_text', 'Guten Tag,

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
KI-Rezeption'),
  ('sms.default_provider', 'twilio'),
  ('translation.provider', 'off'),
  ('translation.translate_ai_summary', 'true'),
  ('translation.translate_transcript', 'false'),
  ('translation.target_lang', 'DE'),
  ('openai.api_key', ''),
  ('openai.translation_model', 'gpt-4o-mini'),
  ('deepl.api_key', ''),
  ('deepl.api_url', ''),
  ('plan.free_sms_limit', '0'),
  ('plan.pro_sms_limit', '200'),
  ('plan.ultimate_sms_limit', '500'),
  ('monitor.alert_enabled', 'false'),
  ('monitor.alert_telegram_chat_id', ''),
  ('monitor.alert_email', ''),
  ('monitor.retention_days', '7')
on conflict (key) do nothing;

-- Safe upgrade for existing installations
alter table if exists public.webhook_users
  add column if not exists notify_email boolean not null default true;

alter table if exists public.webhook_users
  add column if not exists notify_telegram boolean not null default true;

alter table if exists public.webhook_users
  add column if not exists notify_sms boolean not null default false;

alter table if exists public.webhook_users
  add column if not exists booking_url text;

alter table if exists public.webhook_users
  add column if not exists whatsapp_number text;

alter table if exists public.webhook_users
  add column if not exists sms_provider text not null default 'twilio';

alter table if exists public.webhook_users
  add column if not exists plan text not null default 'free';

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at on public.webhook_users;
create trigger set_updated_at
before update on public.webhook_users
for each row execute procedure update_updated_at();

drop trigger if exists set_settings_updated_at on public.app_settings;
create trigger set_settings_updated_at
before update on public.app_settings
for each row execute procedure update_updated_at();


drop trigger if exists set_sms_usage_updated_at on public.sms_usage;
create trigger set_sms_usage_updated_at
before update on public.sms_usage
for each row execute procedure public.update_updated_at();

-- ---------------------------------------------------------------------------
-- 2026-07-01 fix: deliver real call webhooks and use real call payload fields.
-- This updates existing app_settings rows too, because older installs only
-- delivered webhook.test / appointment events and skipped inbound_call.completed.
-- ---------------------------------------------------------------------------

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


-- ---------------------------------------------------------------------------
-- 2026-07-01 translation settings: choose OpenAI/DeepL from Admin Dashboard
-- and choose whether to translate only AI summary or also transcript.
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value, updated_at) values
  ('translation.provider', 'off', now()),
  ('translation.translate_ai_summary', 'true', now()),
  ('translation.translate_transcript', 'false', now()),
  ('translation.target_lang', 'DE', now()),
  ('openai.api_key', '', now()),
  ('openai.translation_model', 'gpt-4o-mini', now()),
  ('deepl.api_key', '', now()),
  ('deepl.api_url', '', now())
on conflict (key) do nothing;
-- ---------------------------------------------------------------------------
-- 2026-07-01 fix: stop duplicate webhook notifications caused by retries.
--
-- Run this once in Supabase SQL Editor after deploying the updated code.
-- The public webhook endpoint will create one receipt per real event/call.
-- If the upstream sender retries the same callId/conversationId/callSid, the
-- app returns 200 OK and does not send Email/Telegram/SMS again.
-- ---------------------------------------------------------------------------

create table if not exists public.webhook_event_receipts (
  id bigserial primary key,
  dedup_key text not null unique,
  user_id text not null,
  event text,
  external_id text,
  status text not null default 'processing',
  payload jsonb,
  delivery jsonb,
  received_count integer not null default 1,
  first_received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now()
);

create index if not exists webhook_event_receipts_user_created_idx
  on public.webhook_event_receipts (user_id, first_received_at desc);

create index if not exists webhook_event_receipts_event_created_idx
  on public.webhook_event_receipts (event, first_received_at desc);

create or replace function public.increment_webhook_receipt_count(p_dedup_key text)
returns void
language plpgsql
as $$
begin
  update public.webhook_event_receipts
  set received_count = received_count + 1,
      last_received_at = now()
  where dedup_key = p_dedup_key;
end;
$$;

-- Add common appointment-requested aliases to routing so this event can be
-- delivered without manually editing the Routing tab every time.
update public.app_settings
set value = case
  when value like '%appointment.requested%' then value
  else value || E'\nappointment.requested'
end,
updated_at = now()
where key in ('routing.email_events', 'routing.telegram_events')
  and value is not null;

update public.app_settings
set value = case
  when value like '%appointment.requested%' then value
  else value || E'\nappointment.requested'
end,
updated_at = now()
where key = 'routing.sms_events'
  and value is not null;
