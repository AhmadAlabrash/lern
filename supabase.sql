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
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Safe upgrade for existing installations
alter table if exists public.webhook_users
  add column if not exists notify_email boolean not null default true;

alter table if exists public.webhook_users
  add column if not exists notify_telegram boolean not null default true;

-- Trigger to keep updated_at current on updates
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
