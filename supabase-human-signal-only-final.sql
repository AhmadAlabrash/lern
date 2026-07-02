-- Final simple flow:
-- human_escalation.requested is stored as a signal only.
-- inbound_call.completed is the only event that sends Email/Telegram.
-- It waits a short time, checks this signal, then chooses either the human template or the normal call template.

create table if not exists public.webhook_human_escalation_signals (
  id bigserial primary key,
  user_id text not null,
  group_id text not null,
  event text not null default 'human_escalation.requested',
  payload jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes')
);

alter table public.webhook_human_escalation_signals
  add column if not exists user_id text,
  add column if not exists group_id text,
  add column if not exists event text default 'human_escalation.requested',
  add column if not exists payload jsonb,
  add column if not exists first_seen_at timestamptz default now(),
  add column if not exists last_seen_at timestamptz default now(),
  add column if not exists expires_at timestamptz default (now() + interval '5 minutes');

-- Clean duplicates before adding the unique index.
with ranked as (
  select id,
         row_number() over (partition by user_id, group_id order by last_seen_at desc nulls last, id desc) as rn
  from public.webhook_human_escalation_signals
  where user_id is not null and group_id is not null
)
delete from public.webhook_human_escalation_signals s
using ranked r
where s.id = r.id and r.rn > 1;

create unique index if not exists webhook_human_escalation_signals_user_group_uidx
  on public.webhook_human_escalation_signals (user_id, group_id);

create index if not exists webhook_human_escalation_signals_expires_idx
  on public.webhook_human_escalation_signals (expires_at);

-- Keep enough time for post-call human events to arrive.
insert into public.app_settings (key, value, updated_at)
values ('dedupe.human_signal_settle_ms', '12000', now())
on conflict (key) do update set value = excluded.value, updated_at = now();

-- Optional cleanup: remove expired signals. You can run this manually sometimes.
delete from public.webhook_human_escalation_signals
where expires_at < now() - interval '1 day';
