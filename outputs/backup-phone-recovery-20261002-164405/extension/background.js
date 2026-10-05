// src/schedule.js
var pad = (n) => String(n).padStart(2, "0");
var iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
function normalizeDate(value) {
  const text = String(value || "").trim();
  let m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return calendarDate(`${m[1]}-${pad(m[2])}-${pad(m[3])}`);
  m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return calendarDate(`${m[3]}-${pad(m[2])}-${pad(m[1])}`);
  return null;
}
function calendarDate(value) {
  const d = /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && iso(d) === value ? value : null;
}
function occurrencesBetween(sessions, startDate, endDate) {
  const result = [];
  for (let d = /* @__PURE__ */ new Date(`${startDate}T00:00:00Z`); d <= /* @__PURE__ */ new Date(`${endDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const date = iso(d);
    for (const s of sessions) {
      if (s.enabled === false) continue;
      if (s.kind === "dated" ? s.date !== date : s.weekday !== d.getUTCDay() || date < s.startDate || date > s.endDate || (s.exceptions || []).includes(date)) continue;
      result.push({ ...s, date, key: `${encodeURIComponent(s.course.trim().toLowerCase())}:${date}:${s.time}` });
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
}
function toWeeklySession(session) {
  const { date, startDate, endDate, ...weekly } = session;
  const weekday = session.kind === "dated" ? (/* @__PURE__ */ new Date(`${normalizeDate(date)}T00:00:00Z`)).getUTCDay() : Number(session.weekday);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw Error(`${session.course || "\u8BFE\u7A0B"} \u7F3A\u5C11\u6709\u6548\u661F\u671F\u3002`);
  return { ...weekly, kind: "weekly", weekday };
}
var fingerprint = (s) => [s.course?.trim().toLowerCase(), s.kind, s.kind === "dated" ? s.date : s.weekday, s.time, s.endTime].join("|");
function mergeSessions(existing, incoming) {
  const merged = [...existing], seen = new Set(existing.map(fingerprint));
  for (const row of incoming) if (!seen.has(fingerprint(row))) {
    merged.push(row);
    seen.add(fingerprint(row));
  }
  return merged;
}
function todayMalaysia(now = /* @__PURE__ */ new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function occurrenceTimestamp(occurrence) {
  return Date.parse(`${occurrence.date}T${occurrence.time}:00+08:00`);
}
function triggerTimestamp(occurrence) {
  const end = String(occurrence.endTime || occurrence.time || "");
  const match = end.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return occurrenceTimestamp(occurrence) - 5 * 60 * 1e3;
  const hour = Number(match[1]), minute = Number(match[2]);
  if (hour > 23 || minute > 59) return occurrenceTimestamp(occurrence) - 5 * 60 * 1e3;
  return Date.parse(`${occurrence.date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`) - 5 * 60 * 1e3;
}

// src/state.js
var allowed = { scheduled: ["launched", "missed"], launched: ["pending", "failed", "unknown"], pending: ["success", "failed", "unknown"], success: [], failed: [], unknown: [], missed: [] };
function transition(from, event) {
  const state = event === "timeout" ? "unknown" : event;
  if (!allowed[from]?.includes(state)) throw Error(`\u65E0\u6548\u72B6\u6001\u53D8\u66F4\uFF1A${from} \u2192 ${state}`);
  return { state, at: (/* @__PURE__ */ new Date()).toISOString() };
}
function dueAction(due, now, graceMs = 12e4) {
  if (now < due) return "wait";
  return now - due <= graceMs ? "launch" : "missed";
}

// src/forms.js
var HOSTS = /* @__PURE__ */ new Set(["forms.office.com", "forms.cloud.microsoft"]);
var normalize = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
function validateFormsUrl(value) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw Error("\u4E8C\u7EF4\u7801\u6216\u94FE\u63A5\u4E0D\u662F\u6709\u6548\u7F51\u5740\u3002");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !HOSTS.has(url.hostname.toLowerCase()) || !(/^\/r\/[\w-]+\/?$/.test(url.pathname) || /^\/Pages\/ResponsePage\.aspx$/i.test(url.pathname))) throw Error("\u53EA\u63A5\u53D7 Microsoft Forms \u7684\u586B\u5199\u94FE\u63A5\u3002");
  if (/^\/Pages\//i.test(url.pathname) && !url.searchParams.get("id")) throw Error("\u8868\u5355\u94FE\u63A5\u7F3A\u5C11 ID\u3002");
  url.hash = "";
  return url;
}
function verifyQuestions(questions, mapping) {
  return Array.isArray(questions) && questions.length === mapping?.length && questions.every((q, i) => normalize(q.title) === normalize(mapping[i].title) && q.type === mapping[i].type && (q.type !== "radio" || JSON.stringify((q.options || []).map(normalize)) === JSON.stringify((mapping[i].options || []).map(normalize))));
}
function formatDate(placeholder, date) {
  const [y, m, d] = date.split("-");
  const format = String(placeholder || "").match(/(?:yyyy|MM|M|dd|d)[/.-](?:yyyy|MM|M|dd|d)[/.-](?:yyyy|MM|M|dd|d)/)?.[0];
  if (!format) throw Error("\u65E0\u6CD5\u8BC6\u522B\u8868\u5355\u65E5\u671F\u683C\u5F0F\u3002");
  return format.replace(/yyyy|MM|dd|M|d/g, (t) => ({ yyyy: y, MM: m, M: String(+m), dd: d, d: String(+d) })[t]);
}
function deliveryFromCourse(course) {
  if (/(?:^|\W)(?:tut|tutorial)\b/i.test(course || "")) return "tutorial";
  if (/(?:^|\W)(?:lab|laboratory)\b/i.test(course || "")) return "lab";
  if (/(?:^|\W)(?:lec|lecture)\b/i.test(course || "")) return "lecture";
  throw Error("\u65E0\u6CD5\u5224\u65AD\u6B64\u8BFE\u7A0B\u7C7B\u578B\uFF0C\u8BF7\u9009\u62E9 Lecture\u3001Tutorial \u6216 Laboratory\u3002");
}
function deliveryOption(options, target) {
  return options.find((value) => target === "lab" ? ["lab", "laboratory"].includes(normalize(value)) : normalize(value) === target);
}
function identityOption(options, target) {
  return options.find((value) => target === "international" ? /international/i.test(value) : /\blocal\b/i.test(value) && !/international/i.test(value));
}
function buildFillPlan(questions, mapping, profile, date, course) {
  if (!verifyQuestions(questions, mapping)) throw Error("\u8868\u5355\u9898\u76EE\u53D1\u751F\u53D8\u5316\uFF0C\u5DF2\u505C\u6B62\u3002");
  return mapping.map((entry, i) => {
    const q = questions[i];
    let value;
    const expectedType = ["student", "name"].includes(entry.field) ? "text" : entry.field === "date" ? "date" : /^(?:delivery|local)(?::|$)/.test(entry.field) ? "radio" : null;
    if (expectedType && q.type !== expectedType) throw Error(`\u7B2C ${i + 1} \u9898\u6620\u5C04\u4E0E\u9898\u578B\u4E0D\u4E00\u81F4\uFF0C\u672A\u63D0\u4EA4\u3002`);
    if (entry.field === "student") value = profile.student;
    else if (entry.field === "name") value = profile.name;
    else if (entry.field === "date") value = formatDate(q.placeholder, date);
    else if (entry.field === "delivery" || ["delivery:lecture", "delivery:tutorial", "delivery:lab", "delivery:laboratory"].includes(entry.field)) {
      const target = entry.field === "delivery" ? deliveryFromCourse(course) : entry.field.split(":")[1];
      value = deliveryOption(q.options || [], target === "laboratory" ? "lab" : target);
    } else if (entry.field === "local" || ["local:local", "local:international"].includes(entry.field)) {
      const target = entry.field === "local" ? profile.studentType : entry.field.split(":")[1];
      value = identityOption(q.options || [], target);
    } else throw Error(`\u672A\u914D\u7F6E\u7B2C ${i + 1} \u9898\u3002`);
    if (!value) throw Error(`\u7B2C ${i + 1} \u9898\u6CA1\u6709\u5339\u914D\u7684\u7B54\u6848\u3002`);
    return { type: q.type, value, field: entry.field };
  });
}

// src/bindings.js
function moduleKey(course) {
  const text = String(course || "").trim();
  return text.match(/\b[A-Za-z]{2,}\d{3,}\b/)?.[0].toUpperCase() || text;
}
function bindingForCourse(bindings, course) {
  const key = moduleKey(course), binding = bindings?.[key];
  return binding?.scope === "module" || String(course || "").trim() === key ? binding : void 0;
}
function validateBindingForCourse(binding, course, profile, date) {
  if (!binding?.verified) throw Error(`${moduleKey(course)} \u5C1A\u672A\u7ED1\u5B9A\u5E76\u6838\u5BF9\u5171\u7528\u8868\u5355\u3002`);
  if (!binding.questions) return null;
  const plan = buildFillPlan(binding.questions, binding.mapping, profile, date, course);
  for (const [i, entry] of binding.mapping.entries()) {
    if (!entry.field?.startsWith("delivery:")) continue;
    const automatic = binding.mapping.map((item, index) => index === i ? { ...item, field: "delivery" } : item);
    let expected;
    try {
      expected = buildFillPlan(binding.questions, automatic, profile, date, course)[i].value;
    } catch (error) {
      if (/无法判断此课程类型/.test(error.message)) continue;
      throw error;
    }
    if (plan[i].value !== expected) throw Error(`${course} \u7684\u56FA\u5B9A\u8BFE\u578B\u4E0E\u8BFE\u7A0B\u540D\u79F0\u4E0D\u4E00\u81F4\uFF0C\u8BF7\u91CD\u65B0\u6838\u5BF9\u5171\u7528\u8868\u5355\u3002`);
  }
  return plan;
}

// src/cloud.js
var API_URL = "https://qckpwckfukyurkobrsig.supabase.co/functions/v1/device-api";
async function call(action, body = {}, token = "", timeoutMs = 1e4) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([(async () => {
      const response = await fetch(API_URL, { method: "POST", headers, body: JSON.stringify({ action, ...body }), signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(data.error || `\u4E91\u7AEF\u8BF7\u6C42\u5931\u8D25\uFF08${response.status}\uFF09`);
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
var initialization;
function ensureCloudDevice() {
  if (!initialization) initialization = initializeDevice().finally(() => {
    initialization = null;
  });
  return initialization;
}
async function initializeDevice() {
  const data = await chrome.storage.local.get(["attendanceCloudToken", "attendanceCloudDeviceId", "attendanceCloudDeviceKey", "attendanceCloudRegistrationToken", "attendanceNtfyTopic"]);
  if (data.attendanceCloudToken && data.attendanceCloudDeviceId) {
    if (data.attendanceNtfyTopic) return data;
    const topic = await call("ntfy-topic", {}, data.attendanceCloudToken);
    const next2 = { attendanceNtfyTopic: topic.ntfyTopic };
    await chrome.storage.local.set(next2);
    return { ...data, ...next2 };
  }
  const deviceKey = data.attendanceCloudDeviceKey || `chrome-${crypto.randomUUID()}`;
  if (data.attendanceCloudDeviceId || data.attendanceCloudToken) throw Error("\u8BBE\u5907\u4E91\u7AEF\u51ED\u8BC1\u4E0D\u5B8C\u6574\uFF0C\u8BF7\u8054\u7CFB\u652F\u6301\uFF1B\u672C\u673A\u81EA\u52A8\u6253\u5361\u4ECD\u53EF\u4F7F\u7528\u3002");
  const proof = data.attendanceCloudRegistrationToken || [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  await chrome.storage.local.set({ attendanceCloudDeviceKey: deviceKey, attendanceCloudRegistrationToken: proof });
  const result = await call("register", { deviceKey, deviceName: "Soton Auto-Check \xB7 Chrome" }, proof);
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
      validateBindingForCourse(binding, session.course, profile, todayMalaysia());
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
async function redeemActivationKey(activationKey) {
  const cloud = await ensureCloudDevice();
  return call("redeem-activation-key", { activationKey }, cloud.attendanceCloudToken);
}

// src/outbox.js
function enqueue(snapshot = {}, action, payload, now = Date.now()) {
  const q = { version: snapshot.version || 0, items: [...snapshot.items || []] };
  const logical = action === "sync" ? "sync" : action === "event" ? `event:${payload.occurrenceKey}` : `${action}:${payload.sessionId}`;
  if (action !== "sync" && q.items.some((item) => item.logical === logical)) return q;
  if (action === "sync") {
    q.version = Math.max(q.version + 1, now);
    q.items = q.items.filter((item) => item.action !== "sync");
    payload = { ...payload, version: q.version };
  }
  q.items.push({ id: crypto.randomUUID(), logical, action, payload, attempts: 0, availableAt: now });
  return q;
}
var acknowledge = (q, id) => ({ ...q, items: (q.items || []).filter((item) => item.id !== id), lastSuccessAt: (/* @__PURE__ */ new Date()).toISOString() });
function fail(q, id, error, now = Date.now()) {
  return { ...q, items: (q.items || []).map((item) => item.id !== id ? item : { ...item, attempts: item.attempts + 1, lastError: String(error).slice(0, 300), availableAt: now + Math.min(36e5, 15e3 * 2 ** Math.min(item.attempts, 8)) }) };
}
var nextReady = (q, now = Date.now()) => (q.items || []).find((item) => item.availableAt <= now);

// src/setup.js
var itemTerminal = (state) => ["passed", "failed", "cancelled", "timed_out"].includes(state);
function coverageRevision(course, binding, profile) {
  const plan = validateBindingForCourse(binding, course, profile, todayMalaysia());
  if (!plan?.length) throw Error(`${moduleKey(course)} \u9700\u8981\u91CD\u65B0\u8BFB\u53D6\u5E76\u4FDD\u5B58\u8868\u5355\u9898\u76EE\u3002`);
  return JSON.stringify({ profile: { student: profile.student, name: profile.name, studentType: profile.studentType }, url: binding.url, title: binding.title, questions: binding.questions, mapping: binding.mapping, answers: plan.map((e) => e.type === "date" ? { ...e, value: "<today>" } : e) });
}
function buildVariants(tasks, bindings, profile) {
  const variants = /* @__PURE__ */ new Map();
  for (const task of tasks) {
    const course = task.course, binding = bindingForCourse(bindings, course);
    const revision = coverageRevision(course, binding, profile);
    const plan = validateBindingForCourse(binding, course, profile, todayMalaysia());
    const delivery = plan.filter((e) => e.field.startsWith("delivery")).map((e) => e.value).join(" / ");
    const key = JSON.stringify([moduleKey(course), String(course).trim().toUpperCase().replace(/\s+/g, " "), binding.url, delivery, revision]);
    if (!variants.has(key)) variants.set(key, { id: crypto.randomUUID(), key, revision, course, delivery, state: "queued" });
  }
  if (!variants.size) throw Error("\u8BF7\u5148\u6DFB\u52A0\u8BFE\u7A0B\u5E76\u6838\u5BF9\u8868\u5355\u7ED1\u5B9A\u3002");
  if (variants.size > 200) throw Error("\u4E00\u6B21\u6700\u591A\u68C0\u67E5 200 \u4E2A\u8868\u5355\u8BFE\u578B\u3002");
  return [...variants.values()];
}
function updateItem(session, tabId, state, detail = "") {
  const item = session.items.find((row) => row.tabId === tabId);
  if (session.state !== "running" || !item || item.tabId !== tabId || itemTerminal(item.state)) throw Error("\u68C0\u67E5\u5DF2\u7ED3\u675F\u6216\u9875\u9762\u4E0D\u5339\u914D\u3002");
  const allowed2 = { opening: ["filling", "failed", "cancelled", "timed_out"], filling: ["awaiting_confirmation", "failed", "cancelled", "timed_out"], awaiting_confirmation: ["failed", "cancelled", "timed_out"] };
  if (!allowed2[item.state]?.includes(state)) throw Error("\u65E0\u6548\u7684\u8BBE\u7F6E\u68C0\u67E5\u72B6\u6001\u3002");
  return { ...session, items: session.items.map((row) => row === item ? { ...row, state, detail: String(detail).slice(0, 500), at: (/* @__PURE__ */ new Date()).toISOString() } : row) };
}
function confirmItem(session, tabId, revision) {
  const item = session.items.find((row) => row.tabId === tabId);
  if (session.state !== "running" || item?.tabId !== tabId || item.state !== "awaiting_confirmation" || item.revision !== revision) throw Error("\u68C0\u67E5\u672A\u5C31\u7EEA\u6216\u914D\u7F6E\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u68C0\u67E5\u3002");
  return { ...session, items: session.items.map((row) => row === item ? { ...row, state: "passed", confirmedAt: (/* @__PURE__ */ new Date()).toISOString() } : row) };
}

// src/settings-sender.js
function isSettingsSender(sender, runtime = chrome.runtime) {
  if (!sender || sender.id && sender.id !== runtime.id) return false;
  try {
    const url = new URL(sender.url || sender.documentUrl || sender.tab?.url || "");
    url.hash = "";
    url.search = "";
    return url.href === runtime.getURL("options.html");
  } catch {
    return false;
  }
}

// src/setup-coordinator.js
function setupCoordinator(enqueueCloud2) {
  const read = () => chrome.storage.local.get(["attendanceSetupSession", "attendanceSetupHistory", "attendanceSessions", "attendanceDraft", "attendanceBindings", "attendanceProfile"]);
  async function save(session) {
    const { attendanceSetupHistory: history = [] } = await read();
    const values = { attendanceSetupSession: session, attendanceSetupHistory: [...history.filter((s) => s.id !== session.id), session] };
    if (session.state === "completed" && !session.summaryEnqueued) {
      session = { ...session, summaryEnqueued: true };
      values.attendanceSetupSession = session;
      values.attendanceSetupHistory = values.attendanceSetupHistory.map((s) => s.id === session.id ? session : s);
      await enqueueCloud2("setup-summary", { sessionId: session.id, count: session.items.length, passed: session.items.filter((i) => i.state === "passed").length }, values);
    } else await chrome.storage.local.set(values);
    return session;
  }
  async function advance(session) {
    if (session.state !== "running") return session;
    for (let n = 0; n < session.items.length; n++) {
      if (session.items[n].state !== "queued") continue;
      let item = { ...session.items[n], state: "opening", deadline: Date.now() + 6e5 };
      session = { ...session, items: session.items.map((i, index) => index === n ? item : i) };
      await save(session);
      try {
        const data = await read(), binding = bindingForCourse(data.attendanceBindings, item.course);
        if (coverageRevision(item.course, binding, data.attendanceProfile) !== item.revision) throw Error("\u914D\u7F6E\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u68C0\u67E5\u3002");
        const tab = await chrome.tabs.create({ url: "about:blank", active: n === 0 });
        item = { ...item, tabId: tab.id };
        session = { ...session, items: session.items.map((i, index) => index === n ? item : i) };
        await save(session);
        const url = validateFormsUrl(binding.url);
        url.hash = new URLSearchParams({ attendanceSetup: session.id, attendanceItem: item.id }).toString();
        await chrome.tabs.update(tab.id, { url: url.href });
      } catch (error) {
        session = { ...session, items: session.items.map((i, index) => index === n ? { ...i, state: "failed", detail: error.message } : i) };
        await save(session);
      }
    }
    const pending = session.items.filter((i) => !itemTerminal(i.state));
    if (!pending.length) {
      await chrome.alarms.clear(`attendance-setup:${session.id}`);
      return save({ ...session, state: "completed", completedAt: (/* @__PURE__ */ new Date()).toISOString() });
    }
    await chrome.alarms.create(`attendance-setup:${session.id}`, { when: Math.min(...pending.map((i) => i.deadline)) });
    return session;
  }
  async function handle(message, sender) {
    const data = await read();
    let session = data.attendanceSetupSession;
    if (message.type === "START_SETUP") {
      if (!isSettingsSender(sender)) throw Error("\u8BF7\u4ECE\u6269\u5C55\u8BBE\u7F6E\u9875\u5F00\u59CB\u68C0\u67E5\u3002");
      if (session?.state === "running") throw Error("\u5DF2\u6709\u8BFE\u578B\u68C0\u67E5\u8FDB\u884C\u4E2D\uFF0C\u8BF7\u5148\u5B8C\u6210\u6216\u53D6\u6D88\u5F53\u524D\u68C0\u67E5\uFF0C\u518D\u5F00\u59CB\u65B0\u7684\u68C0\u67E5\u3002");
      const intended = [...data.attendanceSessions || [], ...data.attendanceDraft?.rows || []].filter((row) => !message.moduleKey || moduleKey(row.course) === message.moduleKey);
      session = { id: crypto.randomUUID(), state: "running", current: 0, startedAt: (/* @__PURE__ */ new Date()).toISOString(), items: buildVariants(intended, data.attendanceBindings, data.attendanceProfile) };
      return { session: await advance(await save(session)) };
    }
    if (!session || session.state !== "running") throw Error("\u6CA1\u6709\u6B63\u5728\u8FDB\u884C\u7684\u8BBE\u7F6E\u68C0\u67E5\u3002");
    if (message.type === "CANCEL_SETUP") {
      if (!isSettingsSender(sender)) throw Error("\u8BF7\u4ECE\u6269\u5C55\u8BBE\u7F6E\u9875\u53D6\u6D88\u68C0\u67E5\u3002");
      await chrome.alarms.clear(`attendance-setup:${session.id}`);
      return { session: await save({ ...session, state: "cancelled", cancelledAt: (/* @__PURE__ */ new Date()).toISOString(), items: session.items.map((i) => itemTerminal(i.state) ? i : { ...i, state: "cancelled", detail: "\u5B66\u751F\u53D6\u6D88\u68C0\u67E5\uFF0C\u672A\u63D0\u4EA4\u3002" }) }) };
    }
    if (message.type === "CONFIRM_ALL_SETUP_ITEMS") {
      if (!isSettingsSender(sender)) throw Error("\u8BF7\u4ECE\u6269\u5C55\u8BBE\u7F6E\u9875\u786E\u8BA4\u5168\u90E8\u8BFE\u578B\u3002");
      const incomplete = session.items.filter((i) => !["awaiting_confirmation", "passed"].includes(i.state));
      if (incomplete.length) throw Error(`\u8FD8\u6709 ${incomplete.length} \u4E2A\u8BFE\u578B\u5C1A\u672A\u586B\u5199\u5B8C\u6210\uFF0C\u8BF7\u7B49\u5F85\u68C0\u67E5\u9875\u51C6\u5907\u597D\u3002`);
      if (!session.items.some((i) => i.state === "awaiting_confirmation")) throw Error("\u6CA1\u6709\u7B49\u5F85\u786E\u8BA4\u7684\u8BFE\u578B\u3002");
      for (const item2 of session.items) {
        const binding2 = bindingForCourse(data.attendanceBindings, item2.course);
        if (coverageRevision(item2.course, binding2, data.attendanceProfile) !== item2.revision) throw Error(`\u914D\u7F6E\u5DF2\u53D8\u5316\uFF1A${item2.course}\uFF0C\u8BF7\u91CD\u65B0\u6D4B\u8BD5\u3002`);
      }
      const confirmedAt = (/* @__PURE__ */ new Date()).toISOString();
      await chrome.alarms.clear(`attendance-setup:${session.id}`);
      session = { ...session, state: "completed", completedAt: confirmedAt, items: session.items.map((item2) => item2.state === "passed" ? item2 : { ...item2, state: "passed", confirmedAt }) };
      return { session: await save(session) };
    }
    const item = session.items.find((i) => i.id === message.itemId);
    if (message.sessionId !== session.id || !item || !Number.isInteger(sender.tab?.id) || sender.tab.id !== item.tabId) throw Error("\u8BBE\u7F6E\u68C0\u67E5\u4E0E\u5F53\u524D\u9875\u9762\u4E0D\u5339\u914D\u3002");
    const binding = bindingForCourse(data.attendanceBindings, item.course);
    if (message.type === "REPORT_SETUP_ITEM" && message.state === "failed") {
      session = updateItem(session, item.tabId, "failed", message.detail);
    } else {
      const revision = coverageRevision(item.course, binding, data.attendanceProfile);
      if (revision !== item.revision) {
        await advance(await save(updateItem(session, item.tabId, "failed", "\u914D\u7F6E\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u68C0\u67E5\u3002")));
        throw Error("\u914D\u7F6E\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u68C0\u67E5\u3002");
      }
      if (message.type === "GET_SETUP_ITEM") {
        if (item.state !== "opening") throw Error("\u8BE5\u9875\u9762\u5DF2\u5F00\u59CB\u6216\u5B8C\u6210\u68C0\u67E5\u3002");
        await save(updateItem(session, item.tabId, "filling"));
        return { course: item.course, binding, profile: data.attendanceProfile, revision: item.revision };
      }
      if (message.type === "CONFIRM_SETUP_ITEM") session = confirmItem(session, item.tabId, revision);
      else if (message.type === "REPORT_SETUP_ITEM") session = updateItem(session, item.tabId, message.state, message.detail);
      else throw Error("\u672A\u77E5\u68C0\u67E5\u64CD\u4F5C\u3002");
    }
    return { session: await advance(await save(session)) };
  }
  async function resume() {
    let { attendanceSetupSession: session } = await read();
    if (session?.state !== "running") return;
    for (const item of session.items) {
      if (item.state === "queued" || itemTerminal(item.state)) continue;
      let state;
      if (item.deadline <= Date.now()) state = "timed_out";
      else {
        try {
          await chrome.tabs.get(item.tabId);
        } catch {
          state = "cancelled";
        }
      }
      if (state) session = updateItem(session, item.tabId, state, state === "timed_out" ? "\u68C0\u67E5\u8D85\u65F6\uFF0C\u672A\u901A\u8FC7\uFF1B\u8BF7\u68C0\u67E5\u5B66\u6821\u767B\u5F55\u3002" : "\u68C0\u67E5\u9875\u9762\u5DF2\u5173\u95ED\uFF0C\u672A\u901A\u8FC7\u3002");
    }
    return advance(await save(session));
  }
  async function closed(tabId) {
    const { attendanceSetupSession: session } = await read();
    if (session?.state !== "running" || !session.items.some((i) => i.tabId === tabId && !itemTerminal(i.state))) return;
    return advance(await save(updateItem(session, tabId, "cancelled", "\u68C0\u67E5\u9875\u9762\u5DF2\u5173\u95ED\uFF0C\u672A\u901A\u8FC7\u3002")));
  }
  return { handle, resume, closed };
}

// src/configuration.js
function validateSession(input) {
  if (!input || !["weekly", "dated"].includes(input.kind)) throw Error("\u4EFB\u52A1\u7C7B\u578B\u65E0\u6548\u3002");
  if (input.kind === "weekly" && (!Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6)) throw Error("\u6BCF\u5468\u661F\u671F\u987B\u4E3A 0\u20136 \u7684\u6574\u6570\u3002");
  if (input.kind === "dated" && !normalizeDate(input.date)) throw Error("\u4EFB\u52A1\u65E5\u671F\u65E0\u6548\u3002");
  const row = { ...toWeeklySession(input), course: String(input.course || "").trim() };
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{1,63}$/.test(row.course)) throw Error("\u8BFE\u7A0B\u540D\u79F0\u987B\u4E3A 2\u201364 \u4E2A\u82F1\u6587\u5B57\u6BCD\u3001\u6570\u5B57\u3001\u7A7A\u683C\u3001\u4E0B\u5212\u7EBF\u6216\u8FDE\u5B57\u7B26\u3002");
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.time) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.endTime) || row.endTime <= row.time) throw Error(`${row.course} \u7684\u8D77\u6B62\u65F6\u95F4\u65E0\u6548\u3002`);
  if (!Array.isArray(input.exceptions || []) || (input.exceptions || []).length > 366) throw Error("\u505C\u8BFE\u65E5\u671F\u683C\u5F0F\u65E0\u6548\u3002");
  row.exceptions = [...new Set((input.exceptions || []).map(normalizeDate))].sort();
  if (row.exceptions.some((d) => !d)) throw Error(`${row.course} \u7684\u505C\u8BFE\u65E5\u671F\u65E0\u6548\u3002`);
  if (input.enabled !== void 0 && typeof input.enabled !== "boolean") throw Error("\u4EFB\u52A1\u542F\u7528\u72B6\u6001\u65E0\u6548\u3002");
  return row;
}

// src/backup.js
var terminal = (state) => ["success", "failed", "unknown", "missed"].includes(state);
function validateBackup(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || input.format !== "soton-attendance-configuration" || input.version !== 1) throw Error("\u4E0D\u662F\u652F\u6301\u7684 Attendance \u914D\u7F6E\u5907\u4EFD\u3002");
  const allowed2 = ["format", "version", "exportedAt", "profile", "bindings", "sessions", "records"];
  if (Object.keys(input).some((k) => !allowed2.includes(k))) throw Error("\u5907\u4EFD\u5305\u542B\u4E0D\u652F\u6301\u7684\u5B57\u6BB5\u6216\u51ED\u8BC1\uFF0C\u672A\u5BFC\u5165\u3002");
  if (!Array.isArray(input.sessions) || input.sessions.length > 200 || !input.bindings || typeof input.bindings !== "object" || Array.isArray(input.bindings) || !input.records || typeof input.records !== "object" || Array.isArray(input.records)) throw Error("\u5907\u4EFD\u7ED3\u6784\u65E0\u6548\u3002");
  if (input.profile && (!/^(local|international)$/.test(input.profile.studentType) || typeof input.profile.student !== "string" || !input.profile.student.trim() || input.profile.student.length > 50 || typeof input.profile.name !== "string" || !input.profile.name.trim() || input.profile.name.length > 100 || Object.keys(input.profile).some((k) => !["student", "name", "studentType"].includes(k)))) throw Error("\u5907\u4EFD\u5B66\u751F\u8D44\u6599\u65E0\u6548\u3002");
  const ids = /* @__PURE__ */ new Set();
  for (const row of input.sessions) {
    validateSession(row);
    if (typeof row.id !== "string" || !row.id || ids.has(row.id)) throw Error("\u5907\u4EFD\u4EFB\u52A1 ID \u65E0\u6548\u6216\u91CD\u590D\u3002");
    ids.add(row.id);
    if (Object.keys(row).some((k) => !["id", "kind", "course", "weekday", "time", "endTime", "exceptions", "enabled"].includes(k))) throw Error("\u5907\u4EFD\u4EFB\u52A1\u5305\u542B\u4E0D\u652F\u6301\u7684\u72B6\u6001\u3002");
  }
  if (Object.keys(input.bindings).length > 200) throw Error("\u5907\u4EFD\u7ED1\u5B9A\u6570\u91CF\u8FC7\u591A\u3002");
  for (const [key, b] of Object.entries(input.bindings)) {
    if (["__proto__", "constructor", "prototype"].includes(key) || !b || typeof b !== "object" || typeof b.title !== "string" || b.title.length > 500 || typeof b.verified !== "boolean") throw Error("\u5907\u4EFD\u8868\u5355\u7ED1\u5B9A\u65E0\u6548\u3002");
    validateFormsUrl(b.url);
    if (Object.keys(b).some((k) => !["scope", "url", "title", "questions", "mapping", "verified"].includes(k))) throw Error("\u5907\u4EFD\u7ED1\u5B9A\u5305\u542B\u4E0D\u652F\u6301\u7684\u5B57\u6BB5\u3002");
    if (b.questions !== void 0 && (!Array.isArray(b.questions) || b.questions.length > 100 || !verifyQuestions(b.questions, b.mapping) || b.questions.some((q) => !["text", "radio", "date"].includes(q.type)))) throw Error("\u5907\u4EFD\u8868\u5355\u9898\u76EE\u65E0\u6548\u3002");
  }
  if (Object.keys(input.records).length > 1e4) throw Error("\u5907\u4EFD\u8BB0\u5F55\u6570\u91CF\u8FC7\u591A\u3002");
  for (const r of Object.values(input.records)) {
    if (!r || !terminal(r.state) || !r.occ || !normalizeDate(r.occ.date) || typeof r.occ.key !== "string" || !r.occ.key || typeof r.at !== "string" || !Number.isFinite(Date.parse(r.at))) throw Error("\u5907\u4EFD\u53EA\u80FD\u5305\u542B\u6709\u6548\u7684\u5DF2\u7ED3\u675F\u8BB0\u5F55\u3002");
    if (r.formUrl) validateFormsUrl(r.formUrl);
    if (Object.keys(r).some((k) => !["state", "at", "detail", "formUrl", "occ"].includes(k))) throw Error("\u5907\u4EFD\u5305\u542B\u8FD0\u884C\u4E2D\u72B6\u6001\uFF0C\u672A\u5BFC\u5165\u3002");
  }
  return input;
}
function restoreBackup(input, current, now = (/* @__PURE__ */ new Date()).toISOString()) {
  const b = validateBackup(input), records = {};
  for (const r of Object.values(b.records)) records[r.occ.key] = r;
  for (const r of Object.values(current.attendanceRecords || {})) if (r.occ?.key) records[r.occ.key] = r;
  return { attendanceProfile: b.profile || {}, attendanceBindings: b.bindings, attendanceSessions: b.sessions.map((s) => ({ ...validateSession(s), createdAt: now, enabled: false })), attendanceRecords: records, attendanceScheduleMode: "weekly", attendanceDraft: { version: 1, rows: [], reviewedAt: null }, attendanceSetupCoverageEpoch: now, attendanceSetupSession: null };
}

// src/background.js
var NEXT = "attendance-next";
var MAINTENANCE = "attendance-maintenance";
var CLOUD = "attendance-cloud";
var cloudEnabled = () => Boolean(chrome.runtime?.id);
var queue = Promise.resolve();
var serialized = (fn) => {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {
  });
  return next;
};
var daysFrom = (date, offset) => {
  const d = /* @__PURE__ */ new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
async function load() {
  const data = await chrome.storage.local.get(["attendanceSessions", "attendanceBindings", "attendanceProfile", "attendanceRecords", "attendanceScheduleMode"]);
  if (data.attendanceScheduleMode !== "weekly") {
    const sessions = mergeSessions([], (data.attendanceSessions || []).map(toWeeklySession));
    await chrome.storage.local.set({ attendanceSessions: sessions, attendanceScheduleMode: "weekly" });
    data.attendanceSessions = sessions;
  }
  return data;
}
var saveRecords = (records) => chrome.storage.local.set({ attendanceRecords: records });
async function enqueueCloud(action, payload, extra = {}) {
  if (!cloudEnabled()) return chrome.storage.local.set(extra);
  const { attendanceCloudOutbox: q = {} } = await chrome.storage.local.get("attendanceCloudOutbox");
  const next = enqueue(q, action, payload);
  await chrome.storage.local.set({ ...extra, attendanceCloudOutbox: next });
  await chrome.alarms.create(CLOUD, { when: Date.now() + 1e3 });
}
async function persistTerminal(records, key) {
  const r = records[key], o = r.occ;
  await enqueueCloud("event", { status: r.state, courseCode: o.course, classDate: o.date, startTime: o.time, endTime: o.endTime, formUrl: r.formUrl || void 0, occurrenceKey: o.key, detail: r.detail }, { attendanceRecords: records });
}
var draining = false;
var setup = setupCoordinator(enqueueCloud);
async function drainCloud() {
  if (draining || !cloudEnabled()) return;
  draining = true;
  try {
    for (let count = 0; count < 20; count++) {
      const item = await serialized(async () => {
        const { attendanceCloudOutbox: q = {} } = await chrome.storage.local.get("attendanceCloudOutbox");
        return nextReady(q);
      });
      if (!item) break;
      let error;
      try {
        await deliverCloud(item);
      } catch (e) {
        error = e.message;
      }
      await serialized(async () => {
        const { attendanceCloudOutbox: q = {} } = await chrome.storage.local.get("attendanceCloudOutbox");
        await chrome.storage.local.set({ attendanceCloudOutbox: error ? fail(q, item.id, error) : acknowledge(q, item.id) });
      });
    }
    await serialized(async () => {
      const { attendanceCloudOutbox: q = {} } = await chrome.storage.local.get("attendanceCloudOutbox");
      if (q.items?.length) await chrome.alarms.create(CLOUD, { when: Math.max(Date.now() + 1e3, Math.min(...q.items.map((i) => i.availableAt))) });
    });
  } finally {
    draining = false;
  }
}
async function notify(title, message, id = crypto.randomUUID()) {
  try {
    await chrome.notifications.create(id, { type: "basic", iconUrl: chrome.runtime.getURL("icon.png"), title, message, priority: 1 });
  } catch (error) {
    console.warn("\u7CFB\u7EDF\u901A\u77E5\u4E0D\u53EF\u7528", error.message);
  }
}
async function nextAlarm(sessions, records) {
  await chrome.alarms.clear(NEXT);
  await chrome.alarms.clear("attendance-evening");
  const today = todayMalaysia(), future = occurrencesBetween(sessions, today, daysFrom(today, 32));
  const next = future.filter((o) => !records[o.key] && triggerTimestamp(o) > Date.now() && triggerTimestamp(o) >= Date.parse(o.createdAt || "1970-01-01")).sort((a, b) => triggerTimestamp(a) - triggerTimestamp(b))[0];
  if (next) await chrome.alarms.create(NEXT, { when: triggerTimestamp(next) });
  await chrome.alarms.create(MAINTENANCE, { periodInMinutes: 60 });
}
async function processSchedule() {
  const { attendanceSessions: sessions = [], attendanceBindings: bindings = {}, attendanceProfile: profile = {}, attendanceRecords: stored = {} } = await load();
  const records = { ...stored }, today = todayMalaysia(), now = Date.now();
  for (const [key, r] of Object.entries(records)) {
    if (!["launched", "pending"].includes(r.state)) continue;
    const deadline = r.watchDeadline || Date.parse(r.at) + 9e4;
    if (deadline <= now) {
      await watchdog(key);
      Object.assign(records, (await chrome.storage.local.get("attendanceRecords")).attendanceRecords);
    } else await chrome.alarms.create(`attendance-watch:${key}`, { when: deadline });
  }
  const missedCourses = [];
  for (const occ of occurrencesBetween(sessions, daysFrom(today, -7), today)) {
    const due = triggerTimestamp(occ);
    if (records[occ.key] || due > now || due < Date.parse(occ.createdAt || "1970-01-01")) continue;
    const action = dueAction(due, now);
    if (action === "missed") {
      records[occ.key] = { ...transition("scheduled", "missed"), occ, detail: "Chrome \u672A\u5728\u6253\u5361\u65F6\u95F4\u8FD0\u884C\uFF0C\u6216\u5B9A\u65F6\u4E8B\u4EF6\u5EF6\u8FDF\u3002" };
      await persistTerminal(records, occ.key);
      missedCourses.push(occ.course);
      continue;
    }
    const binding = bindingForCourse(bindings, occ.course);
    try {
      validateBindingForCourse(binding, occ.course, profile, occ.date);
    } catch (error) {
      records[occ.key] = { ...transition("scheduled", "missed"), occ, detail: error.message };
      await persistTerminal(records, occ.key);
      missedCourses.push(occ.course);
      continue;
    }
    records[occ.key] = { ...transition("scheduled", "launched"), occ, formUrl: binding.url, configuration: JSON.stringify({ binding, profile }), watchDeadline: Date.now() + 9e4 };
    await saveRecords(records);
    try {
      const tab = await chrome.tabs.create({ url: "about:blank", active: false });
      records[occ.key].tabId = tab.id;
      await saveRecords(records);
      await chrome.alarms.create(`attendance-watch:${occ.key}`, { when: records[occ.key].watchDeadline });
      const url = validateFormsUrl(binding.url);
      url.hash = new URLSearchParams({ attendanceRun: occ.key }).toString();
      await chrome.tabs.update(tab.id, { url: url.href });
    } catch (error) {
      records[occ.key] = { ...records[occ.key], ...transition("launched", "failed"), detail: error.message };
      await persistTerminal(records, occ.key);
      await notify("\u6253\u5361\u672A\u6267\u884C", `${occ.course}\uFF1A${error.message}`);
    }
  }
  await saveRecords(records);
  await enqueueCloud("sync", cloudSnapshot({ sessions, bindings, profile }));
  if (missedCourses.length) await notify("\u8BF7\u624B\u52A8\u5904\u7406\u8BFE\u7A0B\u6253\u5361", `${missedCourses.join("\u3001")} \u672A\u81EA\u52A8\u63D0\u4EA4\u3002\u8BF7\u6253\u5F00\u6269\u5C55\u67E5\u770B\u539F\u56E0\u3002`);
  await nextAlarm(sessions, records);
  await setup.resume();
}
async function report(message, sender) {
  const { attendanceRecords: records = {}, attendanceSessions: sessions = [], attendanceProfile: profile = {}, attendanceBindings: bindings = {} } = await chrome.storage.local.get(["attendanceRecords", "attendanceSessions", "attendanceProfile", "attendanceBindings"]);
  const record = records[message.key];
  if (!record || record.tabId !== sender.tab?.id) throw Error("\u6253\u5361\u4EFB\u52A1\u4E0E\u5F53\u524D\u9875\u9762\u4E0D\u5339\u914D\u3002");
  if (message.state === "pending" && !currentTask(sessions, record)) throw Error("\u6253\u5361\u4EFB\u52A1\u5DF2\u5220\u9664\u3001\u6682\u505C\u6216\u4FEE\u6539\uFF0C\u672A\u63D0\u4EA4\u3002");
  if (message.state === "pending" && (record.occ.date !== todayMalaysia() || record.configuration && record.configuration !== JSON.stringify({ binding: bindingForCourse(bindings, record.occ.course), profile }))) throw Error("\u4EFB\u52A1\u65E5\u671F\u6216\u914D\u7F6E\u5DF2\u53D8\u5316\uFF0C\u672A\u6388\u6743\u63D0\u4EA4\u3002");
  const next = transition(record.state, message.state);
  records[message.key] = { ...record, ...next, detail: String(message.detail || "").slice(0, 500) };
  if (["success", "failed", "unknown", "missed"].includes(next.state)) await persistTerminal(records, message.key);
  else await saveRecords(records);
  if (["success", "failed", "unknown"].includes(next.state)) {
    await chrome.alarms.clear(`attendance-watch:${message.key}`);
    const title = next.state === "success" ? "\u6253\u5361\u6210\u529F" : next.state === "unknown" ? "\u6253\u5361\u7ED3\u679C\u4E0D\u660E" : "\u6253\u5361\u5931\u8D25";
    await notify(title, `${record.occ.course} \xB7 ${record.occ.date} ${record.occ.time}${message.detail ? `
${message.detail}` : ""}`);
  }
  return { ok: true };
}
async function watchdog(key) {
  const { attendanceRecords: records = {} } = await chrome.storage.local.get("attendanceRecords");
  const record = records[key];
  if (!record || !["launched", "pending"].includes(record.state)) return;
  const state = record.state === "pending" ? "unknown" : "failed";
  records[key] = { ...record, ...transition(record.state, state), detail: state === "failed" ? "\u672A\u80FD\u8BFB\u53D6\u8868\u5355\uFF0C\u8BF7\u68C0\u67E5\u5B66\u6821\u767B\u5F55\u72B6\u6001\u3002" : "\u5DF2\u5F00\u59CB\u63D0\u4EA4\uFF0C\u4F46\u672A\u6536\u5230\u660E\u786E\u6210\u529F\u53CD\u9988\u3002" };
  await persistTerminal(records, key);
  await notify(state === "unknown" ? "\u6253\u5361\u7ED3\u679C\u4E0D\u660E" : "\u6253\u5361\u5931\u8D25", `${record.occ.course}\uFF1A${records[key].detail}`);
}
function currentTask(sessions, r) {
  return sessions.some((s) => s.id === r.occ.id && s.enabled !== false && s.course === r.occ.course && s.weekday === r.occ.weekday && s.time === r.occ.time && s.endTime === r.occ.endTime && !(s.exceptions || []).includes(r.occ.date));
}
chrome.runtime.onInstalled.addListener(() => serialized(processSchedule));
chrome.runtime.onStartup.addListener(() => serialized(processSchedule));
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.alarms.onAlarm.addListener((alarm) => serialized(async () => {
  if (alarm.name === NEXT || alarm.name === MAINTENANCE) await processSchedule();
  else if (alarm.name.startsWith("attendance-watch:")) await watchdog(alarm.name.slice("attendance-watch:".length));
  else if (alarm.name.startsWith("attendance-setup:")) await setup.resume();
}).then(() => {
  if (alarm.name === CLOUD || alarm.name === MAINTENANCE) void drainCloud();
}));
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "RESTORE_BACKUP") {
    serialized(async () => {
      if (!isSettingsSender(sender)) throw Error("\u8BF7\u4ECE\u6269\u5C55\u8BBE\u7F6E\u9875\u6062\u590D\u5907\u4EFD\u3002");
      const current = await chrome.storage.local.get(["attendanceRecords", "attendanceSetupSession"]);
      if (current.attendanceSetupSession?.state === "running") await setup.handle({ type: "CANCEL_SETUP" }, sender);
      const restored = restoreBackup(message.backup, current);
      await chrome.storage.local.set(restored);
      await processSchedule();
      return { ok: true, profile: restored.attendanceProfile };
    }).then(sendResponse, (error) => sendResponse({ error: error.message }));
    return true;
  }
  if (["START_SETUP", "GET_SETUP_ITEM", "REPORT_SETUP_ITEM", "CONFIRM_SETUP_ITEM", "CONFIRM_ALL_SETUP_ITEMS", "CANCEL_SETUP"].includes(message?.type)) {
    serialized(() => setup.handle(message, sender)).then(sendResponse, (error) => sendResponse({ error: error.message }));
    return true;
  }
  if (message?.type === "CLOUD_REQUEST") {
    if (!isSettingsSender(sender)) {
      sendResponse({ error: "\u8BBE\u7F6E\u64CD\u4F5C\u53EA\u80FD\u4ECE\u6269\u5C55\u8BBE\u7F6E\u9875\u6267\u884C\u3002" });
      return false;
    }
    const operation = message.action === "device" ? ensureCloudDevice : message.action === "entitlement" ? getEntitlementStatus : message.action === "redeem" ? () => redeemActivationKey(message.activationKey) : message.action === "notifications" ? () => deliverCloud({ action: "notifications", payload: {} }) : message.action === "confirm-receipt" ? () => deliverCloud({ action: "confirm-receipt", payload: { notificationId: message.notificationId } }) : null;
    if (!operation) return false;
    operation().then((data) => {
      if (message.action === "device") {
        const { attendanceNtfyTopic, attendanceCloudDeviceId } = data;
        sendResponse({ attendanceNtfyTopic, attendanceCloudDeviceId });
      } else sendResponse(data);
    }, (error) => sendResponse({ error: error.message }));
    return true;
  }
  if (message?.type === "RETRY_CLOUD") {
    serialized(async () => {
      if (!isSettingsSender(sender)) throw Error("\u8BF7\u4ECE\u6269\u5C55\u8BBE\u7F6E\u9875\u91CD\u8BD5\u4E91\u7AEF\u8FDE\u63A5\u3002");
      const { attendanceCloudOutbox: q = {} } = await chrome.storage.local.get("attendanceCloudOutbox");
      await chrome.storage.local.set({ attendanceCloudOutbox: { ...q, items: (q.items || []).map((i) => ({ ...i, availableAt: Date.now() })) } });
      return { ok: true };
    }).then((result) => {
      sendResponse(result);
      void drainCloud();
    }, (e) => sendResponse({ error: e.message }));
    return true;
  }
  if (!["REBUILD_SCHEDULE", "GET_RUN", "REPORT_RUN"].includes(message?.type)) return false;
  serialized(async () => {
    if (message.type === "REBUILD_SCHEDULE") {
      await processSchedule();
      return { ok: true };
    }
    if (message.type === "GET_RUN") {
      const data = await load(), record = (data.attendanceRecords || {})[message.key];
      if (!record || record.tabId !== sender.tab?.id || record.state !== "launched" || !currentTask(data.attendanceSessions || [], record)) throw Error("\u4EFB\u52A1\u5DF2\u7ED3\u675F\u3001\u5DF2\u5220\u9664\uFF0C\u6216\u4E0D\u662F\u7531\u5B9A\u65F6\u5668\u542F\u52A8\u3002");
      return { occ: record.occ, binding: bindingForCourse(data.attendanceBindings, record.occ.course), profile: data.attendanceProfile };
    }
    return report(message, sender);
  }).then(sendResponse, (error) => sendResponse({ error: error.message }));
  return true;
});
chrome.tabs.onRemoved?.addListener((tabId) => serialized(() => setup.closed(tabId)));
