// src/license-key.js
var legacyUngroupedPattern = /^[0-9a-f]{32}$/i, legacyGroupedPattern = /^(?:[0-9a-f]{8}-){3}[0-9a-f]{8}$/i, chinaSemesterPattern = /^AC-CN-SEM-[A-Z0-9]{8,12}$/i, standardWebsitePattern = /^AC-(?:[0-9a-f]{4}-){11}[0-9a-f]{4}$/i, internationalPrefixes = ["AC-INTL-BNDL-", "AC-INTL-MOBM-", "AC-INTL-MOBY-"], pluginPattern = /^AC-LIC(?:(?:-[A-Z0-9]{4}){4}|(?:-[A-Z2-7]{4}){8})$/i, uuidPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i, cleanGateKey = (value) => String(value).trim().replace(/[–—−]/g, "-").replace(/\s+/g, "").toUpperCase();
function normalizeGateKey(value) {
  let clean = cleanGateKey(value);
  if (uuidPattern.test(clean)) return normalizeLicenseKey(clean);
  let body = clean.replace(/^AC-LIC-?/, "").replaceAll("-", "");
  if (!/^[A-Z0-9]+$/.test(body) || ![16, 32].includes(body.length)) throw Error("invalid_activation_key");
  return normalizeLicenseKey(`AC-LIC-${body.match(/.{4}/g).join("-")}`);
}
function normalizeLicenseKey(value) {
  if (typeof value != "string") throw new Error("invalid_activation_key");
  let trimmed = value.trim();
  if (pluginPattern.test(trimmed)) return trimmed.toUpperCase();
  if (uuidPattern.test(trimmed)) return trimmed.toLowerCase();
  if (legacyUngroupedPattern.test(trimmed) || legacyGroupedPattern.test(trimmed))
    return trimmed.replaceAll("-", "").toUpperCase();
  if (chinaSemesterPattern.test(trimmed) || standardWebsitePattern.test(trimmed)) return trimmed.toUpperCase();
  let prefix = internationalPrefixes.find((candidate) => trimmed.startsWith(candidate));
  if (prefix && /^[A-Za-z0-9]{8,12}$/.test(trimmed.slice(prefix.length))) return trimmed;
  throw new Error("invalid_activation_key");
}

// src/plugin-license.js
var licenseRevision = 0;
function pluginLicenseClient({ call: call2, ensureCloudDevice: ensureCloudDevice2, timeoutMs = 15e3 }) {
  return {
    async activatePluginLicense(value) {
      let licenseKey = normalizeGateKey(value);
      value = "";
      let controller = new AbortController(), timer;
      try {
        let deadline = new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort(Error("license_timeout")), reject(controller.signal.reason);
          }, timeoutMs);
        });
        return await Promise.race([deadline, (async () => {
          let cloud = await ensureCloudDevice2({ allowRegistration: !0, signal: controller.signal });
          if (controller.signal.aborted) throw controller.signal.reason;
          let result = await call2("activate-plugin-license", { licenseKey }, cloud.attendanceCloudToken, timeoutMs, controller.signal);
          if (controller.signal.aborted) throw controller.signal.reason;
          if (result?.ok !== !0) throw Error("activation_response_invalid");
          return licenseRevision++, await chrome.storage.local.set({ attendancePluginLicense: { plan: result.plan, expiresAt: result.expires_at, activatedAt: Date.now(), checkedAt: Date.now() } }), result;
        })()]);
      } finally {
        clearTimeout(timer), licenseKey = "";
      }
    },
    async getPluginLicenseStatus() {
      let identity = await chrome.storage.local.get(["attendanceCloudToken", "attendanceCloudDeviceId"]);
      if (!identity.attendanceCloudToken && !identity.attendanceCloudDeviceId) return { licensed: !1 };
      let revision = licenseRevision, cloud = await ensureCloudDevice2(), result = await call2("plugin-license-status", {}, cloud.attendanceCloudToken);
      if (revision !== licenseRevision) return { stale: !0 };
      if (typeof result?.licensed != "boolean" && !result?.kill_switch && !result?.min_version) throw Error("license_response_invalid");
      if (result.licensed === !0) {
        let { attendancePluginLicense: prior = {} } = await chrome.storage.local.get("attendancePluginLicense");
        await chrome.storage.local.set({ attendancePluginLicense: { ...prior, plan: result.plan, expiresAt: result.expires_at, activatedAt: prior.activatedAt || Date.now(), checkedAt: Date.now(), definitive: null } });
      }
      return result;
    }
  };
}

