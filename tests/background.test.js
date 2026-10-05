import test from 'node:test';
import assert from 'node:assert/strict';
import {todayMalaysia} from '../src/schedule.js';
import {createBackup} from '../src/backup.js';

const settingsSender=()=>({url:chrome.runtime.getURL('options.html'),id:chrome.runtime.id,tab:{id:99,url:chrome.runtime.getURL('options.html')}});
const nextDay=date=>{const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);};
const localTime=offsetMinutes=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(Date.now()+offsetMinutes*60000)).map(p=>[p.type,p.value]));return `${parts.hour}:${parts.minute}`;};
function fakeChrome(store) {
  const listeners={},notifications=[],tabs=[],alarms=new Map();
  const event=name=>({addListener:fn=>listeners[name]=fn});
  globalThis.chrome={
    storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in store).map(k=>[k,store[k]])),set:async values=>Object.assign(store,values)}},
    runtime:{onInstalled:event('installed'),onStartup:event('startup'),onMessage:event('message'),getURL:path=>`chrome-extension://test/${path}`,openOptionsPage:async()=>{}},
    action:{onClicked:event('action')},
    alarms:{onAlarm:event('alarm'),create:async(name,data)=>alarms.set(name,data),clear:async name=>alarms.delete(name)},
    notifications:{onButtonClicked:event('button'),onClicked:event('notificationClick'),create:async(id,options)=>{notifications.push({id,options});return id;},clear:async()=>{}},
    tabs:{onRemoved:event('tabRemoved'),onUpdated:event('tabUpdated'),get:async id=>{const tab=tabs.find(t=>t.id===id);if(!tab) throw Error('No tab');return tab;},create:async options=>{const tab={id:tabs.length+1,...options};tabs.push(tab);return tab;},update:async(id,options)=>Object.assign(tabs.find(t=>t.id===id),options)},
    scripting:{executeScript:async()=>[]}
  };
  return {listeners,notifications,tabs,alarms};
}

test('cloud calls from tabbed settings reach background networking and school scripts are refused',async()=>{
  const store={attendanceCloudToken:'token',attendanceCloudDeviceId:'device',attendanceNtfyTopic:'soton-attendance-'+'a'.repeat(40)};
  const fake=fakeChrome(store),oldFetch=globalThis.fetch,calls=[];
  chrome.runtime.id='abcdefghijklmnopabcdefghijklmnop';
  globalThis.fetch=async(_url,options)=>{calls.push(JSON.parse(options.body));return Response.json({status:'active'});};
  try {
    await import(`../src/background.js?test=settings-${Date.now()}`);
    const send=(message,sender)=>new Promise(resolve=>fake.listeners.message(message,sender,resolve));
    const device=await send({type:'CLOUD_REQUEST',action:'device'},settingsSender());
    assert.equal(device.attendanceCloudDeviceId,'device');assert.equal(device.attendanceCloudToken,undefined);
    const entitlement=await send({type:'CLOUD_REQUEST',action:'entitlement'},settingsSender());
    assert.equal(entitlement.status,'active');assert.equal(calls.length,1);
    const rejected=await send({type:'CLOUD_REQUEST',action:'entitlement'},{id:chrome.runtime.id,url:'https://forms.office.com',tab:{id:1}});
    assert.match(rejected.error,/设置页/);assert.equal(calls.length,1);
  } finally {globalThis.fetch=oldFetch;}
});

test('a due class opens its form without nightly confirmation',async()=>{
  const today=todayMalaysia(),tomorrow=nextDay(today),now=new Date();
  const time=localTime(-56),endTime=localTime(4);
  const store={attendanceSessions:[{id:'today',course:'COMP1311',kind:'dated',date:today,time,endTime,createdAt:new Date(Date.now()-180000).toISOString()},
    {id:'tomorrow',course:'COMP1311',kind:'dated',date:tomorrow,time:'09:00',endTime:'10:00',createdAt:new Date(Date.now()-180000).toISOString()}],
    attendanceBindings:{COMP1311:{verified:true,url:'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=test'}},attendanceRecords:{}};
  const fake=fakeChrome(store);
  await import(`../src/background.js?test=${Date.now()}`);
  await fake.listeners.installed();
  assert.equal(fake.tabs.length,1);
  assert.equal(Object.values(store.attendanceRecords)[0].state,'launched');
  assert.equal(store.attendanceSessions.every(session=>session.kind==='weekly' && session.weekday!==undefined && !session.startDate && !session.endDate),true);
  assert.equal(fake.alarms.has('attendance-evening'),false);
  assert.equal(fake.notifications.some(n=>n.id?.startsWith('attendance-confirm:')),false);
});

