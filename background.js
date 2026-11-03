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

// src/course-kind.js
var aliases = { lec: "lecture", lect: "lecture", lecture: "lecture", tut: "tutorial", tutorial: "tutorial", lab: "lab", laboratory: "lab" };
function parse(value) {
  let kinds = new Set([...String(value || "").matchAll(/(?:^|[^a-z0-9])(lecture|lect|lec|tutorial|tut|laboratory|lab)(?:\d+)?(?=$|[^a-z0-9])/gi)].map((match) => aliases[match[1].toLowerCase()]));
  return kinds.size === 1 ? [...kinds][0] : null;
}
function resolveCourseKind({ type, course } = {}) {
  return parse(type) || parse(course);
}
function courseKindWarning(session) {
  return `${session.course} \u7F3A\u5C11\u8BFE\u578B\uFF08LEC/TUT/LAB\uFF09\uFF0C\u8BF7\u5728\u8BFE\u8868\u4E2D\u8865\u5168\u540E\u518D\u542F\u7528`;
}
function unknownCourseKind(session) {
  let error = Error(courseKindWarning(session));
  return error.code = "course_kind_unknown", error;
}

// src/question-title.js
var questionTitleRules = [
  { labels: ["Required to answer", "\u5FC5\u7B54", "\u5FC5\u586B"] },
  { labels: ["Single line text", "\u5355\u884C\u6587\u672C", "\u55AE\u884C\u6587\u5B57"] },
  { labels: ["Single choice", "\u5355\u9009", "\u55AE\u9078"] },
  { labels: ["Multiple choice", "\u591A\u9009", "\u591A\u9078"] },
  { labels: ["Long answer text", "\u957F\u7B54\u6848\u6587\u672C", "\u9577\u7B54\u6848\u6587\u5B57", "\u591A\u884C\u6587\u672C"] },
  { labels: ["Date", "\u65E5\u671F"], attached: !0 }
], escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), tidy = (value) => value.replace(/\s+/g, " ").trim();
function cleanQuestionTitle(raw, rules = questionTitleRules) {
  let title = tidy(String(raw ?? "").normalize("NFKC")).replace(/^\d+\s*[.)、]\s*/, "").replace(/^[.。]+\s*/, ""), changed = !0;
  for (; changed; ) {
    changed = !1;
    for (let rule of rules) {
      let labels = rule.labels.map((label) => escapeRegex(label).replace(/ /g, "\\s+")).join("|"), match = new RegExp(`(${labels})[\\s.\u3002\u2026]*(?:\\((?:text|radio|checkbox|date)(?:\\s*:[^)]*)?\\))?[\\s.\u3002\u2026]*$`, "i").exec(title);
      if (!match || match.index === 0) continue;
      let prefix = title.slice(0, match.index);
      if (rule.attached) {
        let previous = prefix.at(-1), first = match[1][0], afterMetadata = rules.some((other) => !other.attached && other.labels.some((label) => prefix.toLowerCase().endsWith(label.toLowerCase())));
        if (/\s/.test(previous) || /[a-z]/i.test(first) && !afterMetadata && !(/[.。]/.test(previous) || /[a-z]/.test(previous) && /[A-Z]/.test(first))) continue;
      }
      title = tidy(prefix.replace(/[\s.。…]+$/, "")), changed = !0;
      break;
    }
  }
  return title;
}
var normalizeComparable = (value) => cleanQuestionTitle(value).toLowerCase();

// src/v1.0.5/background-forms.js
function deliveryFromCourse(course, type) {
  let kind = resolveCourseKind({ course, type });
  if (!kind) throw unknownCourseKind({ course });
  return kind;
}
var HOSTS = /* @__PURE__ */ new Set(["forms.office.com", "forms.cloud.microsoft"]), normalize = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
function validateFormsUrl(value) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw Error("\u4E8C\u7EF4\u7801\u6216\u94FE\u63A5\u4E0D\u662F\u6709\u6548\u7F51\u5740\u3002");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !HOSTS.has(url.hostname.toLowerCase()) || !(/^\/r\/[\w-]+\/?$/.test(url.pathname) || /^\/Pages\/ResponsePage\.aspx$/i.test(url.pathname))) throw Error("\u53EA\u63A5\u53D7 Microsoft Forms \u7684\u586B\u5199\u94FE\u63A5\u3002");
  if (/^\/Pages\//i.test(url.pathname) && !url.searchParams.get("id")) throw Error("\u8868\u5355\u94FE\u63A5\u7F3A\u5C11 ID\u3002");
  return url.hash = "", url;
}
function verifyQuestions(questions, mapping) {
  if (!Array.isArray(questions) || questions.length !== mapping?.length) return !1;
  let actual = new Map(questions.map((q) => [normalizeComparable(q.title), q]));
  return mapping.every((entry) => {
    let q = actual.get(normalizeComparable(entry.title));
    return !q || q.type !== entry.type ? !1 : q.type !== "radio" ? !0 : JSON.stringify([...new Set(optionList(q))].sort()) === JSON.stringify([...new Set(optionList(entry))].sort());
  });
}
var questionKey = (question) => normalizeComparable(question?.title), optionList = (question) => [...question?.options || []].map(normalizeComparable);
function questionSignature(question) {
  return `${question?.type || ""}|${[...new Set(optionList(question))].sort().join("")}`;
}
function questionDiff(expected = [], actual = []) {
  let left = new Map(expected.map((q) => [questionKey(q), q])), right = new Map(actual.map((q) => [questionKey(q), q])), added = [], deleted = [], renamed = [], options = [];
  for (let key of left.keys()) right.has(key) || deleted.push(key);
  for (let key of right.keys()) left.has(key) || added.push(key);
  for (let key of left.keys()) {
    let q = right.get(key);
    if (!q) continue;
    q.type !== left.get(key).type && renamed.push({ from: key, to: key });
    let before = [...new Set(optionList(left.get(key)))].sort(), after = [...new Set(optionList(q))].sort();
    JSON.stringify(before) !== JSON.stringify(after) && options.push({ title: key, added: after.filter((v) => !before.includes(v)), removed: before.filter((v) => !after.includes(v)) });
  }
  let unmatchedLeft = deleted.map((key) => left.get(key)), unmatchedRight = added.map((key) => right.get(key));
  for (let oldQuestion of unmatchedLeft) {
    let index = unmatchedRight.findIndex((q) => questionSignature(q) === questionSignature(oldQuestion));
    if (index < 0) continue;
    let [newQuestion] = unmatchedRight.splice(index, 1), oldKey = questionKey(oldQuestion), newKey = questionKey(newQuestion);
    deleted.splice(deleted.indexOf(oldKey), 1), added.splice(added.indexOf(newKey), 1), renamed.push({ from: oldKey, to: newKey });
  }
  return { added: added.sort(), deleted: deleted.sort(), renamed: renamed.sort((a, b) => a.from.localeCompare(b.from)), options: options.sort((a, b) => a.title.localeCompare(b.title)) };
}
function formatDate(placeholder, date) {
  let [y, m, d] = date.split("-"), format = String(placeholder || "").match(/(?:yyyy|MM|M|dd|d)[/.-](?:yyyy|MM|M|dd|d)[/.-](?:yyyy|MM|M|dd|d)/)?.[0];
  if (!format) throw Error("\u65E0\u6CD5\u8BC6\u522B\u8868\u5355\u65E5\u671F\u683C\u5F0F\u3002");
  return format.replace(/yyyy|MM|dd|M|d/g, (t) => ({ yyyy: y, MM: m, M: String(+m), dd: d, d: String(+d) })[t]);
}
function deliveryOption(options, target) {
  return options.find((value) => target === "lab" ? ["lab", "laboratory"].includes(normalize(value)) : normalize(value) === target);
}
function identityOption(options, target) {
  return options.find((value) => target === "international" ? /international/i.test(value) : /\blocal\b/i.test(value) && !/international/i.test(value));
}
function buildFillPlan(questions, mapping, profile, date, course, type) {
  if (!verifyQuestions(questions, mapping)) {
    let error = Error("\u8868\u5355\u9898\u76EE\u53D1\u751F\u53D8\u5316\uFF0C\u5DF2\u505C\u6B62\u3002");
    throw error.code = "form_schema_changed", error.diff = questionDiff(mapping, questions), error;
  }
  return mapping.map((entry, i) => {
    let q = questions.find((item) => normalizeComparable(item.title) === normalizeComparable(entry.title)), value;
    if (q.type === "date" && q.required === !1) return { type: "date", field: entry.field, skip: !0 };
    let expectedType = ["student", "name"].includes(entry.field) ? "text" : entry.field === "date" ? "date" : /^(?:delivery|local)(?::|$)/.test(entry.field) ? "radio" : null;
    if (expectedType && q.type !== expectedType) throw Error(`\u7B2C ${i + 1} \u9898\u6620\u5C04\u4E0E\u9898\u578B\u4E0D\u4E00\u81F4\uFF0C\u672A\u63D0\u4EA4\u3002`);
    if (entry.field === "student") value = profile.student;
    else if (entry.field === "name") value = profile.name;
    else if (entry.field === "date") value = q.nativeDate ? date : formatDate(q.placeholder, date);
    else if (entry.field === "delivery" || ["delivery:lecture", "delivery:tutorial", "delivery:lab", "delivery:laboratory"].includes(entry.field)) {
      let target = entry.field === "delivery" ? deliveryFromCourse(course, type) : entry.field.split(":")[1];
      value = deliveryOption(q.options || [], target === "laboratory" ? "lab" : target);
    } else if (entry.field === "local" || ["local:local", "local:international"].includes(entry.field)) {
      let target = entry.field === "local" ? profile.studentType : entry.field.split(":")[1];
      value = identityOption(q.options || [], target);
    } else throw Error(`\u672A\u914D\u7F6E\u7B2C ${i + 1} \u9898\u3002`);
    if (!value) throw Error(`\u7B2C ${i + 1} \u9898\u6CA1\u6709\u5339\u914D\u7684\u7B54\u6848\u3002`);
    return { type: q.type, value, field: entry.field, questionTitle: q.title };
  });
}

// src/bindings.js
function moduleKey(course) {
  let text = String(course || "").trim();
  return text.match(/\b[A-Za-z]{2,}\d{3,}\b/)?.[0].toUpperCase() || text;
}
function bindingForCourse(bindings, course) {
  let key = moduleKey(course), binding = bindings?.[key];
  return binding?.scope === "module" || String(course || "").trim() === key ? binding : void 0;
}
function resolveFillPlan(binding, session, profile, date) {
  if (!binding?.verified) throw Error(`${moduleKey(session.course)} \u5C1A\u672A\u7ED1\u5B9A\u5E76\u6838\u5BF9\u5171\u7528\u8868\u5355\u3002`);
  let kind = deliveryFromCourse(session.course, session.type);
  if (!binding.questions) return null;
  for (let entry of binding.mapping) {
    if (!entry.field?.startsWith("delivery:")) continue;
    let fixed = entry.field.split(":")[1];
    if ((fixed === "laboratory" ? "lab" : fixed) !== kind) throw Error(`${session.course} \u7684\u56FA\u5B9A\u8BFE\u578B\u4E0E\u8BFE\u7A0B\u540D\u79F0\u4E0D\u4E00\u81F4\uFF0C\u8BF7\u91CD\u65B0\u6838\u5BF9\u5171\u7528\u8868\u5355\u3002`);
  }
  return buildFillPlan(binding.questions, binding.mapping, profile, date, session.course, session.type);
}

// src/runtime-timing.js
function scheduleWeekStatus(session, now = Date.now()) {
  let value = session?.weekStartDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return "needs_week_assignment";
  let date = /* @__PURE__ */ new Date(`${value}T00:00:00Z`), start = Date.parse(`${value}T00:00:00+08:00`);
  return !Number.isFinite(start) || date.getUTCDay() !== 1 || date.toISOString().slice(0, 10) !== value || !Number.isFinite(now) ? "needs_week_assignment" : now < start ? "upcoming" : now < start + 7 * 864e5 ? "active" : "expired";
}
var FORMS_LOAD_MS = 6e4, LOGIN_REDIRECT_SETTLE_MS = 4e3, WAKE_GRACE_MS = 3e5, VALIDATION_MARGIN_MS = 15e3, BACKGROUND_TIMER_TICK_MS = 1e3, DATE_PICKER_BUDGET_MS = 16e3;
var PHASE_TIMEOUTS = Object.freeze({
  opening: FORMS_LOAD_MS + LOGIN_REDIRECT_SETTLE_MS + 26e3,
  reading: FORMS_LOAD_MS + 3e4,
  checking: 1e4,
  filling: 6e4,
  submitting: 20 * 1e3 + VALIDATION_MARGIN_MS + 1e4,
  confirming: 45e3
});
function courseEndTimestamp(occ) {
  return occ?.isTest === !0 && occ.testRunId && Number.isFinite(occ.testDeadline) ? occ.testDeadline : !/^\d{4}-\d{2}-\d{2}$/.test(occ?.date || "") || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(occ?.endTime || "") ? NaN : Date.parse(`${occ.date}T${occ.endTime}:00+08:00`);
}
function canSubmitBeforeEnd(occ, now, remainingMs = 0) {
  let end = courseEndTimestamp(occ);
  return scheduleWeekStatus(occ, now) === "active" && scheduleWeekStatus(occ, now + remainingMs) === "active" && Number.isFinite(end) && remainingMs >= 0 && now + remainingMs < end;
}
function assertBeforeCourseEnd(occ, remainingMs = 0, now = Date.now()) {
  if (!canSubmitBeforeEnd(occ, now, remainingMs))
    throw scheduleWeekStatus(occ, now) !== "active" ? Object.assign(Error("\u8BFE\u8868\u5468\u672A\u5206\u914D\u3001\u672A\u5F00\u59CB\u6216\u5DF2\u8FC7\u671F\uFF0C\u672A\u63D0\u4EA4\u3002"), { code: "schedule_week_inactive" }) : Object.assign(Error("\u8BFE\u7A0B\u5DF2\u7ED3\u675F\u6216\u5269\u4F59\u65F6\u95F4\u4E0D\u8DB3\uFF0C\u672A\u63D0\u4EA4\u3002"), { code: "course_ended" });
}
function fillingTimeout(entries = []) {
  let dates = entries.filter((entry) => entry.type === "date" && !entry.skip).length;
  return Math.max(PHASE_TIMEOUTS.filling, dates * DATE_PICKER_BUDGET_MS + entries.length * BACKGROUND_TIMER_TICK_MS + BACKGROUND_TIMER_TICK_MS + VALIDATION_MARGIN_MS);
}

