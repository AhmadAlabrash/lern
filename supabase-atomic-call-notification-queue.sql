-- ---------------------------------------------------------------------------
-- Atomic one-call notification queue
-- ---------------------------------------------------------------------------
-- This replaces the old cross-event dedupe logic with one simple rule:
--
--   one user + one callId/conversationId/callSid = one Email/Telegram message
--
-- How it works:
-- - inbound_call.completed and human_escalation.requested both write to this
--   queue row for the same call.
-- - The row keeps the highest-priority event. human_escalation wins over normal
--   call completed.
-- - After a short settle window, only one request can atomically claim the row.
-- - Every other request for the same call is suppressed.
--
-- SMS is not blocked by this queue.
-- ---------------------------------------------------------------------------

create table if not exists public.webhook_call_notification_queue (
  id bigserial primary key,
  user_id text not null,
  group_id text not null,
  event text not null,
  kind text not null,
  priority integer not null default 0,
  status text not null default 'pending',
  payload jsonb,
  delivery jsonb,
  received_count integer not null default 1,
  first_received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz
);

alter table public.webhook_call_notification_queue
  add column if not exists user_id text,
  add column if not exists group_id text,
  add column if not exists event text,
  add column if not exists kind text,
  add column if not exists priority integer not null default 0,
  add column if not exists status text not null default 'pending',
  add column if not exists payload jsonb,
  add column if not exists delivery jsonb,
  add column if not exists received_count integer not null default 1,
  add column if not exists first_received_at timestamptz not null default now(),
  add column if not exists last_received_at timestamptz not null default now(),
  add column if not exists claimed_at timestamptz,
  add column if not exists sent_at timestamptz;

-- Clean old duplicate queue rows if the script was run after testing.
with ranked as (
  select id, row_number() over (
    partition by user_id, group_id
    order by
      case when sent_at is not null then 0 else 1 end,
      priority desc,
      last_received_at desc,
      id desc
  ) as rn
  from public.webhook_call_notification_queue
  where user_id is not null and group_id is not null and group_id <> ''
)
delete from public.webhook_call_notification_queue q
using ranked r
where q.id = r.id and r.rn > 1;

create unique index if not exists webhook_call_notification_queue_user_group_uidx
  on public.webhook_call_notification_queue (user_id, group_id);

create index if not exists webhook_call_notification_queue_recent_idx
  on public.webhook_call_notification_queue (user_id, last_received_at desc);

create or replace function public.upsert_call_notification_queue(
  p_user_id text,
  p_group_id text,
  p_event text,
  p_kind text,
  p_priority integer,
  p_payload jsonb
)
returns table (
  id bigint,
  user_id text,
  group_id text,
  event text,
  kind text,
  priority integer,
  status text,
  payload jsonb,
  received_count integer,
  first_received_at timestamptz,
  last_received_at timestamptz,
  claimed_at timestamptz,
  sent_at timestamptz
)
language plpgsql
security definer
as $$
begin
  return query
  insert into public.webhook_call_notification_queue as q (
    user_id,
    group_id,
    event,
    kind,
    priority,
    status,
    payload,
    received_count,
    first_received_at,
    last_received_at
  )
  values (
    p_user_id,
    p_group_id,
    coalesce(nullif(p_event, ''), 'unknown'),
    coalesce(nullif(p_kind, ''), 'generic'),
    coalesce(p_priority, 0),
    'pending',
    p_payload,
    1,
    now(),
    now()
  )
  on conflict (user_id, group_id) do update set
    event = case
      when q.sent_at is null and coalesce(excluded.priority, 0) >= coalesce(q.priority, 0) then excluded.event
      else q.event
    end,
    kind = case
      when q.sent_at is null and coalesce(excluded.priority, 0) >= coalesce(q.priority, 0) then excluded.kind
      else q.kind
    end,
    priority = case
      when q.sent_at is null then greatest(coalesce(q.priority, 0), coalesce(excluded.priority, 0))
      else q.priority
    end,
    payload = case
      when q.sent_at is null and coalesce(excluded.priority, 0) >= coalesce(q.priority, 0) then excluded.payload
      else q.payload
    end,
    status = case
      when q.sent_at is null and q.status in ('pending', 'reserved') then 'pending'
      else q.status
    end,
    received_count = coalesce(q.received_count, 0) + 1,
    last_received_at = now()
  returning
    q.id,
    q.user_id,
    q.group_id,
    q.event,
    q.kind,
    q.priority,
    q.status,
    q.payload,
    q.received_count,
    q.first_received_at,
    q.last_received_at,
    q.claimed_at,
    q.sent_at;
end;
$$;

create or replace function public.claim_call_notification_queue(
  p_user_id text,
  p_group_id text
)
returns table (
  id bigint,
  user_id text,
  group_id text,
  event text,
  kind text,
  priority integer,
  status text,
  payload jsonb,
  received_count integer,
  first_received_at timestamptz,
  last_received_at timestamptz,
  claimed_at timestamptz,
  sent_at timestamptz
)
language plpgsql
security definer
as $$
begin
  return query
  update public.webhook_call_notification_queue as q
  set
    status = 'sending',
    claimed_at = now(),
    last_received_at = now()
  where q.user_id = p_user_id
    and q.group_id = p_group_id
    and q.sent_at is null
    and (
      q.status in ('pending', 'reserved')
      or (q.status = 'sending' and q.claimed_at < now() - interval '60 seconds')
    )
  returning
    q.id,
    q.user_id,
    q.group_id,
    q.event,
    q.kind,
    q.priority,
    q.status,
    q.payload,
    q.received_count,
    q.first_received_at,
    q.last_received_at,
    q.claimed_at,
    q.sent_at;
end;
$$;

create or replace function public.finish_call_notification_queue(
  p_user_id text,
  p_group_id text,
  p_status text,
  p_delivery jsonb
)
returns void
language plpgsql
security definer
as $$
begin
  update public.webhook_call_notification_queue as q
  set
    status = coalesce(nullif(p_status, ''), 'sent'),
    delivery = p_delivery,
    sent_at = coalesce(q.sent_at, now()),
    last_received_at = now()
  where q.user_id = p_user_id
    and q.group_id = p_group_id
    and q.sent_at is null;
end;
$$;

-- Keep the normal routing enabled.
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

-- This is the settle window. It must be longer than the gap between your two
-- post-call events. Your logs showed about 7 seconds, so 10 seconds is safe.
insert into public.app_settings (key, value, updated_at)
values ('dedupe.call_notification_settle_ms', '10000', now())
on conflict (key) do update set value = excluded.value, updated_at = now();
