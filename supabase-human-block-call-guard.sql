-- ---------------------------------------------------------------------------
-- Human-block call notification guard
-- ---------------------------------------------------------------------------
-- Rule: one user + one callId/conversationId/callSid = one Email/Telegram.
--
-- inbound_call.completed:
--   waits 12 seconds, then sends Neuer Anruf only if no human event was seen.
-- human_escalation.requested:
--   sends Human template immediately and blocks later inbound_call.completed
--   for the same call for 2 minutes.
-- SMS is not controlled by this table.
-- ---------------------------------------------------------------------------

create table if not exists public.webhook_call_notification_guard (
  id bigserial primary key,
  user_id text not null,
  group_id text not null,
  event text not null,
  kind text not null,
  status text not null default 'inbound_pending',
  priority integer not null default 0,
  payload jsonb,
  received_count integer not null default 1,
  first_received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now(),
  sent_at timestamptz,
  ignore_until timestamptz
);

alter table public.webhook_call_notification_guard
  add column if not exists user_id text,
  add column if not exists group_id text,
  add column if not exists event text,
  add column if not exists kind text,
  add column if not exists status text not null default 'inbound_pending',
  add column if not exists priority integer not null default 0,
  add column if not exists payload jsonb,
  add column if not exists received_count integer not null default 1,
  add column if not exists first_received_at timestamptz not null default now(),
  add column if not exists last_received_at timestamptz not null default now(),
  add column if not exists sent_at timestamptz,
  add column if not exists ignore_until timestamptz;

with ranked as (
  select id, row_number() over (
    partition by user_id, group_id
    order by case when sent_at is not null then 0 else 1 end, priority desc, last_received_at desc, id desc
  ) as rn
  from public.webhook_call_notification_guard
  where user_id is not null and group_id is not null and group_id <> ''
)
delete from public.webhook_call_notification_guard g
using ranked r
where g.id = r.id and r.rn > 1;

create unique index if not exists webhook_call_notification_guard_user_group_uidx
  on public.webhook_call_notification_guard (user_id, group_id);

create index if not exists webhook_call_notification_guard_recent_idx
  on public.webhook_call_notification_guard (user_id, last_received_at desc);

delete from public.webhook_call_notification_guard
where last_received_at < now() - interval '7 days';

insert into public.app_settings (key, value, updated_at)
values ('dedupe.call_notification_settle_ms', '12000', now())
on conflict (key) do update set value = excluded.value, updated_at = now();

update public.app_settings
set value = case when value like '%human_escalation.requested%' then value else coalesce(value, '') || E'\nhuman_escalation.requested' end,
updated_at = now()
where key in ('routing.email_events', 'routing.telegram_events');

update public.app_settings
set value = case when value like '%inbound_call.completed%' then value else coalesce(value, '') || E'\ninbound_call.completed' end,
updated_at = now()
where key in ('routing.email_events', 'routing.telegram_events');
