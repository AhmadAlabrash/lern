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
