const allowed={scheduled:['launched','missed','missed_sleep'],launched:['pending','failed','missed_sleep'],pending:['success','failed','unknown','submitted_pending_confirmation'],submitted_pending_confirmation:['success'],success:[],failed:[],unknown:[],missed:[],missed_sleep:[]};
export function transition(from,event) {
  if(event==='manual_submitted') {
    if(!['unknown','submitted_pending_confirmation'].includes(from)) throw Error(`无效状态变更：${from} → success`);
    return {state:'success',at:new Date().toISOString()};
  }
  const state=event==='timeout'?'unknown':event;
  if(!allowed[from]?.includes(state)) throw Error(`无效状态变更：${from} → ${state}`);
  return {state,at:new Date().toISOString()};
}
export function dueAction(due,now,graceMs=120000) {
  if(now<due) return 'wait';
  return now-due<=graceMs?'launch':'missed';
}

export function reserveSubmissionRecord(records,key,tabId,now=new Date().toISOString()) {
  const record=records?.[key];
  if(!record||record.tabId!==tabId) throw Error('打卡任务与当前页面不匹配。');
  if(record.submissionAttemptedAt||record.submissionKey) return {granted:false,reason:'already_attempted',records};
  if(record.state!=='launched') return {granted:false,reason:'already_in_progress',records};
  const phaseDurations={...(record.phaseDurations||{})},phaseStarted=Date.parse(record.phaseStartedAt||'');
  if(record.phase&&Number.isFinite(phaseStarted)) phaseDurations[record.phase]=(phaseDurations[record.phase]||0)+Math.max(0,Date.parse(now)-phaseStarted);
  const next={...record,...transition(record.state,'pending'),submissionKey:key,submissionAttemptedAt:now,phase:'submitting',phaseStartedAt:now,phaseDurations};
  return {granted:true,records:{...records,[key]:next}};
}
