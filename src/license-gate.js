import {getPluginLicenseStatus} from './cloud.js';
import {licenseRevision} from './plugin-license.js';
const GRACE=72*3600000;
const versionParts=value=>String(value).split('.').map(n=>Number.parseInt(n,10)||0);
function older(version,minimum) {
  const a=versionParts(version),b=versionParts(minimum);
  for(let i=0;i<Math.max(a.length,b.length);i++) if((a[i]||0)!==(b[i]||0)) return (a[i]||0)<(b[i]||0);
  return false;
}
const hardReason=result=>String(result?.reason||result?.error||result?.status||'').toLowerCase();
export function resolveGate(cache,result,now=Date.now(),version='0.0.0') {
  const prior=Boolean(cache?.activatedAt||cache?.plan||cache?.checkedAt);
  const incoming=result?.config||result||{};
  const incomingDefinitive=result?.licensed===true||incoming.kill_switch===true||incoming.maintenance===true||typeof incoming.min_version==='string'&&older(version,incoming.min_version)||['license_expired','expired','license_revoked','revoked','refunded','license_refunded'].includes(hardReason(result));
  const effective=cache?.definitive&&!incomingDefinitive?cache.definitive:result||cache?.definitive||{};
  const config=effective.config||effective;
  const reason=hardReason(effective);
  const expiresAt=effective.expires_at??cache?.expiresAt??null;
  let state;
  if(config.kill_switch===true||config.maintenance===true) state='LOCKED_MAINT';
  else if(typeof config.min_version==='string'&&older(version,config.min_version)) state='LOCKED_UPDATE';
  else if(prior&&['license_revoked','revoked','refunded','license_refunded'].includes(reason)) state='LOCKED_REVOKED';
  else if(effective.licensed===true) state=expiresAt&&Date.parse(expiresAt)<=now?'GRACE_WARN':'UNLOCKED';
  else if(prior&&['license_expired','expired'].includes(reason)&&Number.isFinite(Date.parse(expiresAt))&&now>Date.parse(expiresAt)+GRACE) state='LOCKED_EXPIRED';
  else if(prior) state=result||expiresAt&&Date.parse(expiresAt)<=now?'GRACE_WARN':'UNLOCKED';
  else state='LOCKED_NEW';
  return {state,allowed:state==='UNLOCKED'||state==='GRACE_WARN',expiresAt,plan:effective.plan||cache?.plan||'',announcement:typeof config.announcement==='string'?config.announcement.slice(0,2000):'',links:config.links||cache?.config?.links||{}};
}
let refreshing;
export async function getActivationGate({refresh=false}={}) {
  if(typeof __ATTENDANCE_DEV__!=='undefined'&&__ATTENDANCE_DEV__) return {state:'UNLOCKED',allowed:true,development:true,links:{}};
  if(refresh&&refreshing) return refreshing;
  const read=async()=>{
    const stored=await chrome.storage.local.get(['attendancePluginLicense','attendanceCloudDeviceId','attendanceGateDeviceId','unresolvedAlert']);
    let cache=stored.attendancePluginLicense,result;
    if(refresh) {
      const revision=licenseRevision;
      try {result=await getPluginLicenseStatus();}
      catch(error) {result={error:['license_revoked','license_expired','license_refunded'].includes(error.code)?error.code:'unavailable'};}
      if(revision!==licenseRevision||result?.stale) result=null;
      cache=(await chrome.storage.local.get('attendancePluginLicense')).attendancePluginLicense||cache;
      const reason=hardReason(result);
      const config=result?.config||result;
      if(cache&&(config?.kill_switch===true||config?.maintenance===true||typeof config?.min_version==='string'&&older(chrome.runtime.getManifest?.().version||'1.1.0',config.min_version)||['license_expired','license_revoked','license_refunded','expired','revoked','refunded'].includes(reason))) {
        cache={...cache,definitive:result,config:config.links?{links:config.links}:cache.config};
        await chrome.storage.local.set({attendancePluginLicense:cache});
      } else if(cache?.definitive&&result?.licensed===true) {
        cache={...cache,definitive:null};await chrome.storage.local.set({attendancePluginLicense:cache});
      }
      if(cache&&config?.links) {cache={...cache,config:{links:config.links}};await chrome.storage.local.set({attendancePluginLicense:cache});}
      if(cache?.definitive&&(hardReason(result)==='unavailable'||result?.licensed===false&&!hardReason(result))) result=null;
    }
    let deviceId=stored.attendanceCloudDeviceId||stored.attendanceGateDeviceId;
    if(!deviceId) {deviceId=crypto.randomUUID();await chrome.storage.local.set({attendanceGateDeviceId:deviceId});}
    const state=resolveGate(cache,result,Date.now(),chrome.runtime.getManifest?.().version||'1.1.0');
    const {unresolvedAlert}=await chrome.storage.local.get('unresolvedAlert');
    await chrome.action?.setBadgeText?.({text:state.allowed&&!unresolvedAlert?'':'!'});
    if(!state.allowed) await chrome.action?.setBadgeBackgroundColor?.({color:'#ad4037'});
    return {...state,deviceId};
  };
  if(!refresh) return read();
  refreshing=read().finally(()=>{refreshing=null;});return refreshing;
}
