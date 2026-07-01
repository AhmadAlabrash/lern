-- ---------------------------------------------------------------------------
-- One call = one Email/Telegram notification fix
-- ---------------------------------------------------------------------------
-- Use this after deploying the updated code.
-- It keeps the existing notification receipt table, but increases the hold time
-- for inbound_call.completed so post-call events like human_escalation.requested
-- can arrive first and replace the plain call notification.
--
-- Result:
-- - normal call only: sends "📞 Neuer Anruf" after a short delay
-- - same call also has human_escalation.requested: sends only
--   "🚨 Menschliche Hilfe angefragt"
-- - duplicate retries for the same event/call are ignored
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

insert into public.app_settings (key, value, updated_at)
values ('dedupe.call_completed_hold_ms', '8000', now())
on conflict (key) do update set value = excluded.value, updated_at = now();

update public.app_settings
set value = case
  when value like '%human_escalation.requested%' then value
  else value || E'\nhuman_escalation.requested'
end,
updated_at = now()
where key in ('routing.email_events', 'routing.telegram_events')
  and value is not null;
