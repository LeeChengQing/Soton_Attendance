import {validateSession} from './configuration.js';
import {validateFormsUrl,verifyQuestions} from './forms.js';
import {normalizeDate} from './schedule.js';
const terminal=state=>['success','failed','unknown','missed'].includes(state);
function terminalRecords(records={}) {
  return Object.fromEntries(Object.entries(records).filter(([,r])=>terminal(r.state)&&r.occ).map(([key,r])=>[key,{state:r.state,at:r.at,detail:r.detail||'',formUrl:r.formUrl,occ:{id:r.occ.id,course:r.occ.course,date:r.occ.date,time:r.occ.time,endTime:r.occ.endTime,key:r.occ.key,weekday:r.occ.weekday,kind:'weekly'}}]));
}
export function createBackup(data) {
  const p=data.attendanceProfile;
  return {format:'soton-attendance-configuration',version:1,exportedAt:new Date().toISOString(),profile:p?.student&&p?.name?{student:p.student,name:p.name,studentType:p.studentType}:null,bindings:Object.fromEntries(Object.entries(data.attendanceBindings||{}).map(([key,b])=>[key,{scope:b.scope,url:b.url,title:b.title,questions:b.questions,mapping:b.mapping,verified:b.verified}])),sessions:(data.attendanceSessions||[]).map(s=>({id:s.id,kind:'weekly',course:s.course,weekday:s.weekday,time:s.time,endTime:s.endTime,exceptions:s.exceptions||[],enabled:s.enabled!==false})),records:terminalRecords(data.attendanceRecords)};
}
export function validateBackup(input) {
  if(!input||typeof input!=='object'||Array.isArray(input)||input.format!=='soton-attendance-configuration'||input.version!==1) throw Error('不是支持的 Attendance 配置备份。');
  const allowed=['format','version','exportedAt','profile','bindings','sessions','records'];
  if(Object.keys(input).some(k=>!allowed.includes(k))) throw Error('备份包含不支持的字段或凭证，未导入。');
  if(!Array.isArray(input.sessions)||input.sessions.length>200||!input.bindings||typeof input.bindings!=='object'||Array.isArray(input.bindings)||!input.records||typeof input.records!=='object'||Array.isArray(input.records)) throw Error('备份结构无效。');
  if(input.profile&&(!/^(local|international)$/.test(input.profile.studentType)||typeof input.profile.student!=='string'||!input.profile.student.trim()||input.profile.student.length>50||typeof input.profile.name!=='string'||!input.profile.name.trim()||input.profile.name.length>100||Object.keys(input.profile).some(k=>!['student','name','studentType'].includes(k)))) throw Error('备份学生资料无效。');
  const ids=new Set();for(const row of input.sessions) {validateSession(row);if(typeof row.id!=='string'||!row.id||ids.has(row.id)) throw Error('备份任务 ID 无效或重复。');ids.add(row.id);if(Object.keys(row).some(k=>!['id','kind','course','weekday','time','endTime','exceptions','enabled'].includes(k))) throw Error('备份任务包含不支持的状态。');}
  if(Object.keys(input.bindings).length>200) throw Error('备份绑定数量过多。');
  for(const [key,b] of Object.entries(input.bindings)) {
    if(['__proto__','constructor','prototype'].includes(key)||!b||typeof b!=='object'||typeof b.title!=='string'||b.title.length>500||typeof b.verified!=='boolean') throw Error('备份表单绑定无效。');
    validateFormsUrl(b.url);
    if(Object.keys(b).some(k=>!['scope','url','title','questions','mapping','verified'].includes(k))) throw Error('备份绑定包含不支持的字段。');
    if(b.questions!==undefined&&(!Array.isArray(b.questions)||b.questions.length>100||!verifyQuestions(b.questions,b.mapping)||b.questions.some(q=>!['text','radio','date'].includes(q.type)))) throw Error('备份表单题目无效。');
  }
  if(Object.keys(input.records).length>10000) throw Error('备份记录数量过多。');
  for(const r of Object.values(input.records)) {
    if(!r||!terminal(r.state)||!r.occ||!normalizeDate(r.occ.date)||typeof r.occ.key!=='string'||!r.occ.key||typeof r.at!=='string'||!Number.isFinite(Date.parse(r.at))) throw Error('备份只能包含有效的已结束记录。');
    if(r.formUrl) validateFormsUrl(r.formUrl);
    if(Object.keys(r).some(k=>!['state','at','detail','formUrl','occ'].includes(k))) throw Error('备份包含运行中状态，未导入。');
  }
  return input;
}
export function restoreBackup(input,current,now=new Date().toISOString()) {
  const b=validateBackup(input),records={};
  for(const r of Object.values(b.records)) records[r.occ.key]=r;
  for(const r of Object.values(current.attendanceRecords||{})) if(r.occ?.key) records[r.occ.key]=r;
  return {attendanceProfile:b.profile||{},attendanceBindings:b.bindings,attendanceSessions:b.sessions.map(s=>({...validateSession(s),createdAt:now,enabled:false})),attendanceRecords:records,attendanceScheduleMode:'weekly',attendanceDraft:{version:1,rows:[],reviewedAt:null},attendanceSetupCoverageEpoch:now,attendanceSetupSession:null};
}
export function recoveryForRecord(record) {
  if(record.state==='unknown') return {action:'inspect',label:'手动核对原表单',description:'已开始提交但结果不明。请手动核对学校记录；系统不会自动重试。'};
  if(/题目|标题|映射|绑定|课型/.test(record.detail||'')) return {action:'binding',label:'修复课程表单绑定',description:'重新核对表单和资料映射，再运行设置检查。'};
  if(record.state==='failed') return {action:'login',label:'检查学校登录与表单',description:'打开原表单检查学校登录、开放时间或额外验证。'};
  if(record.state==='missed') return {action:'inspect',label:'打开表单手动处理',description:'此次未自动提交。请按学校要求手动处理，并检查 Chrome 与电脑休眠设置。'};
  return {action:'inspect',label:'查看原表单',description:record.state==='success'?'原表单已显示成功反馈。':'请查看当前运行页面。'};
}
