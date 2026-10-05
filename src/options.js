import {initWorkflowNav} from './workflow-nav.js';
import {importTimetable,decodeQrFile} from './importer.js';
import {validateFormsUrl} from './forms.js';
import {fieldMappingForQuestion} from './mapping.js';
import {moduleKey,bindingForCourse,legacyLinkSuggestion,validateBindingForCourse} from './bindings.js';
import {collectBindingInspectionTargets} from './binding-inspection.js';
import {mergeSessions,normalizeDate,todayMalaysia,toWeeklySession} from './schedule.js';
import {ensureCloudDevice,getEntitlementStatus,redeemActivationKey,startPhoneSubscriptionRecovery,completePhoneSubscriptionRecovery,phoneSubscriptionRecoveryStatus,cancelPhoneSubscriptionRecovery} from './cloud-client.js';
import {createOptionsUpgrade} from './options-upgrade.js';
import {t,currentLanguage,setLanguage,localizeMessage} from './options-locale.js';

const $=id=>document.getElementById(id);
const preview=[],cards=new Map();
let inspecting=new Map(),toastTimer,importGeneration=0,activeBindingKey=null,recoveryCooldownUntil=0,recoveryCooldownTimer,recoveryBusy=false,recoveryChallengeId='',recoveryExpiresAt=0,recoveryRequestedAt=0,recoveryCanCancel=false;
let subscriptionCurrency='rm';
const SUBSCRIPTION_RM_PRICE=11.99;
const SUBSCRIPTION_RMB_PRICE=19.9;
const profileForm=$('profile-form');
initWorkflowNav();
const upgrade=createOptionsUpgrade({preview,getData,rebuild,toast,renderPreview,renderBindings,profile,validateProfile,openAllBindings});

function toast(message,error=false) {
  message=localizeMessage(message);
  const box=$('toast');box.textContent=message;box.className=`toast visible${error?' error':''}`;
  $('persistent-error').textContent=error?message:'';
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>box.className='toast',6500);
}
function node(tag,props={}) {const el=document.createElement(tag);for(const [key,value] of Object.entries(props)) {if(key==='text') el.textContent=value;else if(key==='className') el.className=value;else el[key]=value;}return el;}
function profile() {return {student:profileForm.elements.student.value.trim(),name:profileForm.elements.name.value.trim(),studentType:profileForm.elements.studentType.value};}
function validateProfile(p) {if(!p.student||p.student.length>50||!p.name||p.name.length>100) throw Error(t('profileInvalid'));return p;}
async function getData() {return chrome.storage.local.get(['attendanceProfile','attendanceSessions','attendanceBindings','attendanceRecords','attendanceDraft','attendanceSetupSession','attendanceSetupHistory','attendanceSetupCoverageEpoch','attendanceCloudOutbox','attendanceNtfyTopic','attendanceLanguage','attendanceSubscriptionCurrency']);}
async function rebuild() {const response=await chrome.runtime.sendMessage({type:'REBUILD_SCHEDULE'});if(response?.error) throw Error(response.error);}
async function syncCloudSafe() {await rebuild();await upgrade.render();}

async function showCloudStatus() {
  const status=$('cloud-status');
  if(!status) return;
  try {
    const data=await ensureCloudDevice();
    status.textContent=t('cloudConnected');
    status.className='status success';
    const ntfy=$('ntfy-status');
    if(ntfy&&data.attendanceNtfyTopic) ntfy.textContent=`${t('phoneTopicReady')} https://ntfy.sh/${data.attendanceNtfyTopic}`;
  } catch(error) {
    status.textContent=error.message==='cloud_setup_choice_required'?t('recoveryChoice'):t('cloudFailed',{error:error.message});
    status.className='status error';
  }
}

const activationErrors={
  invalid_activation_key:'errInvalidKey',activation_key_used:'errKeyUsed',activation_key_revoked:'errKeyRevoked',activation_key_expired:'errKeyExpired',
  activation_redemption_failed:'errActivationFailed',entitlement_status_failed:'entitlementFailed',cloud_setup_choice_required:'recoveryChoice',
  recovery_in_progress:'recoveryInProgress',recovery_outcome_unknown:'recoveryOutcomeUnknown',unauthorized:'errUnauthorized',device_identifier_exists:'errDeviceExists',
};

function entitlementTermEnd(expiresAt, plan) {
  const expiry=Date.parse(expiresAt);
  if(!Number.isFinite(expiry)) return '';
  const chinaPlan=plan==='sem_subscription';
  const locale=currentLanguage()==='en'?(chinaPlan?'en-GB':'en-MY'):'zh-CN';
  const timeZone=chinaPlan?'Asia/Shanghai':'Asia/Kuala_Lumpur';
  return new Intl.DateTimeFormat(locale,{dateStyle:'long',timeZone}).format(new Date(expiry-1));
}