test('stalled cloud with real runtime ID cannot delay local authorization or watchdog',async()=>{
  const date=todayMalaysia();
  const store={attendanceScheduleMode:'weekly',attendanceSessions:[{id:'cloud',course:'COMP1311',kind:'weekly',weekday:new Date(`${date}T00:00:00Z`).getUTCDay(),time:localTime(-56),endTime:localTime(4),createdAt:new Date(Date.now()-180000).toISOString()}],attendanceBindings:{COMP1311:{verified:true,url:'https://forms.office.com/Pages/ResponsePage.aspx?id=test'}},attendanceRecords:{}};
  const fake=fakeChrome(store),oldFetch=globalThis.fetch;
  chrome.runtime.id='abcdefghijklmnopabcdefghijklmnop';
  store.attendanceCloudToken='isolated-token';store.attendanceCloudDeviceId='isolated-device';store.attendanceNtfyTopic='soton-attendance-'+'a'.repeat(40);
  let requests=0;globalThis.fetch=()=>{requests++;return new Promise(()=>{});};
  try {
    await import(`../src/background.js?test=cloud-${Date.now()}`);
    await Promise.race([fake.listeners.installed(),new Promise((_,reject)=>setTimeout(()=>reject(Error('local scheduling stalled')),500))]);
    const key=Object.keys(store.attendanceRecords)[0];
    assert.equal(store.attendanceRecords[key].state,'launched');
    await fake.listeners.alarm({name:'attendance-cloud'});await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(requests,1,'cloud drain is actively stalled during authorization/watchdog');
    const result=await new Promise(resolve=>fake.listeners.message({type:'GET_RUN',key},{tab:{id:1}},resolve));
    assert.equal(result.occ.id,'cloud');
    await fake.listeners.alarm({name:`attendance-watch:${key}`});
    await fake.listeners.alarm({name:`attendance-watch:${key}`});
    assert.equal(store.attendanceRecords[key].state,'failed');
    assert.ok(fake.notifications.some(n=>n.options.title==='打卡失败'));
    assert.ok(store.attendanceCloudOutbox.items.some(i=>i.action==='event'&&i.payload.status==='failed'));
  } finally {globalThis.fetch=oldFetch;}
});

test('cloud event survives worker reconstruction and acknowledged replay never launches attendance',async()=>{
  const store={attendanceScheduleMode:'weekly',attendanceSessions:[],attendanceRecords:{},attendanceCloudToken:'token',attendanceCloudDeviceId:'device',attendanceNtfyTopic:'soton-attendance-'+'a'.repeat(40),attendanceCloudOutbox:{version:1,items:[{id:'durable-id',logical:'event:past',action:'event',payload:{occurrenceKey:'past',status:'unknown',courseCode:'COMP1311',classDate:'2026-09-30'},attempts:1,availableAt:0}]}};
  const oldFetch=globalThis.fetch,calls=[];globalThis.fetch=async(_url,opts)=>{calls.push(JSON.parse(opts.body));return Response.json({ok:true});};
  const fake=fakeChrome(store);chrome.runtime.id='abcdefghijklmnopabcdefghijklmnop';
  try {
    await import(`../src/background.js?test=replay-${Date.now()}`);
    await new Promise(resolve=>fake.listeners.message({type:'RETRY_CLOUD'},settingsSender(),resolve));
    for(let n=0;n<30&&store.attendanceCloudOutbox.items.length;n++) await new Promise(resolve=>setTimeout(resolve,1));
    assert.equal(store.attendanceCloudOutbox.items.length,0);assert.equal(calls.length,1);assert.equal(calls[0].occurrenceKey,'past');assert.equal(fake.tabs.length,0);
  } finally {globalThis.fetch=oldFetch;}
});

