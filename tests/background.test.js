import test from 'node:test';
import assert from 'node:assert/strict';
import {todayMalaysia} from '../src/schedule.js';
import {scheduleWeekStart} from '../src/runtime-timing.js';
import {createBackup} from '../src/backup.js';
import {ERROR_CODES,runError} from '../src/diagnostics.js';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const settingsSender=()=>({url:chrome.runtime.getURL('options.html'),id:chrome.runtime.id,tab:{id:99,url:chrome.runtime.getURL('options.html')}});
const nextDay=date=>{const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);};
const localTime=offsetMinutes=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(Date.now()+offsetMinutes*60000)).map(p=>[p.type,p.value]));return `${parts.hour}:${parts.minute}`;};
async function manualFixture(time='09:10') {
  const RealDate=Date,previousFetch=globalThis.fetch;let now=RealDate.parse(`2026-10-22T${time}:00+08:00`);
  globalThis.Date=class extends RealDate {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
  const session={id:'manual-session',course:'COMP1311-LEC',type:'LEC',kind:'weekly',weekday:4,time:'09:00',endTime:'10:00',weekStartDate:'2026-10-19',weekState:'active',enabled:true,createdAt:'2026-10-19T00:00:00+08:00'};
  const store={attendanceScheduleMode:'weekly',attendanceSessions:[session],attendanceRecords:{},attendanceProfile:{student:'12345',name:'Manual Fixture',studentType:'local'},attendanceBindings:{COMP1311:{scope:'module',verified:true,url:'https://forms.office.com/r/manual-fixture'}}};
  const fake=fakeChrome(store);await import('../src/background.js?manual-fixture='+crypto.randomUUID());
  return {store,fake,session,key:'comp1311-lec:2026-10-22:09:00',send:(message,sender=settingsSender())=>new Promise(resolve=>{if(!fake.listeners.message(message,sender,resolve))resolve(null);}),move:time=>{now=RealDate.parse(`2026-10-22T${time}:00+08:00`);},moveTo:value=>{now=RealDate.parse(value);},restart:async()=>{await import('../src/background.js?manual-restart='+crypto.randomUUID());await fake.listeners.startup();},close:()=>{globalThis.Date=RealDate;globalThis.fetch=previousFetch;}};
}
function fakeChrome(store,assignWeek=true) {
  if(assignWeek) {
    for(const row of [...(store.attendanceSessions||[]),...Object.values(store.attendanceRecords||{}).map(r=>r.occ).filter(Boolean)]) if(!Object.hasOwn(row,'weekStartDate')) row.weekStartDate=scheduleWeekStart(Date.parse((row.date||todayMalaysia())+'T00:00:00+08:00'));
  }
  const previousFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>JSON.parse(options?.body||'{}').action==='plugin-license-status'
    ? Response.json({licensed:true,plan:'lifetime_license',expires_at:null}) : previousFetch(url,options);
  const listeners={},notifications=[],tabs=[],alarms=new Map(),badge={};
  const event=name=>({addListener:fn=>listeners[name]=fn});
  globalThis.chrome={
    storage:{local:{get:async keys=>{const values={attendanceCloudToken:'test-token',attendanceCloudDeviceId:'test-device',attendanceNtfyTopic:'test-topic',...store};return Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in values).map(k=>[k,values[k]]));},set:async values=>Object.assign(store,values),remove:async key=>{delete store[key];}}},
    runtime:{onInstalled:event('installed'),onStartup:event('startup'),onMessage:event('message'),getURL:path=>`chrome-extension://test/${path}`,openOptionsPage:async()=>{}},
    action:{onClicked:event('action'),setBadgeText:async({text})=>{badge.text=text;},setBadgeBackgroundColor:async({color})=>{badge.color=color;}},
    alarms:{onAlarm:event('alarm'),create:async(name,data)=>alarms.set(name,data),clear:async name=>alarms.delete(name)},
    notifications:{onButtonClicked:event('button'),onClicked:event('notificationClick'),create:async(id,options)=>{notifications.push({id,options});return id;},clear:async()=>{}},
    tabs:{onRemoved:event('tabRemoved'),onUpdated:event('tabUpdated'),get:async id=>{const tab=tabs.find(t=>t.id===id);if(!tab) throw Error('No tab');return tab;},create:async options=>{const tab={id:tabs.length+1,...options};tabs.push(tab);return tab;},update:async(id,options)=>Object.assign(tabs.find(t=>t.id===id),options)},
    scripting:{executeScript:async()=>[]}
  };
  return {listeners,notifications,tabs,alarms,badge};
}

test('manual entry reuses the scheduled key and grants only one concurrent launch/reservation',async()=>{
  const f=await manualFixture();try {
    const [first,second]=await Promise.all([f.send({type:'MANUAL_CHECK_IN',sessionId:f.session.id}),f.send({type:'MANUAL_CHECK_IN',sessionId:f.session.id})]);
    assert.equal(first?.ok,true,JSON.stringify(first));assert.equal(first.key,f.key);assert.ok(second?.error);assert.equal(f.fake.tabs.length,1);
    const r=f.store.attendanceRecords[f.key];assert.equal(r.origin,'manual');assert.equal(r.attemptHistory.length,1);assert.equal(r.attemptHistory[0].origin,'manual');
    const sender={tab:{id:r.tabId}},results=await Promise.all([f.send({type:'RESERVE_SUBMISSION',key:f.key},sender),f.send({type:'RESERVE_SUBMISSION',key:f.key},sender)]);
    assert.equal(results.filter(r=>r?.granted).length,1);
  } finally {f.close();}
});
test('manual background rejects forged, wrong-sender, early, ended, paused and unlicensed requests',async()=>{
  const f=await manualFixture('08:59');try {
    assert.ok((await f.send({type:'MANUAL_CHECK_IN',sessionId:f.session.id}))?.error);
    f.move('09:10');assert.ok((await f.send({type:'MANUAL_CHECK_IN',sessionId:f.session.id},{tab:{id:7},url:'https://forms.office.com/r/manual-fixture'}))?.error);
    assert.ok((await f.send({type:'MANUAL_CHECK_IN',sessionId:f.session.id,occ:{time:'00:00'}}))?.error);
    assert.ok((await f.send({type:'MANUAL_CHECK_IN',sessionId:'unknown'}))?.error);
    f.session.enabled=false;assert.ok((await f.send({type:'MANUAL_CHECK_IN',sessionId:f.session.id}))?.error);f.session.enabled=true;
    globalThis.fetch=async()=>Response.json({licensed:false});assert.equal((await f.send({type:'MANUAL_CHECK_IN',sessionId:f.session.id}))?.error,'plugin_license_required');
    f.move('10:00');assert.ok((await f.send({type:'MANUAL_CHECK_IN',sessionId:f.session.id}))?.error);assert.equal(f.fake.tabs.length,0);
  } finally {f.close();}
});

