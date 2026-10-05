-- Run once in the CHINA Auth project's SQL editor (or add to its migrations).
-- All clients are denied table/RPC access. Only backend service_role may use them.
begin;

-- Checkout creates this record on the server BEFORE redirecting to a provider.
-- Limits/price/expiry come from your server-side product catalog, never the buyer.
create table public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id text not null check (length(buyer_id) between 1 and 256),
  source text not null check (source in ('stripe', 'toyyibpay')),
  provider_order_id text not null check (length(provider_order_id) between 1 and 256),
  amount_minor integer not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  max_devices integer not null default 1 check (max_devices between 1 and 100),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source, provider_order_id),
  unique (id, source)
);

create table public.license_keys (
  key uuid primary key default gen_random_uuid(),
  source text not null default 'card_network'
    check (source in ('card_network', 'stripe', 'toyyibpay')),
  max_devices integer not null default 1 check (max_devices between 1 and 100),
  bound_devices text[] not null default '{}'::text[],
  is_active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  -- One order issues one license, regardless of webhook retries/event IDs.
  payment_order_id uuid unique,
  payment_reference text,
  foreign key (payment_order_id, source) references public.payment_orders(id, source),
  unique (source, payment_reference),
  check (
    (source = 'card_network' and payment_order_id is null and payment_reference is null)
    or (source in ('stripe', 'toyyibpay') and payment_order_id is not null
        and payment_reference is not null and length(payment_reference) between 1 and 256)
  ),
  check (cardinality(bound_devices) <= max_devices),
  check (array_position(bound_devices, null) is null),
  -- Shared quotas prevent multiplying the allowance across devices/Edge instances.
  requests_per_minute integer not null default 30 check (requests_per_minute > 0),
  requests_per_day integer not null default 1000 check (requests_per_day > 0),
  minute_started_at timestamptz not null default now(),
  minute_requests integer not null default 0 check (minute_requests >= 0),
  usage_day date not null default ((now() at time zone 'UTC')::date),
  day_requests integer not null default 0 check (day_requests >= 0)
);

alter table public.payment_orders enable row level security;
alter table public.license_keys enable row level security;
-- No anon/authenticated policies: default deny, even with leaked public keys.
revoke all on public.payment_orders, public.license_keys from public, anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update on public.payment_orders, public.license_keys to service_role;

create function public.bind_license_device(p_key uuid, p_device_id uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  license public.license_keys%rowtype;
begin
  if p_key is null or p_device_id is null then return 'forbidden'; end if;
  -- Lock first; concurrent requests cannot consume the same remaining slot.
  select * into license from public.license_keys where key = p_key for update;
  if not found or not license.is_active
     or (license.expires_at is not null and license.expires_at <= clock_timestamp()) then
    return 'forbidden';
  end if;
  if p_device_id::text = any(license.bound_devices) then return 'ok'; end if;
  if cardinality(license.bound_devices) >= license.max_devices then
    return 'maximum_devices';
  end if;
  update public.license_keys
    set bound_devices = array_append(bound_devices, p_device_id::text)
    where key = p_key;
  return 'ok';
end;
$$;

create function public.consume_license_request(p_key uuid, p_device_id uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  license public.license_keys%rowtype;
  current_time_utc timestamptz;
  current_day_utc date;
begin
  if p_key is null or p_device_id is null then return 'forbidden'; end if;
  select * into license from public.license_keys where key = p_key for update;
  current_time_utc := clock_timestamp();
  current_day_utc := (current_time_utc at time zone 'UTC')::date;
  if not found or not license.is_active
     or (license.expires_at is not null and license.expires_at <= current_time_utc)
     or not (p_device_id::text = any(license.bound_devices)) then
    return 'forbidden';
  end if;
  if current_time_utc >= license.minute_started_at + interval '1 minute' then
    license.minute_started_at := current_time_utc;
    license.minute_requests := 0;
  end if;
  if license.usage_day <> current_day_utc then
    license.usage_day := current_day_utc;
    license.day_requests := 0;
  end if;
  if license.minute_requests >= license.requests_per_minute
     or license.day_requests >= license.requests_per_day then return 'rate_limited'; end if;
  update public.license_keys set
    minute_started_at = license.minute_started_at,
    minute_requests = license.minute_requests + 1,
    usage_day = license.usage_day,
    day_requests = license.day_requests + 1
    where key = p_key;
  return 'ok';
end;
$$;

-- PostgreSQL functions otherwise inherit EXECUTE from PUBLIC by default.
revoke all on function public.bind_license_device(uuid, uuid) from public, anon, authenticated;
revoke all on function public.consume_license_request(uuid, uuid) from public, anon, authenticated;
grant execute on function public.bind_license_device(uuid, uuid) to service_role;
grant execute on function public.consume_license_request(uuid, uuid) to service_role;
commit;
