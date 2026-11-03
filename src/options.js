import {initActivationGate} from './activation-gate.js';
void initActivationGate();
import './preflight-dashboard.js';
import {resolveCourseKind,courseKindWarning} from './course-kind.js';
import {formatRunError} from './diagnostics.js';
import {initWorkflowNav} from './workflow-nav.js';
import {importTimetable,decodeQrFile} from './importer.js';
import {validateFormsUrl} from './forms.js';
import {cleanQuestionTitle} from './question-title.js';
import {fieldMappingForQuestion} from './mapping.js';
import {moduleKey,bindingForCourse,legacyLinkSuggestion,validateBinding} from './bindings.js';
import {mergeSessions,normalizeDate,todayMalaysia,toWeeklySession} from './schedule.js';
import {ensureCloudDevice,getEntitlementStatus,createCheckoutSession,redeemActivationKey,startPhoneSubscriptionRecovery,completePhoneSubscriptionRecovery,phoneSubscriptionRecoveryStatus,cancelPhoneSubscriptionRecovery} from './cloud-client.js';
import {createOptionsUpgrade} from './options-upgrade.js';
import {t,currentLanguage,setLanguage,localizeMessage} from './options-locale.js';
import {filterOtherLabGroups,normalizeTimetableGroup} from './timetable-groups.js';
import {subscriptionCheckoutUrl} from './subscription-link.js';
import {testFormIdentity} from './test-mode.js';
import {startPricingPanel} from './pricing.js';
import {initPhoneSubscription} from './phone-subscription.js';
import {initPhoneConnectionTest} from './phone-connection-test.js';

var $2 = (id) => document.getElementById(id);
var preview = [];
var cards = /* @__PURE__ */ new Map();
var inspecting = /* @__PURE__ */ new Map();
var scanRequests = /* @__PURE__ */ new Map();
var bindingWrites = Promise.resolve();
var batchScanning = false;
var mappingSaveBusy = false;
var toastTimer;
var importGeneration = 0;
var recoveryCooldownUntil = 0;
var recoveryCooldownTimer;
var recoveryBusy = false;
var recoveryChallengeId = "";
var recoveryExpiresAt = 0;
var recoveryRequestedAt = 0;
var recoveryCanCancel = false;
var subscriptionCurrency = "rm";
var profileForm = $2("profile-form");
initWorkflowNav();
var upgrade = createOptionsUpgrade({ preview, getData, rebuild, toast, renderPreview, renderBindings, profile, validateProfile, openAllBindings });
function toast(message2, error = false) {
  if(message2?.code) message2=formatRunError(message2);
  message2 = localizeMessage(message2);
  const box = $2("toast");
  box.textContent = message2;
  box.className = `toast visible${error ? " error" : ""}`;
  $2("persistent-error").textContent = error ? message2 : "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.className = "toast", 6500);
}
function node2(tag, props = {}) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "text") el.textContent = value;
    else if (key === "className") el.className = value;
    else el[key] = value;
  }
  return el;
}
function profile() {
  return { student: profileForm.elements.student.value.trim(), name: profileForm.elements.name.value.trim(), studentType: profileForm.elements.studentType.value, group: normalizeTimetableGroup(profileForm.elements.group.value) };
}
async function renderHealth() {
  if (!$2('health-notifications')) return;
  const health = await chrome.runtime.sendMessage({type: 'HEALTH_CHECK'});
  if (health?.error) throw Error(health.error);
  $2('health-notifications').textContent = `${health.notifications ? '✅' : '❌'} ${t('healthNotifications')} — ${t(health.notifications ? 'healthNotificationsOk' : 'healthNotificationsFix')}`;
  $2('health-login').textContent = `${health.loggedIn === true ? '✅' : '❌'} ${t('healthLogin')} — ${t(health.loggedIn === true ? 'healthLoginOk' : health.loggedIn === false ? 'healthLoginFix' : 'healthNotChecked')}`;
  const next = health.nextRun ? new Intl.DateTimeFormat(currentLanguage() === 'zh' ? 'zh-CN' : currentLanguage(), {timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'short', timeStyle: 'short'}).format(new Date(health.nextRun)) : '';
  $2('health-next-run').textContent = `${next ? '✅' : '❌'} ${t('healthNextRun')} ${next} — ${t(next ? 'healthNextRunOk' : 'healthNextRunFix')}`;
  $2('health-version').textContent = `${health.version ? '✅' : '❌'} ${t('healthVersion')} ${health.version || ''} — ${t(health.version ? 'healthVersionOk' : 'healthVersionFix')}`;
}
async function renderAlert() {
  const {unresolvedAlert} = await chrome.storage.local.get('unresolvedAlert');
  const states = {failed: 'recordFailed', submitted_pending_confirmation: 'recordSubmittedPending', missed_sleep: 'recordMissedSleep'};
  $2('alert-detail').textContent = unresolvedAlert ? `${unresolvedAlert.course} · ${t(states[unresolvedAlert.state] || unresolvedAlert.state)} · ${unresolvedAlert.detail}` : '';
  $2('alert-banner').hidden = !unresolvedAlert;
}
$2('ack-alert').addEventListener('click', async () => {
  try {
    const result = await chrome.runtime.sendMessage({type: 'ACK_ALERT'});
    if (result?.error) throw Error(result.error);
    await renderAlert();
  } catch (error) {toast(error.message, true);}
});
void renderAlert().catch(console.error);
function validateProfile(p) {
  const group = p.group ?? "all";
  if (!p.student || p.student.length > 50 || !p.name || p.name.length > 100 || !["all", "1", "2", "3"].includes(group)) throw Error(t("profileInvalid"));
  return { ...p, group };
}
async function getData() {
  return chrome.storage.local.get(["keepAwakeEnabled", "allowForegroundFallback", "attendanceProfile", "attendanceSessions", "attendanceBindings", "attendanceRecords", "attendanceDiagnostics", "attendanceDraft", "attendanceSetupSession", "attendanceSetupHistory", "attendanceSetupCoverageEpoch", "attendanceCloudOutbox", "attendanceNtfyTopic", "attendanceLanguage", "attendanceSubscriptionCurrency"]);
}
async function rebuild() {
  const response = await chrome.runtime.sendMessage({ type: "REBUILD_SCHEDULE" });
  if (response?.error) throw Error(response.error);
}
async function syncCloudSafe() {
  await rebuild();
  await upgrade.render();
}
async function showCloudStatus() {
  const status = $2("cloud-status");
  if (!status) return;
  try {
    const data = await ensureCloudDevice();
    status.textContent = t("cloudConnected");
    status.className = "status success";
    const ntfy = $2("ntfy-status");
    if (ntfy && data.attendanceNtfyTopic) ntfy.textContent = `${t("phoneTopicReady")} https://ntfy.sh/${data.attendanceNtfyTopic}`;
  } catch (error) {
    status.textContent = error.message === "cloud_setup_choice_required" ? t("recoveryChoice") : t("cloudFailed", { error: error.message });
    status.className = "status error";
  }
}
var activationErrors = {
  invalid_activation_key: "errInvalidKey",
  activation_key_used: "errKeyUsed",
  activation_key_revoked: "errKeyRevoked",
  activation_key_expired: "errKeyExpired",
  activation_redemption_failed: "errActivationFailed",
  entitlement_status_failed: "entitlementFailed",
  cloud_setup_choice_required: "recoveryChoice",
  recovery_in_progress: "recoveryInProgress",
  recovery_outcome_unknown: "recoveryOutcomeUnknown",
  unauthorized: "errUnauthorized",
  device_identifier_exists: "errDeviceExists"
};
function entitlementTermEnd(expiresAt, plan) {
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) return "";
  const chinaPlan = plan === "sem_subscription";
  const locale = currentLanguage() === "en" ? chinaPlan ? "en-GB" : "en-MY" : "zh-CN";
  const timeZone = chinaPlan ? "Asia/Shanghai" : "Asia/Kuala_Lumpur";
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone }).format(new Date(expiry - 1));
}
var entitlementExpiryTimer;
function updatePhoneStatusVisibility(entitlement) {
  const card = $2("phone-status-card");
  if (!card) return false;
  clearTimeout(entitlementExpiryTimer);
  const startsAt = Date.parse(entitlement?.startsAt || ""), expiresAt = Date.parse(entitlement?.expiresAt || "");
  const active = entitlement?.status === "active" && entitlement.phoneNotifications === true && Number.isFinite(startsAt) && startsAt <= Date.now() && Number.isFinite(expiresAt) && expiresAt > Date.now();
  card.hidden = !active;
  if (!active) card.open = false;
  else entitlementExpiryTimer = setTimeout(() => void refreshEntitlementStatus(), Math.min(expiresAt - Date.now() + 25, 2147483647));
  return active;
}
async function refreshEntitlementStatus() {
  const status = $2("entitlement-status"), button2 = $2("refresh-entitlement");
  if (button2) button2.disabled = true;
  status.textContent = t("checkingEntitlement");
  status.className = "status";
  try {
    const result = await getEntitlementStatus(), entitlement = result.entitlement;
    if (!entitlement) {
      updatePhoneStatusVisibility(null);
      status.textContent = t("noEntitlement");
      status.className = "status";
      return;
    }
    const phoneStatusVisible = updatePhoneStatusVisibility(entitlement);
    const labels = { active: t("entitlementActive"), pending: t("entitlementPending"), expired: t("entitlementExpired"), revoked: t("entitlementRevoked") };
    const plans = { bundle: t("firstTermPlan"), phone_notifications: t("phonePlan"), sem_subscription: t("semesterSubscriptionPlan") };
    const end = entitlementTermEnd(entitlement.expiresAt, entitlement.plan);
    const expiryText = end ? t("expiry", { date: end }) : "";
    const permissionText = entitlement.phoneNotifications ? "" : t("permissionOff");
    status.textContent = `${plans[entitlement.plan] || t("phoneFallback")} \xB7 ${labels[entitlement.status] || t("unknownStatus")}${expiryText}${permissionText}`;
    status.className = `status${phoneStatusVisible ? " success" : ["expired", "revoked"].includes(entitlement.status) ? " error" : ""}`;
  } catch (error) {
    updatePhoneStatusVisibility(null);
    const code = error instanceof Error ? error.message : "";
    status.textContent = activationErrors[code] ? t(activationErrors[code]) : t("entitlementFailed");
    status.className = "status error";
  } finally {
    if (button2) button2.disabled = false;
  }
}
$2("refresh-entitlement")?.addEventListener("click", refreshEntitlementStatus);
async function setSubscriptionCurrency(currency, persist = true) {
  subscriptionCurrency = "rm";
  phoneSubscription.render();
  if (persist) await chrome.storage.local.set({ attendanceSubscriptionCurrency: subscriptionCurrency });
  void refreshCanonicalPricing();
}
async function openCanonicalPurchase(product='phone') {
  try {
    const cloud=await ensureCloudDevice();
    if(!cloud?.attendanceCloudToken)throw Error('请先连接扩展设备 / Connect your extension first');
    const productName={phone:'mobile_notification',yearly:'mobile_notification_yearly',extension:'extension',bundle:'bundle'}[product];
    if(!productName)throw Error('invalid_product');
    await chrome.tabs.create({url:'https://vf-auto-check.vercel.app/?product='+productName+'&billing='+(product==='yearly'?'yearly':'semester')+'#device_token='+encodeURIComponent(cloud.attendanceCloudToken)});
  } catch(error){toast(error.message,true);}
}
const phoneSubscription=initPhoneSubscription({onChange:()=>refreshCanonicalPricing.render()});
initPhoneConnectionTest();
const refreshCanonicalPricing=startPricingPanel({getProduct:phoneSubscription.getProduct});