test('restart resolves overdue pending as unknown without launching the occurrence again',async()=>{
  const date=todayMalaysia(),time=localTime(-56),endTime=localTime(4),course='COMP1311';
  const key=`comp1311:${date}:${time}`;
  const occ={id:'restart',course,kind:'weekly',weekday:new Date(`${date}T00:00:00Z`).getUTCDay(),date,time,endTime,key,createdAt:new Date(Date.now()-180000).toISOString()};
  const store={attendanceScheduleMode:'weekly',attendanceSessions:[occ],attendanceRecords:{[key]:{state:'pending',at:new Date(Date.now()-120000).toISOString(),occ,tabId:99}}};
  const fake=fakeChrome(store);
  await import(`../src/background.js?test=restart-${Date.now()}`);await fake.listeners.startup();
  assert.equal(store.attendanceRecords[key].state,'submitted_pending_confirmation');assert.equal(fake.tabs.length,0);
  await fake.listeners.startup();assert.equal(fake.tabs.length,0);
});

test('all setup tabs open immediately, require independent confirmation and closing never passes',async()=>{
  const questions=[{title:'Student ID',type:'text'},{title:'Module Delivery',type:'radio',options:['Lecture','Tutorial','Lab']}];
  const binding={scope:'module',verified:true,url:'https://forms.office.com/Pages/ResponsePage.aspx?id=test',title:'COMP1311 Attendance',questions,mapping:questions.map((q,i)=>({...q,field:i?'delivery':'student'}))};
  const store={attendanceScheduleMode:'weekly',attendanceProfile:{student:'123',name:'A',studentType:'local'},attendanceBindings:{COMP1311:binding},attendanceDraft:{version:1,rows:[{course:'COMP1311-LEC'},{course:'COMP1311-LAB'}]}};
  const fake=fakeChrome(store);
  await import(`../src/background.js?test=setup-${Date.now()}`);
  const send=(message,tabId)=>new Promise(resolve=>fake.listeners.message(message,tabId?{tab:{id:tabId}}:settingsSender(),resolve));
  await send({type:'START_SETUP'});
  let session=store.attendanceSetupSession,item=session.items[session.current];
  const msg=type=>({type,sessionId:session.id,itemId:item.id});
  assert.equal(session.items.length,2);assert.equal(item.state,'opening');assert.equal(fake.tabs.length,2);assert.equal(session.items[1].state,'opening');
  assert.match((await send({type:'START_SETUP',moduleKey:'COMP9999'})).error,/已有课型检查/);
  assert.equal(fake.tabs.length,2);assert.equal(store.attendanceSetupSession.id,session.id);
  const premature=await send(msg('CONFIRM_SETUP_ITEM'),1);assert.ok(premature.error);
  await send(msg('GET_SETUP_ITEM'),1);await send({...msg('REPORT_SETUP_ITEM'),state:'awaiting_confirmation'},1);
  assert.equal(store.attendanceSetupSession.items[0].state,'awaiting_confirmation');
  await send(msg('CONFIRM_SETUP_ITEM'),1);
  session=store.attendanceSetupSession;assert.equal(session.items[0].state,'passed');assert.equal(fake.tabs.length,2);
  await fake.listeners.tabRemoved(2);
  assert.equal(store.attendanceSetupSession.items[1].state,'cancelled');assert.equal(store.attendanceSetupSession.state,'completed');
  assert.equal(store.attendanceSetupHistory.length,1);assert.equal(store.attendanceSetupSession.summaryEnqueued,true);
  assert.equal(store.attendanceRecords,undefined);
});

