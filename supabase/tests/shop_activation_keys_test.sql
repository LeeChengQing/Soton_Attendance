begin;

select plan(38);

insert into public.devices (id, device_key, auth_token_hash) values
  ('00000000-0000-4000-8000-000000000001', 'test-shop-activation-device-1', repeat('1', 64)),
  ('00000000-0000-4000-8000-000000000002', 'test-shop-activation-device-2', repeat('2', 64));

insert into public.notification_outbox (device_id, kind, title, body, available_at, created_at)
select '00000000-0000-4000-8000-000000000001', 'tomorrow_reminder', 'old reminder', 'body',
  pg_catalog.now() - interval '1 day', pg_catalog.now() - interval '1 day' + (n * interval '1 second')
from generate_series(1, 100) as n;
update public.notification_outbox
set discarded_at = pg_catalog.now(), last_error = 'subscription_required'
where device_id = '00000000-0000-4000-8000-000000000001';
insert into public.notification_outbox (device_id, kind, title, body)
values ('00000000-0000-4000-8000-000000000002', 'tomorrow_reminder', 'entitled reminder', 'body');

select is(
  (select count(*)::integer from public.notification_outbox
   where sent_at is null and discarded_at is null and available_at <= pg_catalog.now()),
  1,
  'discarded unauthorized rows do not occupy pending capacity'
);
select is(
  (select count(*)::integer from (
    select id from public.notification_outbox
    where sent_at is null and discarded_at is null and available_at <= pg_catalog.now()
    order by created_at asc limit 100
  ) selected
  where id in (select id from public.notification_outbox where device_id = '00000000-0000-4000-8000-000000000002')),
  1,
  'a later entitled notification remains selectable after 100 denials'
);
select is(
  (select count(*)::integer from public.notification_outbox
   where device_id = '00000000-0000-4000-8000-000000000001' and sent_at is null and discarded_at is not null),
  100,
  'denied notifications remain recorded as unsent and discarded'
);
select is(
  (select count(*)::integer from public.notification_outbox
   where device_id = '00000000-0000-4000-8000-000000000001' and sent_at is null and discarded_at is null),
  0,
  'discarded notifications are excluded from device notification reads'
);

insert into public.activation_keys (key_hash, plan, term_expires_at) values
  (repeat('a', 64), 'bundle', '2099-09-30T16:00:00Z'),
  (repeat('b', 64), 'phone_notifications', '2099-09-30T16:00:00Z'),
  (repeat('c', 64), 'bundle', '2000-01-01T00:00:00Z'),
  (repeat('d', 64), 'bundle', '2099-09-30T16:00:00Z');
update public.activation_keys set status = 'revoked' where key_hash = repeat('d', 64);

create temporary table first_redemption_result (result jsonb not null);
insert into first_redemption_result (result)
values (public.redeem_activation_key(repeat('a', 64), '00000000-0000-4000-8000-000000000001'));

select is(
  ((select result from first_redemption_result)->>'ok')::boolean,
  true,
  'a valid bundle key redeems successfully'
);
select is(
  (select result->>'plan' from first_redemption_result),
  'bundle',
  'redemption returns the server-side plan'
);
select ok(
  (select status = 'active' and phone_notifications from public.entitlements where device_id = '00000000-0000-4000-8000-000000000001'),
  'first redemption creates an active phone entitlement'
);
select is(
  (select source from public.entitlements where device_id = '00000000-0000-4000-8000-000000000001'),
  'shop',
  'shop redemption records its source'
);
select is(
  (select count(*)::integer from public.entitlements where device_id = '00000000-0000-4000-8000-000000000001'),
  1,
  'a device has one entitlement row'
);

select is(
  public.redeem_activation_key(repeat('f', 64), '00000000-0000-4000-8000-000000000002')->>'error',
  'invalid_activation_key',
  'an unknown hash is rejected'
);
select is(
  (select count(*)::integer from public.entitlements where device_id = '00000000-0000-4000-8000-000000000002'),
  0,
  'an unknown key creates no entitlement'
);
select is(
  public.redeem_activation_key(repeat('c', 64), '00000000-0000-4000-8000-000000000002')->>'error',
  'activation_key_expired',
  'an expired semester key is rejected'
);
select is(
  public.redeem_activation_key(repeat('d', 64), '00000000-0000-4000-8000-000000000002')->>'error',
  'activation_key_revoked',
  'a revoked key is rejected'
);
select is(
  public.redeem_activation_key(repeat('a', 64), '00000000-0000-4000-8000-000000000002')->>'error',
  'activation_key_used',
  'a redeemed key cannot be used by another device'
);
select is(
  (select count(*)::integer from public.entitlements where device_id = '00000000-0000-4000-8000-000000000002'),
  0,
  'expired, revoked, and used keys do not grant an entitlement'
);

