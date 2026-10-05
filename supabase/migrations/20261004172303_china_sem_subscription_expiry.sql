alter table public.activation_keys
  drop constraint activation_keys_plan_check,
  add constraint activation_keys_plan_check
    check (plan in ('bundle', 'phone_notifications', 'sem_subscription')),
  alter column term_expires_at drop not null,
  add constraint activation_keys_term_expiry_plan_check
    check (plan = 'sem_subscription' or term_expires_at is not null);

alter table public.entitlements
  drop constraint entitlements_plan_check,
  add constraint entitlements_plan_check
    check (plan in ('bundle', 'phone_notifications', 'sem_subscription'));

create or replace function public.redeem_activation_key(p_key_hash text, p_device_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  v_key public.activation_keys%rowtype;
  v_entitlement public.entitlements%rowtype;
  v_now timestamptz;
  v_expires_at timestamptz;
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
  if v_key.plan <> 'sem_subscription'
    and (v_key.term_expires_at is null or v_key.term_expires_at <= v_now) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'activation_key_expired');
  end if;

  v_expires_at := case
    when v_key.plan = 'sem_subscription' then v_now + interval '130 days'
    else v_key.term_expires_at
  end;

  update public.activation_keys
  set status = 'redeemed',
      redeemed_device_id = p_device_id,
      redeemed_at = v_now
  where key_hash = p_key_hash;

  insert into public.entitlements (
    device_id, plan, status, phone_notifications, starts_at, expires_at, source
  ) values (
    p_device_id, v_key.plan, 'active', true, v_now, v_expires_at, 'shop'
  )
  on conflict (device_id) do update
  set plan = excluded.plan,
      status = 'active',
      phone_notifications = true,
      starts_at = case
        when excluded.plan = 'sem_subscription' then v_now
        when public.entitlements.status = 'active'
          and public.entitlements.phone_notifications
          and public.entitlements.starts_at <= v_now
          and public.entitlements.expires_at > v_now
        then public.entitlements.starts_at
        else v_now
      end,
      expires_at = case
        when excluded.plan = 'sem_subscription' then excluded.expires_at
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
