import {moduleKey} from './bindings.js';

const API_URL='https://qckpwckfukyurkobrsig.supabase.co/functions/v1/device-api';

async function call(action,body={},token='') {
  const headers={'Content-Type':'application/json'};
  if(token) headers.Authorization=`Bearer ${token}`;
  const response=await fetch(API_URL,{method:'POST',headers,body:JSON.stringify({action,...body})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw Error(data.error||`云端请求失败（${response.status}）`);
  return data;
}

export async function ensureCloudDevice() {
  const data=await chrome.storage.local.get(['attendanceCloudToken','attendanceCloudDeviceId','attendanceCloudDeviceKey','attendanceNtfyTopic']);
  if(data.attendanceCloudToken&&data.attendanceCloudDeviceId) {
    if(data.attendanceNtfyTopic) return data;
    const topic=await call('ntfy-topic',{},data.attendanceCloudToken);
    const next={attendanceNtfyTopic:topic.ntfyTopic};
    await chrome.storage.local.set(next);
    return {...data,...next};
  }
  const deviceKey=data.attendanceCloudDeviceKey||`chrome-${crypto.randomUUID()}`;
  const result=await call('register',{deviceKey,deviceName:'Soton Auto-Check · Chrome'});
  const next={attendanceCloudDeviceKey:deviceKey,attendanceCloudDeviceId:result.deviceId,attendanceCloudToken:result.deviceToken,attendanceNtfyTopic:result.ntfyTopic};
  await chrome.storage.local.set(next);
  return {...data,...next};
}

export async function syncCloud({sessions=[],bindings={},preferences={}}={}) {
  const cloud=await ensureCloudDevice();
  const schedules=[];
  for(const session of sessions) {
    const binding=bindings[moduleKey(session.course)]||bindings[session.course];
    if(!binding?.verified||!binding.url) continue;
    schedules.push({courseCode:session.course,courseName:session.course,weekday:Number(session.weekday),startTime:session.time,endTime:session.endTime,formUrl:binding.url,enabled:true,timezone:'Asia/Kuala_Lumpur'});
  }
  return call('sync',{schedules,preferences:{timezone:'Asia/Kuala_Lumpur',reminderTime:'19:30',remindersEnabled:preferences.remindersEnabled!==false,successNotificationsEnabled:true}},cloud.attendanceCloudToken);
}

export async function reportCloud({record,status,detail}={}) {
  if(!record?.occ) return;
  try {
    const cloud=await ensureCloudDevice();
    const occ=record.occ;
    await call('event',{status,courseCode:occ.course,classDate:occ.date,startTime:occ.time,endTime:occ.endTime,formUrl:record.formUrl||undefined,occurrenceKey:occ.key,detail},cloud.attendanceCloudToken);
  } catch(error) {
    console.warn('云端日志上报失败',error);
  }
}

export async function cloudStatus() {
  return chrome.storage.local.get(['attendanceCloudDeviceId','attendanceNtfyTopic']);
}
