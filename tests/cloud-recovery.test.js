import assert from 'node:assert/strict';
import test from 'node:test';
import * as cloud from '../src/cloud.js';

function withRecoveryMocks(run) {
  const oldChrome = globalThis.chrome;
  const oldFetch = globalThis.fetch;
  const store = {};
  const writes = [];
  const requests = [];
  globalThis.chrome = { storage: { local: {
    async get() { return { ...store }; },
    async set(value) { writes.push(value); Object.assign(store, value); },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
    },
  } } };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return Response.json({ challengeId: 'challenge-test', expiresAt: '2026-10-06T05:00:00.000Z' });
  };
  return Promise.resolve()
    .then(() => run({ store, writes, requests }))
    .finally(() => {
      if (oldChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = oldChrome;
      globalThis.fetch = oldFetch;
    });
}

test('recovery sends the exact canonical website key without persisting the key', async () => {
  await withRecoveryMocks(async ({ store, writes, requests }) => {
    const key = 'AC-INTL-MOBM-aB12cD34';
    const result = await cloud.startPhoneSubscriptionRecovery(key);
    const body = JSON.parse(requests[0].options.body);
    assert.equal(body.action, 'recovery-start');
    assert.equal(body.activationKey, key);
    assert.equal(result.challengeId, 'challenge-test');
    assert.equal(store.attendanceCloudSetupChoice, 'recovery-pending');
    assert.equal(JSON.stringify(writes).includes(key), false);
    assert.equal(JSON.stringify(store).includes(key), false);
  });
});

test('recovery uppercases standard website hex while preserving required hyphens', async () => {
  await withRecoveryMocks(async ({ requests }) => {
    await cloud.startPhoneSubscriptionRecovery('ac-0123-4567-89ab-cdef-0123-4567-89ab-cdef-0123-4567-89ab-cdef');
    assert.equal(JSON.parse(requests[0].options.body).activationKey, 'AC-0123-4567-89AB-CDEF-0123-4567-89AB-CDEF-0123-4567-89AB-CDEF');
  });
});

test('malformed recovery input is rejected before pending state or network calls', async () => {
  await withRecoveryMocks(async ({ store, writes, requests }) => {
    await assert.rejects(cloud.startPhoneSubscriptionRecovery('AC-INTL-MOBM-short'), { message: 'invalid_activation_key' });
    assert.deepEqual(writes, []);
    assert.deepEqual(requests, []);
    assert.deepEqual(store, {});
  });
});