// src/runtime-timing.js
var FORMS_LOAD_MS = 6e4, LOGIN_REDIRECT_SETTLE_MS = 4e3;
var VALIDATION_MARGIN_MS = 15e3;
var PHASE_TIMEOUTS = Object.freeze({
  opening: FORMS_LOAD_MS + LOGIN_REDIRECT_SETTLE_MS + 26e3,
  reading: FORMS_LOAD_MS + 3e4,
  checking: 1e4,
  filling: 6e4,
  submitting: 20 * 1e3 + VALIDATION_MARGIN_MS + 1e4,
  confirming: 45e3
});

// src/cloud.js
var API_URL = "https://qckpwckfukyurkobrsig.supabase.co/functions/v1/device-api";
async function call(action, body = {}, token = "", timeoutMs = 1e4, signal) {
  let headers = { "Content-Type": "application/json" };
  token && (headers.Authorization = `Bearer ${token}`);
  let controller = new AbortController(), timer;
  try {
    return await Promise.race([(async () => {
      let response = await fetch(API_URL, { method: "POST", headers, body: JSON.stringify({ action, ...body }), signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal }), data = await response.json().catch(() => ({}));
      if (!response.ok) {
        let error = Error(data.error || `\u4E91\u7AEF\u8BF7\u6C42\u5931\u8D25\uFF08${response.status}\uFF09`);
        throw error.code = data.error || "cloud_request_failed", error.retryAfterSeconds = data.retryAfterSeconds ?? data.retry_after, error.httpStatus = response.status, error;
      }
      return data;
    })(), new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort(), reject(Error("\u4E91\u7AEF\u8BF7\u6C42\u8D85\u65F6\uFF1B\u672C\u673A\u81EA\u52A8\u6253\u5361\u4ECD\u53EF\u4F7F\u7528\u3002"));
      }, timeoutMs), timer.unref?.();
    })]);
  } finally {
    clearTimeout(timer);
  }
}
var initializations = /* @__PURE__ */ new Map();
function ensureCloudDevice(options = {}) {
  let mode = options.signal ? "activation" : options.allowRegistration ? "registration" : "existing";
  if (!initializations.has(mode)) {
    let pending2 = initializeDevice(options).finally(() => initializations.delete(mode));
    initializations.set(mode, pending2);
  }
  return initializations.get(mode);
}
async function initializeDevice({ allowRegistration = !1, signal } = {}) {
  let data = await chrome.storage.local.get(["attendanceCloudToken", "attendanceCloudDeviceId", "attendanceCloudDeviceKey", "attendanceCloudRegistrationToken", "attendanceNtfyTopic", "attendanceCloudSetupChoice", "attendanceCloudRecoveryPending"]);
  if (data.attendanceCloudToken && data.attendanceCloudDeviceId) {
    if (data.attendanceNtfyTopic) return data;
    let next2 = { attendanceNtfyTopic: (await call("ntfy-topic", {}, data.attendanceCloudToken, 1e4, signal)).ntfyTopic };
    return await chrome.storage.local.set(next2), { ...data, ...next2 };
  }
  let deviceKey = data.attendanceCloudDeviceKey || `chrome-${crypto.randomUUID()}`;
  if (data.attendanceCloudDeviceId || data.attendanceCloudToken) throw Error("\u8BBE\u5907\u4E91\u7AEF\u51ED\u8BC1\u4E0D\u5B8C\u6574\uFF0C\u8BF7\u8054\u7CFB\u652F\u6301\uFF1B\u672C\u673A\u81EA\u52A8\u6253\u5361\u4ECD\u53EF\u4F7F\u7528\u3002");
  if (allowRegistration) {
    if (data.attendanceCloudRecoveryPending?.completionMayHaveCommitted || ["recovery-starting", "recovery-verifying", "recovery-outcome-unknown", "recovery-finalizing"].includes(data.attendanceCloudSetupChoice)) throw Error(data.attendanceCloudSetupChoice === "recovery-outcome-unknown" || data.attendanceCloudRecoveryPending?.completionMayHaveCommitted ? "recovery_outcome_unknown" : "recovery_in_progress");
    await chrome.storage.local.set({ attendanceCloudSetupChoice: "new" }), await chrome.storage.local.remove?.("attendanceCloudRecoveryPending");
  } else if (["recovery-starting", "recovery-pending", "recovery-verifying", "recovery-outcome-unknown", "recovery-finalizing"].includes(data.attendanceCloudSetupChoice) || data.attendanceCloudSetupChoice !== "new" && !(data.attendanceCloudSetupChoice == null && data.attendanceCloudRegistrationToken))
    throw Error("cloud_setup_choice_required");
  let proof = data.attendanceCloudRegistrationToken || [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  await chrome.storage.local.set({ attendanceCloudDeviceKey: deviceKey, attendanceCloudRegistrationToken: proof, attendanceCloudSetupChoice: "new" });
  let result = await call("register", { deviceKey, deviceName: "Soton Auto-Check \xB7 Chrome" }, proof, 1e4, signal), next = { attendanceCloudDeviceKey: deviceKey, attendanceCloudDeviceId: result.deviceId, attendanceCloudToken: result.deviceToken, attendanceNtfyTopic: result.ntfyTopic };
  return await chrome.storage.local.set(next), await chrome.storage.local.remove?.("attendanceCloudRegistrationToken"), { ...data, ...next };
}
var { activatePluginLicense, getPluginLicenseStatus } = pluginLicenseClient({ call, ensureCloudDevice });

// src/license-gate.js
var GRACE = 72 * 36e5, versionParts = (value) => String(value).split(".").map((n) => Number.parseInt(n, 10) || 0);
function older(version, minimum) {
  let a = versionParts(version), b = versionParts(minimum);
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0);
  return !1;
}
var hardReason = (result) => String(result?.reason || result?.error || result?.status || "").toLowerCase();
function resolveGate(cache, result, now = Date.now(), version = "0.0.0") {
  let prior = !!(cache?.activatedAt || cache?.plan || cache?.checkedAt), incoming = result?.config || result || {}, incomingDefinitive = result?.licensed === !0 || incoming.kill_switch === !0 || incoming.maintenance === !0 || typeof incoming.min_version == "string" && older(version, incoming.min_version) || ["license_expired", "expired", "license_revoked", "revoked", "refunded", "license_refunded"].includes(hardReason(result)), effective = cache?.definitive && !incomingDefinitive ? cache.definitive : result || cache?.definitive || {}, config = effective.config || effective, reason = hardReason(effective), expiresAt = effective.expires_at ?? cache?.expiresAt ?? null, state;
  return config.kill_switch === !0 || config.maintenance === !0 ? state = "LOCKED_MAINT" : typeof config.min_version == "string" && older(version, config.min_version) ? state = "LOCKED_UPDATE" : prior && ["license_revoked", "revoked", "refunded", "license_refunded"].includes(reason) ? state = "LOCKED_REVOKED" : effective.licensed === !0 ? state = expiresAt && Date.parse(expiresAt) <= now ? "GRACE_WARN" : "UNLOCKED" : prior && ["license_expired", "expired"].includes(reason) && Number.isFinite(Date.parse(expiresAt)) && now > Date.parse(expiresAt) + GRACE ? state = "LOCKED_EXPIRED" : prior ? state = result || expiresAt && Date.parse(expiresAt) <= now ? "GRACE_WARN" : "UNLOCKED" : state = "LOCKED_NEW", { state, allowed: state === "UNLOCKED" || state === "GRACE_WARN", expiresAt, plan: effective.plan || cache?.plan || "", announcement: typeof config.announcement == "string" ? config.announcement.slice(0, 2e3) : "", links: config.links || cache?.config?.links || {} };
}

