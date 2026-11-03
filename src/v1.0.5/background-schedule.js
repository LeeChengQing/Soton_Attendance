// Recovered V1.0.5 background runtime variant; see docs/SOURCE_DRIFT_V1.0.5.md.
import {scheduleWeekStatus} from '../runtime-timing.js';

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
      if(scheduleWeekStatus(s,Date.parse(`${date}T00:00:00+08:00`))!=='active') continue;
      if (s.kind === "dated" ? s.date !== date : s.weekday !== d.getUTCDay() || (s.exceptions || []).includes(date)) continue;
      result.push({ ...s, date, key: `${encodeURIComponent(s.course.trim().toLowerCase())}:${date}:${s.time}${s.isTest&&s.testRunId?`:TEST_${s.testRunId}`:''}` });
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
}
function toWeeklySession(session) {
  const { date } = session;
  const weekday = session.kind === "dated" ? (/* @__PURE__ */ new Date(`${normalizeDate(date)}T00:00:00Z`)).getUTCDay() : Number(session.weekday);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw Error(`${session.course || "\u8BFE\u7A0B"} \u7F3A\u5C11\u6709\u6548\u661F\u671F\u3002`);
  const weekState=scheduleWeekStatus(session);
  return { ...session, kind: "weekly", weekday,weekState,...(['needs_week_assignment','expired'].includes(weekState)?{enabled:false}:{}) };
}
var fingerprint = (s) => [s.course?.trim().toLowerCase(), s.kind, s.kind === "dated" ? s.date : s.weekday, s.time, s.endTime,s.weekStartDate].join("|");
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
export { normalizeDate, occurrencesBetween, toWeeklySession, mergeSessions, todayMalaysia, occurrenceTimestamp, triggerTimestamp };
