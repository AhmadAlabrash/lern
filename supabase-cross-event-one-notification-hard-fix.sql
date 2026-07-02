-- ---------------------------------------------------------------------------
-- HARD FIX: one real call = one Email/Telegram notification
-- ---------------------------------------------------------------------------
-- Run once after deploying this version.
--
-- Why this is needed:
-- Earlier versions could create more than one notification row for the same
-- call if the unique constraint was missing or if the same call arrived as two
-- different events:
--   human_escalation.requested
--   inbound_call.completed
--
-- This migration cleans old duplicate rows, adds a unique index for
-- (user_id, group_id), and keeps human_escalation.requested in routing.
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

alter table public.webhook_notification_receipts
  add column if not exists notification_key text,
  add column if not exists user_id text,
  add column if not exists group_id text,
  add column if not exists event text,
  add column if not exists kind text,
  add column if not exists priority integer not null default 0,
  add column if not exists status text not null default 'reserved',
  add column if not exists payload jsonb,
  add column if not exists delivery jsonb,
  add column if not exists received_count integer not null default 1,
  add column if not exists first_received_at timestamptz not null default now(),
  add column if not exists last_received_at timestamptz not null default now();

-- Remove duplicate rows per real call. Keep the most important row first:
-- human escalation > appointment > normal call, then processed/reserved recency.
with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, group_id
      order by
        priority desc,
        case when status = 'processed' then 0 when status = 'reserved' then 1 else 2 end,
        last_received_at desc,
        id desc
    ) as rn
  from public.webhook_notification_receipts
  where user_id is not null and group_id is not null
)
delete from public.webhook_notification_receipts r
using ranked x
where r.id = x.id and x.rn > 1;

-- Remove any duplicate notification_key rows too, in case an older migration
-- created the table without the unique constraint.
with ranked as (
  select
    id,
    row_number() over (
      partition by notification_key
      order by
        priority desc,
        case when status = 'processed' then 0 when status = 'reserved' then 1 else 2 end,
        last_received_at desc,
        id desc
    ) as rn
  from public.webhook_notification_receipts
  where notification_key is not null and notification_key <> ''
)
delete from public.webhook_notification_receipts r
using ranked x
where r.id = x.id and x.rn > 1;

create unique index if not exists webhook_notification_receipts_notification_key_uidx
  on public.webhook_notification_receipts (notification_key);

create unique index if not exists webhook_notification_receipts_user_group_uidx
  on public.webhook_notification_receipts (user_id, group_id);

create index if not exists webhook_notification_receipts_user_created_idx
  on public.webhook_notification_receipts (user_id, first_received_at desc);

create index if not exists webhook_notification_receipts_group_idx
  on public.webhook_notification_receipts (user_id, group_id);

-- Keep human escalation enabled for Email/Telegram routing.
update public.app_settings
set value = case
  when value like '%human_escalation.requested%' then value
  else value || E'\nhuman_escalation.requested'
end,
updated_at = now()
where key in ('routing.email_events', 'routing.telegram_events')
  and value is not null;

-- Give inbound_call.completed enough time to be replaced if the platform sends
-- human_escalation.requested shortly after the call event.
insert into public.app_settings (key, value, updated_at)
values ('dedupe.call_completed_hold_ms', '8000', now())
on conflict (key) do update set value = excluded.value, updated_at = now();
