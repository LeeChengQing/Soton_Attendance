import {normalizeGateKey} from './license-key.js';
export let licenseRevision=0;

// Both recovered and current cloud clients use the same license persistence policy.
export function pluginLicenseClient({call,ensureCloudDevice,timeoutMs=15000}) {
  return {
    async activatePluginLicense(value) {
      let licenseKey=normalizeGateKey(value);value='';
      const controller=new AbortController();let timer;
      try {
        const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort(Error('license_timeout'));reject(controller.signal.reason);},timeoutMs);});
        return await Promise.race([deadline,(async()=>{
        const cloud=await ensureCloudDevice({allowRegistration:true,signal:controller.signal});
        if(controller.signal.aborted) throw controller.signal.reason;
        const result=await call('activate-plugin-license',{licenseKey},cloud.attendanceCloudToken,timeoutMs,controller.signal);
        if(controller.signal.aborted) throw controller.signal.reason;
        if(result?.ok!==true) throw Error('activation_response_invalid');
        licenseRevision++;
        await chrome.storage.local.set({attendancePluginLicense:{plan:result.plan,expiresAt:result.expires_at,activatedAt:Date.now(),checkedAt:Date.now()}});
        return result;
        })()]);
      } finally {clearTimeout(timer);licenseKey='';}
    },
    async getPluginLicenseStatus() {
      const identity=await chrome.storage.local.get(['attendanceCloudToken','attendanceCloudDeviceId']);
      if(!identity.attendanceCloudToken&&!identity.attendanceCloudDeviceId) return {licensed:false};
      const revision=licenseRevision,cloud=await ensureCloudDevice();
      const result=await call('plugin-license-status',{},cloud.attendanceCloudToken);
      if(revision!==licenseRevision) return {stale:true};
      if(typeof result?.licensed!=='boolean'&&!result?.kill_switch&&!result?.min_version) throw Error('license_response_invalid');
      if(result.licensed===true) {
        const {attendancePluginLicense:prior={}}=await chrome.storage.local.get('attendancePluginLicense');
        await chrome.storage.local.set({attendancePluginLicense:{...prior,plan:result.plan,expiresAt:result.expires_at,activatedAt:prior.activatedAt||Date.now(),checkedAt:Date.now(),definitive:null}});
      }
      // Never erase evidence of prior activation on negative or uncertain replies.
      return result;
    }
  };
}
