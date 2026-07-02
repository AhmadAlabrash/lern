-- ---------------------------------------------------------------------------
-- FINAL duplicate-killer: one real call = one Email/Telegram notification
-- ---------------------------------------------------------------------------
-- Run once after deploying this version.
-- This creates/repairs both receipt tables used by the webhook endpoint:
-- 1) webhook_event_receipts: exact webhook retry idempotency
-- 2) webhook_notification_receipts: cross-event call notification lock
--
-- Result:
-- - human_escalation.requested + inbound_call.completed with the same callId
--   can only produce ONE Email/Telegram notification.
-- - If the human event already exists, inbound_call.completed is suppressed
--   even if an older notification-lock migration was missing.
-- - SMS remains separate and is not blocked by this rule.
-- ---------------------------------------------------------------------------

create table if not exists public.webhook_event_receipts (
  id bigserial primary key,
  dedup_key text not null,
  user_id text not null,
  event text not null,
  external_id text not null,
  status text not null default 'processing',
  payload jsonb,
  delivery jsonb,
  received_count integer not null default 1,
  first_received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now()
);

alter table public.webhook_event_receipts
  add column if not exists dedup_key text,
  add column if not exists user_id text,
  add column if not exists event text,
  add column if not exists external_id text,
  add column if not exists status text not null default 'processing',
  add column if not exists payload jsonb,
  add column if not exists delivery jsonb,
  add column if not exists received_count integer not null default 1,
  add column if not exists first_received_at timestamptz not null default now(),
  add column if not exists last_received_at timestamptz not null default now();

create table if not exists public.webhook_notification_receipts (
  id bigserial primary key,
  notification_key text not null,
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

-- Clean duplicates before creating unique indexes.
with ranked as (
  select id, row_number() over (partition by dedup_key order by last_received_at desc, id desc) rn
  from public.webhook_event_receipts
  where dedup_key is not null and dedup_key <> ''
)
delete from public.webhook_event_receipts r using ranked x where r.id = x.id and x.rn > 1;

with ranked as (
  select id, row_number() over (
    partition by user_id, group_id
    order by priority desc,
      case when status like 'processed%' then 0 when status = 'reserved' then 1 else 2 end,
      last_received_at desc,
      id desc
  ) rn
  from public.webhook_notification_receipts
  where user_id is not null and group_id is not null and group_id <> ''
)
delete from public.webhook_notification_receipts r using ranked x where r.id = x.id and x.rn > 1;

with ranked as (
  select id, row_number() over (partition by notification_key order by priority desc, last_received_at desc, id desc) rn
  from public.webhook_notification_receipts
  where notification_key is not null and notification_key <> ''
)
delete from public.webhook_notification_receipts r using ranked x where r.id = x.id and x.rn > 1;

create unique index if not exists webhook_event_receipts_dedup_key_uidx
  on public.webhook_event_receipts (dedup_key);

create index if not exists webhook_event_receipts_user_external_event_idx
  on public.webhook_event_receipts (user_id, external_id, event, last_received_at desc);

create unique index if not exists webhook_notification_receipts_notification_key_uidx
  on public.webhook_notification_receipts (notification_key);

create unique index if not exists webhook_notification_receipts_user_group_uidx
  on public.webhook_notification_receipts (user_id, group_id);

create index if not exists webhook_notification_receipts_user_created_idx
  on public.webhook_notification_receipts (user_id, first_received_at desc);

-- Keep routing for the events you use.
update public.app_settings
set value = case
  when value like '%human_escalation.requested%' then value
  else coalesce(value, '') || E'\nhuman_escalation.requested'
end,
updated_at = now()
where key in ('routing.email_events', 'routing.telegram_events');

update public.app_settings
set value = case
  when value like '%inbound_call.completed%' then value
  else coalesce(value, '') || E'\ninbound_call.completed'
end,
updated_at = now()
where key in ('routing.email_events', 'routing.telegram_events');

-- Delay only the plain completed-call notification. Human events send quickly.
-- 7000 ms gives the post-call human event time to arrive, while keeping the
-- request reasonably below common serverless timeout limits.
insert into public.app_settings (key, value, updated_at)
values ('dedupe.call_completed_hold_ms', '7000', now())
on conflict (key) do update set value = excluded.value, updated_at = now();