let entitlementExpiryTimer;
function updatePhoneStatusVisibility(entitlement) {
  const card=$('phone-status-card');
  if(!card) return false;
  clearTimeout(entitlementExpiryTimer);
  const startsAt=Date.parse(entitlement?.startsAt||''),expiresAt=Date.parse(entitlement?.expiresAt||'');
  const active=entitlement?.status==='active'&&entitlement.phoneNotifications===true&&Number.isFinite(startsAt)&&startsAt<=Date.now()&&Number.isFinite(expiresAt)&&expiresAt>Date.now();
  card.hidden=!active;
  if(!active) card.open=false;
  else entitlementExpiryTimer=setTimeout(()=>void refreshEntitlementStatus(),Math.min(expiresAt-Date.now()+25,2147483647));
  return active;
}

async function refreshEntitlementStatus() {
  const status=$('entitlement-status'),button=$('refresh-entitlement');
  if(button) button.disabled=true;
  status.textContent=t('checkingEntitlement');status.className='status';
  try {
    const result=await getEntitlementStatus(),entitlement=result.entitlement;
    if(!entitlement) {
      updatePhoneStatusVisibility(null);
      status.textContent=t('noEntitlement');
      status.className='status';
      return;
    }
    const phoneStatusVisible=updatePhoneStatusVisibility(entitlement);
    const labels={active:t('entitlementActive'),pending:t('entitlementPending'),expired:t('entitlementExpired'),revoked:t('entitlementRevoked')};
    const plans={bundle:t('firstTermPlan'),phone_notifications:t('phonePlan'),sem_subscription:t('semesterSubscriptionPlan')};
    const end=entitlementTermEnd(entitlement.expiresAt,entitlement.plan);
    const expiryText=end?t('expiry',{date:end}):'';
    const permissionText=entitlement.phoneNotifications?'':t('permissionOff');
    status.textContent=`${plans[entitlement.plan]||t('phoneFallback')} · ${labels[entitlement.status]||t('unknownStatus')}${expiryText}${permissionText}`;
    status.className=`status${phoneStatusVisible?' success':['expired','revoked'].includes(entitlement.status)?' error':''}`;
  } catch(error) {
    updatePhoneStatusVisibility(null);
    const code=error instanceof Error?error.message:'';
    status.textContent=activationErrors[code]?t(activationErrors[code]):t('entitlementFailed');
    status.className='status error';
  } finally {
    if(button) button.disabled=false;
  }
}

const activationForm=$('activation-form');
activationForm?.addEventListener('submit',async event=>{
  event.preventDefault();
  const input=$('activation-key'),button=$('activate-key'),message=$('activation-message');
  if(!input.value) {message.textContent=t('enterPurchaseKey');message.className='status error';input.focus();return;}
  button.disabled=true;message.textContent=t('activatingKey');message.className='status';
  try {
    await redeemActivationKey(input.value);
    message.textContent=t('keyActivated');message.className='status success';
    await refreshEntitlementStatus();
  } catch(error) {
    const code=error instanceof Error?error.message:'';
    message.textContent=activationErrors[code]?t(activationErrors[code]):t('activationFailed');
    message.className='status error';
  } finally {
    input.value='';button.disabled=false;
  }
});
$('refresh-entitlement')?.addEventListener('click',refreshEntitlementStatus);

async function setSubscriptionCurrency(currency,persist=true) {
  subscriptionCurrency=currency==='rmb'?'rmb':'rm';
  const rmb=subscriptionCurrency==='rmb',link=$('purchase-subscription');
  $('subscription-price').textContent=rmb?`¥${SUBSCRIPTION_RMB_PRICE.toFixed(1)}`:`RM ${SUBSCRIPTION_RM_PRICE.toFixed(2)}`;
  link.href=rmb?'https://shop.368fk.cn/shop/CFI5VKXO':'https://vf-auto-check.vercel.app/';
  link.textContent=t(rmb?'purchaseRmb':'purchaseRm');
  $('currency-rm').setAttribute('aria-pressed',String(!rmb));
  $('currency-rmb').setAttribute('aria-pressed',String(rmb));
  $('currency-rm').classList.toggle('selected',!rmb);
  $('currency-rmb').classList.toggle('selected',rmb);
  if(persist) await chrome.storage.local.set({attendanceSubscriptionCurrency:subscriptionCurrency});
}
$('currency-rm').addEventListener('click',()=>void setSubscriptionCurrency('rm'));
$('currency-rmb').addEventListener('click',()=>void setSubscriptionCurrency('rmb'));
function bindingUiState() {
  return new Map([...cards].map(([key,info])=>[key,{
    url:info.url.value,
    schema:info.schema,
    selected:[...info.card.querySelectorAll('.mapping select')].map(select=>select.value),
    confirmed:Boolean(info.card.querySelector('.mapping label input[type="checkbox"]')?.checked),
  }]));
}
async function changeLanguage(language) {
  const preservedBindings=bindingUiState();
  await setLanguage(language);
  await setSubscriptionCurrency(subscriptionCurrency,false);
  renderPreview();await renderBindings(preservedBindings);await upgrade.render();upgrade.refreshLocale();
  if($('phone-subscription').open){void refreshEntitlementStatus();void refreshRecoveryState();}
}
$('language-en').addEventListener('click',()=>void changeLanguage('en'));
$('language-zh').addEventListener('click',()=>void changeLanguage('zh'));

