import {WAKE_GRACE_MS,canSubmitBeforeEnd,PHASE_TIMEOUTS,scheduleWeekStatus} from './runtime-timing.js';
import {todayMalaysia,occurrenceTimestamp} from './schedule.js';
export function manualCheckInState(occ,record,now=Date.now()) {
  if(['success','success_manual','unknown','submitted_pending_confirmation','launched','pending'].includes(record?.state)) return record.state;
  if(record?.submissionKey||record?.submissionAttemptedAt) return 'attempted';
  if(occ.enabled===false) return 'paused';
  if(scheduleWeekStatus(occ,now)!=='active') return 'inactive_week';
  if(occ.date!==todayMalaysia(new Date(now))) return 'wrong_day';
  if(!Number.isFinite(occurrenceTimestamp(occ))||now<occurrenceTimestamp(occ)) return 'not_started';
  return canSubmitBeforeEnd(occ,now)?'ready':'ended';
}
const allowed={scheduled:['launched','failed','missed','missed_sleep'],launched:['pending','failed','missed','missed_sleep'],pending:['success','failed','unknown','missed','submitted_pending_confirmation'],submitted_pending_confirmation:['success'],success:[],success_manual:[],failed:[],unknown:[],missed:[],missed_sleep:[]};
export function transition(from,event) {
  if(event==='manual_submitted') {
    if(!['unknown','submitted_pending_confirmation'].includes(from)) throw Error(`无效状态变更：${from} → success`);
    return {state:'success_manual',at:new Date().toISOString()};
  }
  const state=event==='timeout'?'unknown':event;
  if(!allowed[from]?.includes(state)) throw Error(`无效状态变更：${from} → ${state}`);
  return {state,at:new Date().toISOString()};
}
export function dueAction(due,now,graceMs=WAKE_GRACE_MS) {
  if(now<due) return 'wait';
  return now-due<=graceMs?'launch':'missed';
}

export function reserveSubmissionRecord(records,key,tabId,now=new Date().toISOString()) {
  const record=records?.[key];
  if(!record||record.tabId!==tabId) throw Error('打卡任务与当前页面不匹配。');
  if(record.submissionAttemptedAt||record.submissionKey) return {granted:false,reason:'already_attempted',records};
  if(record.state!=='launched') return {granted:false,reason:'already_in_progress',records};
  if(!canSubmitBeforeEnd(record.occ,Date.parse(now))) return {granted:false,reason:'course_ended',records:{...records,[key]:{...record,...transition(record.state,'missed'),phase:'completed',detail:'课程已结束或结束时间无效，未提交。'}}};
  const phaseDurations={...(record.phaseDurations||{})},phaseStarted=Date.parse(record.phaseStartedAt||'');
  if(record.phase&&Number.isFinite(phaseStarted)) phaseDurations[record.phase]=(phaseDurations[record.phase]||0)+Math.max(0,Date.parse(now)-phaseStarted);
  const next={...record,...transition(record.state,'pending'),submissionKey:key,submissionAttemptedAt:now,phase:'submitting',phaseStartedAt:now,phaseDeadline:Date.parse(now)+PHASE_TIMEOUTS.submitting,phaseDurations};
  return {granted:true,records:{...records,[key]:next}};
}
