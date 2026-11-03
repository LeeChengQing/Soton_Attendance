import {prepareFill} from './fill-only.js';
import {FORMS_LOAD_MS} from './runtime-timing.js';
import {createDiagnostic} from './diagnostics.js';

export function schoolLoginAvailable(root=document) {
  const identity=[...root.querySelectorAll('[data-automation-id="userInfo"],[data-automation-id="userName"],[data-automation-id="userEmail"],[data-automation-id="accountInfo"],#O365_MainLink_Me')].map(el=>`${el.textContent} ${el.getAttribute('aria-label')||''} ${el.getAttribute('title')||''}`).join(' ');
  if(/[\w.+-]+@(?:[\w-]+\.)?(?:soton\.ac\.uk|southampton\.ac\.uk)/i.test(identity)) return true;
  // Current Forms omits the email but exposes its signed-in notice and tenant privacy link.
  const notice=root.querySelector('[data-automation-id="noticeContainer"]')?.textContent||'';
  const signedIn=/(?:Hi,|你好|您好).+(?:owner will see your name and email address|所有者.*姓名.*电子邮件)/i.test(notice);
  const schoolTenant=[...root.querySelectorAll('a[href]')].some(a=>{
    try {return /^(?:www\.)?(?:southampton\.ac\.uk|soton\.ac\.uk)$/.test(new URL(a.href).hostname);}
    catch {return false;}
  });
  return signedIn && schoolTenant;
}

// This entry has only read/fill/verify capabilities. It never receives a submit callback.
export async function runPreflightPage(key) {
  const startedAt=Date.now(),dateDiagStart=window.__dateDiag?.length||0;
  let profile;
  const names=['已登录学校账号','课型可解析','表单链接与绑定一致','标题与题目没变','日期格式可填','填写后核对通过'];
  const checks=names.map(name=>({name,ok:false,hint:'前置检查未通过，尚未检查。'}));
  const check=(name,ok,hint)=>Object.assign(checks.find(c=>c.name===name),{ok,hint});
  try {
    const data=await chrome.runtime.sendMessage({type:'GET_PREFLIGHT',key});
    profile=data?.profile;
    if(data?.error) throw Error(data.error);
    const deadline=Date.now()+FORMS_LOAD_MS;
    while(!document.querySelector('[data-automation-id="questionItem"]') && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,500));
    // A public form does not prove school authentication. Require visible school identity.
    const authenticated=schoolLoginAvailable();
    check(names[0],authenticated,authenticated?'':'需要重新登录学校 Microsoft 账号；登录后确认表单显示学校账号身份。');
    if(!authenticated) throw Error(checks[0].hint);
    await prepareFill(data.binding,data.occ,data.profile,{onCheck:check});
  } catch(error) {
    if(checks.every(c=>c.hint==='前置检查未通过，尚未检查。')) check(names[0],false,error.message);
  }
  await chrome.runtime.sendMessage({type:'REPORT_PREFLIGHT',key,ok:checks.every(c=>c.ok),checks,elapsedMs:Math.max(0,Date.now()-startedAt),diagnostic:createDiagnostic({dateDiag:(window.__dateDiag||[]).slice(dateDiagStart)},profile)});
}
