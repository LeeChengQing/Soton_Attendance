import {occurrencesBetween,triggerTimestamp,todayMalaysia,toWeeklySession,mergeSessions} from './schedule.js';
import {dueAction,transition} from './state.js';
import {validateFormsUrl} from './forms.js';
import {bindingForCourse,validateBindingForCourse} from './bindings.js';
import {ensureCloudDevice,cloudSnapshot,deliverCloud,getEntitlementStatus,redeemActivationKey,startPhoneSubscriptionRecovery,completePhoneSubscriptionRecovery,phoneSubscriptionRecoveryStatus,cancelPhoneSubscriptionRecovery} from './cloud.js';
import {enqueue,acknowledge,fail,nextReady} from './outbox.js';
import {setupCoordinator} from './setup-coordinator.js';
import {isSettingsSender} from './settings-sender.js';
import {restoreBackup} from './backup.js';

const NEXT='attendance-next', MAINTENANCE='attendance-maintenance', CLOUD='attendance-cloud';
const cloudEnabled=()=>Boolean(chrome.runtime?.id);
let queue=Promise.resolve();
const serialized=fn=>{const next=queue.then(fn,fn);queue=next.catch(()=>{});return next;};
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

async function enqueueCloud(action,payload,extra={}) {
  if(!cloudEnabled()) return chrome.storage.local.set(extra);
  if(action==='sync') {
    const state=await chrome.storage.local.get(['attendanceCloudSetupChoice','attendanceCloudDeviceId','attendanceCloudToken']);
    const choice=state.attendanceCloudSetupChoice;
    const recovering=['recovery-starting','recovery-pending','recovery-verifying','recovery-outcome-unknown','recovery-finalizing'].includes(choice);
    const hasIdentity=Boolean(state.attendanceCloudDeviceId&&state.attendanceCloudToken);
    const cloudChosen=hasIdentity||choice==='new'||choice==='recovered';
    if(recovering||!cloudChosen||choice==='recovered'&&!(payload?.schedules?.length)) return chrome.storage.local.set(extra);
  }
  const {attendanceCloudOutbox:q={}}=await chrome.storage.local.get('attendanceCloudOutbox');
  const next=enqueue(q,action,payload);
  await chrome.storage.local.set({...extra,attendanceCloudOutbox:next});
  await chrome.alarms.create(CLOUD,{when:Date.now()+1000});
}
async function persistTerminal(records,key) {
  const r=records[key],o=r.occ;
  await enqueueCloud('event',{status:r.state,courseCode:o.course,classDate:o.date,startTime:o.time,endTime:o.endTime,formUrl:r.formUrl||undefined,occurrenceKey:o.key,detail:r.detail}, {attendanceRecords:records});
}
let draining=false;
const setup=setupCoordinator(enqueueCloud);
async function cloudReadyForDrain() {
  const state=await chrome.storage.local.get(['attendanceCloudDeviceId','attendanceCloudToken','attendanceCloudSetupChoice']);
  if(['recovery-starting','recovery-pending','recovery-verifying','recovery-outcome-unknown','recovery-finalizing'].includes(state.attendanceCloudSetupChoice)) return false;
  if(state.attendanceCloudDeviceId&&state.attendanceCloudToken) return true;
  return state.attendanceCloudSetupChoice==='new'||state.attendanceCloudSetupChoice==='recovered';
}
async function drainCloud() {
  if(draining||!cloudEnabled()||!await cloudReadyForDrain()) return;draining=true;
  try {
    // Read/acknowledge under local serialization, perform networking entirely outside it.
    for(let count=0;count<20;count++) {
      const item=await serialized(async()=>{const {attendanceCloudOutbox:q={}}=await chrome.storage.local.get('attendanceCloudOutbox');return nextReady(q);});
      if(!item||!await cloudReadyForDrain()) break;
      let error;try {await deliverCloud(item);} catch(e) {error=e.message;}
      await serialized(async()=>{
        const {attendanceCloudOutbox:q={}}=await chrome.storage.local.get('attendanceCloudOutbox');
        await chrome.storage.local.set({attendanceCloudOutbox:error?fail(q,item.id,error):acknowledge(q,item.id)});
      });
    }
    await serialized(async()=>{
      const {attendanceCloudOutbox:q={}}=await chrome.storage.local.get('attendanceCloudOutbox');
      if(q.items?.length) await chrome.alarms.create(CLOUD,{when:Math.max(Date.now()+1000,Math.min(...q.items.map(i=>i.availableAt)))});
    });
  } finally {draining=false;}
}

