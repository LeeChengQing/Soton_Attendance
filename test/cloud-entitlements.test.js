import assert from "node:assert/strict";
import test from "node:test";
import * as cloud from "../src/cloud.js";

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

test("activation sends only the entered key with the device token and never stores it", async () => {
  await withCloudMocks(async ({ requests, stored }) => {
    assert.equal(typeof cloud.redeemActivationKey, "function");
    const code = "01234567-89ABCDEF-01234567-89ABCDEF";
    await cloud.redeemActivationKey(code);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.headers.Authorization, "Bearer device-token");
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      action: "redeem-activation-key",
      activationKey: code,
    });
    assert.deepEqual(stored, []);
  });
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
