import {PHASE_TIMEOUTS,WAKE_GRACE_MS} from './runtime-timing.js';
export {PHASE_TIMEOUTS};
export const PHASE_ERRORS=Object.freeze({opening:'页面未在 90 秒内加载。',reading:'内容脚本未响应或表单未在 90 秒内就绪。',checking:'表单核对阶段超时。',filling:'表单填写阶段超时。',submitting:'找不到提交按钮或提交阶段超时。',confirming:'已点击提交，但未收到明确成功反馈。'});

export function phaseTimeout(phase) {return PHASE_TIMEOUTS[phase]??null;}
export function classifyWake(due,now,graceMs=WAKE_GRACE_MS) {return now-due>graceMs?'missed_sleep':'launch';}
export function isSchoolLoginOrPermissionUrl(value) {
  try {
    const url=new URL(String(value));
    const host=url.hostname.toLowerCase(),path=`${url.pathname}${url.search}`.toLowerCase();
    return ['login.microsoftonline.com','login.live.com','account.live.com'].includes(host)||/access_denied|unauthori[sz]ed|sign[-_]?in|login/.test(path);
  } catch {return false;}
}
export function redactDiagnostic(value) {return String(value||'').replace(/https?:\/\/\S+/gi,'[url]').replace(/\b\d{6,}\b/g,'[redacted]').slice(0,500);}