const recoveryErrors={
  recovery_unavailable:'recoveryUnavailable',recovery_delivery_failed:'recoveryDeliveryFailed',recovery_rate_limited:'recoveryRateLimited',
  recovery_code_invalid:'recoveryCodeInvalid',recovery_code_expired:'recoveryCodeExpired',recovery_attempts_exhausted:'recoveryAttemptsExhausted',
  cloud_setup_choice_required:'recoveryChoice',recovery_outcome_unknown:'recoveryOutcomeUnknown',recovery_in_progress:'recoveryInProgress',
};
function updateRecoveryControls(status={}) {
  if(status.challengeId!==undefined) recoveryChallengeId=status.challengeId||'';
  if(status.expiresAt!==undefined) recoveryExpiresAt=Date.parse(status.expiresAt||'')||0;
  if(status.requestedAt!==undefined) recoveryRequestedAt=Number(status.requestedAt)||0;
  if(status.canCancel!==undefined) recoveryCanCancel=Boolean(status.canCancel);
  const isValid=Boolean(recoveryChallengeId&&recoveryExpiresAt>Date.now());
  const code=$('recovery-code'),send=$('send-recovery-code'),verify=$('verify-recovery-code');
  if(code) code.disabled=!isValid||recoveryBusy;
  if(verify) verify.disabled=!isValid||recoveryBusy||!/^\d{6}$/.test(code?.value||'');
  const retryUntil=Math.max(recoveryCooldownUntil,recoveryRequestedAt+60000);
  const remaining=Math.max(0,Math.ceil((retryUntil-Date.now())/1000));
  if(send) {send.disabled=recoveryBusy||remaining>0;send.textContent=recoveryBusy?t('sendingCode'):remaining?t('resendAfter',{seconds:remaining}):recoveryChallengeId?t('resendCode'):t('sendCode');}
  const cancel=$('cancel-recovery');if(cancel) {cancel.hidden=!recoveryCanCancel;cancel.disabled=recoveryBusy;}
  if(!isValid&&recoveryChallengeId) {
    recoveryChallengeId='';
    if(code) code.disabled=true;
  }
  if(remaining>0&&!recoveryCooldownTimer) recoveryCooldownTimer=setInterval(()=>{
    updateRecoveryControls({});
    if(Date.now()>=retryUntil) {clearInterval(recoveryCooldownTimer);recoveryCooldownTimer=null;}
  },1000);
  if(remaining===0&&recoveryCooldownTimer) {clearInterval(recoveryCooldownTimer);recoveryCooldownTimer=null;}
}
function recoveryMessage(message,error=false) {
  const status=$('recovery-message');status.textContent=message;status.className=`status${error?' error':' success'}`;
}
async function refreshRecoveryState() {
  const state=await phoneSubscriptionRecoveryStatus();
  if(state.requestedAt) recoveryCooldownUntil=Math.max(recoveryCooldownUntil,state.requestedAt+60000);
  updateRecoveryControls(state);
  const expiresAt=Date.parse(state.expiresAt||'');
  if(state.setupChoice==='recovery-outcome-unknown') {
    recoveryMessage(t('recoveryPending'),true);
  } else if(state.challengeId&&Number.isFinite(expiresAt)) {
    const when=new Intl.DateTimeFormat(currentLanguage()==='en'?'en-MY':'zh-CN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kuala_Lumpur'}).format(new Date(expiresAt));
    recoveryMessage(expiresAt>Date.now()?t('sentCode',{time:when}):t('expiredCode'),expiresAt<=Date.now());
  } else if(state.setupChoice==='recovery-starting') {
    recoveryMessage(t('requestUnconfirmed'),true);
  } else if(state.hasPending) {
    recoveryMessage(t('recoveryIncomplete'),true);
  }
}
$('send-recovery-code')?.addEventListener('click',async()=>{
  const key=$('recovery-key').value.trim();
  if(!key) {recoveryMessage(t('enterOldKey'),true);$('recovery-key').focus();return;}
  recoveryBusy=true;updateRecoveryControls({});recoveryMessage(t('sendingRecovery'));
  try {
    await startPhoneSubscriptionRecovery(key);
    $('recovery-key').value='';$('recovery-code').value='';recoveryCooldownUntil=Date.now()+60000;
    await refreshRecoveryState();
  } catch(error) {
    const code=error.code||error.message||'';
    if(error.retryAfterSeconds) recoveryCooldownUntil=Date.now()+Number(error.retryAfterSeconds)*1000;
    await refreshRecoveryState();
    recoveryMessage(recoveryErrors[code]?t(recoveryErrors[code]):t('recoverySendFailed'),true);
  } finally {recoveryBusy=false;updateRecoveryControls(await phoneSubscriptionRecoveryStatus());}
});
$('recovery-code')?.addEventListener('input',()=>updateRecoveryControls({}));
$('verify-recovery-code')?.addEventListener('click',async()=>{
  const code=$('recovery-code').value.trim();
  if(!/^\d{6}$/.test(code)) {recoveryMessage(t('enterSixDigits'),true);$('recovery-code').focus();return;}
  recoveryBusy=true;updateRecoveryControls({});recoveryMessage(t('verifyingRecover'));
  try {
    await completePhoneSubscriptionRecovery(recoveryChallengeId,code);
    recoveryChallengeId='';$('recovery-code').value='';recoveryMessage(t('recoverySuccess'));
    await refreshEntitlementStatus();await showCloudStatus();await refreshRecoveryState();
  } catch(error) {
    const codeName=error.code||error.message||'';
    await refreshRecoveryState();
    recoveryMessage(recoveryErrors[codeName]?t(recoveryErrors[codeName]):t('recoveryUnknownStatus'),true);
  } finally {recoveryBusy=false;updateRecoveryControls(await phoneSubscriptionRecoveryStatus());}
});
$('cancel-recovery')?.addEventListener('click',async()=>{
  try {
    await cancelPhoneSubscriptionRecovery();recoveryChallengeId='';$('recovery-code').value='';
    recoveryMessage(t('recoveryCancelled'));
    await refreshRecoveryState();
  } catch(error) {const key=recoveryErrors[error.code||error.message];recoveryMessage(key?t(key):t('cancelFailed'),true);}
});