test('manual reservation revalidates start and saved configuration after asynchronous authorization',async()=>{
  const f=await manualFixture();try {
    const run=await f.send({type:'MANUAL_CHECK_IN',sessionId:f.session.id}),sender={tab:{id:run.tabId}};
    f.move('08:59');assert.equal((await f.send({type:'RESERVE_SUBMISSION',key:f.key},sender)).granted,false);assert.equal(f.store.attendanceRecords[f.key].submissionKey,undefined);
    f.move('09:10');globalThis.fetch=async()=>{f.store.attendanceSessions[0].enabled=false;return Response.json({licensed:true});};
    const result=await f.send({type:'RESERVE_SUBMISSION',key:f.key},sender);assert.notEqual(result.granted,true);assert.equal(f.store.attendanceRecords[f.key].submissionKey,undefined);
  } finally {f.close();}
});
test('manual invalid binding rejects before claiming and leaves scheduled eligibility untouched',async()=>{
  const f=await manualFixture();try {
    f.store.attendanceBindings={};assert.ok((await f.send({type:'MANUAL_CHECK_IN',sessionId:f.session.id})).error);
    assert.equal(f.store.attendanceRecords[f.key],undefined);assert.equal(f.fake.tabs.length,0);
  } finally {f.close();}
});
test('scheduled validation failure consumes manual catch-up intent without reopening it',async()=>{
  const f=await manualFixture();try {
    const run=await f.send({type:'MANUAL_CHECK_IN',sessionId:f.session.id});await f.send({type:'REPORT_RUN',key:f.key,state:'failed',submissionNotClicked:true},{tab:{id:run.tabId}});
    f.store.attendanceBindings={};f.move('09:56');await f.fake.listeners.alarm({name:'attendance-next'});
    const r=f.store.attendanceRecords[f.key];assert.notEqual(r.state,'scheduled');assert.equal(r.catchUpIntent.state,'completed');assert.equal(r.attemptHistory.length,1);
    await f.restart();assert.equal(f.fake.tabs.length,1);
  } finally {f.close();}
});
test('manual unreserved watchdog and closed tab return only the original scheduled opportunity',async()=>{
  const f=await manualFixture();try {
    const run=await f.send({type:'MANUAL_CHECK_IN',sessionId:f.session.id});
    chrome.scripting.executeScript=async()=>{throw Error('Fixture closed tab');};await f.fake.listeners.tabRemoved(run.tabId);
    assert.equal(f.store.attendanceRecords[f.key].state,'scheduled');f.move('09:56');await f.restart();assert.equal(f.fake.tabs.length,2);
    await f.restart();assert.equal(f.fake.tabs.length,2);
  } finally {f.close();}
});
test('scheduled claim wins against concurrent manual request without a second run',async()=>{
  const f=await manualFixture('09:56');try {
    const [,manual]=await Promise.all([f.fake.listeners.alarm({name:'attendance-next'}),f.send({type:'MANUAL_CHECK_IN',sessionId:f.session.id})]);
    assert.ok(manual.error);assert.equal(f.fake.tabs.length,1);assert.equal(f.store.attendanceRecords[f.key].origin,'scheduled');
  } finally {f.close();}
});
test('manual recovery restart after deadline or week expiry records missed without renewal',async()=>{
  const f=await manualFixture();try {
    const run=await f.send({type:'MANUAL_CHECK_IN',sessionId:f.session.id});await f.send({type:'REPORT_RUN',key:f.key,state:'failed',submissionNotClicked:true},{tab:{id:run.tabId}});
    f.move('10:00');await f.restart();const r=f.store.attendanceRecords[f.key];assert.equal(r.state,'missed');assert.equal(r.catchUpIntent.state,'completed');assert.equal(r.attemptHistory[0].state,'failed');assert.equal(f.fake.tabs.length,1);
  } finally {f.close();}
});
test('manual pending recovery cannot renew an expired week on worker restart',async()=>{
  const f=await manualFixture();try {
    const run=await f.send({type:'MANUAL_CHECK_IN',sessionId:f.session.id});await f.send({type:'REPORT_RUN',key:f.key,state:'failed',submissionNotClicked:true},{tab:{id:run.tabId}});
    f.moveTo('2026-10-26T09:10:00+08:00');await f.restart();const r=f.store.attendanceRecords[f.key];assert.equal(r.state,'missed');assert.equal(r.catchUpIntent.state,'completed');assert.equal(r.attemptHistory[0].state,'failed');assert.equal(f.fake.tabs.length,1);assert.equal(f.store.attendanceSessions[0].weekStartDate,'2026-10-19');assert.equal(f.store.attendanceSessions[0].enabled,false);
  } finally {f.close();}
});
test('manual recovery persists a durable scheduler wake before commit-response loss, without startup or rebuild',async()=>{
  const f=await manualFixture();try {
    const run=await f.send({type:'MANUAL_CHECK_IN',sessionId:f.session.id});f.move('09:56');
    const set=chrome.storage.local.set;let interrupted=false;
    chrome.storage.local.set=async values=>{await set(values);if(!interrupted&&values.attendanceRecords?.[f.key]?.catchUpIntent?.state==='pending'){interrupted=true;throw Error('Fixture worker stopped after commit');}};
    assert.ok((await f.send({type:'REPORT_RUN',key:f.key,state:'failed',submissionNotClicked:true},{tab:{id:run.tabId}})).error);
    const alarmName=`attendance-retry:${f.key}`;assert.ok(f.fake.alarms.has(alarmName));assert.equal(f.store.attendanceRecords[f.key].state,'scheduled');
    chrome.storage.local.set=set;await import('../src/background.js?manual-alarm-wake='+crypto.randomUUID());await f.fake.listeners.alarm({name:alarmName});
    assert.equal(f.fake.tabs.length,2);assert.equal(f.store.attendanceRecords[f.key].catchUpIntent.state,'completed');await f.fake.listeners.alarm({name:alarmName});assert.equal(f.fake.tabs.length,2);
  } finally {f.close();}
});
test('manual catch-up intent cannot override a persisted reservation or unknown outcome after restart',async()=>{
  const f=await manualFixture();try {
    const run=await f.send({type:'MANUAL_CHECK_IN',sessionId:f.session.id});await f.send({type:'RESERVE_SUBMISSION',key:f.key},{tab:{id:run.tabId}});
    const record=f.store.attendanceRecords[f.key];record.state='unknown';record.catchUpIntent={sourceAttemptId:record.activeAttemptId,state:'pending'};
    f.move('09:56');await f.restart();assert.equal(f.fake.tabs.length,1);assert.equal(f.store.attendanceRecords[f.key].state,'unknown');assert.equal(f.store.attendanceRecords[f.key].submissionKey,f.key);assert.equal(f.store.attendanceRecords[f.key].catchUpIntent.state,'completed');
  } finally {f.close();}
});
test('manual claim persisted before tab opening survives restart without a second claim',async()=>{
  const f=await manualFixture();try {
    const set=chrome.storage.local.set;let interrupted=false;
    chrome.storage.local.set=async values=>{await set(values);if(!interrupted&&values.attendanceRecords?.[f.key]?.state==='launched'){interrupted=true;throw Error('Fixture stopped after claim');}};
    assert.ok((await f.send({type:'MANUAL_CHECK_IN',sessionId:f.session.id})).error);chrome.storage.local.set=set;
    assert.equal(f.fake.tabs.length,0);assert.equal(f.store.attendanceRecords[f.key].attemptHistory.length,1);assert.ok(f.fake.alarms.has(`attendance-watch:${f.key}`));
    await f.restart();assert.equal(f.fake.tabs.length,0);assert.equal(f.store.attendanceRecords[f.key].state,'launched');
    f.move('09:56');await f.fake.listeners.alarm({name:`attendance-watch:${f.key}`});assert.equal(f.fake.tabs.length,1);assert.equal(f.store.attendanceRecords[f.key].origin,'scheduled');
  } finally {f.close();}
});
test('manual reservation commit before lost response stays locked across restart',async()=>{
  const f=await manualFixture();try {
    const run=await f.send({type:'MANUAL_CHECK_IN',sessionId:f.session.id}),set=chrome.storage.local.set;let interrupted=false;
    chrome.storage.local.set=async values=>{await set(values);if(!interrupted&&values.attendanceRecords?.[f.key]?.submissionKey){interrupted=true;throw Error('Fixture reservation response lost');}};
    assert.ok((await f.send({type:'RESERVE_SUBMISSION',key:f.key},{tab:{id:run.tabId}})).error);chrome.storage.local.set=set;
    await f.restart();assert.equal((await f.send({type:'RESERVE_SUBMISSION',key:f.key},{tab:{id:run.tabId}})).granted,false);
    f.move('09:56');await f.fake.listeners.alarm({name:`attendance-watch:${f.key}`});await f.restart();assert.equal(f.fake.tabs.length,1);assert.equal(f.store.attendanceRecords[f.key].submissionKey,f.key);assert.equal(f.store.attendanceRecords[f.key].state,'submitted_pending_confirmation');
  } finally {f.close();}
});
test('scheduled foreground fallback closes the failed historical attempt before retrying',async()=>{
  const f=await manualFixture();try {
    const run=await f.send({type:'MANUAL_CHECK_IN',sessionId:f.session.id});await f.send({type:'REPORT_RUN',key:f.key,state:'failed',submissionNotClicked:true},{tab:{id:run.tabId}});
    f.move('09:56');await f.fake.listeners.alarm({name:'attendance-next'});const r=f.store.attendanceRecords[f.key];r.needForeground=true;
    chrome.tabs.remove=async()=>{};
    const response=await f.send({type:'REPORT_RUN',key:f.key,state:'failed',submissionNotClicked:true,error:{code:'date_fill_hidden_tab',phase:'fill'}},{tab:{id:r.tabId}});assert.equal(response.retry,true);
    assert.equal(f.store.attendanceRecords[f.key].attemptHistory[1].state,'failed');assert.ok(f.store.attendanceRecords[f.key].attemptHistory[1].completedAt);assert.equal(f.store.attendanceRecords[f.key].attemptHistory[0].state,'failed');
  } finally {f.close();}
});
for(const time of ['09:20','09:55','09:56','10:00']) test(`manual pre-submit failure at ${time} preserves or evaluates the scheduled opportunity`,async()=>{
  const f=await manualFixture();try {
    const run=await f.send({type:'MANUAL_CHECK_IN',sessionId:f.session.id});assert.equal(run.ok,true);
    f.move(time);
    const response=await f.send({type:'REPORT_RUN',key:f.key,state:'failed',submissionNotClicked:true,detail:'mock pre-submit failure'},{tab:{id:run.tabId}});
    assert.equal(response.ok,true);const r=f.store.attendanceRecords[f.key];
    assert.equal(r.attemptHistory[0].state,'failed');assert.equal(r.attemptHistory[0].origin,'manual');
    if(time==='09:20') {assert.equal(r.state,'scheduled');assert.equal(f.fake.tabs.length,1);assert.equal(f.fake.alarms.get('attendance-next').when,Date.parse('2026-10-22T09:55:00+08:00'));assert.equal(r.catchUpIntent.state,'pending');}
    else if(time==='10:00') {assert.equal(r.state,'missed');assert.equal(f.fake.tabs.length,1);}
    else {assert.equal(r.state,'launched');assert.equal(r.origin,'scheduled');assert.equal(r.attemptHistory.length,2);assert.equal(r.catchUpIntent.state,'completed');assert.equal(f.fake.tabs.length,2);}
  } finally {f.close();}
});
for(const alarmFirst of [false,true]) test(`manual catch-up race, replay and restart remain at most once (${alarmFirst})`,async()=>{
  const f=await manualFixture();try {
    const run=await f.send({type:'MANUAL_CHECK_IN',sessionId:f.session.id});f.move('09:56');
    const failure=()=>f.send({type:'REPORT_RUN',key:f.key,state:'failed',submissionNotClicked:true},{tab:{id:run.tabId}}),alarm=()=>f.fake.listeners.alarm({name:'attendance-next'});
    await Promise.all(alarmFirst?[alarm(),failure()]:[failure(),alarm()]);
    assert.equal(f.fake.tabs.length,2);assert.equal(f.store.attendanceRecords[f.key].origin,'scheduled');
    assert.ok((await failure()).error);await alarm();await f.restart();assert.equal(f.fake.tabs.length,2);
    const r=f.store.attendanceRecords[f.key];await f.send({type:'REPORT_RUN',key:f.key,state:'failed',submissionNotClicked:true},{tab:{id:r.tabId}});
    await alarm();assert.equal(f.fake.tabs.length,2);assert.equal(f.store.attendanceRecords[f.key].attemptHistory.length,2);
  } finally {f.close();}
});
for(const outcome of ['success','failed','submitted_pending_confirmation']) test(`manual reserved ${outcome} never permits compensating or scheduled submission`,async()=>{
  const f=await manualFixture();try {
    const run=await f.send({type:'MANUAL_CHECK_IN',sessionId:f.session.id}),sender={tab:{id:run.tabId}};
    assert.equal((await f.send({type:'RESERVE_SUBMISSION',key:f.key},sender)).granted,true);
    await f.send({type:'REPORT_RUN',key:f.key,state:outcome,submissionNotClicked:true},sender);
    f.move('09:56');await f.fake.listeners.alarm({name:'attendance-next'});await f.restart();
    assert.equal(f.fake.tabs.length,1);assert.equal(f.store.attendanceRecords[f.key].submissionKey,f.key);assert.ok((await f.send({type:'MANUAL_CHECK_IN',sessionId:f.session.id})).error);
  } finally {f.close();}
});
test('manual pending recovery survives restart before claim and preserves manual history after scheduled success',async()=>{
  const f=await manualFixture();try {
    const run=await f.send({type:'MANUAL_CHECK_IN',sessionId:f.session.id});
    await f.send({type:'REPORT_RUN',key:f.key,state:'failed',submissionNotClicked:true},{tab:{id:run.tabId}});
    assert.equal(f.store.attendanceRecords[f.key].state,'scheduled');f.move('09:56');await f.restart();
    const r=f.store.attendanceRecords[f.key];assert.equal(r.origin,'scheduled');assert.equal(f.fake.tabs.length,2);
    const sender={tab:{id:r.tabId}};await f.send({type:'RESERVE_SUBMISSION',key:f.key},sender);await f.send({type:'REPORT_RUN',key:f.key,state:'success'},sender);
    assert.deepEqual(f.store.attendanceRecords[f.key].attemptHistory.map(a=>[a.origin,a.state]),[['manual','failed'],['scheduled','success']]);
    await f.restart();assert.equal(f.fake.tabs.length,2);
  } finally {f.close();}
});

