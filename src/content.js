import {questionTitle,readQuestions,answersMatch,prepareFill,control} from './fill-only.js';
import {runPreflightPage} from './preflight-page.js';
import {cleanQuestionTitle} from './question-title.js';
import {runError,formatRunError,createDiagnostic} from './diagnostics.js';
import {markDateDiagnostic} from './form-date.js';
import {buildFillPlan,submissionSignals} from './forms.js';
import {todayMalaysia} from './schedule.js';
import {bindingForCourse} from './bindings.js';
import {randomSubmitDelay} from './submit-delay.js';
import {FORMS_LOAD_MS,assertBeforeCourseEnd,VALIDATION_MARGIN_MS,CONFIRMATION_WAIT_MS} from './runtime-timing.js';
import {confirmationPage,successPageSummary} from './submission-confirmation.js';

var pause2 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var items = () => [...document.querySelectorAll('[data-automation-id="questionItem"]')];
var submitButton = () => document.querySelector('[data-automation-id="submitButton"]');
var formTitle = () => document.querySelector('[data-automation-id="formTitle"]')?.textContent?.trim() || "";
function show(message, positive = false) {
  let box = document.getElementById("attendance-helper-status");
  if (!box) {
    box = document.createElement("aside");
    box.id = "attendance-helper-status";
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    box.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:2147483647;max-width:440px;padding:16px 20px;border-radius:12px;box-shadow:0 4px 24px #0003;font:15px/1.6 system-ui;color:white;white-space:pre-line";
    document.body.append(box);
  }
  box.style.background = positive ? "#253745" : "#11212d";
  box.textContent = message;
}
function assertSubmissionSnapshot(plan,binding,occ) {
  const fail=(code,message)=>{throw runError({code,message},{course:occ.course,type:occ.type,phase:'submit'});};
  if(todayMalaysia()!==occ.date) fail('date_mismatch','提交前课程日期与当前日期不一致，停止提交。');
  if(!answersMatch(plan)) fail('answer_mismatch','提交前表单答案已变化，停止提交。');
  if(formTitle()!==binding.title) fail('form_schema_changed','提交前表单标题已变化，停止提交。');
  if(!submitButton()||submitButton().disabled) fail('phase_failed','提交按钮不可用，停止提交。');
}
function watchDryRun(plan, course, onInvalid) {
  const check = () => {
    if (answersMatch(plan)) return;
    clearInterval(timer);
    document.removeEventListener("input", check, true);
    document.removeEventListener("change", check, true);
    const failure=runError({code:'answer_mismatch',message:'表单答案已变化，核对不再通过；未提交。'},{course,phase:'fill'});
    show(formatRunError(failure));
    onInvalid?.(failure);
  };
  const timer = setInterval(check, 1e3);
  document.addEventListener("input", check, true);
  document.addEventListener("change", check, true);
}
async function report(key, state, detail = "", extra = {}) {
  const result = await chrome.runtime.sendMessage({ type: "REPORT_RUN", key, state, detail, ...extra });
  if (result?.error) throw Error(result.error);
}
async function reportPhase(key, phase, diagnostic, submissionBefore) {
  const result = await chrome.runtime.sendMessage({ type: "REPORT_PHASE", key, phase, ...(diagnostic?{diagnostic}:{}),...(submissionBefore?{submissionBefore}:{}) });
  if (result?.error) throw Error(result.error);
}
var safeRunDetail = (value) => String(value || "").replace(/https?:\/\/\S+/gi, "[url]").replace(/\b\d{6,}\b/g, "[redacted]").slice(0, 500);
var diffDescription = (diff) => [
  diff?.added?.length ? `\u65B0\u589E\uFF1A${diff.added.join("\u3001")}` : "",
  diff?.deleted?.length ? `\u5220\u9664\uFF1A${diff.deleted.join("\u3001")}` : "",
  diff?.renamed?.length ? `\u6539\u540D\uFF1A${diff.renamed.map((item) => `${item.from} \u2192 ${item.to}`).join("\u3001")}` : "",
  diff?.options?.length ? `\u9009\u9879\u53D8\u5316\uFF1A${diff.options.map((item) => item.title).join("\u3001")}` : ""
].filter(Boolean).join("\n");
async function run(key, checkCourse, setupId, itemId) {
  let reserved = false;
  let clicked = false;
  let confirmationTestMode = false;
  let allowForegroundFallback = true;
  const attemptId=crypto.randomUUID();
  let occ, binding, profile, phase='validate', phaseStarted=Date.now();
  const phaseDurations={}, questionTitles=[];
  const enterPhase=next=>{phaseDurations[phase]=(phaseDurations[phase]||0)+Math.max(0,Date.now()-phaseStarted);phase=next;phaseStarted=Date.now();};
  window.__dateDiag=[];
  const diagnostic=error=>{
    markDateDiagnostic('content:submitButton',{rectCount:submitButton()?.getClientRects().length||0,visibilityState:document.visibilityState});
    const dateDiag=window.__dateDiag.slice(),dateFillPath=dateDiag.findLast(row=>row.path)?.path;
    return createDiagnostic({occ,state:error?'failed':key?'success':'filled',error,phaseDurations:{...phaseDurations,[phase]:(phaseDurations[phase]||0)+Math.max(0,Date.now()-phaseStarted)},questionTitles,dateDiag,dateFillPath},profile);
  };
  const saveAttempt=error=>chrome.runtime.sendMessage({type:'REPORT_ATTEMPT',attemptId,course:occ?.course||checkCourse,setupId,itemId,diagnostic:diagnostic(error)});
  const setupMessage = async (type, extra = {}) => {
    const result = await chrome.runtime.sendMessage({ type, sessionId: setupId, itemId, ...extra });
    if (result?.error) throw Error(result.error);
    return result;
  };
  try {
    if (setupId) {
      const result = await setupMessage("GET_SETUP_ITEM");
      binding = result.binding;
      profile = result.profile;
      checkCourse = result.course;
      occ = { course: checkCourse, type: result.type, date: todayMalaysia(), time: "\u8BBE\u7F6E\u68C0\u67E5 \xB7 \u4E0D\u63D0\u4EA4" };
    } else if (key) {
      const result = await chrome.runtime.sendMessage({ type: "GET_RUN", key });
      if (result?.error) throw Error(result.error);
      ({ occ, binding, profile } = result);
      confirmationTestMode = result.confirmationTestMode === true;
      allowForegroundFallback = result.allowForegroundFallback !== false;
    } else {
      const data = await chrome.storage.local.get(["attendanceBindings", "attendanceProfile"]);
      binding = bindingForCourse(data.attendanceBindings, checkCourse);
      profile = data.attendanceProfile;
      occ = { course: checkCourse, date: todayMalaysia(), time: "\u4EC5\u586B\u5199\u6D4B\u8BD5" };
    }
    for(const item of items()) questionTitles.push({before:item.querySelector('[data-automation-id="questionTitle"]')?.textContent||'',after:questionTitle(item)});
    if (key) await reportPhase(key,'checking',diagnostic());
    const plan = await prepareFill(binding,occ,profile,{onFill:async()=>{
      if(!key&&!setupId) {
        const authorization=await chrome.runtime.sendMessage({type:'AUTHORIZE_AUTOMATION'});
        if(authorization?.ok!==true) throw Error(authorization?.error||'plugin_license_unavailable');
      }
      enterPhase('fill');
      if(key) await reportPhase(key,'filling');
      show(`${occ.course}\n正在填写并核对资料…`);
    }});
    if (!key) {
      await saveAttempt().catch(()=>{});
      if (setupId) {
        buildFillPlan(readQuestions(), binding.mapping, profile, todayMalaysia(), occ.course, occ.type);
        if (!answersMatch(plan) || todayMalaysia() !== occ.date || formTitle() !== binding.title) throw Error('答案、表单或日期已变化，请重新检查。');
        await setupMessage('REPORT_SETUP_ITEM', {state:'awaiting_confirmation'});
        await setupMessage('CONFIRM_SETUP_ITEM');
        show(`自动核对通过 · ${occ.course}\n未提交，结果已保存到设置页。`,true);
      } else {
        show(`已填写 · 仅填写，未提交\n${occ.course}\n单项预览不计入完整课型检查。`,true);
        watchDryRun(plan,occ.course,async failure=>{await saveAttempt(failure).catch(()=>{});});
      }
      return;
    }
    enterPhase('submit');
    assertBeforeCourseEnd(occ);
    if (todayMalaysia() !== occ.date) throw Error("\u63D0\u4EA4\u524D\u65E5\u671F\u5DF2\u53D8\u5316\uFF0C\u672A\u63D0\u4EA4\u3002");
    if (!answersMatch(plan)) throw Error("\u63D0\u4EA4\u524D\u8868\u5355\u7B54\u6848\u5DF2\u53D8\u5316\uFF0C\u672A\u63D0\u4EA4\u3002");
    if (!submitButton() || submitButton().disabled) throw Error("\u8868\u5355\u65E0\u6CD5\u63D0\u4EA4\u3002");
    const submitDelay = randomSubmitDelay();
    assertBeforeCourseEnd(occ, submitDelay + VALIDATION_MARGIN_MS);
    await reportPhase(key, 'submitting');
    show(`${occ.course}\n资料与日期核对通过，将在 ${Math.round(submitDelay / 1000)} 秒后提交…`);
    await pause2(submitDelay);
    assertBeforeCourseEnd(occ);
    const reservation = await chrome.runtime.sendMessage({ type: "RESERVE_SUBMISSION", key });
    if (reservation?.error) throw Error(reservation.error);
    if (!reservation?.granted) {
      if (reservation?.reason === 'course_ended') {
        show(`${occ.course}\n课程已结束，未提交。`);
        return;
      }
      show(`${occ.course}
\u6B64\u65F6\u6BB5\u5DF2\u7ECF\u5C1D\u8BD5\u63D0\u4EA4\u8FC7\uFF0C\u4E3A\u907F\u514D\u91CD\u590D\u6253\u5361\u4E0D\u4F1A\u518D\u6B21\u70B9\u51FB\u63D0\u4EA4\u3002`);
      return;
    }
    reserved = true;
    assertBeforeCourseEnd(occ);
    buildFillPlan(readQuestions(), binding.mapping, profile, occ.date, occ.course, occ.type);
    assertSubmissionSnapshot(plan,binding,occ);
    assertSubmissionSnapshot(plan,binding,occ);
    const before = { questionCount: items().length, submitVisible: Boolean(submitButton()) };
    await reportPhase(key, "confirming", undefined, before);
    show(`${occ.course}
\u8D44\u6599\u4E0E\u65E5\u671F\u6838\u5BF9\u901A\u8FC7\uFF0C\u6B63\u5728\u63D0\u4EA4\u2026`);
    // No await between the last wall-clock guard and the only click.
    assertBeforeCourseEnd(occ);
    submitButton().click();
    clicked = true;
    let structureSeen = false;
    const confirmationDeadline = Date.now() + CONFIRMATION_WAIT_MS;
    for (let i = 0; i < 60 && Date.now() < confirmationDeadline; i++) {
      await pause2(500);
      const outcome = submissionSignals(before, confirmationPage(document), { structureSelectorsEnabled: true });
      structureSeen = structureSeen || outcome.signal === "structure_change";
      if (outcome.state === 'failed') {
        const failure=runError({code:'submission_error',message:outcome.signal},{course:occ.course,type:occ.type,phase:'submit'});
        await report(key,'failed',formatRunError(failure),{error:failure,diagnostic:diagnostic(failure)});
        show(formatRunError(failure));
        return;
      }
      if (outcome.state === "success") {
        await report(key, "success", outcome.signal,{diagnostic:{...diagnostic(),...(confirmationTestMode?{successPage:createDiagnostic({successPage:successPageSummary(document)},profile).successPage}:{})}});
        show(`\u6253\u5361\u6210\u529F
${occ.course}`, true);
        return;
      }
    }
    const failure=runError({code:'submit_unconfirmed'},{course:occ.course,type:occ.type,phase});
    await report(key, "submitted_pending_confirmation", structureSeen ? "structure_change" : "none",{error:failure,diagnostic:diagnostic(failure)});
    show(formatRunError(failure));
  } catch (error) {
    const failure=runError(error,{course:occ?.course||checkCourse,type:occ?.type,phase});
    show(formatRunError(failure));
    if(key&&error.code==='date_fill_hidden_tab'&&!reserved&&!clicked) {
      const message={key,state:'failed',submissionNotClicked:true,error:failure,detail:formatRunError(failure),diagnostic:diagnostic(failure)};
      if(allowForegroundFallback) await chrome.runtime.sendMessage({type:'NEED_FOREGROUND',...message});
      else await report(key,'failed',message.detail,message);
      return;
    }
    if (!key) await saveAttempt(failure).catch(()=>{});
    if (setupId) await setupMessage("REPORT_SETUP_ITEM", { state: "failed", detail: formatRunError(failure),error:failure }).catch(() => {
    });
    if (key) try {
      const missed = ['course_ended','schedule_week_inactive'].includes(error.code) && !clicked;
      await report(key, missed ? 'missed' : reserved ? "submitted_pending_confirmation" : "failed", formatRunError(failure), {error:failure,diagnostic:diagnostic(failure),...(missed?{submissionNotClicked:true}:{})});
    } catch {
    }
  }
}
async function resumeConfirmation(active) {
  const deadline=Date.now()+CONFIRMATION_WAIT_MS;
  do {
    const outcome=submissionSignals(active.submissionBefore || {},confirmationPage(document),{structureSelectorsEnabled:true});
    if(outcome.state==='success') {
      await report(active.key,'success',outcome.signal,{diagnostic:active.confirmationTestMode?{successPage:successPageSummary(document)}:{}});
      show('打卡成功\nMicrosoft Forms 已确认提交成功',true);
      return;
    }
    if(outcome.state==='failed') {
      const failure=runError({code:'submission_error'},{phase:'submit'});
      if(active.state==='pending') await report(active.key,'failed',outcome.signal,{error:failure});
      show(formatRunError(failure));return;
    }
    await pause2(500);
  } while(Date.now()<deadline);
  if(active.state==='pending') await report(active.key,'submitted_pending_confirmation','none',{error:runError({code:'submit_unconfirmed'},{phase:'submit'})});
  show('已尝试提交，尚未确认记录。请在设置页手动核查；系统不会自动重新提交。');
}
if (!globalThis.__attendanceContentLoaded) {
  globalThis.__attendanceContentLoaded = true;
  (async () => {
    const preflightKey=new URLSearchParams(location.hash.slice(1)).get('attendancePreflight');
    if(preflightKey) {history.replaceState(null,'',location.pathname+location.search);await runPreflightPage(preflightKey);return;}
    const identity = await chrome.runtime.sendMessage({type:'WHO_AM_I'}).catch(() => null);
    if(identity?.kind==='preflight') {await runPreflightPage(identity.key);return;}
    let key, checkCourse, setupId, itemId;
    if (identity?.kind === 'run') key = identity.key;
    else if (identity?.kind === 'check') checkCourse = identity.course;
    else if (identity?.kind === 'setup') ({setupId,itemId} = identity);
    else {
      const hash = new URLSearchParams(location.hash.slice(1));
      key = hash.get('attendanceRun');
      checkCourse = hash.get('attendanceCheck');
      setupId = hash.get('attendanceSetup');
      itemId = hash.get('attendanceItem');
    }
    if (key || checkCourse || setupId) history.replaceState(null, "", location.pathname + location.search);
    if (!key && !checkCourse && !setupId) {
      const active = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_RUN" });
      if (active?.key && ['pending','submitted_pending_confirmation'].includes(active.state)) {
        await resumeConfirmation(active);
        return;
      }
      // Idle pages must allow a later watchdog injection to discover a task.
      globalThis.__attendanceContentLoaded = false;
    }
    // Report script liveness before waiting for cold Forms to render its button.
    if (key) {
      try {await reportPhase(key, 'reading');}
      catch (error) {show(error.message);return;}
    }
    const readyDeadline = Date.now() + FORMS_LOAD_MS;
    for (let i = 0; i < 120 && !submitButton() && Date.now() < readyDeadline; i++) await pause2(500);
    if (!submitButton()) {
      if (key || setupId) await run(key, null, setupId, itemId);
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: "FORM_READY", url: location.href, title: formTitle(), questions: readQuestions() }).catch(() => {
      });
    } catch (error) {
      chrome.runtime.sendMessage({ type: "FORM_SETUP_ERROR", error: error.message }).catch(() => {
      });
    }
    if (key || checkCourse || setupId) await run(setupId ? null : key, checkCourse, setupId, itemId);
  })();
}