const weekdaysZh=['周日','周一','周二','周三','周四','周五','周六'],weekdaysEn=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const weekdays=()=>currentLanguage()==='en'?weekdaysEn:weekdaysZh;
const lessonType=course=>/(?:^|\W)lab\b/i.test(course||'')?'Lab':/(?:^|\W)(?:lec|lecture)\b/i.test(course||'')?'Lecture':/(?:^|\W)tut\b/i.test(course||'')?'Tutorial':currentLanguage()==='en'?'Lesson':'课程';
const field=(label,input)=>{const wrapper=node('label',{className:'session-field'});wrapper.append(node('span',{text:label}),input);return wrapper;};

function renderPreview(expandId) {
  upgrade.draftChanged();
  const root=$('preview-rows');
  const openIds=new Set([...root.querySelectorAll('.session-card[open]')].map(card=>card.dataset.id));
  if(expandId) openIds.add(expandId);
  root.replaceChildren();
  const groups=new Map();
  for(const row of preview) {
    const key=`weekly:${row.weekday??1}`;
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(row);
  }
  const overview=$('preview-summary');overview.replaceChildren();
  if(!preview.length) {
    overview.append(node('strong',{text:t('emptyAgendaTitle')}),node('span',{text:t('emptyAgendaCopy')}));
    root.append(node('p',{className:'agenda-empty',text:t('emptyAgenda')}));
    return;
  }
  overview.append(node('strong',{text:t('previewCount',{count:preview.length})}),node('span',{text:t('previewDayCount',{count:groups.size})}));
  const ordered=[...groups.entries()].sort(([a],[b])=>a.localeCompare(b));
  for(const [key,rows] of ordered) {
    const [,value]=key.split(':');
    const day=node('section',{className:'agenda-day'}),heading=node('div',{className:'agenda-day-head'});
    const title=`${t('weekdayPrefix')}${weekdays()[Number(value)]||t('weekdayFallback')}`;
    heading.append(node('h3',{text:title}),node('span',{className:'day-count',text:t('lessonCount',{count:rows.length})}));
    const lessons=node('div',{className:'agenda-lessons'});
    for(const row of rows.sort((a,b)=>String(a.time).localeCompare(String(b.time)))) {
      const entry=node('div',{className:'session-entry'});
      const card=node('details',{className:'session-card'});card.dataset.id=row.id;
      if(openIds.has(row.id)) card.open=true;
      const summary=node('summary',{className:'session-summary'}),time=node('span',{className:'session-time'}),main=node('span',{className:'session-main'});
      time.append(node('strong',{text:row.time||'--:--'}),node('small',{text:`${row.endTime||'--:--'} ${t('endTimeSuffix')}`}));
      main.append(node('strong',{text:row.course||t('unnamedCourse')}),node('small',{text:t('everyWeek')}));
      const type=lessonType(row.course),badge=node('span',{className:`lesson-badge ${type.toLowerCase()}`,text:type});
      summary.append(time,main,badge,node('span',{className:'session-chevron',text:'⌄'}));
      const editor=node('div',{className:'session-editor'});
      if(row.needsReview) editor.classList.add('needs-review');
      const course=node('input',{value:row.course||'',placeholder:t('coursePlaceholder')});
      course.addEventListener('input',()=>{row.course=course.value.trim();upgrade.draftChanged();});
      course.addEventListener('change',()=>{row.course=course.value.trim();renderPreview(row.id);renderBindings();});
      editor.append(field(t('fieldCourseName'),course));
      const weekday=node('select');
      for(const [index,label] of weekdays().entries()) weekday.append(node('option',{value:String(index),text:label}));
      weekday.value=String(row.weekday??1);
      weekday.addEventListener('change',()=>{row.weekday=Number(weekday.value);renderPreview(row.id);});
      editor.append(field(t('fieldWeekday'),weekday));
      const start=node('input',{type:'time',value:row.time||'09:00'});
      start.addEventListener('input',()=>{row.time=start.value;upgrade.draftChanged();});
      start.addEventListener('change',()=>{row.time=start.value;renderPreview(row.id);});
      editor.append(field(t('fieldStartTime'),start));
      const end=node('input',{type:'time',value:row.endTime||'10:00'});
      end.addEventListener('input',()=>{row.endTime=end.value;upgrade.draftChanged();});
      end.addEventListener('change',()=>{row.endTime=end.value;renderPreview(row.id);});
      editor.append(field(t('fieldEndTime'),end));
      if(row.code||row.type||row.room||row.lecturer||row.date||row.confidence) {
        const metadata=node('div',{className:'import-metadata'});
        const editable=(key,label)=>{const input=node('input',{value:row[key]||''});input.addEventListener('input',()=>{row[key]=input.value.trim();if(key==='code'||key==='type') row.course=`${row.code||''}${row.type?`-${row.type}`:''}${row.group?` Group ${row.group}`:''}`;upgrade.draftChanged();});input.addEventListener('change',()=>{renderPreview(row.id);renderBindings();});metadata.append(field(label,input));};
        if(row.code!==undefined) editable('code','代码');if(row.type!==undefined) editable('type','课型');if(row.group!==undefined) editable('group','Group');if(row.room!==undefined) editable('room','房间');if(row.lecturer!==undefined) editable('lecturer','教师');if(row.date!==undefined) editable('date','日期');
        if(row.corrections?.length) metadata.append(node('small',{className:'import-corrections',text:row.corrections.map(item=>`${item.raw} → ${item.corrected}`).join('；')}));
        if(row.confidence) metadata.append(node('small',{className:'import-confidence',text:`置信度：${Object.entries(row.confidence).map(([key,value])=>`${key} ${Math.round(value*100)}%`).join(' · ')}`}));
        if(row.type==='LAB') {
          const choice=node('select');for(const [value,label] of [['','选择自己的 Group'],['1','Group 1'],['2','Group 2'],['skip','不加入此 Group']]) choice.append(node('option',{value,text:label}));
          choice.value=row.importChoice||'';choice.addEventListener('change',()=>{row.importChoice=choice.value;if(choice.value==='1'||choice.value==='2') {row.group=choice.value;row.course=`${row.code||row.course.split(/\s+-/)[0]}-${row.type} Group ${choice.value}`;}upgrade.draftChanged();});metadata.append(field('选择参加的组',choice));
        }
        editor.append(metadata);
      }
      const exceptions=node('input',{value:(row.exceptions||[]).join(', '),placeholder:'YYYY-MM-DD, ...'});
      exceptions.addEventListener('input',()=>{row.exceptions=exceptions.value.split(/[,，\s]+/).filter(Boolean);upgrade.draftChanged();});
      exceptions.addEventListener('change',()=>{row.exceptions=exceptions.value.split(/[,，\s]+/).filter(Boolean);renderPreview(row.id);});
      const holder=field(t('fieldExceptions'),exceptions);holder.classList.add('wide');editor.append(holder);
      const remove=node('button',{type:'button',text:t('delete'),className:'quiet lesson-remove'});
      remove.setAttribute('aria-label',`${t('delete')} ${row.course||t('unnamedCourse')}`);
      remove.addEventListener('click',event=>{const index=preview.indexOf(row);if(index<0) return;preview.splice(index,1);renderPreview();void renderBindings();if(event.detail===0) {const buttons=root.querySelectorAll('.lesson-remove');(buttons[Math.min(index,buttons.length-1)]||$('add-row')).focus({preventScroll:true});}});
      card.append(summary,editor);entry.append(card,remove);lessons.append(entry);
    }
    day.append(heading,lessons);root.append(day);
  }
}

