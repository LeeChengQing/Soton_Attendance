// Recovered V1.0.5 background runtime variant; see docs/SOURCE_DRIFT_V1.0.5.md.
import {validateSession} from '../configuration.js';
import {validateFormsUrl,verifyQuestions} from '../forms.js';
import {normalizeDate} from '../schedule.js';
var terminal = (state) => ["success", "success_manual", "failed", "unknown", "missed", "missed_sleep", "submitted_pending_confirmation"].includes(state);
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
export { validateBackup, restoreBackup };
