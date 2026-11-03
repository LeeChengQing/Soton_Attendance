import {activatePluginLicense} from './cloud-client.js';
import {normalizeGateKey,formatGateKey} from './license-key.js';
import {t,currentLanguage,setLanguage} from './options-locale.js';
import {subscriptionCheckoutUrl} from './subscription-link.js';
import {resolveGate} from './license-gate.js';

export async function initActivationGate() {
  const $=id=>document.getElementById(id),root=$('activation-gate'),card=$('gate-card'),app=document.querySelector('.app-layout');
  const input=$('gate-key'),form=$('gate-form'),submit=$('gate-submit'),error=$('gate-error');
  let status,busy=false,until=0,timer,refreshTimer,disposed=false,success=false,refreshing=false;
  const preferences=await chrome.storage.local.get(['attendanceLanguage','attendanceReduceTransparency']);
  await setLanguage(preferences.attendanceLanguage||'zh',false);
  $('gate-reduce').checked=$('license-reduce').checked=preferences.attendanceReduceTransparency===true;
  function transparency(){root.classList.toggle('gate-opaque',$('gate-reduce').checked);}
  transparency();
  for(const control of [$('gate-reduce'),$('license-reduce')]) control.addEventListener('change',()=>{$('gate-reduce').checked=$('license-reduce').checked=control.checked;transparency();void chrome.storage.local.set({attendanceReduceTransparency:control.checked});});
  const safeLink=value=>{try {const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';} catch {return '';}};
  function links(){
    const purchase=new URL('/',subscriptionCheckoutUrl()).href;
    const fallback={buy:purchase,renew:purchase};
    for(const link of document.querySelectorAll('[data-gate-link]')) {
      const href=safeLink(status?.links?.[link.dataset.gateLink])||safeLink(fallback[link.dataset.gateLink]);
      if(href){link.href=href;link.removeAttribute('aria-disabled');}
      else {link.removeAttribute('href');link.setAttribute('aria-disabled','true');}
    }
  }
  document.addEventListener('click',event=>{
    if(event.target.closest('[data-gate-link][aria-disabled="true"]')) {event.preventDefault();error.textContent=t('gate.unavailableLink');error.hidden=false;}
  });
  function device(){
    const id=status?.deviceId||'';
    for(const element of document.querySelectorAll('[data-gate-device]')) element.textContent=id?`${id.slice(0,8)}…${id.slice(-4)}`:'—';
  }
  for(const button of document.querySelectorAll('[data-gate-copy]')) button.addEventListener('click',async()=>{
    try {await navigator.clipboard.writeText(status?.deviceId||'');button.textContent=t('gate.copied');setTimeout(()=>button.textContent=t('gate.copy'),1500);}
    catch {error.textContent=t('gate.copyFailed');error.hidden=false;}
  });
  function countdown(){
    clearTimeout(timer);const n=Math.max(0,Math.ceil((until-Date.now())/1000));
    submit.disabled=busy||success||n>0;
    submit.textContent=success?t('gate.success'):busy?t('gate.activating'):n?t('gate.err.rateLimited',{n}):t('gate.activate');
    if(n) timer=setTimeout(countdown,250);
    else if(until){until=0;$('gate-live').textContent=t('gate.retry');}
  }
  function render(){
    if(!status||disposed)return;
    const locked=!status.allowed,expired=['LOCKED_EXPIRED','LOCKED_REVOKED'].includes(status.state),special=['LOCKED_UPDATE','LOCKED_MAINT'].includes(status.state);
    root.hidden=!locked;app.inert=locked;app.setAttribute('aria-hidden',String(locked));
    document.body.classList.remove('gate-pending');document.body.classList.toggle('gate-locked',locked);
    $('gate-grace').hidden=status.state!=='GRACE_WARN';
    $('gate-title').textContent=t(expired?'gate.expired.title':status.state==='LOCKED_UPDATE'?'gate.err.update':status.state==='LOCKED_MAINT'?'gate.maintenance':'gate.title');
    $('gate-description').textContent=status.state==='LOCKED_REVOKED'?t('gate.expired.bodyRevoked'):status.state==='LOCKED_EXPIRED'?t('gate.expired.bodyExpired',{date:formatDate(status.expiresAt)}):status.state==='LOCKED_MAINT'?status.announcement||t('gate.maintenance'):status.state==='LOCKED_UPDATE'?t('gate.err.update'):t('gate.subtitle');
    $('gate-reassure').hidden=!expired;$('gate-expired-actions').hidden=!expired;
    $('gate-download').hidden=status.state!=='LOCKED_UPDATE';
    form.hidden=expired||special;$('gate-purchase-links').hidden=expired||special;
    $('plugin-license-badge').textContent=t(status.allowed?'gate.active':'gate.locked');
    $('plugin-license-message').textContent=status.state==='GRACE_WARN'?t('gate.grace.warn'):status.expiresAt?t('gate.expires',{date:formatDate(status.expiresAt)}):status.allowed?t('gate.lifetime'):t('gate.locked');
    links();device();countdown();
    if(locked) requestAnimationFrame(()=>{if(!card.contains(document.activeElement)) focusFirst();});
    if(typeof __ATTENDANCE_DEV__!=='undefined'&&__ATTENDANCE_DEV__) {
      if(status.development){$('plugin-license-badge').textContent='仅开发 · 开发调试 · 免激活';$('plugin-license-badge').classList.add('gate-dev');$('plugin-license-message').textContent='仅开发：已跳过插件授权校验';}
    }
  }
  function controls(){return [...card.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled)')].filter(element=>element.getClientRects().length&&!element.closest('[hidden]'));}
  function focusFirst(){(controls()[0]||card).focus();}
  function formatDate(value){const date=new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat(currentLanguage()==='zh'?'zh-CN':'en',{dateStyle:'medium',timeZone:'Asia/Kuala_Lumpur'}).format(date):'—';}
  async function read(refresh=false){
    let next;
    try {next=await chrome.runtime.sendMessage({type:'GET_LICENSE_GATE',refresh});}catch { /* Read the same resolver's cached decision below. */ }
    if(!next?.state||typeof next.allowed!=='boolean') {
      const cached=await chrome.storage.local.get(['attendancePluginLicense','attendanceCloudDeviceId','attendanceGateDeviceId']);
      next={...resolveGate(cached.attendancePluginLicense,{error:'unavailable'},Date.now(),chrome.runtime.getManifest?.().version||'1.1.0'),deviceId:cached.attendanceCloudDeviceId||cached.attendanceGateDeviceId};
    }
    status=next;if(!busy&&!success) render();return next;
  }
  $('gate-new-key').addEventListener('click',()=>{form.hidden=false;input.focus();});
  root.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();}
    if(event.key!=='Tab')return;
    const visible=controls(),first=visible[0],last=visible.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  });
  document.addEventListener('focusin',event=>{if(!root.hidden&&!card.contains(event.target)) focusFirst();});
  input.addEventListener('input',()=>{
    const old=input.value,position=input.selectionStart,formatted=formatGateKey(old);
    input.value=formatted;
    if(position!=null&&position<old.length){const count=old.slice(0,position).replace(/[^A-Za-z0-9]/g,'').length;let seen=0,index=0;while(index<formatted.length&&seen<count){if(/[A-Za-z0-9]/.test(formatted[index]))seen++;index++;}input.setSelectionRange(index,index);}
    input.removeAttribute('aria-invalid');error.hidden=true;
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||success||Date.now()<until)return;
    let key;
    try {key=normalizeGateKey(input.value);}catch {error.textContent=t('gate.err.format');error.hidden=false;input.setAttribute('aria-invalid','true');input.focus();return;}
    busy=true;input.disabled=true;error.hidden=true;form.setAttribute('aria-busy','true');$('gate-live').textContent=t('gate.activating');countdown();
    try {
      const activated=await activatePluginLicense(key);key='';input.value='';success=true;
      $('gate-success').hidden=false;$('gate-live').textContent=t('gate.success');countdown();
      await new Promise(resolve=>setTimeout(resolve,1000));
      // Activation itself is definitive; do not replace its success with another network request.
      if(activated.gate)status=activated.gate;else await read(false);
      root.classList.add('gate-leaving');await new Promise(resolve=>setTimeout(resolve,150));render();
      root.classList.remove('gate-leaving');success=false;$('gate-success').hidden=true;
      void chrome.runtime.sendMessage({type:'REBUILD_SCHEDULE'}).catch(()=>{});
    }catch(problem){
      const code=String(problem.code||'').toLowerCase();
      const rate=problem.httpStatus===429||['rate_limited','too_many_requests'].includes(code);
      const invalid=['invalid_key','invalid_license_key','license_expired','license_revoked','maximum_devices_reached','license_refunded'].includes(code);
      if(invalid||rate) input.value='';
      if(rate){until=Date.now()+Math.max(1,Number(problem.retryAfterSeconds)||60)*1000;}
      error.textContent=t(rate?'gate.err.rateLimited':invalid?'gate.err.invalid':problem.httpStatus>=500?'gate.err.server':'gate.err.network',{n:Math.ceil((until-Date.now())/1000)});
      error.hidden=false;input.setAttribute('aria-invalid',String(invalid));$('gate-live').textContent=rate?error.textContent:'';
    }finally {
      key='';busy=false;input.disabled=false;form.removeAttribute('aria-busy');countdown();if(!success)input.focus();
    }
  });
  async function refresh(){if(refreshing||busy||success||disposed)return;refreshing=true;try {await read(true);}catch {/* Keep the last authoritative decision. */}finally {refreshing=false;}}
  $('check-license-btn').addEventListener('click',()=>void refresh());
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=='local')return;
    if(changes.attendanceReduceTransparency){$('gate-reduce').checked=$('license-reduce').checked=changes.attendanceReduceTransparency.newValue===true;transparency();}
    if(changes.attendanceLanguage) {void setLanguage(changes.attendanceLanguage.newValue||'zh',false).then(render);}
    if(changes.attendancePluginLicense&&!busy&&!success) void read(false).catch(()=>{});
  });
  window.addEventListener('pagehide',()=>{disposed=true;input.value='';clearTimeout(timer);clearInterval(refreshTimer);},{once:true});
  window.addEventListener('focus',()=>void refresh());
  try {await read();void refresh();}
  catch {status={state:'LOCKED_NEW',allowed:false,links:{}};render();error.textContent=t('gate.err.network');error.hidden=false;}
  refreshTimer=setInterval(()=>void refresh(),60000);
}