test('restart times out only the expired course tab and keeps the other check usable',async()=>{
  const questions=[{title:'Student ID',type:'text'},{title:'Module Delivery',type:'radio',options:['Lecture','Lab']}];
  const binding={scope:'module',verified:true,url:'https://forms.office.com/Pages/ResponsePage.aspx?id=test',title:'COMP1311',questions,mapping:questions.map((q,n)=>({...q,field:n?'delivery':'student'}))};
  const store={attendanceProfile:{student:'123',name:'A',studentType:'local'},attendanceBindings:{COMP1311:binding},attendanceDraft:{version:1,rows:[{course:'COMP1311-LEC'},{course:'COMP1311-LAB'}]}};
  const fake=fakeChrome(store);await import(`../src/background.js?test=parallel-restart-${Date.now()}`);
  const send=(message,sender=settingsSender())=>new Promise(resolve=>fake.listeners.message(message,sender,resolve));
  await send({type:'START_SETUP'});
  store.attendanceSetupSession.items[0].deadline=Date.now()-1;
  await fake.listeners.startup();
  const session=store.attendanceSetupSession,item=session.items[1];
  assert.equal(session.items[0].state,'timed_out');assert.equal(session.state,'running');
  assert.equal(fake.alarms.get(`attendance-setup:${session.id}`).when,item.deadline);
  for(const type of ['GET_SETUP_ITEM','REPORT_SETUP_ITEM','CONFIRM_SETUP_ITEM']) {
    const result=await send({type,sessionId:session.id,itemId:item.id,state:'awaiting_confirmation'},{tab:{id:2}});
    assert.equal(result.error,undefined);
  }
  assert.equal(store.attendanceSetupSession.items[1].state,'passed');assert.equal(store.attendanceSetupSession.state,'completed');
});

test('setup rejects stale profile confirmation and restart records timeout',async()=>{
  const questions=[{title:'Student ID',type:'text'}],binding={scope:'module',verified:true,url:'https://forms.office.com/Pages/ResponsePage.aspx?id=test',title:'COMP1311',questions,mapping:[{...questions[0],field:'student'}]};
  const store={attendanceProfile:{student:'123',name:'A',studentType:'local'},attendanceBindings:{COMP1311:binding},attendanceDraft:{version:1,rows:[{course:'COMP1311'}]}};
  const fake=fakeChrome(store);await import(`../src/background.js?test=stale-${Date.now()}`);
  const send=(type,extra={})=>new Promise(resolve=>{const s=store.attendanceSetupSession;fake.listeners.message({type,sessionId:s?.id,itemId:s?.items[s.current]?.id,...extra},type==='START_SETUP'?settingsSender():{tab:{id:1}},resolve);});
  await send('START_SETUP');await send('GET_SETUP_ITEM');await send('REPORT_SETUP_ITEM',{state:'awaiting_confirmation'});
  store.attendanceProfile.student='456';assert.match((await send('CONFIRM_SETUP_ITEM')).error,/配置已变化/);
  assert.equal(store.attendanceSetupSession.items[0].state,'failed');
  await send('START_SETUP');store.attendanceSetupSession.items[0].deadline=Date.now()-1;
  await fake.listeners.startup();assert.equal(store.attendanceSetupSession.items[0].state,'timed_out');
});

test('backup restore is serialized with terminal reports and keeps the newest result',async()=>{
  const date=todayMalaysia(),occ={id:'current',kind:'weekly',weekday:1,course:'COMP1311',date,time:'09:00',endTime:'10:00',key:`comp1311:${date}:09:00`};
  const record={state:'pending',occ,tabId:7,at:new Date().toISOString()};
  const store={attendanceScheduleMode:'weekly',attendanceSessions:[occ],attendanceRecords:{[occ.key]:record}};
  const backup=createBackup({attendanceSessions:[occ],attendanceRecords:{old:{state:'unknown',occ,at:'2026-10-01T00:00:00Z'}}});
  const fake=fakeChrome(store);await import(`../src/background.js?test=restore-race-${Date.now()}`);
  const send=(message,sender=settingsSender())=>new Promise(resolve=>{if(!fake.listeners.message(message,sender,resolve)) resolve({error:'unsupported restore'});});
  const reporting=send({type:'REPORT_RUN',key:occ.key,state:'success'},{tab:{id:7}});
  const restoring=send({type:'RESTORE_BACKUP',backup});
  assert.equal((await restoring).error,undefined);await reporting;
  assert.equal(store.attendanceRecords[occ.key].state,'success');
  assert.equal(store.attendanceSessions[0].enabled,false);
});

