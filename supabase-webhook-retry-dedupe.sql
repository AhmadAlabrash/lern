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