function courseNames(sessions=[]) {return [...new Set([...preview.map(r=>r.course?.trim()),...sessions.map(s=>s.course)].filter(Boolean))].sort();}
function moduleGroups(sessions=[]) {
  const groups=new Map();
  for(const course of courseNames(sessions)) {
    const key=moduleKey(course);
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(course);
  }
  return [...groups.entries()].sort(([a],[b])=>a.localeCompare(b));
}
async function renderBindings(preserved=new Map()) {
  const {attendanceSessions:sessions=[],attendanceBindings:bindings={},attendanceProfile:p={}}=await getData();
  const root=$('bindings');root.replaceChildren();cards.clear();
  const groups=moduleGroups(sessions);
  if(!groups.length) {root.append(node('p',{className:'muted',text:t('emptyBindings')}));return;}
  for(const [key,courses] of groups) {
    const saved=bindings[key],legacy=legacyLinkSuggestion(bindings,courses);
    const ready=courses.every(course=>{try {validateBindingForCourse(bindingForCourse(bindings,course),course,p,todayMalaysia());return true;} catch {return false;}});
    const card=node('article',{className:'binding'}),title=node('h3',{text:key});
    const variants=node('p',{className:'binding-variants',text:t('inspectFormsCopy',{courses:courses.join(' · ')})});
    const previous=preserved.get(key);
    const row=node('div',{className:'toolbar'}),url=node('input',{type:'url',placeholder:t('formsUrlPlaceholder'),value:previous?.url??saved?.url??legacy.url});
    url.setAttribute('aria-label',t('formsUrlLabel',{key}));
    const fileLabel=node('label',{className:'file-button',text:t('uploadQr')}),file=node('input',{type:'file',accept:'.png,.jpg,.jpeg,image/png,image/jpeg'});fileLabel.append(file);
    const status=node('p',{className:'status',text:ready?t('bindingReady',{title:saved.title}):legacy.conflict?t('legacyConflict'):t('bindingNeedsReview')});
    row.append(url,fileLabel);card.append(title,variants,row,status);
    root.append(card);cards.set(key,{card,url,status,courses,schema:previous?.schema});
    if(previous?.schema) renderInspection(key,previous.schema,previous.selected,previous.confirmed);
    url.addEventListener('focus',()=>activeBindingKey=key);
    url.addEventListener('input',()=>activeBindingKey=key);
    file.addEventListener('change',async()=>{try {activeBindingKey=key;const decoded=await decodeQrFile(file.files[0]);url.value=decoded;status.textContent=t('qrRead');} catch(error){toast(error.message,true);}file.value='';});
  }
}

