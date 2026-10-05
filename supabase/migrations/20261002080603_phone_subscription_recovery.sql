-- Phone subscription recovery is accessed only through narrow Edge Function RPCs.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.phone_subscription_recovery_challenges (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  key_hash text not null references public.activation_keys(key_hash) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  target_device_key text not null,
  target_token_hash text not null check (target_token_hash ~ '^[0-9a-f]{64}$'),
  code_hmac text not null check (code_hmac ~ '^[0-9a-f]{64}$'),
  attempts integer not null default 0 check (attempts between 0 and 5),
  expires_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  invalidated_at timestamptz,
  completed_at timestamptz,
  constraint phone_recovery_target_device_key_length check (length(target_device_key) between 8 and 160)
);

create index phone_recovery_key_created_idx
  on private.phone_subscription_recovery_challenges (key_hash, created_at desc);

alter table private.phone_subscription_recovery_challenges enable row level security;
drop policy if exists phone_recovery_deny_direct on private.phone_subscription_recovery_challenges;
create policy phone_recovery_deny_direct on private.phone_subscription_recovery_challenges
  for all to anon, authenticated using (false) with check (false);
revoke all on table private.phone_subscription_recovery_challenges from public, anon, authenticated, service_role;

create or replace function public.begin_phone_subscription_recovery(
  p_key_hash text,
  p_target_device_key text,
  p_target_token_hash text,
  p_code_hmac text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_key public.activation_keys%rowtype;
  v_device public.devices%rowtype;
  v_topic text;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_hour_count integer;
  v_hour_oldest timestamptz;
  v_latest timestamptz;
  v_day_count integer;
  v_day_oldest timestamptz;
  v_retry_seconds integer;
  v_challenge_id uuid;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$'
    or p_target_device_key is null or length(p_target_device_key) not between 8 and 160
    or p_target_token_hash is null or p_target_token_hash !~ '^[0-9a-f]{64}$'
    or p_code_hmac is null or p_code_hmac !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'recovery_unavailable');
  end if;

  select * into v_key
  from public.activation_keys
  where key_hash = p_key_hash
  for update;
  if not found or v_key.status <> 'redeemed' or v_key.redeemed_device_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'recovery_unavailable');
  end if;

  select * into v_device
  from public.devices
  where id = v_key.redeemed_device_id
  for update;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'recovery_unavailable');
  end if;

  select s.provider_token into v_topic
  from public.push_subscriptions as s
  where s.device_id = v_device.id
    and s.provider = 'ntfy'
    and s.enabled
    and s.provider_token ~ '^soton-attendance-[a-f0-9]{40}$'
  order by s.updated_at desc, s.created_at desc
  limit 1;
  if v_topic is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'recovery_unavailable');
  end if;

  select pg_catalog.count(*)::integer, pg_catalog.min(c.created_at), pg_catalog.max(c.created_at)
  into v_hour_count, v_hour_oldest, v_latest
  from private.phone_subscription_recovery_challenges as c
  where c.key_hash = p_key_hash and c.created_at > v_now - interval '1 hour';
  if v_latest is not null and v_latest > v_now - interval '60 seconds' then
    v_retry_seconds := greatest(1, pg_catalog.ceil(pg_catalog.date_part('epoch', v_latest + interval '60 seconds' - v_now))::integer);
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'recovery_rate_limited', 'retryAfterSeconds', v_retry_seconds);
  end if;
  if v_hour_count >= 5 then
    v_retry_seconds := greatest(1, pg_catalog.ceil(pg_catalog.date_part('epoch', v_hour_oldest + interval '1 hour' - v_now))::integer);
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'recovery_rate_limited', 'retryAfterSeconds', v_retry_seconds);
  end if;

  select pg_catalog.count(*)::integer, pg_catalog.min(c.created_at)
  into v_day_count, v_day_oldest
  from private.phone_subscription_recovery_challenges as c
  where c.key_hash = p_key_hash and c.created_at > v_now - interval '24 hours';
  if v_day_count >= 10 then
    v_retry_seconds := greatest(1, pg_catalog.ceil(pg_catalog.date_part('epoch', v_day_oldest + interval '24 hours' - v_now))::integer);
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'recovery_rate_limited', 'retryAfterSeconds', v_retry_seconds);
  end if;

  update private.phone_subscription_recovery_challenges
  set invalidated_at = v_now
  where key_hash = p_key_hash and completed_at is null and invalidated_at is null;

  insert into private.phone_subscription_recovery_challenges (
    key_hash, device_id, target_device_key, target_token_hash, code_hmac, expires_at
  ) values (
    p_key_hash, v_device.id, p_target_device_key, p_target_token_hash, p_code_hmac, v_now + interval '30 minutes'
  ) returning id into v_challenge_id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'challengeId', v_challenge_id,
    'expiresAt', v_now + interval '30 minutes',
    'ntfyTopic', v_topic
  );
end;
$function$;

