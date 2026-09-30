create table public.activation_keys (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  plan text not null check (plan in ('bundle', 'phone_notifications')),
  term_expires_at timestamptz not null,
  status text not null default 'available' check (status in ('available', 'redeemed', 'revoked')),
  redeemed_device_id uuid references public.devices(id),
  redeemed_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  note text,
  constraint activation_keys_redemption_state_check check (
    (status = 'redeemed') = (redeemed_device_id is not null and redeemed_at is not null)
  )
);

create index activation_keys_available_expiry_idx
  on public.activation_keys (term_expires_at)
  where status = 'available';

create table public.entitlements (
  device_id uuid primary key references public.devices(id) on delete cascade,
  plan text not null check (plan in ('bundle', 'phone_notifications')),
  status text not null check (status in ('pending', 'active', 'expired', 'revoked')),
  phone_notifications boolean not null default false,
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  source text not null default 'admin' check (source in ('shop', 'admin')),
  note text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint entitlements_valid_period_check check (expires_at > starts_at)
);

create index entitlements_active_expiry_idx
  on public.entitlements (expires_at)
  where status = 'active' and phone_notifications;

drop trigger if exists entitlements_set_updated_at on public.entitlements;
create trigger entitlements_set_updated_at before update on public.entitlements
for each row execute function public.set_updated_at();

alter table public.activation_keys enable row level security;
alter table public.entitlements enable row level security;

drop policy if exists activation_keys_deny_direct on public.activation_keys;
create policy activation_keys_deny_direct on public.activation_keys
  for all to anon, authenticated using (false) with check (false);
drop policy if exists entitlements_deny_direct on public.entitlements;
create policy entitlements_deny_direct on public.entitlements
  for all to anon, authenticated using (false) with check (false);

revoke all on table public.activation_keys, public.entitlements from public, anon, authenticated;
grant select, insert, update on table public.activation_keys, public.entitlements to service_role;

create or replace function public.redeem_activation_key(p_key_hash text, p_device_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  v_key public.activation_keys%rowtype;
  v_entitlement public.entitlements%rowtype;
  v_now timestamptz;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_activation_key');
  end if;

  select * into v_key
  from public.activation_keys
  where key_hash = p_key_hash
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_activation_key');
  end if;
  if v_key.status = 'redeemed' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'activation_key_used');
  end if;
  if v_key.status = 'revoked' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'activation_key_revoked');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_device_id::text, 0)
  );
  v_now := pg_catalog.clock_timestamp();
  if v_key.term_expires_at <= v_now then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'activation_key_expired');
  end if;

  update public.activation_keys
  set status = 'redeemed',
      redeemed_device_id = p_device_id,
      redeemed_at = v_now
  where key_hash = p_key_hash;

  insert into public.entitlements (
    device_id, plan, status, phone_notifications, starts_at, expires_at, source
  ) values (
    p_device_id, v_key.plan, 'active', true, v_now, v_key.term_expires_at, 'shop'
  )
  on conflict (device_id) do update
  set plan = excluded.plan,
      status = 'active',
      phone_notifications = true,
      starts_at = case
        when public.entitlements.status = 'active'
          and public.entitlements.phone_notifications
          and public.entitlements.starts_at <= v_now
          and public.entitlements.expires_at > v_now
        then public.entitlements.starts_at
        else v_now
      end,
      expires_at = case
        when public.entitlements.status = 'active'
          and public.entitlements.phone_notifications
          and public.entitlements.starts_at <= v_now
          and public.entitlements.expires_at > v_now
        then greatest(public.entitlements.expires_at, excluded.expires_at)
        else excluded.expires_at
      end,
      source = 'shop'
  returning * into v_entitlement;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'plan', v_entitlement.plan,
    'starts_at', v_entitlement.starts_at,
    'expires_at', v_entitlement.expires_at
  );
end;
$function$;

revoke all on function public.redeem_activation_key(text, uuid) from public, anon, authenticated;
grant execute on function public.redeem_activation_key(text, uuid) to service_role;