async function notify(title,message,id=crypto.randomUUID()) {
  try {await chrome.notifications.create(id,{type:'basic',iconUrl:chrome.runtime.getURL('icon.png'),title,message,priority:1});} catch(error) {console.warn('系统通知不可用',error.message);}
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
  const records={...stored},today=todayMalaysia(),now=Date.now();
  for(const [key,r] of Object.entries(records)) {
    if(!['launched','pending'].includes(r.state)) continue;
    const deadline=r.watchDeadline||Date.parse(r.at)+90000;
    if(deadline<=now) {await watchdog(key);Object.assign(records,(await chrome.storage.local.get('attendanceRecords')).attendanceRecords);}
    else await chrome.alarms.create(`attendance-watch:${key}`,{when:deadline});
  }
  const missedCourses=[];
  for(const occ of occurrencesBetween(sessions,daysFrom(today,-7),today)) {
    const due=triggerTimestamp(occ);
    if(records[occ.key] || due>now || due<Date.parse(occ.createdAt||'1970-01-01')) continue;
    const action=dueAction(due,now);
    if(action==='missed') {records[occ.key]={...transition('scheduled','missed'),occ,detail:'Chrome 未在打卡时间运行，或定时事件延迟。'};await persistTerminal(records,occ.key);missedCourses.push(occ.course);continue;}
    const binding=bindingForCourse(bindings,occ.course);
    try {validateBindingForCourse(binding,occ.course,profile,occ.date);}
    catch(error) {records[occ.key]={...transition('scheduled','missed'),occ,detail:error.message};await persistTerminal(records,occ.key);missedCourses.push(occ.course);continue;}
    // Reserve the occurrence before opening a tab, so a crash cannot replay submission.
    records[occ.key]={...transition('scheduled','launched'),occ,formUrl:binding.url,configuration:JSON.stringify({binding,profile}),watchDeadline:Date.now()+90000};
    await saveRecords(records);
    try {
      const tab=await chrome.tabs.create({url:'about:blank',active:false});
      records[occ.key].tabId=tab.id;await saveRecords(records);
      await chrome.alarms.create(`attendance-watch:${occ.key}`,{when:records[occ.key].watchDeadline});
      const url=validateFormsUrl(binding.url);
      url.hash=new URLSearchParams({attendanceRun:occ.key}).toString();
      await chrome.tabs.update(tab.id,{url:url.href});
    } catch(error) {
      records[occ.key]={...records[occ.key],...transition('launched','failed'),detail:error.message};
      await persistTerminal(records,occ.key);
      await notify('打卡未执行',`${occ.course}：${error.message}`);
    }
  }
  await saveRecords(records);
  await enqueueCloud('sync',cloudSnapshot({sessions,bindings,profile}));
  if(missedCourses.length) await notify('请手动处理课程打卡',`${missedCourses.join('、')} 未自动提交。请打开扩展查看原因。`);
  await nextAlarm(sessions,records);
  await setup.resume();
}

async function report(message,sender) {
  const {attendanceRecords:records={},attendanceSessions:sessions=[],attendanceProfile:profile={},attendanceBindings:bindings={}}=await chrome.storage.local.get(['attendanceRecords','attendanceSessions','attendanceProfile','attendanceBindings']);
  const record=records[message.key];
  if(!record || record.tabId!==sender.tab?.id) throw Error('打卡任务与当前页面不匹配。');
  if(message.state==='pending'&&!currentTask(sessions,record)) throw Error('打卡任务已删除、暂停或修改，未提交。');
  if(message.state==='pending'&&(record.occ.date!==todayMalaysia()||record.configuration&&record.configuration!==JSON.stringify({binding:bindingForCourse(bindings,record.occ.course),profile}))) throw Error('任务日期或配置已变化，未授权提交。');
  const next=transition(record.state,message.state);
  records[message.key]={...record,...next,detail:String(message.detail||'').slice(0,500)};
  if(['success','failed','unknown','missed'].includes(next.state)) await persistTerminal(records,message.key);
  else await saveRecords(records);
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
  await persistTerminal(records,key);
  await notify(state==='unknown'?'打卡结果不明':'打卡失败',`${record.occ.course}：${records[key].detail}`);
}
function currentTask(sessions,r) {return sessions.some(s=>s.id===r.occ.id&&s.enabled!==false&&s.course===r.occ.course&&s.weekday===r.occ.weekday&&s.time===r.occ.time&&s.endTime===r.occ.endTime&&!(s.exceptions||[]).includes(r.occ.date));}

