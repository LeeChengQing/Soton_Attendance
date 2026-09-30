// src/schedule.js
var pad = (n) => String(n).padStart(2, "0");
var iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
function normalizeDate(value) {
  const text = String(value || "").trim();
  let m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return null;
}
function occurrencesBetween(sessions, startDate, endDate) {
  const result = [];
  for (let d = /* @__PURE__ */ new Date(`${startDate}T00:00:00Z`); d <= /* @__PURE__ */ new Date(`${endDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const date = iso(d);
    for (const s of sessions) {
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
  if (url.protocol !== "https:" || !HOSTS.has(url.hostname.toLowerCase()) || !(/^\/r\/[\w-]+\/?$/.test(url.pathname) || /^\/Pages\/ResponsePage\.aspx$/i.test(url.pathname))) throw Error("\u53EA\u63A5\u53D7 Microsoft Forms \u7684\u586B\u5199\u94FE\u63A5\u3002");
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
async function call(action, body = {}, token = "") {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(API_URL, { method: "POST", headers, body: JSON.stringify({ action, ...body }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || `\u4E91\u7AEF\u8BF7\u6C42\u5931\u8D25\uFF08${response.status}\uFF09`);
  return data;
}
async function ensureCloudDevice() {
  const data = await chrome.storage.local.get(["attendanceCloudToken", "attendanceCloudDeviceId", "attendanceCloudDeviceKey", "attendanceNtfyTopic"]);
  if (data.attendanceCloudToken && data.attendanceCloudDeviceId) {
    if (data.attendanceNtfyTopic) return data;
    const topic = await call("ntfy-topic", {}, data.attendanceCloudToken);
    const next2 = { attendanceNtfyTopic: topic.ntfyTopic };
    await chrome.storage.local.set(next2);
    return { ...data, ...next2 };
  }
  const deviceKey = data.attendanceCloudDeviceKey || `chrome-${crypto.randomUUID()}`;
  const result = await call("register", { deviceKey, deviceName: "Soton Auto-Check \xB7 Chrome" });
  const next = { attendanceCloudDeviceKey: deviceKey, attendanceCloudDeviceId: result.deviceId, attendanceCloudToken: result.deviceToken, attendanceNtfyTopic: result.ntfyTopic };
  await chrome.storage.local.set(next);
  return { ...data, ...next };
}
async function syncCloud({ sessions = [], bindings = {}, preferences = {} } = {}) {
  const cloud = await ensureCloudDevice();
  const schedules = [];
  for (const session of sessions) {
    const binding = bindings[moduleKey(session.course)] || bindings[session.course];
    if (!binding?.verified || !binding.url) continue;
    schedules.push({ courseCode: session.course, courseName: session.course, weekday: Number(session.weekday), startTime: session.time, endTime: session.endTime, formUrl: binding.url, enabled: true, timezone: "Asia/Kuala_Lumpur" });
  }
  return call("sync", { schedules, preferences: { timezone: "Asia/Kuala_Lumpur", reminderTime: "19:30", remindersEnabled: preferences.remindersEnabled !== false, successNotificationsEnabled: true } }, cloud.attendanceCloudToken);
}
async function reportCloud({ record, status: status2, detail } = {}) {
  if (!record?.occ) return;
  try {
    const cloud = await ensureCloudDevice();
    const occ = record.occ;
    await call("event", { status: status2, courseCode: occ.course, classDate: occ.date, startTime: occ.time, endTime: occ.endTime, formUrl: record.formUrl || void 0, occurrenceKey: occ.key, detail }, cloud.attendanceCloudToken);
  } catch (error) {
    console.warn("\u4E91\u7AEF\u65E5\u5FD7\u4E0A\u62A5\u5931\u8D25", error);
  }
}

// src/background.js
var NEXT = "attendance-next";
var MAINTENANCE = "attendance-maintenance";
var cloudEnabled = () => Boolean(chrome.runtime?.id);
var queue = Promise.resolve();
var serialized = (fn) => {
  const next = queue.then(fn, fn);
  queue = next.catch((error) => console.error(error));
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
async function syncCloudState(data) {
  if (!cloudEnabled()) return;
  try {
    await syncCloud({ sessions: data.attendanceSessions || [], bindings: data.attendanceBindings || {} });
  } catch (error) {
    console.warn("\u4E91\u7AEF\u540C\u6B65\u5931\u8D25", error);
  }
}
async function notify(title, message, id = crypto.randomUUID()) {
  await chrome.notifications.create(id, { type: "basic", iconUrl: chrome.runtime.getURL("icon.png"), title, message, priority: 1 });
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
  if (cloudEnabled()) await ensureCloudDevice().catch((error) => console.warn("\u4E91\u7AEF\u8BBE\u5907\u6CE8\u518C\u5931\u8D25", error));
  const records = { ...stored }, today = todayMalaysia(), now = Date.now();
  const missedCourses = [];
  for (const occ of occurrencesBetween(sessions, daysFrom(today, -7), today)) {
    const due = triggerTimestamp(occ);
    if (records[occ.key] || due > now || due < Date.parse(occ.createdAt || "1970-01-01")) continue;
    const action = dueAction(due, now);
    if (action === "missed") {
      records[occ.key] = { ...transition("scheduled", "missed"), occ, detail: "Chrome \u672A\u5728\u6253\u5361\u65F6\u95F4\u8FD0\u884C\uFF0C\u6216\u5B9A\u65F6\u4E8B\u4EF6\u5EF6\u8FDF\u3002" };
      if (cloudEnabled()) await reportCloud({ record: records[occ.key], status: "missed", detail: records[occ.key].detail });
      missedCourses.push(occ.course);
      continue;
    }
    const binding = bindingForCourse(bindings, occ.course);
    try {
      validateBindingForCourse(binding, occ.course, profile, occ.date);
    } catch (error) {
      records[occ.key] = { ...transition("scheduled", "missed"), occ, detail: error.message };
      missedCourses.push(occ.course);
      continue;
    }
    const tab = await chrome.tabs.create({ url: "about:blank", active: false });
    records[occ.key] = { ...transition("scheduled", "launched"), occ, formUrl: binding.url, tabId: tab.id };
    await saveRecords(records);
    try {
      const url = validateFormsUrl(binding.url);
      url.hash = new URLSearchParams({ attendanceRun: occ.key }).toString();
      await chrome.tabs.update(tab.id, { url: url.href });
      await chrome.alarms.create(`attendance-watch:${occ.key}`, { when: Date.now() + 9e4 });
    } catch (error) {
      records[occ.key] = { ...records[occ.key], ...transition("launched", "failed"), detail: error.message };
      if (cloudEnabled()) await reportCloud({ record: records[occ.key], status: "failed", detail: error.message });
      await notify("\u6253\u5361\u672A\u6267\u884C", `${occ.course}\uFF1A${error.message}`);
    }
  }
  await saveRecords(records);
  await syncCloudState({ attendanceSessions: sessions, attendanceBindings: bindings });
  if (missedCourses.length) await notify("\u8BF7\u624B\u52A8\u5904\u7406\u8BFE\u7A0B\u6253\u5361", `${missedCourses.join("\u3001")} \u672A\u81EA\u52A8\u63D0\u4EA4\u3002\u8BF7\u6253\u5F00\u6269\u5C55\u67E5\u770B\u539F\u56E0\u3002`);
  await nextAlarm(sessions, records);
}
async function report(message, sender) {
  const { attendanceRecords: records = {}, attendanceSessions: sessions = [] } = await chrome.storage.local.get(["attendanceRecords", "attendanceSessions"]);
  const record = records[message.key];
  if (!record || record.tabId !== sender.tab?.id) throw Error("\u6253\u5361\u4EFB\u52A1\u4E0E\u5F53\u524D\u9875\u9762\u4E0D\u5339\u914D\u3002");
  if (message.state === "pending" && !sessions.some((session) => session.id === record.occ.id)) throw Error("\u6253\u5361\u4EFB\u52A1\u5DF2\u5220\u9664\uFF0C\u672A\u63D0\u4EA4\u3002");
  const next = transition(record.state, message.state);
  records[message.key] = { ...record, ...next, detail: String(message.detail || "").slice(0, 500) };
  await saveRecords(records);
  if (cloudEnabled() && ["success", "failed", "unknown", "missed"].includes(next.state)) await reportCloud({ record: records[message.key], status: next.state, detail: records[message.key].detail });
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
  await saveRecords(records);
  if (cloudEnabled()) await reportCloud({ record: records[key], status, detail: records[key].detail });
  await notify(state === "unknown" ? "\u6253\u5361\u7ED3\u679C\u4E0D\u660E" : "\u6253\u5361\u5931\u8D25", `${record.occ.course}\uFF1A${records[key].detail}`);
}
chrome.runtime.onInstalled.addListener(() => serialized(processSchedule));
chrome.runtime.onStartup.addListener(() => serialized(processSchedule));
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.alarms.onAlarm.addListener((alarm) => serialized(async () => {
  if (alarm.name === NEXT || alarm.name === MAINTENANCE) await processSchedule();
  else if (alarm.name.startsWith("attendance-watch:")) await watchdog(alarm.name.slice("attendance-watch:".length));
}));
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!["REBUILD_SCHEDULE", "GET_RUN", "REPORT_RUN"].includes(message?.type)) return false;
  serialized(async () => {
    if (message.type === "REBUILD_SCHEDULE") {
      await processSchedule();
      return { ok: true };
    }
    if (message.type === "GET_RUN") {
      const data = await load(), record = (data.attendanceRecords || {})[message.key];
      if (!record || record.tabId !== sender.tab?.id || record.state !== "launched" || !(data.attendanceSessions || []).some((session) => session.id === record.occ.id)) throw Error("\u4EFB\u52A1\u5DF2\u7ED3\u675F\u3001\u5DF2\u5220\u9664\uFF0C\u6216\u4E0D\u662F\u7531\u5B9A\u65F6\u5668\u542F\u52A8\u3002");
      return { occ: record.occ, binding: bindingForCourse(data.attendanceBindings, record.occ.course), profile: data.attendanceProfile };
    }
    return report(message, sender);
  }).then(sendResponse, (error) => sendResponse({ error: error.message }));
  return true;
});
