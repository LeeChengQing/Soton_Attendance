import QRCode from 'qrcode';
import {buildVariants} from './setup.js';
import {saveDraftTasks,validateSession,nextTrigger} from './configuration.js';
import {createBackup,recoveryForRecord} from './backup.js';
import {bindingForCourse,validateBindingForCourse} from './bindings.js';
import {todayMalaysia} from './schedule.js';
import {validateFormsUrl} from './forms.js';
import {sameProfile} from './profile.js';
import {t,currentLanguage,localizeMessage} from './options-locale.js';

const $=id=>document.getElementById(id);
const node=(tag,text='',className='')=>{const n=document.createElement(tag);n.textContent=text;n.className=className;return n;};
const button=(text,fn)=>{const b=node('button',text,'secondary');b.type='button';b.addEventListener('click',fn);return b;};
const malaysia=when=>new Intl.DateTimeFormat(currentLanguage()==='en'?'en-MY':'zh-CN',{timeZone:'Asia/Kuala_Lumpur',dateStyle:'medium',timeStyle:'short'}).format(new Date(when));
function download(name,value) {
  const href=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=href;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
}
async function message(type,extra={}) {const r=await chrome.runtime.sendMessage({type,...extra});if(r?.error) throw Error(r.error);return r;}

export function createOptionsUpgrade(api) {
  let ready=false,writes=Promise.resolve(),renderId=0,page=0,draftRevision=0;
  const dock=document.querySelector('.workflow-dock');
  const panel=$('workflow-panel');
  const measureNav=new ResizeObserver(()=>{
    document.documentElement.style.setProperty('--workflow-space',`${Math.ceil(dock.getBoundingClientRect().height)+36}px`);
    document.documentElement.style.setProperty('--workflow-panel-height',`${Math.ceil(panel.getBoundingClientRect().height)}px`);
  });
  measureNav.observe(dock);measureNav.observe(panel);
  const guard=fn=>async()=>{try {await fn();} catch(e) {api.toast(localizeMessage(e.message),true);}};
  function draftChanged() {
    if(!ready) return;
    draftRevision++;
    $('review-draft').checked=false;
    const rows=structuredClone(api.preview);
    writes=writes.catch(()=>{}).then(()=>chrome.storage.local.set({attendanceDraft:{version:1,rows,reviewedAt:null}})).catch(e=>api.toast(t('savingDraftFailed',{error:localizeMessage(e.message)}),true));
    $('draft-status').textContent=t('draftSavedNeedsReview');
    void writes.then(render);
  }
  function renderStatus(data) {
    const p=data.attendanceProfile||{};
    $('profile-summary').textContent=p.student&&p.name?t('profileSavedSummary'):t('profileSummaryEmpty');
    const q=data.attendanceCloudOutbox||{},errors=(q.items||[]).filter(i=>i.lastError);
    $('cloud-queue-status').textContent=`${t('queueStatus',{count:q.items?.length||0})}${errors.length?t('queueError',{error:errors[0].lastError}):q.lastSuccessAt?t('queueSent',{date:malaysia(q.lastSuccessAt)}):''}`;
  }
  async function coverage(course,data) {
    try {validateBindingForCourse(bindingForCourse(data.attendanceBindings,course),course,data.attendanceProfile,todayMalaysia());return true;} catch {return false;}
  }
  async function renderSessions(data) {
    const list=$('sessions');list.replaceChildren();
    const sessions=data.attendanceSessions||[];
    if(!sessions.length) list.append(node('p',t('noTasks'),'muted'));
    for(const s of sessions) {
      const row=node('div','','saved-task'),head=node('div','','list-item'),label=node('div');
      const covered=await coverage(s.course,data),next=nextTrigger(s,data.attendanceRecords);
      const weekday=currentLanguage()==='en'?['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][s.weekday]:['周日','周一','周二','周三','周四','周五','周六'][s.weekday];
      const state=s.enabled===false?t('paused'):next?t('nextRun',{date:malaysia(next.when)}):t('noNextRun');
      const check=covered?t('checksComplete'):t('checksIncomplete');
      label.append(node('strong',s.course),node('small',t('sessionSummary',{weekday,start:s.time,end:s.endTime,state,check})));
      const pause=button(s.enabled===false?t('enable'):t('pause'),guard(async()=>{
        const current=await api.getData(),task=current.attendanceSessions.find(t=>t.id===s.id);if(!task) throw Error(t('noSuchTask'));
        if(task.enabled===false&&!await coverage(task.course,current)) throw Error(t('checkBeforeEnable'));
        await chrome.storage.local.set({attendanceSessions:current.attendanceSessions.map(t=>t.id===s.id?{...t,enabled:t.enabled===false,createdAt:new Date().toISOString()}:t)});await api.rebuild();await render();
      }));
      const remove=button(t('delete'),guard(async()=>{const current=await api.getData();await chrome.storage.local.set({attendanceSessions:current.attendanceSessions.filter(t=>t.id!==s.id)});await api.rebuild();await render();await api.renderBindings();}));
      head.append(label,pause,remove);row.append(head);
      const details=document.createElement('details');details.append(node('summary',t('editSession')));
      const form=node('form','','session-editor'),inputs={};
      for(const [key,title,type,value] of [['course',t('fieldCourse'),'text',s.course],['weekday',t('fieldWeekday'),'select',String(s.weekday)],['time',t('fieldStartTime'),'time',s.time],['endTime',t('fieldEndTime'),'time',s.endTime],['exceptions',t('fieldExceptionsShort'),'text',(s.exceptions||[]).join(', ')]]) {
        const label=node('label',title,'session-field'),input=document.createElement(type==='select'?'select':'input');
        if(type==='select') for(let n=0;n<7;n++) {const option=node('option',currentLanguage()==='en'?['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][n]:`周${'日一二三四五六'[n]}`);option.value=String(n);input.append(option);} else input.type=type;
        input.value=value;inputs[key]=input;label.append(input);form.append(label);
      }
      const save=node('button',t('saveChanges'));save.type='submit';form.append(save);details.append(form);row.append(details);list.append(row);
      form.addEventListener('submit',event=>{event.preventDefault();void guard(async()=>{
        const current=await api.getData(),task=current.attendanceSessions.find(t=>t.id===s.id);if(!task) throw Error(t('noSuchTask'));
        const changed=validateSession({...task,course:inputs.course.value,weekday:Number(inputs.weekday.value),time:inputs.time.value,endTime:inputs.endTime.value,exceptions:inputs.exceptions.value.split(/[,，\s]+/).filter(Boolean)});
        const covered=await coverage(changed.course,current);
        const duplicate=current.attendanceSessions.some(t=>t.id!==s.id&&t.course.toLowerCase()===changed.course.toLowerCase()&&t.weekday===changed.weekday&&t.time===changed.time&&t.endTime===changed.endTime);if(duplicate) throw Error(t('duplicateTask'));
        await chrome.storage.local.set({attendanceSessions:current.attendanceSessions.map(t=>t.id===s.id?{...changed,enabled:task.enabled!==false&&covered,createdAt:new Date().toISOString()}:t)});
        await api.rebuild();await render();await api.renderBindings();api.toast(covered?t('taskSavedRemovedTrigger'):t('savedPausedForReview'));
      })();});
    }
  }
  async function renderRecords(data) {
    const all=Object.values(data.attendanceRecords||{}).sort((a,b)=>String(b.at).localeCompare(String(a.at))),filter=$('record-filter').value;
    $('record-count').textContent=t('recordCount',{count:all.length});
    const rows=all.filter(r=>filter==='all'||r.state===filter),pages=Math.max(1,Math.ceil(rows.length/40));page=Math.min(page,pages-1);
    const list=$('records');list.replaceChildren();
    for(const r of rows.slice(page*40,page*40+40)) {
      const item=node('div','','list-item'),label=node('div'),recovery=recoveryForRecord(r);
      const recoveryKey=recovery.action==='binding'?'recoveryBinding':recovery.action==='login'?'recoveryLogin':r.state==='missed'||r.state==='missed_sleep'?'recoveryMissed':r.state==='success'?'recoverySuccess':r.state==='submitted_pending_confirmation'?'recoverySubmittedPending':'recoveryView';
      const recordState={success:t('recordSuccess'),unknown:t('recordUnknown'),submitted_pending_confirmation:t('recordSubmittedPending'),failed:t('recordFailed'),missed:t('recordMissed'),missed_sleep:t('recordMissedSleep'),launched:t('recordLaunched'),pending:t('recordPending')}[r.state]||r.state;
      label.append(node('strong',`${r.occ?.course||t('lessonFallback')} · ${r.occ?.date||''} ${r.occ?.time||''} · ${recordState}`),node('small',localizeMessage(r.detail||r.at||'')),node('small',t(`${recoveryKey}Description`)));
      const openOriginal=guard(async()=>{
        if(recovery.action==='binding') {document.getElementById('binding-heading').scrollIntoView();return;}
        if(r.tabId) try {await chrome.tabs.update(r.tabId,{active:true});return;} catch { /* original tab closed */ }
        const binding=bindingForCourse(data.attendanceBindings,r.occ?.course),url=r.formUrl||binding?.url;
        if(!url) throw Error(t('noOriginalForm'));
        await chrome.tabs.create({url:validateFormsUrl(url).href,active:true});
      });
      const actions=[];
      if(['unknown','submitted_pending_confirmation'].includes(r.state)) {
        actions.push(button(t('markSubmitted'),guard(async()=>{await message('MARK_SUBMITTED',{key:r.occ.key});await render();})));
        actions.push(button(t('allowResubmit'),guard(async()=>{if(!confirm(t('allowResubmitConfirm'))) return;await message('RELEASE_SUBMISSION',{key:r.occ.key,confirm:true});api.toast(t('resubmitProtectionReleased'));await render();})));
      }
      actions.push(button(t(recoveryKey),openOriginal));item.append(label,...actions);list.append(item);
    }
    if(!rows.length) list.append(node('p',filter==='all'?t('noRecords'):t('noFilteredRecords'),'muted'));
    $('records-page').textContent=t('recordsPage',{page:page+1,pages,count:rows.length});$('records-prev').disabled=page===0;$('records-next').disabled=page+1===pages;
  }
  async function render() {
    const id=++renderId,data=await api.getData();if(id!==renderId) return;
    renderStatus(data);await renderSessions(data);await renderRecords(data);
  }
  async function activateDraft() {
    await writes;
    const revision=draftRevision;
    const data=await api.getData();if(!api.preview.length) throw Error(t('noPreviewToActivate'));
    if(api.preview.some(row=>row.type==='LAB'&&!['1','2','skip'].includes(row.importChoice))) throw Error('请先为每条 LAB 记录选择 Group 1、Group 2 或不加入。');
    if(revision!==draftRevision||!$('review-draft').checked) throw Error(t('draftChangedReview'));
    if(!data.attendanceDraft?.reviewedAt) throw Error(t('reviewBeforeEnable'));
    const p=api.validateProfile(data.attendanceProfile||{});
    if(!sameProfile(p,api.profile())) throw Error(t('saveProfileFirst'));
    const selected=structuredClone(api.preview).filter(row=>row.importChoice!=='skip').map(row=>{
      if(row.type==='LAB'&&(row.importChoice==='1'||row.importChoice==='2')) {row.group=row.importChoice;row.course=`${row.code||row.course.split(/\s+-/)[0]}-${row.type} Group ${row.group}`;}
      return row;
    });
    buildVariants(selected,data.attendanceBindings,p);
    const rows=selected.map(validateSession);
    const sessions=saveDraftTasks(data.attendanceSessions||[],rows);
    const commit=writes.then(async()=>{
      if(revision!==draftRevision) throw Error(t('draftChangedReview'));
      await chrome.storage.local.set({attendanceSessions:sessions,attendanceDraft:{version:1,rows:[],reviewedAt:null}});
      if(revision!==draftRevision) return false;
      api.preview.length=0;ready=false;api.renderPreview();ready=true;$('review-draft').checked=false;$('draft-status').textContent=t('taskEnabledDraft');return true;
    });
    writes=commit.catch(()=>{});
    const cleared=await commit;
    await api.rebuild();await render();await api.renderBindings();api.toast(cleared?t('enabledWeeklyTasks'):t('enabledReviewedDraft'));
  }
  $('review-draft').addEventListener('change',guard(async()=>{
    const rows=structuredClone(api.preview),checked=$('review-draft').checked,revision=draftRevision;
    writes=writes.catch(()=>{}).then(()=>revision===draftRevision?chrome.storage.local.set({attendanceDraft:{version:1,rows,reviewedAt:checked?new Date().toISOString():null}}):undefined);
    await writes;if(revision===draftRevision) $('draft-status').textContent=checked?t('draftReadyToRun'):t('draftUnreviewed');
  }));
  $('verify-all-bindings').addEventListener('click',guard(()=>api.openAllBindings()));
  $('record-filter').addEventListener('change',()=>{page=0;void render();});
  $('records-prev').addEventListener('click',()=>{page=Math.max(0,page-1);void render();});$('records-next').addEventListener('click',()=>{page++;void render();});
  $('export-records').addEventListener('click',guard(async()=>download('Attendance-terminal-records.json',createBackup(await api.getData()).records)));
  $('retry-cloud').addEventListener('click',guard(async()=>{await message('RETRY_CLOUD');const r=await message('CLOUD_REQUEST',{action:'device'});$('cloud-status').textContent=r.attendanceCloudDeviceId?t('connectionRestored'):t('waitingConnection');if(r.attendanceNtfyTopic) $('ntfy-status').textContent=`${t('phoneTopicReady')} https://ntfy.sh/${r.attendanceNtfyTopic}`;await render();}));
  async function topic() {const {attendanceNtfyTopic:topicName}=await api.getData();if(!/^soton-attendance-[a-f0-9]{40}$/.test(topicName||'')) throw Error(t('topicNotReady'));return `https://ntfy.sh/${topicName}`;}
  $('copy-topic').addEventListener('click',guard(async()=>{await navigator.clipboard.writeText(await topic());api.toast(t('copiedTopic'));}));
  const qrButton=$('show-topic-qr'),qrPanel=$('topic-qr-panel'),qrCanvas=$('topic-qr');
  async function renderTopicQr(platform) {
    const webTopic=await topic(),topicName=webTopic.slice('https://ntfy.sh/'.length);
    const target=platform==='android'?`ntfy://ntfy.sh/${topicName}?display=Soton%20Attendance`:webTopic;
    await QRCode.toCanvas(qrCanvas,target,{width:220,margin:2});
    qrCanvas.hidden=false;
    $('topic-qr-android').setAttribute('aria-pressed',String(platform==='android'));
    $('topic-qr-ios').setAttribute('aria-pressed',String(platform==='ios'));
    $('topic-qr-help').textContent=platform==='android'?t('qrAndroidHelp'):t('qrIosHelp',{topic:topicName});
  }
  qrButton.addEventListener('click',guard(async()=>{
    const opening=qrPanel.hidden;
    qrPanel.hidden=!opening;qrButton.setAttribute('aria-expanded',String(opening));
    if(opening) await renderTopicQr('android');
  }));
  $('topic-qr-android').addEventListener('click',guard(()=>renderTopicQr('android')));
  $('topic-qr-ios').addEventListener('click',guard(()=>renderTopicQr('ios')));
  function refreshLocale() {
    if(qrPanel.hidden||qrCanvas.hidden) return;
    void guard(()=>renderTopicQr($('topic-qr-ios').getAttribute('aria-pressed')==='true'?'ios':'android'))();
  }
  $('refresh-delivery').addEventListener('click',guard(async()=>{
    const result=await message('CLOUD_REQUEST',{action:'notifications'}),root=$('phone-notifications');root.replaceChildren();
    const rows=result.notifications||[];$('delivery-status').textContent=rows.length?t('deliveryRecorded'):t('deliveryEmpty');
    for(const n of rows.slice(0,10)) {
      const row=node('div','','list-item'),status=n.phone_receipt_confirmed_at?t('receiptConfirmed'):({queued:t('deliveryQueued'),sending:t('deliverySending'),accepted:t('deliveryAccepted'),uncertain:t('deliveryUncertain'),discarded:t('deliveryDiscarded')})[n.delivery_state]||t('deliveryUnknown');
      row.append(node('span',`${n.title} · ${status}${n.last_error?` · ${n.last_error}`:''}`));
      if(!n.phone_receipt_confirmed_at&&['accepted','uncertain'].includes(n.delivery_state)) row.append(button(t('confirmReceipt'),guard(async()=>{await message('CLOUD_REQUEST',{action:'confirm-receipt',notificationId:n.id});$('refresh-delivery').click();})));root.append(row);
    }
  }));
  async function init(data) {
    if(data.attendanceDraft?.version===1&&Array.isArray(data.attendanceDraft.rows)) api.preview.push(...data.attendanceDraft.rows);
    $('review-draft').checked=Boolean(data.attendanceDraft?.reviewedAt);
    api.renderPreview();ready=true;await render();
    if(api.preview.length) $('draft-status').textContent=t('draftRestored');
  }
  return {init,draftChanged,render,activateDraft,refreshLocale};
}