let entitlementPollingTimer = null;
function startEntitlementPolling() {
  if (entitlementPollingTimer) clearInterval(entitlementPollingTimer);
  let pollAttempts = 0;
  entitlementPollingTimer = setInterval(async () => {
    pollAttempts++;
    if (pollAttempts > 20) {
      clearInterval(entitlementPollingTimer);
      entitlementPollingTimer = null;
      return;
    }
    try {
      const res = await getEntitlementStatus();
      if (res?.entitlement?.status === "active") {
        clearInterval(entitlementPollingTimer);
        entitlementPollingTimer = null;
        await refreshEntitlementStatus();
        toast(t("entitlementActive"));
      }
    } catch {}
  }, 3000);
}

$2("purchase-subscription")?.addEventListener("click", async (e) => {
  e.preventDefault();
  const link = $2("purchase-subscription");
  if(link.getAttribute('aria-disabled')==='true')return;
  if(subscriptionCurrency!=='rmb'){await openCanonicalPurchase(phoneSubscription.getProduct());return;}
  const originalText = link.textContent;
  link.textContent = t("connecting");
  try {
    const session = await createCheckoutSession({ plan: "sem_subscription", source: "stripe", currency: subscriptionCurrency === "rmb" ? "cny" : "myr" });
    if (session?.checkoutUrl) {
      await chrome.tabs.create({ url: session.checkoutUrl });
      startEntitlementPolling();
    } else {
      throw Error("checkout_creation_failed");
    }
  } catch (err) {
    $2("entitlement-status").textContent = err.message || t("entitlementFailed");
    $2("entitlement-status").className = "status error";
  } finally {
    link.textContent = originalText;
  }
});

window.addEventListener("focus", () => {
  if ($2("phone-subscription")?.open) {
    void refreshEntitlementStatus();
  }
});