create or replace function public.complete_phone_subscription_recovery(
  p_challenge_id uuid,
  p_code_hmac text,
  p_target_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_challenge private.phone_subscription_recovery_challenges%rowtype;
  v_key public.activation_keys%rowtype;
  v_device public.devices%rowtype;
  v_topic text;
  v_entitlement jsonb;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_challenge_id is null or p_code_hmac is null or p_code_hmac !~ '^[0-9a-f]{64}$'
    or p_target_token_hash is null or p_target_token_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'recovery_unavailable');
  end if;

  -- Read identity fields first without locking; all writers then take locks in
  -- key -> device -> challenge order, avoiding cross-key device deadlocks.
  select * into v_challenge
  from private.phone_subscription_recovery_challenges
  where id = p_challenge_id;
  if not found or v_challenge.target_token_hash <> p_target_token_hash then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'recovery_unavailable');
  end if;

  select * into v_key from public.activation_keys where key_hash = v_challenge.key_hash for update;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'recovery_unavailable');
  end if;
  select * into v_device from public.devices where id = v_challenge.device_id for update;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'recovery_unavailable');
  end if;
  select * into v_challenge
  from private.phone_subscription_recovery_challenges
  where id = p_challenge_id
    and key_hash = v_key.key_hash
    and device_id = v_device.id
  for update;
  if not found or v_challenge.target_token_hash <> p_target_token_hash then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'recovery_unavailable');
  end if;

  -- A lost Edge Function response may retry only with the same replacement token and code.
  if v_challenge.completed_at is not null then
    if v_challenge.code_hmac <> p_code_hmac
      or v_device.device_key <> v_challenge.target_device_key
      or v_device.auth_token_hash <> v_challenge.target_token_hash then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'recovery_unavailable');
    end if;
  else
    if v_key.status <> 'redeemed' or v_key.redeemed_device_id is distinct from v_challenge.device_id then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'recovery_unavailable');
    end if;
    if v_challenge.invalidated_at is not null then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'recovery_unavailable');
    end if;
    if v_challenge.attempts >= 5 then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'recovery_attempts_exhausted');
    end if;
    if v_challenge.expires_at <= v_now then
      update private.phone_subscription_recovery_challenges
      set invalidated_at = v_now
      where id = v_challenge.id;
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'recovery_code_expired');
    end if;
    if v_challenge.code_hmac <> p_code_hmac then
      update private.phone_subscription_recovery_challenges
      set attempts = attempts + 1,
          invalidated_at = case when attempts + 1 >= 5 then v_now else invalidated_at end
      where id = v_challenge.id;
      if v_challenge.attempts + 1 >= 5 then
        return pg_catalog.jsonb_build_object('ok', false, 'error', 'recovery_attempts_exhausted');
      end if;
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'recovery_code_invalid');
    end if;
  end if;

  select s.provider_token into v_topic
  from public.push_subscriptions as s
  where s.device_id = v_device.id
    and s.provider = 'ntfy'
    and s.enabled
    and s.provider_token ~ '^soton-attendance-[a-f0-9]{40}$'
  order by s.updated_at desc, s.created_at desc
  limit 1;
  if v_topic is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'recovery_unavailable');
  end if;

  if v_challenge.completed_at is null then
    if exists (select 1 from public.devices d where d.id <> v_device.id and d.device_key = v_challenge.target_device_key)
      or exists (select 1 from public.devices d where d.id <> v_device.id and d.auth_token_hash = v_challenge.target_token_hash) then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'recovery_unavailable');
    end if;
    begin
      update public.devices
      set device_key = v_challenge.target_device_key,
          auth_token_hash = v_challenge.target_token_hash
      where id = v_device.id;
    exception when unique_violation then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'recovery_unavailable');
    end;
    update private.phone_subscription_recovery_challenges
    set completed_at = v_now
    where id = v_challenge.id;
    update private.phone_subscription_recovery_challenges
    set invalidated_at = v_now
    where device_id = v_device.id
      and id <> v_challenge.id
      and completed_at is null
      and invalidated_at is null;
  end if;

  select pg_catalog.jsonb_build_object(
    'plan', e.plan,
    'status', e.status,
    'phoneNotifications', e.phone_notifications,
    'startsAt', e.starts_at,
    'expiresAt', e.expires_at
  ) into v_entitlement
  from public.entitlements as e
  where e.device_id = v_device.id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'deviceId', v_device.id,
    'ntfyTopic', v_topic,
    'entitlement', coalesce(v_entitlement, 'null'::jsonb)
  );
end;
$function$;

revoke all on function public.begin_phone_subscription_recovery(text, text, text, text) from public, anon, authenticated;
revoke all on function public.complete_phone_subscription_recovery(uuid, text, text) from public, anon, authenticated;
grant execute on function public.begin_phone_subscription_recovery(text, text, text, text) to service_role;
grant execute on function public.complete_phone_subscription_recovery(uuid, text, text) to service_role;
