import {normalizeDate,toWeeklySession,occurrencesBetween,triggerTimestamp,todayMalaysia} from './schedule.js';
export function validateSession(input) {
  if(!input||!['weekly','dated'].includes(input.kind)) throw Error('任务类型无效。');
  if(input.kind==='weekly'&&(!Number.isInteger(input.weekday)||input.weekday<0||input.weekday>6)) throw Error('每周星期须为 0–6 的整数。');
  if(input.kind==='dated'&&!normalizeDate(input.date)) throw Error('任务日期无效。');
  const row={...toWeeklySession(input),course:String(input.course||'').trim()};
  if(!/^[A-Za-z0-9][A-Za-z0-9 _-]{1,63}$/.test(row.course)) throw Error('课程名称须为 2–64 个英文字母、数字、空格、下划线或连字符。');
  if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.time)||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.endTime)||row.endTime<=row.time) throw Error(`${row.course} 的起止时间无效。`);
  if(!Array.isArray(input.exceptions||[])||(input.exceptions||[]).length>366) throw Error('停课日期格式无效。');
  row.exceptions=[...new Set((input.exceptions||[]).map(normalizeDate))].sort();
  if(row.exceptions.some(d=>!d)) throw Error(`${row.course} 的停课日期无效。`);
  if(input.enabled!==undefined&&typeof input.enabled!=='boolean') throw Error('任务启用状态无效。');
  return row;
}
const sameLesson=(a,b)=>a.course.trim().toLowerCase()===b.course.trim().toLowerCase()&&a.weekday===b.weekday&&a.time===b.time&&a.endTime===b.endTime;
export function saveDraftTasks(existing,incoming,now=new Date().toISOString()) {
  let result=[...existing];
  for(const input of incoming) {
    const row=validateSession(input);delete row.importChoice;
    const target=result.find(s=>sameLesson(s,row));
    if(target) {
      if(JSON.stringify(target.exceptions||[])===JSON.stringify(row.exceptions)&&target.enabled!==false) continue;
      result=result.map(s=>s.id===target.id?{...row,id:target.id,enabled:true,createdAt:now}:s);
    } else result.push({...row,id:row.id||crypto.randomUUID(),enabled:true,createdAt:now});
  }
  return result;
}
export function nextTrigger(session,records={},now=Date.now()) {
  const today=todayMalaysia(new Date(now)),end=new Date(`${today}T00:00:00Z`);end.setUTCDate(end.getUTCDate()+370);
  const next=occurrencesBetween([session],today,end.toISOString().slice(0,10)).find(o=>!records[o.key]&&triggerTimestamp(o)>now&&triggerTimestamp(o)>=Date.parse(o.createdAt||'1970-01-01'));
  return next?{date:next.date,when:triggerTimestamp(next)}:null;
}