function bindingUiState() {
  return new Map([...cards].map(([key, info2]) => [key, {
    url: info2.url.value,
    schema: info2.schema,
    mappingDirty: info2.mappingDirty === true,
    selected: [...info2.card.querySelectorAll(".mapping select")].map((select) => select.value)
  }]));
}
async function changeLanguage(language2) {
  const preservedBindings = bindingUiState();
  await setLanguage(language2);
  await renderAlert();
  await renderHealth();
  await setSubscriptionCurrency(subscriptionCurrency, false);
  renderPreview();
  await renderBindings(preservedBindings);
  await upgrade.render();
  upgrade.refreshLocale();
  if ($2("phone-subscription").open) {
    void refreshEntitlementStatus();
    void refreshRecoveryState();
  }
}
$2("language-en").addEventListener("click", () => void changeLanguage("en"));
$2("language-zh").addEventListener("click", () => void changeLanguage("zh"));
var recoveryErrors = {
  recovery_unavailable: "recoveryUnavailable",
  recovery_delivery_failed: "recoveryDeliveryFailed",
  recovery_rate_limited: "recoveryRateLimited",
  recovery_code_invalid: "recoveryCodeInvalid",
  recovery_code_expired: "recoveryCodeExpired",
  recovery_attempts_exhausted: "recoveryAttemptsExhausted",
  cloud_setup_choice_required: "recoveryChoice",
  recovery_outcome_unknown: "recoveryOutcomeUnknown",
  recovery_in_progress: "recoveryInProgress"
};
function updateRecoveryControls(status = {}) {
  if (status.challengeId !== void 0) recoveryChallengeId = status.challengeId || "";
  if (status.expiresAt !== void 0) recoveryExpiresAt = Date.parse(status.expiresAt || "") || 0;
  if (status.requestedAt !== void 0) recoveryRequestedAt = Number(status.requestedAt) || 0;
  if (status.canCancel !== void 0) recoveryCanCancel = Boolean(status.canCancel);
  const isValid = Boolean(recoveryChallengeId && recoveryExpiresAt > Date.now());
  const code = $2("recovery-code"), send = $2("send-recovery-code"), verify = $2("verify-recovery-code");
  if (code) code.disabled = !isValid || recoveryBusy;
  if (verify) verify.disabled = !isValid || recoveryBusy || !/^\d{6}$/.test(code?.value || "");
  const retryUntil = Math.max(recoveryCooldownUntil, recoveryRequestedAt + 6e4);
  const remaining = Math.max(0, Math.ceil((retryUntil - Date.now()) / 1e3));
  if (send) {
    send.disabled = recoveryBusy || remaining > 0;
    send.textContent = recoveryBusy ? t("sendingCode") : remaining ? t("resendAfter", { seconds: remaining }) : recoveryChallengeId ? t("resendCode") : t("sendCode");
  }
  const cancel = $2("cancel-recovery");
  if (cancel) {
    cancel.hidden = !recoveryCanCancel;
    cancel.disabled = recoveryBusy;
  }
  if (!isValid && recoveryChallengeId) {
    recoveryChallengeId = "";
    if (code) code.disabled = true;
  }
  if (remaining > 0 && !recoveryCooldownTimer) recoveryCooldownTimer = setInterval(() => {
    updateRecoveryControls({});
    if (Date.now() >= retryUntil) {
      clearInterval(recoveryCooldownTimer);
      recoveryCooldownTimer = null;
    }
  }, 1e3);
  if (remaining === 0 && recoveryCooldownTimer) {
    clearInterval(recoveryCooldownTimer);
    recoveryCooldownTimer = null;
  }
}
function recoveryMessage(message2, error = false) {
  const status = $2("recovery-message");
  status.textContent = message2;
  status.className = `status${error ? " error" : " success"}`;
}
async function refreshRecoveryState() {
  if (!$2("phone-recovery")) return;
  const state = await phoneSubscriptionRecoveryStatus();
  if (state.requestedAt) recoveryCooldownUntil = Math.max(recoveryCooldownUntil, state.requestedAt + 6e4);
  updateRecoveryControls(state);
  const expiresAt = Date.parse(state.expiresAt || "");
  if (state.setupChoice === "recovery-outcome-unknown") {
    recoveryMessage(t("recoveryPending"), true);
  } else if (state.challengeId && Number.isFinite(expiresAt)) {
    const when = new Intl.DateTimeFormat(currentLanguage() === "en" ? "en-MY" : "zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(expiresAt));
    recoveryMessage(expiresAt > Date.now() ? t("sentCode", { time: when }) : t("expiredCode"), expiresAt <= Date.now());
  } else if (state.setupChoice === "recovery-starting") {
    recoveryMessage(t("requestUnconfirmed"), true);
  } else if (state.hasPending) {
    recoveryMessage(t("recoveryIncomplete"), true);
  }
}
$2("send-recovery-code")?.addEventListener("click", async () => {
  const key = $2("recovery-key").value.trim();
  if (!key) {
    recoveryMessage(t("enterOldKey"), true);
    $2("recovery-key").focus();
    return;
  }
  recoveryBusy = true;
  updateRecoveryControls({});
  recoveryMessage(t("sendingRecovery"));
  try {
    await startPhoneSubscriptionRecovery(key);
    $2("recovery-key").value = "";
    $2("recovery-code").value = "";
    recoveryCooldownUntil = Date.now() + 6e4;
    await refreshRecoveryState();
  } catch (error) {
    const code = error.code || error.message || "";
    if (error.retryAfterSeconds) recoveryCooldownUntil = Date.now() + Number(error.retryAfterSeconds) * 1e3;
    await refreshRecoveryState();
    recoveryMessage(recoveryErrors[code] ? t(recoveryErrors[code]) : t("recoverySendFailed"), true);
  } finally {
    recoveryBusy = false;
    updateRecoveryControls(await phoneSubscriptionRecoveryStatus());
  }
});
$2("recovery-code")?.addEventListener("input", () => updateRecoveryControls({}));
$2("verify-recovery-code")?.addEventListener("click", async () => {
  const code = $2("recovery-code").value.trim();
  if (!/^\d{6}$/.test(code)) {
    recoveryMessage(t("enterSixDigits"), true);
    $2("recovery-code").focus();
    return;
  }
  recoveryBusy = true;
  updateRecoveryControls({});
  recoveryMessage(t("verifyingRecover"));
  try {
    await completePhoneSubscriptionRecovery(recoveryChallengeId, code);
    recoveryChallengeId = "";
    $2("recovery-code").value = "";
    recoveryMessage(t("recoverySuccess"));
    await refreshEntitlementStatus();
    await showCloudStatus();
    await refreshRecoveryState();
  } catch (error) {
    const codeName = error.code || error.message || "";
    await refreshRecoveryState();
    recoveryMessage(recoveryErrors[codeName] ? t(recoveryErrors[codeName]) : t("recoveryUnknownStatus"), true);
  } finally {
    recoveryBusy = false;
    updateRecoveryControls(await phoneSubscriptionRecoveryStatus());
  }
});
$2("cancel-recovery")?.addEventListener("click", async () => {
  try {
    await cancelPhoneSubscriptionRecovery();
    recoveryChallengeId = "";
    $2("recovery-code").value = "";
    recoveryMessage(t("recoveryCancelled"));
    await refreshRecoveryState();
  } catch (error) {
    const key = recoveryErrors[error.code || error.message];
    recoveryMessage(key ? t(key) : t("cancelFailed"), true);
  }
});
var weekdaysZh = ["\u5468\u65E5", "\u5468\u4E00", "\u5468\u4E8C", "\u5468\u4E09", "\u5468\u56DB", "\u5468\u4E94", "\u5468\u516D"];
var weekdaysEn = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
var weekdays = () => currentLanguage() === "en" ? weekdaysEn : weekdaysZh;
var lessonType = (course) => /(?:^|\W)lab\b/i.test(course || "") ? "Lab" : /(?:^|\W)(?:lec|lecture)\b/i.test(course || "") ? "Lecture" : /(?:^|\W)tut\b/i.test(course || "") ? "Tutorial" : currentLanguage() === "en" ? "Lesson" : "\u8BFE\u7A0B";
var field = (label, input) => {
  const wrapper = node2("label", { className: "session-field" });
  wrapper.append(node2("span", { text: label }), input);
  return wrapper;
};
function syncPreviewGroup(overwrite = false) {
  const group = profile().group;
  if (group === "all") return;
  for (const row of preview) {
    if (resolveCourseKind(row) !== "lab" || !overwrite && ["1", "2", "3", "skip"].includes(row.importChoice)) continue;
    const detected = String(row.group || "").match(/^(?:group\s*)?([123])$/i)?.[1] || row.course?.match(/\bgroup\s*([123])\b/i)?.[1];
    row.importChoice = detected && detected !== group ? "skip" : group;
    if (row.importChoice !== "skip") {
      row.group = group;
      row.course = `${row.code || row.course.split(/\s+-|-(?:LAB|TUT|LEC)\b/i)[0]}-${row.type || "LAB"} Group ${group}`;
    }
  }
}
function renderPreview(expandId) {
  syncPreviewGroup();
  upgrade.draftChanged();
  const root = $2("preview-rows");
  const openIds = new Set([...root.querySelectorAll(".session-card[open]")].map((card) => card.dataset.id));
  if (expandId) openIds.add(expandId);
  root.replaceChildren();
  const groups = /* @__PURE__ */ new Map();
  for (const row of preview) {
    const key = `weekly:${row.weekday ?? 1}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const overview = $2("preview-summary");
  overview.replaceChildren();
  if (!preview.length) {
    overview.append(node2("strong", { text: t("emptyAgendaTitle") }), node2("span", { text: t("emptyAgendaCopy") }));
    root.append(node2("p", { className: "agenda-empty", text: t("emptyAgenda") }));
    return;
  }
  overview.append(node2("strong", { text: t("previewCount", { count: preview.length }) }), node2("span", { text: t("previewDayCount", { count: groups.size }) }));
  const ordered = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [key, rows] of ordered) {
    const [, value] = key.split(":");
    const day = node2("section", { className: "agenda-day" }), heading = node2("div", { className: "agenda-day-head" });
    const title = `${t("weekdayPrefix")}${weekdays()[Number(value)] || t("weekdayFallback")}`;
    heading.append(node2("h3", { text: title }), node2("span", { className: "day-count", text: t("lessonCount", { count: rows.length }) }));
    const lessons = node2("div", { className: "agenda-lessons" });
    for (const row of rows.sort((a, b) => String(a.time).localeCompare(String(b.time)))) {
      const entry = node2("div", { className: "session-entry" });
      const card = node2("details", { className: "session-card" });
      card.dataset.id = row.id;
      if (openIds.has(row.id)) card.open = true;
      const summary = node2("summary", { className: "session-summary" }), time = node2("span", { className: "session-time" }), main = node2("span", { className: "session-main" });
      time.append(node2("strong", { text: row.time || "--:--" }), node2("small", { text: `${row.endTime || "--:--"} ${t("endTimeSuffix")}` }));
      main.append(node2("strong", { text: row.course || t("unnamedCourse") }), node2("small", { text: t("everyWeek") }));
      const type = ({lecture:"LEC",tutorial:"TUT",lab:"LAB"})[resolveCourseKind(row)] || "?", badge = node2("span", { className: `lesson-badge ${type.toLowerCase()}`, text: type });
      summary.append(time, main, badge, node2("span", { className: "session-chevron", text: "\u2304" }));
      const editor = node2("div", { className: "session-editor" });
      if (row.needsReview) editor.classList.add("needs-review");
      const course = node2("input", { value: row.course || "", placeholder: t("coursePlaceholder") });
      course.addEventListener("input", () => {
        row.course = course.value.trim();
        upgrade.draftChanged();
      });
      course.addEventListener("change", () => {
        row.course = course.value.trim();
        renderPreview(row.id);
        renderBindings();
      });
      editor.append(field(t("fieldCourseName"), course));
      const kindInput = node2("input", {value: row.type || "", placeholder: "LEC / TUT / LAB"});
      kindInput.addEventListener("change", () => {row.type = kindInput.value.trim(); upgrade.draftChanged(); renderPreview(row.id); void renderBindings();});
      editor.append(field("课型（LEC/TUT/LAB）", kindInput));
      if (!resolveCourseKind(row)) main.append(node2("small", {className:"course-kind-warning",text:courseKindWarning(row)}));
      const weekday = node2("select");
      for (const [index, label] of weekdays().entries()) weekday.append(node2("option", { value: String(index), text: label }));
      weekday.value = String(row.weekday ?? 1);
      weekday.addEventListener("change", () => {
        row.weekday = Number(weekday.value);
        renderPreview(row.id);
      });
      editor.append(field(t("fieldWeekday"), weekday));
      const start = node2("input", { type: "time", value: row.time || "09:00" });
      start.addEventListener("input", () => {
        row.time = start.value;
        upgrade.draftChanged();
      });
      start.addEventListener("change", () => {
        row.time = start.value;
        renderPreview(row.id);
      });
      editor.append(field(t("fieldStartTime"), start));
      const end = node2("input", { type: "time", value: row.endTime || "10:00" });
      end.addEventListener("input", () => {
        row.endTime = end.value;
        upgrade.draftChanged();
      });
      end.addEventListener("change", () => {
        row.endTime = end.value;
        renderPreview(row.id);
      });
      editor.append(field(t("fieldEndTime"), end));
      if (row.code || row.type || row.room || row.lecturer || row.date || row.confidence) {
        const metadata = node2("div", { className: "import-metadata" });
        const editable = (key2, label) => {
          const input = node2("input", { value: row[key2] || "" });
          input.addEventListener("input", () => {
            row[key2] = input.value.trim();
            if (key2 === "code" || key2 === "type") row.course = `${row.code || ""}${row.type ? `-${row.type}` : ""}${row.group ? ` Group ${row.group}` : ""}`;
            upgrade.draftChanged();
          });
          input.addEventListener("change", () => {
            renderPreview(row.id);
            renderBindings();
          });
          metadata.append(field(label, input));
        };
        if (row.code !== void 0) editable("code", "\u4EE3\u7801");

        if (row.group !== void 0) editable("group", "Group");
        if (row.room !== void 0) editable("room", "\u623F\u95F4");
        if (row.lecturer !== void 0) editable("lecturer", "\u6559\u5E08");
        if (row.date !== void 0) editable("date", "\u65E5\u671F");
        if (row.corrections?.length) metadata.append(node2("small", { className: "import-corrections", text: row.corrections.map((item) => `${item.raw} \u2192 ${item.corrected}`).join("\uFF1B") }));
        if (row.gridFailure) metadata.append(node2("small", { className: "import-grid-warning", text: t("gridFallbackNotice") }));
        if (row.confidence) metadata.append(node2("small", { className: "import-confidence", text: `\u7F6E\u4FE1\u5EA6\uFF1A${Object.entries(row.confidence).map(([key2, value2]) => `${key2} ${Math.round(value2 * 100)}%`).join(" \xB7 ")}` }));
        if (row.type === "LAB") {
          const choice = node2("select");
          for (const [value2, label] of [["", "\u9009\u62E9\u81EA\u5DF1\u7684 Group"], ["1", "Group 1"], ["2", "Group 2"], ["skip", "\u4E0D\u52A0\u5165\u6B64 Group"]]) choice.append(node2("option", { value: value2, text: label }));
          choice.append(node2("option", { value: "3", text: "Group 3" }));
          choice.value = row.importChoice || "";
          choice.addEventListener("change", () => {
            row.importChoice = choice.value;
            if (["1", "2", "3"].includes(choice.value)) {
              row.group = choice.value;
              row.course = `${row.code || row.course.split(/\s+-/)[0]}-${row.type} Group ${choice.value}`;
            }
            upgrade.draftChanged();
          });
          metadata.append(field("\u9009\u62E9\u53C2\u52A0\u7684\u7EC4", choice));
        }
        editor.append(metadata);
      }
      const exceptions = node2("input", { value: (row.exceptions || []).join(", "), placeholder: "YYYY-MM-DD, ..." });
      exceptions.addEventListener("input", () => {
        row.exceptions = exceptions.value.split(/[,，\s]+/).filter(Boolean);
        upgrade.draftChanged();
      });
      exceptions.addEventListener("change", () => {
        row.exceptions = exceptions.value.split(/[,，\s]+/).filter(Boolean);
        renderPreview(row.id);
      });
      const holder = field(t("fieldExceptions"), exceptions);
      holder.classList.add("wide");
      editor.append(holder);
      const remove = node2("button", { type: "button", text: t("delete"), className: "quiet lesson-remove" });
      remove.setAttribute("aria-label", `${t("delete")} ${row.course || t("unnamedCourse")}`);
      remove.addEventListener("click", (event) => {
        const index = preview.indexOf(row);
        if (index < 0) return;
        preview.splice(index, 1);
        renderPreview();
        void renderBindings();
        if (event.detail === 0) {
          const buttons = root.querySelectorAll(".lesson-remove");
          (buttons[Math.min(index, buttons.length - 1)] || $2("add-row")).focus({ preventScroll: true });
        }
      });
      card.append(summary, editor);
      entry.append(card, remove);
      lessons.append(entry);
    }
    day.append(heading, lessons);
    root.append(day);
  }
}
function courseNames(sessions = []) {
  return [...new Set([...preview.map((r) => r.course?.trim()), ...sessions.map((s) => s.course)].filter(Boolean))].sort();
}
function moduleGroups(sessions = []) {
  const groups = /* @__PURE__ */ new Map();
  for (const course of courseNames(sessions)) {
    const key = moduleKey(course);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(course);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}
async function renderBindings(preserved = bindingUiState()) {
  const { attendanceSessions: sessions = [], attendanceBindings: bindings = {}, attendanceProfile: p = {} } = await getData();
  const root = $2("bindings");
  root.replaceChildren();
  cards.clear();
  const groups = moduleGroups(sessions);
  if (!groups.length) {
    root.append(node2("p", { className: "muted", text: t("emptyBindings") }));
    updateMappingConfirmationButton();
    return;
  }
  for (const [key, courses] of groups) {
    const saved = bindings[key], legacy = legacyLinkSuggestion(bindings, courses);
    const ready = courses.every((course) => {
      try {
        validateBinding(bindingForCourse(bindings, course));
        return true;
      } catch {
        return false;
      }
    });
    const card = node2("article", { className: "binding" }), title = node2("h3", { text: key });
    const variants = node2("p", { className: "binding-variants", text: t("inspectFormsCopy", { courses: courses.join(" \xB7 ") }) });
    const previous = preserved.get(key);
    const row = node2("div", { className: "toolbar" }), url = node2("input", { type: "url", placeholder: t("formsUrlPlaceholder"), value: previous?.url ?? saved?.url ?? legacy.url });
    url.setAttribute("aria-label", t("formsUrlLabel", { key }));
    const fileLabel = node2("label", { className: "file-button", text: t("uploadQr") }), file = node2("input", { type: "file", accept: ".png,.jpg,.jpeg,image/png,image/jpeg" });
    fileLabel.append(file);
    const status = node2("p", { className: `status${ready ? " success" : ""}`, text: ready ? t("boundSuccessfully") : legacy.conflict ? t("legacyConflict") : t("bindingNeedsReview") });
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    row.append(url, fileLabel);
    card.append(title, variants, row, status);
    const testControls=document.createElement('div');
    testControls.append($2('test-binding-controls').content.cloneNode(true));
    const testSwitch=testControls.querySelector('[data-test-form]'),testButton=testControls.querySelector('[data-run-test]');
    testSwitch.checked=saved?.isTest===true;testButton.hidden=!testSwitch.checked;
    testSwitch.disabled=!saved?.verified || !saved?.title;
    testSwitch.addEventListener('change',async()=>{
      testSwitch.disabled=true;
      try {
        await bindingWrites;
        const {attendanceBindings:latest={},testFormAllowlist=[]}=await chrome.storage.local.get(['attendanceBindings','testFormAllowlist']);
        const binding=latest[key];
        if(!binding?.verified || !binding.title) throw Error('请先核对并保存完整表单名称。');
        const identity=testFormIdentity(binding.url),enabled=testSwitch.checked;
        if(enabled && !window.confirm(`允许真实提交到此测试表单？\n\n${binding.title}\n\n${binding.url}`)) {testSwitch.checked=false;return;}
        const allowlist=testFormAllowlist.filter(entry=>entry.host!==identity.host || entry.formId!==identity.formId);
        if(enabled) allowlist.push(identity);
        await chrome.storage.local.set({attendanceBindings:{...latest,[key]:{...binding,isTest:enabled}},testFormAllowlist:allowlist});
        testButton.hidden=!enabled;
      } catch(error) {testSwitch.checked=saved?.isTest===true;toast(error.message,true);}
      finally {testSwitch.disabled=false;}
    });
    testButton.addEventListener('click',async()=>{
      testButton.disabled=true;
      try {
        const result=await chrome.runtime.sendMessage({type:'RUN_TEST_NOW',bindingId:key});
        if(result?.error) throw Error(result.error);
        toast('测试任务已启动，请查看打卡记录。');
      } catch(error) {toast(error.message,true);}
      finally {testButton.disabled=false;}
    });
    card.append(testControls);
    root.append(card);
    cards.set(key, { card, url, status, courses, schema: previous?.schema, mappingDirty: previous?.mappingDirty === true });
    renderKindWarnings(key, sessions);
    if (previous?.schema) renderInspection(key, previous.schema, previous.selected);
    else if (saved?.verified && saved.questions) renderInspection(key, { url: saved.url, title: saved.title, questions: saved.questions }, saved.mapping.map((entry) => entry.field));
    let debounce, qrRevision = 0;
    const changed = () => {
      qrRevision++;
      clearTimeout(debounce);
      cancelInspection(key);
      infoStatus(key, t("bindingNeedsReview"));
      cards.get(key).schema = void 0;
      cards.get(key).mappingDirty = false;
      card.querySelector(".mapping")?.remove();
      updateMappingConfirmationButton();
      const value = url.value.trim();
      void writeBinding(key, () => ({ url: value, title: "", verified: false, scope: "module" })).catch((error) => infoStatus(key, error.message, true));
      if (value) debounce = setTimeout(() => void scanBinding(key).catch((error) => infoStatus(key, error.message, true)), 350);
    };
    url.addEventListener("input", changed);
    file.addEventListener("change", async () => {
      const image = file.files?.[0];
      if (!image) return;
      let revision = ++qrRevision;
      try {
        infoStatus(key, t("readingQr"));
        const decoded = await decodeQrFile(image);
        if (revision !== qrRevision) return;
        url.value = decoded;
        changed();
        revision = qrRevision;
        clearTimeout(debounce);
        await scanBinding(key);
      } catch (error) {
        if (revision === qrRevision) infoStatus(key, error.message, true);
      } finally {
        file.value = "";
      }
    });
  }
  updateMappingConfirmationButton();
}
function infoStatus(key, message2, error = false, success = false) {
  const info2 = cards.get(key);
  if (!info2) return;
  info2.status.textContent = localizeMessage(message2);
  info2.status.className = `status${error ? " error" : success ? " success" : ""}`;
}
function writeBinding(key, create) {
  const write = bindingWrites.catch(() => {
  }).then(async () => {
    const { attendanceBindings: bindings = {} } = await getData();
    const binding = create();
    if (!binding) return;
    if(bindings[key]?.isTest===true && bindings[key].url===binding.url && bindings[key].title===binding.title) binding.isTest=true;
    await chrome.storage.local.set({ attendanceBindings: { ...bindings, [key]: binding } });
  });
  bindingWrites = write;
  return write;
}
function finishInspection(inspection, error) {
  if (inspecting.get(inspection.tabId) !== inspection) return;
  clearTimeout(inspection.timer);
  inspecting.delete(inspection.tabId);
  void chrome.tabs.remove(inspection.tabId).catch(() => {
  });
  if (error) {
    infoStatus(inspection.key, error.message, true);
    inspection.reject(error);
  } else inspection.resolve();
}
function cancelInspection(key) {
  for (const inspection of inspecting.values()) if (inspection.key === key) finishInspection(inspection, Error(t("scanCancelled")));
}
function clearInspections() {
  for (const inspection of [...inspecting.values()]) finishInspection(inspection, Error(t("scanCancelled")));
}
function scanBinding(key) {
  const source = cards.get(key)?.url.value.trim();
  const existing = scanRequests.get(key);
  if (existing?.source === source) return existing.promise;
  const request2 = { source };
  request2.promise = scanBindingNow(key).finally(() => {
    if (scanRequests.get(key) === request2) scanRequests.delete(key);
  });
  scanRequests.set(key, request2);
  return request2.promise;
}
async function scanBindingNow(key) {
  const info2 = cards.get(key);
  if (!info2) return;
  const source = info2.url.value.trim(), url = validateFormsUrl(source).href;
  const existing = [...inspecting.values()].find((item) => item.key === key && item.source === source);
  if (existing) return existing.promise;
  cancelInspection(key);
  infoStatus(key, t("openingForm"));
  await writeBinding(key, () => cards.get(key)?.url.value.trim() === source ? { url, title: "", verified: false, scope: "module" } : null);
  const tab = await chrome.tabs.create({ url: "about:blank", active: false });
  if (cards.get(key)?.url.value.trim() !== source) {
    await chrome.tabs.remove(tab.id);
    return;
  }
  const inspection = { key, source, tabId: tab.id };
  inspection.promise = new Promise((resolve, reject) => {
    inspection.resolve = resolve;
    inspection.reject = reject;
  });
  inspecting.set(tab.id, inspection);
  inspection.timer = setTimeout(() => finishInspection(inspection, Error(t("inspectionTimeout"))), 9e4);
  void chrome.tabs.update(tab.id, { url }).catch((error) => finishInspection(inspection, error));
  return inspection.promise;
}
async function openAllBindings() {
  if (batchScanning) return;
  const entries = [...cards.entries()].map(([key, info2]) => ({ key, url: info2.url.value })).filter((entry) => entry.url.trim());
  if (!entries.length) throw Error(t("noFormLinks"));
  const button2 = $2("verify-all-bindings");
  batchScanning = true;
  button2.disabled = true;
  button2.textContent = t("scanningAll");
  let succeeded = 0, failed = 0;
  try {
    for (const entry of entries) {
      try {
        await scanBinding(entry.key);
        succeeded++;
      } catch (error) {
        failed++;
        infoStatus(entry.key, error.message, true);
      }
    }
    await rebuild();
    await upgrade.render();
    toast(t("scanSummary", { succeeded, failed }), failed > 0);
  } finally {
    batchScanning = false;
    button2.disabled = false;
    button2.textContent = t("verifyAllForms");
  }
}
function renderKindWarnings(key, sessions = []) {
  const info = cards.get(key);
  if (!info) return;
  info.card.querySelector(".binding-kind-warnings")?.remove();
  const rows = [...sessions, ...preview].filter(row => moduleKey(row.course) === key && !resolveCourseKind(row));
  if (!rows.length) return;
  const box = node2("div", {className:"binding-kind-warnings"});
  box.setAttribute("role", "status");
  for (const row of rows) box.append(node2("p", {className:"course-kind-warning",text:`${courseKindWarning(row)}（星期 ${row.weekday ?? "?"} ${row.time || ""}）`}));
  info.card.append(box);
}
function mappedInspection(key, schema, selects) {
  const info2 = cards.get(key);
  if (!info2) throw Error(t("scanCancelled"));
  const source = info2.url.value.trim();
  const mapping = schema.questions.map((q, i) => ({ title: cleanQuestionTitle(q.title), type: q.type, required: q.required, options: q.options || [], field: selects[i].value }));
  if (mapping.some((x) => !x.field)) throw Error(t("mapEveryQuestion"));
  const binding = { url: validateFormsUrl(schema.url).href, title: schema.title, questions: schema.questions.map(q=>({...q,title:cleanQuestionTitle(q.title)})), mapping, verified: true, scope: "module" };
  validateBinding(binding);
  return { key, source, schema, binding };
}
function updateMappingConfirmationButton() {
  const button2 = $2("confirm-all-bindings");
  if (!button2) return;
  button2.disabled = mappingSaveBusy || ![...cards.values()].some((info2) => info2.mappingDirty);
  button2.textContent = t(mappingSaveBusy ? "confirmingMappings" : "confirmAllBindings");
}
async function saveInspection(key, schema, selects) {
  const entry = mappedInspection(key, schema, selects);
  await writeBinding(key, () => cards.get(key)?.url.value.trim() === entry.source && cards.get(key)?.schema === schema ? entry.binding : null);
  const info2 = cards.get(key);
  if (info2?.url.value.trim() !== entry.source || info2.schema !== schema) return;
  info2.mappingDirty = false;
  updateMappingConfirmationButton();
  infoStatus(key, t("boundSuccessfully"), false, true);
  renderKindWarnings(key, (await getData()).attendanceSessions || []);
  await syncCloudSafe();
}
async function confirmAllMappings() {
  if (mappingSaveBusy) return;
  const entries = [...cards.entries()].map(([key, info2]) => ({ key, info: info2, schema: info2.schema, selects: [...info2.card.querySelectorAll(".mapping select")] })).filter((entry) => entry.schema && (entry.info.mappingDirty || entry.selects.some((select) => !select.value)));
  if (!entries.length) {
    toast(t("noMappingsToConfirm"));
    return;
  }
  const incomplete = entries.flatMap((entry) => entry.selects.filter((select) => !select.value).map((select) => ({ entry, select })));
  if (incomplete.length) {
    const { entry, select } = incomplete[0];
    entry.info.card.querySelector(".mapping-fields").open = true;
    infoStatus(entry.key, t("completeMappingsFirst"), true);
    select.focus({ preventScroll: true });
    select.scrollIntoView({ block: "center", behavior: "smooth" });
    toast(t("completeMappingsFirst"), true);
    return;
  }
  let candidates;
  try {
    candidates = entries.map((entry) => mappedInspection(entry.key, entry.schema, entry.selects));
  } catch (error) {
    toast(error.message, true);
    return;
  }
  mappingSaveBusy = true;
  updateMappingConfirmationButton();
  try {
    const write = bindingWrites.catch(() => {
    }).then(async () => {
      const { attendanceBindings: bindings = {} } = await getData(), updates = {};
      for (const candidate of candidates) {
        const info2 = cards.get(candidate.key);
        if (!info2 || info2.url.value.trim() !== candidate.source || info2.schema !== candidate.schema) throw Error(t("scanCancelled"));
        updates[candidate.key] = candidate.binding;
      }
      await chrome.storage.local.set({ attendanceBindings: { ...bindings, ...updates } });
    });
    bindingWrites = write;
    await write;
    for (const candidate of candidates) {
      const info2 = cards.get(candidate.key);
      if (info2?.url.value.trim() === candidate.source && info2.schema === candidate.schema) {
        info2.mappingDirty = false;
        infoStatus(candidate.key, t("boundSuccessfully"), false, true);
        renderKindWarnings(candidate.key, (await getData()).attendanceSessions || []);
      }
    }
    await syncCloudSafe();
    toast(t("mappingsConfirmed", { count: candidates.length }));
  } catch (error) {
    toast(error.message, true);
  } finally {
    mappingSaveBusy = false;
    updateMappingConfirmationButton();
  }
}
function renderInspection(key, schema, selectedValues = []) {
  const info2 = cards.get(key);
  if (!info2) return;
  schema.questions = schema.questions.map(q=>({...q,title:cleanQuestionTitle(q.title)}));
  info2.schema = schema;
  info2.card.querySelector(".mapping")?.remove();
  const box = node2("div", { className: "mapping" });
  box.append(node2("p", { text: t("actualForm", { title: schema.title, url: schema.url }) }));
  const selects = [];
  const fields = node2("details", { className: "mapping-fields" });
  fields.append(node2("summary", { text: t("editMapping") }));
  for (const [i, q] of schema.questions.entries()) {
    const title = `${i + 1}. ${cleanQuestionTitle(q.title)}`;
    const line = node2("div", { className: "mapping-row" }), questionLabel = `${title}\uFF08${q.type}${q.options?.length ? `\uFF1A${q.options.join(" / ")}` : ""}\uFF09`, select = node2("select");
    select.id = `mapping-${key}-${i}`;
    const { choices, selected } = fieldMappingForQuestion(q);
    for (const [value, text] of choices) select.append(node2("option", { value, text }));
    select.value = selectedValues[i] && choices.some(([value]) => value === selectedValues[i]) ? selectedValues[i] : selected;
    selects.push(select);
    const automatic = choices.length === 1 && ["student", "name"].includes(selected);
    if (automatic) {
      select.hidden = true;
      line.append(node2("span", { className: "mapping-label", text: questionLabel }), node2("span", { className: "mapping-auto", text: t(selected === "student" ? "mappingAutoStudent" : "mappingAutoName") }), select);
    } else {
      const label = node2("label", { text: questionLabel });
      label.htmlFor = select.id;
      line.append(label, select);
    }
    fields.append(line);
    select.addEventListener("change", () => {
      info2.mappingDirty = true;
      updateMappingConfirmationButton();
      infoStatus(key, t("mappingNeedsConfirmation"));
      void writeBinding(key, () => ({ ...schema, scope: "module", verified: false })).catch((error) => infoStatus(key, error.message, true));
    });
  }
  fields.open = selects.some((select) => !select.value);
  box.append(fields);
  info2.card.append(box);
  return selects;
}
chrome.runtime.onMessage.addListener((message2, sender) => {
  const inspection = inspecting.get(sender.tab?.id);
  if (!inspection) return;
  const key = inspection.key, info2 = cards.get(key);
  if (!info2 || info2.url.value.trim() !== inspection.source) {
    finishInspection(inspection, Error(t("scanCancelled")));
    return;
  }
  if (message2.type === "FORM_SETUP_ERROR") {
    finishInspection(inspection, Error(message2.error));
    return;
  }
  if (message2.type !== "FORM_READY") return;
  if (inspection.saving) return;
  inspection.saving = true;
  void (async () => {
    try {
      const url = validateFormsUrl(message2.url);
      if (sender.tab.url && validateFormsUrl(sender.tab.url).href !== url.href || !message2.title || !message2.questions?.length) throw Error(t("formsNotFound"));
      const schema = { url: url.href, title: message2.title, questions: message2.questions };
      const selects = renderInspection(key, schema);
      await saveInspection(key, schema, selects);
      finishInspection(inspection);
    } catch (error) {
      finishInspection(inspection, error);
    }
  })();
});
async function renderSaved() {
  await upgrade.render();
}
profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await chrome.storage.local.set({ attendanceProfile: validateProfile(profile()) });
    syncPreviewGroup(true);
    renderPreview();
    await rebuild();
    await renderBindings();
    await upgrade.render();
    $2("profile-details").open = false;
    toast(t("profileSavedToast"));
  } catch (error) {
    toast(error.message, true);
  }
});
$2("timetable-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const generation = ++importGeneration;
  try {
    $2("import-status").textContent = t("recognizingTimetable");
    const rows = await importTimetable(file, (message2) => {
      if (generation === importGeneration) $2("import-status").textContent = localizeMessage(message2);
    });
    if (generation !== importGeneration) return;
    if (!rows.length) throw Error(t("noRecognizedLessons"));
    const group = normalizeTimetableGroup(profileForm.elements.group.value), filteredRows = filterOtherLabGroups(rows, group), excluded = rows.length - filteredRows.length;
    if (!filteredRows.length) throw Error(t("noMatchingGroupLessons", { group }));
    preview.push(...filteredRows.map((r) => {
      const dayNumber = { Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5 }[r.day] ?? r.weekday ?? 1;
      const course = r.course || `${r.code || ""}${r.type ? `-${r.type}` : ""}${r.group ? ` Group ${r.group}` : ""}`;
      const weekly = toWeeklySession({ kind: "weekly", weekday: dayNumber, course, time: r.start || r.time, endTime: r.end || r.endTime });
      return { ...weekly, id: crypto.randomUUID(), exceptions: [], ...r, type: r.type || ({lecture:"LEC",tutorial:"TUT",lab:"LAB"})[resolveCourseKind({course})] || "", course, weekday: dayNumber, time: r.start || r.time, endTime: r.end || r.endTime };
    }));
    const hasGroupRows = rows.some((r) => /\bGroup\s*\d+\b/i.test(r.course || ""));
    $2("import-status").textContent = t("recognizedLessons", { count: filteredRows.length, groupWarning: group !== "all" ? t("groupFilterSummary", { group, count: excluded }) : hasGroupRows ? t("groupWarning") : "" });
    renderPreview();
    await renderBindings();
  } catch (error) {
    if (generation === importGeneration) {
      $2("import-status").textContent = error.message;
      toast(error.message, true);
    }
  } finally {
    event.target.value = "";
  }
});
$2("add-row").addEventListener("click", async () => {
  const row = { id: crypto.randomUUID(), course: "", type: "", kind: "weekly", weekday: 1, time: "09:00", endTime: "10:00", exceptions: [] };
  preview.push(row);
  renderPreview(row.id);
});
$2("clear-preview").addEventListener("click", async () => {
  if (!confirm(t("clearPreviewConfirm"))) return;
  importGeneration++;
  preview.length = 0;
  $2("timetable-file").value = "";
  $2("import-status").textContent = t("noImportYet");
  renderPreview();
  await renderBindings();
  toast(t("draftCleared"));
});
$2("clear-bindings").addEventListener("click", async () => {
  if (!confirm(t("clearBindingsConfirm"))) return;
  try {
    clearInspections();
    await bindingWrites.catch(() => {
    });
    await chrome.storage.local.set({ attendanceBindings: {} });
    await rebuild();
    await upgrade.render();
    await renderBindings(/* @__PURE__ */ new Map());
    toast(t("bindingsCleared"));
  } catch (error) {
    toast(error.message, true);
  }
});
$2("clear-sessions").addEventListener("click", async () => {
  if (!confirm(t("clearTasksConfirm"))) return;
  try {
    const data=await getData();
    const result=await chrome.runtime.sendMessage({type:'SAVE_SCHEDULES',sessions:[],expectedSessions:JSON.stringify(data.attendanceSessions||[])});
    if(result?.error) throw Error(result.error);
    await rebuild();
    await renderSaved();
    await renderBindings();
    toast(t("tasksDeleted"));
  } catch (error) {
    toast(error.message, true);
  }
});
$2("confirm-all-bindings").addEventListener("click", () => void confirmAllMappings());
$2("create-tasks").addEventListener("click", async () => {
  try {
    await upgrade.activateDraft();
  } catch (error) {
    toast(error.message, true);
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.unresolvedAlert) void renderAlert().catch(console.error);
  if(area==='local'&&changes.attendanceDiagnostics) {
    const latest=changes.attendanceDiagnostics.newValue?.at(-1);
    if(latest?.error) toast(latest.error,true);
  }
  if (area === "local" && ["attendanceRecords", "attendanceDiagnostics", "attendanceSessions", "attendanceBindings", "attendanceProfile", "attendanceSetupSession", "attendanceSetupHistory", "attendanceCloudOutbox"].some((key) => key in changes)) renderSaved().catch(console.error);
});
$2("keep-awake").addEventListener("change", async () => {
  const toggle=$2("keep-awake");
  toggle.disabled=true;
  try {
    if (toggle.checked) {
      const granted=await chrome.permissions.request({permissions:['power']});
      toggle.checked=granted;
      await chrome.storage.local.set({keepAwakeEnabled:granted});
      if (!granted) toast('未获得保持唤醒权限，开关已关闭。',true);
      await rebuild();
    } else {
      await chrome.storage.local.set({keepAwakeEnabled:false});
      await rebuild();
      await chrome.permissions.remove({permissions:['power']});
    }
  } catch (error) {
    toggle.checked=false;
    await chrome.storage.local.set({keepAwakeEnabled:false});
    toast(error.message,true);
  } finally {
    toggle.disabled=false;
  }
});
$2('allow-foreground-fallback').addEventListener('change',async()=>{
  await chrome.storage.local.set({allowForegroundFallback:$2('allow-foreground-fallback').checked});
});
var phoneInitialized = false;
$2("phone-subscription").addEventListener("toggle", () => {
  if (!$2("phone-subscription").open || phoneInitialized) return;
  phoneInitialized = true;
  void showCloudStatus();
  void refreshEntitlementStatus();
});
$2("open-subscription").addEventListener("click", () => {
  $2("phone-subscription").open = true;
  $2("phone-subscription").querySelector("summary").focus({ preventScroll: true });
});
for (const link of document.querySelectorAll('a[href="#profile-heading"]')) link.addEventListener("click", () => {
  $2("profile-details").open = true;
});
(async () => {
  const data = await getData(), p = data.attendanceProfile || {};
  $2("keep-awake").checked=data.keepAwakeEnabled===true;
  $2('allow-foreground-fallback').checked=data.allowForegroundFallback!==false;
  await setLanguage(data.attendanceLanguage || "zh", false);
  await renderHealth();
  setInterval(() => renderHealth().catch(console.error), 60000);
  await setSubscriptionCurrency(data.attendanceSubscriptionCurrency || "rm", false);
  profileForm.elements.student.value = p.student || "";
  profileForm.elements.name.value = p.name || "";
  profileForm.elements.studentType.value = p.studentType || "local";
  profileForm.elements.group.value = normalizeTimetableGroup(p.group);
  $2("profile-details").open = !(p.student && p.name);
  await upgrade.init(data);
  await renderBindings();
  await renderSaved();
  await refreshRecoveryState();
})().catch((error) => toast(error.message, true));
