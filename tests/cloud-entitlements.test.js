import assert from "node:assert/strict";
import test from "node:test";
import * as cloud from "../src/cloud.js";
import * as bundledCloud from "../src/v1.0.5/background-cloud.js";

for (const [name, api] of [['source', cloud], ['bundled', bundledCloud]]) {
  test(`${name}: license status never registers or cancels pending recovery`, async () => {
    const oldChrome = globalThis.chrome, oldFetch = globalThis.fetch;
    const store = {attendanceCloudSetupChoice: 'recovery-pending', attendanceCloudRecoveryPending: {challengeId: 'pending'}};
    const before = structuredClone(store);
    globalThis.chrome = {storage: {local: {
      get: async () => ({...store}), set: async value => Object.assign(store, value), remove: async key => {delete store[key];},
    }}};
    globalThis.fetch = async () => {throw Error('status must not register a device');};
    try {
      assert.deepEqual(await api.getPluginLicenseStatus(), {licensed: false});
      assert.deepEqual(store, before);
    } finally {globalThis.chrome = oldChrome; globalThis.fetch = oldFetch;}
  });

  test(`${name}: plugin activation persists identity and uncertain refresh preserves activation evidence`, async () => {
    const oldChrome = globalThis.chrome, oldFetch = globalThis.fetch;
    const store = {attendanceCloudToken: 'token', attendanceCloudDeviceId: 'device', attendanceNtfyTopic: 'topic'};
    const calls = []; let licensed = true;
    globalThis.chrome = {storage: {local: {
      get: async () => ({...store}), set: async value => Object.assign(store, value), remove: async key => {delete store[key];},
    }}};
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body); calls.push(body);
      assert.equal(options.headers.Authorization, 'Bearer token');
      return Response.json(body.action === 'activate-plugin-license' ? {ok: true, plan: 'semester_license', expires_at: '2099-01-01T00:00:00Z'} : {licensed, plan: 'semester_license', expires_at: '2099-01-01T00:00:00Z'});
    };
    try {
      const key = 'AC-LIC-ABCD-EFGH-JKLM-NPQR';
      await api.activatePluginLicense(key);
      assert.equal(store.attendancePluginLicense.plan, 'semester_license');
      const restarted = await import(`../src/${name === 'source' ? 'cloud.js' : 'v1.0.5/background-cloud.js'}?restart=${Date.now()}`);
      assert.equal((await restarted.getPluginLicenseStatus()).licensed, true);
      assert.equal(store.attendanceCloudToken, 'token');
      licensed = false;
      assert.equal((await restarted.getPluginLicenseStatus()).licensed, false);
      assert.equal(store.attendancePluginLicense.plan, 'semester_license');
      assert.deepEqual(calls.map(call => call.action), ['activate-plugin-license', 'plugin-license-status', 'plugin-license-status']);
      assert.ok(!JSON.stringify(store).includes(key));
    } finally {globalThis.chrome = oldChrome; globalThis.fetch = oldFetch;}
  });
}

function withCloudMocks(run) {
  const oldChrome = globalThis.chrome;
  const oldFetch = globalThis.fetch;
  const stored = [];
  const requests = [];
  globalThis.chrome = {
    storage: {
      local: {
        async get() {
          return {
            attendanceCloudToken: "device-token",
            attendanceCloudDeviceId: "device-id",
            attendanceNtfyTopic: "soton-attendance-test",
          };
        },
        async set(value) { stored.push(value); },
      },
    },
  };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return Response.json({ entitlement: null, ok: true, plan: "bundle" });
  };
  return Promise.resolve()
    .then(() => run({ requests, stored }))
    .finally(() => {
      if (oldChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = oldChrome;
      globalThis.fetch = oldFetch;
    });
}

