import test from 'node:test';
import assert from 'node:assert/strict';
import {todayMalaysia} from '../src/schedule.js';

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
    tabs:{create:async options=>{const tab={id:tabs.length+1,...options};tabs.push(tab);return tab;},update:async(id,options)=>Object.assign(tabs.find(t=>t.id===id),options)}
  };
  return {listeners,notifications,tabs,alarms};
}

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
