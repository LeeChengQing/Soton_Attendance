-- Soton Attendance backend: server-side state only.
-- No school passwords, Forms cookies, or service-role keys are stored here.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  device_key text not null unique,
  device_name text,
  auth_token_hash text not null unique,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  course_code text not null,
  course_name text,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  form_url text not null,
  timezone text not null default 'Asia/Kuala_Lumpur',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, course_code, weekday, start_time, end_time)
);

create table if not exists public.attendance_logs (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  occurrence_key text not null,
  course_code text not null,
  class_date date not null,
  start_time time,
  end_time time,
  form_url text,
  status text not null check (status in ('scheduled', 'launched', 'success', 'failed', 'unknown', 'missed')),
  detail text,
  source text not null default 'extension',
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (device_id, occurrence_key)
);

create table if not exists public.notification_preferences (
  device_id uuid primary key references public.devices(id) on delete cascade,
  timezone text not null default 'Asia/Kuala_Lumpur',
  reminder_time time not null default time '19:30',
  reminders_enabled boolean not null default true,
  success_notifications_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  provider text not null check (provider in ('web_push', 'fcm', 'telegram', 'ntfy')),
  endpoint text,
  p256dh text,
  auth text,
  provider_token text,
  enabled boolean not null default true,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, provider, endpoint)
);

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  kind text not null check (kind in ('tomorrow_reminder', 'attendance_success', 'attendance_failed', 'attendance_unknown', 'attendance_missed')),
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  available_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists schedules_due_idx
  on public.schedules (enabled, weekday, start_time);
create index if not exists notification_outbox_device_idx
  on public.notification_outbox (device_id, sent_at, available_at);
create index if not exists attendance_logs_device_date_idx
  on public.attendance_logs (device_id, class_date desc, occurred_at desc);
create index if not exists notification_outbox_pending_idx
  on public.notification_outbox (sent_at, available_at);

drop trigger if exists devices_set_updated_at on public.devices;
create trigger devices_set_updated_at before update on public.devices
for each row execute function public.set_updated_at();
drop trigger if exists schedules_set_updated_at on public.schedules;
create trigger schedules_set_updated_at before update on public.schedules
for each row execute function public.set_updated_at();
drop trigger if exists notification_preferences_set_updated_at on public.notification_preferences;
create trigger notification_preferences_set_updated_at before update on public.notification_preferences
for each row execute function public.set_updated_at();
drop trigger if exists push_subscriptions_set_updated_at on public.push_subscriptions;
create trigger push_subscriptions_set_updated_at before update on public.push_subscriptions
for each row execute function public.set_updated_at();

-- The extension and mobile client talk through Edge Functions with device tokens.
-- Direct Data API access remains closed until an authenticated client is added.
alter table public.devices enable row level security;
alter table public.schedules enable row level security;
alter table public.attendance_logs enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_outbox enable row level security;

drop policy if exists devices_deny_direct on public.devices;
create policy devices_deny_direct on public.devices for all to anon, authenticated using (false) with check (false);
drop policy if exists schedules_deny_direct on public.schedules;
create policy schedules_deny_direct on public.schedules for all to anon, authenticated using (false) with check (false);
drop policy if exists attendance_logs_deny_direct on public.attendance_logs;
create policy attendance_logs_deny_direct on public.attendance_logs for all to anon, authenticated using (false) with check (false);
drop policy if exists notification_preferences_deny_direct on public.notification_preferences;
create policy notification_preferences_deny_direct on public.notification_preferences for all to anon, authenticated using (false) with check (false);
drop policy if exists push_subscriptions_deny_direct on public.push_subscriptions;
create policy push_subscriptions_deny_direct on public.push_subscriptions for all to anon, authenticated using (false) with check (false);
drop policy if exists notification_outbox_deny_direct on public.notification_outbox;
create policy notification_outbox_deny_direct on public.notification_outbox for all to anon, authenticated using (false) with check (false);

revoke all on table public.devices, public.schedules,
  public.attendance_logs, public.notification_preferences,
  public.push_subscriptions, public.notification_outbox from anon, authenticated;

insert into public.notification_preferences (device_id)
select d.id
from public.devices d
where not exists (
  select 1 from public.notification_preferences p where p.device_id = d.id
);
