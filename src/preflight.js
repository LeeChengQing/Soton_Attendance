import {triggerTimestamp} from './schedule.js';
import {bindingForCourse} from './bindings.js';
import {validateFormsUrl} from './forms.js';

export const PREFLIGHT='attendance-preflight:';
const WATCH='attendance-preflight-watch:';
const CHECKS=['已登录学校账号','课型可解析','表单链接与绑定一致','标题与题目没变','日期格式可填','填写后核对通过'];
export function preflightCoordinator(notify) {
  async function finish(key,checks) {
    const data=await chrome.storage.local.get(['attendancePreflightRuns','attendanceRecords','attendancePreflightNotices']);
    const run=data.attendancePreflightRuns?.[key];
    if(!run) return;
    let permission='denied';
    try {permission=await chrome.notifications.getPermissionLevel();} catch {}
    checks=[...CHECKS.map(name=>checks.find(c=>c.name===name)||{name,ok:false,hint:'前置检查未通过，尚未检查。'}),...checks.filter(c=>!CHECKS.includes(c.name)),{name:'Chrome 通知权限可用',ok:permission==='granted',hint:permission==='granted'?'':'请在 Chrome 和系统设置中允许 Chrome 通知。'}];
    const preflight={at:new Date().toISOString(),ok:checks.every(c=>c.ok),checks};
    const records=data.attendanceRecords||{};
    records[key]={...(records[key]||{state:'scheduled',occ:run.occ}),preflight,preflightConfiguration:JSON.stringify({binding:run.binding,profile:run.profile})};
    const runs={...data.attendancePreflightRuns};delete runs[key];
    const notices=data.attendancePreflightNotices||{},fresh=[];
    for(const c of checks.filter(c=>!c.ok && !c.hint.startsWith('前置检查'))) {
      const reason=c.name;
      if(!notices[reason] || Date.now()-notices[reason]>=30*60000) {fresh.push(c.hint);notices[reason]=Date.now();}
    }
    await chrome.storage.local.set({attendanceRecords:records,attendancePreflightRuns:runs,attendancePreflightNotices:notices});
    await chrome.alarms.clear(WATCH+key);
    if(run.tabId) await chrome.tabs.remove(run.tabId).catch(()=>{});
    if(fresh.length) await notify('打卡预检未就绪',`${run.occ.course}：${fresh.join('；')}`);
  }
  async function abortAll() {
    const {attendancePreflightRuns:runs={}}=await chrome.storage.local.get('attendancePreflightRuns');
    for(const key of Object.keys(runs)) await finish(key,[{name:'填写后核对通过',ok:false,hint:'正式打卡已起跑，预检结束；稍后检查配置。'}]);
  }
  async function start(key) {
    const data=await chrome.storage.local.get(['attendanceRecords','attendanceSessions','attendanceBindings','attendanceProfile','attendancePreflightRuns']);
    const record=data.attendanceRecords?.[key];
    if(!record || record.state!=='scheduled') return;
    if(!(data.attendanceSessions||[]).some(s=>s.id===record.occ.id && s.enabled!==false && s.course===record.occ.course && s.time===record.occ.time && s.endTime===record.occ.endTime && !(s.exceptions||[]).includes(record.occ.date))) return;
    if(triggerTimestamp(record.occ)<=Date.now()) return;
    if(Object.keys(data.attendancePreflightRuns||{}).length || Object.values(data.attendanceRecords||{}).some(r=>['launched','pending'].includes(r.state))) {
      await chrome.alarms.create(PREFLIGHT+key+':deferred',{when:Date.now()+5000});return;
    }
    const binding=bindingForCourse(data.attendanceBindings,record.occ.course),runs={};
    runs[key]={occ:record.occ,binding,profile:data.attendanceProfile,deadline:Date.now()+120000};
    await chrome.storage.local.set({attendancePreflightRuns:runs});
    try {
      if(await chrome.notifications.getPermissionLevel()!=='granted') {await finish(key,[]);return;}
      const url=validateFormsUrl(binding?.url);
      const tab=await chrome.tabs.create({url:'about:blank',active:false});
      runs[key].tabId=tab.id;await chrome.storage.local.set({attendancePreflightRuns:runs});
      await chrome.alarms.create(WATCH+key,{when:runs[key].deadline});
      url.hash=new URLSearchParams({attendanceCheck:record.occ.course,attendancePreflight:key}).toString();
      await chrome.tabs.update(tab.id,{url:url.href});
    } catch(error) {await finish(key,[{name:'表单链接与绑定一致',ok:false,hint:`${error.message} 请重新绑定课程表单。`}]);}
  }
  async function identify(tabId) {
    const {attendancePreflightRuns:runs={}}=await chrome.storage.local.get('attendancePreflightRuns');
    const entry=Object.entries(runs).find(([,r])=>r.tabId===tabId);
    return entry?{kind:'preflight',key:entry[0],course:entry[1].occ.course}:null;
  }
  async function handle(message,sender) {
    const identity=await identify(sender.tab?.id);
    if(!identity || identity.key!==message.key) throw Error('预检与当前标签页不匹配。');
    const {attendancePreflightRuns:runs}=await chrome.storage.local.get('attendancePreflightRuns');
    const run=runs[message.key];
    if(message.type==='GET_PREFLIGHT') return {occ:run.occ,binding:run.binding,profile:run.profile};
    const expected=['已登录学校账号','课型可解析','表单链接与绑定一致','标题与题目没变','日期格式可填','填写后核对通过'];
    const checks=expected.map(name=>{
      const c=message.checks?.find(c=>c.name===name);
      return {name,ok:c?.ok===true,hint:String(c?.hint|| (c?.ok?'':'检查未完成，请重新预检。')).slice(0,400)};
    });
    const current=await chrome.storage.local.get(['attendanceBindings','attendanceProfile']);
    if(JSON.stringify({binding:bindingForCourse(current.attendanceBindings,run.occ.course),profile:current.attendanceProfile})!==JSON.stringify({binding:run.binding,profile:run.profile})) checks.push({name:'配置保持一致',ok:false,hint:'预检期间配置发生变化，请重新检查表单绑定和学生资料。'});
    await finish(message.key,checks);return {ok:true};
  }
  async function schedule(occurrences,records) {
    const wanted=new Map();
    for(const occ of occurrences) {
      if(records[occ.key] && records[occ.key].state!=='scheduled') continue;
      const due=triggerTimestamp(occ);
      if(due<=Date.now() || due<Date.parse(occ.createdAt||'1970-01-01')) continue;
      records[occ.key] ||= {state:'scheduled',occ};
      records[occ.key].occ=occ;
      for(const minutes of [30,8]) {
        const when=due-minutes*60000;
        if(when>Date.now()) wanted.set(`${PREFLIGHT}${occ.key}:${minutes}`,when);
      }
    }
    if(chrome.alarms.getAll) for(const alarm of await chrome.alarms.getAll()) if(alarm.name.startsWith(PREFLIGHT) && !wanted.has(alarm.name)) await chrome.alarms.clear(alarm.name);
    for(const [name,when] of wanted) await chrome.alarms.create(name,{when});
    await chrome.storage.local.set({attendanceRecords:records});
  }
  async function alarm(name) {
    if(name.startsWith(WATCH)) {await finish(name.slice(WATCH.length),[{name:'已登录学校账号',ok:false,hint:'表单加载超时，需要重新登录学校 Microsoft 账号，并检查网络或访问权限。'}]);return true;}
    if(name.startsWith(PREFLIGHT)) {await start(name.slice(PREFLIGHT.length,name.lastIndexOf(':')));return true;}
    return false;
  }
  async function navigation(tabId) {
    const identity=await identify(tabId);
    if(identity) await finish(identity.key,[{name:'已登录学校账号',ok:false,hint:'需要重新登录学校 Microsoft 账号。登录后重新检查课程表单。'}]);
    return Boolean(identity);
  }
  async function resume() {
    const {attendancePreflightRuns:runs={}}=await chrome.storage.local.get('attendancePreflightRuns');
    for(const [key,run] of Object.entries(runs)) {
      if(run.deadline<=Date.now()) await alarm(WATCH+key);
      else await chrome.alarms.create(WATCH+key,{when:run.deadline});
    }
  }
  async function closed(tabId) {
    const identity=await identify(tabId);
    if(identity) await finish(identity.key,[{name:'填写后核对通过',ok:false,hint:'预检标签页被关闭，未完成核对；请保持 Chrome 运行。'}]);
  }
  return {schedule,alarm,handle,identify,abortAll,navigation,resume,closed};
}
