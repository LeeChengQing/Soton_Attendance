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
