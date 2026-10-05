import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLicenseFrontend } from '../frontend/license.js';

const key = '11111111-1111-4111-8111-111111111111';
function harness({ result = { data: { ok: true }, error: null }, failStorage = false } = {}) {
  const data = {};
  const calls = [];
  let queue = Promise.resolve();
  const storage = {
    async setAccessLevel() {},
    async get(name) { await Promise.resolve(); return { [name]: data[name] }; },
    async set(values) { if (failStorage) throw new Error('Storage unavailable'); Object.assign(data, values); },
  };
  const locks = { request(_name, callback) { const next = queue.then(callback); queue = next.catch(() => {}); return next; } };
  const client = { functions: { async invoke(name, options) { calls.push({ name, options }); return result; } } };
  const api = createLicenseFrontend({
    chinaUrl: 'https://china.example.com', chinaPublishableKey: 'sb_publishable_unit_test',
    businessUrl: 'https://global.example.com', businessPublishableKey: 'sb_publishable_unit_test',
  }, { storage, locks, createClient: () => client });
  return { api, data, calls };
}

test('concurrent device ID creation returns a single persisted UUID', async () => {
  const { api, data } = harness();
  const values = await Promise.all(Array.from({ length: 20 }, () => api.getDeviceId()));
  assert.equal(new Set(values).size, 1);
  assert.equal(values[0], data.deviceId);
  assert.match(values[0], /^[0-9a-f-]{36}$/);
});

test('activation saves credentials only after server approval', async () => {
  const { api, data, calls } = harness();
  await api.activateLicense(` ${key.toUpperCase()} `);
  assert.equal(data.licenseKey, key);
  assert.equal(calls[0].name, 'activate-license');
  assert.deepEqual(calls[0].options.body, { licenseKey: key, deviceId: data.deviceId });
});

test('failed activation retains the previously working license', async () => {
  const response = new Response(JSON.stringify({ error: 'maximum_devices' }), { status: 403 });
  const { api, data } = harness({ result: { data: null, error: { context: response } } });
  data.licenseKey = key;
  await assert.rejects(api.activateLicense('44444444-4444-4444-8444-444444444444'), /Maximum devices reached/);
  assert.equal(data.licenseKey, key);
});

test('proxy uses persisted credentials and refuses missing activation', async () => {
  const { api, data, calls } = harness();
  await assert.rejects(api.callChatGPT([{ role: 'user', content: 'Hello' }]), /Activate/);
  await api.activateLicense(key);
  await api.callChatGPT([{ role: 'user', content: 'Hello' }]);
  assert.equal(calls[1].name, 'chatgpt-proxy');
  assert.deepEqual(calls[1].options.headers, { 'x-license-key': key, 'x-device-id': data.deviceId });
});

test('storage errors and malformed server success are surfaced', async () => {
  await assert.rejects(harness({ failStorage: true }).api.activateLicense(key), /Storage unavailable/);
  const { api, data } = harness({ result: { data: {}, error: null } });
  await assert.rejects(api.activateLicense(key), /Invalid activation response/);
  assert.equal(data.licenseKey, undefined);
});

test('frontend refuses secret and legacy service-role keys', () => {
  for (const unsafe of ['sb_secret_private', `e30.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`]) {
    assert.throws(() => createLicenseFrontend({
      chinaUrl: 'https://china.example.com', businessUrl: 'https://global.example.com',
      chinaPublishableKey: unsafe, businessPublishableKey: 'sb_publishable_unit_test',
    }, { storage: { async setAccessLevel() {} }, locks: { request() {} }, createClient: () => ({}) }), /public Supabase/);
  }
});