// src/popup.js
async function popupGate() {
  let state;
  try {
    state = await chrome.runtime.sendMessage({ type: "GET_LICENSE_GATE" });
  } catch {
  }
  if (!state?.state) {
    let cached = await chrome.storage.local.get("attendancePluginLicense");
    state = resolveGate(cached.attendancePluginLicense, { error: "unavailable" }, Date.now(), chrome.runtime.getManifest?.().version || "1.1.0");
  }
  let { attendanceLanguage } = await chrome.storage.local.get("attendanceLanguage");
  return english = attendanceLanguage === "en", document.getElementById("popup-activation-title").textContent = english ? "Activation required" : "\u9700\u8981\u6FC0\u6D3B", document.getElementById("popup-open-activation").textContent = english ? "Open activation page" : "\u6253\u5F00\u6FC0\u6D3B\u9875", document.getElementById("popup-activation").hidden = state.allowed, document.querySelector(".popup-card").hidden = !state.allowed, document.body.classList.remove("popup-pending"), state.allowed;
}
var refreshTimer, english = !1, pending = /* @__PURE__ */ new Set(), words = (zh, en) => english ? en : zh, courseStates = { ready: ["\u53EF\u6253\u5361", "Ready"], paused: ["\u5DF2\u6682\u505C", "Paused"], inactive_week: ["\u8BFE\u8868\u5DF2\u8FC7\u671F", "Expired timetable"], attempted: ["\u5DF2\u5C1D\u8BD5\u63D0\u4EA4\uFF0C\u7981\u6B62\u91CD\u590D\u6253\u5361", "Submission already attempted"], launched: ["\u6B63\u5728\u6253\u5361", "In progress"], pending: ["\u6B63\u5728\u63D0\u4EA4", "Submitting"], success: ["\u6253\u5361\u6210\u529F", "Checked in"], success_manual: ["\u5DF2\u624B\u52A8\u786E\u8BA4", "Confirmed"], unknown: ["\u7ED3\u679C\u4E0D\u660E\uFF0C\u8BF7\u67E5\u770B\u8BB0\u5F55", "Unknown result; check history"], submitted_pending_confirmation: ["\u5DF2\u63D0\u4EA4\uFF0C\u7B49\u5F85\u786E\u8BA4", "Awaiting confirmation"] };
async function renderCurrentCourses() {
  clearTimeout(refreshTimer);
  let list = document.getElementById("current-courses"), refreshAfterMs = 15e3;
  try {
    if (!await popupGate()) return;
    let result = await chrome.runtime.sendMessage({ type: "GET_POPUP_COURSES" });
    if (result?.error || !Array.isArray(result?.courses)) throw Error(result?.error || words("\u65E0\u6CD5\u8BFB\u53D6\u5F53\u524D\u8BFE\u7A0B", "Could not load current classes"));
    english = result.language === "en", refreshAfterMs = result.refreshAfterMs;
    let rows = result.courses.map((course) => {
      let row = document.createElement("div"), copy = document.createElement("div"), name = document.createElement("strong"), meta = document.createElement("p"), button = document.createElement("button");
      return row.className = "current-course", copy.className = "current-course-copy", meta.className = "current-course-meta", button.className = "check-in-button", button.type = "button", button.dataset.sessionId = course.id, name.textContent = course.course, meta.textContent = `${course.time}\u2013${course.endTime} \xB7 ${courseStates[course.state]?.[english ? 1 : 0] || words("\u6682\u4E0D\u53EF\u6253\u5361", "Unavailable")}`, button.disabled = pending.has(course.id) || course.state !== "ready", button.textContent = pending.has(course.id) ? words("\u6B63\u5728\u542F\u52A8\u2026", "Starting\u2026") : ["success", "success_manual"].includes(course.state) ? words("\u5DF2\u6253\u5361", "Checked in") : ["launched", "pending"].includes(course.state) ? words("\u6253\u5361\u4E2D\u2026", "Checking in\u2026") : words("\u624B\u52A8\u6253\u5361", "Check in"), copy.append(name, meta), row.append(copy, button), row;
    });
    if (!rows.length) {
      let empty = document.createElement("p");
      empty.className = "current-course-meta", empty.textContent = words("\u5F53\u524D\u6CA1\u6709\u6B63\u5728\u8FDB\u884C\u7684\u8BFE\u7A0B", "No class in progress"), rows.push(empty);
    }
    list.replaceChildren(...rows);
  } catch {
    list.replaceChildren(), document.getElementById("current-course-message").textContent = words("\u65E0\u6CD5\u8BFB\u53D6\u5F53\u524D\u8BFE\u7A0B\uFF0C\u8BF7\u91CD\u8BD5", "Could not load current classes. Please try again.");
  } finally {
    refreshTimer = setTimeout(() => void renderCurrentCourses(), refreshAfterMs);
  }
}
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("popup-open-activation").addEventListener("click", () => chrome.runtime.openOptionsPage()), renderCurrentCourses(), document.getElementById("current-courses").addEventListener("click", async (event) => {
    let button = event.target.closest("button[data-session-id]");
    if (!button || button.disabled || pending.has(button.dataset.sessionId)) return;
    let id = button.dataset.sessionId, message = document.getElementById("current-course-message");
    pending.add(id), button.disabled = !0, button.textContent = words("\u6B63\u5728\u542F\u52A8\u2026", "Starting\u2026"), message.textContent = "";
    try {
      let result = await chrome.runtime.sendMessage({ type: "MANUAL_CHECK_IN", sessionId: id });
      if (result?.error || result?.ok !== !0) throw Error(result?.error || words("\u6253\u5361\u672A\u542F\u52A8\uFF0C\u8BF7\u91CD\u8BD5", "Check-in did not start; please retry"));
    } catch (error) {
      let errors = { manual_check_in_not_eligible: words("\u8BFE\u7A0B\u72B6\u6001\u5DF2\u53D8\u5316\uFF0C\u8BF7\u67E5\u770B\u5F53\u524D\u72B6\u6001", "Class status changed; check its current state"), plugin_license_required: words("\u8BF7\u5148\u5728\u8BBE\u7F6E\u4E2D\u6FC0\u6D3B\u63D2\u4EF6", "Activate the extension in settings first"), plugin_license_unavailable: words("\u6388\u6743\u670D\u52A1\u6682\u4E0D\u53EF\u7528\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5", "License service unavailable; please retry later"), manual_check_in_not_started: words("\u6253\u5361\u672A\u542F\u52A8\uFF0C\u8BF7\u67E5\u770B\u8BB0\u5F55", "Check-in did not start; check history") };
      message.textContent = errors[error.message] || error.message;
    } finally {
      pending.delete(id), await renderCurrentCourses();
    }
  }), chrome.storage.onChanged.addListener((changes, area) => {
    area === "local" && ["attendanceSessions", "attendanceRecords", "attendanceLanguage", "attendancePluginLicense"].some((key) => key in changes) && renderCurrentCourses();
  });
}, { once: !0 });
window.addEventListener("pagehide", () => clearTimeout(refreshTimer));