test('an automatic task notifies success only after content reports verified submission',async()=>{
  const date=todayMalaysia(),time=localTime(-56),endTime=localTime(4);
  const store={attendanceSessions:[{id:'a',course:'COMP1311',kind:'dated',date,time,endTime,createdAt:new Date(Date.now()-180000).toISOString()}],
    attendanceBindings:{COMP1311:{verified:true,url:'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=test'}},
    attendanceRecords:{}};
  const fake=fakeChrome(store);
  await import(`../src/background.js?test=success-${Date.now()}`);
  await fake.listeners.installed();
  assert.equal(fake.tabs.length,1);
  assert.equal(fake.notifications.some(n=>n.options.title==='打卡成功'),false);
  const key=Object.keys(store.attendanceRecords)[0];
  const send=message=>new Promise(resolve=>fake.listeners.message({type:'REPORT_RUN',key,...message},{tab:{id:1}},resolve));
  assert.deepEqual(await send({state:'pending'}),{ok:true});
  assert.equal(store.attendanceRecords[key].state,'pending');
  assert.deepEqual(await send({state:'success'}),{ok:true});
  assert.equal(store.attendanceRecords[key].state,'success');
  assert.equal(fake.notifications.some(n=>n.options.title==='打卡成功'),true);
});

test('a tutorial occurrence launches the shared module form link',async()=>{
  const date=todayMalaysia(),time=localTime(-56),endTime=localTime(4);
  const shared={scope:'module',verified:true,url:'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=shared',title:'COMP1311 Attendance',mapping:[]};
  const store={attendanceSessions:[{id:'tut',course:'COMP1311-TUT',kind:'dated',date,time,endTime,createdAt:new Date(Date.now()-180000).toISOString()}],attendanceBindings:{COMP1311:shared},attendanceRecords:{}};
  const fake=fakeChrome(store);
  await import(`../src/background.js?test=shared-${Date.now()}`);
  await fake.listeners.installed();
  assert.equal(fake.tabs.length,1);
  assert.match(fake.tabs[0].url,/id=shared/);
  const key=Object.keys(store.attendanceRecords)[0];
  const response=await new Promise(resolve=>fake.listeners.message({type:'GET_RUN',key},{tab:{id:1}},resolve));
  assert.equal(response.binding.url,shared.url);
  assert.equal(response.occ.course,'COMP1311-TUT');
  store.attendanceSessions=[];
  const afterClear=await new Promise(resolve=>fake.listeners.message({type:'GET_RUN',key},{tab:{id:1}},resolve));
  assert.match(afterClear.error,/已删除/);
  const pendingAfterClear=await new Promise(resolve=>fake.listeners.message({type:'REPORT_RUN',key,state:'pending'},{tab:{id:1}},resolve));
  assert.match(pendingAfterClear.error,/已删除/);
});

test('background serialization grants one permanent submission reservation across duplicate callers and watchdog paths',async()=>{
  const date=todayMalaysia(),time=localTime(-56),endTime=localTime(4);
  const store={attendanceSessions:[{id:'idempotent',course:'COMP1311',kind:'dated',date,time,endTime,createdAt:new Date(Date.now()-180000).toISOString()}],attendanceBindings:{COMP1311:{verified:true,url:'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=test'}},attendanceRecords:{}};
  const fake=fakeChrome(store);await import(`../src/background.js?test=idempotent-${Date.now()}`);await fake.listeners.installed();
  const key=Object.keys(store.attendanceRecords)[0];
  const send=message=>new Promise(resolve=>fake.listeners.message({key,...message},{tab:{id:1}},resolve));
  const results=await Promise.all([send({type:'RESERVE_SUBMISSION'}),send({type:'RESERVE_SUBMISSION'})]);
  assert.equal(results.filter(result=>result.granted).length,1);assert.ok(store.attendanceRecords[key].submissionAttemptedAt);
  await fake.listeners.alarm({name:`attendance-watch:${key}`});
  assert.equal(store.attendanceRecords[key].state,'submitted_pending_confirmation');
  const afterTimeout=await send({type:'RESERVE_SUBMISSION'});assert.equal(afterTimeout.granted,false);assert.equal(afterTimeout.reason,'already_attempted');
  await fake.listeners.startup();
  const afterRestart=await send({type:'RESERVE_SUBMISSION'});assert.equal(afterRestart.granted,false);
});