function bindingNeedsReview(key,info,bindings,studentProfile) {
  const saved=bindings[key];
  if(!saved?.verified||info.url.value.trim()!==saved.url) return true;
  try {for(const course of info.courses) validateBindingForCourse(saved,course,studentProfile,todayMalaysia());return false;}
  catch {return true;}
}

function clearInspections() {
  for(const inspection of inspecting.values()) clearTimeout(inspection.timer);
  inspecting.clear();
}

async function openAllBindings() {
  if(inspecting.size) throw Error(t('inspectionBusy'));
  const entries=[...cards.entries()].map(([key,info])=>({key,url:info.url.value}));
  const targets=collectBindingInspectionTargets(entries,validateFormsUrl);
  const tabs=await Promise.all(targets.map((target,index)=>chrome.tabs.create({url:'about:blank',active:index===0})));
  for(const [index,target] of targets.entries()) {
    const tab=tabs[index],info=cards.get(target.key);
    if(!info) continue;
    info.status.textContent=t('openingForm');
    const inspection={key:target.key,tabId:tab.id};
    inspection.timer=setTimeout(()=>{
      if(inspecting.get(tab.id)!==inspection) return;
      info.status.textContent=t('inspectionTimeout');
      inspecting.delete(tab.id);
    },90000);
    inspecting.set(tab.id,inspection);
  }
  await Promise.all(tabs.map((tab,index)=>chrome.tabs.update(tab.id,{url:targets[index].url})));
  toast(t('openedForms',{count:targets.length}));
}

