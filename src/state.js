const allowed={scheduled:['launched','missed'],launched:['pending','failed','unknown'],pending:['success','failed','unknown'],success:[],failed:[],unknown:[],missed:[]};
export function transition(from,event) {
  const state=event==='timeout'?'unknown':event;
  if(!allowed[from]?.includes(state)) throw Error(`无效状态变更：${from} → ${state}`);
  return {state,at:new Date().toISOString()};
}
export function dueAction(due,now,graceMs=120000) {
  if(now<due) return 'wait';
  return now-due<=graceMs?'launch':'missed';
}
