import {occurrencesBetween,triggerTimestamp,todayMalaysia,toWeeklySession,mergeSessions} from './schedule.js';
import {dueAction,transition} from './state.js';
import {validateFormsUrl} from './forms.js';
import {bindingForCourse,validateBindingForCourse} from './bindings.js';
import {ensureCloudDevice,reportCloud,syncCloud} from './cloud.js';

const NEXT='attendance-next', MAINTENANCE='attendance-maintenance';
const cloudEnabled=()=>Boolean(chrome.runtime?.id);
let queue=Promise.resolve();
const serialized=fn=>{const next=queue.then(fn,fn);queue=next.catch(error=>console.error(error));return next;};
const daysFrom=(date,offset)=>{const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);};
async function load() {
  const data=await chrome.storage.local.get(['attendanceSessions','attendanceBindings','attendanceProfile','attendanceRecords','attendanceScheduleMode']);
  if(data.attendanceScheduleMode!=='weekly') {
    const sessions=mergeSessions([], (data.attendanceSessions||[]).map(toWeeklySession));
    await chrome.storage.local.set({attendanceSessions:sessions,attendanceScheduleMode:'weekly'});
    data.attendanceSessions=sessions;
  }
  return data;
}
const saveRecords=records=>chrome.storage.local.set({attendanceRecords:records});

async function syncCloudState(data) {
  if(!cloudEnabled()) return;
  try {await syncCloud({sessions:data.attendanceSessions||[],bindings:data.attendanceBindings||{}});} catch(error) {console.warn('云端同步失败',error);}
}

async function notify(title,message,id=crypto.randomUUID()) {
  await chrome.notifications.create(id,{type:'basic',iconUrl:chrome.runtime.getURL('icon.png'),title,message,priority:1});
}

async function nextAlarm(sessions,records) {
  await chrome.alarms.clear(NEXT);
  await chrome.alarms.clear('attendance-evening');
  const today=todayMalaysia(), future=occurrencesBetween(sessions,today,daysFrom(today,32));
  const next=future.filter(o=>!records[o.key] && triggerTimestamp(o)>Date.now() && triggerTimestamp(o)>=Date.parse(o.createdAt||'1970-01-01')).sort((a,b)=>triggerTimestamp(a)-triggerTimestamp(b))[0];
  if(next) await chrome.alarms.create(NEXT,{when:triggerTimestamp(next)});
  await chrome.alarms.create(MAINTENANCE,{periodInMinutes:60});
}

async function processSchedule() {
  const {attendanceSessions:sessions=[],attendanceBindings:bindings={},attendanceProfile:profile={},attendanceRecords:stored={}}=await load();
  if(cloudEnabled()) await ensureCloudDevice().catch(error=>console.warn('云端设备注册失败',error));
  const records={...stored},today=todayMalaysia(),now=Date.now();
  const missedCourses=[];
  for(const occ of occurrencesBetween(sessions,daysFrom(today,-7),today)) {
    const due=triggerTimestamp(occ);
    if(records[occ.key] || due>now || due<Date.parse(occ.createdAt||'1970-01-01')) continue;
    const action=dueAction(due,now);
    if(action==='missed') {records[occ.key]={...transition('scheduled','missed'),occ,detail:'Chrome 未在打卡时间运行，或定时事件延迟。'};if(cloudEnabled()) await reportCloud({record:records[occ.key],status:'missed',detail:records[occ.key].detail});missedCourses.push(occ.course);continue;}
    const binding=bindingForCourse(bindings,occ.course);
    try {validateBindingForCourse(binding,occ.course,profile,occ.date);}
    catch(error) {records[occ.key]={...transition('scheduled','missed'),occ,detail:error.message};missedCourses.push(occ.course);continue;}
    const tab=await chrome.tabs.create({url:'about:blank',active:false});
    records[occ.key]={...transition('scheduled','launched'),occ,formUrl:binding.url,tabId:tab.id};
    await saveRecords(records);
    try {
      const url=validateFormsUrl(binding.url);
      url.hash=new URLSearchParams({attendanceRun:occ.key}).toString();
      await chrome.tabs.update(tab.id,{url:url.href});
      await chrome.alarms.create(`attendance-watch:${occ.key}`,{when:Date.now()+90000});
    } catch(error) {
      records[occ.key]={...records[occ.key],...transition('launched','failed'),detail:error.message};
      if(cloudEnabled()) await reportCloud({record:records[occ.key],status:'failed',detail:error.message});
      await notify('打卡未执行',`${occ.course}：${error.message}`);
    }
  }
  await saveRecords(records);
  await syncCloudState({attendanceSessions:sessions,attendanceBindings:bindings});
  if(missedCourses.length) await notify('请手动处理课程打卡',`${missedCourses.join('、')} 未自动提交。请打开扩展查看原因。`);
  await nextAlarm(sessions,records);
}