test("entitlement status uses the existing device token without sending client access fields", async () => {
  await withCloudMocks(async ({ requests, stored }) => {
    assert.equal(typeof cloud.getEntitlementStatus, "function");
    const result = await cloud.getEntitlementStatus();
    assert.deepEqual(result, { entitlement: null, ok: true, plan: "bundle" });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.headers.Authorization, "Bearer device-token");
    assert.deepEqual(JSON.parse(requests[0].options.body), { action: "entitlement-status" });
    assert.deepEqual(stored, []);
  });
});

test("createCheckoutSession sends plan, source, and currency with the device token", async () => {
  await withCloudMocks(async ({ requests, stored }) => {
    assert.equal(typeof cloud.createCheckoutSession, "function");
    const result = await cloud.createCheckoutSession({ plan: "sem_subscription", source: "stripe", currency: "myr" });
    assert.equal(result.ok, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.headers.Authorization, "Bearer device-token");
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      action: "create-checkout",
      plan: "sem_subscription",
      source: "stripe",
      currency: "myr",
    });
    assert.deepEqual(stored, []);
  });
});

test("activation sends a canonical website key with the device token and never stores it", async () => {
  await withCloudMocks(async ({ requests, stored }) => {
    assert.equal(typeof cloud.redeemActivationKey, "function");
    const code = "ac-0123-4567-89ab-cdef-0123-4567-89ab-cdef-0123-4567-89ab-cdef";
    await cloud.redeemActivationKey(code);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.headers.Authorization, "Bearer device-token");
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      action: "redeem-activation-key",
      activationKey: "AC-0123-4567-89AB-CDEF-0123-4567-89AB-CDEF-0123-4567-89AB-CDEF",
    });
    assert.deepEqual(stored, []);
  });
});

test("activation preserves the case-sensitive international suffix", async () => {
  await withCloudMocks(async ({ requests }) => {
    const key = "AC-INTL-MOBY-aBcD1234";
    await cloud.redeemActivationKey(key);
    assert.equal(JSON.parse(requests[0].options.body).activationKey, key);
  });
});

test("malformed activation input is rejected before device registration or state writes", async () => {
  const oldChrome = globalThis.chrome;
  const oldFetch = globalThis.fetch;
  const stored = [];
  const requests = [];
  globalThis.chrome = { storage: { local: {
    async get() { return {}; },
    async set(value) { stored.push(value); },
    async remove() {},
  } } };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return Response.json({ deviceId: "registered", deviceToken: "token", ntfyTopic: "test" });
  };
  try {
    await assert.rejects(cloud.redeemActivationKey("not-a-license-key"), { message: "invalid_activation_key" });
    assert.deepEqual(requests, []);
    assert.deepEqual(stored, []);
  } finally {
    if (oldChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = oldChrome;
    globalThis.fetch = oldFetch;
  }
});

test('registration replay retains durable ownership proof after a committed response is lost',async()=>{
  const oldChrome=globalThis.chrome,oldFetch=globalThis.fetch,store={};let committedToken,requests=0;
  globalThis.chrome={storage:{local:{get:async()=>({...store}),set:async v=>Object.assign(store,v),remove:async key=>{delete store[key];}}}};
  globalThis.fetch=async(_url,options)=>{
    requests++;
    const token=options.headers.Authorization?.slice(7);
    if(requests===1) {committedToken=token;throw Error('response lost after server commit');}
    if(!token||token!==committedToken) return Response.json({error:'device_identifier_exists'},{status:409});
    return Response.json({deviceId:'registered',deviceToken:token,ntfyTopic:'soton-attendance-'+'a'.repeat(40)});
  };
  try {
    await assert.rejects(cloud.ensureCloudDevice({allowRegistration:true}),/response lost/);
    assert.match(store.attendanceCloudRegistrationToken||'',/^[a-f0-9]{64}$/);
    const result=await cloud.ensureCloudDevice();assert.equal(result.attendanceCloudDeviceId,'registered');assert.equal(result.attendanceCloudToken,committedToken);
    assert.equal(store.attendanceCloudRegistrationToken,undefined);
  } finally {globalThis.chrome=oldChrome;globalThis.fetch=oldFetch;}
});
