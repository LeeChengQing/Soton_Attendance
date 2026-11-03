import {pluginLicenseClient} from '../plugin-license.js';
// Recovered V1.0.5 background runtime variant; see docs/SOURCE_DRIFT_V1.0.5.md.
import {bindingForCourse,resolveFillPlan} from '../bindings.js';

import {todayMalaysia} from '../schedule.js';
var API_URL = "https://qckpwckfukyurkobrsig.supabase.co/functions/v1/device-api";
async function call(action, body = {}, token = "", timeoutMs = 1e4, signal) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([(async () => {
      const response = await fetch(API_URL, { method: "POST", headers, body: JSON.stringify({ action, ...body }), signal: signal?AbortSignal.any([controller.signal,signal]):controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = Error(data.error || `\u4E91\u7AEF\u8BF7\u6C42\u5931\u8D25\uFF08${response.status}\uFF09`);
        error.code = data.error || "cloud_request_failed";
        error.retryAfterSeconds = data.retryAfterSeconds??data.retry_after; error.httpStatus=response.status;
        throw error;
      }
      return data;
    })(), new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(Error("\u4E91\u7AEF\u8BF7\u6C42\u8D85\u65F6\uFF1B\u672C\u673A\u81EA\u52A8\u6253\u5361\u4ECD\u53EF\u4F7F\u7528\u3002"));
      }, timeoutMs);
      timer.unref?.();
    })]);
  } finally {
    clearTimeout(timer);
  }
}
var initializations = /* @__PURE__ */ new Map();
function ensureCloudDevice(options = {}) {
  const mode = options.signal ? 'activation' : options.allowRegistration ? "registration" : "existing";
  if (!initializations.has(mode)) {
    const pending = initializeDevice(options).finally(() => initializations.delete(mode));
    initializations.set(mode, pending);
  }
  return initializations.get(mode);
}
async function initializeDevice({ allowRegistration = false, signal } = {}) {
  const data = await chrome.storage.local.get(["attendanceCloudToken", "attendanceCloudDeviceId", "attendanceCloudDeviceKey", "attendanceCloudRegistrationToken", "attendanceNtfyTopic", "attendanceCloudSetupChoice", "attendanceCloudRecoveryPending"]);
  if (data.attendanceCloudToken && data.attendanceCloudDeviceId) {
    if (data.attendanceNtfyTopic) return data;
    const topic = await call("ntfy-topic", {}, data.attendanceCloudToken,10000,signal);
    const next2 = { attendanceNtfyTopic: topic.ntfyTopic };
    await chrome.storage.local.set(next2);
    return { ...data, ...next2 };
  }
  const deviceKey = data.attendanceCloudDeviceKey || `chrome-${crypto.randomUUID()}`;
  if (data.attendanceCloudDeviceId || data.attendanceCloudToken) throw Error("\u8BBE\u5907\u4E91\u7AEF\u51ED\u8BC1\u4E0D\u5B8C\u6574\uFF0C\u8BF7\u8054\u7CFB\u652F\u6301\uFF1B\u672C\u673A\u81EA\u52A8\u6253\u5361\u4ECD\u53EF\u4F7F\u7528\u3002");
  if (allowRegistration) {
    if (data.attendanceCloudRecoveryPending?.completionMayHaveCommitted || ["recovery-starting", "recovery-verifying", "recovery-outcome-unknown", "recovery-finalizing"].includes(data.attendanceCloudSetupChoice)) throw Error(data.attendanceCloudSetupChoice === "recovery-outcome-unknown" || data.attendanceCloudRecoveryPending?.completionMayHaveCommitted ? "recovery_outcome_unknown" : "recovery_in_progress");
    await chrome.storage.local.set({ attendanceCloudSetupChoice: "new" });
    await chrome.storage.local.remove?.("attendanceCloudRecoveryPending");
  } else if (["recovery-starting", "recovery-pending", "recovery-verifying", "recovery-outcome-unknown", "recovery-finalizing"].includes(data.attendanceCloudSetupChoice) || data.attendanceCloudSetupChoice !== "new" && !(data.attendanceCloudSetupChoice == null && data.attendanceCloudRegistrationToken)) {
    throw Error("cloud_setup_choice_required");
  }
  const proof = data.attendanceCloudRegistrationToken || [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  await chrome.storage.local.set({ attendanceCloudDeviceKey: deviceKey, attendanceCloudRegistrationToken: proof, attendanceCloudSetupChoice: "new" });
  const result = await call("register", { deviceKey, deviceName: "Soton Auto-Check \xB7 Chrome" }, proof,10000,signal);
  const next = { attendanceCloudDeviceKey: deviceKey, attendanceCloudDeviceId: result.deviceId, attendanceCloudToken: result.deviceToken, attendanceNtfyTopic: result.ntfyTopic };
  await chrome.storage.local.set(next);
  await chrome.storage.local.remove?.("attendanceCloudRegistrationToken");
  return { ...data, ...next };
}
function cloudSnapshot({ sessions = [], bindings = {}, profile = {}, preferences = {} } = {}) {
  const schedules = [];
  for (const session of sessions) {
    const binding = bindingForCourse(bindings, session.course);
    let ready = false;
    try {
      resolveFillPlan(binding, session, profile, todayMalaysia());
      ready = true;
    } catch {
    }
    schedules.push({ courseCode: session.course, courseName: session.course, weekday: Number(session.weekday), startTime: session.time, endTime: session.endTime, formUrl: binding?.url || null, enabled: session.enabled !== false, automationReady: ready, exceptions: session.exceptions || [], timezone: "Asia/Kuala_Lumpur" });
  }
  return { schedules, preferences: { timezone: "Asia/Kuala_Lumpur", reminderTime: "19:30", remindersEnabled: preferences.remindersEnabled !== false, successNotificationsEnabled: true } };
}
async function deliverCloud(item) {
  const cloud = await ensureCloudDevice();
  return call(item.action, item.payload, cloud.attendanceCloudToken);
}
async function getEntitlementStatus() {
  const cloud = await ensureCloudDevice();
  return call("entitlement-status", {}, cloud.attendanceCloudToken);
}
async function createCheckoutSession({ plan = "sem_subscription", source = "stripe", currency = "myr" } = {}) {
  const cloud = await ensureCloudDevice({ allowRegistration: true });
  return call("create-checkout", { plan, source, currency }, cloud.attendanceCloudToken);
}
const {activatePluginLicense,getPluginLicenseStatus}=pluginLicenseClient({call,ensureCloudDevice});

async function redeemActivationKey(activationKey) {
  const { attendanceCloudSetupChoice, attendanceCloudRecoveryPending } = await chrome.storage.local.get(["attendanceCloudSetupChoice", "attendanceCloudRecoveryPending"]);
  if (attendanceCloudRecoveryPending?.completionMayHaveCommitted || ["recovery-starting", "recovery-verifying", "recovery-outcome-unknown", "recovery-finalizing"].includes(attendanceCloudSetupChoice)) throw Error(attendanceCloudSetupChoice === "recovery-outcome-unknown" || attendanceCloudRecoveryPending?.completionMayHaveCommitted ? "recovery_outcome_unknown" : "recovery_in_progress");
  const cloud = await ensureCloudDevice({ allowRegistration: true });
  return call("redeem-activation-key", { activationKey }, cloud.attendanceCloudToken);
}
async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function startPhoneSubscriptionRecovery(activationKey) {
  if (typeof activationKey !== "string" || !activationKey.trim()) throw Error("recovery_unavailable");
  const data = await chrome.storage.local.get(["attendanceCloudRecoveryPending", "attendanceCloudSetupChoice"]);
  const prior = data.attendanceCloudRecoveryPending;
  const pending = prior?.targetDeviceKey && prior?.targetToken ? prior : {
    targetDeviceKey: `chrome-${crypto.randomUUID()}`,
    targetToken: [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    previousChoice: data.attendanceCloudSetupChoice || null
  };
  await chrome.storage.local.set({ attendanceCloudSetupChoice: "recovery-starting", attendanceCloudRecoveryPending: pending });
  try {
    const result = await call("recovery-start", {
      activationKey: activationKey.trim(),
      targetDeviceKey: pending.targetDeviceKey,
      targetTokenHash: await sha256(pending.targetToken)
    });
    const next = { ...pending, challengeId: result.challengeId, expiresAt: result.expiresAt, requestedAt: Date.now() };
    await chrome.storage.local.set({ attendanceCloudSetupChoice: "recovery-pending", attendanceCloudRecoveryPending: next });
    return { challengeId: next.challengeId, expiresAt: next.expiresAt };
  } catch (error) {
    const choice = pending.completionMayHaveCommitted ? "recovery-outcome-unknown" : pending.previousChoice || "pending";
    const retry = { ...pending };
    if (error.code === "recovery_delivery_failed") {
      delete retry.challengeId;
      delete retry.expiresAt;
      delete retry.requestedAt;
    }
    await chrome.storage.local.set({ attendanceCloudSetupChoice: choice, attendanceCloudRecoveryPending: retry });
    throw error;
  }
}
async function completePhoneSubscriptionRecovery(challengeId, code) {
  const { attendanceCloudRecoveryPending: pending } = await chrome.storage.local.get("attendanceCloudRecoveryPending");
  if (!pending?.targetDeviceKey || !pending?.targetToken || !pending.challengeId || pending.challengeId !== challengeId) throw Error("recovery_unavailable");
  await chrome.storage.local.set({ attendanceCloudSetupChoice: "recovery-verifying" });
  let result;
  try {
    result = await call("recovery-complete", { challengeId, code }, pending.targetToken);
  } catch (error) {
    const definitelyUnchanged = ["recovery_unavailable", "recovery_code_invalid", "recovery_code_expired", "recovery_attempts_exhausted"].includes(error.code);
    if (!definitelyUnchanged) await chrome.storage.local.set({ attendanceCloudRecoveryPending: { ...pending, completionMayHaveCommitted: true } });
    await chrome.storage.local.set({ attendanceCloudSetupChoice: definitelyUnchanged ? "recovery-pending" : "recovery-outcome-unknown" });
    throw error;
  }
  const { attendanceCloudOutbox: outbox = {} } = await chrome.storage.local.get("attendanceCloudOutbox");
  const nextOutbox = { ...outbox, items: (outbox.items || []).filter((item) => item.action !== "sync") };
  try {
    await chrome.storage.local.set({
      attendanceCloudSetupChoice: "recovery-finalizing",
      attendanceCloudDeviceKey: pending.targetDeviceKey,
      attendanceCloudDeviceId: result.deviceId,
      attendanceCloudToken: pending.targetToken,
      attendanceNtfyTopic: result.ntfyTopic,
      attendanceCloudOutbox: nextOutbox
    });
    await chrome.storage.local.remove?.(["attendanceCloudRecoveryPending", "attendanceCloudRegistrationToken"]);
    await chrome.storage.local.set({ attendanceCloudSetupChoice: "recovered" });
  } catch (error) {
    await chrome.storage.local.set({ attendanceCloudSetupChoice: "recovery-outcome-unknown" });
    throw error;
  }
  return { ok: true, entitlement: result.entitlement ?? null };
}
async function phoneSubscriptionRecoveryStatus() {
  const { attendanceCloudRecoveryPending: pending, attendanceCloudSetupChoice: choice } = await chrome.storage.local.get(["attendanceCloudRecoveryPending", "attendanceCloudSetupChoice"]);
  const inFlight = ["recovery-starting", "recovery-verifying", "recovery-outcome-unknown", "recovery-finalizing"].includes(choice);
  return { challengeId: pending?.challengeId || "", expiresAt: pending?.expiresAt || "", requestedAt: pending?.requestedAt || 0, setupChoice: choice || "", hasPending: Boolean(pending), canCancel: Boolean(pending) && !pending.completionMayHaveCommitted && !inFlight };
}
async function cancelPhoneSubscriptionRecovery() {
  const { attendanceCloudRecoveryPending: pending, attendanceCloudSetupChoice: current } = await chrome.storage.local.get(["attendanceCloudRecoveryPending", "attendanceCloudSetupChoice"]);
  if (pending?.completionMayHaveCommitted || ["recovery-starting", "recovery-verifying", "recovery-outcome-unknown", "recovery-finalizing"].includes(current)) throw Error("recovery_in_progress");
  const choice = pending?.previousChoice || "pending";
  await chrome.storage.local.remove?.("attendanceCloudRecoveryPending");
  await chrome.storage.local.set({ attendanceCloudSetupChoice: choice });
  return { ok: true, setupChoice: choice };
}
export { call, ensureCloudDevice, cloudSnapshot, deliverCloud, getEntitlementStatus, createCheckoutSession, activatePluginLicense, getPluginLicenseStatus, redeemActivationKey, startPhoneSubscriptionRecovery, completePhoneSubscriptionRecovery, phoneSubscriptionRecoveryStatus, cancelPhoneSubscriptionRecovery };
