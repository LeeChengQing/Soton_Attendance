import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const key = '11111111-1111-4111-8111-111111111111';
const device = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
async function database(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(await readFile(new URL('../china/schema.sql', import.meta.url), 'utf8'));
  await db.query('insert into public.license_keys(key) values ($1)', [key]);
  return db;
}
async function rpc(db, name, id = device) {
  return (await db.query(`select public.${name}($1::uuid, $2::uuid) as result`, [key, id])).rows[0].result;
}

test('binding is idempotent and cannot displace a device when full', async (t) => {
  const db = await database(t);
  await db.exec('set role service_role');
  assert.equal(await rpc(db, 'bind_license_device'), 'ok');
  assert.equal(await rpc(db, 'bind_license_device'), 'ok');
  assert.equal(await rpc(db, 'bind_license_device', other), 'maximum_devices');
  assert.deepEqual((await db.query('select bound_devices from public.license_keys')).rows[0].bound_devices, [device]);
});

test('revocation and expiry reject both binding and consumption', async (t) => {
  const db = await database(t);
  assert.equal(await rpc(db, 'bind_license_device'), 'ok');
  await db.exec('update public.license_keys set is_active = false');
  assert.equal(await rpc(db, 'bind_license_device'), 'forbidden');
  assert.equal(await rpc(db, 'consume_license_request'), 'forbidden');
  await db.exec("update public.license_keys set is_active = true, expires_at = now() - interval '1 second'");
  assert.equal(await rpc(db, 'bind_license_device'), 'forbidden');
  assert.equal(await rpc(db, 'consume_license_request'), 'forbidden');
});

test('quota is per license, rejects unbound devices, and resets elapsed windows', async (t) => {
  const db = await database(t);
  await db.exec('update public.license_keys set requests_per_minute = 2, requests_per_day = 3');
  assert.equal(await rpc(db, 'consume_license_request'), 'forbidden');
  assert.equal(await rpc(db, 'bind_license_device'), 'ok');
  assert.equal(await rpc(db, 'consume_license_request', other), 'forbidden');
  assert.equal(await rpc(db, 'consume_license_request'), 'ok');
  assert.equal(await rpc(db, 'consume_license_request'), 'ok');
  assert.equal(await rpc(db, 'consume_license_request'), 'rate_limited');
  await db.exec("update public.license_keys set minute_started_at = now() - interval '61 seconds'");
  assert.equal(await rpc(db, 'consume_license_request'), 'ok');
  assert.equal(await rpc(db, 'consume_license_request'), 'rate_limited');
  await db.exec("update public.license_keys set minute_started_at = now() - interval '61 seconds', usage_day = (now() at time zone 'UTC')::date - 1");
  assert.equal(await rpc(db, 'consume_license_request'), 'ok');
});

test('public clients have no table or RPC access, including inherited PUBLIC grants', async (t) => {
  const db = await database(t);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select * from public.license_keys'), /permission denied/);
    await assert.rejects(rpc(db, 'bind_license_device'), /permission denied/);
    await assert.rejects(rpc(db, 'consume_license_request'), /permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  assert.equal(await rpc(db, 'bind_license_device'), 'ok');
});

test('schema rejects over-capacity arrays and nonsensical limits', async (t) => {
  const db = await database(t);
  await assert.rejects(db.query('update public.license_keys set max_devices = 0'), /check constraint/);
  await assert.rejects(db.query('update public.license_keys set bound_devices = $1', [[device, other]]), /check constraint/);
  await assert.rejects(db.query('update public.license_keys set requests_per_minute = 0'), /check constraint/);
});

test('payment orders and provider references enforce database idempotency', async (t) => {
  const db = await database(t);
  await db.query("insert into public.payment_orders(id, buyer_id, source, provider_order_id, amount_minor, currency) values ($1, 'buyer', 'stripe', 'cs_test', 1200, 'usd')", [key]);
  await db.query("insert into public.license_keys(key, source, payment_order_id, payment_reference) values ($1, 'stripe', $2, 'pi_test')", [device, key]);
  await db.query("insert into public.license_keys(key, source, payment_order_id, payment_reference) values ($1, 'stripe', $2, 'pi_test') on conflict (payment_order_id) do nothing", [other, key]);
  assert.equal((await db.query('select count(*)::int as count from public.license_keys where payment_order_id is not null')).rows[0].count, 1);
  await assert.rejects(db.query("insert into public.payment_orders(buyer_id, source, provider_order_id, amount_minor, currency) values ('other', 'stripe', 'cs_test', 1200, 'usd')"), /unique constraint/);
  // A ToyyibPay issuance cannot claim a Stripe order.
  await assert.rejects(db.query("update public.license_keys set source = 'toyyibpay' where key = $1", [device]), /foreign key constraint/);
});