insert into public.entitlements (
  device_id, plan, status, phone_notifications, starts_at, expires_at, source
) values (
  '00000000-0000-4000-8000-000000000002', 'bundle', 'expired', true,
  '2000-01-01T00:00:00Z', '2000-01-02T00:00:00Z', 'shop'
);
select is(
  (public.redeem_activation_key(repeat('b', 64), '00000000-0000-4000-8000-000000000002')->>'ok')::boolean,
  true,
  'a valid key reactivates a previously expired entitlement'
);
select ok(
  (select status = 'active' and starts_at > '2001-01-01T00:00:00Z'::timestamptz
   from public.entitlements where device_id = '00000000-0000-4000-8000-000000000002'),
  'reactivation starts a fresh entitlement at redemption'
);
select is(
  (select expires_at from public.entitlements where device_id = '00000000-0000-4000-8000-000000000002'),
  '2099-09-30T16:00:00Z'::timestamptz,
  'reactivation uses the new key semester expiry'
);

create temporary table entitlement_test_state (
  device_id uuid primary key,
  initial_start timestamptz not null
);
insert into entitlement_test_state (device_id, initial_start)
select device_id, starts_at
from public.entitlements
where device_id = '00000000-0000-4000-8000-000000000001';
insert into public.activation_keys (key_hash, plan, term_expires_at)
values (repeat('e', 64), 'phone_notifications', '2100-09-30T16:00:00Z');

select is(
  (public.redeem_activation_key(repeat('e', 64), '00000000-0000-4000-8000-000000000001')->>'ok')::boolean,
  true,
  'a later-term renewal redeems successfully'
);
select ok(
  (select e.starts_at = s.initial_start
   from public.entitlements e join pg_temp.entitlement_test_state s using (device_id)),
  'renewal preserves the active entitlement start'
);
select is(
  (select expires_at from public.entitlements where device_id = '00000000-0000-4000-8000-000000000001'),
  '2100-09-30T16:00:00Z'::timestamptz,
  'renewal extends the expiry to the later semester end'
);
select is(
  (select plan from public.entitlements where device_id = '00000000-0000-4000-8000-000000000001'),
  'phone_notifications',
  'renewal records the most recently redeemed plan'
);
select is(
  (select count(*)::integer from public.entitlements where device_id = '00000000-0000-4000-8000-000000000001'),
  1,
  'renewal updates the existing entitlement row'
);

insert into public.activation_keys (key_hash, plan, term_expires_at)
values (repeat('9', 64), 'sem_subscription', null);
select ok(
  (select term_expires_at is null from public.activation_keys where key_hash = repeat('9', 64)),
  'China semester keys can omit a precomputed term expiry'
);

create temporary table china_redemption_result (result jsonb not null);
insert into china_redemption_result (result)
values (public.redeem_activation_key(repeat('9', 64), '00000000-0000-4000-8000-000000000001'));
select is(
  ((select result from china_redemption_result)->>'ok')::boolean,
  true,
  'a China semester key redeems successfully'
);
select is(
  (select result->>'plan' from china_redemption_result),
  'sem_subscription',
  'China redemption returns its plan'
);
select ok(
  (select e.starts_at = k.redeemed_at
   from public.entitlements e join public.activation_keys k
     on k.redeemed_device_id = e.device_id
   where k.key_hash = repeat('9', 64)),
  'China semester starts at the key redemption timestamp'
);
select is(
  (select e.expires_at - k.redeemed_at
   from public.entitlements e join public.activation_keys k
     on k.redeemed_device_id = e.device_id
   where k.key_hash = repeat('9', 64)),
  interval '130 days',
  'China semester expires exactly 130 days after redemption'
);
select is(
  (select (result->>'expires_at')::timestamptz from china_redemption_result),
  (select expires_at from public.entitlements where device_id = '00000000-0000-4000-8000-000000000001'),
  'RPC returns the calculated expiry persisted for the extension client'
);

select ok(has_function_privilege('service_role', 'public.redeem_activation_key(text,uuid)', 'EXECUTE'), 'service role can redeem keys');
select ok(not has_function_privilege('anon', 'public.redeem_activation_key(text,uuid)', 'EXECUTE'), 'anon cannot call the redemption RPC');
select ok(not has_function_privilege('authenticated', 'public.redeem_activation_key(text,uuid)', 'EXECUTE'), 'authenticated cannot call the redemption RPC directly');
select ok((select relrowsecurity from pg_class where oid = 'public.activation_keys'::regclass), 'activation keys have RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.entitlements'::regclass), 'entitlements have RLS enabled');
select ok(not has_table_privilege('anon', 'public.activation_keys', 'SELECT'), 'anon cannot read activation keys');
select ok(not has_table_privilege('authenticated', 'public.activation_keys', 'SELECT'), 'authenticated cannot read activation keys');
select ok(has_table_privilege('service_role', 'public.activation_keys', 'SELECT'), 'service role can access activation keys');
select ok(has_table_privilege('service_role', 'public.entitlements', 'SELECT'), 'service role can access entitlements');

select * from finish();
rollback;
