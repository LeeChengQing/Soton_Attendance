import {getActivationGate} from './license-gate.js';
import {preflightCoordinator} from './preflight.js';
import {occurrencesBetween,triggerTimestamp,todayMalaysia,toWeeklySession,mergeSessions} from './schedule.js';
import {dueAction,transition,reserveSubmissionRecord,manualCheckInState} from './state.js';
import {validateFormsUrl} from './forms.js';
import {bindingForCourse,resolveFillPlan} from './bindings.js';
import {ensureCloudDevice,cloudSnapshot,deliverCloud,getEntitlementStatus,createCheckoutSession,activatePluginLicense,getPluginLicenseStatus,redeemActivationKey,startPhoneSubscriptionRecovery,completePhoneSubscriptionRecovery,phoneSubscriptionRecoveryStatus,cancelPhoneSubscriptionRecovery} from './cloud.js';
import {enqueue,acknowledge,fail,nextReady} from './outbox.js';
import {setupCoordinator} from './setup-coordinator.js';
import {coverageRevision,itemTerminal} from './setup.js';
import {isSettingsSender,isPopupSender} from './settings-sender.js';
import {occurrenceTimestamp} from './schedule.js';
import {restoreBackup} from './backup.js';
import {PHASE_TIMEOUTS,PHASE_ERRORS,isSchoolLoginOrPermissionUrl,redactDiagnostic} from './reliability.js';
import {LOGIN_REDIRECT_SETTLE_MS,canSubmitBeforeEnd,assertBeforeCourseEnd,courseEndTimestamp,fillingTimeout,scheduleWeekStatus} from './runtime-timing.js';
import {runError,formatRunError,createDiagnostic} from './diagnostics.js';
import {cleanQuestionTitle} from './question-title.js';
import {testFormAllowed,testFormIdentity} from './test-mode.js';