function renderInspection(key,schema,selectedValues=[],wasConfirmed=false) {
  const info=cards.get(key);if(!info) return;
  info.schema=schema;
  const courses=info.courses,course=courses[0];
  info.card.querySelector('.mapping')?.remove();
  const box=node('div',{className:'mapping'});
  box.append(node('p',{text:t('actualForm',{title:schema.title,url:schema.url})}));
  const code=key.match(/[A-Za-z]{2,}\d{3,}/)?.[0];
  if(code&&!schema.title.toLowerCase().includes(code.toLowerCase())) box.append(node('p',{className:'status',text:t('courseCodeMissing',{code})}));
  const selects=[];
  const fields=node('details',{className:'mapping-fields'});fields.append(node('summary',{text:t('editMapping')}));
  for(const [i,q] of schema.questions.entries()) {
    const title=/^\s*\d+[.)．、]/.test(q.title)?q.title:`${i+1}. ${q.title}`;
    const line=node('div',{className:'mapping-row'}),label=node('label',{text:`${title}（${q.type}${q.options?.length?`：${q.options.join(' / ')}`:''}）`}),select=node('select');
    select.id=`mapping-${key}-${i}`;label.htmlFor=select.id;
    const {choices,selected}=fieldMappingForQuestion(q,course);
    for(const [value,text] of choices) select.append(node('option',{value,text}));
    select.value=selectedValues[i]&&choices.some(([value])=>value===selectedValues[i])?selectedValues[i]:selected;selects.push(select);line.append(label,select);fields.append(line);
  }
  fields.open=selects.some(select=>!select.value);box.append(fields);
  const confirmLabel=node('label',{className:'checkbox'}),confirm=node('input',{type:'checkbox'});
  confirm.checked=wasConfirmed;
  confirmLabel.append(confirm,node('span',{text:t('bindingConfirmation',{key,courses:courses.join(currentLanguage()==='en'?', ':'、')})}));box.append(confirmLabel);
  const save=node('button',{type:'button',text:t('saveBinding'),className:'save-binding'});box.append(save);info.card.append(box);
  save.addEventListener('click',async()=>{
    try {
      if(!confirm.checked) throw Error(t('verifyBeforeSave'));
      const p=validateProfile(profile());
      const mapping=schema.questions.map((q,i)=>({title:q.title,type:q.type,options:q.options||[],field:selects[i].value}));
      if(mapping.some(x=>!x.field)) throw Error(t('mapEveryQuestion'));
      const binding={url:validateFormsUrl(schema.url).href,title:schema.title,questions:schema.questions,mapping,verified:true,scope:'module'};
      for(const variant of courses) validateBindingForCourse(binding,variant,p,todayMalaysia());
      const {attendanceBindings:bindings={}}=await getData();
      bindings[key]=binding;
      await chrome.storage.local.set({attendanceBindings:bindings,attendanceProfile:p});
      await syncCloudSafe({sessions:(await getData()).attendanceSessions||[],bindings});
      info.card.querySelector('.mapping')?.remove();
      info.schema=undefined;
      info.status.textContent=t('verifiedForm',{title:schema.title});
      toast(t('bindingSaved',{key}));
    } catch(error) {toast(error.message,true);}
  });
}

chrome.runtime.onMessage.addListener((message,sender)=>{
  const inspection=inspecting.get(sender.tab?.id);
  if(!inspection) return;
  const key=inspection.key,info=cards.get(key);
  if(!info) return;
  if(message.type==='FORM_SETUP_ERROR') {info.status.textContent=localizeMessage(message.error);clearTimeout(inspection.timer);inspecting.delete(sender.tab.id);return;}
  if(message.type!=='FORM_READY') return;
  try {
    const url=validateFormsUrl(message.url);
    if(!/^\/Pages\/ResponsePage\.aspx$/i.test(url.pathname)||!message.title||!message.questions?.length) throw Error(t('formsNotFound'));
    clearTimeout(inspection.timer);inspecting.delete(sender.tab.id);
    info.status.textContent=t('reviewForm');
    renderInspection(key,{url:url.href,title:message.title,questions:message.questions});
  } catch(error) {info.status.textContent=localizeMessage(error.message);clearTimeout(inspection.timer);inspecting.delete(sender.tab.id);}
});