test('weekly startup disables legacy and expired tasks without renewing or deleting submission history',async()=>{
  const date=todayMalaysia(),records={success:{state:'success',submissionKey:'success'},unknown:{state:'unknown',submissionAttemptedAt:'old',submissionKey:'unknown'}};
  const store={attendanceScheduleMode:'weekly',attendanceSessions:[{id:'legacy',kind:'weekly',weekday:1,course:'COMP1311',time:'09:00',endTime:'10:00',enabled:true},{id:'expired',kind:'weekly',weekday:1,course:'COMP1312',time:'09:00',endTime:'10:00',weekStartDate:'2026-01-05',enabled:true}],attendanceRecords:structuredClone(records)};
  const fake=fakeChrome(store,false);await import('../src/background.js?week-legacy='+Date.now());await fake.listeners.startup();
  assert.equal(store.attendanceSessions[0].enabled,false);assert.equal(store.attendanceSessions[0].weekState,'needs_week_assignment');
  assert.equal(store.attendanceSessions[1].weekStartDate,'2026-01-05');assert.equal(store.attendanceSessions[1].weekState,'expired');
  assert.deepEqual(store.attendanceRecords,records);assert.equal(fake.tabs.length,0);assert.equal(fake.alarms.has('attendance-next'),false);
  await fake.listeners.startup();assert.equal(store.attendanceSessions[0].weekStartDate,undefined);
});

test('unchanged weekly load does not rewrite sessions and serialized settings reject stale replacements',async()=>{
  const weekStartDate=scheduleWeekStart(),store={attendanceScheduleMode:'weekly',attendanceSessions:[{id:'stable',kind:'weekly',weekday:1,course:'COMP1311',time:'09:00',endTime:'10:00',weekStartDate,weekState:'active',enabled:false}],attendanceRecords:{}};
  const fake=fakeChrome(store),set=chrome.storage.local.set;let sessionWrites=0;
  chrome.storage.local.set=async values=>{if('attendanceSessions' in values)sessionWrites++;return set(values);};
  await import('../src/background.js?week-write-race='+Date.now());
  const send=m=>new Promise(resolve=>fake.listeners.message(m,settingsSender(),resolve));
  await send({type:'REBUILD_SCHEDULE'});assert.equal(sessionWrites,0);
  const expectedSessions=JSON.stringify(store.attendanceSessions),paused=structuredClone(store.attendanceSessions);
  const first=await send({type:'SAVE_SCHEDULES',expectedSessions,sessions:paused});assert.equal(first?.ok,true);
  paused[0].enabled=true;
  const original=JSON.stringify(store.attendanceSessions);
  const result=await send({type:'SAVE_SCHEDULES',expectedSessions:'stale',sessions:paused});assert.match(result?.error||'',/变化|changed/);assert.equal(JSON.stringify(store.attendanceSessions),original);
});