test('submitted_pending_confirmation stays local and maps to the existing cloud unknown state',async()=>{
  const date=todayMalaysia(),key='pending-cloud-occurrence';
  const store={attendanceRecords:{[key]:{state:'pending',tabId:1,submissionAttemptedAt:new Date().toISOString(),occ:{key,course:'COMP1311',date,time:'09:00',endTime:'10:00'}}}};
  const fake=fakeChrome(store),previousId=chrome.runtime.id;chrome.runtime.id='test-extension-id';
  try {
    await import(`../src/background.js?test=pending-cloud-${Date.now()}`);
    const sender={tab:{id:1}};
    const result=await new Promise(resolve=>fake.listeners.message({type:'REPORT_RUN',key,state:'submitted_pending_confirmation',detail:'none'},sender,resolve));
    assert.deepEqual(result,{ok:true});
    assert.equal(store.attendanceRecords[key].state,'submitted_pending_confirmation');
    assert.equal(store.attendanceCloudOutbox.items.find(item=>item.action==='event')?.payload.status,'unknown');
  } finally {chrome.runtime.id=previousId;}
});

test('login navigation fails an unopened task quickly and notifies the user',async()=>{
  const date=todayMalaysia(),time=localTime(-56),endTime=localTime(4);
  const store={attendanceSessions:[{id:'login',course:'COMP1311',kind:'dated',date,time,endTime,createdAt:new Date(Date.now()-180000).toISOString()}],attendanceBindings:{COMP1311:{verified:true,url:'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=test'}},attendanceRecords:{}};
  const fake=fakeChrome(store);await import(`../src/background.js?test=login-${Date.now()}`);await fake.listeners.installed();
  const key=Object.keys(store.attendanceRecords)[0];await fake.listeners.tabUpdated(1,{url:'https://login.microsoftonline.com/common/authorize'},{id:1});
  assert.equal(store.attendanceRecords[key].state,'failed');assert.ok(fake.notifications.some(item=>item.options.title==='需要登录学校账号'));
});

test('manual confirmation changes only the user-selected record and release requires explicit confirmation',async()=>{
  const date=todayMalaysia(),time=localTime(-56),endTime=localTime(4);
  const store={attendanceSessions:[{id:'manual',course:'COMP1311',kind:'dated',date,time,endTime,createdAt:new Date(Date.now()-180000).toISOString()}],attendanceBindings:{COMP1311:{verified:true,url:'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=test'}},attendanceRecords:{}};
  const fake=fakeChrome(store);await import(`../src/background.js?test=manual-${Date.now()}`);await fake.listeners.installed();
  const key=Object.keys(store.attendanceRecords)[0],settings=settingsSender();
  await new Promise(resolve=>fake.listeners.message({type:'RESERVE_SUBMISSION',key},{tab:{id:1}},resolve));await fake.listeners.alarm({name:`attendance-watch:${key}`});
  const marked=await new Promise(resolve=>fake.listeners.message({type:'MARK_SUBMITTED',key},settings,resolve));assert.deepEqual(marked,{ok:true});assert.equal(store.attendanceRecords[key].state,'success');
  const nextKey=`${key}:second`;store.attendanceRecords[nextKey]={...store.attendanceRecords[key],state:'submitted_pending_confirmation',submissionKey:nextKey,submissionAttemptedAt:'2026-10-05T07:00:00.000Z',occ:{...store.attendanceRecords[key].occ,key:nextKey},tabId:1};
  const denied=await new Promise(resolve=>fake.listeners.message({type:'RELEASE_SUBMISSION',key:nextKey,confirm:false},settings,resolve));assert.match(denied.error,/明确确认/);assert.ok(store.attendanceRecords[nextKey].submissionAttemptedAt);
  const released=await new Promise(resolve=>fake.listeners.message({type:'RELEASE_SUBMISSION',key:nextKey,confirm:true},settings,resolve));assert.deepEqual(released,{ok:true});assert.equal(store.attendanceRecords[nextKey].submissionAttemptedAt,undefined);assert.equal(store.attendanceRecords[nextKey].state,'submitted_pending_confirmation');
});