chrome.runtime.onInstalled.addListener(()=>serialized(processSchedule));
chrome.runtime.onStartup.addListener(()=>serialized(processSchedule));
chrome.action.onClicked.addListener(()=>chrome.runtime.openOptionsPage());
chrome.alarms.onAlarm.addListener(alarm=>serialized(async()=>{
  if(alarm.name===NEXT || alarm.name===MAINTENANCE) await processSchedule();
  else if(alarm.name.startsWith('attendance-watch:')) await watchdog(alarm.name.slice('attendance-watch:'.length));
  else if(alarm.name.startsWith('attendance-setup:')) await setup.resume();
}).then(()=>{if(alarm.name===CLOUD||alarm.name===MAINTENANCE) void drainCloud();}));
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.type==='RESTORE_BACKUP') {
    serialized(async()=>{
      if(!isSettingsSender(sender)) throw Error('请从扩展设置页恢复备份。');
      const current=await chrome.storage.local.get(['attendanceRecords','attendanceSetupSession']);
      if(current.attendanceSetupSession?.state==='running') await setup.handle({type:'CANCEL_SETUP'},sender);
      const restored=restoreBackup(message.backup,current);
      await chrome.storage.local.set(restored);await processSchedule();
      return {ok:true,profile:restored.attendanceProfile};
    }).then(sendResponse,error=>sendResponse({error:error.message}));return true;
  }
  if(['START_SETUP','GET_SETUP_ITEM','REPORT_SETUP_ITEM','CONFIRM_SETUP_ITEM','CONFIRM_ALL_SETUP_ITEMS','CANCEL_SETUP'].includes(message?.type)) {
    serialized(()=>setup.handle(message,sender)).then(sendResponse,error=>sendResponse({error:error.message}));return true;
  }
  if(message?.type==='CLOUD_REQUEST') {
    if(!isSettingsSender(sender)) {sendResponse({error:'设置操作只能从扩展设置页执行。'});return false;}
    const operations={
      device:()=>ensureCloudDevice(),
      entitlement:()=>getEntitlementStatus(),
      redeem:()=>redeemActivationKey(message.activationKey),
      notifications:()=>deliverCloud({action:'notifications',payload:{}}),
      'confirm-receipt':()=>deliverCloud({action:'confirm-receipt',payload:{notificationId:message.notificationId}}),
      'recovery-start':()=>startPhoneSubscriptionRecovery(message.activationKey),
      'recovery-complete':()=>completePhoneSubscriptionRecovery(message.challengeId,message.code),
      'recovery-status':()=>phoneSubscriptionRecoveryStatus(),
      'recovery-cancel':()=>cancelPhoneSubscriptionRecovery(),
    };
    const operation=operations[message.action];
    if(!operation) return false;
    operation().then(async data=>{
      if(message.action==='device') {const {attendanceNtfyTopic,attendanceCloudDeviceId}=data;sendResponse({attendanceNtfyTopic,attendanceCloudDeviceId});}
      else {
        if(message.action==='redeem'||message.action==='recovery-complete') {
          try {await serialized(processSchedule);void drainCloud();}
          catch(error) {console.error('Cloud schedule refresh after subscription change failed',error.message);}
        }
        sendResponse(data);
      }
    },error=>sendResponse({error:error.code||error.message,retryAfterSeconds:error.retryAfterSeconds}));return true;
  }
  if(message?.type==='RETRY_CLOUD') {
    serialized(async()=>{
      if(!isSettingsSender(sender)) throw Error('请从扩展设置页重试云端连接。');
      const {attendanceCloudOutbox:q={}}=await chrome.storage.local.get('attendanceCloudOutbox');
      await chrome.storage.local.set({attendanceCloudOutbox:{...q,items:(q.items||[]).map(i=>({...i,availableAt:Date.now()}))}});
      return {ok:true};
    }).then(result=>{sendResponse(result);void drainCloud();},e=>sendResponse({error:e.message}));return true;
  }
  if(!['REBUILD_SCHEDULE','GET_RUN','REPORT_RUN'].includes(message?.type)) return false;
  serialized(async()=>{
    if(message.type==='REBUILD_SCHEDULE') {await processSchedule();return {ok:true};}
    if(message.type==='GET_RUN') {
      const data=await load(),record=(data.attendanceRecords||{})[message.key];
      if(!record || record.tabId!==sender.tab?.id || record.state!=='launched' || !currentTask(data.attendanceSessions||[],record)) throw Error('任务已结束、已删除，或不是由定时器启动。');
      return {occ:record.occ,binding:bindingForCourse(data.attendanceBindings,record.occ.course),profile:data.attendanceProfile};
    }
    return report(message,sender);
  }).then(sendResponse,error=>sendResponse({error:error.message}));
  return true;
});
chrome.tabs.onRemoved?.addListener(tabId=>serialized(()=>setup.closed(tabId)));