async function renderSaved() {await upgrade.render();}

profileForm.addEventListener('submit',async event=>{event.preventDefault();try {await chrome.storage.local.set({attendanceProfile:validateProfile(profile())});await rebuild();await renderBindings();await upgrade.render();$('profile-details').open=false;toast(t('profileSavedToast'));} catch(error){toast(error.message,true);}});
$('timetable-file').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file) return;
  const generation=++importGeneration;
  try {
    $('import-status').textContent=t('recognizingTimetable');
    const rows=await importTimetable(file,message=>{if(generation===importGeneration) $('import-status').textContent=localizeMessage(message);});
    if(generation!==importGeneration) return;
    if(!rows.length) throw Error(t('noRecognizedLessons'));
    preview.push(...rows.map(r=>{
      const dayNumber={Mo:1,Tu:2,We:3,Th:4,Fr:5}[r.day]??r.weekday??1;
      const course=r.course||`${r.code||''}${r.type?`-${r.type}`:''}${r.group?` Group ${r.group}`:''}`;
      const weekly=toWeeklySession({kind:'weekly',weekday:dayNumber,course,time:r.start||r.time,endTime:r.end||r.endTime});
      return {...weekly,id:crypto.randomUUID(),exceptions:[],...r,course,weekday:dayNumber,time:r.start||r.time,endTime:r.end||r.endTime};
    }));
    $('import-status').textContent=t('recognizedLessons',{count:rows.length,groupWarning:rows.some(r=>/\bGroup\s*\d+\b/i.test(r.course))?t('groupWarning'):''});
    renderPreview();await renderBindings();
  } catch(error) {if(generation===importGeneration) {$('import-status').textContent=error.message;toast(error.message,true);}}
  finally {event.target.value='';}
});
$('add-row').addEventListener('click',async()=>{const row={id:crypto.randomUUID(),course:'',kind:'weekly',weekday:1,time:'09:00',endTime:'10:00',exceptions:[]};preview.push(row);renderPreview(row.id);});
$('clear-preview').addEventListener('click',async()=>{
  if(!confirm(t('clearPreviewConfirm'))) return;
  importGeneration++;
  preview.length=0;
  $('timetable-file').value='';
  $('import-status').textContent=t('noImportYet');
  renderPreview();await renderBindings();
  toast(t('draftCleared'));
});
$('clear-bindings').addEventListener('click',async()=>{
  if(!confirm(t('clearBindingsConfirm'))) return;
  try {
    clearInspections();
    await chrome.storage.local.set({attendanceBindings:{}});
    await rebuild();await upgrade.render();await renderBindings();
    toast(t('bindingsCleared'));
  } catch(error) {toast(error.message,true);}
});
$('clear-sessions').addEventListener('click',async()=>{
  if(!confirm(t('clearTasksConfirm'))) return;
  try {
    await chrome.storage.local.set({attendanceSessions:[]});
    await rebuild();
    await renderSaved();await renderBindings();
    toast(t('tasksDeleted'));
  } catch(error) {toast(error.message,true);}
});
$('create-tasks').addEventListener('click',async()=>{try {await upgrade.activateDraft();} catch(error) {toast(error.message,true);}});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&['attendanceRecords','attendanceSessions','attendanceBindings','attendanceProfile','attendanceSetupSession','attendanceSetupHistory','attendanceCloudOutbox'].some(key=>key in changes)) renderSaved().catch(console.error);});
let phoneInitialized=false;
$('phone-subscription').addEventListener('toggle',()=>{if(!$('phone-subscription').open||phoneInitialized) return;phoneInitialized=true;void showCloudStatus();void refreshEntitlementStatus();});
$('open-subscription').addEventListener('click',()=>{$('phone-subscription').open=true;$('phone-subscription').querySelector('summary').focus({preventScroll:true});});
for(const link of document.querySelectorAll('a[href="#profile-heading"]')) link.addEventListener('click',()=>{$('profile-details').open=true;});
(async()=>{
  const data=await getData(),p=data.attendanceProfile||{};
  await setLanguage(data.attendanceLanguage||'zh',false);
  await setSubscriptionCurrency(data.attendanceSubscriptionCurrency||'rm',false);
  profileForm.elements.student.value=p.student||'';profileForm.elements.name.value=p.name||'';profileForm.elements.studentType.value=p.studentType||'local';
  $('profile-details').open=!(p.student&&p.name);
  await upgrade.init(data);
  await renderBindings();await renderSaved();
  await refreshRecoveryState();
})().catch(error=>toast(error.message,true));