// src/v1.0.5/background-schedule.js
var pad = (n) => String(n).padStart(2, "0"), iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
function normalizeDate(value) {
  let text = String(value || "").trim(), m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  return m ? calendarDate(`${m[1]}-${pad(m[2])}-${pad(m[3])}`) : (m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/), m ? calendarDate(`${m[3]}-${pad(m[2])}-${pad(m[1])}`) : null);
}
function calendarDate(value) {
  let d = /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && iso(d) === value ? value : null;
}
function occurrencesBetween(sessions, startDate, endDate) {
  let result = [];
  for (let d = /* @__PURE__ */ new Date(`${startDate}T00:00:00Z`); d <= /* @__PURE__ */ new Date(`${endDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    let date = iso(d);
    for (let s of sessions)
      s.enabled !== !1 && scheduleWeekStatus(s, Date.parse(`${date}T00:00:00+08:00`)) === "active" && ((s.kind === "dated" ? s.date !== date : s.weekday !== d.getUTCDay() || (s.exceptions || []).includes(date)) || result.push({ ...s, date, key: `${encodeURIComponent(s.course.trim().toLowerCase())}:${date}:${s.time}${s.isTest && s.testRunId ? `:TEST_${s.testRunId}` : ""}` }));
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
}
function toWeeklySession(session) {
  let { date } = session, weekday = session.kind === "dated" ? (/* @__PURE__ */ new Date(`${normalizeDate(date)}T00:00:00Z`)).getUTCDay() : Number(session.weekday);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw Error(`${session.course || "\u8BFE\u7A0B"} \u7F3A\u5C11\u6709\u6548\u661F\u671F\u3002`);
  let weekState = scheduleWeekStatus(session);
  return { ...session, kind: "weekly", weekday, weekState, ...["needs_week_assignment", "expired"].includes(weekState) ? { enabled: !1 } : {} };
}
function todayMalaysia(now = /* @__PURE__ */ new Date()) {
  let parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function occurrenceTimestamp(occurrence) {
  return Date.parse(`${occurrence.date}T${occurrence.time}:00+08:00`);
}
function triggerTimestamp(occurrence) {
  let match = String(occurrence.endTime || occurrence.time || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return occurrenceTimestamp(occurrence) - 300 * 1e3;
  let hour = Number(match[1]), minute = Number(match[2]);
  return hour > 23 || minute > 59 ? occurrenceTimestamp(occurrence) - 300 * 1e3 : Date.parse(`${occurrence.date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`) - 300 * 1e3;
}

// src/v1.0.5/background-cloud.js
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
    let pending = initializeDevice(options).finally(() => initializations.delete(mode));
    initializations.set(mode, pending);
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
function cloudSnapshot({ sessions = [], bindings = {}, profile = {}, preferences = {} } = {}) {
  let schedules = [];
  for (let session of sessions) {
    let binding = bindingForCourse(bindings, session.course), ready = !1;
    try {
      resolveFillPlan(binding, session, profile, todayMalaysia()), ready = !0;
    } catch {
    }
    schedules.push({ courseCode: session.course, courseName: session.course, weekday: Number(session.weekday), startTime: session.time, endTime: session.endTime, formUrl: binding?.url || null, enabled: session.enabled !== !1, automationReady: ready, exceptions: session.exceptions || [], timezone: "Asia/Kuala_Lumpur" });
  }
  return { schedules, preferences: { timezone: "Asia/Kuala_Lumpur", reminderTime: "19:30", remindersEnabled: preferences.remindersEnabled !== !1, successNotificationsEnabled: !0 } };
}
async function deliverCloud(item) {
  let cloud = await ensureCloudDevice();
  return call(item.action, item.payload, cloud.attendanceCloudToken);
}
async function getEntitlementStatus() {
  let cloud = await ensureCloudDevice();
  return call("entitlement-status", {}, cloud.attendanceCloudToken);
}
async function createCheckoutSession({ plan = "sem_subscription", source = "stripe", currency = "myr" } = {}) {
  let cloud = await ensureCloudDevice({ allowRegistration: !0 });
  return call("create-checkout", { plan, source, currency }, cloud.attendanceCloudToken);
}
var { activatePluginLicense, getPluginLicenseStatus } = pluginLicenseClient({ call, ensureCloudDevice });
async function redeemActivationKey(activationKey) {
  let { attendanceCloudSetupChoice, attendanceCloudRecoveryPending } = await chrome.storage.local.get(["attendanceCloudSetupChoice", "attendanceCloudRecoveryPending"]);
  if (attendanceCloudRecoveryPending?.completionMayHaveCommitted || ["recovery-starting", "recovery-verifying", "recovery-outcome-unknown", "recovery-finalizing"].includes(attendanceCloudSetupChoice)) throw Error(attendanceCloudSetupChoice === "recovery-outcome-unknown" || attendanceCloudRecoveryPending?.completionMayHaveCommitted ? "recovery_outcome_unknown" : "recovery_in_progress");
  let cloud = await ensureCloudDevice({ allowRegistration: !0 });
  return call("redeem-activation-key", { activationKey }, cloud.attendanceCloudToken);
}
async function sha256(value) {
  let digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function startPhoneSubscriptionRecovery(activationKey) {
  if (typeof activationKey != "string" || !activationKey.trim()) throw Error("recovery_unavailable");
  let data = await chrome.storage.local.get(["attendanceCloudRecoveryPending", "attendanceCloudSetupChoice"]), prior = data.attendanceCloudRecoveryPending, pending = prior?.targetDeviceKey && prior?.targetToken ? prior : {
    targetDeviceKey: `chrome-${crypto.randomUUID()}`,
    targetToken: [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    previousChoice: data.attendanceCloudSetupChoice || null
  };
  await chrome.storage.local.set({ attendanceCloudSetupChoice: "recovery-starting", attendanceCloudRecoveryPending: pending });
  try {
    let result = await call("recovery-start", {
      activationKey: activationKey.trim(),
      targetDeviceKey: pending.targetDeviceKey,
      targetTokenHash: await sha256(pending.targetToken)
    }), next = { ...pending, challengeId: result.challengeId, expiresAt: result.expiresAt, requestedAt: Date.now() };
    return await chrome.storage.local.set({ attendanceCloudSetupChoice: "recovery-pending", attendanceCloudRecoveryPending: next }), { challengeId: next.challengeId, expiresAt: next.expiresAt };
  } catch (error) {
    let choice = pending.completionMayHaveCommitted ? "recovery-outcome-unknown" : pending.previousChoice || "pending", retry = { ...pending };
    throw error.code === "recovery_delivery_failed" && (delete retry.challengeId, delete retry.expiresAt, delete retry.requestedAt), await chrome.storage.local.set({ attendanceCloudSetupChoice: choice, attendanceCloudRecoveryPending: retry }), error;
  }
}
async function completePhoneSubscriptionRecovery(challengeId, code) {
  let { attendanceCloudRecoveryPending: pending } = await chrome.storage.local.get("attendanceCloudRecoveryPending");
  if (!pending?.targetDeviceKey || !pending?.targetToken || !pending.challengeId || pending.challengeId !== challengeId) throw Error("recovery_unavailable");
  await chrome.storage.local.set({ attendanceCloudSetupChoice: "recovery-verifying" });
  let result;
  try {
    result = await call("recovery-complete", { challengeId, code }, pending.targetToken);
  } catch (error) {
    let definitelyUnchanged = ["recovery_unavailable", "recovery_code_invalid", "recovery_code_expired", "recovery_attempts_exhausted"].includes(error.code);
    throw definitelyUnchanged || await chrome.storage.local.set({ attendanceCloudRecoveryPending: { ...pending, completionMayHaveCommitted: !0 } }), await chrome.storage.local.set({ attendanceCloudSetupChoice: definitelyUnchanged ? "recovery-pending" : "recovery-outcome-unknown" }), error;
  }
  let { attendanceCloudOutbox: outbox = {} } = await chrome.storage.local.get("attendanceCloudOutbox"), nextOutbox = { ...outbox, items: (outbox.items || []).filter((item) => item.action !== "sync") };
  try {
    await chrome.storage.local.set({
      attendanceCloudSetupChoice: "recovery-finalizing",
      attendanceCloudDeviceKey: pending.targetDeviceKey,
      attendanceCloudDeviceId: result.deviceId,
      attendanceCloudToken: pending.targetToken,
      attendanceNtfyTopic: result.ntfyTopic,
      attendanceCloudOutbox: nextOutbox
    }), await chrome.storage.local.remove?.(["attendanceCloudRecoveryPending", "attendanceCloudRegistrationToken"]), await chrome.storage.local.set({ attendanceCloudSetupChoice: "recovered" });
  } catch (error) {
    throw await chrome.storage.local.set({ attendanceCloudSetupChoice: "recovery-outcome-unknown" }), error;
  }
  return { ok: !0, entitlement: result.entitlement ?? null };
}
async function phoneSubscriptionRecoveryStatus() {
  let { attendanceCloudRecoveryPending: pending, attendanceCloudSetupChoice: choice } = await chrome.storage.local.get(["attendanceCloudRecoveryPending", "attendanceCloudSetupChoice"]), inFlight = ["recovery-starting", "recovery-verifying", "recovery-outcome-unknown", "recovery-finalizing"].includes(choice);
  return { challengeId: pending?.challengeId || "", expiresAt: pending?.expiresAt || "", requestedAt: pending?.requestedAt || 0, setupChoice: choice || "", hasPending: !!pending, canCancel: !!pending && !pending.completionMayHaveCommitted && !inFlight };
}
async function cancelPhoneSubscriptionRecovery() {
  let { attendanceCloudRecoveryPending: pending, attendanceCloudSetupChoice: current } = await chrome.storage.local.get(["attendanceCloudRecoveryPending", "attendanceCloudSetupChoice"]);
  if (pending?.completionMayHaveCommitted || ["recovery-starting", "recovery-verifying", "recovery-outcome-unknown", "recovery-finalizing"].includes(current)) throw Error("recovery_in_progress");
  let choice = pending?.previousChoice || "pending";
  return await chrome.storage.local.remove?.("attendanceCloudRecoveryPending"), await chrome.storage.local.set({ attendanceCloudSetupChoice: choice }), { ok: !0, setupChoice: choice };
}

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
var refreshing;
async function getActivationGate({ refresh = !1 } = {}) {
  if (refresh && refreshing) return refreshing;
  let read = async () => {
    let stored = await chrome.storage.local.get(["attendancePluginLicense", "attendanceCloudDeviceId", "attendanceGateDeviceId", "unresolvedAlert"]), cache = stored.attendancePluginLicense, result;
    if (refresh) {
      let revision = licenseRevision;
      try {
        result = await getPluginLicenseStatus();
      } catch (error) {
        result = { error: ["license_revoked", "license_expired", "license_refunded"].includes(error.code) ? error.code : "unavailable" };
      }
      (revision !== licenseRevision || result?.stale) && (result = null), cache = (await chrome.storage.local.get("attendancePluginLicense")).attendancePluginLicense || cache;
      let reason = hardReason(result), config = result?.config || result;
      cache && (config?.kill_switch === !0 || config?.maintenance === !0 || typeof config?.min_version == "string" && older(chrome.runtime.getManifest?.().version || "1.1.0", config.min_version) || ["license_expired", "license_revoked", "license_refunded", "expired", "revoked", "refunded"].includes(reason)) ? (cache = { ...cache, definitive: result, config: config.links ? { links: config.links } : cache.config }, await chrome.storage.local.set({ attendancePluginLicense: cache })) : cache?.definitive && result?.licensed === !0 && (cache = { ...cache, definitive: null }, await chrome.storage.local.set({ attendancePluginLicense: cache })), cache && config?.links && (cache = { ...cache, config: { links: config.links } }, await chrome.storage.local.set({ attendancePluginLicense: cache })), cache?.definitive && (hardReason(result) === "unavailable" || result?.licensed === !1 && !hardReason(result)) && (result = null);
    }
    let deviceId = stored.attendanceCloudDeviceId || stored.attendanceGateDeviceId;
    deviceId || (deviceId = crypto.randomUUID(), await chrome.storage.local.set({ attendanceGateDeviceId: deviceId }));
    let state = resolveGate(cache, result, Date.now(), chrome.runtime.getManifest?.().version || "1.1.0"), { unresolvedAlert } = await chrome.storage.local.get("unresolvedAlert");
    return await chrome.action?.setBadgeText?.({ text: state.allowed && !unresolvedAlert ? "" : "!" }), state.allowed || await chrome.action?.setBadgeBackgroundColor?.({ color: "#ad4037" }), { ...state, deviceId };
  };
  return refresh ? (refreshing = read().finally(() => {
    refreshing = null;
  }), refreshing) : read();
}

// src/preflight.js
var PREFLIGHT = "attendance-preflight:", WATCH = "attendance-preflight-watch:", CHECKS = ["\u5DF2\u767B\u5F55\u5B66\u6821\u8D26\u53F7", "\u8BFE\u578B\u53EF\u89E3\u6790", "\u8868\u5355\u94FE\u63A5\u4E0E\u7ED1\u5B9A\u4E00\u81F4", "\u6807\u9898\u4E0E\u9898\u76EE\u6CA1\u53D8", "\u65E5\u671F\u683C\u5F0F\u53EF\u586B", "\u586B\u5199\u540E\u6838\u5BF9\u901A\u8FC7"];
function preflightCoordinator(notify2) {
  async function finish(key, checks) {
    let data = await chrome.storage.local.get(["attendancePreflightRuns", "attendanceRecords", "attendancePreflightNotices"]), run = data.attendancePreflightRuns?.[key];
    if (!run) return;
    let permission = "denied";
    try {
      permission = await chrome.notifications.getPermissionLevel();
    } catch {
    }
    checks = [...CHECKS.map((name) => checks.find((c) => c.name === name) || { name, ok: !1, hint: "\u524D\u7F6E\u68C0\u67E5\u672A\u901A\u8FC7\uFF0C\u5C1A\u672A\u68C0\u67E5\u3002" }), ...checks.filter((c) => !CHECKS.includes(c.name)), { name: "Chrome \u901A\u77E5\u6743\u9650\u53EF\u7528", ok: permission === "granted", hint: permission === "granted" ? "" : "\u8BF7\u5728 Chrome \u548C\u7CFB\u7EDF\u8BBE\u7F6E\u4E2D\u5141\u8BB8 Chrome \u901A\u77E5\u3002" }];
    let preflight2 = { at: (/* @__PURE__ */ new Date()).toISOString(), ok: checks.every((c) => c.ok), checks }, records = data.attendanceRecords || {};
    records[key] = { ...records[key] || { state: "scheduled", occ: run.occ }, preflight: preflight2, preflightConfiguration: JSON.stringify({ binding: run.binding, profile: run.profile }) };
    let runs = { ...data.attendancePreflightRuns };
    delete runs[key];
    let notices = data.attendancePreflightNotices || {}, fresh = [];
    for (let c of checks.filter((c2) => !c2.ok && !c2.hint.startsWith("\u524D\u7F6E\u68C0\u67E5"))) {
      let reason = c.name;
      (!notices[reason] || Date.now() - notices[reason] >= 30 * 6e4) && (fresh.push(c.hint), notices[reason] = Date.now());
    }
    await chrome.storage.local.set({ attendanceRecords: records, attendancePreflightRuns: runs, attendancePreflightNotices: notices }), await chrome.alarms.clear(WATCH + key), run.tabId && await chrome.tabs.remove(run.tabId).catch(() => {
    }), fresh.length && await notify2("\u6253\u5361\u9884\u68C0\u672A\u5C31\u7EEA", `${run.occ.course}\uFF1A${fresh.join("\uFF1B")}`);
  }
  async function abortAll() {
    let { attendancePreflightRuns: runs = {} } = await chrome.storage.local.get("attendancePreflightRuns");
    for (let key of Object.keys(runs)) await finish(key, [{ name: "\u586B\u5199\u540E\u6838\u5BF9\u901A\u8FC7", ok: !1, hint: "\u6B63\u5F0F\u6253\u5361\u5DF2\u8D77\u8DD1\uFF0C\u9884\u68C0\u7ED3\u675F\uFF1B\u7A0D\u540E\u68C0\u67E5\u914D\u7F6E\u3002" }]);
  }
  async function start(key) {
    let data = await chrome.storage.local.get(["attendanceRecords", "attendanceSessions", "attendanceBindings", "attendanceProfile", "attendancePreflightRuns"]), record = data.attendanceRecords?.[key];
    if (!record || record.state !== "scheduled" || !(data.attendanceSessions || []).some((s) => s.id === record.occ.id && s.enabled !== !1 && s.course === record.occ.course && s.time === record.occ.time && s.endTime === record.occ.endTime && !(s.exceptions || []).includes(record.occ.date)) || triggerTimestamp(record.occ) <= Date.now()) return;
    if (Object.keys(data.attendancePreflightRuns || {}).length || Object.values(data.attendanceRecords || {}).some((r) => ["launched", "pending"].includes(r.state))) {
      await chrome.alarms.create(PREFLIGHT + key + ":deferred", { when: Date.now() + 5e3 });
      return;
    }
    let binding = bindingForCourse(data.attendanceBindings, record.occ.course), runs = {};
    runs[key] = { occ: record.occ, binding, profile: data.attendanceProfile, deadline: Date.now() + 12e4 }, await chrome.storage.local.set({ attendancePreflightRuns: runs });
    try {
      if (await chrome.notifications.getPermissionLevel() !== "granted") {
        await finish(key, []);
        return;
      }
      let url = validateFormsUrl(binding?.url), tab = await chrome.tabs.create({ url: "about:blank", active: !1 });
      runs[key].tabId = tab.id, await chrome.storage.local.set({ attendancePreflightRuns: runs }), await chrome.alarms.create(WATCH + key, { when: runs[key].deadline }), url.hash = new URLSearchParams({ attendanceCheck: record.occ.course, attendancePreflight: key }).toString(), await chrome.tabs.update(tab.id, { url: url.href });
    } catch (error) {
      await finish(key, [{ name: "\u8868\u5355\u94FE\u63A5\u4E0E\u7ED1\u5B9A\u4E00\u81F4", ok: !1, hint: `${error.message} \u8BF7\u91CD\u65B0\u7ED1\u5B9A\u8BFE\u7A0B\u8868\u5355\u3002` }]);
    }
  }
  async function identify(tabId) {
    let { attendancePreflightRuns: runs = {} } = await chrome.storage.local.get("attendancePreflightRuns"), entry = Object.entries(runs).find(([, r]) => r.tabId === tabId);
    return entry ? { kind: "preflight", key: entry[0], course: entry[1].occ.course } : null;
  }
  async function handle(message, sender) {
    let identity = await identify(sender.tab?.id);
    if (!identity || identity.key !== message.key) throw Error("\u9884\u68C0\u4E0E\u5F53\u524D\u6807\u7B7E\u9875\u4E0D\u5339\u914D\u3002");
    let { attendancePreflightRuns: runs } = await chrome.storage.local.get("attendancePreflightRuns"), run = runs[message.key];
    if (message.type === "GET_PREFLIGHT") return { occ: run.occ, binding: run.binding, profile: run.profile };
    let checks = ["\u5DF2\u767B\u5F55\u5B66\u6821\u8D26\u53F7", "\u8BFE\u578B\u53EF\u89E3\u6790", "\u8868\u5355\u94FE\u63A5\u4E0E\u7ED1\u5B9A\u4E00\u81F4", "\u6807\u9898\u4E0E\u9898\u76EE\u6CA1\u53D8", "\u65E5\u671F\u683C\u5F0F\u53EF\u586B", "\u586B\u5199\u540E\u6838\u5BF9\u901A\u8FC7"].map((name) => {
      let c = message.checks?.find((c2) => c2.name === name);
      return { name, ok: c?.ok === !0, hint: String(c?.hint || (c?.ok ? "" : "\u68C0\u67E5\u672A\u5B8C\u6210\uFF0C\u8BF7\u91CD\u65B0\u9884\u68C0\u3002")).slice(0, 400) };
    }), current = await chrome.storage.local.get(["attendanceBindings", "attendanceProfile"]);
    return JSON.stringify({ binding: bindingForCourse(current.attendanceBindings, run.occ.course), profile: current.attendanceProfile }) !== JSON.stringify({ binding: run.binding, profile: run.profile }) && checks.push({ name: "\u914D\u7F6E\u4FDD\u6301\u4E00\u81F4", ok: !1, hint: "\u9884\u68C0\u671F\u95F4\u914D\u7F6E\u53D1\u751F\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u68C0\u67E5\u8868\u5355\u7ED1\u5B9A\u548C\u5B66\u751F\u8D44\u6599\u3002" }), await finish(message.key, checks), { ok: !0 };
  }
  async function schedule(occurrences, records) {
    let wanted = /* @__PURE__ */ new Map();
    for (let occ of occurrences) {
      if (records[occ.key] && records[occ.key].state !== "scheduled") continue;
      let due = triggerTimestamp(occ);
      if (!(due <= Date.now() || due < Date.parse(occ.createdAt || "1970-01-01"))) {
        records[occ.key] ||= { state: "scheduled", occ }, records[occ.key].occ = occ;
        for (let minutes of [30, 8]) {
          let when = due - minutes * 6e4;
          when > Date.now() && wanted.set(`${PREFLIGHT}${occ.key}:${minutes}`, when);
        }
      }
    }
    if (chrome.alarms.getAll) for (let alarm2 of await chrome.alarms.getAll()) alarm2.name.startsWith(PREFLIGHT) && !wanted.has(alarm2.name) && await chrome.alarms.clear(alarm2.name);
    for (let [name, when] of wanted) await chrome.alarms.create(name, { when });
    await chrome.storage.local.set({ attendanceRecords: records });
  }
  async function alarm(name) {
    return name.startsWith(WATCH) ? (await finish(name.slice(WATCH.length), [{ name: "\u5DF2\u767B\u5F55\u5B66\u6821\u8D26\u53F7", ok: !1, hint: "\u8868\u5355\u52A0\u8F7D\u8D85\u65F6\uFF0C\u9700\u8981\u91CD\u65B0\u767B\u5F55\u5B66\u6821 Microsoft \u8D26\u53F7\uFF0C\u5E76\u68C0\u67E5\u7F51\u7EDC\u6216\u8BBF\u95EE\u6743\u9650\u3002" }]), !0) : name.startsWith(PREFLIGHT) ? (await start(name.slice(PREFLIGHT.length, name.lastIndexOf(":"))), !0) : !1;
  }
  async function navigation(tabId) {
    let identity = await identify(tabId);
    return identity && await finish(identity.key, [{ name: "\u5DF2\u767B\u5F55\u5B66\u6821\u8D26\u53F7", ok: !1, hint: "\u9700\u8981\u91CD\u65B0\u767B\u5F55\u5B66\u6821 Microsoft \u8D26\u53F7\u3002\u767B\u5F55\u540E\u91CD\u65B0\u68C0\u67E5\u8BFE\u7A0B\u8868\u5355\u3002" }]), !!identity;
  }
  async function resume() {
    let { attendancePreflightRuns: runs = {} } = await chrome.storage.local.get("attendancePreflightRuns");
    for (let [key, run] of Object.entries(runs))
      run.deadline <= Date.now() ? await alarm(WATCH + key) : await chrome.alarms.create(WATCH + key, { when: run.deadline });
  }
  async function closed(tabId) {
    let identity = await identify(tabId);
    identity && await finish(identity.key, [{ name: "\u586B\u5199\u540E\u6838\u5BF9\u901A\u8FC7", ok: !1, hint: "\u9884\u68C0\u6807\u7B7E\u9875\u88AB\u5173\u95ED\uFF0C\u672A\u5B8C\u6210\u6838\u5BF9\uFF1B\u8BF7\u4FDD\u6301 Chrome \u8FD0\u884C\u3002" }]);
  }
  return { schedule, alarm, handle, identify, abortAll, navigation, resume, closed };
}

// src/state.js
function manualCheckInState(occ, record, now = Date.now()) {
  return ["success", "success_manual", "unknown", "submitted_pending_confirmation", "launched", "pending"].includes(record?.state) ? record.state : record?.submissionKey || record?.submissionAttemptedAt ? "attempted" : occ.enabled === !1 ? "paused" : scheduleWeekStatus(occ, now) !== "active" ? "inactive_week" : occ.date !== todayMalaysia(new Date(now)) ? "wrong_day" : !Number.isFinite(occurrenceTimestamp(occ)) || now < occurrenceTimestamp(occ) ? "not_started" : canSubmitBeforeEnd(occ, now) ? "ready" : "ended";
}
var allowed = { scheduled: ["launched", "failed", "missed", "missed_sleep"], launched: ["pending", "failed", "missed", "missed_sleep"], pending: ["success", "failed", "unknown", "missed", "submitted_pending_confirmation"], submitted_pending_confirmation: ["success"], success: [], success_manual: [], failed: [], unknown: [], missed: [], missed_sleep: [] };
function transition(from, event) {
  if (event === "manual_submitted") {
    if (!["unknown", "submitted_pending_confirmation"].includes(from)) throw Error(`\u65E0\u6548\u72B6\u6001\u53D8\u66F4\uFF1A${from} \u2192 success`);
    return { state: "success_manual", at: (/* @__PURE__ */ new Date()).toISOString() };
  }
  let state = event === "timeout" ? "unknown" : event;
  if (!allowed[from]?.includes(state)) throw Error(`\u65E0\u6548\u72B6\u6001\u53D8\u66F4\uFF1A${from} \u2192 ${state}`);
  return { state, at: (/* @__PURE__ */ new Date()).toISOString() };
}
function dueAction(due, now, graceMs = WAKE_GRACE_MS) {
  return now < due ? "wait" : now - due <= graceMs ? "launch" : "missed";
}
function reserveSubmissionRecord(records, key, tabId, now = (/* @__PURE__ */ new Date()).toISOString()) {
  let record = records?.[key];
  if (!record || record.tabId !== tabId) throw Error("\u6253\u5361\u4EFB\u52A1\u4E0E\u5F53\u524D\u9875\u9762\u4E0D\u5339\u914D\u3002");
  if (record.submissionAttemptedAt || record.submissionKey) return { granted: !1, reason: "already_attempted", records };
  if (record.state !== "launched") return { granted: !1, reason: "already_in_progress", records };
  if (!canSubmitBeforeEnd(record.occ, Date.parse(now))) return { granted: !1, reason: "course_ended", records: { ...records, [key]: { ...record, ...transition(record.state, "missed"), phase: "completed", detail: "\u8BFE\u7A0B\u5DF2\u7ED3\u675F\u6216\u7ED3\u675F\u65F6\u95F4\u65E0\u6548\uFF0C\u672A\u63D0\u4EA4\u3002" } } };
  let phaseDurations = { ...record.phaseDurations || {} }, phaseStarted = Date.parse(record.phaseStartedAt || "");
  record.phase && Number.isFinite(phaseStarted) && (phaseDurations[record.phase] = (phaseDurations[record.phase] || 0) + Math.max(0, Date.parse(now) - phaseStarted));
  let next = { ...record, ...transition(record.state, "pending"), submissionKey: key, submissionAttemptedAt: now, phase: "submitting", phaseStartedAt: now, phaseDeadline: Date.parse(now) + PHASE_TIMEOUTS.submitting, phaseDurations };
  return { granted: !0, records: { ...records, [key]: next } };
}

// src/v1.0.5/background-outbox.js
function enqueue(snapshot = {}, action, payload, now = Date.now()) {
  let q = { version: snapshot.version || 0, items: [...snapshot.items || []] }, logical = action === "sync" ? "sync" : action === "event" ? `event:${payload.occurrenceKey}` : `${action}:${payload.sessionId}`;
  return action !== "sync" && q.items.some((item) => item.logical === logical) || (action === "sync" && (q.version = Math.max(q.version + 1, now), q.items = q.items.filter((item) => item.action !== "sync"), payload = { ...payload, version: q.version }), q.items.push({ id: crypto.randomUUID(), logical, action, payload, attempts: 0, availableAt: now })), q;
}
var acknowledge = (q, id) => ({ ...q, items: (q.items || []).filter((item) => item.id !== id), lastSuccessAt: (/* @__PURE__ */ new Date()).toISOString() });
function fail(q, id, error, now = Date.now()) {
  return { ...q, items: (q.items || []).map((item) => item.id !== id ? item : { ...item, attempts: item.attempts + 1, lastError: String(error).slice(0, 300), availableAt: now + Math.min(36e5, 15e3 * 2 ** Math.min(item.attempts, 8)) }) };
}
var nextReady = (q, now = Date.now()) => (q.items || []).find((item) => item.availableAt <= now);

// src/setup.js
var itemTerminal = (state) => ["passed", "failed", "cancelled", "timed_out"].includes(state);
function coverageRevision(course, binding, profile) {
  let plan = resolveFillPlan(binding, typeof course == "object" ? course : { course }, profile, todayMalaysia());
  if (!plan?.length) throw Error(`${moduleKey(typeof course == "object" ? course.course : course)} \u9700\u8981\u91CD\u65B0\u8BFB\u53D6\u5E76\u4FDD\u5B58\u8868\u5355\u9898\u76EE\u3002`);
  return JSON.stringify({ profile: { student: profile.student, name: profile.name, studentType: profile.studentType }, url: binding.url, title: binding.title, questions: binding.questions, mapping: binding.mapping, answers: plan.map((e) => e.type === "date" ? { ...e, value: "<today>" } : e) });
}
function buildVariants(tasks, bindings, profile) {
  let variants = /* @__PURE__ */ new Map();
  for (let task of tasks) {
    let course = task.course, binding = bindingForCourse(bindings, course), revision = coverageRevision(task, binding, profile), delivery = resolveFillPlan(binding, task, profile, todayMalaysia()).filter((e) => e.field.startsWith("delivery")).map((e) => e.value).join(" / "), key = JSON.stringify([moduleKey(course), String(course).trim().toUpperCase().replace(/\s+/g, " "), binding.url, delivery, revision]);
    variants.has(key) || variants.set(key, { id: crypto.randomUUID(), key, revision, course, type: task.type, delivery, state: "queued" });
  }
  if (!variants.size) throw Error("\u8BF7\u5148\u6DFB\u52A0\u8BFE\u7A0B\u5E76\u6838\u5BF9\u8868\u5355\u7ED1\u5B9A\u3002");
  if (variants.size > 200) throw Error("\u4E00\u6B21\u6700\u591A\u68C0\u67E5 200 \u4E2A\u8868\u5355\u8BFE\u578B\u3002");
  return [...variants.values()];
}
function updateItem(session, tabId, state, detail = "") {
  let item = session.items.find((row) => row.tabId === tabId);
  if (session.state !== "running" || !item || item.tabId !== tabId || itemTerminal(item.state)) throw Error("\u68C0\u67E5\u5DF2\u7ED3\u675F\u6216\u9875\u9762\u4E0D\u5339\u914D\u3002");
  if (!{ opening: ["filling", "failed", "cancelled", "timed_out"], filling: ["awaiting_confirmation", "failed", "cancelled", "timed_out"], awaiting_confirmation: ["failed", "cancelled", "timed_out"] }[item.state]?.includes(state)) throw Error("\u65E0\u6548\u7684\u8BBE\u7F6E\u68C0\u67E5\u72B6\u6001\u3002");
  return { ...session, items: session.items.map((row) => row === item ? { ...row, state, detail: String(detail).slice(0, 500), at: (/* @__PURE__ */ new Date()).toISOString() } : row) };
}
function confirmItem(session, tabId, revision) {
  let item = session.items.find((row) => row.tabId === tabId);
  if (session.state !== "running" || item?.tabId !== tabId || item.state !== "awaiting_confirmation" || item.revision !== revision) throw Error("\u68C0\u67E5\u672A\u5C31\u7EEA\u6216\u914D\u7F6E\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u68C0\u67E5\u3002");
  return { ...session, items: session.items.map((row) => row === item ? { ...row, state: "passed", confirmedAt: (/* @__PURE__ */ new Date()).toISOString() } : row) };
}

// src/settings-sender.js
function isPageSender(sender, page, runtime) {
  if (!sender || sender.id && sender.id !== runtime.id) return !1;
  try {
    let url = new URL(sender.url || sender.documentUrl || sender.tab?.url || "");
    return url.hash = "", url.search = "", url.href === runtime.getURL(page);
  } catch {
    return !1;
  }
}
function isSettingsSender(sender, runtime = chrome.runtime) {
  return isPageSender(sender, "options.html", runtime);
}
function isPopupSender(sender, runtime = chrome.runtime) {
  return isPageSender(sender, "popup.html", runtime);
}

// src/setup-coordinator.js
function setupCoordinator(enqueueCloud2) {
  let read = () => chrome.storage.local.get(["attendanceSetupSession", "attendanceSetupHistory", "attendanceSessions", "attendanceDraft", "attendanceBindings", "attendanceProfile"]);
  async function save(session) {
    let { attendanceSetupHistory: history = [] } = await read(), values = { attendanceSetupSession: session, attendanceSetupHistory: [...history.filter((s) => s.id !== session.id), session] };
    return session.state === "completed" && !session.summaryEnqueued ? (session = { ...session, summaryEnqueued: !0 }, values.attendanceSetupSession = session, values.attendanceSetupHistory = values.attendanceSetupHistory.map((s) => s.id === session.id ? session : s), await enqueueCloud2("setup-summary", { sessionId: session.id, count: session.items.length, passed: session.items.filter((i) => i.state === "passed").length }, values)) : await chrome.storage.local.set(values), session;
  }
  async function advance(session) {
    if (session.state !== "running") return session;
    for (let n = 0; n < session.items.length; n++) {
      if (session.items[n].state !== "queued") continue;
      let item = { ...session.items[n], state: "opening", deadline: Date.now() + 6e5 };
      session = { ...session, items: session.items.map((i, index) => index === n ? item : i) }, await save(session);
      try {
        let data = await read(), binding = bindingForCourse(data.attendanceBindings, item.course);
        if (coverageRevision(item, binding, data.attendanceProfile) !== item.revision) throw Error("\u914D\u7F6E\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u68C0\u67E5\u3002");
        let url = validateFormsUrl(binding.url);
        url.hash = new URLSearchParams({ attendanceSetup: session.id, attendanceItem: item.id }).toString();
        let tab = await chrome.tabs.create({ url: url.href, active: !1 });
        item = { ...item, tabId: tab.id }, session = { ...session, items: session.items.map((i, index) => index === n ? item : i) }, await save(session);
      } catch (error) {
        session = { ...session, items: session.items.map((i, index) => index === n ? { ...i, state: "failed", detail: error.message } : i) }, await save(session);
      }
    }
    let pending = session.items.filter((i) => !itemTerminal(i.state));
    return pending.length ? (await chrome.alarms.create(`attendance-setup:${session.id}`, { when: Math.min(...pending.map((i) => i.deadline)) }), session) : (await chrome.alarms.clear(`attendance-setup:${session.id}`), save({ ...session, state: "completed", completedAt: (/* @__PURE__ */ new Date()).toISOString() }));
  }
  async function handle(message, sender) {
    let data = await read(), session = data.attendanceSetupSession;
    if (message.type === "START_SETUP") {
      if (!isSettingsSender(sender)) throw Error("\u8BF7\u4ECE\u6269\u5C55\u8BBE\u7F6E\u9875\u5F00\u59CB\u68C0\u67E5\u3002");
      if (session?.state === "running") throw Error("\u5DF2\u6709\u8BFE\u578B\u68C0\u67E5\u8FDB\u884C\u4E2D\uFF0C\u8BF7\u5148\u5B8C\u6210\u6216\u53D6\u6D88\u5F53\u524D\u68C0\u67E5\uFF0C\u518D\u5F00\u59CB\u65B0\u7684\u68C0\u67E5\u3002");
      let intended = [...data.attendanceSessions || [], ...data.attendanceDraft?.rows || []].filter((row) => !message.moduleKey || moduleKey(row.course) === message.moduleKey);
      return session = { id: crypto.randomUUID(), state: "running", current: 0, startedAt: (/* @__PURE__ */ new Date()).toISOString(), items: buildVariants(intended, data.attendanceBindings, data.attendanceProfile) }, { session: await advance(await save(session)) };
    }
    if (!session || session.state !== "running") throw Error("\u6CA1\u6709\u6B63\u5728\u8FDB\u884C\u7684\u8BBE\u7F6E\u68C0\u67E5\u3002");
    if (message.type === "CANCEL_SETUP") {
      if (!isSettingsSender(sender)) throw Error("\u8BF7\u4ECE\u6269\u5C55\u8BBE\u7F6E\u9875\u53D6\u6D88\u68C0\u67E5\u3002");
      return await chrome.alarms.clear(`attendance-setup:${session.id}`), { session: await save({ ...session, state: "cancelled", cancelledAt: (/* @__PURE__ */ new Date()).toISOString(), items: session.items.map((i) => itemTerminal(i.state) ? i : { ...i, state: "cancelled", detail: "\u5B66\u751F\u53D6\u6D88\u68C0\u67E5\uFF0C\u672A\u63D0\u4EA4\u3002" }) }) };
    }
    if (message.type === "CONFIRM_ALL_SETUP_ITEMS") {
      if (!isSettingsSender(sender)) throw Error("\u8BF7\u4ECE\u6269\u5C55\u8BBE\u7F6E\u9875\u786E\u8BA4\u5168\u90E8\u8BFE\u578B\u3002");
      let incomplete = session.items.filter((i) => !["awaiting_confirmation", "passed"].includes(i.state));
      if (incomplete.length) throw Error(`\u8FD8\u6709 ${incomplete.length} \u4E2A\u8BFE\u578B\u5C1A\u672A\u586B\u5199\u5B8C\u6210\uFF0C\u8BF7\u7B49\u5F85\u68C0\u67E5\u9875\u51C6\u5907\u597D\u3002`);
      if (!session.items.some((i) => i.state === "awaiting_confirmation")) throw Error("\u6CA1\u6709\u7B49\u5F85\u786E\u8BA4\u7684\u8BFE\u578B\u3002");
      for (let item2 of session.items) {
        let binding2 = bindingForCourse(data.attendanceBindings, item2.course);
        if (coverageRevision(item2, binding2, data.attendanceProfile) !== item2.revision) throw Error(`\u914D\u7F6E\u5DF2\u53D8\u5316\uFF1A${item2.course}\uFF0C\u8BF7\u91CD\u65B0\u6D4B\u8BD5\u3002`);
      }
      let confirmedAt = (/* @__PURE__ */ new Date()).toISOString();
      return await chrome.alarms.clear(`attendance-setup:${session.id}`), session = { ...session, state: "completed", completedAt: confirmedAt, items: session.items.map((item2) => item2.state === "passed" ? item2 : { ...item2, state: "passed", confirmedAt }) }, { session: await save(session) };
    }
    let item = session.items.find((i) => i.id === message.itemId);
    if (message.sessionId !== session.id || !item || !Number.isInteger(sender.tab?.id) || sender.tab.id !== item.tabId) throw Error("\u8BBE\u7F6E\u68C0\u67E5\u4E0E\u5F53\u524D\u9875\u9762\u4E0D\u5339\u914D\u3002");
    let binding = bindingForCourse(data.attendanceBindings, item.course);
    if (message.type === "REPORT_SETUP_ITEM" && message.state === "failed")
      session = updateItem(session, item.tabId, "failed", message.detail);
    else {
      let revision = coverageRevision(item, binding, data.attendanceProfile);
      if (revision !== item.revision)
        throw await advance(await save(updateItem(session, item.tabId, "failed", "\u914D\u7F6E\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u68C0\u67E5\u3002"))), Error("\u914D\u7F6E\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u68C0\u67E5\u3002");
      if (message.type === "GET_SETUP_ITEM") {
        if (!["opening", "filling", "awaiting_confirmation"].includes(item.state)) throw Error("\u8BE5\u9875\u9762\u5DF2\u5F00\u59CB\u6216\u5B8C\u6210\u68C0\u67E5\u3002");
        return item.state === "opening" && await save(updateItem(session, item.tabId, "filling")), { course: item.course, type: item.type, binding, profile: data.attendanceProfile, revision: item.revision };
      }
      if (message.type === "CONFIRM_SETUP_ITEM") session = confirmItem(session, item.tabId, revision);
      else {
        if (message.type === "REPORT_SETUP_ITEM" && message.state === "awaiting_confirmation" && item.state === "awaiting_confirmation") return { session };
        if (message.type === "REPORT_SETUP_ITEM") session = updateItem(session, item.tabId, message.state, message.detail);
        else throw Error("\u672A\u77E5\u68C0\u67E5\u64CD\u4F5C\u3002");
      }
    }
    let result = { session: await advance(await save(session)) };
    return message.type === "CONFIRM_SETUP_ITEM" && setTimeout(() => void chrome.tabs.remove(item.tabId).catch(() => {
    }), 500), result;
  }
  async function resume() {
    let { attendanceSetupSession: session } = await read();
    if (session?.state === "running") {
      for (let item of session.items) {
        if (item.state === "queued" || itemTerminal(item.state)) continue;
        let state;
        if (item.deadline <= Date.now()) state = "timed_out";
        else
          try {
            await chrome.tabs.get(item.tabId);
          } catch {
            state = "cancelled";
          }
        state && (session = updateItem(session, item.tabId, state, state === "timed_out" ? "\u68C0\u67E5\u8D85\u65F6\uFF0C\u672A\u901A\u8FC7\uFF1B\u8BF7\u68C0\u67E5\u5B66\u6821\u767B\u5F55\u3002" : "\u68C0\u67E5\u9875\u9762\u5DF2\u5173\u95ED\uFF0C\u672A\u901A\u8FC7\u3002"));
      }
      return advance(await save(session));
    }
  }
  async function closed(tabId) {
    let { attendanceSetupSession: session } = await read();
    if (!(session?.state !== "running" || !session.items.some((i) => i.tabId === tabId && !itemTerminal(i.state))))
      return advance(await save(updateItem(session, tabId, "cancelled", "\u68C0\u67E5\u9875\u9762\u5DF2\u5173\u95ED\uFF0C\u672A\u901A\u8FC7\u3002")));
  }
  return { handle, resume, closed };
}

// src/configuration.js
function validateSession(input) {
  if (!input || !["weekly", "dated"].includes(input.kind)) throw Error("\u4EFB\u52A1\u7C7B\u578B\u65E0\u6548\u3002");
  if (input.kind === "weekly" && (!Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6)) throw Error("\u6BCF\u5468\u661F\u671F\u987B\u4E3A 0\u20136 \u7684\u6574\u6570\u3002");
  if (input.kind === "dated" && !normalizeDate(input.date)) throw Error("\u4EFB\u52A1\u65E5\u671F\u65E0\u6548\u3002");
  let row = { ...toWeeklySession(input), course: String(input.course || "").trim(), type: String(input.type || "").trim() };
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{1,63}$/.test(row.course)) throw Error("\u8BFE\u7A0B\u540D\u79F0\u987B\u4E3A 2\u201364 \u4E2A\u82F1\u6587\u5B57\u6BCD\u3001\u6570\u5B57\u3001\u7A7A\u683C\u3001\u4E0B\u5212\u7EBF\u6216\u8FDE\u5B57\u7B26\u3002");
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.time) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.endTime) || row.endTime <= row.time) throw Error(`${row.course} \u7684\u8D77\u6B62\u65F6\u95F4\u65E0\u6548\u3002`);
  if (!Array.isArray(input.exceptions || []) || (input.exceptions || []).length > 366) throw Error("\u505C\u8BFE\u65E5\u671F\u683C\u5F0F\u65E0\u6548\u3002");
  if (row.exceptions = [...new Set((input.exceptions || []).map(normalizeDate))].sort(), row.exceptions.some((d) => !d)) throw Error(`${row.course} \u7684\u505C\u8BFE\u65E5\u671F\u65E0\u6548\u3002`);
  if (input.enabled !== void 0 && typeof input.enabled != "boolean") throw Error("\u4EFB\u52A1\u542F\u7528\u72B6\u6001\u65E0\u6548\u3002");
  return row;
}

// src/v1.0.5/background-backup.js
var terminal = (state) => ["success", "success_manual", "failed", "unknown", "missed", "missed_sleep", "submitted_pending_confirmation"].includes(state);
function validateBackup(input) {
  if (!input || typeof input != "object" || Array.isArray(input) || input.format !== "soton-attendance-configuration" || input.version !== 1) throw Error("\u4E0D\u662F\u652F\u6301\u7684 Attendance \u914D\u7F6E\u5907\u4EFD\u3002");
  let allowed2 = ["format", "version", "exportedAt", "profile", "bindings", "sessions", "records"];
  if (Object.keys(input).some((k) => !allowed2.includes(k))) throw Error("\u5907\u4EFD\u5305\u542B\u4E0D\u652F\u6301\u7684\u5B57\u6BB5\u6216\u51ED\u8BC1\uFF0C\u672A\u5BFC\u5165\u3002");
  if (!Array.isArray(input.sessions) || input.sessions.length > 200 || !input.bindings || typeof input.bindings != "object" || Array.isArray(input.bindings) || !input.records || typeof input.records != "object" || Array.isArray(input.records)) throw Error("\u5907\u4EFD\u7ED3\u6784\u65E0\u6548\u3002");
  if (input.profile && (!/^(local|international)$/.test(input.profile.studentType) || typeof input.profile.student != "string" || !input.profile.student.trim() || input.profile.student.length > 50 || typeof input.profile.name != "string" || !input.profile.name.trim() || input.profile.name.length > 100 || Object.keys(input.profile).some((k) => !["student", "name", "studentType"].includes(k)))) throw Error("\u5907\u4EFD\u5B66\u751F\u8D44\u6599\u65E0\u6548\u3002");
  let ids = /* @__PURE__ */ new Set();
  for (let row of input.sessions) {
    if (validateSession(row), typeof row.id != "string" || !row.id || ids.has(row.id)) throw Error("\u5907\u4EFD\u4EFB\u52A1 ID \u65E0\u6548\u6216\u91CD\u590D\u3002");
    if (ids.add(row.id), Object.keys(row).some((k) => !["id", "kind", "course", "weekday", "time", "endTime", "exceptions", "enabled"].includes(k))) throw Error("\u5907\u4EFD\u4EFB\u52A1\u5305\u542B\u4E0D\u652F\u6301\u7684\u72B6\u6001\u3002");
  }
  if (Object.keys(input.bindings).length > 200) throw Error("\u5907\u4EFD\u7ED1\u5B9A\u6570\u91CF\u8FC7\u591A\u3002");
  for (let [key, b] of Object.entries(input.bindings)) {
    if (["__proto__", "constructor", "prototype"].includes(key) || !b || typeof b != "object" || typeof b.title != "string" || b.title.length > 500 || typeof b.verified != "boolean") throw Error("\u5907\u4EFD\u8868\u5355\u7ED1\u5B9A\u65E0\u6548\u3002");
    if (validateFormsUrl(b.url), Object.keys(b).some((k) => !["scope", "url", "title", "questions", "mapping", "verified"].includes(k))) throw Error("\u5907\u4EFD\u7ED1\u5B9A\u5305\u542B\u4E0D\u652F\u6301\u7684\u5B57\u6BB5\u3002");
    if (b.questions !== void 0 && (!Array.isArray(b.questions) || b.questions.length > 100 || !verifyQuestions(b.questions, b.mapping) || b.questions.some((q) => !["text", "radio", "date"].includes(q.type)))) throw Error("\u5907\u4EFD\u8868\u5355\u9898\u76EE\u65E0\u6548\u3002");
  }
  if (Object.keys(input.records).length > 1e4) throw Error("\u5907\u4EFD\u8BB0\u5F55\u6570\u91CF\u8FC7\u591A\u3002");
  for (let r of Object.values(input.records)) {
    if (!r || !terminal(r.state) || !r.occ || !normalizeDate(r.occ.date) || typeof r.occ.key != "string" || !r.occ.key || typeof r.at != "string" || !Number.isFinite(Date.parse(r.at))) throw Error("\u5907\u4EFD\u53EA\u80FD\u5305\u542B\u6709\u6548\u7684\u5DF2\u7ED3\u675F\u8BB0\u5F55\u3002");
    if (r.formUrl && validateFormsUrl(r.formUrl), Object.keys(r).some((k) => !["state", "at", "detail", "formUrl", "occ"].includes(k))) throw Error("\u5907\u4EFD\u5305\u542B\u8FD0\u884C\u4E2D\u72B6\u6001\uFF0C\u672A\u5BFC\u5165\u3002");
  }
  return input;
}
function restoreBackup(input, current, now = (/* @__PURE__ */ new Date()).toISOString()) {
  let b = validateBackup(input), records = {};
  for (let r of Object.values(b.records)) records[r.occ.key] = r;
  for (let r of Object.values(current.attendanceRecords || {})) r.occ?.key && (records[r.occ.key] = r);
  return { attendanceProfile: b.profile || {}, attendanceBindings: b.bindings, attendanceSessions: b.sessions.map((s) => ({ ...validateSession(s), createdAt: now, enabled: !1 })), attendanceRecords: records, attendanceScheduleMode: "weekly", attendanceDraft: { version: 1, rows: [], reviewedAt: null }, attendanceSetupCoverageEpoch: now, attendanceSetupSession: null };
}

// src/reliability.js
var PHASE_ERRORS = Object.freeze({ opening: "\u9875\u9762\u672A\u5728 90 \u79D2\u5185\u52A0\u8F7D\u3002", reading: "\u5185\u5BB9\u811A\u672C\u672A\u54CD\u5E94\u6216\u8868\u5355\u672A\u5728 90 \u79D2\u5185\u5C31\u7EEA\u3002", checking: "\u8868\u5355\u6838\u5BF9\u9636\u6BB5\u8D85\u65F6\u3002", filling: "\u8868\u5355\u586B\u5199\u9636\u6BB5\u8D85\u65F6\u3002", submitting: "\u627E\u4E0D\u5230\u63D0\u4EA4\u6309\u94AE\u6216\u63D0\u4EA4\u9636\u6BB5\u8D85\u65F6\u3002", confirming: "\u5DF2\u70B9\u51FB\u63D0\u4EA4\uFF0C\u4F46\u672A\u6536\u5230\u660E\u786E\u6210\u529F\u53CD\u9988\u3002" });
function isSchoolLoginOrPermissionUrl(value) {
  try {
    let url = new URL(String(value)), host = url.hostname.toLowerCase(), path = `${url.pathname}${url.search}`.toLowerCase();
    return ["login.microsoftonline.com", "login.live.com", "account.live.com"].includes(host) || /access_denied|unauthori[sz]ed|sign[-_]?in|login/.test(path);
  } catch {
    return !1;
  }
}
function redactDiagnostic(value) {
  return String(value || "").replace(/https?:\/\/\S+/gi, "[url]").replace(/\b\d{6,}\b/g, "[redacted]").slice(0, 500);
}

// src/diagnostics.js
var reasons = {
  date_picker_today_not_found: ["\u65E5\u671F\u63A7\u4EF6\u672A\u80FD\u6253\u5F00\u3002", "\u65E5\u671F\u63A7\u4EF6\u672A\u80FD\u6253\u5F00\uFF0C\u5DF2\u6539\u7528\u76F4\u63A5\u8F93\u5165\u6216\u5207\u5230\u524D\u53F0\u91CD\u8BD5\uFF1B\u4ECD\u5931\u8D25\u8BF7\u70B9\u590D\u5236\u8BCA\u65AD"],
  date_readback_mismatch: ["\u65E5\u671F\u56DE\u8BFB\u503C\u4E0D\u4E00\u81F4\u6216\u65E5\u671F\u9898\u6821\u9A8C\u5931\u8D25\u3002", "\u8BF7\u6253\u5F00\u539F\u8868\u5355\u68C0\u67E5\u65E5\u671F\u9898\u7684\u503C\u4E0E\u6821\u9A8C\u63D0\u793A\uFF0C\u5E76\u590D\u5236\u8BCA\u65AD\u3002"],
  test_authorization_expired: ["\u6D4B\u8BD5\u6388\u6743\u5DF2\u8FC7\u671F\u3002", "\u6D4B\u8BD5\u6388\u6743\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u70B9\u51FB\u7ACB\u5373\u6D4B\u8BD5\u6253\u5361"],
  date_fill_hidden_tab: ["\u540E\u53F0\u6807\u7B7E\u9875\u65E5\u671F\u586B\u5199\u5931\u8D25\uFF0C\u672A\u63D0\u4EA4\u3002", "\u5141\u8BB8\u524D\u53F0\u56DE\u9000\u65F6\u5C06\u77ED\u6682\u5207\u5230\u6253\u5361\u9875\u91CD\u8BD5\uFF1B\u5426\u5219\u8BF7\u624B\u52A8\u6838\u67E5\u65E5\u671F\u3002"],
  submission_error: ["Forms \u8FD4\u56DE\u63D0\u4EA4\u9519\u8BEF\uFF0C\u672A\u786E\u8BA4\u8BB0\u5F55\u3002", "\u8BF7\u68C0\u67E5\u5B66\u6821\u8868\u5355\u4E0E\u7F51\u7EDC\uFF1B\u7CFB\u7EDF\u4E0D\u4F1A\u81EA\u52A8\u91CD\u4EA4\uFF0C\u6838\u67E5\u8BB0\u5F55\u540E\u7531\u4F60\u51B3\u5B9A\u662F\u5426\u624B\u52A8\u63D0\u4EA4\u3002"],
  course_kind_unknown: ["\u7F3A\u5C11\u8BFE\u578B\uFF08LEC/TUT/LAB\uFF09\u3002", "\u8BF7\u5728\u8BFE\u8868\u4E2D\u8865\u5168\u8BFE\u578B\uFF0C\u4F8B\u5982 {course}-LEC\uFF0C\u7136\u540E\u91CD\u65B0\u68C0\u67E5\u3002"],
  form_schema_changed: ["\u8868\u5355\u9898\u76EE\u3001\u6807\u9898\u6216\u9009\u9879\u53D1\u751F\u53D8\u5316\u3002", "\u8BF7\u91CD\u65B0\u8BFB\u53D6\u5E76\u4FDD\u5B58\u6B64\u8BFE\u7A0B\u7684\u8868\u5355\u9898\u76EE\uFF0C\u518D\u6838\u5BF9\u6620\u5C04\u3002"],
  login_required: ["\u9700\u8981\u767B\u5F55\u5B66\u6821\u8D26\u53F7\u6216\u53D6\u5F97\u8868\u5355\u8BBF\u95EE\u6743\u9650\u3002", "\u8BF7\u6253\u5F00\u539F\u8868\u5355\u767B\u5F55\u5B66\u6821 Microsoft \u8D26\u53F7\uFF0C\u5E76\u786E\u8BA4\u8BBF\u95EE\u6743\u9650\u3002"],
  phase_timeout: ["\u6B64\u9636\u6BB5\u7B49\u5F85\u8D85\u65F6\u3002", "\u8BF7\u68C0\u67E5\u7F51\u7EDC\u548C\u5B66\u6821\u767B\u5F55\u72B6\u6001\uFF0C\u518D\u6253\u5F00\u539F\u8868\u5355\u68C0\u67E5\u3002"],
  date_mismatch: ["\u8BFE\u7A0B\u65E5\u671F\u4E0E\u5F53\u524D\u65E5\u671F\u6216\u8868\u5355\u65E5\u671F\u4E0D\u4E00\u81F4\u3002", "\u8BF7\u68C0\u67E5\u8BFE\u8868\u65E5\u671F\u3001\u7535\u8111\u65E5\u671F\u4E0E\u65F6\u533A\uFF0C\u5E76\u6838\u5BF9\u8868\u5355\u65E5\u671F\u3002"],
  answer_mismatch: ["\u586B\u5199\u540E\u7684\u7B54\u6848\u672A\u901A\u8FC7\u6838\u5BF9\u3002", "\u8BF7\u6253\u5F00\u539F\u8868\u5355\uFF0C\u68C0\u67E5\u7B54\u6848\u3001\u5FC5\u586B\u9879\u548C\u9898\u76EE\u6620\u5C04\u3002"],
  submit_unconfirmed: ["\u5DF2\u5C1D\u8BD5\u63D0\u4EA4\uFF0C\u4F46\u6CA1\u6709\u6536\u5230\u660E\u786E\u6210\u529F\u53CD\u9988\u3002", "\u8BF7\u6253\u5F00\u539F\u8868\u5355\u68C0\u67E5\u7ED3\u679C\uFF1B\u786E\u8BA4\u524D\u4E0D\u8981\u91CD\u590D\u63D0\u4EA4\uFF0C\u53EF\u5728\u8BB0\u5F55\u4E2D\u624B\u52A8\u6807\u8BB0\u5DF2\u63D0\u4EA4\u3002"],
  course_ended: ["\u8BFE\u7A0B\u5DF2\u7ED3\u675F\u6216\u7ED3\u675F\u65F6\u95F4\u65E0\u6548\uFF0C\u672A\u63D0\u4EA4\u3002", "\u8BF7\u68C0\u67E5\u8BFE\u8868\u8D77\u6B62\u65F6\u95F4\uFF0C\u5E76\u624B\u52A8\u5904\u7406\u672C\u6B21\u6253\u5361\u3002"],
  schedule_week_inactive: ["\u8BFE\u8868\u5468\u672A\u5206\u914D\u3001\u672A\u5F00\u59CB\u6216\u5DF2\u8FC7\u671F\uFF0C\u672A\u63D0\u4EA4\u3002", "\u8BF7\u660E\u786E\u5206\u914D\u672C\u5468\u6216\u4E0B\u5468\u8BFE\u8868\uFF1B\u7CFB\u7EDF\u4E0D\u4F1A\u81EA\u52A8\u7EED\u671F\u3002"],
  configuration_changed: ["\u6253\u5361\u914D\u7F6E\u7F3A\u5931\u6216\u5DF2\u53D8\u5316\u3002", "\u8BF7\u4FDD\u5B58\u4E2A\u4EBA\u8D44\u6599\uFF0C\u5E76\u91CD\u65B0\u6838\u5BF9\u6B64\u8BFE\u7A0B\u7684\u8BFE\u8868\u548C\u5171\u7528\u8868\u5355\u3002"],
  phase_failed: ["\u6B64\u9636\u6BB5\u6267\u884C\u5931\u8D25\u3002", "\u8BF7\u6253\u5F00\u539F\u8868\u5355\u68C0\u67E5\uFF0C\u5E76\u590D\u5236\u8BCA\u65AD\u4FE1\u606F\u7ED9\u5F00\u53D1\u8005\u3002"]
}, ERROR_CODES = Object.freeze(Object.keys(reasons));
function diagnosticPhase(phase) {
  let canonical = { checking: "validate", filling: "fill", submitting: "submit", confirming: "submit" }[phase] || phase;
  return ["validate", "fill", "submit", "opening", "reading"].includes(canonical) ? canonical : "validate";
}
function runError(error = {}, context = {}) {
  let message = typeof error == "string" ? error : error?.message || "", code = error?.code;
  code || (code = /缺少课型|无法判断.*课程类型/.test(message) ? "course_kind_unknown" : /登录|权限/.test(message) ? "login_required" : /日期.*不一致|日期.*变化/.test(message) ? "date_mismatch" : /答案|填写/.test(message) ? "answer_mismatch" : /schema_changed|题目|题型|标题|选项|表单.*不一致/.test(message) ? "form_schema_changed" : /超时/.test(message) ? "phase_timeout" : /配置|绑定|任务已/.test(message) ? "configuration_changed" : "phase_failed");
  let guidance = reasons[code] || reasons.phase_failed, course = String(context.course || error.course || "\u672A\u77E5\u8BFE\u7A0B"), kind = resolveCourseKind({ course, type: context.type }), variant = { lecture: "LEC", tutorial: "TUT", lab: "LAB" }[kind], reason = message || guidance[0];
  return { code, course, phase: diagnosticPhase(context.phase || error.phase), message: variant && !reason.includes("\uFF08\u8BFE\u578B\uFF1A") ? `${reason}\uFF08\u8BFE\u578B\uFF1A${variant}\uFF09` : reason, hint: guidance[1].replaceAll("{course}", course) };
}
function formatRunError(error) {
  let phase = { validate: "\u6821\u9A8C", fill: "\u586B\u5199", submit: "\u63D0\u4EA4", opening: "\u6253\u5F00\u8868\u5355", reading: "\u8BFB\u53D6\u8868\u5355" }[error.phase] || error.phase;
  return `${error.course} \xB7 ${phase}\uFF1A${error.message}
\u4E0B\u4E00\u6B65\uFF1A${error.hint}`;
}
function createDiagnostic(input = {}, profile = {}) {
  let secrets = [profile.student, profile.name].filter(Boolean).map(String).sort((a, b) => b.length - a.length), safe = (value) => {
    let text = String(value || "");
    for (let secret of secrets) text = text.split(secret).join("[redacted]");
    return redactDiagnostic(text);
  }, durations = { validate: 0, fill: 0, submit: 0 };
  for (let [phase, ms] of Object.entries(input.phaseDurations || {})) if (["validate", "fill", "submit", "opening", "reading", "checking", "filling", "submitting", "confirming"].includes(phase) && Number.isFinite(ms) && ms >= 0) {
    let key = diagnosticPhase(phase);
    durations[key] = (durations[key] || 0) + ms;
  }
  let course = safe(input.course || input.occ?.course), type = safe(input.type || input.occ?.type), error = input.error ? runError(input.error, { course, type, phase: input.error.phase || input.phase }) : null;
  if (error) for (let key of ["course", "message", "hint"]) error[key] = safe(error[key]);
  let timestamp = Date.parse(input.at || "");
  return {
    version: 1,
    at: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : (/* @__PURE__ */ new Date()).toISOString(),
    course,
    state: safe(input.state),
    phaseDurations: durations,
    courseKind: { course, type, resolved: resolveCourseKind({ course, type }), source: resolveCourseKind({ type }) ? "type" : resolveCourseKind({ course }) ? "course" : null },
    questionTitles: (input.questionTitles || []).slice(0, 100).map((q) => ({ before: safe(q.before), after: safe(q.after) })),
    error,
    ...typeof (input.key || input.occ?.key) == "string" ? { key: safe(input.key || input.occ.key) } : {},
    ...["already-set", "native", "goToday", "today-cell", "calendar", "foreground"].includes(input.dateFillPath) ? { dateFillPath: input.dateFillPath } : {},
    ...Array.isArray(input.dateDiag) ? { dateDiag: input.dateDiag.slice(-40).map((row) => ({ inBackground: row?.inBackground === !0, rectCount: Number.isSafeInteger(row?.rectCount) && row.rectCount >= 0 ? row.rectCount : 0, step: safe(row?.step), count: Number.isSafeInteger(row?.count) && row.count > 0 ? row.count : 1, ...typeof row?.disabled == "boolean" ? { disabled: row.disabled } : {}, ...typeof row?.text == "string" ? { text: safe(row.text).slice(0, 20) } : {}, ...["already-set", "native", "goToday", "today-cell"].includes(row?.path) ? { path: row.path } : {}, ...["visible", "hidden", "prerender"].includes(row?.visibilityState) ? { visibilityState: row.visibilityState } : {} })) } : {},
    ...Array.isArray(input.successPage) ? { successPage: input.successPage.slice(0, 100).map((row) => Object.fromEntries(["data-automation-id", "role", "aria-label", "title"].filter((key) => typeof row?.[key] == "string").map((key) => [key, safe(row[key]).slice(0, 250)]))) } : {}
  };
}

// src/test-mode.js
function testFormIdentity(value) {
  let url = validateFormsUrl(value);
  return { host: url.hostname.toLowerCase(), formId: url.searchParams.get("id") || url.pathname.match(/^\/r\/([\w-]+)/)?.[1] };
}
function testFormAllowed(binding, allowlist = []) {
  if (binding?.isTest !== !0 || !Array.isArray(allowlist)) return !1;
  try {
    let identity = testFormIdentity(binding.url);
    return allowlist.some((entry) => entry?.host === identity.host && entry?.formId === identity.formId);
  } catch {
    return !1;
  }
}

// src/background.js
var NEXT = "attendance-next", MAINTENANCE = "attendance-maintenance", CLOUD = "attendance-cloud", cloudEnabled = () => !!chrome.runtime?.id, queue = Promise.resolve(), serialized = (fn) => {
  let next = queue.then(fn, fn);
  return queue = next.catch(() => {
  }), next;
}, daysFrom = (date, offset) => {
  let d = /* @__PURE__ */ new Date(`${date}T00:00:00Z`);
  return d.setUTCDate(d.getUTCDate() + offset), d.toISOString().slice(0, 10);
};
async function load() {
  let data = await chrome.storage.local.get(["attendanceSessions", "attendanceBindings", "attendanceProfile", "attendanceRecords", "attendanceScheduleMode"]);
  {
    let sessions = (data.attendanceSessions || []).map(toWeeklySession);
    (data.attendanceScheduleMode !== "weekly" || JSON.stringify(sessions) !== JSON.stringify(data.attendanceSessions || [])) && await chrome.storage.local.set({ attendanceSessions: sessions, attendanceScheduleMode: "weekly" }), data.attendanceSessions = sessions;
  }
  return data;
}
var saveRecords = (records) => chrome.storage.local.set({ attendanceRecords: records }), awakeCount = 0;
async function syncKeepAwake(recordsOverride) {
  if (!chrome.power) return;
  let { keepAwakeEnabled = !1, attendanceSessions: sessions = [], attendanceRecords: stored = {} } = await chrome.storage.local.get(["keepAwakeEnabled", "attendanceSessions", "attendanceRecords"]);
  if (await chrome.alarms.clear("attendance-power"), !keepAwakeEnabled || !await chrome.permissions.contains({ permissions: ["power"] })) {
    awakeCount && chrome.power.releaseKeepAwake(), awakeCount = 0;
    return;
  }
  let records = recordsOverride || stored, now = Date.now(), count = 0, next = 1 / 0;
  for (let occ of occurrencesBetween(sessions, todayMalaysia(), daysFrom(todayMalaysia(), 32))) {
    if (records[occ.key] && !["scheduled", "launched", "pending"].includes(records[occ.key].state)) continue;
    let trigger = triggerTimestamp(occ), start = trigger - 600 * 1e3, end = courseEndTimestamp(occ);
    !Number.isFinite(end) || trigger < Date.parse(occ.createdAt || "1970-01-01") || end <= now || (start > now ? next = Math.min(next, start) : (count++, next = Math.min(next, end)));
  }
  count && !awakeCount && chrome.power.requestKeepAwake("system"), !count && awakeCount && chrome.power.releaseKeepAwake(), awakeCount = count, Number.isFinite(next) && await chrome.alarms.create("attendance-power", { when: next });
}
async function healthSnapshot() {
  let { attendanceSessions: sessions = [], attendanceRecords: records = {} } = await chrome.storage.local.get(["attendanceSessions", "attendanceRecords"]), login = Object.values(records).filter((record) => record.preflight).sort((a, b) => Date.parse(b.preflight.at) - Date.parse(a.preflight.at))[0]?.preflight.checks?.find((check) => check.name.includes("\u767B\u5F55")), today = todayMalaysia(), now = Date.now(), next = occurrencesBetween(sessions, today, daysFrom(today, 32)).map((occ) => ({ occ, timestamp: triggerTimestamp(occ) })).filter(({ occ, timestamp }) => (!records[occ.key] || records[occ.key].state === "scheduled") && timestamp > now && timestamp >= Date.parse(occ.createdAt || "1970-01-01")).sort((a, b) => a.timestamp - b.timestamp)[0];
  return { notifications: await chrome.notifications.getPermissionLevel() === "granted", loggedIn: login?.ok ?? null, nextRun: next?.timestamp ?? null, version: chrome.runtime.getManifest().version };
}
async function enqueueCloud(action, payload, extra = {}) {
  if (!cloudEnabled()) return chrome.storage.local.set(extra);
  if (action === "sync") {
    let state = await chrome.storage.local.get(["attendanceCloudSetupChoice", "attendanceCloudDeviceId", "attendanceCloudToken"]), choice = state.attendanceCloudSetupChoice, recovering = ["recovery-starting", "recovery-pending", "recovery-verifying", "recovery-outcome-unknown", "recovery-finalizing"].includes(choice), cloudChosen = !!(state.attendanceCloudDeviceId && state.attendanceCloudToken) || choice === "new" || choice === "recovered";
    if (recovering || !cloudChosen || choice === "recovered" && !payload?.schedules?.length) return chrome.storage.local.set(extra);
  }
  let { attendanceCloudOutbox: q = {} } = await chrome.storage.local.get("attendanceCloudOutbox"), next = enqueue(q, action, payload);
  await chrome.storage.local.set({ ...extra, attendanceCloudOutbox: next }), await chrome.alarms.create(CLOUD, { when: Date.now() + 1e3 });
}
async function persistTerminal(records, key) {
  let r = records[key], o = r.occ, terminalState = r.state, attempt = r.attemptHistory?.find((a) => a.id === r.activeAttemptId), attemptOpen = !!(attempt && !attempt.completedAt);
  attempt && (!attempt.completedAt || ["pending", "submitted_pending_confirmation", "unknown"].includes(attempt.state)) && Object.assign(attempt, { state: terminalState, completedAt: (/* @__PURE__ */ new Date()).toISOString(), detail: sanitizeDetail(r.detail) }), await restoreForeground(r), await chrome.alarms.clear(`attendance-end:${key}`), await chrome.alarms.clear(`attendance-retry:${key}`);
  let { attendanceProfile: profile = {}, attendanceDiagnostics: diagnostics = [] } = await chrome.storage.local.get(["attendanceProfile", "attendanceDiagnostics"]);
  ["success", "success_manual"].includes(r.state) ? delete r.error : r.error = runError(r.error || (["unknown", "submitted_pending_confirmation"].includes(r.state) ? { code: "submit_unconfirmed", message: r.detail } : r.detail), { course: o.course, phase: r.error?.phase || r.failurePhase || (r.phase === "completed" ? "submit" : r.phase) });
  let diagnostic = createDiagnostic({ ...r, course: o.course, type: o.type }, profile);
  r.error = diagnostic.error || void 0, diagnostic.dateDiag && (r.dateDiag = diagnostic.dateDiag), diagnostic.dateFillPath && (r.dateFillPath = diagnostic.dateFillPath), r.diagnosticId ||= crypto.randomUUID(), r.error && (r.detail = formatRunError(r.error));
  let diagnosticRows = diagnostics.filter((d) => d.id !== r.diagnosticId);
  diagnosticRows.push({ ...diagnostic, id: r.diagnosticId }), await chrome.storage.local.set({ attendanceDiagnostics: diagnosticRows.slice(-100) });
  let cloudStatus = r.state === "success_manual" ? "success" : r.state === "submitted_pending_confirmation" ? "unknown" : r.state === "missed_sleep" ? "missed" : r.state;
  if (r.catchUpIntent?.state === "pending" && (r.catchUpIntent = { ...r.catchUpIntent, state: "completed" }), r.origin === "manual" && ["failed", "missed"].includes(terminalState) && !r.submissionKey && !r.submissionAttemptedAt && attemptOpen) {
    let { attendanceSessions: sessions = [] } = await chrome.storage.local.get("attendanceSessions");
    currentTask(sessions, r) && o.date === todayMalaysia() && canSubmitBeforeEnd(o, Date.now()) ? (r.state = "scheduled", r.catchUpIntent = { sourceAttemptId: attempt.id, state: "pending" }, delete r.tabId, await chrome.alarms.create(`attendance-retry:${key}`, { when: Math.max(Date.now() + 1e3, triggerTimestamp(o)) })) : (r.state = "missed", r.detail = "\u8BFE\u7A0B\u5DF2\u8FC7\u671F\u3001\u6682\u505C\u3001\u53D8\u66F4\u6216\u7ED3\u675F\uFF0C\u672A\u63D0\u4EA4\u3002");
  }
  await enqueueCloud("event", { status: cloudStatus, courseCode: o.course, classDate: o.date, startTime: o.time, endTime: o.endTime, formUrl: r.formUrl || void 0, occurrenceKey: o.key, detail: r.detail }, { attendanceRecords: records }), await syncKeepAwake(records), ["failed", "submitted_pending_confirmation", "missed_sleep"].includes(terminalState) && await raiseAlert({ key, state: terminalState, course: o.course, detail: r.detail, at: r.at });
}
async function resumeScheduledRecovery(key) {
  let record = (await chrome.storage.local.get("attendanceRecords")).attendanceRecords?.[key];
  record?.catchUpIntent?.state === "pending" && record.state === "scheduled" && !record.submissionKey && !record.submissionAttemptedAt && await processSchedule();
}
async function raiseAlert(level) {
  let { key, state, course, detail, at } = level;
  await chrome.storage.local.set({ unresolvedAlert: { key, state, course, detail, at } }), await chrome.action.setBadgeText({ text: "!" }), await chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
}
var draining = !1, setup = setupCoordinator(enqueueCloud), preflight = preflightCoordinator(notify);
async function cloudReadyForDrain() {
  let state = await chrome.storage.local.get(["attendanceCloudDeviceId", "attendanceCloudToken", "attendanceCloudSetupChoice"]);
  return ["recovery-starting", "recovery-pending", "recovery-verifying", "recovery-outcome-unknown", "recovery-finalizing"].includes(state.attendanceCloudSetupChoice) ? !1 : state.attendanceCloudDeviceId && state.attendanceCloudToken ? !0 : state.attendanceCloudSetupChoice === "new" || state.attendanceCloudSetupChoice === "recovered";
}
async function drainCloud() {
  if (!(draining || !cloudEnabled() || !await cloudReadyForDrain())) {
    draining = !0;
    try {
      for (let count = 0; count < 20; count++) {
        let item = await serialized(async () => {
          let { attendanceCloudOutbox: q = {} } = await chrome.storage.local.get("attendanceCloudOutbox");
          return nextReady(q);
        });
        if (!item || !await cloudReadyForDrain()) break;
        let error;
        try {
          await deliverCloud(item);
        } catch (e) {
          error = e.message;
        }
        await serialized(async () => {
          let { attendanceCloudOutbox: q = {} } = await chrome.storage.local.get("attendanceCloudOutbox");
          await chrome.storage.local.set({ attendanceCloudOutbox: error ? fail(q, item.id, error) : acknowledge(q, item.id) });
        });
      }
      await serialized(async () => {
        let { attendanceCloudOutbox: q = {} } = await chrome.storage.local.get("attendanceCloudOutbox");
        q.items?.length && await chrome.alarms.create(CLOUD, { when: Math.max(Date.now() + 1e3, Math.min(...q.items.map((i) => i.availableAt))) });
      });
    } finally {
      draining = !1;
    }
  }
}
async function notify(title, message, id = crypto.randomUUID(), priority = 1) {
  try {
    await chrome.notifications.create(id, { type: "basic", iconUrl: chrome.runtime.getURL("icon.png"), title, message, priority });
  } catch (error) {
    console.warn("\u7CFB\u7EDF\u901A\u77E5\u4E0D\u53EF\u7528", error.message);
  }
}
async function nextAlarm(sessions, records) {
  sessions = sessions.filter((session) => !session.testTemplate), await syncKeepAwake(records), await chrome.alarms.clear(NEXT), await chrome.alarms.clear("attendance-evening");
  let today = todayMalaysia(), next = occurrencesBetween(sessions, today, daysFrom(today, 32)).filter((o) => (!records[o.key] || records[o.key].state === "scheduled") && triggerTimestamp(o) > Date.now() && triggerTimestamp(o) >= Date.parse(o.createdAt || "1970-01-01")).sort((a, b) => triggerTimestamp(a) - triggerTimestamp(b))[0];
  next && await chrome.alarms.create(NEXT, { when: triggerTimestamp(next) }), await preflight.schedule(occurrencesBetween(sessions, today, daysFrom(today, 7)), records), await chrome.alarms.create(MAINTENANCE, { periodInMinutes: 60 });
}
async function requirePluginLicense() {
  if (!(await getActivationGate({ refresh: !0 })).allowed) throw Error("plugin_license_required");
}
async function manualCheckIn(message, sender) {
  if (!(isSettingsSender(sender) || isPopupSender(sender)) || Object.keys(message).some((k) => !["type", "sessionId"].includes(k))) throw Error("manual_check_in_not_allowed");
  let select = async () => {
    let data2 = await load(), today = todayMalaysia(), occ2 = occurrencesBetween(data2.attendanceSessions, today, today).find((o) => o.id === message.sessionId && !o.testTemplate && !o.isTest && !o.testRunId);
    if (!occ2 || manualCheckInState(occ2, data2.attendanceRecords?.[occ2.key]) !== "ready") throw Error("manual_check_in_not_eligible");
    let binding = bindingForCourse(data2.attendanceBindings, occ2.course);
    return resolveFillPlan(binding, occ2, data2.attendanceProfile || {}, occ2.date), validateFormsUrl(binding.url), { data: data2, occ: occ2 };
  };
  await select(), await requirePluginLicense();
  let { data, occ } = await select(), previous = data.attendanceRecords?.[occ.key];
  previous && previous.state !== "scheduled" && await saveRecords({ ...data.attendanceRecords, [occ.key]: { ...previous, state: "scheduled" } }), await processSchedule({ manualKey: occ.key });
  let record = (await chrome.storage.local.get("attendanceRecords")).attendanceRecords?.[occ.key];
  if (record?.state !== "launched" || record.origin !== "manual") throw Error(record?.detail || "manual_check_in_not_started");
  return { ok: !0, key: occ.key, tabId: record.tabId };
}
async function processSchedule({ testKey, manualKey, automationAuthorization } = {}) {
  await syncKeepAwake(), await preflight.resume();
  let { attendanceSessions: sessions = [], attendanceBindings: bindings = {}, attendanceProfile: profile = {}, attendanceRecords: stored = {} } = await load(), records = { ...stored }, today = todayMalaysia(), now = Date.now();
  for (let [key, r] of Object.entries(records)) r.catchUpIntent?.state === "pending" && (r.state !== "scheduled" || r.submissionKey || r.submissionAttemptedAt ? r.catchUpIntent = { ...r.catchUpIntent, state: "completed" } : (!currentTask(sessions, r) || r.occ.date !== today || !canSubmitBeforeEnd(r.occ, now)) && (r.state = "missed", r.detail = "\u8BFE\u7A0B\u5DF2\u8FC7\u671F\u3001\u6682\u505C\u3001\u53D8\u66F4\u6216\u7ED3\u675F\uFF0C\u672A\u63D0\u4EA4\u3002", r.catchUpIntent = { ...r.catchUpIntent, state: "completed" }, await persistTerminal(records, key)));
  for (let [key, r] of Object.entries(records)) {
    if (!["launched", "pending"].includes(r.state)) continue;
    let deadline = r.phaseDeadline || r.watchDeadline || Date.parse(r.at) + 9e4;
    deadline <= now ? (await watchdog(key), Object.assign(records, (await chrome.storage.local.get("attendanceRecords")).attendanceRecords)) : await chrome.alarms.create(`attendance-watch:${key}`, { when: deadline });
  }
  let missedCourses = [];
  for (let occ of occurrencesBetween(sessions, daysFrom(today, -7), today)) {
    if (testKey && occ.key !== testKey || manualKey && occ.key !== manualKey || occ.testTemplate || manualKey && manualCheckInState(occ, records[occ.key], Date.now()) !== "ready") continue;
    let due = triggerTimestamp(occ), immediate = !!(testKey || manualKey || occ.testRunId);
    if (records[occ.key]?.submissionKey || records[occ.key]?.submissionAttemptedAt || records[occ.key] && records[occ.key].state !== "scheduled" || !immediate && (due > now || due < Date.parse(occ.createdAt || "1970-01-01"))) continue;
    await preflight.abortAll(), Object.assign(records, (await chrome.storage.local.get("attendanceRecords")).attendanceRecords);
    let action = dueAction(due, now);
    if (records[occ.key]?.needForeground) {
      let { allowForegroundFallback = !0 } = await chrome.storage.local.get("allowForegroundFallback");
      if (allowForegroundFallback === !1 || !canSubmitBeforeEnd(occ, Date.now(), 6e4)) {
        records[occ.key] = { ...records[occ.key], ...transition("scheduled", "failed"), occ, error: runError({ code: "date_fill_hidden_tab" }, { course: occ.course, phase: "fill" }) }, await persistTerminal(records, occ.key);
        continue;
      }
    }
    if (occ.isTest && occ.testAuthorizationExpiresAt <= now) {
      records[occ.key] = { ...records[occ.key] || {}, ...transition("scheduled", "missed"), occ, error: runError({ code: "test_authorization_expired" }, { course: occ.course, phase: "validate" }) }, await persistTerminal(records, occ.key);
      continue;
    }
    if (!canSubmitBeforeEnd(occ, now, occ.isTest ? 6e4 : 0)) {
      records[occ.key] = { ...records[occ.key] || {}, ...transition("scheduled", "missed"), occ, detail: "\u8BFE\u7A0B\u5DF2\u7ED3\u675F\u6216\u7ED3\u675F\u65F6\u95F4\u65E0\u6548\uFF0C\u672A\u63D0\u4EA4\u3002" }, await persistTerminal(records, occ.key), missedCourses.push(occ.course);
      continue;
    }
    if (!immediate && action === "missed") {
      records[occ.key] = { ...records[occ.key] || {}, ...transition("scheduled", "missed_sleep"), occ, detail: "\u8BBE\u5907\u4F11\u7720\u6216\u6D4F\u89C8\u5668\u672A\u53CA\u65F6\u8FD0\u884C\uFF0C\u9519\u8FC7\u81EA\u52A8\u63D0\u4EA4\u7A97\u53E3\u3002" }, await persistTerminal(records, occ.key), missedCourses.push(occ.course);
      continue;
    }
    let binding = bindingForCourse(bindings, occ.course);
    if (binding?.isTest || occ.isTest) {
      let { testFormAllowlist = [] } = await chrome.storage.local.get("testFormAllowlist");
      if (!testFormAllowed(binding, testFormAllowlist)) {
        records[occ.key] = { ...records[occ.key] || {}, ...transition("scheduled", "missed"), occ, error: runError({ code: "not_allowed" }, { course: occ.course, phase: "validate" }) }, await persistTerminal(records, occ.key);
        continue;
      }
    }
    let validationStarted = Date.now();
    try {
      resolveFillPlan(binding, occ, profile, occ.date);
    } catch (error) {
      records[occ.key] = { ...records[occ.key] || {}, ...transition("scheduled", error.code === "course_kind_unknown" ? "failed" : "missed"), occ, detail: error.message, error: runError(error, { course: occ.course, phase: "validate" }), phaseDurations: { checking: Date.now() - validationStarted }, questionTitles: (binding?.questions || []).map((q) => ({ before: q.title, after: cleanQuestionTitle(q.title) })) }, await persistTerminal(records, occ.key), missedCourses.push(occ.course);
      continue;
    }
    try {
      await (automationAuthorization ??= requirePluginLicense());
    } catch (error) {
      records[occ.key] = { ...records[occ.key] || {}, state: "scheduled", occ, detail: error.message };
      continue;
    }
    let current = await chrome.storage.local.get("attendanceSessions");
    if (!currentTask(current.attendanceSessions || [], { occ }) || !canSubmitBeforeEnd(occ, Date.now(), occ.isTest ? 6e4 : 0) || manualKey && manualCheckInState(occ, records[occ.key]) !== "ready") {
      records[occ.key] = { ...records[occ.key] || {}, ...transition("scheduled", "missed"), occ, error: runError({ code: scheduleWeekStatus(occ) === "active" ? "configuration_changed" : "schedule_week_inactive" }, { course: occ.course, phase: "validate" }) }, await persistTerminal(records, occ.key);
      continue;
    }
    let startedAt = (/* @__PURE__ */ new Date()).toISOString(), phase = "opening";
    records[occ.key] = { ...records[occ.key] || {}, ...transition("scheduled", "launched"), occ, questionTitles: createDiagnostic({ questionTitles: (binding.questions || []).map((q) => ({ before: q.title, after: cleanQuestionTitle(q.title) })) }, profile).questionTitles, phaseDurations: { checking: Date.now() - validationStarted }, formUrl: binding.url, configuration: JSON.stringify({ binding, profile }), phase, phaseStartedAt: startedAt, phaseDeadline: Date.now() + PHASE_TIMEOUTS[phase], watchDeadline: Date.now() + 9e4 };
    let record = records[occ.key], attemptId = crypto.randomUUID();
    record.origin = manualKey ? "manual" : "scheduled", record.activeAttemptId = attemptId, record.catchUpIntent?.state === "pending" && (record.catchUpIntent = { ...record.catchUpIntent, state: "completed", launchedAttemptId: attemptId }), delete record.tabId, delete record.diagnosticId, delete record.fallbackInjected, delete record.error, delete record.detail, delete record.failurePhase, record.attemptHistory = [...record.attemptHistory || [], { id: attemptId, origin: record.origin, state: "launched", startedAt }], await chrome.alarms.create(`attendance-watch:${occ.key}`, { when: record.phaseDeadline }), await saveRecords(records), record.catchUpIntent?.state === "completed" && await chrome.alarms.clear(`attendance-retry:${occ.key}`);
    try {
      let record2 = records[occ.key], options = { url: "about:blank", active: manualKey ? !0 : record2.needForeground === !0 };
      if (record2.attempts = (record2.attempts || 0) + 1, await chrome.alarms.create(`attendance-end:${occ.key}`, { when: courseEndTimestamp(occ) }), record2.needForeground) {
        let [previous] = await chrome.tabs.query({ active: !0, currentWindow: !0 });
        if (!previous) throw Error("\u627E\u4E0D\u5230\u524D\u53F0\u7A97\u53E3\uFF0C\u672A\u63D0\u4EA4\u3002");
        let currentWindow = await chrome.windows.get(previous.windowId);
        record2.foregroundRestore = { prevActiveTabId: previous.id, windowId: previous.windowId, windowState: currentWindow.state }, record2.foregroundRetried = !0, options.windowId = previous.windowId, await saveRecords(records), await chrome.alarms.create(`attendance-end:${occ.key}`, { when: courseEndTimestamp(occ) }), currentWindow.state === "minimized" && await chrome.windows.update(previous.windowId, { state: "normal", focused: !1 });
      }
      assertBeforeCourseEnd(occ);
      let tab = await chrome.tabs.create(options);
      records[occ.key].tabId = tab.id, await saveRecords(records), await chrome.alarms.create(`attendance-watch:${occ.key}`, { when: records[occ.key].phaseDeadline });
      let url = validateFormsUrl(binding.url);
      url.hash = new URLSearchParams({ attendanceRun: occ.key }).toString(), await chrome.tabs.update(tab.id, { url: url.href });
    } catch (error) {
      records[occ.key] = { ...records[occ.key], ...transition("launched", ["course_ended", "schedule_week_inactive"].includes(error.code) ? "missed" : "failed"), detail: error.message, error: runError(error, { course: occ.course, phase: "opening" }), phaseDurations: { ...records[occ.key].phaseDurations, opening: Math.max(0, Date.now() - Date.parse(startedAt)) } }, await persistTerminal(records, occ.key), await notify("\u6253\u5361\u672A\u6267\u884C", `${occ.course}\uFF1A${error.message}`);
    }
  }
  await saveRecords(records), await enqueueCloud("sync", cloudSnapshot({ sessions, bindings, profile })), missedCourses.length && await notify("\u8BF7\u624B\u52A8\u5904\u7406\u8BFE\u7A0B\u6253\u5361", `${missedCourses.join("\u3001")} \u672A\u81EA\u52A8\u63D0\u4EA4\u3002\u8BF7\u6253\u5F00\u6269\u5C55\u67E5\u770B\u539F\u56E0\u3002`), await nextAlarm(sessions, records), await setup.resume(), manualKey && await resumeScheduledRecovery(manualKey);
}
var sanitizeDetail = redactDiagnostic;
async function restoreForeground(record) {
  let restore = record.foregroundRestore;
  if (restore) {
    try {
      await chrome.tabs.update(restore.prevActiveTabId, { active: !0 });
    } catch (error) {
      console.warn("Foreground tab restore failed", error.message);
    }
    if (restore.windowState === "minimized")
      try {
        await chrome.windows.update(restore.windowId, { state: "minimized", focused: !1 });
      } catch (error) {
        console.warn("Foreground window restore failed", error.message);
      }
    delete record.foregroundRestore;
  }
}
async function needForeground(message, sender) {
  let { attendanceRecords: records = {}, allowForegroundFallback = !0 } = await chrome.storage.local.get(["attendanceRecords", "allowForegroundFallback"]), record = records[message.key];
  if (!record || record.tabId !== sender.tab?.id || record.state !== "launched" || record.submissionAttemptedAt || record.submissionKey || message.submissionNotClicked !== !0 || message.error?.code !== "date_fill_hidden_tab") throw Error("\u524D\u53F0\u91CD\u8BD5\u4E0E\u5F53\u524D\u70B9\u51FB\u524D\u4EFB\u52A1\u4E0D\u5339\u914D\u3002");
  allowForegroundFallback !== !1 && (record.needForeground = !0), await saveRecords(records);
  let result = await report({ ...message, state: "failed" }, sender);
  return result.retry || await chrome.tabs.remove(record.tabId).catch((error) => console.warn("Foreground failed tab close failed", error.message)), result;
}
async function reportPhase(message, sender) {
  let { attendanceRecords: records = {}, attendanceBindings: bindings = {}, attendanceProfile: profile = {} } = await chrome.storage.local.get(["attendanceRecords", "attendanceBindings", "attendanceProfile"]), record = records[message.key];
  if (!record || record.tabId !== sender.tab?.id || !PHASE_TIMEOUTS[message.phase]) throw Error("\u6253\u5361\u9636\u6BB5\u4E0E\u5F53\u524D\u9875\u9762\u4E0D\u5339\u914D\u3002");
  if (["success", "success_manual", "failed", "unknown", "missed", "missed_sleep", "submitted_pending_confirmation"].includes(record.state)) return { ok: !0 };
  let now = Date.now(), started = Date.parse(record.phaseStartedAt || "") || now, durations = { ...record.phaseDurations || {} };
  record.phase && (durations[record.phase] = (durations[record.phase] || 0) + Math.max(0, now - started));
  let timeout = message.phase === "filling" ? fillingTimeout(bindingForCourse(bindings, record.occ.course)?.questions || bindingForCourse(bindings, record.occ.course)?.mapping) : PHASE_TIMEOUTS[message.phase];
  if (records[message.key] = { ...record, phase: message.phase, phaseStartedAt: new Date(now).toISOString(), phaseDeadline: now + timeout, phaseDurations: durations }, message.diagnostic) {
    let diagnostic = createDiagnostic(message.diagnostic, profile);
    Object.assign(records[message.key], { questionTitles: diagnostic.questionTitles, dateDiag: diagnostic.dateDiag || record.dateDiag, dateFillPath: record.foregroundRetried ? "foreground" : diagnostic.dateFillPath || record.dateFillPath });
  }
  return message.phase === "confirming" && Number.isInteger(message.submissionBefore?.questionCount) && (records[message.key].submissionBefore = { questionCount: Math.max(0, message.submissionBefore.questionCount), submitVisible: message.submissionBefore.submitVisible === !0 }), await saveRecords(records), await chrome.alarms.create(`attendance-watch:${message.key}`, { when: now + timeout }), { ok: !0 };
}
async function reserve(message, sender) {
  let { attendanceRecords: records = {}, attendanceSessions: sessions = [], attendanceProfile: profile = {}, attendanceBindings: bindings = {} } = await chrome.storage.local.get(["attendanceRecords", "attendanceSessions", "attendanceProfile", "attendanceBindings"]), record = records[message.key];
  if (!record || record.tabId !== sender.tab?.id) throw Error("\u6253\u5361\u4EFB\u52A1\u4E0E\u5F53\u524D\u9875\u9762\u4E0D\u5339\u914D\u3002");
  if (!currentTask(sessions, record)) throw Error("\u6253\u5361\u4EFB\u52A1\u5DF2\u5220\u9664\u3001\u6682\u505C\u6216\u4FEE\u6539\uFF0C\u672A\u63D0\u4EA4\u3002");
  if (record.occ.isTest || bindingForCourse(bindings, record.occ.course)?.isTest) {
    if (record.occ.testAuthorizationExpiresAt <= Date.now())
      return records[message.key] = { ...record, ...transition(record.state, "missed"), error: runError({ code: "test_authorization_expired" }, { course: record.occ.course, phase: "submit" }) }, await persistTerminal(records, message.key), { granted: !1, reason: "test_authorization_expired" };
    let { testFormAllowlist = [] } = await chrome.storage.local.get("testFormAllowlist");
    if (!testFormAllowed(bindingForCourse(bindings, record.occ.course), testFormAllowlist)) return { granted: !1, reason: "not_allowed" };
    if (!canSubmitBeforeEnd(record.occ, Date.now(), 6e4)) return { granted: !1, reason: "course_ended" };
    try {
      let expected = testFormIdentity(bindingForCourse(bindings, record.occ.course).url), actual = testFormIdentity(sender.url || sender.tab?.url);
      if (actual.host !== expected.host || actual.formId !== expected.formId) return { granted: !1, reason: "not_allowed" };
    } catch {
      return { granted: !1, reason: "not_allowed" };
    }
  }
  if (record.occ.date !== todayMalaysia() || record.configuration && record.configuration !== JSON.stringify({ binding: bindingForCourse(bindings, record.occ.course), profile })) throw Error("\u4EFB\u52A1\u65E5\u671F\u6216\u914D\u7F6E\u5DF2\u53D8\u5316\uFF0C\u672A\u6388\u6743\u63D0\u4EA4\u3002");
  let fresh = await chrome.storage.local.get(["attendanceRecords", "attendanceSessions", "attendanceBindings", "attendanceProfile"]), live = fresh.attendanceRecords?.[message.key];
  if (!live || live.tabId !== sender.tab.id || live.activeAttemptId !== record.activeAttemptId || !currentTask(fresh.attendanceSessions || [], live) || live.occ.date !== todayMalaysia() || live.configuration && live.configuration !== JSON.stringify({ binding: bindingForCourse(fresh.attendanceBindings, live.occ.course), profile: fresh.attendanceProfile || {} })) return { ok: !0, granted: !1, reason: "configuration_changed" };
  if (live.origin === "manual" && manualCheckInState(live.occ, void 0) !== "ready") return { ok: !0, granted: !1, reason: "manual_check_in_not_eligible" };
  let result = reserveSubmissionRecord(fresh.attendanceRecords, message.key, sender.tab.id, (/* @__PURE__ */ new Date()).toISOString());
  return result.granted ? (await saveRecords(result.records), await chrome.alarms.create(`attendance-watch:${message.key}`, { when: Date.now() + PHASE_TIMEOUTS.submitting }), { ok: !0, granted: !0 }) : (result.reason === "course_ended" && (await persistTerminal(result.records, message.key), await chrome.alarms.clear(`attendance-watch:${message.key}`)), { ok: !0, granted: !1, reason: result.reason });
}
async function markSubmitted(message, sender) {
  if (!isSettingsSender(sender)) throw Error("\u53EA\u80FD\u4ECE\u6269\u5C55\u8BBE\u7F6E\u9875\u624B\u52A8\u786E\u8BA4\u3002");
  let { attendanceRecords: records = {} } = await chrome.storage.local.get("attendanceRecords"), record = records[message.key];
  if (!record || !["unknown", "submitted_pending_confirmation"].includes(record.state)) throw Error("\u8FD9\u6761\u8BB0\u5F55\u5F53\u524D\u4E0D\u80FD\u624B\u52A8\u6807\u8BB0\u3002");
  return records[message.key] = { ...record, ...transition(record.state, "manual_submitted"), detail: "\u7528\u6237\u624B\u52A8\u6807\u8BB0\u4E3A\u5DF2\u63D0\u4EA4\u3002", phase: "completed" }, await persistTerminal(records, message.key), { ok: !0 };
}
async function releaseSubmission(message, sender) {
  if (!isSettingsSender(sender)) throw Error("\u53EA\u80FD\u4ECE\u6269\u5C55\u8BBE\u7F6E\u9875\u89E3\u9664\u63D0\u4EA4\u4FDD\u62A4\u3002");
  if (message.confirm !== !0) throw Error("\u89E3\u9664\u63D0\u4EA4\u4FDD\u62A4\u53EF\u80FD\u9020\u6210\u91CD\u590D\u6253\u5361\uFF0C\u8BF7\u660E\u786E\u786E\u8BA4\u3002");
  let { attendanceRecords: records = {} } = await chrome.storage.local.get("attendanceRecords"), record = records[message.key];
  if (!record || !["unknown", "submitted_pending_confirmation"].includes(record.state)) throw Error("\u8FD9\u6761\u8BB0\u5F55\u5F53\u524D\u4E0D\u80FD\u89E3\u9664\u63D0\u4EA4\u4FDD\u62A4\u3002");
  let next = { ...record, manualResubmitAllowed: !0, detail: "\u7528\u6237\u5DF2\u660E\u786E\u5141\u8BB8\u91CD\u65B0\u63D0\u4EA4\uFF1B\u7CFB\u7EDF\u4E0D\u4F1A\u81EA\u52A8\u91CD\u8BD5\u3002" };
  return delete next.submissionAttemptedAt, delete next.submissionKey, await chrome.storage.local.set({ attendanceRecords: { ...records, [message.key]: next } }), { ok: !0 };
}
async function report(message, sender) {
  let { attendanceRecords: records = {}, attendanceSessions: sessions = [], attendanceProfile: profile = {}, attendanceBindings: bindings = {} } = await chrome.storage.local.get(["attendanceRecords", "attendanceSessions", "attendanceProfile", "attendanceBindings"]), record = records[message.key], { attendanceConfirmationTestMode } = await chrome.storage.local.get("attendanceConfirmationTestMode");
  if (!record || record.tabId !== sender.tab?.id) throw Error("\u6253\u5361\u4EFB\u52A1\u4E0E\u5F53\u524D\u9875\u9762\u4E0D\u5339\u914D\u3002");
  if (message.state === "pending" && !currentTask(sessions, record)) throw Error("\u6253\u5361\u4EFB\u52A1\u5DF2\u5220\u9664\u3001\u6682\u505C\u6216\u4FEE\u6539\uFF0C\u672A\u63D0\u4EA4\u3002");
  if (message.state === "pending" && (record.occ.date !== todayMalaysia() || record.configuration && record.configuration !== JSON.stringify({ binding: bindingForCourse(bindings, record.occ.course), profile }))) throw Error("\u4EFB\u52A1\u65E5\u671F\u6216\u914D\u7F6E\u5DF2\u53D8\u5316\uFF0C\u672A\u6388\u6743\u63D0\u4EA4\u3002");
  if (message.state === "submitted_pending_confirmation" && !record.submissionAttemptedAt && record.state !== "pending") throw Error("\u63D0\u4EA4\u5C1A\u672A\u83B7\u5F97\u540E\u53F0\u63D0\u4EA4\u6743\u3002");
  if (message.state === "missed" && (message.submissionNotClicked !== !0 || !["launched", "pending"].includes(record.state))) throw Error("\u53EA\u80FD\u5C06\u5C1A\u672A\u70B9\u51FB\u63D0\u4EA4\u7684\u4EFB\u52A1\u6807\u8BB0\u4E3A\u9519\u8FC7\u3002");
  let { allowForegroundFallback = !0 } = await chrome.storage.local.get("allowForegroundFallback");
  if (record.origin !== "manual" && message.state === "failed" && message.error?.code === "date_fill_hidden_tab" && message.submissionNotClicked === !0 && record.state === "launched" && !record.submissionAttemptedAt && !record.submissionKey && record.needForeground && !record.foregroundRetried && allowForegroundFallback !== !1 && canSubmitBeforeEnd(record.occ, Date.now(), 6e4) && currentTask(sessions, record)) {
    await restoreForeground(record);
    let attempt = record.attemptHistory?.find((a) => a.id === record.activeAttemptId);
    return attempt && !attempt.completedAt && Object.assign(attempt, { state: "failed", completedAt: (/* @__PURE__ */ new Date()).toISOString(), detail: sanitizeDetail(message.detail || message.error?.message) }), records[message.key] = { ...record, state: "scheduled", at: (/* @__PURE__ */ new Date()).toISOString(), error: runError(message.error, { course: record.occ.course, phase: "fill" }), dateDiag: createDiagnostic(message.diagnostic, profile).dateDiag, dateFillPath: createDiagnostic(message.diagnostic, profile).dateFillPath || record.dateFillPath }, delete records[message.key].tabId, await saveRecords(records), await chrome.alarms.clear(`attendance-watch:${message.key}`), await chrome.tabs.remove(record.tabId).catch((error) => console.warn("Foreground retry tab close failed", error.message)), await chrome.alarms.create(`attendance-retry:${message.key}`, { when: Date.now() + 1e3 }), { ok: !0, retry: !0 };
  }
  let next = transition(record.state, message.state), now = Date.now(), durations = { ...record.phaseDurations || {} };
  if (record.phase && (durations[record.phase] = (durations[record.phase] || 0) + Math.max(0, now - (Date.parse(record.phaseStartedAt || "") || now))), records[message.key] = { ...record, ...next, phase: "completed", failurePhase: record.phase, error: message.state === "success" ? void 0 : runError(message.error || message.detail, { course: record.occ.course, phase: message.error?.phase || record.phase }), questionTitles: message.diagnostic?.questionTitles || record.questionTitles, dateDiag: createDiagnostic(message.diagnostic, profile).dateDiag || record.dateDiag, phaseDurations: durations, successSignal: message.state === "success" ? sanitizeDetail(message.detail) : void 0, detail: sanitizeDetail(message.detail) }, records[message.key].dateFillPath = record.foregroundRetried ? "foreground" : createDiagnostic(message.diagnostic, profile).dateFillPath || record.dateFillPath, attendanceConfirmationTestMode === !0 && message.state === "success" && message.diagnostic?.successPage && (records[message.key].successPage = createDiagnostic(message.diagnostic, profile).successPage), ["success", "failed", "unknown", "missed", "missed_sleep", "submitted_pending_confirmation"].includes(next.state) ? await persistTerminal(records, message.key) : await saveRecords(records), next.state === "missed" && await chrome.alarms.clear(`attendance-watch:${message.key}`), ["success", "failed", "unknown", "submitted_pending_confirmation"].includes(next.state)) {
    await chrome.alarms.clear(`attendance-watch:${message.key}`);
    let title = next.state === "success" ? "\u6253\u5361\u6210\u529F" : next.state === "submitted_pending_confirmation" ? "\u5DF2\u63D0\u4EA4\uFF0C\u5F85\u786E\u8BA4" : next.state === "unknown" ? "\u6253\u5361\u7ED3\u679C\u4E0D\u660E" : "\u6253\u5361\u5931\u8D25";
    await notify(title, records[message.key].error ? formatRunError(records[message.key].error) : `${record.occ.course} \xB7 ${record.occ.date} ${record.occ.time}`, void 0, next.state === "submitted_pending_confirmation" ? 2 : 1);
  }
  return await resumeScheduledRecovery(message.key), { ok: !0 };
}
async function openManualResubmit(message, sender) {
  if (!isSettingsSender(sender)) throw Error("\u8BF7\u4ECE\u6269\u5C55\u8BBE\u7F6E\u9875\u624B\u52A8\u6253\u5F00\u8868\u5355\u3002");
  await requirePluginLicense();
  let data = await chrome.storage.local.get(["attendanceRecords", "attendanceBindings"]), record = data.attendanceRecords?.[message.key];
  if (!record || !["unknown", "submitted_pending_confirmation"].includes(record.state)) throw Error("\u8FD9\u6761\u8BB0\u5F55\u5F53\u524D\u4E0D\u80FD\u91CD\u65B0\u63D0\u4EA4\u3002");
  let url = validateFormsUrl(record.formUrl || bindingForCourse(data.attendanceBindings, record.occ.course)?.url);
  return await chrome.tabs.create({ url: url.href, active: !0 }), data.attendanceRecords[message.key] = { ...record, manualResubmitRequestedAt: (/* @__PURE__ */ new Date()).toISOString(), manualResubmitRequestedBy: "user", detail: "\u7528\u6237\u4E3B\u52A8\u6253\u5F00\u8868\u5355\u5E76\u9009\u62E9\u624B\u52A8\u91CD\u65B0\u63D0\u4EA4\uFF1B\u8FD9\u4E0D\u662F\u81EA\u52A8\u91CD\u8BD5\uFF0C\u81EA\u52A8\u63D0\u4EA4\u4FDD\u62A4\u4ECD\u4FDD\u7559\u3002" }, await saveRecords(data.attendanceRecords), { ok: !0 };
}
async function watchdog(key) {
  let { attendanceRecords: records = {} } = await chrome.storage.local.get("attendanceRecords"), record = records[key];
  if (!record || !["launched", "pending"].includes(record.state) || await retryTestRun(records, key)) return;
  if (["opening", "reading"].includes(record.phase) && !(record.foregroundRestore && !canSubmitBeforeEnd(record.occ, Date.now())) && !record.fallbackInjected && record.tabId && chrome.scripting?.executeScript)
    try {
      await chrome.scripting.executeScript({ target: { tabId: record.tabId }, files: ["content.js"] });
      let phaseDurations2 = { ...record.phaseDurations };
      record.phase && (phaseDurations2[record.phase] = (phaseDurations2[record.phase] || 0) + Math.max(0, Date.now() - (Date.parse(record.phaseStartedAt) || Date.now()))), records[key] = { ...record, phaseDurations: phaseDurations2, fallbackInjected: !0, phase: "reading", phaseDeadline: Date.now() + PHASE_TIMEOUTS.reading, phaseStartedAt: (/* @__PURE__ */ new Date()).toISOString() }, await saveRecords(records), await chrome.alarms.create(`attendance-watch:${key}`, { when: records[key].phaseDeadline });
      return;
    } catch {
    }
  let state = record.state === "pending" ? "submitted_pending_confirmation" : "failed", detail = state === "failed" ? PHASE_ERRORS[record.phase] || "\u8868\u5355\u9875\u9762\u672A\u80FD\u5B8C\u6210\u8BFB\u53D6\u3002" : PHASE_ERRORS.confirming, phaseDurations = { ...record.phaseDurations || {} }, phaseStarted = Date.parse(record.phaseStartedAt || "");
  record.phase && Number.isFinite(phaseStarted) && (phaseDurations[record.phase] = (phaseDurations[record.phase] || 0) + Math.max(0, Date.now() - phaseStarted)), records[key] = { ...record, ...transition(record.state, state), phase: "completed", error: runError({ code: state === "failed" ? "phase_timeout" : "submit_unconfirmed", message: detail }, { course: record.occ.course, phase: record.phase }), phaseDurations, detail }, await persistTerminal(records, key), await notify(state === "submitted_pending_confirmation" ? "\u5DF2\u63D0\u4EA4\uFF0C\u5F85\u786E\u8BA4" : "\u6253\u5361\u5931\u8D25", `${record.occ.course}\uFF1A${records[key].detail}`, void 0, state === "submitted_pending_confirmation" ? 2 : 1);
}
async function retryTestRun(records, key) {
  let record = records[key];
  if (!record?.occ?.isTest || record.state !== "launched" || record.submissionAttemptedAt || record.submissionKey) return !1;
  let data = await chrome.storage.local.get(["attendanceBindings", "testFormAllowlist", "attendanceSessions"]);
  if (record.occ.testAuthorizationExpiresAt <= Date.now() || !testFormAllowed(bindingForCourse(data.attendanceBindings, record.occ.course), data.testFormAllowlist) || !currentTask(data.attendanceSessions || [], record) || record.occ.date !== todayMalaysia() || !canSubmitBeforeEnd(record.occ, Date.now(), 6e4)) {
    let code = record.occ.testAuthorizationExpiresAt <= Date.now() ? "test_authorization_expired" : record.occ.date !== todayMalaysia() ? "date_mismatch" : canSubmitBeforeEnd(record.occ, Date.now(), 6e4) ? "configuration_changed" : "course_ended";
    return records[key] = { ...record, ...transition("launched", "missed"), phase: "completed", error: runError({ code }, { course: record.occ.course, phase: record.phase }) }, await persistTerminal(records, key), !0;
  }
  await restoreForeground(record);
  let durations = { ...record.phaseDurations };
  return record.phase && (durations[record.phase] = (durations[record.phase] || 0) + Math.max(0, Date.now() - (Date.parse(record.phaseStartedAt) || Date.now()))), records[key] = { ...record, state: "scheduled", phaseDurations: durations }, delete records[key].tabId, await saveRecords(records), await chrome.alarms.clear(`attendance-watch:${key}`), await chrome.tabs.remove(record.tabId).catch(() => {
  }), await chrome.alarms.create(`attendance-retry:${key}`, { when: Date.now() + 1e3 }), !0;
}
async function runTestNow(message, sender) {
  if (!isSettingsSender(sender)) return { error: "not_allowed" };
  let data = await load(), { testFormAllowlist = [] } = await chrome.storage.local.get("testFormAllowlist"), binding = data.attendanceBindings?.[message.bindingId];
  if (!testFormAllowed(binding, testFormAllowlist) || binding.scope !== "module") return { error: "not_allowed" };
  let today = todayMalaysia(), candidates = (data.attendanceSessions || []).map((session2) => session2.testTemplate && session2.isTest === !0 && session2.testBindingId === message.bindingId ? { ...session2, enabled: !0 } : session2), template = occurrencesBetween(candidates, today, today).find((occ2) => !occ2.testRunId && bindingForCourse(data.attendanceBindings, occ2.course) === binding);
  if (!template) return { error: "no_test_session" };
  if (Object.values(data.attendanceRecords || {}).some((record) => ["launched", "pending"].includes(record.state))) return { error: "test_busy" };
  let automationAuthorization = requirePluginLicense();
  await automationAuthorization;
  let now = Date.now(), testDeadline = now + 900 * 1e3, endTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(testDeadline)), id = crypto.randomUUID(), session = { ...template, id, course: template.course, kind: "weekly", startDate: today, endDate: today, endTime, testDeadline, testAuthorizationExpiresAt: testDeadline, createdAt: new Date(now).toISOString(), isTest: !0, testTemplate: !1, testRunId: id };
  delete session.key, delete session.date, await chrome.storage.local.set({ attendanceSessions: [...data.attendanceSessions, session] });
  let [occ] = occurrencesBetween([session], today, today);
  await processSchedule({ testKey: occ.key, automationAuthorization });
  let { attendanceRecords } = await chrome.storage.local.get("attendanceRecords");
  return { ok: !0, key: occ.key, tabId: attendanceRecords[occ.key]?.tabId };
}
function currentTask(sessions, r) {
  return scheduleWeekStatus(r.occ) === "active" && sessions.some((s) => s.id === r.occ.id && s.weekStartDate === r.occ.weekStartDate && scheduleWeekStatus(s) === "active" && s.enabled !== !1 && s.course === r.occ.course && s.weekday === (r.occ.weekday ?? (/* @__PURE__ */ new Date(`${r.occ.date}T00:00:00Z`)).getUTCDay()) && s.time === r.occ.time && s.endTime === r.occ.endTime && !(s.exceptions || []).includes(r.occ.date));
}
async function whoAmI(sender) {
  if (!Number.isInteger(sender.tab?.id)) return null;
  let preflightIdentity = await preflight.identify(sender.tab.id);
  if (preflightIdentity) return preflightIdentity;
  try {
    validateFormsUrl(sender.url || sender.tab.url || "");
  } catch {
    return null;
  }
  let data = await chrome.storage.local.get(["attendanceRecords", "attendanceSessions", "attendanceChecks", "attendanceSetupSession", "attendanceBindings", "attendanceProfile"]), today = todayMalaysia(), entry = Object.entries(data.attendanceRecords || {}).find(([, r]) => r.tabId === sender.tab.id && r.state === "launched" && r.occ?.date === today && currentTask(data.attendanceSessions || [], r));
  if (entry) return { key: entry[0], kind: "run" };
  let check = Object.entries(data.attendanceChecks || {}).find(([, r]) => r.tabId === sender.tab.id && r.state === "launched" && r.date === today && r.configuration === JSON.stringify({ binding: bindingForCourse(data.attendanceBindings, r.course), profile: data.attendanceProfile }));
  if (check) return { key: check[0], kind: "check", course: check[1].course };
  let session = data.attendanceSetupSession;
  if (session?.state !== "running" || todayMalaysia(new Date(session.startedAt)) !== today) return null;
  let item = session.items.find((i) => i.tabId === sender.tab.id && !itemTerminal(i.state) && i.state !== "queued" && i.deadline > Date.now());
  if (!item) return null;
  try {
    if (coverageRevision(item, bindingForCourse(data.attendanceBindings, item.course), data.attendanceProfile) !== item.revision) return null;
  } catch {
    return null;
  }
  return { key: item.id, kind: "setup", setupId: session.id, itemId: item.id };
}
async function startCheck(message, sender) {
  if (!isSettingsSender(sender)) throw Error("\u8BF7\u4ECE\u6269\u5C55\u8BBE\u7F6E\u9875\u5F00\u59CB\u68C0\u67E5\u3002");
  await requirePluginLicense();
  let data = await chrome.storage.local.get(["attendanceChecks", "attendanceBindings", "attendanceProfile"]), binding = bindingForCourse(data.attendanceBindings, message.course);
  resolveFillPlan(binding, { course: message.course }, data.attendanceProfile, todayMalaysia());
  let url = validateFormsUrl(binding.url), key = crypto.randomUUID(), tab = await chrome.tabs.create({ url: "about:blank", active: !0 }), checks = Object.fromEntries(Object.entries(data.attendanceChecks || {}).filter(([, r]) => r.date === todayMalaysia()));
  checks[key] = { tabId: tab.id, course: message.course, date: todayMalaysia(), state: "launched", configuration: JSON.stringify({ binding, profile: data.attendanceProfile }) }, await chrome.storage.local.set({ attendanceChecks: checks }), url.hash = new URLSearchParams({ attendanceCheck: message.course }).toString();
  try {
    await chrome.tabs.update(tab.id, { url: url.href });
  } catch (error) {
    throw checks[key].state = "failed", await chrome.storage.local.set({ attendanceChecks: checks }), error;
  }
  return { key, tabId: tab.id };
}
chrome.runtime.onInstalled.addListener((details) => serialized(async () => (details?.reason === "install" && await chrome.runtime.openOptionsPage(), await getActivationGate(), processSchedule())));
chrome.runtime.onStartup.addListener(() => serialized(async () => (await getActivationGate(), processSchedule())));
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.alarms.onAlarm.addListener((alarm) => serialized(async () => {
  if (alarm.name.startsWith("attendance-preflight:"))
    try {
      await requirePluginLicense();
    } catch {
      return;
    }
  await preflight.alarm(alarm.name) || (alarm.name === "attendance-power" ? await syncKeepAwake() : alarm.name === NEXT || alarm.name === MAINTENANCE || alarm.name.startsWith("attendance-retry:") ? await processSchedule() : alarm.name.startsWith("attendance-end:") ? await watchdog(alarm.name.slice(15)) : alarm.name.startsWith("attendance-watch:") ? await watchdog(alarm.name.slice(17)) : alarm.name.startsWith("attendance-setup:") && await setup.resume(), (alarm.name.startsWith("attendance-end:") || alarm.name.startsWith("attendance-watch:")) && await resumeScheduledRecovery(alarm.name.slice(alarm.name.indexOf(":") + 1)));
}).then(() => {
  (alarm.name === CLOUD || alarm.name === MAINTENANCE) && drainCloud();
}));
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "RUN_TEST_NOW")
    return serialized(() => runTestNow(message, sender)).then(sendResponse, (error) => sendResponse({ error: error.message })), !0;
  if (message?.type === "ACK_ALERT")
    return serialized(async () => {
      if (!isSettingsSender(sender)) throw Error("\u8BF7\u4ECE\u6269\u5C55\u8BBE\u7F6E\u9875\u786E\u8BA4\u544A\u8B66\u3002");
      return await chrome.storage.local.remove("unresolvedAlert"), await getActivationGate(), { ok: !0 };
    }).then(sendResponse, (error) => sendResponse({ error: error.message })), !0;
  if (message?.type === "HEALTH_CHECK")
    return serialized(async () => healthSnapshot()).then(sendResponse, (error) => sendResponse({ error: error.message })), !0;
  if (message?.type === "RESTORE_BACKUP")
    return serialized(async () => {
      if (!isSettingsSender(sender)) throw Error("\u8BF7\u4ECE\u6269\u5C55\u8BBE\u7F6E\u9875\u6062\u590D\u5907\u4EFD\u3002");
      let current = await chrome.storage.local.get(["attendanceRecords", "attendanceSetupSession"]);
      current.attendanceSetupSession?.state === "running" && await setup.handle({ type: "CANCEL_SETUP" }, sender);
      let restored = restoreBackup(message.backup, current);
      return await chrome.storage.local.set(restored), await processSchedule(), { ok: !0, profile: restored.attendanceProfile };
    }).then(sendResponse, (error) => sendResponse({ error: error.message })), !0;
  if (["START_SETUP", "GET_SETUP_ITEM", "REPORT_SETUP_ITEM", "CONFIRM_SETUP_ITEM", "CONFIRM_ALL_SETUP_ITEMS", "CANCEL_SETUP"].includes(message?.type))
    return serialized(async () => (["START_SETUP", "GET_SETUP_ITEM"].includes(message.type) && await requirePluginLicense(), setup.handle(message, sender))).then(sendResponse, (error) => sendResponse({ error: error.message })), !0;
  if (message?.type === "GET_LICENSE_GATE")
    return isSettingsSender(sender) || isPopupSender(sender) ? (getActivationGate({ refresh: message.refresh === !0 }).then(sendResponse, () => sendResponse({ error: "gate_unavailable" })), !0) : (sendResponse({ error: "not_allowed" }), !1);
  if (message?.type === "CLOUD_REQUEST") {
    if (!isSettingsSender(sender))
      return sendResponse({ error: "\u8BBE\u7F6E\u64CD\u4F5C\u53EA\u80FD\u4ECE\u6269\u5C55\u8BBE\u7F6E\u9875\u6267\u884C\u3002" }), !1;
    let operation = {
      device: async () => ensureCloudDevice({ allowRegistration: !1 }),
      entitlement: () => getEntitlementStatus(),
      checkout: () => createCheckoutSession({ plan: message.plan, source: message.source, currency: message.currency }),
      "activate-plugin-license": async () => {
        let pending = activatePluginLicense(message.licenseKey);
        return message.licenseKey = "", { ...await pending, gate: await getActivationGate() };
      },
      "plugin-license-status": () => getPluginLicenseStatus(),
      redeem: () => redeemActivationKey(message.activationKey),
      notifications: () => deliverCloud({ action: "notifications", payload: {} }),
      "confirm-receipt": () => deliverCloud({ action: "confirm-receipt", payload: { notificationId: message.notificationId } }),
      "recovery-start": () => startPhoneSubscriptionRecovery(message.activationKey),
      "recovery-complete": () => completePhoneSubscriptionRecovery(message.challengeId, message.code),
      "recovery-status": () => phoneSubscriptionRecoveryStatus(),
      "recovery-cancel": () => cancelPhoneSubscriptionRecovery()
    }[message.action];
    return operation ? (operation().then(async (data) => {
      if (message.action === "device") {
        let { attendanceNtfyTopic, attendanceCloudDeviceId } = data;
        sendResponse({ attendanceNtfyTopic, attendanceCloudDeviceId });
      } else {
        if (message.action === "redeem" || message.action === "recovery-complete")
          try {
            await serialized(processSchedule), drainCloud();
          } catch (error) {
            console.error("Cloud schedule refresh after subscription change failed", error.message);
          }
        sendResponse(data);
      }
    }, (error) => sendResponse({ error: error.code || error.message, retryAfterSeconds: error.retryAfterSeconds, httpStatus: error.httpStatus })), !0) : !1;
  }
  return message?.type === "RETRY_CLOUD" ? (serialized(async () => {
    if (!isSettingsSender(sender)) throw Error("\u8BF7\u4ECE\u6269\u5C55\u8BBE\u7F6E\u9875\u91CD\u8BD5\u4E91\u7AEF\u8FDE\u63A5\u3002");
    let { attendanceCloudOutbox: q = {} } = await chrome.storage.local.get("attendanceCloudOutbox");
    return await chrome.storage.local.set({ attendanceCloudOutbox: { ...q, items: (q.items || []).map((i) => ({ ...i, availableAt: Date.now() })) } }), { ok: !0 };
  }).then((result) => {
    sendResponse(result), drainCloud();
  }, (e) => sendResponse({ error: e.message })), !0) : ["GET_PREFLIGHT", "REPORT_PREFLIGHT"].includes(message?.type) ? (serialized(async () => (message.type === "GET_PREFLIGHT" && await requirePluginLicense(), preflight.handle(message, sender))).then(sendResponse, (error) => sendResponse({ error: error.message })), !0) : message?.type === "AUTHORIZE_AUTOMATION" ? (serialized(async () => {
    if (!Number.isInteger(sender.tab?.id)) throw Error("not_allowed");
    validateFormsUrl(sender.url || sender.tab.url || "");
    let { attendanceRecords: active = {} } = await chrome.storage.local.get("attendanceRecords");
    return Object.values(active).some((record) => record.tabId === sender.tab.id && ["launched", "pending"].includes(record.state)) || await requirePluginLicense(), { ok: !0 };
  }).then(sendResponse, (error) => sendResponse({ error: error.message })), !0) : message?.type === "GET_POPUP_COURSES" ? isPopupSender(sender) ? ((async () => {
    let data = await load(), now = Date.now(), today = todayMalaysia(), sessions = data.attendanceSessions || [], classes = occurrencesBetween(sessions.map((s) => ({ ...s, enabled: !0 })), today, today).filter((o) => !o.testTemplate && !o.isTest && !o.testRunId), courses = classes.filter((o) => occurrenceTimestamp(o) <= now && courseEndTimestamp(o) > now).map((o) => ({ id: o.id, course: o.course, time: o.time, endTime: o.endTime, state: manualCheckInState({ ...o, enabled: sessions.find((s) => s.id === o.id)?.enabled }, data.attendanceRecords?.[o.key], now) })), boundaries = classes.flatMap((o) => [occurrenceTimestamp(o), courseEndTimestamp(o)]).filter((t) => t > now);
    return { courses, language: (await chrome.storage.local.get("attendanceLanguage")).attendanceLanguage, refreshAfterMs: Math.max(250, Math.min(15e3, ...boundaries.map((t) => t - now + 1))) };
  })().then(sendResponse, (error) => sendResponse({ error: error.message })), !0) : (sendResponse({ error: "not_allowed" }), !1) : ["MANUAL_CHECK_IN", "SET_CONFIRMATION_TEST_MODE", "OPEN_MANUAL_RESUBMIT", "WHO_AM_I", "START_CHECK", "SAVE_SCHEDULES", "REBUILD_SCHEDULE", "GET_RUN", "GET_ACTIVE_RUN", "REPORT_PHASE", "RESERVE_SUBMISSION", "REPORT_RUN", "REPORT_ATTEMPT", "MARK_SUBMITTED", "RELEASE_SUBMISSION", "NEED_FOREGROUND"].includes(message?.type) ? (serialized(async () => {
    if (message.type === "MANUAL_CHECK_IN") return manualCheckIn(message, sender);
    if (message.type === "NEED_FOREGROUND") return needForeground(message, sender);
    if (message.type === "SET_CONFIRMATION_TEST_MODE") {
      if (!isSettingsSender(sender)) throw Error("\u6D4B\u8BD5\u6A21\u5F0F\u53EA\u80FD\u4ECE\u6269\u5C55\u8BBE\u7F6E\u9875\u542F\u7528\u3002");
      return await chrome.storage.local.set({ attendanceConfirmationTestMode: message.enabled === !0 }), { ok: !0 };
    }
    if (message.type === "OPEN_MANUAL_RESUBMIT") return openManualResubmit(message, sender);
    if (message.type === "WHO_AM_I") return whoAmI(sender);
    if (message.type === "START_CHECK") return startCheck(message, sender);
    if (message.type === "REPORT_ATTEMPT") {
      if (validateFormsUrl(sender.url || sender.tab?.url || ""), !Number.isInteger(sender.tab?.id)) throw Error("\u8BCA\u65AD\u4E0E\u5F53\u524D\u9875\u9762\u4E0D\u5339\u914D\u3002");
      let data = await chrome.storage.local.get(["attendanceProfile", "attendanceBindings", "attendanceSetupSession", "attendanceDiagnostics"]), course = message.course;
      if (message.setupId) {
        let session = data.attendanceSetupSession, item = session?.items.find((i) => i.id === message.itemId);
        if (session?.id !== message.setupId || item?.tabId !== sender.tab.id) throw Error("\u8BCA\u65AD\u4E0E\u8BBE\u7F6E\u68C0\u67E5\u4E0D\u5339\u914D\u3002");
        course = item.course;
      }
      let binding = bindingForCourse(data.attendanceBindings, course);
      if (!binding || validateFormsUrl(binding.url).href !== validateFormsUrl(sender.url || sender.tab.url).href) throw Error("\u8BCA\u65AD\u4E0E\u8BFE\u7A0B\u8868\u5355\u4E0D\u5339\u914D\u3002");
      let diagnostic = createDiagnostic({ ...message.diagnostic, course }, data.attendanceProfile), id = message.setupId ? `setup:${message.setupId}:${message.itemId}` : /^[a-f0-9-]{36}$/i.test(message.attemptId || "") ? `attempt:${sender.tab.id}:${message.attemptId}` : crypto.randomUUID(), rows = (data.attendanceDiagnostics || []).filter((d) => d.id !== id);
      return await chrome.storage.local.set({ attendanceDiagnostics: [...rows, { ...diagnostic, id }].slice(-100) }), { ok: !0 };
    }
    if (message.type === "SAVE_SCHEDULES") {
      if (!isSettingsSender(sender)) throw Error("\u8BF7\u4ECE\u6269\u5C55\u8BBE\u7F6E\u9875\u4FEE\u6539\u8BFE\u8868\u3002");
      let current = await chrome.storage.local.get("attendanceSessions");
      if (!Array.isArray(message.sessions) || message.expectedSessions !== JSON.stringify(current.attendanceSessions || [])) throw Error("\u8BFE\u8868\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\u3002");
      let update = { attendanceSessions: message.sessions.map(toWeeklySession) };
      return message.draft?.version === 1 && Array.isArray(message.draft.rows) && (update.attendanceDraft = message.draft), await chrome.storage.local.set(update), { ok: !0 };
    }
    if (message.type === "REBUILD_SCHEDULE")
      return await processSchedule(), { ok: !0 };
    if (message.type === "GET_ACTIVE_RUN") {
      if (!Number.isInteger(sender.tab?.id)) return null;
      try {
        validateFormsUrl(sender.url || sender.tab.url || "");
      } catch {
        return null;
      }
      let { attendanceRecords: records = {}, attendanceConfirmationTestMode } = await chrome.storage.local.get(["attendanceRecords", "attendanceConfirmationTestMode"]), entry = Object.entries(records).find(([, record]) => record.tabId === sender.tab.id && (record.state === "launched" || ["pending", "submitted_pending_confirmation"].includes(record.state) && record.submissionAttemptedAt));
      return entry ? { key: entry[0], state: entry[1].state, ...entry[1].submissionBefore ? { submissionBefore: entry[1].submissionBefore } : {}, ...attendanceConfirmationTestMode === !0 ? { confirmationTestMode: !0 } : {} } : null;
    }
    if (message.type === "GET_RUN") {
      let data = await load(), record = (data.attendanceRecords || {})[message.key];
      if (!record || record.tabId !== sender.tab?.id || record.state !== "launched" || !currentTask(data.attendanceSessions || [], record)) throw Error("\u4EFB\u52A1\u5DF2\u7ED3\u675F\u3001\u5DF2\u5220\u9664\uFF0C\u6216\u4E0D\u662F\u7531\u5B9A\u65F6\u5668\u542F\u52A8\u3002");
      let now = Date.now(), phase = "reading", durations = { ...record.phaseDurations };
      record.phase && record.phase !== "reading" && (durations[record.phase] = (durations[record.phase] || 0) + Math.max(0, now - (Date.parse(record.phaseStartedAt) || now))), data.attendanceRecords[message.key] = { ...record, phase, phaseDurations: durations, phaseStartedAt: record.phase === "reading" ? record.phaseStartedAt : new Date(now).toISOString(), phaseDeadline: now + PHASE_TIMEOUTS[phase] }, await saveRecords(data.attendanceRecords), await chrome.alarms.create(`attendance-watch:${message.key}`, { when: now + PHASE_TIMEOUTS[phase] });
      let { attendanceConfirmationTestMode, allowForegroundFallback = !0 } = await chrome.storage.local.get(["attendanceConfirmationTestMode", "allowForegroundFallback"]);
      return { occ: record.occ, binding: bindingForCourse(data.attendanceBindings, record.occ.course), profile: data.attendanceProfile, confirmationTestMode: attendanceConfirmationTestMode === !0, allowForegroundFallback: allowForegroundFallback !== !1 };
    }
    return message.type === "REPORT_PHASE" ? reportPhase(message, sender) : message.type === "RESERVE_SUBMISSION" ? reserve(message, sender) : message.type === "MARK_SUBMITTED" ? markSubmitted(message, sender) : message.type === "RELEASE_SUBMISSION" ? releaseSubmission(message, sender) : report(message, sender);
  }).then(sendResponse, (error) => sendResponse({ error: error.message })), !0) : !1;
});
async function handleTabNavigation(tabId, url) {
  if (!isSchoolLoginOrPermissionUrl(url)) return;
  await new Promise((resolve) => setTimeout(resolve, LOGIN_REDIRECT_SETTLE_MS));
  let currentTab;
  try {
    currentTab = await chrome.tabs.get(tabId);
  } catch {
    return;
  }
  isSchoolLoginOrPermissionUrl(currentTab.url || "") && await serialized(async () => {
    if (await preflight.navigation(tabId)) return;
    let { attendanceRecords: records = {} } = await chrome.storage.local.get("attendanceRecords"), entry = Object.entries(records).find(([, record2]) => record2.tabId === tabId && record2.state === "launched");
    if (!entry) return;
    let [key, record] = entry, phaseDurations = { ...record.phaseDurations || {} }, phaseStarted = Date.parse(record.phaseStartedAt || "");
    record.phase && Number.isFinite(phaseStarted) && (phaseDurations[record.phase] = (phaseDurations[record.phase] || 0) + Math.max(0, Date.now() - phaseStarted)), records[key] = { ...record, ...transition(record.state, "failed"), phase: "completed", phaseDurations, detail: "\u9700\u8981\u767B\u5F55\u5B66\u6821\u8D26\u53F7\u3002" }, records[key].error = runError({ code: "login_required" }, { course: record.occ.course, phase: record.phase }), await persistTerminal(records, key), await notify("\u9700\u8981\u767B\u5F55\u5B66\u6821\u8D26\u53F7", `${record.occ.course}\uFF1A\u8BF7\u5148\u767B\u5F55\u5B66\u6821 Microsoft \u8D26\u53F7\u3002`), await resumeScheduledRecovery(key);
  });
}
chrome.tabs.onUpdated?.addListener((tabId, changeInfo, tab) => {
  let url = changeInfo.url || tab?.url;
  return url ? handleTabNavigation(tabId, url) : void 0;
});
chrome.tabs.onRemoved?.addListener((tabId) => serialized(async () => {
  await preflight.closed(tabId), await setup.closed(tabId);
  let { attendanceRecords: records = {} } = await chrome.storage.local.get("attendanceRecords"), entry = Object.entries(records).find(([, record]) => record.tabId === tabId && (record.origin === "manual" || record.foregroundRestore || record.occ?.isTest) && ["launched", "pending"].includes(record.state));
  entry && (await watchdog(entry[0]), await resumeScheduledRecovery(entry[0]));
}));
chrome.storage.onChanged?.addListener((changes, area) => {
  area === "local" && ["keepAwakeEnabled", "attendanceSessions", "attendanceRecords"].some((key) => key in changes) && serialized(() => syncKeepAwake()).catch(console.error);
});
chrome.permissions?.onRemoved?.addListener(() => void serialized(() => syncKeepAwake()).catch(console.error));