async function report(message,sender) {
  const {attendanceRecords:records={},attendanceSessions:sessions=[]}=await chrome.storage.local.get(['attendanceRecords','attendanceSessions']);
  const record=records[message.key];
  if(!record || record.tabId!==sender.tab?.id) throw Error('打卡任务与当前页面不匹配。');
  if(message.state==='pending'&&!sessions.some(session=>session.id===record.occ.id)) throw Error('打卡任务已删除，未提交。');
  const next=transition(record.state,message.state);
  records[message.key]={...record,...next,detail:String(message.detail||'').slice(0,500)};
  await saveRecords(records);
  if(cloudEnabled()&&['success','failed','unknown','missed'].includes(next.state)) await reportCloud({record:records[message.key],status:next.state,detail:records[message.key].detail});
  if(['success','failed','unknown'].includes(next.state)) {
    await chrome.alarms.clear(`attendance-watch:${message.key}`);
    const title=next.state==='success'?'打卡成功':next.state==='unknown'?'打卡结果不明':'打卡失败';
    await notify(title,`${record.occ.course} · ${record.occ.date} ${record.occ.time}${message.detail?`\n${message.detail}`:''}`);
  }
  return {ok:true};
}

async function watchdog(key) {
  const {attendanceRecords:records={}}=await chrome.storage.local.get('attendanceRecords');
  const record=records[key];
  if(!record || !['launched','pending'].includes(record.state)) return;
  const state=record.state==='pending'?'unknown':'failed';
  records[key]={...record,...transition(record.state,state),detail:state==='failed'?'未能读取表单，请检查学校登录状态。':'已开始提交，但未收到明确成功反馈。'};
  await saveRecords(records);
  if(cloudEnabled()) await reportCloud({record:records[key],status,detail:records[key].detail});
  await notify(state==='unknown'?'打卡结果不明':'打卡失败',`${record.occ.course}：${records[key].detail}`);
}

chrome.runtime.onInstalled.addListener(()=>serialized(processSchedule));
chrome.runtime.onStartup.addListener(()=>serialized(processSchedule));
chrome.action.onClicked.addListener(()=>chrome.runtime.openOptionsPage());
chrome.alarms.onAlarm.addListener(alarm=>serialized(async()=>{
  if(alarm.name===NEXT || alarm.name===MAINTENANCE) await processSchedule();
  else if(alarm.name.startsWith('attendance-watch:')) await watchdog(alarm.name.slice('attendance-watch:'.length));
}));
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(!['REBUILD_SCHEDULE','GET_RUN','REPORT_RUN'].includes(message?.type)) return false;
  serialized(async()=>{
    if(message.type==='REBUILD_SCHEDULE') {await processSchedule();return {ok:true};}
    if(message.type==='GET_RUN') {
      const data=await load(),record=(data.attendanceRecords||{})[message.key];
      if(!record || record.tabId!==sender.tab?.id || record.state!=='launched' || !(data.attendanceSessions||[]).some(session=>session.id===record.occ.id)) throw Error('任务已结束、已删除，或不是由定时器启动。');
      return {occ:record.occ,binding:bindingForCourse(data.attendanceBindings,record.occ.course),profile:data.attendanceProfile};
    }
    return report(message,sender);
  }).then(sendResponse,error=>sendResponse({error:error.message}));
  return true;
});