test('license authorization returning after the week boundary never launches the expired task',async()=>{
  const RealDate=Date;let now=RealDate.parse('2026-10-25T23:58:00+08:00');
  globalThis.Date=class extends RealDate {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
  let release,entered;const waiting=new Promise(resolve=>{entered=resolve;}),authorization=new Promise(resolve=>{release=resolve;});
  const store={attendanceScheduleMode:'weekly',attendanceSessions:[{id:'late-auth',kind:'weekly',weekday:0,course:'COMP1311',type:'LEC',time:'23:00',endTime:'23:59',weekStartDate:'2026-10-19'}],attendanceBindings:{COMP1311:{verified:true,url:'https://forms.office.com/r/fixture'}}};
  const fake=fakeChrome(store),previousFetch=globalThis.fetch;
  globalThis.fetch=async()=>{entered();await authorization;return Response.json({licensed:true,plan:'lifetime_license',expires_at:null});};
  try {await import('../src/background.js?week-late-auth='+Math.random());const pending=fake.listeners.startup();await waiting;now=RealDate.parse('2026-10-26T00:00:00+08:00');release();await pending;assert.equal(fake.tabs.length,0);}
  finally {globalThis.Date=RealDate;globalThis.fetch=previousFetch;}
});

test('week boundary during opening alarm setup is rechecked immediately before tab creation',async()=>{
  const RealDate=Date;let now=RealDate.parse('2026-10-25T23:58:00+08:00');
  globalThis.Date=class extends RealDate {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
  const store={attendanceScheduleMode:'weekly',attendanceSessions:[{id:'opening-boundary',kind:'weekly',weekday:0,course:'COMP1311',type:'LEC',time:'23:00',endTime:'23:59',weekStartDate:'2026-10-19'}],attendanceBindings:{COMP1311:{verified:true,url:'https://forms.office.com/r/fixture'}}};
  const fake=fakeChrome(store),create=chrome.alarms.create;
  chrome.alarms.create=async(name,value)=>{if(name.startsWith('attendance-end:')) now=RealDate.parse('2026-10-26T00:00:00+08:00');return create(name,value);};
  try {await import('../src/background.js?week-opening-boundary='+Math.random());await fake.listeners.startup();assert.equal(fake.tabs.length,0);assert.equal(Object.values(store.attendanceRecords)[0].state,'missed');}
  finally {globalThis.Date=RealDate;}
});

test('RUN_TEST_NOW requires settings, test flag and exact allowlist, runs one task and rechecks before reservation',async()=>{
  const RealDate=Date,date=todayMalaysia(),now=RealDate.parse(`${date}T09:00:00+08:00`);
  globalThis.Date=class extends RealDate {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
  try {
    const session={id:'test-template',course:'COMP1311-LEC',type:'LEC',kind:'weekly',weekday:new Date(`${date}T00:00:00Z`).getUTCDay(),startDate:date,endDate:date,time:'09:00',endTime:'10:00',testTemplate:true,isTest:true,testBindingId:'COMP1311',enabled:false};
    const binding={scope:'module',verified:true,isTest:true,url:'https://forms.office.com/r/AllowedTest'};
    const store={attendanceScheduleMode:'weekly',attendanceSessions:[session],attendanceBindings:{COMP1311:binding},testFormAllowlist:[],attendanceRecords:{}};
    const fake=fakeChrome(store);chrome.tabs.remove=async()=>{};
    await import(`../src/background.js?run-test=${Math.random()}`);
    const send=(message,sender=settingsSender())=>new Promise(resolve=>fake.listeners.message(message,sender,resolve));
    assert.equal((await send({type:'RUN_TEST_NOW',bindingId:'COMP1311'})).error,'not_allowed');assert.equal(fake.tabs.length,0);
    store.testFormAllowlist=[{host:'forms.office.com',formId:'AllowedTest'}];
    assert.equal((await send({type:'RUN_TEST_NOW',bindingId:'COMP1311'},{url:'https://evil.example'})).error,'not_allowed');
    binding.isTest=false;assert.equal((await send({type:'RUN_TEST_NOW',bindingId:'COMP1311'})).error,'not_allowed');binding.isTest=true;
    const licensedFetch=globalThis.fetch;
    globalThis.fetch=async()=>Response.json({licensed:false});
    try {assert.equal((await send({type:'RUN_TEST_NOW',bindingId:'COMP1311'})).error,'plugin_license_required');assert.equal(fake.tabs.length,0);assert.equal(store.attendanceSessions.length,1);}
    finally {globalThis.fetch=licensedFetch;}
    const run=await send({type:'RUN_TEST_NOW',bindingId:'COMP1311'});
    assert.equal(run.ok,true);assert.equal(fake.tabs.length,1);assert.equal(store.attendanceRecords[run.key].state,'launched');
    assert.equal(store.attendanceRecords[run.key].occ.isTest,true);assert.equal(store.attendanceRecords[run.key].attempts,1);
    assert.equal(store.attendanceRecords[run.key].occ.course,session.course);
    assert.equal(store.attendanceRecords[run.key].occ.testDeadline,now+15*60000);
    assert.ok(store.attendanceRecords[run.key].occ.testAuthorizationExpiresAt>=now+15*60000);
    assert.equal(store.attendanceSessions.find(session=>session.id==='test-template').enabled,false);
    const sender={tab:{id:run.tabId},url:binding.url};
    store.testFormAllowlist=[];assert.equal((await send({type:'RESERVE_SUBMISSION',key:run.key},sender)).reason,'not_allowed');
    assert.equal(store.attendanceRecords[run.key].submissionAttemptedAt,undefined);
    store.testFormAllowlist=[{host:'forms.office.com',formId:'AllowedTest'},{host:'forms.office.com',formId:'OtherTest'}];
    assert.equal((await send({type:'RESERVE_SUBMISSION',key:run.key},{...sender,url:'https://forms.office.com/r/OtherTest'})).reason,'not_allowed');
    assert.equal((await send({type:'RESERVE_SUBMISSION',key:run.key},sender)).granted,true);
    assert.equal((await send({type:'RESERVE_SUBMISSION',key:run.key},sender)).granted,false);
    await fake.listeners.tabRemoved(run.tabId);
    assert.equal(store.attendanceRecords[run.key].state,'submitted_pending_confirmation');
    assert.equal(fake.alarms.has(`attendance-retry:${run.key}`),false);
  } finally {globalThis.Date=RealDate;}
});

test('test jobs retry a closed tab before clicking but refuse with one minute remaining',async()=>{
  const RealDate=Date,date=todayMalaysia();let now=RealDate.parse(`${date}T09:00:00+08:00`);
  globalThis.Date=class extends RealDate {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
  try {
    const session={id:'template',course:'COMP1311-LEC',type:'LEC',kind:'weekly',weekday:new Date(`${date}T00:00:00Z`).getUTCDay(),startDate:date,endDate:date,time:'09:00',endTime:'10:00',testTemplate:true};
    const store={attendanceScheduleMode:'weekly',attendanceSessions:[session],attendanceBindings:{COMP1311:{scope:'module',isTest:true,verified:true,url:'https://forms.office.com/r/Test'}},testFormAllowlist:[{host:'forms.office.com',formId:'Test'}],attendanceRecords:{}};
    const fake=fakeChrome(store);chrome.tabs.remove=async()=>{};
    await import(`../src/background.js?test-retry=${Math.random()}`);
    const send=message=>new Promise(resolve=>fake.listeners.message(message,settingsSender(),resolve));
    const run=await send({type:'RUN_TEST_NOW',bindingId:'COMP1311'});
    await fake.listeners.tabRemoved(run.tabId);assert.equal(store.attendanceRecords[run.key].state,'scheduled');
    await fake.listeners.alarm({name:`attendance-retry:${run.key}`});
    assert.equal(store.attendanceRecords[run.key].attempts,2);assert.notEqual(store.attendanceRecords[run.key].tabId,run.tabId);
    for(const minute of [5,10]) {
      now=RealDate.parse(`${date}T09:00:00+08:00`)+minute*60000;
      await fake.listeners.tabRemoved(store.attendanceRecords[run.key].tabId);
      await fake.listeners.alarm({name:`attendance-retry:${run.key}`});
      assert.equal(store.attendanceRecords[run.key].state,'launched');
    }
    assert.equal(store.attendanceRecords[run.key].attempts,4);
    now=RealDate.parse(`${date}T09:59:00+08:00`);
    await fake.listeners.alarm({name:`attendance-end:${run.key}`});assert.equal(store.attendanceRecords[run.key].state,'missed');
    const next=await send({type:'RUN_TEST_NOW',bindingId:'COMP1311'});assert.equal(next.ok,true);
    assert.equal(store.attendanceRecords[next.key].state,'launched');assert.equal(store.attendanceRecords[next.key].submissionAttemptedAt,undefined);
    now+=15*60000;
    await fake.listeners.tabRemoved(next.tabId);
    assert.equal(store.attendanceRecords[next.key].error.code,'test_authorization_expired');
  } finally {globalThis.Date=RealDate;}
});

test('hidden date failure retries foreground once, restores minimized window and reserves only once',async()=>{
  const RealDate=Date,date=todayMalaysia(),now=RealDate.parse(`${date}T09:56:00+08:00`);
  globalThis.Date=class extends RealDate {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
  try {
    const occ={id:'foreground',course:'COMP1311',type:'LEC',kind:'weekly',weekday:new Date(`${date}T00:00:00Z`).getUTCDay(),date,time:'09:00',endTime:'10:00'};
    const key=`comp1311:${date}:09:00`,store={attendanceScheduleMode:'weekly',attendanceSessions:[occ],attendanceBindings:{COMP1311:{verified:true,url:'https://forms.office.com/r/test'}},attendanceRecords:{}};
    const fake=fakeChrome(store),windowUpdates=[],tabUpdates=[],removed=[];
    chrome.tabs.query=async()=>[{id:88,windowId:9}];
    chrome.windows={get:async()=>({state:'minimized'}),update:async(id,changes)=>windowUpdates.push({id,...changes})};
    const update=chrome.tabs.update;chrome.tabs.update=async(id,changes)=>{tabUpdates.push({id,...changes});if(id!==88)return update(id,changes);};
    chrome.tabs.remove=async id=>removed.push(id);
    await import(`../src/background.js?foreground=${Math.random()}`);
    const send=(m,id)=>new Promise(resolve=>{if(!fake.listeners.message(m,{tab:{id}},resolve))resolve(null);});
    await fake.listeners.installed();assert.equal(fake.tabs[0].active,false);
    const result=await send({type:'NEED_FOREGROUND',key,state:'failed',submissionNotClicked:true,error:{code:'date_fill_hidden_tab',message:'后台日期填写失败',phase:'fill'}},1);
    assert.equal(result?.error,undefined);assert.equal(store.attendanceRecords[key].state,'scheduled');assert.deepEqual(removed,[1]);
    await fake.listeners.alarm({name:`attendance-retry:${key}`});
    assert.equal(fake.tabs[1].active,true);assert.equal(fake.tabs[1].windowId,9);
    assert.deepEqual(windowUpdates,[{id:9,state:'normal',focused:false}]);
    assert.deepEqual(store.attendanceRecords[key].foregroundRestore,{prevActiveTabId:88,windowId:9,windowState:'minimized'});
    assert.equal((await send({type:'RESERVE_SUBMISSION',key},2)).granted,true);
    assert.equal((await send({type:'RESERVE_SUBMISSION',key},2)).granted,false);
    await send({type:'REPORT_RUN',key,state:'success'},2);
    assert.equal(store.attendanceRecords[key].state,'success');
    assert.ok(tabUpdates.some(row=>row.id===88&&row.active===true));
    assert.deepEqual(windowUpdates.at(-1),{id:9,state:'minimized',focused:false});
    assert.equal(store.attendanceRecords[key].foregroundRestore,undefined);
  } finally {globalThis.Date=RealDate;}
});

test('disabled foreground fallback and 50 seconds remaining fail without retry',async()=>{
  const oldNow=Date.now,date=todayMalaysia();
  try {
    for(const enabled of [false,true]) {
      Date.now=()=>Date.parse(`${date}T09:${enabled?'59:10':'56:00'}+08:00`);
      const key='no-foreground',occ={key,course:'COMP1311',date,time:'09:00',endTime:'10:00'};
      const store={allowForegroundFallback:enabled,attendanceRecords:{[key]:{state:'launched',tabId:7,occ,phase:'filling'}}};
      const fake=fakeChrome(store);chrome.tabs.remove=async()=>{};
      await import(`../src/background.js?no-foreground=${Math.random()}`);
      const result=await new Promise(resolve=>{if(!fake.listeners.message({type:'NEED_FOREGROUND',key,state:'failed',submissionNotClicked:true,error:{code:'date_fill_hidden_tab',phase:'fill'}},{tab:{id:7}},resolve))resolve(null);});
      assert.equal(result?.error,undefined);assert.equal(store.attendanceRecords[key].state,'failed');
      assert.equal(store.attendanceRecords[key].error.code,'date_fill_hidden_tab');
      assert.equal(fake.alarms.has(`attendance-retry:${key}`),false);assert.equal(fake.tabs.length,0);
    }
  } finally {Date.now=oldNow;}
});

test('foreground restoration runs on failure, timeout and closed attempt; restore errors do not alter result',async()=>{
  for(const mode of ['failed','timeout','hard-cutoff','closed','restore-error']) {
    const key=`restore-${mode}`,occ={key,course:'COMP1311',date:todayMalaysia(),time:'09:00',endTime:'10:00'};
    const store={attendanceRecords:{[key]:{state:'launched',tabId:7,occ,phase:'filling',foregroundRetried:true,foregroundRestore:{prevActiveTabId:88,windowId:9,windowState:'minimized'}}}};
    const fake=fakeChrome(store),restored=[];
    chrome.tabs.update=async(id)=>{restored.push(`tab:${id}`);if(mode==='restore-error')throw Error('closed tab');};
    chrome.windows={update:async(id)=>restored.push(`window:${id}`)};
    await import(`../src/background.js?restore=${Math.random()}`);
    if(mode==='timeout') await fake.listeners.alarm({name:`attendance-watch:${key}`});
    else if(mode==='hard-cutoff') await fake.listeners.alarm({name:`attendance-end:${key}`});
    else if(mode==='closed') await fake.listeners.tabRemoved(7);
    else await new Promise(resolve=>fake.listeners.message({type:'REPORT_RUN',key,state:'failed',error:{code:'phase_failed'}},{tab:{id:7}},resolve));
    assert.equal(store.attendanceRecords[key].state,'failed');
    assert.deepEqual(restored,['tab:88','window:9']);
    assert.equal(store.attendanceRecords[key].foregroundRestore,undefined);
  }
});

test('terminal alerts persist badges and banners until ACK even when notifications throw',async()=>{
  const source=await readFile('src/options.js','utf8');
  const render=source.match(/async function renderAlert\(\) \{[\s\S]*?\n\}/)[0];
  for(const state of ['failed','submitted_pending_confirmation','missed_sleep','success','success_manual']) {
    const key=`alert-${state}`,occ={key,course:'COMP1311',date:todayMalaysia(),time:'09:00',endTime:'10:00'};
    const store={attendanceRecords:{[key]:{state:state==='success_manual'?'unknown':state==='submitted_pending_confirmation'||state==='success'?'pending':'launched',tabId:7,occ,phase:'filling',detail:'需要核对'}}};
    const fake=fakeChrome(store),alerting=['failed','submitted_pending_confirmation','missed_sleep'].includes(state);
    chrome.notifications.create=async()=>{
      if(alerting) assert.equal(fake.badge.text,'!','badge is set before notification');
      throw Error('Notification permission denied');
    };
    await import(`../src/background.js?alert=${state}-${Date.now()}`);
    const send=message=>new Promise(resolve=>fake.listeners.message(message,settingsSender(),resolve));
    const response=state==='success_manual'?await send({type:'MARK_SUBMITTED',key}):await new Promise(resolve=>fake.listeners.message({type:'REPORT_RUN',key,state,detail:'需要核对'},{tab:{id:7}},resolve));
    assert.deepEqual(response,{ok:true});
    const rows={'alert-banner':{hidden:true},'alert-detail':{}};
    const show=()=>runInNewContext(`${render}; renderAlert()`,{chrome,$2:id=>rows[id],t:key=>key});
    await show();
    assert.equal(rows['alert-banner'].hidden,!alerting);
    if(alerting) {
      assert.equal(fake.badge.text,'!');assert.equal(fake.badge.color,'#d93025');
      assert.equal(store.unresolvedAlert.key,key);assert.equal(store.unresolvedAlert.state,state);
      assert.equal(store.unresolvedAlert.detail,store.attendanceRecords[key].detail);
      assert.ok(store.unresolvedAlert.at);
      assert.match(rows['alert-detail'].textContent,/COMP1311/);
      assert.ok(rows['alert-detail'].textContent.includes(store.unresolvedAlert.detail));
      await show();assert.equal(rows['alert-banner'].hidden,false);
      assert.deepEqual(await send({type:'ACK_ALERT'}),{ok:true});
      assert.equal(store.unresolvedAlert,undefined);assert.equal(fake.badge.text,'');
      await show();assert.equal(rows['alert-banner'].hidden,true);
    } else {assert.equal(store.unresolvedAlert,undefined);assert.equal(fake.badge.text,undefined);}
  }
  assert.match(source,/sendMessage\(\{type: 'ACK_ALERT'\}\)/);
  assert.match(source,/changes\.unresolvedAlert.*renderAlert\(\)/);
});

test('HEALTH_CHECK reads only existing schedule and preflight data without mutations or tabs',async()=>{
  const store={attendanceSessions:[{weekStartDate:scheduleWeekStart(Date.parse(nextDay(todayMalaysia())+'T00:00:00+08:00')),id:'health',course:'COMP1311',kind:'dated',date:nextDay(todayMalaysia()),time:'09:00',endTime:'10:00'}],attendanceRecords:{older:{preflight:{at:'2026-01-01T00:00:00Z',checks:[{name:'已登录学校账号',ok:true}]}},latest:{preflight:{at:'2026-01-02T00:00:00Z',checks:[{name:'已登录学校账号',ok:false}]}}}};
  const original=structuredClone(store),fake=fakeChrome(store),reads=[];
  const get=chrome.storage.local.get;
  chrome.storage.local.get=async keys=>{reads.push(keys);return get(keys);};
  chrome.notifications.getPermissionLevel=async()=> 'denied';
  chrome.runtime.getManifest=()=>({version:'1.0.5'});
  await import(`../src/background.js?health=${Date.now()}`);
  const result=await new Promise(resolve=>fake.listeners.message({type:'HEALTH_CHECK'},settingsSender(),resolve));
  assert.equal(result.notifications,false);assert.equal(result.loggedIn,false);
  assert.equal(result.nextRun,Date.parse(`${store.attendanceSessions[0].date}T09:55:00+08:00`));
  assert.equal(result.version,'1.0.5');assert.deepEqual(store,original);
  assert.deepEqual(reads,[['attendanceSessions','attendanceRecords']]);assert.equal(fake.tabs.length,0);
});

test('HEALTH_CHECK reports an unknown login when no preflight exists',async()=>{
  const fake=fakeChrome({attendanceRecords:{}});
  chrome.notifications.getPermissionLevel=async()=> 'granted';
  chrome.runtime.getManifest=()=>({version:'1.0.5'});
  await import(`../src/background.js?health-empty=${Date.now()}`);
  const result=await new Promise(resolve=>fake.listeners.message({type:'HEALTH_CHECK'},settingsSender(),resolve));
  assert.deepEqual(result,{notifications:true,loggedIn:null,nextRun:null,version:'1.0.5'});
});

test('concurrent preflight result and formal scheduler preserve warning and close preflight before launching attendance',async()=>{
  const occ={id:'preflight-race',course:'COMP1311',type:'LEC',kind:'weekly',weekday:new Date(`${todayMalaysia()}T00:00:00Z`).getUTCDay(),date:todayMalaysia(),time:localTime(-56),endTime:localTime(4)};
  occ.key=`comp1311:${occ.date}:${occ.time}`;
  const binding={verified:true,url:'https://forms.office.com/r/test'};
  const store={attendanceScheduleMode:'weekly',attendanceSessions:[occ],attendanceBindings:{COMP1311:binding},attendanceRecords:{[occ.key]:{state:'scheduled',occ}},attendancePreflightRuns:{[occ.key]:{occ,tabId:77,binding,deadline:Date.now()+120000}}};
  const fake=fakeChrome(store),order=[];
  chrome.notifications.getPermissionLevel=async()=> 'granted';
  chrome.tabs.remove=async id=>{await new Promise(resolve=>setTimeout(resolve,10));order.push(`close:${id}`);};
  const create=chrome.tabs.create;chrome.tabs.create=async opts=>{order.push('launch');return create(opts);};
  await import(`../src/background.js?preflight-race=${Date.now()}`);
  const send=(m,sender)=>new Promise(resolve=>fake.listeners.message(m,sender,resolve));
  const results=await Promise.all([send({type:'REPORT_PREFLIGHT',key:occ.key,checks:[{name:'已登录学校账号',ok:false,hint:'需要重新登录学校 Microsoft 账号。'}]},{tab:{id:77}}),send({type:'REBUILD_SCHEDULE'},settingsSender())]);
  assert.equal(results.every(r=>r.ok),true);
  assert.equal(store.attendanceRecords[occ.key].state,'launched');
  assert.equal(store.attendanceRecords[occ.key].preflight.ok,false);
  assert.deepEqual(order,['close:77','launch']);
  assert.equal(fake.tabs[0].active,false);
});

test('pending confirmation notifies immediately; explicit manual actions retain the automatic submission lock',async()=>{
  const key='confirm-actions',occ={key,course:'COMP1311',date:todayMalaysia(),time:'09:00',endTime:'10:00'};
  const store={attendanceRecords:{[key]:{state:'pending',tabId:7,occ,formUrl:'https://forms.office.com/r/test',submissionAttemptedAt:'attempt',submissionKey:key}}};
  const fake=fakeChrome(store);await import(`../src/background.js?test=confirm-actions-${Date.now()}`);
  const send=(message,sender=settingsSender())=>new Promise(resolve=>{if(!fake.listeners.message(message,sender,resolve)) resolve(null);});
  await send({type:'REPORT_RUN',key,state:'submitted_pending_confirmation'},{tab:{id:7}});
  assert.equal(fake.notifications.at(-1).options.priority,2);
  assert.equal((await send({type:'OPEN_MANUAL_RESUBMIT',key},{tab:{id:8}})).error!==undefined,true);
  assert.deepEqual(await send({type:'OPEN_MANUAL_RESUBMIT',key}),{ok:true});
  assert.equal(fake.tabs[0].url,'https://forms.office.com/r/test');
  assert.equal(store.attendanceRecords[key].submissionAttemptedAt,'attempt');
  assert.equal(store.attendanceRecords[key].manualResubmitRequestedBy,'user');
  assert.deepEqual(await send({type:'MARK_SUBMITTED',key}),{ok:true});
  assert.equal(store.attendanceRecords[key].state,'success_manual');
  assert.equal(store.attendanceRecords[key].submissionAttemptedAt,'attempt');
});

test('success-page DOM recording is test-mode gated and redacted at the background boundary',async()=>{
  for(const enabled of [false,true]) {
    const key='debug',occ={key,course:'COMP1311',date:todayMalaysia(),time:'09:00',endTime:'10:00'};
    const store={attendanceProfile:{student:'12345678',name:'Jane Doe'},attendanceConfirmationTestMode:enabled,attendanceRecords:{[key]:{state:'pending',tabId:7,occ,submissionAttemptedAt:'attempt'}}};
    const fake=fakeChrome(store);await import(`../src/background.js?test=confirm-debug-${enabled}-${Date.now()}`);
    await new Promise(resolve=>fake.listeners.message({type:'REPORT_RUN',key,state:'success',diagnostic:{successPage:[{role:'heading',title:'Jane Doe 12345678',html:'private'}]}},{tab:{id:7}},resolve));
    const diagnostic=store.attendanceDiagnostics[0];
    assert.equal(Array.isArray(diagnostic.successPage),enabled);
    assert.doesNotMatch(JSON.stringify(diagnostic),/Jane Doe|12345678|private/);
  }
});

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
  const store={attendanceSessions:[{id:'today',course:'COMP1311',type:'LEC',kind:'dated',date:today,time,endTime,createdAt:new Date(Date.now()-180000).toISOString()},
    {id:'tomorrow',course:'COMP1311',type:'LEC',kind:'dated',date:tomorrow,time:'09:00',endTime:'10:00',createdAt:new Date(Date.now()-180000).toISOString()}],
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
  const store={attendanceScheduleMode:'weekly',attendanceSessions:[{id:'cloud',course:'COMP1311',type:'LEC',kind:'weekly',weekday:new Date(`${date}T00:00:00Z`).getUTCDay(),time:localTime(-56),endTime:localTime(4),createdAt:new Date(Date.now()-180000).toISOString()}],attendanceBindings:{COMP1311:{verified:true,url:'https://forms.office.com/Pages/ResponsePage.aspx?id=test'}},attendanceRecords:{}};
  const fake=fakeChrome(store),oldFetch=globalThis.fetch;
  chrome.runtime.id='abcdefghijklmnopabcdefghijklmnop';
  store.attendanceCloudToken='isolated-token';store.attendanceCloudDeviceId='isolated-device';store.attendanceNtfyTopic='soton-attendance-'+'a'.repeat(40);
  let requests=0;globalThis.fetch=(_url,options)=>{if(JSON.parse(options.body).action==='plugin-license-status') return Promise.resolve(Response.json({licensed:true,plan:'lifetime_license',expires_at:null}));requests++;return new Promise(()=>{});};
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
  const store={attendanceProfile:{student:'123',name:'A',studentType:'local'},attendanceBindings:{COMP1311:binding},attendanceDraft:{version:1,rows:[{course:'COMP1311',type:'LEC'}]}};
  const fake=fakeChrome(store);await import(`../src/background.js?test=stale-${Date.now()}`);
  const send=(type,extra={})=>new Promise(resolve=>{const s=store.attendanceSetupSession;fake.listeners.message({type,sessionId:s?.id,itemId:s?.items[s.current]?.id,...extra},type==='START_SETUP'?settingsSender():{tab:{id:1}},resolve);});
  await send('START_SETUP');await send('GET_SETUP_ITEM');await send('REPORT_SETUP_ITEM',{state:'awaiting_confirmation'});
  store.attendanceProfile.student='456';assert.match((await send('CONFIRM_SETUP_ITEM')).error,/配置已变化/);
  assert.equal(store.attendanceSetupSession.items[0].state,'failed');
  await send('START_SETUP');store.attendanceSetupSession.items[0].deadline=Date.now()-1;
  await fake.listeners.startup();assert.equal(store.attendanceSetupSession.items[0].state,'timed_out');
});

test('backup restore is serialized with terminal reports and keeps the newest result',async()=>{
  const date=todayMalaysia(),occ={id:'current',kind:'weekly',weekday:1,course:'COMP1311',type:'LEC',date,time:'09:00',endTime:'10:00',key:`comp1311:${date}:09:00`};
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
  const store={attendanceSessions:[{id:'a',course:'COMP1311',type:'LEC',kind:'dated',date,time,endTime,createdAt:new Date(Date.now()-180000).toISOString()}],
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
  const store={attendanceSessions:[{id:'idempotent',course:'COMP1311',type:'LEC',kind:'dated',date,time,endTime,createdAt:new Date(Date.now()-180000).toISOString()}],attendanceBindings:{COMP1311:{verified:true,url:'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=test'}},attendanceRecords:{}};
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
  const store={attendanceRecords:{[key]:{state:'pending',tabId:1,submissionAttemptedAt:new Date().toISOString(),occ:{key,course:'COMP1311',type:'LEC',date,time:'09:00',endTime:'10:00'}}}};
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

test('V1.0.5 login navigation rechecks the current tab after settling and notifies the user',async()=>{
  const date=todayMalaysia(),time=localTime(-56),endTime=localTime(4);
  const store={attendanceSessions:[{id:'login',course:'COMP1311',type:'LEC',kind:'dated',date,time,endTime,createdAt:new Date(Date.now()-180000).toISOString()}],attendanceBindings:{COMP1311:{verified:true,url:'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=test'}},attendanceRecords:{}};
  const fake=fakeChrome(store);await import(`../src/background.js?test=login-${Date.now()}`);await fake.listeners.installed();
  const key=Object.keys(store.attendanceRecords)[0];
  const loginUrl='https://login.microsoftonline.com/common/authorize';
  fake.tabs[0].url=loginUrl;
  const navigation=fake.listeners.tabUpdated(1,{url:loginUrl},{id:1});
  assert.equal(store.attendanceRecords[key].state,'launched');
  await navigation;
  assert.equal(store.attendanceRecords[key].state,'failed');assert.ok(fake.notifications.some(item=>item.options.title==='需要登录学校账号'));
});

test('manual confirmation changes only the user-selected record and release requires explicit confirmation',async()=>{
  const date=todayMalaysia(),time=localTime(-56),endTime=localTime(4);
  const store={attendanceSessions:[{id:'manual',course:'COMP1311',type:'LEC',kind:'dated',date,time,endTime,createdAt:new Date(Date.now()-180000).toISOString()}],attendanceBindings:{COMP1311:{verified:true,url:'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=test'}},attendanceRecords:{}};
  const fake=fakeChrome(store);await import(`../src/background.js?test=manual-${Date.now()}`);await fake.listeners.installed();
  const key=Object.keys(store.attendanceRecords)[0],settings=settingsSender();
  await new Promise(resolve=>fake.listeners.message({type:'RESERVE_SUBMISSION',key},{tab:{id:1}},resolve));await fake.listeners.alarm({name:`attendance-watch:${key}`});
  const marked=await new Promise(resolve=>fake.listeners.message({type:'MARK_SUBMITTED',key},settings,resolve));assert.deepEqual(marked,{ok:true});assert.equal(store.attendanceRecords[key].state,'success_manual');
  const nextKey=`${key}:second`;store.attendanceRecords[nextKey]={...store.attendanceRecords[key],state:'submitted_pending_confirmation',submissionKey:nextKey,submissionAttemptedAt:'2026-10-05T07:00:00.000Z',occ:{...store.attendanceRecords[key].occ,key:nextKey},tabId:1};
  const denied=await new Promise(resolve=>fake.listeners.message({type:'RELEASE_SUBMISSION',key:nextKey,confirm:false},settings,resolve));assert.match(denied.error,/明确确认/);assert.ok(store.attendanceRecords[nextKey].submissionAttemptedAt);
  const released=await new Promise(resolve=>fake.listeners.message({type:'RELEASE_SUBMISSION',key:nextKey,confirm:true},settings,resolve));assert.deepEqual(released,{ok:true});assert.equal(store.attendanceRecords[nextKey].submissionAttemptedAt,undefined);assert.equal(store.attendanceRecords[nextKey].state,'submitted_pending_confirmation');
});


test('bare module runtime uses session type; missing kind fails only that occurrence',async()=>{
  const date=todayMalaysia(),questions=[{title:'Module Delivery',type:'radio',options:['Lecture','Tutorial','Laboratory']}];
  const store={attendanceScheduleMode:'weekly',attendanceProfile:{student:'123',name:'Jane',studentType:'local'},attendanceSessions:[{id:'typed',course:'COMP1311',type:'LEC',kind:'dated',date,time:localTime(-56),endTime:localTime(4)}, {id:'unknown',course:'COMP1411',kind:'dated',date,time:localTime(-56),endTime:localTime(4)}],attendanceBindings:Object.fromEntries(['COMP1311','COMP1411'].map(course=>[course,{scope:'module',verified:true,url:'https://forms.office.com/Pages/ResponsePage.aspx?id=test',questions,mapping:[{...questions[0],field:'delivery'}]}])),attendanceRecords:{}};
  const fake=fakeChrome(store);
  await import(`../src/background.js?test=course-kind-${Date.now()}`);
  await fake.listeners.installed();
  const records=Object.values(store.attendanceRecords);
  assert.equal(records.find(r=>r.occ.course==='COMP1311').state,'launched');
  const failure=records.find(r=>r.occ.course==='COMP1411');
  assert.equal(failure.state,'failed');assert.match(failure.detail,/COMP1411.*缺少课型/);
  assert.equal(fake.tabs.length,1);
});

test('late wakes launch within grace only while the course has not ended',async()=>{
  const RealDate=Date;
  globalThis.Date=class extends RealDate {constructor(...args){super(...(args.length?args:['2026-10-14T02:03:00Z']));}static now(){return RealDate.parse('2026-10-14T02:03:00Z');}};
  try {
    for(const endTime of ['10:05','10:03','10:02']) {
      const store={attendanceScheduleMode:'weekly',attendanceSessions:[{id:'wake',kind:'dated',course:'COMP1311',type:'LEC',date:'2026-10-14',time:'09:00',endTime}],attendanceBindings:{COMP1311:{verified:true,url:'https://forms.office.com/Pages/ResponsePage.aspx?id=wake'}},attendanceRecords:{}};
      const fake=fakeChrome(store);
      await import(`../src/background.js?test=wake-${endTime}`);await fake.listeners.startup();
      assert.equal(fake.tabs.length,endTime==='10:05'?1:0);
      assert.equal(Object.values(store.attendanceRecords)[0].state,endTime==='10:05'?'launched':'missed');
      if(fake.tabs.length) assert.equal(fake.tabs[0].active,false);
    }
  } finally {globalThis.Date=RealDate;}
});

test('an aborted post-reservation deadline keeps the permanent marker and never regrants',async()=>{
  const date=todayMalaysia(),time=localTime(-56),endTime=localTime(4);
  const store={attendanceSessions:[{id:'aborted',course:'COMP1311',type:'LEC',kind:'dated',date,time,endTime,createdAt:new Date(Date.now()-180000).toISOString()}],attendanceBindings:{COMP1311:{verified:true,url:'https://forms.office.com/Pages/ResponsePage.aspx?id=aborted'}},attendanceRecords:{}};
  const fake=fakeChrome(store);await import(`../src/background.js?test=aborted-${Date.now()}`);await fake.listeners.installed();
  const key=Object.keys(store.attendanceRecords)[0];
  const send=message=>new Promise(resolve=>fake.listeners.message({key,...message},{tab:{id:1}},resolve));
  assert.deepEqual(await send({type:'RESERVE_SUBMISSION'}),{ok:true,granted:true});
  const marker=store.attendanceRecords[key].submissionAttemptedAt;
  await send({type:'REPORT_RUN',state:'missed',submissionNotClicked:true,detail:'课程已结束或剩余时间不足，未提交。'});
  assert.equal(store.attendanceRecords[key].state,'missed');
  assert.equal(store.attendanceRecords[key].submissionAttemptedAt,marker);
  assert.equal(fake.alarms.has(`attendance-watch:${key}`),false);
  assert.equal((await send({type:'RESERVE_SUBMISSION'})).reason,'already_attempted');
});

test('SSO hash loss recovers only the launched task belonging to the Forms tab',async()=>{
  const date=todayMalaysia(),key='sso-hash';
  const store={attendanceRecords:{[key]:{state:'launched',tabId:7,occ:{date,course:'COMP1311'}}}};
  const fake=fakeChrome(store);await import(`../src/background.js?test=sso-hash-${Date.now()}`);
  const send=sender=>new Promise(resolve=>fake.listeners.message({type:'GET_ACTIVE_RUN'},sender,resolve));
  const sender={tab:{id:7},url:'https://forms.office.com/Pages/ResponsePage.aspx?id=sso'};
  assert.deepEqual(await send(sender),{key,state:'launched'});
  assert.equal(await send({...sender,tab:{id:8}}),null);
  assert.equal(await send({...sender,url:'https://login.microsoftonline.com'}),null);
  store.attendanceRecords[key].state='missed';
  assert.equal(await send(sender),null);
});

test('each structured failure persists one redacted diagnostic and an actionable notification',async()=>{
  const course='COMP1311',profile={student:'ABC123456',name:'Jane Doe'};
  const records=Object.fromEntries(ERROR_CODES.map(code=>[code,{state:'launched',at:new Date().toISOString(),occ:{key:code,course,type:'LEC',date:todayMalaysia(),time:'09:00',endTime:'10:00'},tabId:1,phase:'filling',phaseStartedAt:new Date(Date.now()-20).toISOString(),phaseDurations:{checking:10}}]));
  const store={attendanceProfile:profile,attendanceRecords:records,attendanceSessions:[]};
  const fake=fakeChrome(store);
  await import(`../src/background.js?test=diagnostics-${Date.now()}`);
  const send=message=>new Promise(resolve=>fake.listeners.message(message,{tab:{id:1}},resolve));
  for(const code of ERROR_CODES) {
    const error=runError({code,message:`${code} ABC123456 Jane Doe https://forms.office.com/r/private`},{course,phase:'fill'});
    const response=await send({type:'REPORT_RUN',key:code,state:'failed',error,detail:error.message,diagnostic:{questionTitles:[{before:'1. ABC123456 Jane Doe *',after:'ABC123456 Jane Doe'}]}});
    assert.equal(response.error,undefined);
    assert.equal(store.attendanceRecords[code].error.code,code);
    assert.match(store.attendanceRecords[code].detail,/COMP1311.*填写/);
    assert.match(store.attendanceRecords[code].detail,/下一步：/);
    assert.match(fake.notifications.at(-1).options.message,/COMP1311.*填写/);
    assert.match(fake.notifications.at(-1).options.message,/下一步：/);
  }
  assert.equal(store.attendanceDiagnostics.length,ERROR_CODES.length);
  for(const diagnostic of store.attendanceDiagnostics) {
    assert.equal(diagnostic.courseKind.resolved,'lecture');
    assert.equal(diagnostic.phaseDurations.validate,10);
    assert.ok(diagnostic.phaseDurations.fill>=0);
    assert.equal(diagnostic.questionTitles.length,1);
  }
  assert.doesNotMatch(JSON.stringify(store.attendanceDiagnostics),/ABC123456|Jane Doe|https:\/\/|forms.office.com|private/);
});

test('failed dry-run diagnostics remain local, enforce form ownership and replace the same attempt',async()=>{
  const url='https://forms.office.com/r/check';
  const store={attendanceProfile:{student:'ABC123456',name:'Jane Doe'},attendanceBindings:{COMP1311:{url,verified:true}}};
  const fake=fakeChrome(store);
  await import(`../src/background.js?test=dry-diagnostic-${Date.now()}`);
  const message={type:'REPORT_ATTEMPT',attemptId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',course:'COMP1311',diagnostic:{state:'failed',course:'FAKE',error:runError({code:'course_kind_unknown'},{course:'FAKE',phase:'validate'}),phaseDurations:{validate:11},questionTitles:[{before:'1. Title *',after:'Title'}]}};
  const send=(sender= {url,tab:{id:2,url}})=>new Promise(resolve=>fake.listeners.message(message,sender,resolve));
  assert.equal((await send()).error,undefined);
  assert.equal((await send()).error,undefined);
  assert.equal(store.attendanceDiagnostics.length,1);
  assert.equal(store.attendanceDiagnostics[0].error.course,'COMP1311');
  assert.equal(store.attendanceRecords,undefined);
  assert.equal(store.attendanceCloudOutbox,undefined);
  assert.ok((await send({url:'https://forms.office.com/r/other',tab:{id:2}})).error);
  assert.equal(store.attendanceDiagnostics.length,1);
});


test('feature policy gates fill, resumed runs and submission; phone access stays independent',async()=>{
  const date=todayMalaysia(),session={id:'licensed',course:'COMP1311',type:'LEC',kind:'dated',date,time:localTime(-56),endTime:localTime(4)};
  const binding={verified:true,url:'https://forms.office.com/r/policy'};
  const key='policy',record={state:'launched',tabId:7,occ:{...session,key},configuration:undefined};
  const store={attendanceScheduleMode:'weekly',attendanceSessions:[session],attendanceBindings:{COMP1311:binding},attendanceRecords:{[key]:record},attendancePluginLicense:{plan:'lifetime_license'}};
  const fake=fakeChrome(store),oldFetch=globalThis.fetch,calls=[];
  let licensed=false,offline=false;
  globalThis.fetch=async(_url,options)=>{
    const {action}=JSON.parse(options.body);calls.push(action);
    if(action==='plugin-license-status') {if(offline) throw Error('network unavailable');return Response.json({licensed,plan:'lifetime_license',expires_at:null});}
    return Response.json({entitlement:{status:'active',phoneNotifications:true},checkoutUrl:'https://checkout.example.test'});
  };
  try {
    await import('../src/background.js?feature-policy='+Math.random());
    const sender={tab:{id:7},url:binding.url};
    const send=(message,from=sender)=>new Promise(resolve=>{if(!fake.listeners.message(message,from,resolve)) resolve(null);});
    for(const type of ['AUTHORIZE_AUTOMATION','GET_RUN','GET_SETUP_ITEM','GET_PREFLIGHT','RESERVE_SUBMISSION']) {
      const result=await send({type,key});assert.equal(result?.error,'plugin_license_required',type);
    }
    assert.equal(store.attendanceRecords[key].submissionAttemptedAt,undefined);
    assert.equal((await send({type:'CLOUD_REQUEST',action:'entitlement'},settingsSender())).entitlement.phoneNotifications,true);
    assert.ok((await send({type:'CLOUD_REQUEST',action:'checkout'},settingsSender())).checkoutUrl);
    licensed=true;
    assert.deepEqual(await send({type:'AUTHORIZE_AUTOMATION'}),{ok:true});
    const cached=structuredClone(store.attendancePluginLicense);
    offline=true;
    assert.equal((await send({type:'AUTHORIZE_AUTOMATION'})).error,'plugin_license_unavailable');
    assert.deepEqual(store.attendancePluginLicense,cached);
    assert.equal((await send({type:'RESERVE_SUBMISSION',key})).error,'plugin_license_unavailable');
    assert.equal(store.attendanceRecords[key].submissionAttemptedAt,undefined);
    offline=false;licensed=false;
    assert.equal((await send({type:'AUTHORIZE_AUTOMATION'})).error,'plugin_license_required');
    assert.equal(store.attendancePluginLicense,undefined);
    assert.equal((await send({type:'CLOUD_REQUEST',action:'entitlement'},settingsSender())).entitlement.phoneNotifications,true);
  } finally {globalThis.fetch=oldFetch;}
});

test('unlicensed scheduled startup preserves schedules and sync without launching automation',async()=>{
  const date=todayMalaysia(),session={id:'unlicensed',course:'COMP1311',type:'LEC',kind:'weekly',weekday:new Date(date+'T00:00:00Z').getUTCDay(),time:localTime(-56),endTime:localTime(4),createdAt:new Date(Date.now()-180000).toISOString()};
  const store={attendanceScheduleMode:'weekly',attendanceSessions:[session],attendanceBindings:{COMP1311:{verified:true,url:'https://forms.office.com/r/policy'}},attendanceRecords:{}};
  const fake=fakeChrome(store),oldFetch=globalThis.fetch;let checks=0;
  globalThis.fetch=async(_url,options)=>{if(JSON.parse(options.body).action==='plugin-license-status') checks++;return Response.json({licensed:false});};
  try {
    await import('../src/background.js?unlicensed-startup='+Math.random());
    await fake.listeners.startup();
    assert.equal(fake.tabs.length,0);
    assert.equal(store.attendanceSessions.length,1);
    assert.equal(Object.values(store.attendanceRecords)[0]?.state,'scheduled');
    assert.equal(checks,1);
    assert.ok(fake.alarms.has('attendance-maintenance'));
  } finally {globalThis.fetch=oldFetch;}
});
