import {MAX_SUBMIT_DELAY_SECONDS} from './submit-delay.js';

export function scheduleWeekStart(now = Date.now(), offset = 0) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
  const date=new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7+offset*7);
  return date.toISOString().slice(0,10);
}
export function scheduleWeekStatus(session, now = Date.now()) {
  const value=session?.weekStartDate;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value||'')) return 'needs_week_assignment';
  const date=new Date(`${value}T00:00:00Z`),start=Date.parse(`${value}T00:00:00+08:00`);
  if(!Number.isFinite(start)||date.getUTCDay()!==1||date.toISOString().slice(0,10)!==value||!Number.isFinite(now)) return 'needs_week_assignment';
  return now<start?'upcoming':now<start+7*86400000?'active':'expired';
}

export const FORMS_LOAD_MS = 60000;
export const LOGIN_REDIRECT_SETTLE_MS = 4000;
export const WAKE_GRACE_MS = 300000;
export const VALIDATION_MARGIN_MS = 15000;
export const BACKGROUND_TIMER_TICK_MS = 1000;
export const DATE_PICKER_BUDGET_MS = 16000;
export const CONFIRMATION_WAIT_MS = 30000;
export const PHASE_TIMEOUTS = Object.freeze({
  opening: FORMS_LOAD_MS + LOGIN_REDIRECT_SETTLE_MS + 26000,
  reading: FORMS_LOAD_MS + 30000,
  checking: 10000,
  filling: 60000,
  submitting: MAX_SUBMIT_DELAY_SECONDS * 1000 + VALIDATION_MARGIN_MS + 10000,
  confirming: 45000
});

// Malaysia courses must have a valid same-day end time; missing data fails closed.
export function courseEndTimestamp(occ) {
  if(occ?.isTest===true && occ.testRunId && Number.isFinite(occ.testDeadline)) return occ.testDeadline;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occ?.date || '') || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(occ?.endTime || '')) return NaN;
  return Date.parse(`${occ.date}T${occ.endTime}:00+08:00`);
}
export function canSubmitBeforeEnd(occ, now, remainingMs = 0) {
  const end = courseEndTimestamp(occ);
  return scheduleWeekStatus(occ,now)==='active' && scheduleWeekStatus(occ,now+remainingMs)==='active' && Number.isFinite(end) && remainingMs >= 0 && now + remainingMs < end;
}
export function assertBeforeCourseEnd(occ, remainingMs = 0, now = Date.now()) {
  if (canSubmitBeforeEnd(occ, now, remainingMs)) return;
  if(scheduleWeekStatus(occ,now)!=='active') throw Object.assign(Error('课表周未分配、未开始或已过期，未提交。'),{code:'schedule_week_inactive'});
  throw Object.assign(Error('课程已结束或剩余时间不足，未提交。'), {code: 'course_ended'});
}

// Each date picker has 5s + 0.2s + 5s + 2s local waits, plus
// a conservative allowance for one-second background timer granularity.
// Scale for multiple date questions without changing their mapping or recognition.
export function fillingTimeout(entries = []) {
  const dates = entries.filter(entry => entry.type === 'date' && !entry.skip).length;
  return Math.max(PHASE_TIMEOUTS.filling, dates * DATE_PICKER_BUDGET_MS + entries.length * BACKGROUND_TIMER_TICK_MS + BACKGROUND_TIMER_TICK_MS + VALIDATION_MARGIN_MS);
}