var NEXT = "attendance-next";
var MAINTENANCE = "attendance-maintenance";
var CLOUD = "attendance-cloud";
var cloudEnabled = () => Boolean(chrome.runtime?.id);
var queue = Promise.resolve();
var serialized = (fn) => {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {
  });
  return next;
};
var daysFrom = (date, offset) => {
  const d = /* @__PURE__ */ new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
async function load() {
  const data = await chrome.storage.local.get(["attendanceSessions", "attendanceBindings", "attendanceProfile", "attendanceRecords", "attendanceScheduleMode"]);
  {
    const sessions = (data.attendanceSessions || []).map(toWeeklySession);
    if(data.attendanceScheduleMode!=='weekly'||JSON.stringify(sessions)!==JSON.stringify(data.attendanceSessions||[])) await chrome.storage.local.set({ attendanceSessions: sessions, attendanceScheduleMode: "weekly" });
    data.attendanceSessions = sessions;
  }
  return data;
}
var saveRecords = (records) => chrome.storage.local.set({ attendanceRecords: records });
var awakeCount = 0;
async function syncKeepAwake(recordsOverride) {
  if (!chrome.power) return;
  const {keepAwakeEnabled=false,attendanceSessions:sessions=[],attendanceRecords:stored={}}=await chrome.storage.local.get(['keepAwakeEnabled','attendanceSessions','attendanceRecords']);
  await chrome.alarms.clear('attendance-power');
  if (!keepAwakeEnabled || !await chrome.permissions.contains({permissions:['power']})) {
    if (awakeCount) chrome.power.releaseKeepAwake();
    awakeCount=0;
    return;
  }
  const records=recordsOverride || stored, now=Date.now();
  let count=0, next=Infinity;
  for (const occ of occurrencesBetween(sessions,todayMalaysia(),daysFrom(todayMalaysia(),32))) {
    if (records[occ.key] && !['scheduled','launched','pending'].includes(records[occ.key].state)) continue;
    const trigger=triggerTimestamp(occ), start=trigger-10*60*1000, end=courseEndTimestamp(occ);
    if (!Number.isFinite(end) || trigger<Date.parse(occ.createdAt || '1970-01-01') || end<=now) continue;
    if (start>now) next=Math.min(next,start);
    else { count++; next=Math.min(next,end); }
  }
  if (count && !awakeCount) chrome.power.requestKeepAwake('system');
  if (!count && awakeCount) chrome.power.releaseKeepAwake();
  awakeCount=count;
  if (Number.isFinite(next)) await chrome.alarms.create('attendance-power',{when:next});
}

async function healthSnapshot() {
  const {attendanceSessions: sessions = [], attendanceRecords: records = {}} = await chrome.storage.local.get(['attendanceSessions', 'attendanceRecords']);
  const latest = Object.values(records).filter(record => record.preflight).sort((a, b) => Date.parse(b.preflight.at) - Date.parse(a.preflight.at))[0];
  const login = latest?.preflight.checks?.find(check => check.name.includes('登录'));
  const today = todayMalaysia(), now = Date.now();
  const next = occurrencesBetween(sessions, today, daysFrom(today, 32)).map(occ => ({occ, timestamp: triggerTimestamp(occ)})).filter(({occ, timestamp}) => (!records[occ.key] || records[occ.key].state === 'scheduled') && timestamp > now && timestamp >= Date.parse(occ.createdAt || '1970-01-01')).sort((a, b) => a.timestamp - b.timestamp)[0];
  return {notifications: await chrome.notifications.getPermissionLevel() === 'granted', loggedIn: login?.ok ?? null, nextRun: next?.timestamp ?? null, version: chrome.runtime.getManifest().version};
}
async function enqueueCloud(action, payload, extra = {}) {
  if (!cloudEnabled()) return chrome.storage.local.set(extra);
  if (action === "sync") {
    const state = await chrome.storage.local.get(["attendanceCloudSetupChoice", "attendanceCloudDeviceId", "attendanceCloudToken"]);
    const choice = state.attendanceCloudSetupChoice;
    const recovering = ["recovery-starting", "recovery-pending", "recovery-verifying", "recovery-outcome-unknown", "recovery-finalizing"].includes(choice);
    const hasIdentity = Boolean(state.attendanceCloudDeviceId && state.attendanceCloudToken);
    const cloudChosen = hasIdentity || choice === "new" || choice === "recovered";
    if (recovering || !cloudChosen || choice === "recovered" && !payload?.schedules?.length) return chrome.storage.local.set(extra);
  }
  const { attendanceCloudOutbox: q = {} } = await chrome.storage.local.get("attendanceCloudOutbox");
  const next = enqueue(q, action, payload);
  await chrome.storage.local.set({ ...extra, attendanceCloudOutbox: next });
  await chrome.alarms.create(CLOUD, { when: Date.now() + 1e3 });
}
async function persistTerminal(records, key) {
  const r = records[key], o = r.occ;
  const terminalState=r.state;
  const attempt=r.attemptHistory?.find(a=>a.id===r.activeAttemptId);
  const attemptOpen=Boolean(attempt&&!attempt.completedAt);
  if(attempt&&(!attempt.completedAt||['pending','submitted_pending_confirmation','unknown'].includes(attempt.state))) Object.assign(attempt,{state:terminalState,completedAt:new Date().toISOString(),detail:sanitizeDetail(r.detail)});
  await restoreForeground(r);
  await chrome.alarms.clear(`attendance-end:${key}`);
  await chrome.alarms.clear(`attendance-retry:${key}`);
  const {attendanceProfile:profile={},attendanceDiagnostics:diagnostics=[]}=await chrome.storage.local.get(['attendanceProfile','attendanceDiagnostics']);
  if(!['success','success_manual'].includes(r.state)) r.error=runError(r.error||(['unknown','submitted_pending_confirmation'].includes(r.state)?{code:'submit_unconfirmed',message:r.detail}:r.detail),{course:o.course,phase:r.error?.phase||r.failurePhase||(r.phase==='completed'?'submit':r.phase)});
  else delete r.error;
  const diagnostic=createDiagnostic({...r,course:o.course,type:o.type},profile);
  r.error=diagnostic.error||undefined;
  if(diagnostic.dateDiag) r.dateDiag=diagnostic.dateDiag;
  if(diagnostic.dateFillPath) r.dateFillPath=diagnostic.dateFillPath;
  r.diagnosticId ||= crypto.randomUUID();
  if(r.error) r.detail=formatRunError(r.error);
  const diagnosticRows=diagnostics.filter(d=>d.id!==r.diagnosticId);
  diagnosticRows.push({...diagnostic,id:r.diagnosticId});
  await chrome.storage.local.set({attendanceDiagnostics:diagnosticRows.slice(-100)});
  const cloudStatus = r.state === 'success_manual' ? 'success' : r.state === "submitted_pending_confirmation" ? "unknown" : r.state === "missed_sleep" ? "missed" : r.state;
  if(r.catchUpIntent?.state==='pending') r.catchUpIntent={...r.catchUpIntent,state:'completed'};
  if(r.origin==='manual'&&['failed','missed'].includes(terminalState)&&!r.submissionKey&&!r.submissionAttemptedAt&&attemptOpen) {
    const {attendanceSessions:sessions=[]}=await chrome.storage.local.get('attendanceSessions');
    if(currentTask(sessions,r)&&o.date===todayMalaysia()&&canSubmitBeforeEnd(o,Date.now())) {
      r.state='scheduled';r.catchUpIntent={sourceAttemptId:attempt.id,state:'pending'};
      delete r.tabId;
      // Arm the existing scheduler before committing the intent, so worker loss cannot strand it.
      await chrome.alarms.create(`attendance-retry:${key}`,{when:Math.max(Date.now()+1000,triggerTimestamp(o))});
    } else {r.state='missed';r.detail='课程已过期、暂停、变更或结束，未提交。';}
  }
  await enqueueCloud("event", { status: cloudStatus, courseCode: o.course, classDate: o.date, startTime: o.time, endTime: o.endTime, formUrl: r.formUrl || void 0, occurrenceKey: o.key, detail: r.detail }, { attendanceRecords: records });
  await syncKeepAwake(records);
  if (['failed', 'submitted_pending_confirmation', 'missed_sleep'].includes(terminalState)) await raiseAlert({key, state: terminalState, course: o.course, detail: r.detail, at: r.at});
}
async function resumeScheduledRecovery(key) {
  const record=(await chrome.storage.local.get('attendanceRecords')).attendanceRecords?.[key];
  if(record?.catchUpIntent?.state==='pending'&&record.state==='scheduled'&&!record.submissionKey&&!record.submissionAttemptedAt) await processSchedule();
}
async function raiseAlert(level) {
  const {key, state, course, detail, at} = level;
  await chrome.storage.local.set({unresolvedAlert: {key, state, course, detail, at}});
  await chrome.action.setBadgeText({text: '!'});
  await chrome.action.setBadgeBackgroundColor({color: '#d93025'});
}
var draining = false;
var setup = setupCoordinator(enqueueCloud);
var preflight = preflightCoordinator(notify);
async function cloudReadyForDrain() {
  const state = await chrome.storage.local.get(["attendanceCloudDeviceId", "attendanceCloudToken", "attendanceCloudSetupChoice"]);
  if (["recovery-starting", "recovery-pending", "recovery-verifying", "recovery-outcome-unknown", "recovery-finalizing"].includes(state.attendanceCloudSetupChoice)) return false;
  if (state.attendanceCloudDeviceId && state.attendanceCloudToken) return true;
  return state.attendanceCloudSetupChoice === "new" || state.attendanceCloudSetupChoice === "recovered";
}
async function drainCloud() {
  if (draining || !cloudEnabled() || !await cloudReadyForDrain()) return;
  draining = true;
  try {
    for (let count = 0; count < 20; count++) {
      const item = await serialized(async () => {
        const { attendanceCloudOutbox: q = {} } = await chrome.storage.local.get("attendanceCloudOutbox");
        return nextReady(q);
      });
      if (!item || !await cloudReadyForDrain()) break;
      let error;
      try {
        await deliverCloud(item);
      } catch (e) {
        error = e.message;
      }
      await serialized(async () => {
        const { attendanceCloudOutbox: q = {} } = await chrome.storage.local.get("attendanceCloudOutbox");
        await chrome.storage.local.set({ attendanceCloudOutbox: error ? fail(q, item.id, error) : acknowledge(q, item.id) });
      });
    }
    await serialized(async () => {
      const { attendanceCloudOutbox: q = {} } = await chrome.storage.local.get("attendanceCloudOutbox");
      if (q.items?.length) await chrome.alarms.create(CLOUD, { when: Math.max(Date.now() + 1e3, Math.min(...q.items.map((i) => i.availableAt))) });
    });
  } finally {
    draining = false;
  }
}
async function notify(title, message, id = crypto.randomUUID(), priority = 1) {
  try {
    await chrome.notifications.create(id, { type: "basic", iconUrl: chrome.runtime.getURL("icon.png"), title, message, priority });
  } catch (error) {
    console.warn("\u7CFB\u7EDF\u901A\u77E5\u4E0D\u53EF\u7528", error.message);
  }
}
async function nextAlarm(sessions, records) {
  sessions=sessions.filter(session=>!session.testTemplate);
  await syncKeepAwake(records);
  await chrome.alarms.clear(NEXT);
  await chrome.alarms.clear("attendance-evening");
  const today = todayMalaysia(), future = occurrencesBetween(sessions, today, daysFrom(today, 32));
  const next = future.filter((o) => (!records[o.key] || records[o.key].state==='scheduled') && triggerTimestamp(o) > Date.now() && triggerTimestamp(o) >= Date.parse(o.createdAt || "1970-01-01")).sort((a, b) => triggerTimestamp(a) - triggerTimestamp(b))[0];
  if (next) await chrome.alarms.create(NEXT, { when: triggerTimestamp(next) });
  await preflight.schedule(occurrencesBetween(sessions,today,daysFrom(today,7)),records);
  await chrome.alarms.create(MAINTENANCE, { periodInMinutes: 60 });
}
async function requirePluginLicense() {
  const gate=await getActivationGate({refresh:true});
  if(!gate.allowed) throw Error('plugin_license_required');
}
async function manualCheckIn(message,sender) {
  if(!(isSettingsSender(sender)||isPopupSender(sender))||Object.keys(message).some(k=>!['type','sessionId'].includes(k))) throw Error('manual_check_in_not_allowed');
  const select=async()=>{
    const data=await load(),today=todayMalaysia();
    const occ=occurrencesBetween(data.attendanceSessions,today,today).find(o=>o.id===message.sessionId&&!o.testTemplate&&!o.isTest&&!o.testRunId);
    if(!occ||manualCheckInState(occ,data.attendanceRecords?.[occ.key])!=='ready') throw Error('manual_check_in_not_eligible');
    const binding=bindingForCourse(data.attendanceBindings,occ.course);
    resolveFillPlan(binding,occ,data.attendanceProfile||{},occ.date);validateFormsUrl(binding.url);
    return {data,occ};
  };
  await select();
  await requirePluginLicense();
  const {data,occ}=await select(),previous=data.attendanceRecords?.[occ.key];
  if(previous&&previous.state!=='scheduled') await saveRecords({...data.attendanceRecords,[occ.key]:{...previous,state:'scheduled'}});
  await processSchedule({manualKey:occ.key});
  const record=(await chrome.storage.local.get('attendanceRecords')).attendanceRecords?.[occ.key];
  if(record?.state!=='launched'||record.origin!=='manual') throw Error(record?.detail||'manual_check_in_not_started');
  return {ok:true,key:occ.key,tabId:record.tabId};
}
async function processSchedule({testKey,manualKey,automationAuthorization} = {}) {
  await syncKeepAwake();
  await preflight.resume();
  const { attendanceSessions: sessions = [], attendanceBindings: bindings = {}, attendanceProfile: profile = {}, attendanceRecords: stored = {} } = await load();
  const records = { ...stored }, today = todayMalaysia(), now = Date.now();
  for(const [key,r] of Object.entries(records)) if(r.catchUpIntent?.state==='pending') {
    if(r.state!=='scheduled'||r.submissionKey||r.submissionAttemptedAt) r.catchUpIntent={...r.catchUpIntent,state:'completed'};
    else if(!currentTask(sessions,r)||r.occ.date!==today||!canSubmitBeforeEnd(r.occ,now)) {
      r.state='missed';r.detail='课程已过期、暂停、变更或结束，未提交。';r.catchUpIntent={...r.catchUpIntent,state:'completed'};
      await persistTerminal(records,key);
    }
  }
  for (const [key, r] of Object.entries(records)) {
    if (!["launched", "pending"].includes(r.state)) continue;
    const deadline = r.phaseDeadline || r.watchDeadline || Date.parse(r.at) + 9e4;
    if (deadline <= now) {
      await watchdog(key);
      Object.assign(records, (await chrome.storage.local.get("attendanceRecords")).attendanceRecords);
    } else await chrome.alarms.create(`attendance-watch:${key}`, { when: deadline });
  }
  const missedCourses = [];
  for (const occ of occurrencesBetween(sessions, daysFrom(today, -7), today)) {
    if(testKey && occ.key!==testKey || manualKey && occ.key!==manualKey || occ.testTemplate) continue;
    if(manualKey&&manualCheckInState(occ,records[occ.key],Date.now())!=='ready') continue;
    const due = triggerTimestamp(occ);
    const immediate=Boolean(testKey || manualKey || occ.testRunId);
    if(records[occ.key]?.submissionKey||records[occ.key]?.submissionAttemptedAt) continue;
    if (records[occ.key] && records[occ.key].state!=='scheduled' || !immediate && (due > now || due < Date.parse(occ.createdAt || "1970-01-01"))) continue;
    await preflight.abortAll();
    Object.assign(records,(await chrome.storage.local.get("attendanceRecords")).attendanceRecords);
    const action = dueAction(due, now);
    if(records[occ.key]?.needForeground) {
      const {allowForegroundFallback=true}=await chrome.storage.local.get('allowForegroundFallback');
      if(allowForegroundFallback===false||!canSubmitBeforeEnd(occ,Date.now(),60000)) {
        records[occ.key]={...records[occ.key],...transition('scheduled','failed'),occ,error:runError({code:'date_fill_hidden_tab'},{course:occ.course,phase:'fill'})};
        await persistTerminal(records,occ.key);
        continue;
      }
    }
    if(occ.isTest && occ.testAuthorizationExpiresAt<=now) {
      records[occ.key]={...(records[occ.key]||{}),...transition('scheduled','missed'),occ,error:runError({code:'test_authorization_expired'},{course:occ.course,phase:'validate'})};
      await persistTerminal(records,occ.key);continue;
    }
    if (!canSubmitBeforeEnd(occ, now,occ.isTest?60000:0)) {
      records[occ.key] = {...(records[occ.key]||{}),...transition('scheduled', 'missed'), occ, detail: '课程已结束或结束时间无效，未提交。'};
      await persistTerminal(records, occ.key);
      missedCourses.push(occ.course);
      continue;
    }
    if (!immediate && action === "missed") {
      records[occ.key] = { ...(records[occ.key]||{}), ...transition("scheduled", "missed_sleep"), occ, detail: "\u8BBE\u5907\u4F11\u7720\u6216\u6D4F\u89C8\u5668\u672A\u53CA\u65F6\u8FD0\u884C\uFF0C\u9519\u8FC7\u81EA\u52A8\u63D0\u4EA4\u7A97\u53E3\u3002" };
      await persistTerminal(records, occ.key);
      missedCourses.push(occ.course);
      continue;
    }
    const binding = bindingForCourse(bindings, occ.course);
    if(binding?.isTest || occ.isTest) {
      const {testFormAllowlist=[]}=await chrome.storage.local.get('testFormAllowlist');
      if(!testFormAllowed(binding,testFormAllowlist)) {
        records[occ.key]={...(records[occ.key]||{}),...transition('scheduled','missed'),occ,error:runError({code:'not_allowed'},{course:occ.course,phase:'validate'})};
        await persistTerminal(records,occ.key);continue;
      }
    }
    const validationStarted=Date.now();
    try {
      resolveFillPlan(binding, occ, profile, occ.date);
    } catch (error) {
      records[occ.key] = { ...(records[occ.key]||{}), ...transition("scheduled", error.code==='course_kind_unknown'?'failed':'missed'), occ, detail: error.message,error:runError(error,{course:occ.course,phase:'validate'}),phaseDurations:{checking:Date.now()-validationStarted},questionTitles:(binding?.questions||[]).map(q=>({before:q.title,after:cleanQuestionTitle(q.title)})) };
      await persistTerminal(records, occ.key);
      missedCourses.push(occ.course);
      continue;
    }
    try {await (automationAuthorization ??= requirePluginLicense());}
    catch(error) {
      records[occ.key]={...(records[occ.key]||{}),state:'scheduled',occ,detail:error.message};
      continue;
    }
    const current=await chrome.storage.local.get('attendanceSessions');
    if(!currentTask(current.attendanceSessions||[],{occ})||!canSubmitBeforeEnd(occ,Date.now(),occ.isTest?60000:0)||manualKey&&manualCheckInState(occ,records[occ.key])!=='ready') {
      records[occ.key]={...(records[occ.key]||{}),...transition('scheduled','missed'),occ,error:runError({code:scheduleWeekStatus(occ)==='active'?'configuration_changed':'schedule_week_inactive'},{course:occ.course,phase:'validate'})};
      await persistTerminal(records,occ.key);continue;
    }
    const startedAt = (/* @__PURE__ */ new Date()).toISOString(), phase = "opening";
    records[occ.key] = { ...(records[occ.key]||{}), ...transition("scheduled", "launched"), occ,questionTitles:createDiagnostic({questionTitles:(binding.questions||[]).map(q=>({before:q.title,after:cleanQuestionTitle(q.title)}))},profile).questionTitles, phaseDurations:{checking:Date.now()-validationStarted},formUrl: binding.url, configuration: JSON.stringify({ binding, profile }), phase, phaseStartedAt: startedAt, phaseDeadline: Date.now() + PHASE_TIMEOUTS[phase], watchDeadline: Date.now() + 9e4 };
    const record=records[occ.key],attemptId=crypto.randomUUID();
    record.origin=manualKey?'manual':'scheduled';record.activeAttemptId=attemptId;
    if(record.catchUpIntent?.state==='pending') record.catchUpIntent={...record.catchUpIntent,state:'completed',launchedAttemptId:attemptId};
    delete record.tabId;delete record.diagnosticId;delete record.fallbackInjected;
    delete record.error;delete record.detail;delete record.failurePhase;
    record.attemptHistory=[...(record.attemptHistory||[]),{id:attemptId,origin:record.origin,state:'launched',startedAt}];
    await chrome.alarms.create(`attendance-watch:${occ.key}`,{when:record.phaseDeadline});
    await saveRecords(records);
    if(record.catchUpIntent?.state==='completed') await chrome.alarms.clear(`attendance-retry:${occ.key}`);
    try {
      const record=records[occ.key],options={url:'about:blank',active:manualKey?true:record.needForeground===true};
      record.attempts=(record.attempts||0)+1;
      await chrome.alarms.create(`attendance-end:${occ.key}`,{when:courseEndTimestamp(occ)});
      if(record.needForeground) {
        const [previous]=await chrome.tabs.query({active:true,currentWindow:true});
        if(!previous) throw Error('找不到前台窗口，未提交。');
        const currentWindow=await chrome.windows.get(previous.windowId);
        record.foregroundRestore={prevActiveTabId:previous.id,windowId:previous.windowId,windowState:currentWindow.state};
        record.foregroundRetried=true;
        options.windowId=previous.windowId;
        await saveRecords(records);
        await chrome.alarms.create(`attendance-end:${occ.key}`,{when:courseEndTimestamp(occ)});
        if(currentWindow.state==='minimized') await chrome.windows.update(previous.windowId,{state:'normal',focused:false});
      }
      assertBeforeCourseEnd(occ);
      const tab = await chrome.tabs.create(options);
      records[occ.key].tabId = tab.id;
      await saveRecords(records);
      await chrome.alarms.create(`attendance-watch:${occ.key}`, { when: records[occ.key].phaseDeadline });
      const url = validateFormsUrl(binding.url);
      url.hash = new URLSearchParams({ attendanceRun: occ.key }).toString();
      await chrome.tabs.update(tab.id, { url: url.href });
    } catch (error) {
      records[occ.key] = { ...records[occ.key], ...transition("launched", ['course_ended','schedule_week_inactive'].includes(error.code)?'missed':'failed'), detail: error.message,error:runError(error,{course:occ.course,phase:'opening'}),phaseDurations:{...records[occ.key].phaseDurations,opening:Math.max(0,Date.now()-Date.parse(startedAt))} };
      await persistTerminal(records, occ.key);
      await notify("\u6253\u5361\u672A\u6267\u884C", `${occ.course}\uFF1A${error.message}`);
    }
  }
  await saveRecords(records);
  await enqueueCloud("sync", cloudSnapshot({ sessions, bindings, profile }));
  if (missedCourses.length) await notify("\u8BF7\u624B\u52A8\u5904\u7406\u8BFE\u7A0B\u6253\u5361", `${missedCourses.join("\u3001")} \u672A\u81EA\u52A8\u63D0\u4EA4\u3002\u8BF7\u6253\u5F00\u6269\u5C55\u67E5\u770B\u539F\u56E0\u3002`);
  await nextAlarm(sessions, records);
  await setup.resume();
  if(manualKey) await resumeScheduledRecovery(manualKey);
}
var sanitizeDetail = redactDiagnostic;
async function restoreForeground(record) {
  const restore=record.foregroundRestore;
  if(!restore) return;
  try {await chrome.tabs.update(restore.prevActiveTabId,{active:true});}
  catch(error) {console.warn('Foreground tab restore failed',error.message);}
  if(restore.windowState==='minimized') {
    try {await chrome.windows.update(restore.windowId,{state:'minimized',focused:false});}
    catch(error) {console.warn('Foreground window restore failed',error.message);}
  }
  delete record.foregroundRestore;
}
async function needForeground(message,sender) {
  const {attendanceRecords:records={},allowForegroundFallback=true}=await chrome.storage.local.get(['attendanceRecords','allowForegroundFallback']);
  const record=records[message.key];
  if(!record||record.tabId!==sender.tab?.id||record.state!=='launched'||record.submissionAttemptedAt||record.submissionKey||message.submissionNotClicked!==true||message.error?.code!=='date_fill_hidden_tab') throw Error('前台重试与当前点击前任务不匹配。');
  if(allowForegroundFallback!==false) record.needForeground=true;
  await saveRecords(records);
  const result=await report({...message,state:'failed'},sender);
  if(!result.retry) await chrome.tabs.remove(record.tabId).catch(error=>console.warn('Foreground failed tab close failed',error.message));
  return result;
}
async function reportPhase(message, sender) {
  const { attendanceRecords: records = {}, attendanceBindings: bindings = {}, attendanceProfile:profile={} } = await chrome.storage.local.get(["attendanceRecords", "attendanceBindings",'attendanceProfile']);
  const record = records[message.key];
  if (!record || record.tabId !== sender.tab?.id || !PHASE_TIMEOUTS[message.phase]) throw Error("\u6253\u5361\u9636\u6BB5\u4E0E\u5F53\u524D\u9875\u9762\u4E0D\u5339\u914D\u3002");
  if (["success", "success_manual", "failed", "unknown", "missed", "missed_sleep", "submitted_pending_confirmation"].includes(record.state)) return { ok: true };
  const now = Date.now(), started = Date.parse(record.phaseStartedAt || "") || now, durations = { ...record.phaseDurations || {} };
  if (record.phase) durations[record.phase] = (durations[record.phase] || 0) + Math.max(0, now - started);
  const timeout = message.phase === 'filling' ? fillingTimeout(bindingForCourse(bindings, record.occ.course)?.questions || bindingForCourse(bindings, record.occ.course)?.mapping) : PHASE_TIMEOUTS[message.phase];
  records[message.key] = { ...record, phase: message.phase, phaseStartedAt: new Date(now).toISOString(), phaseDeadline: now + timeout, phaseDurations: durations };
  if(message.diagnostic) {
    const diagnostic=createDiagnostic(message.diagnostic,profile);
    Object.assign(records[message.key],{questionTitles:diagnostic.questionTitles,dateDiag:diagnostic.dateDiag||record.dateDiag,dateFillPath:record.foregroundRetried?'foreground':diagnostic.dateFillPath||record.dateFillPath});
  }
  if(message.phase==='confirming' && Number.isInteger(message.submissionBefore?.questionCount)) records[message.key].submissionBefore={questionCount:Math.max(0,message.submissionBefore.questionCount),submitVisible:message.submissionBefore.submitVisible===true};
  await saveRecords(records);
  await chrome.alarms.create(`attendance-watch:${message.key}`, { when: now + timeout });
  return { ok: true };
}
async function reserve(message, sender) {
  const { attendanceRecords: records = {}, attendanceSessions: sessions = [], attendanceProfile: profile = {}, attendanceBindings: bindings = {} } = await chrome.storage.local.get(["attendanceRecords", "attendanceSessions", "attendanceProfile", "attendanceBindings"]);
  const record = records[message.key];
  if (!record || record.tabId !== sender.tab?.id) throw Error("\u6253\u5361\u4EFB\u52A1\u4E0E\u5F53\u524D\u9875\u9762\u4E0D\u5339\u914D\u3002");
  if (!currentTask(sessions, record)) throw Error("\u6253\u5361\u4EFB\u52A1\u5DF2\u5220\u9664\u3001\u6682\u505C\u6216\u4FEE\u6539\uFF0C\u672A\u63D0\u4EA4\u3002");
  if(record.occ.isTest || bindingForCourse(bindings,record.occ.course)?.isTest) {
    if(record.occ.testAuthorizationExpiresAt<=Date.now()) {
      records[message.key]={...record,...transition(record.state,'missed'),error:runError({code:'test_authorization_expired'},{course:record.occ.course,phase:'submit'})};
      await persistTerminal(records,message.key);
      return {granted:false,reason:'test_authorization_expired'};
    }
    const {testFormAllowlist=[]}=await chrome.storage.local.get('testFormAllowlist');
    if(!testFormAllowed(bindingForCourse(bindings,record.occ.course),testFormAllowlist)) return {granted:false,reason:'not_allowed'};
    if(!canSubmitBeforeEnd(record.occ,Date.now(),60000)) return {granted:false,reason:'course_ended'};
    try {
      const expected=testFormIdentity(bindingForCourse(bindings,record.occ.course).url),actual=testFormIdentity(sender.url||sender.tab?.url);
      if(actual.host!==expected.host || actual.formId!==expected.formId) return {granted:false,reason:'not_allowed'};
    } catch {return {granted:false,reason:'not_allowed'};}
  }
  if (record.occ.date !== todayMalaysia() || record.configuration && record.configuration !== JSON.stringify({ binding: bindingForCourse(bindings, record.occ.course), profile })) throw Error("\u4EFB\u52A1\u65E5\u671F\u6216\u914D\u7F6E\u5DF2\u53D8\u5316\uFF0C\u672A\u6388\u6743\u63D0\u4EA4\u3002");
  const fresh=await chrome.storage.local.get(['attendanceRecords','attendanceSessions','attendanceBindings','attendanceProfile']),live=fresh.attendanceRecords?.[message.key];
  if(!live||live.tabId!==sender.tab.id||live.activeAttemptId!==record.activeAttemptId||!currentTask(fresh.attendanceSessions||[],live)||live.occ.date!==todayMalaysia()||live.configuration&&live.configuration!==JSON.stringify({binding:bindingForCourse(fresh.attendanceBindings,live.occ.course),profile:fresh.attendanceProfile||{}})) return {ok:true,granted:false,reason:'configuration_changed'};
  if(live.origin==='manual'&&manualCheckInState(live.occ,undefined)!=='ready') return {ok:true,granted:false,reason:'manual_check_in_not_eligible'};
  const result = reserveSubmissionRecord(fresh.attendanceRecords, message.key, sender.tab.id, (/* @__PURE__ */ new Date()).toISOString());
  if (!result.granted) {
    if (result.reason === 'course_ended') {
      await persistTerminal(result.records, message.key);
      await chrome.alarms.clear(`attendance-watch:${message.key}`);
    }
    return { ok: true, granted: false, reason: result.reason };
  }
  await saveRecords(result.records);
  await chrome.alarms.create(`attendance-watch:${message.key}`, { when: Date.now() + PHASE_TIMEOUTS.submitting });
  return { ok: true, granted: true };
}
async function markSubmitted(message, sender) {
  if (!isSettingsSender(sender)) throw Error("\u53EA\u80FD\u4ECE\u6269\u5C55\u8BBE\u7F6E\u9875\u624B\u52A8\u786E\u8BA4\u3002");
  const { attendanceRecords: records = {} } = await chrome.storage.local.get("attendanceRecords"), record = records[message.key];
  if (!record || !["unknown", "submitted_pending_confirmation"].includes(record.state)) throw Error("\u8FD9\u6761\u8BB0\u5F55\u5F53\u524D\u4E0D\u80FD\u624B\u52A8\u6807\u8BB0\u3002");
  records[message.key] = { ...record, ...transition(record.state, "manual_submitted"), detail: "\u7528\u6237\u624B\u52A8\u6807\u8BB0\u4E3A\u5DF2\u63D0\u4EA4\u3002", phase: "completed" };
  await persistTerminal(records, message.key);
  return { ok: true };
}
async function releaseSubmission(message, sender) {
  if (!isSettingsSender(sender)) throw Error("\u53EA\u80FD\u4ECE\u6269\u5C55\u8BBE\u7F6E\u9875\u89E3\u9664\u63D0\u4EA4\u4FDD\u62A4\u3002");
  if (message.confirm !== true) throw Error("\u89E3\u9664\u63D0\u4EA4\u4FDD\u62A4\u53EF\u80FD\u9020\u6210\u91CD\u590D\u6253\u5361\uFF0C\u8BF7\u660E\u786E\u786E\u8BA4\u3002");
  const { attendanceRecords: records = {} } = await chrome.storage.local.get("attendanceRecords"), record = records[message.key];
  if (!record || !["unknown", "submitted_pending_confirmation"].includes(record.state)) throw Error("\u8FD9\u6761\u8BB0\u5F55\u5F53\u524D\u4E0D\u80FD\u89E3\u9664\u63D0\u4EA4\u4FDD\u62A4\u3002");
  const next = { ...record, manualResubmitAllowed: true, detail: "\u7528\u6237\u5DF2\u660E\u786E\u5141\u8BB8\u91CD\u65B0\u63D0\u4EA4\uFF1B\u7CFB\u7EDF\u4E0D\u4F1A\u81EA\u52A8\u91CD\u8BD5\u3002" };
  delete next.submissionAttemptedAt;
  delete next.submissionKey;
  await chrome.storage.local.set({ attendanceRecords: { ...records, [message.key]: next } });
  return { ok: true };
}
async function report(message, sender) {
  const { attendanceRecords: records = {}, attendanceSessions: sessions = [], attendanceProfile: profile = {}, attendanceBindings: bindings = {} } = await chrome.storage.local.get(["attendanceRecords", "attendanceSessions", "attendanceProfile", "attendanceBindings"]);
  const record = records[message.key];
  const {attendanceConfirmationTestMode}=await chrome.storage.local.get('attendanceConfirmationTestMode');
  if (!record || record.tabId !== sender.tab?.id) throw Error("\u6253\u5361\u4EFB\u52A1\u4E0E\u5F53\u524D\u9875\u9762\u4E0D\u5339\u914D\u3002");
  if (message.state === "pending" && !currentTask(sessions, record)) throw Error("\u6253\u5361\u4EFB\u52A1\u5DF2\u5220\u9664\u3001\u6682\u505C\u6216\u4FEE\u6539\uFF0C\u672A\u63D0\u4EA4\u3002");
  if (message.state === "pending" && (record.occ.date !== todayMalaysia() || record.configuration && record.configuration !== JSON.stringify({ binding: bindingForCourse(bindings, record.occ.course), profile }))) throw Error("\u4EFB\u52A1\u65E5\u671F\u6216\u914D\u7F6E\u5DF2\u53D8\u5316\uFF0C\u672A\u6388\u6743\u63D0\u4EA4\u3002");
  if (message.state === "submitted_pending_confirmation" && !record.submissionAttemptedAt && record.state !== "pending") throw Error("\u63D0\u4EA4\u5C1A\u672A\u83B7\u5F97\u540E\u53F0\u63D0\u4EA4\u6743\u3002");
  if (message.state === 'missed' && (message.submissionNotClicked !== true || !['launched','pending'].includes(record.state))) throw Error('只能将尚未点击提交的任务标记为错过。');
  const {allowForegroundFallback=true}=await chrome.storage.local.get('allowForegroundFallback');
  if(record.origin!=='manual'&&message.state==='failed'&&message.error?.code==='date_fill_hidden_tab'&&message.submissionNotClicked===true&&record.state==='launched'&&!record.submissionAttemptedAt&&!record.submissionKey&&record.needForeground&&!record.foregroundRetried&&allowForegroundFallback!==false&&canSubmitBeforeEnd(record.occ,Date.now(),60000)&&currentTask(sessions,record)) {
    await restoreForeground(record);
    const attempt=record.attemptHistory?.find(a=>a.id===record.activeAttemptId);
    if(attempt&&!attempt.completedAt) Object.assign(attempt,{state:'failed',completedAt:new Date().toISOString(),detail:sanitizeDetail(message.detail||message.error?.message)});
    records[message.key]={...record,state:'scheduled',at:new Date().toISOString(),error:runError(message.error,{course:record.occ.course,phase:'fill'}),dateDiag:createDiagnostic(message.diagnostic,profile).dateDiag,dateFillPath:createDiagnostic(message.diagnostic,profile).dateFillPath||record.dateFillPath};
    delete records[message.key].tabId;
    await saveRecords(records);
    await chrome.alarms.clear(`attendance-watch:${message.key}`);
    await chrome.tabs.remove(record.tabId).catch(error=>console.warn('Foreground retry tab close failed',error.message));
    await chrome.alarms.create(`attendance-retry:${message.key}`,{when:Date.now()+1000});
    return {ok:true,retry:true};
  }
  const next = transition(record.state, message.state);
  const now = Date.now(), durations = { ...record.phaseDurations || {} };
  if (record.phase) durations[record.phase] = (durations[record.phase] || 0) + Math.max(0, now - (Date.parse(record.phaseStartedAt || "") || now));
  records[message.key] = { ...record, ...next, phase: "completed",failurePhase:record.phase, error:message.state==='success'?undefined:runError(message.error||message.detail,{course:record.occ.course,phase:message.error?.phase||record.phase}),questionTitles:message.diagnostic?.questionTitles||record.questionTitles,dateDiag:createDiagnostic(message.diagnostic,profile).dateDiag||record.dateDiag, phaseDurations: durations, successSignal: message.state === "success" ? sanitizeDetail(message.detail) : void 0, detail: sanitizeDetail(message.detail) };
  records[message.key].dateFillPath=record.foregroundRetried?'foreground':createDiagnostic(message.diagnostic,profile).dateFillPath||record.dateFillPath;
  if(attendanceConfirmationTestMode===true && message.state==='success' && message.diagnostic?.successPage) records[message.key].successPage=createDiagnostic(message.diagnostic,profile).successPage;
  if (["success", "failed", "unknown", "missed", "missed_sleep", "submitted_pending_confirmation"].includes(next.state)) await persistTerminal(records, message.key);
  else await saveRecords(records);
  if (next.state === 'missed') await chrome.alarms.clear(`attendance-watch:${message.key}`);
  if (["success", "failed", "unknown", "submitted_pending_confirmation"].includes(next.state)) {
    await chrome.alarms.clear(`attendance-watch:${message.key}`);
    const title = next.state === "success" ? "\u6253\u5361\u6210\u529F" : next.state === "submitted_pending_confirmation" ? "\u5DF2\u63D0\u4EA4\uFF0C\u5F85\u786E\u8BA4" : next.state === "unknown" ? "\u6253\u5361\u7ED3\u679C\u4E0D\u660E" : "\u6253\u5361\u5931\u8D25";
    await notify(title, records[message.key].error?formatRunError(records[message.key].error):`${record.occ.course} \xB7 ${record.occ.date} ${record.occ.time}`, undefined, next.state==='submitted_pending_confirmation'?2:1);
  }
  await resumeScheduledRecovery(message.key);
  return { ok: true };
}
async function openManualResubmit(message,sender) {
  if(!isSettingsSender(sender)) throw Error('请从扩展设置页手动打开表单。');
  await requirePluginLicense();
  const data=await chrome.storage.local.get(['attendanceRecords','attendanceBindings']);
  const record=data.attendanceRecords?.[message.key];
  if(!record || !['unknown','submitted_pending_confirmation'].includes(record.state)) throw Error('这条记录当前不能重新提交。');
  const url=validateFormsUrl(record.formUrl || bindingForCourse(data.attendanceBindings,record.occ.course)?.url);
  await chrome.tabs.create({url:url.href,active:true});
  data.attendanceRecords[message.key]={...record,manualResubmitRequestedAt:new Date().toISOString(),manualResubmitRequestedBy:'user',detail:'用户主动打开表单并选择手动重新提交；这不是自动重试，自动提交保护仍保留。'};
  await saveRecords(data.attendanceRecords);
  return {ok:true};
}
async function watchdog(key) {
  const { attendanceRecords: records = {} } = await chrome.storage.local.get("attendanceRecords");
  const record = records[key];
  if (!record || !["launched", "pending"].includes(record.state)) return;
  if(await retryTestRun(records,key)) return;
  if (["opening", "reading"].includes(record.phase) && !(record.foregroundRestore&&!canSubmitBeforeEnd(record.occ,Date.now())) && !record.fallbackInjected && record.tabId && chrome.scripting?.executeScript) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: record.tabId }, files: ["content.js"] });
      const phaseDurations={...record.phaseDurations};
      if(record.phase) phaseDurations[record.phase]=(phaseDurations[record.phase]||0)+Math.max(0,Date.now()-(Date.parse(record.phaseStartedAt)||Date.now()));
      records[key] = { ...record,phaseDurations, fallbackInjected: true, phase: "reading", phaseDeadline: Date.now() + PHASE_TIMEOUTS.reading, phaseStartedAt: (/* @__PURE__ */ new Date()).toISOString() };
      await saveRecords(records);
      await chrome.alarms.create(`attendance-watch:${key}`, { when: records[key].phaseDeadline });
      return;
    } catch {
    }
  }
  const state = record.state === "pending" ? "submitted_pending_confirmation" : "failed";
  const detail = state === "failed" ? PHASE_ERRORS[record.phase] || "\u8868\u5355\u9875\u9762\u672A\u80FD\u5B8C\u6210\u8BFB\u53D6\u3002" : PHASE_ERRORS.confirming;
  const phaseDurations = { ...record.phaseDurations || {} }, phaseStarted = Date.parse(record.phaseStartedAt || "");
  if (record.phase && Number.isFinite(phaseStarted)) phaseDurations[record.phase] = (phaseDurations[record.phase] || 0) + Math.max(0, Date.now() - phaseStarted);
  records[key] = { ...record, ...transition(record.state, state), phase: "completed",error:runError({code:state==='failed'?'phase_timeout':'submit_unconfirmed',message:detail},{course:record.occ.course,phase:record.phase}), phaseDurations, detail };
  await persistTerminal(records, key);
  await notify(state === "submitted_pending_confirmation" ? "\u5DF2\u63D0\u4EA4\uFF0C\u5F85\u786E\u8BA4" : "\u6253\u5361\u5931\u8D25", `${record.occ.course}\uFF1A${records[key].detail}`,undefined,state==='submitted_pending_confirmation'?2:1);
}
async function retryTestRun(records,key) {
  const record=records[key];
  if(!record?.occ?.isTest || record.state!=='launched' || record.submissionAttemptedAt || record.submissionKey) return false;
  const data=await chrome.storage.local.get(['attendanceBindings','testFormAllowlist','attendanceSessions']);
  if(record.occ.testAuthorizationExpiresAt<=Date.now() || !testFormAllowed(bindingForCourse(data.attendanceBindings,record.occ.course),data.testFormAllowlist) || !currentTask(data.attendanceSessions||[],record) || record.occ.date!==todayMalaysia() || !canSubmitBeforeEnd(record.occ,Date.now(),60000)) {
    const code=record.occ.testAuthorizationExpiresAt<=Date.now()?'test_authorization_expired':record.occ.date!==todayMalaysia()?'date_mismatch':!canSubmitBeforeEnd(record.occ,Date.now(),60000)?'course_ended':'configuration_changed';
    records[key]={...record,...transition('launched','missed'),phase:'completed',error:runError({code},{course:record.occ.course,phase:record.phase})};
    await persistTerminal(records,key);return true;
  }
  await restoreForeground(record);
  const durations={...record.phaseDurations};
  if(record.phase) durations[record.phase]=(durations[record.phase]||0)+Math.max(0,Date.now()-(Date.parse(record.phaseStartedAt)||Date.now()));
  records[key]={...record,state:'scheduled',phaseDurations:durations};
  delete records[key].tabId;
  await saveRecords(records);
  await chrome.alarms.clear(`attendance-watch:${key}`);
  await chrome.tabs.remove(record.tabId).catch(()=>{});
  await chrome.alarms.create(`attendance-retry:${key}`,{when:Date.now()+1000});
  return true;
}
async function runTestNow(message,sender) {
  if(!isSettingsSender(sender)) return {error:'not_allowed'};
  const data=await load(),{testFormAllowlist=[]}=await chrome.storage.local.get('testFormAllowlist');
  const binding=data.attendanceBindings?.[message.bindingId];
  if(!testFormAllowed(binding,testFormAllowlist) || binding.scope!=='module') return {error:'not_allowed'};
  const today=todayMalaysia();
  const candidates=(data.attendanceSessions||[]).map(session=>session.testTemplate && session.isTest===true && session.testBindingId===message.bindingId ? {...session,enabled:true} : session);
  const template=occurrencesBetween(candidates,today,today).find(occ=>!occ.testRunId && bindingForCourse(data.attendanceBindings,occ.course)===binding);
  if(!template) return {error:'no_test_session'};
  if(Object.values(data.attendanceRecords||{}).some(record=>['launched','pending'].includes(record.state))) return {error:'test_busy'};
  const automationAuthorization=requirePluginLicense();
  await automationAuthorization;
  const now=Date.now(),testDeadline=now+15*60*1000;
  const endTime=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(testDeadline));
  const id=crypto.randomUUID(),session={...template,id,course:template.course,kind:'weekly',startDate:today,endDate:today,endTime,testDeadline,testAuthorizationExpiresAt:testDeadline,createdAt:new Date(now).toISOString(),isTest:true,testTemplate:false,testRunId:id};
  delete session.key;delete session.date;
  await chrome.storage.local.set({attendanceSessions:[...data.attendanceSessions,session]});
  const [occ]=occurrencesBetween([session],today,today);
  await processSchedule({testKey:occ.key,automationAuthorization});
  const {attendanceRecords}=await chrome.storage.local.get('attendanceRecords');
  return {ok:true,key:occ.key,tabId:attendanceRecords[occ.key]?.tabId};
}
function currentTask(sessions, r) {
  return scheduleWeekStatus(r.occ)==='active' && sessions.some((s) => s.id === r.occ.id && s.weekStartDate===r.occ.weekStartDate && scheduleWeekStatus(s)==='active' && s.enabled !== false && s.course === r.occ.course && s.weekday === (r.occ.weekday??new Date(`${r.occ.date}T00:00:00Z`).getUTCDay()) && s.time === r.occ.time && s.endTime === r.occ.endTime && !(s.exceptions || []).includes(r.occ.date));
}
async function whoAmI(sender) {
  if (!Number.isInteger(sender.tab?.id)) return null;
  const preflightIdentity=await preflight.identify(sender.tab.id);
  if(preflightIdentity) return preflightIdentity;
  try { validateFormsUrl(sender.url || sender.tab.url || ''); } catch { return null; }
  const data = await chrome.storage.local.get(['attendanceRecords','attendanceSessions','attendanceChecks','attendanceSetupSession','attendanceBindings','attendanceProfile']);
  const today = todayMalaysia();
  const entry = Object.entries(data.attendanceRecords || {}).find(([,r]) => r.tabId === sender.tab.id && r.state === 'launched' && r.occ?.date === today && currentTask(data.attendanceSessions || [],r));
  if (entry) return {key:entry[0],kind:'run'};
  const check = Object.entries(data.attendanceChecks || {}).find(([,r]) => r.tabId === sender.tab.id && r.state === 'launched' && r.date === today && r.configuration === JSON.stringify({binding:bindingForCourse(data.attendanceBindings,r.course),profile:data.attendanceProfile}));
  if (check) return {key:check[0],kind:'check',course:check[1].course};
  const session = data.attendanceSetupSession;
  if (session?.state !== 'running' || todayMalaysia(new Date(session.startedAt)) !== today) return null;
  const item = session.items.find(i => i.tabId === sender.tab.id && !itemTerminal(i.state) && i.state !== 'queued' && i.deadline > Date.now());
  if (!item) return null;
  try {
    if (coverageRevision(item,bindingForCourse(data.attendanceBindings,item.course),data.attendanceProfile) !== item.revision) return null;
  } catch { return null; }
  return {key:item.id,kind:'setup',setupId:session.id,itemId:item.id};
}
async function startCheck(message,sender) {
  if (!isSettingsSender(sender)) throw Error('请从扩展设置页开始检查。');
  await requirePluginLicense();
  const data = await chrome.storage.local.get(['attendanceChecks','attendanceBindings','attendanceProfile']);
  const binding = bindingForCourse(data.attendanceBindings,message.course);
  resolveFillPlan(binding,{course:message.course},data.attendanceProfile,todayMalaysia());
  const url = validateFormsUrl(binding.url), key = crypto.randomUUID();
  const tab = await chrome.tabs.create({url:'about:blank',active:true});
  const checks = Object.fromEntries(Object.entries(data.attendanceChecks || {}).filter(([,r]) => r.date === todayMalaysia()));
  checks[key] = {tabId:tab.id,course:message.course,date:todayMalaysia(),state:'launched',configuration:JSON.stringify({binding,profile:data.attendanceProfile})};
  await chrome.storage.local.set({attendanceChecks:checks});
  url.hash = new URLSearchParams({attendanceCheck:message.course}).toString();
  try { await chrome.tabs.update(tab.id,{url:url.href}); }
  catch (error) {checks[key].state='failed';await chrome.storage.local.set({attendanceChecks:checks});throw error;}
  return {key,tabId:tab.id};
}
chrome.runtime.onInstalled.addListener(details => serialized(async()=>{if(details?.reason==='install') await chrome.runtime.openOptionsPage();await getActivationGate();return processSchedule();}));
chrome.runtime.onStartup.addListener(() => serialized(async()=>{await getActivationGate();return processSchedule();}));
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.alarms.onAlarm.addListener((alarm) => serialized(async () => {
  if(alarm.name.startsWith('attendance-preflight:')) {try {await requirePluginLicense();}catch {return;}}
  if(await preflight.alarm(alarm.name)) return;
  if (alarm.name === 'attendance-power') await syncKeepAwake();
  else if (alarm.name === NEXT || alarm.name === MAINTENANCE || alarm.name.startsWith('attendance-retry:')) await processSchedule();
  else if (alarm.name.startsWith('attendance-end:')) await watchdog(alarm.name.slice('attendance-end:'.length));
  else if (alarm.name.startsWith("attendance-watch:")) await watchdog(alarm.name.slice("attendance-watch:".length));
  else if (alarm.name.startsWith("attendance-setup:")) await setup.resume();
  if(alarm.name.startsWith('attendance-end:')||alarm.name.startsWith('attendance-watch:')) await resumeScheduledRecovery(alarm.name.slice(alarm.name.indexOf(':')+1));
}).then(() => {
  if (alarm.name === CLOUD || alarm.name === MAINTENANCE) void drainCloud();
}));
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if(message?.type==='RUN_TEST_NOW') {
    serialized(()=>runTestNow(message,sender)).then(sendResponse,error=>sendResponse({error:error.message}));return true;
  }
  if (message?.type === 'ACK_ALERT') {
    serialized(async () => {
      if (!isSettingsSender(sender)) throw Error('请从扩展设置页确认告警。');
      await chrome.storage.local.remove('unresolvedAlert');
      await getActivationGate();
      return {ok: true};
    }).then(sendResponse, error => sendResponse({error: error.message}));
    return true;
  }
  if (message?.type === 'HEALTH_CHECK') {
    serialized(async () => healthSnapshot()).then(sendResponse, error => sendResponse({error: error.message}));
    return true;
  }
  if (message?.type === "RESTORE_BACKUP") {
    serialized(async () => {
      if (!isSettingsSender(sender)) throw Error("\u8BF7\u4ECE\u6269\u5C55\u8BBE\u7F6E\u9875\u6062\u590D\u5907\u4EFD\u3002");
      const current = await chrome.storage.local.get(["attendanceRecords", "attendanceSetupSession"]);
      if (current.attendanceSetupSession?.state === "running") await setup.handle({ type: "CANCEL_SETUP" }, sender);
      const restored = restoreBackup(message.backup, current);
      await chrome.storage.local.set(restored);
      await processSchedule();
      return { ok: true, profile: restored.attendanceProfile };
    }).then(sendResponse, (error) => sendResponse({ error: error.message }));
    return true;
  }
  if (["START_SETUP", "GET_SETUP_ITEM", "REPORT_SETUP_ITEM", "CONFIRM_SETUP_ITEM", "CONFIRM_ALL_SETUP_ITEMS", "CANCEL_SETUP"].includes(message?.type)) {
    serialized(async () => {
      if(['START_SETUP','GET_SETUP_ITEM'].includes(message.type)) await requirePluginLicense();
      return setup.handle(message, sender);
    }).then(sendResponse, (error) => sendResponse({ error: error.message }));
    return true;
  }
  if(message?.type==='GET_LICENSE_GATE') {
    if(!(isSettingsSender(sender)||isPopupSender(sender))) {sendResponse({error:'not_allowed'});return false;}
    getActivationGate({refresh:message.refresh===true}).then(sendResponse,()=>sendResponse({error:'gate_unavailable'}));return true;
  }
  if (message?.type === "CLOUD_REQUEST") {
    if (!isSettingsSender(sender)) {
      sendResponse({ error: "\u8BBE\u7F6E\u64CD\u4F5C\u53EA\u80FD\u4ECE\u6269\u5C55\u8BBE\u7F6E\u9875\u6267\u884C\u3002" });
      return false;
    }
    const operations = {
      device: async () => ensureCloudDevice({ allowRegistration: typeof __ATTENDANCE_DEV__!=='undefined'&&__ATTENDANCE_DEV__ }),
      entitlement: () => getEntitlementStatus(),
      checkout: () => createCheckoutSession({ plan: message.plan, source: message.source, currency: message.currency }),
      "activate-plugin-license": async () => {const pending=activatePluginLicense(message.licenseKey);message.licenseKey='';const result=await pending;return {...result,gate:await getActivationGate()};},
      "plugin-license-status": () => getPluginLicenseStatus(),
      redeem: () => redeemActivationKey(message.activationKey),
      notifications: () => deliverCloud({ action: "notifications", payload: {} }),
      "confirm-receipt": () => deliverCloud({ action: "confirm-receipt", payload: { notificationId: message.notificationId } }),
      "recovery-start": () => startPhoneSubscriptionRecovery(message.activationKey),
      "recovery-complete": () => completePhoneSubscriptionRecovery(message.challengeId, message.code),
      "recovery-status": () => phoneSubscriptionRecoveryStatus(),
      "recovery-cancel": () => cancelPhoneSubscriptionRecovery()
    };
    const operation = operations[message.action];
    if (!operation) return false;
    operation().then(async (data) => {
      if (message.action === "device") {
        const { attendanceNtfyTopic, attendanceCloudDeviceId } = data;
        sendResponse({ attendanceNtfyTopic, attendanceCloudDeviceId });
      } else {
        if (message.action === "redeem" || message.action === "recovery-complete") {
          try {
            await serialized(processSchedule);
            void drainCloud();
          } catch (error) {
            console.error("Cloud schedule refresh after subscription change failed", error.message);
          }
        }
        sendResponse(data);
      }
    }, (error) => sendResponse({ error: error.code || error.message, retryAfterSeconds: error.retryAfterSeconds, httpStatus:error.httpStatus }));
    return true;
  }
  if (message?.type === "RETRY_CLOUD") {
    serialized(async () => {
      if (!isSettingsSender(sender)) throw Error("\u8BF7\u4ECE\u6269\u5C55\u8BBE\u7F6E\u9875\u91CD\u8BD5\u4E91\u7AEF\u8FDE\u63A5\u3002");
      const { attendanceCloudOutbox: q = {} } = await chrome.storage.local.get("attendanceCloudOutbox");
      await chrome.storage.local.set({ attendanceCloudOutbox: { ...q, items: (q.items || []).map((i) => ({ ...i, availableAt: Date.now() })) } });
      return { ok: true };
    }).then((result) => {
      sendResponse(result);
      void drainCloud();
    }, (e) => sendResponse({ error: e.message }));
    return true;
  }
  if (["GET_PREFLIGHT","REPORT_PREFLIGHT"].includes(message?.type)) {
    serialized(async()=>{
      if(message.type==='GET_PREFLIGHT') await requirePluginLicense();
      return preflight.handle(message,sender);
    }).then(sendResponse,error=>sendResponse({error:error.message}));return true;
  }
  if(message?.type==='AUTHORIZE_AUTOMATION') {
    serialized(async()=>{
      if(!Number.isInteger(sender.tab?.id)) throw Error('not_allowed');
      validateFormsUrl(sender.url||sender.tab.url||'');
      const {attendanceRecords:active={}}=await chrome.storage.local.get('attendanceRecords');
      if(!Object.values(active).some(record=>record.tabId===sender.tab.id&&['launched','pending'].includes(record.state))) await requirePluginLicense();
      return {ok:true};
    }).then(sendResponse,error=>sendResponse({error:error.message}));return true;
  }
  if (message?.type === 'GET_POPUP_COURSES') {
    if (!isPopupSender(sender)) {sendResponse({error:'not_allowed'});return false;}
    (async () => {
      const data=await load(),now=Date.now(),today=todayMalaysia(),sessions=data.attendanceSessions||[];
      const classes=occurrencesBetween(sessions.map(s=>({...s,enabled:true})),today,today).filter(o=>!o.testTemplate&&!o.isTest&&!o.testRunId);
      const courses=classes.filter(o=>occurrenceTimestamp(o)<=now&&courseEndTimestamp(o)>now).map(o=>({id:o.id,course:o.course,time:o.time,endTime:o.endTime,state:manualCheckInState({...o,enabled:sessions.find(s=>s.id===o.id)?.enabled},data.attendanceRecords?.[o.key],now)}));
      const boundaries=classes.flatMap(o=>[occurrenceTimestamp(o),courseEndTimestamp(o)]).filter(t=>t>now);
      return {courses,language:(await chrome.storage.local.get('attendanceLanguage')).attendanceLanguage,refreshAfterMs:Math.max(250,Math.min(15000,...boundaries.map(t=>t-now+1)))};
    })().then(sendResponse,error=>sendResponse({error:error.message}));
    return true;
  }
  if (!["MANUAL_CHECK_IN", "SET_CONFIRMATION_TEST_MODE", "OPEN_MANUAL_RESUBMIT", "WHO_AM_I", "START_CHECK", "SAVE_SCHEDULES", "REBUILD_SCHEDULE", "GET_RUN", "GET_ACTIVE_RUN", "REPORT_PHASE", "RESERVE_SUBMISSION", "REPORT_RUN", "REPORT_ATTEMPT", "MARK_SUBMITTED", "RELEASE_SUBMISSION", "NEED_FOREGROUND"].includes(message?.type)) return false;
  serialized(async () => {
    if(message.type==='MANUAL_CHECK_IN') return manualCheckIn(message,sender);
    if(message.type==='NEED_FOREGROUND') return needForeground(message,sender);
    if(message.type==='SET_CONFIRMATION_TEST_MODE') {
      if(!isSettingsSender(sender)) throw Error('测试模式只能从扩展设置页启用。');
      await chrome.storage.local.set({attendanceConfirmationTestMode:message.enabled===true});
      return {ok:true};
    }
    if(message.type==='OPEN_MANUAL_RESUBMIT') return openManualResubmit(message,sender);
    if (message.type === 'WHO_AM_I') return whoAmI(sender);
    if (message.type === 'START_CHECK') return startCheck(message,sender);
    if(message.type==='REPORT_ATTEMPT') {
      validateFormsUrl(sender.url||sender.tab?.url||'');
      if(!Number.isInteger(sender.tab?.id)) throw Error('诊断与当前页面不匹配。');
      const data=await chrome.storage.local.get(['attendanceProfile','attendanceBindings','attendanceSetupSession','attendanceDiagnostics']);
      let course=message.course;
      if(message.setupId) {
        const session=data.attendanceSetupSession,item=session?.items.find(i=>i.id===message.itemId);
        if(session?.id!==message.setupId||item?.tabId!==sender.tab.id) throw Error('诊断与设置检查不匹配。');
        course=item.course;
      }
      const binding=bindingForCourse(data.attendanceBindings,course);
      if(!binding||validateFormsUrl(binding.url).href!==validateFormsUrl(sender.url||sender.tab.url).href) throw Error('诊断与课程表单不匹配。');
      const diagnostic=createDiagnostic({...message.diagnostic,course},data.attendanceProfile);
      const id=message.setupId?`setup:${message.setupId}:${message.itemId}`:/^[a-f0-9-]{36}$/i.test(message.attemptId||'')?`attempt:${sender.tab.id}:${message.attemptId}`:crypto.randomUUID();
      const rows=(data.attendanceDiagnostics||[]).filter(d=>d.id!==id);
      await chrome.storage.local.set({attendanceDiagnostics:[...rows,{...diagnostic,id}].slice(-100)});
      return {ok:true};
    }
    if(message.type==='SAVE_SCHEDULES') {
      if(!isSettingsSender(sender)) throw Error('请从扩展设置页修改课表。');
      const current=await chrome.storage.local.get('attendanceSessions');
      if(!Array.isArray(message.sessions)||message.expectedSessions!==JSON.stringify(current.attendanceSessions||[])) throw Error('课表已变化，请刷新后重试。');
      const update={attendanceSessions:message.sessions.map(toWeeklySession)};
      if(message.draft?.version===1&&Array.isArray(message.draft.rows)) update.attendanceDraft=message.draft;
      await chrome.storage.local.set(update);return {ok:true};
    }
    if (message.type === "REBUILD_SCHEDULE") {
      await processSchedule();
      return { ok: true };
    }
    if (message.type === "GET_ACTIVE_RUN") {
      if (!Number.isInteger(sender.tab?.id)) return null;
      try {
        validateFormsUrl(sender.url || sender.tab.url || "");
      } catch {
        return null;
      }
      const { attendanceRecords: records = {},attendanceConfirmationTestMode } = await chrome.storage.local.get(['attendanceRecords','attendanceConfirmationTestMode']);
      const entry = Object.entries(records).find(([, record]) => record.tabId === sender.tab.id && (record.state === 'launched' || ["pending", "submitted_pending_confirmation"].includes(record.state) && record.submissionAttemptedAt));
      return entry ? { key: entry[0], state: entry[1].state, ...(entry[1].submissionBefore?{submissionBefore:entry[1].submissionBefore}:{}),...(attendanceConfirmationTestMode===true?{confirmationTestMode:true}:{}) } : null;
    }
    if (message.type === "GET_RUN") {
      const data = await load(), record = (data.attendanceRecords || {})[message.key];
      if (!record || record.tabId !== sender.tab?.id || record.state !== "launched" || !currentTask(data.attendanceSessions || [], record)) throw Error("\u4EFB\u52A1\u5DF2\u7ED3\u675F\u3001\u5DF2\u5220\u9664\uFF0C\u6216\u4E0D\u662F\u7531\u5B9A\u65F6\u5668\u542F\u52A8\u3002");
      const now = Date.now(), phase = "reading";
      const durations={...record.phaseDurations};
      if(record.phase&&record.phase!=='reading') durations[record.phase]=(durations[record.phase]||0)+Math.max(0,now-(Date.parse(record.phaseStartedAt)||now));
      data.attendanceRecords[message.key] = { ...record, phase,phaseDurations:durations, phaseStartedAt: record.phase==='reading'?record.phaseStartedAt:new Date(now).toISOString(), phaseDeadline: now + PHASE_TIMEOUTS[phase] };
      await saveRecords(data.attendanceRecords);
      await chrome.alarms.create(`attendance-watch:${message.key}`, { when: now + PHASE_TIMEOUTS[phase] });
      const {attendanceConfirmationTestMode,allowForegroundFallback=true}=await chrome.storage.local.get(['attendanceConfirmationTestMode','allowForegroundFallback']);
      return { occ: record.occ, binding: bindingForCourse(data.attendanceBindings, record.occ.course), profile: data.attendanceProfile, confirmationTestMode:attendanceConfirmationTestMode===true,allowForegroundFallback:allowForegroundFallback!==false };
    }
    if (message.type === "REPORT_PHASE") return reportPhase(message, sender);
    if (message.type === "RESERVE_SUBMISSION") return reserve(message, sender);
    if (message.type === "MARK_SUBMITTED") return markSubmitted(message, sender);
    if (message.type === "RELEASE_SUBMISSION") return releaseSubmission(message, sender);
    return report(message, sender);
  }).then(sendResponse, (error) => sendResponse({ error: error.message }));
  return true;
});
async function handleTabNavigation(tabId, url) {
  if (!isSchoolLoginOrPermissionUrl(url)) return;
  await new Promise((resolve) => setTimeout(resolve, LOGIN_REDIRECT_SETTLE_MS));
  let currentTab;
  try {
    currentTab = await chrome.tabs.get(tabId);
  } catch {
    return;
  }
  if (!isSchoolLoginOrPermissionUrl(currentTab.url || "")) return;
  await serialized(async () => {
    if(await preflight.navigation(tabId)) return;
    const { attendanceRecords: records = {} } = await chrome.storage.local.get("attendanceRecords");
    const entry = Object.entries(records).find(([, record2]) => record2.tabId === tabId && record2.state === "launched");
    if (!entry) return;
    const [key, record] = entry;
    const phaseDurations = { ...record.phaseDurations || {} }, phaseStarted = Date.parse(record.phaseStartedAt || "");
    if (record.phase && Number.isFinite(phaseStarted)) phaseDurations[record.phase] = (phaseDurations[record.phase] || 0) + Math.max(0, Date.now() - phaseStarted);
    records[key] = { ...record, ...transition(record.state, "failed"), phase: "completed", phaseDurations, detail: "\u9700\u8981\u767B\u5F55\u5B66\u6821\u8D26\u53F7\u3002" };
    records[key].error=runError({code:'login_required'},{course:record.occ.course,phase:record.phase});
    await persistTerminal(records, key);
    await notify("\u9700\u8981\u767B\u5F55\u5B66\u6821\u8D26\u53F7", `${record.occ.course}\uFF1A\u8BF7\u5148\u767B\u5F55\u5B66\u6821 Microsoft \u8D26\u53F7\u3002`);
    await resumeScheduledRecovery(key);
  });
}
chrome.tabs.onUpdated?.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab?.url;
  return url ? handleTabNavigation(tabId, url) : void 0;
});
chrome.tabs.onRemoved?.addListener((tabId) => serialized(async () => {
  await preflight.closed(tabId);await setup.closed(tabId);
  const {attendanceRecords:records={}}=await chrome.storage.local.get('attendanceRecords');
  const entry=Object.entries(records).find(([,record])=>record.tabId===tabId&&(record.origin==='manual'||record.foregroundRestore||record.occ?.isTest)&&['launched','pending'].includes(record.state));
  if(entry) {await watchdog(entry[0]);await resumeScheduledRecovery(entry[0]);}
}));

chrome.storage.onChanged?.addListener((changes,area) => {
  if (area==='local' && ['keepAwakeEnabled','attendanceSessions','attendanceRecords'].some(key=>key in changes)) void serialized(()=>syncKeepAwake()).catch(console.error);
});
chrome.permissions?.onRemoved?.addListener(() => void serialized(()=>syncKeepAwake()).catch(console.error));
