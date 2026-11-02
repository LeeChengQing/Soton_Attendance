import {resolveCourseKind,courseKindWarning,unknownCourseKind} from './course-kind.js';
import {runError,formatRunError,diagnosticText,createDiagnostic} from './diagnostics.js';
import QRCode from 'qrcode';
import {buildVariants} from './setup.js';
import {saveDraftTasks,validateSession,nextTrigger} from './configuration.js';
import {createBackup,recoveryForRecord} from './backup.js';
import {bindingForCourse,resolveFillPlan} from './bindings.js';
import {todayMalaysia,occurrencesBetween,occurrenceTimestamp} from './schedule.js';
import {manualCheckInState} from './state.js';
import {validateFormsUrl} from './forms.js';
import {sameProfile} from './profile.js';
import {t,currentLanguage,localizeMessage} from './options-locale.js';
import {scheduleWeekStart,scheduleWeekStatus} from './runtime-timing.js';

export function prepareWeekImport(existing,incoming,weekStartDate,decision,now=Date.now()) {
  if(![scheduleWeekStart(now),scheduleWeekStart(now,1)].includes(weekStartDate)) throw Error('课表周已过期或无效，请明确选择本周或下周。');
  const sameWeek=existing.filter(s=>s.weekStartDate===weekStartDate),other=existing.filter(s=>s.weekStartDate!==weekStartDate);
  if(sameWeek.length&&!['merge','replace'].includes(decision)) throw Error('同周已有课表，请明确选择合并 merge 或替换 replace。');
  const rows=incoming.map(row=>validateSession({...row,weekStartDate,enabled:true})),base=decision==='replace'?[]:sameWeek;
  const keys=new Map();
  for(const row of [...base,...rows]) {
    const key=[row.course.trim().toLowerCase(),row.weekday,row.time].join('|'),previous=keys.get(key);
    if(previous&&(previous.endTime!==row.endTime||(previous.type||'')!==(row.type||''))) throw Error('同一课程时段存在冲突，请先修改课表。');
    keys.set(key,row);
  }
  return [...other,...saveDraftTasks(base,rows,new Date(now).toISOString())];
}



var $ = (id) => document.getElementById(id);
var node = (tag, text = "", className = "") => {
  const n = document.createElement(tag);
  n.textContent = text;
  n.className = className;
  return n;
};
var button = (text, fn) => {
  const b = node("button", text, "secondary");
  b.type = "button";
  b.addEventListener("click", fn);
  return b;
};
var malaysia = (when) => new Intl.DateTimeFormat(currentLanguage() === "en" ? "en-MY" : "zh-CN", { timeZone: "Asia/Kuala_Lumpur", dateStyle: "medium", timeStyle: "short" }).format(new Date(when));
function download(name, value) {
  const href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1e3);
}
async function message(type, extra = {}) {
  const r = await chrome.runtime.sendMessage({ type, ...extra });
  if (r?.error) throw Error(r.error);
  return r;
}
async function saveSessions(data,sessions,draft) {
  return message('SAVE_SCHEDULES',{sessions,expectedSessions:JSON.stringify(data.attendanceSessions||[]),...(draft?{draft}:{})});
}
function createOptionsUpgrade(api) {
  let ready = false, writes = Promise.resolve(), renderId = 0, page = 0, draftRevision = 0, draftWeek = null;
  let todayTimer,disposed=false;
  const todaySection=node('section');todaySection.id='today-classes';$('sessions').before(todaySection);
  const weekLabel=node('label','课表周 / Timetable week '),weekSelect=node('select'),decision=node('select');
  weekSelect.id='schedule-import-week';decision.id='schedule-import-decision';
  for(const [value,text] of [['','同周重复：请选择 / Choose'],['merge','合并 / Merge'],['replace','替换本周课表 / Replace selected week']]) {const option=node('option',text);option.value=value;decision.append(option);}
  weekLabel.append(weekSelect,decision);$('review-draft').closest('label').before(weekLabel);
  weekSelect.addEventListener('change',()=>{draftWeek=weekSelect.value;decision.value='';draftChanged();});
  decision.addEventListener('change',()=>draftChanged());
  const guard = (fn) => async () => {
    try {
      await fn();
    } catch (e) {
      api.toast(localizeMessage(e.message), true);
    }
  };
  function draftChanged() {
    if (!ready) return;
    if(!api.preview.length) draftWeek=null;
    else if(draftWeek===null) draftWeek=scheduleWeekStart();
    draftRevision++;
    $("review-draft").checked = false;
    const rows = structuredClone(api.preview);
    writes = writes.catch(() => {
    }).then(() => chrome.storage.local.set({ attendanceDraft: { version: 1, rows, weekStartDate:draftWeek, reviewedAt: null } })).catch((e) => api.toast(t("savingDraftFailed", { error: localizeMessage(e.message) }), true));
    $("draft-status").textContent = t("draftSavedNeedsReview");
    void writes.then(render);
  }
  function renderStatus(data) {
    const setup = data.attendanceSetupSession, running = setup?.state === 'running';
    $('start-setup').disabled = running;
    $('cancel-setup').hidden = !running;
    $('setup-status').textContent = setup ? `${{running:'检查中',completed:'检查完成',cancelled:'已取消'}[setup.state]} · ${setup.items.filter(item => item.state === 'passed').length}/${setup.items.length}` : '尚未进行课型检查';
    const p = data.attendanceProfile || {};
    $("profile-summary").textContent = p.student && p.name ? t("profileSavedSummary") : t("profileSummaryEmpty");
    const q = data.attendanceCloudOutbox || {}, errors = (q.items || []).filter((i) => i.lastError);
    $("cloud-queue-status").textContent = `${t("queueStatus", { count: q.items?.length || 0 })}${errors.length ? t("queueError", { error: errors[0].lastError }) : q.lastSuccessAt ? t("queueSent", { date: malaysia(q.lastSuccessAt) }) : ""}`;
  }
  async function coverage(session, data) {
    try {
      resolveFillPlan(bindingForCourse(data.attendanceBindings, session.course), session, data.attendanceProfile, todayMalaysia());
      return true;
    } catch {
      return false;
    }
  }
  async function renderSessions(data) {
    const list = $("sessions");
    list.replaceChildren();
    const sessions = data.attendanceSessions || [];
    if (!sessions.length) list.append(node("p", t("noTasks"), "muted"));
    for (const s of sessions) {
      const row = node("div", "", "saved-task"), head = node("div", "", "list-item"), label = node("div");
      const covered = await coverage(s, data), next = nextTrigger(s, data.attendanceRecords);
      const weekday = currentLanguage() === "en" ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][s.weekday] : ["\u5468\u65E5", "\u5468\u4E00", "\u5468\u4E8C", "\u5468\u4E09", "\u5468\u56DB", "\u5468\u4E94", "\u5468\u516D"][s.weekday];
      const state = s.enabled === false ? t("paused") : next ? t("nextRun", { date: malaysia(next.when) }) : t("noNextRun");
      const check = covered ? t("checksComplete") : t("checksIncomplete");
      label.append(node("strong", s.course), node("small", t("sessionSummary", { weekday, start: s.time, end: s.endTime, state, check })));
      const weekState=scheduleWeekStatus(s);
      label.append(node('small',`${s.weekStartDate||'未分配周 / Unassigned week'} · ${weekState}`));
      const pause = button(s.enabled === false ? t("enable") : t("pause"), guard(async () => {
        const current = await api.getData(), task = current.attendanceSessions.find((t2) => t2.id === s.id);
        if (!task) throw Error(t("noSuchTask"));
        if(task.enabled===false&&!['active','upcoming'].includes(scheduleWeekStatus(task))) throw Error('课表周已过期或未分配，请先明确分配周。');
        if (task.enabled === false && !resolveCourseKind(task)) throw unknownCourseKind(task);
        if (task.enabled === false && !await coverage(task, current)) throw Error(t("checkBeforeEnable"));
        await saveSessions(current,current.attendanceSessions.map((t2) => t2.id === s.id ? { ...t2, enabled: t2.enabled === false, createdAt: (/* @__PURE__ */ new Date()).toISOString() } : t2));
        await api.rebuild();
        await render();
      }));
      const remove = button(t("delete"), guard(async () => {
        const current = await api.getData();
        await saveSessions(current,current.attendanceSessions.filter((t2) => t2.id !== s.id));
        await api.rebuild();
        await render();
        await api.renderBindings();
      }));
      head.append(label, pause, remove);
      if(['needs_week_assignment','expired'].includes(weekState)) for(const [offset,text] of [[0,'分配本周 / Assign current week'],[1,'分配下周 / Assign next week']]) head.append(button(text,guard(async()=>{
        const current=await api.getData(),task=current.attendanceSessions.find(row=>row.id===s.id);
        if(!task) throw Error(t('noSuchTask'));
        const assigned=validateSession({...task,weekStartDate:scheduleWeekStart(Date.now(),offset),enabled:true});
        if(current.attendanceSessions.some(row=>row.id!==s.id&&row.weekStartDate===assigned.weekStartDate&&row.course.trim().toLowerCase()===assigned.course.trim().toLowerCase()&&row.weekday===assigned.weekday&&row.time===assigned.time)) throw Error('同周课程时段重复，请先处理合并或替换。');
        assigned.enabled=await coverage(assigned,current);
        await saveSessions(current,current.attendanceSessions.map(row=>row.id===s.id?assigned:row));await api.rebuild();await render();
      })));
      row.append(head);
      if (!resolveCourseKind(s)) row.append(node("p", courseKindWarning(s), "course-kind-warning"));
      const details = document.createElement("details");
      details.append(node("summary", t("editSession")));
      const form = node("form", "", "session-editor"), inputs = {};
      for (const [key, title, type, value] of [["course", t("fieldCourse"), "text", s.course], ["type", "课型（LEC/TUT/LAB）", "text", s.type || ""], ["weekday", t("fieldWeekday"), "select", String(s.weekday)], ["time", t("fieldStartTime"), "time", s.time], ["endTime", t("fieldEndTime"), "time", s.endTime], ["exceptions", t("fieldExceptionsShort"), "text", (s.exceptions || []).join(", ")]]) {
        const label2 = node("label", title, "session-field"), input = document.createElement(type === "select" ? "select" : "input");
        if (type === "select") for (let n = 0; n < 7; n++) {
          const option = node("option", currentLanguage() === "en" ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][n] : `\u5468${"\u65E5\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D"[n]}`);
          option.value = String(n);
          input.append(option);
        }
        else input.type = type;
        input.value = value;
        inputs[key] = input;
        label2.append(input);
        form.append(label2);
      }
      const save = node("button", t("saveChanges"));
      save.type = "submit";
      form.append(save);
      details.append(form);
      row.append(details);
      list.append(row);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void guard(async () => {
          const current = await api.getData(), task = current.attendanceSessions.find((t2) => t2.id === s.id);
          if (!task) throw Error(t("noSuchTask"));
          const changed = validateSession({ ...task, course: inputs.course.value, type: inputs.type.value, weekday: Number(inputs.weekday.value), time: inputs.time.value, endTime: inputs.endTime.value, exceptions: inputs.exceptions.value.split(/[,，\s]+/).filter(Boolean) });
          const covered2 = await coverage(changed, current);
          const duplicate = current.attendanceSessions.some((t2) => t2.id !== s.id && t2.weekStartDate===changed.weekStartDate && t2.course.toLowerCase() === changed.course.toLowerCase() && t2.weekday === changed.weekday && t2.time === changed.time && t2.endTime === changed.endTime);
          if (duplicate) throw Error(t("duplicateTask"));
          await saveSessions(current,current.attendanceSessions.map((t2) => t2.id === s.id ? { ...changed, enabled: task.enabled !== false && covered2 && ['active','upcoming'].includes(scheduleWeekStatus(changed)), createdAt: (/* @__PURE__ */ new Date()).toISOString() } : t2));
          await api.rebuild();
          await render();
          await api.renderBindings();
          api.toast(covered2 ? t("taskSavedRemovedTrigger") : t("savedPausedForReview"));
        })();
      });
    }
  }
  function renderToday(data) {
    clearTimeout(todayTimer);
    const now=Date.now(),today=todayMalaysia(),sessions=data.attendanceSessions||[];
    const classes=occurrencesBetween(sessions.map(s=>({...s,enabled:true})),today,today).filter(o=>!o.testTemplate&&!o.isTest&&!o.testRunId).sort((a,b)=>a.time.localeCompare(b.time)||a.course.localeCompare(b.course)||String(a.id).localeCompare(String(b.id)));
    todaySection.replaceChildren(node('h3',"今日课程 / Today's Classes"));
    for(const occ of classes) {
      const record=data.attendanceRecords?.[occ.key],saved=sessions.find(s=>s.id===occ.id),state=manualCheckInState({...occ,enabled:saved?.enabled},record,now);
      const states={ready:'可打卡 / Ready',not_started:'未开始 / Not started',ended:'已结束 / Ended',paused:'已暂停 / Paused',inactive_week:'课表已过期 / Expired',attempted:'已尝试提交，禁止自动重试 / Attempt locked',scheduled:'等待定时打卡 / Scheduled',launched:'正在打卡 / In progress',pending:'正在提交 / Submitting',success:'打卡成功 / Success',success_manual:'已手动确认 / Confirmed',unknown:'结果不明，禁止自动重试 / Unknown',submitted_pending_confirmation:'已提交，待确认 / Pending confirmation'};
      const row=node('div','','list-item'),label=node('div');row.dataset.sessionId=occ.id;
      const manualFailed=record?.state==='scheduled'&&record.attemptHistory?.at(-1)?.origin==='manual'&&record.attemptHistory.at(-1).state==='failed';
      label.append(node('strong',occ.course),node('small',`${occ.time}–${occ.endTime} · ${states[state]||state}`));
      if(manualFailed) label.append(node('small','手动打卡未提交；定时机会保留 / Manual attempt failed before submission; schedule preserved'));
      const action=button('立即打卡 / Check In Now',async()=>{
        action.disabled=true;
        try {await message('MANUAL_CHECK_IN',{sessionId:occ.id});}
        catch(error) {api.toast(localizeMessage(error.message),true);}
        finally {await render();}
      });
      action.disabled=state!=='ready';row.append(label,action);todaySection.append(row);
    }
    if(!classes.length) todaySection.append(node('p','今日没有有效课程 / No classes today','muted'));
    const nextBoundary=Math.min(Date.parse(`${today}T00:00:00+08:00`)+86400000,...classes.flatMap(o=>[occurrenceTimestamp(o),Date.parse(`${o.date}T${o.endTime}:00+08:00`)]).filter(t=>Number.isFinite(t)&&t>now));
    if(!disposed) todayTimer=setTimeout(()=>void render(),Math.max(1,Math.min(60000,nextBoundary-now+1)));
  }
  window.addEventListener('focus',()=>{if(!disposed) void render();});
  window.addEventListener('pagehide',()=>{disposed=true;clearTimeout(todayTimer);});
  window.addEventListener('pageshow',()=>{disposed=false;void render();});
  async function renderRecords(data) {
    const records=Object.values(data.attendanceRecords||{}).map(r=>{
      if(!['failed','missed','missed_sleep','unknown','submitted_pending_confirmation'].includes(r.state)) return r;
      const error=r.error||runError(['unknown','submitted_pending_confirmation'].includes(r.state)?{code:'submit_unconfirmed',message:r.detail}:r.detail,{course:r.occ?.course,phase:r.failurePhase||r.phase});
      return {...r,error:createDiagnostic({...r,error},data.attendanceProfile).error};
    }), ids=new Set(records.map(r=>r.diagnosticId));
    const attempts=(data.attendanceDiagnostics||[]).filter(d=>!ids.has(d.id)).map(d=>({...d,attempt:true,occ:{course:d.course},detail:d.error?formatRunError(d.error):'填写检查通过，未提交。'}));
    const all = [...records,...attempts].sort((a, b) => String(b.at).localeCompare(String(a.at))), filter = $("record-filter").value;
    $("record-count").textContent = all[0]?.error?`最近一次尝试：${formatRunError(all[0].error)}`:t("recordCount", { count: all.length });
    const rows = all.filter((r) => filter === "all" || r.state === filter || filter === "success" && r.state === "success_manual" || filter === 'unknown' && r.state === 'submitted_pending_confirmation'), pages = Math.max(1, Math.ceil(rows.length / 40));
    page = Math.min(page, pages - 1);
    const list = $("records");
    list.replaceChildren();
    for (const r of rows.slice(page * 40, page * 40 + 40)) {
      const item = node("div", "", "list-item"), label = node("div"), recovery = recoveryForRecord(r);
      const recoveryKey = recovery.action === "binding" ? "recoveryBinding" : recovery.action === "diagnostic" ? "recoveryDiagnostic" : recovery.action === "login" ? "recoveryLogin" : r.state === "missed" || r.state === "missed_sleep" ? "recoveryMissed" : ["success","success_manual"].includes(r.state) ? "recoverySuccess" : r.state === "submitted_pending_confirmation" ? "recoverySubmittedPending" : "recoveryView";
      const recordState = { filled:'仅填写检查通过，未提交',success_manual:'已由用户在 Forms 确认已记录',success: t("recordSuccess"), unknown: t("recordUnknown"), submitted_pending_confirmation: t("recordSubmittedPending"), failed: t("recordFailed"), missed: t("recordMissed"), missed_sleep: t("recordMissedSleep"), launched: t("recordLaunched"), pending: t("recordPending") }[r.state] || r.state;
      label.append(node("strong", r.occ?.course || t("lessonFallback")), node("small", `${r.occ?.date || ""} ${r.occ?.time || ""} \xB7 ${recordState}`), node("small", r.error?formatRunError(r.error):localizeMessage(r.detail || r.at || "")), node("small", t(`${recoveryKey}Description`)));
      if(r.attemptHistory?.length) label.append(node('small',r.attemptHistory.map(a=>`${a.origin==='manual'?'手动 / Manual':'定时 / Scheduled'} · ${a.state} · ${a.startedAt}`).join(' → ')));
      const openOriginal = guard(async () => {
        if(recovery.action==='diagnostic') {
          await navigator.clipboard.writeText(JSON.stringify(createDiagnostic(r,data.attendanceProfile),null,2));
          api.toast(t('diagnosticsCopied'));return;
        }
        if (recovery.action === "binding") {
          document.getElementById("binding-heading").scrollIntoView();
          return;
        }
        if (r.tabId) try {
          await chrome.tabs.update(r.tabId, { active: true });
          return;
        } catch {
        }
        const binding = bindingForCourse(data.attendanceBindings, r.occ?.course), url = r.formUrl || binding?.url;
        if (!url) throw Error(t("noOriginalForm"));
        await chrome.tabs.create({ url: validateFormsUrl(url).href, active: true });
      });
      const actions = [];
      if (!r.attempt && ["unknown", "submitted_pending_confirmation"].includes(r.state)) {
        actions.push(button('我已在 Forms 里确认已记录', guard(async () => {
          await message("MARK_SUBMITTED", { key: r.occ.key });
          await render();
        })));
        actions.push(button('我要手动重新提交', guard(async () => {
          if (!confirm('这是你主动选择的手动操作，不是自动重试。重新提交可能产生重复记录；请先在 Forms 核查。继续打开表单？')) return;
          await message('OPEN_MANUAL_RESUBMIT', { key: r.occ.key });
          api.toast('已打开表单。这是用户主动操作，不是自动重试；请手动填写和提交。');
          await render();
        })));
      }
      actions.push(button(t(recoveryKey), openOriginal));
      const testBinding=bindingForCourse(data.attendanceBindings,r.occ?.course);
      if(testBinding?.isTest===true && ['failed','missed','missed_sleep'].includes(r.state)) actions.push(button(t('retryTest'),guard(async()=>{
        await message('RUN_TEST_NOW',{bindingId:Object.keys(data.attendanceBindings).find(key=>data.attendanceBindings[key]===testBinding)});
        await render();
      })));
      item.append(label, ...actions);
      list.append(item);
    }
    if (!rows.length) list.append(node("p", all[0]?.error?`最近一次尝试：${formatRunError(all[0].error)}`:filter === "all" ? t("noRecords") : t("noFilteredRecords"), "muted"));
    $("records-page").textContent = !rows.length&&all[0]?.error?'当前筛选无匹配结果；最近一次尝试见上方。':t("recordsPage", { page: page + 1, pages, count: rows.length });
    $("records-prev").disabled = page === 0;
    $("records-next").disabled = page + 1 === pages;
  }
  async function render() {
    const id = ++renderId, data = await api.getData();
    if (id !== renderId) return;
    weekSelect.replaceChildren();
    for(const week of [...new Set([scheduleWeekStart(),scheduleWeekStart(Date.now(),1),...(draftWeek?[draftWeek]:[])])]) {const option=node('option',week);option.value=week;weekSelect.append(option);}
    if(draftWeek==='') {const option=node('option','旧草稿：请明确选择周 / Assign legacy draft week');option.value='';weekSelect.prepend(option);}
    weekSelect.value=draftWeek??scheduleWeekStart();
    renderStatus(data);
    renderToday(data);
    await renderSessions(data);
    await renderRecords(data);
  }
  async function activateDraft() {
    await writes;
    const revision = draftRevision;
    const data = await api.getData();
    if (!api.preview.length) throw Error(t("noPreviewToActivate"));
    if (api.preview.some((row) => row.type === "LAB" && !["1", "2", "3", "skip"].includes(row.importChoice))) throw Error("\u8BF7\u5148\u4E3A\u6BCF\u6761 LAB \u8BB0\u5F55\u9009\u62E9 Group 1\u3001Group 2\u3001Group 3 \u6216\u4E0D\u52A0\u5165\u3002");
    if (revision !== draftRevision || !$("review-draft").checked) throw Error(t("draftChangedReview"));
    if (!data.attendanceDraft?.reviewedAt) throw Error(t("reviewBeforeEnable"));
    const p = api.validateProfile(data.attendanceProfile || {});
    if (!sameProfile(p, api.profile())) throw Error(t("saveProfileFirst"));
    const selected = structuredClone(api.preview).filter((row) => row.importChoice !== "skip").map((row) => {
      if (row.type === "LAB" && ["1", "2", "3"].includes(row.importChoice)) {
        row.group = row.importChoice;
        row.course = `${row.code || row.course.split(/\s+-/)[0]}-${row.type} Group ${row.group}`;
      }
      return row;
    });
    const blocked = selected.filter(row => !resolveCourseKind(row));
    const eligible = selected.filter(row => resolveCourseKind(row));
    const warning = blocked.map(row => `${courseKindWarning(row)}（星期 ${row.weekday} ${row.time}）`).join("；");
    if (!eligible.length) throw Error(warning);
    buildVariants(eligible, data.attendanceBindings, p);
    const rows = eligible.map(validateSession);
    const sessions = prepareWeekImport(data.attendanceSessions || [], rows, draftWeek, decision.value);
    const commit = writes.then(async () => {
      if (revision !== draftRevision) throw Error(t("draftChangedReview"));
      await saveSessions(data,sessions,{ version: 1, rows: blocked, weekStartDate:draftWeek, reviewedAt: null });
      if (revision !== draftRevision) return false;
      api.preview.length = 0;
      api.preview.push(...blocked);
      if(!blocked.length) draftWeek=null;
      decision.value='';
      ready = false;
      api.renderPreview();
      ready = true;
      $("review-draft").checked = false;
      $("draft-status").textContent = t("taskEnabledDraft");
      return true;
    });
    writes = commit.catch(() => {
    });
    const cleared = await commit;
    await api.rebuild();
    await render();
    await api.renderBindings();
    api.toast(warning ? `${t("enabledWeeklyTasks")}。未启用：${warning}` : cleared ? t("enabledWeeklyTasks") : t("enabledReviewedDraft"));
  }
  $("review-draft").addEventListener("change", guard(async () => {
    const rows = structuredClone(api.preview), checked = $("review-draft").checked, revision = draftRevision;
    writes = writes.catch(() => {
    }).then(() => revision === draftRevision ? chrome.storage.local.set({ attendanceDraft: { version: 1, rows, weekStartDate:draftWeek, reviewedAt: checked ? (/* @__PURE__ */ new Date()).toISOString() : null } }) : void 0);
    await writes;
    if (revision === draftRevision) $("draft-status").textContent = checked ? t("draftReadyToRun") : t("draftUnreviewed");
  }));
  $("verify-all-bindings").addEventListener("click", guard(() => api.openAllBindings()));
  $('start-setup').addEventListener('click', guard(async () => {await writes;await message('START_SETUP');await render();}));
  $('cancel-setup').addEventListener('click', guard(async () => {await message('CANCEL_SETUP');await render();}));
  $("record-filter").addEventListener("change", () => {
    page = 0;
    void render();
  });
  $("records-prev").addEventListener("click", () => {
    page = Math.max(0, page - 1);
    void render();
  });
  $("records-next").addEventListener("click", () => {
    page++;
    void render();
  });
  $("export-records").addEventListener("click", guard(async () => download("Attendance-terminal-records.json", createBackup(await api.getData()).records)));
  $('copy-diagnostics')?.addEventListener('click',guard(async()=>{
    const data=await api.getData();
    await navigator.clipboard.writeText(diagnosticText(data));
    api.toast('诊断信息已复制（已脱敏）。');
  }));
  if($('copy-diagnostics')) {
    const label=node('label','测试模式：记录成功页脱敏 DOM（仅用于测试表单）');
    const toggle=document.createElement('input');toggle.type='checkbox';toggle.id='confirmation-test-mode';
    void chrome.storage.local.get(['attendanceConfirmationTestMode']).then(data=>{toggle.checked=data.attendanceConfirmationTestMode===true;});
    toggle.addEventListener('change',guard(async()=>{await message('SET_CONFIRMATION_TEST_MODE',{enabled:toggle.checked});}));
    label.prepend(toggle);$('copy-diagnostics').after(label);
  }
  $("retry-cloud").addEventListener("click", guard(async () => {
    await message("RETRY_CLOUD");
    const r = await message("CLOUD_REQUEST", { action: "device" });
    $("cloud-status").textContent = r.attendanceCloudDeviceId ? t("connectionRestored") : t("waitingConnection");
    if (r.attendanceNtfyTopic) $("ntfy-status").textContent = `${t("phoneTopicReady")} https://ntfy.sh/${r.attendanceNtfyTopic}`;
    await render();
  }));
  async function topic() {
    const { attendanceNtfyTopic: topicName } = await api.getData();
    if (!/^soton-attendance-[a-f0-9]{40}$/.test(topicName || "")) throw Error(t("topicNotReady"));
    return `https://ntfy.sh/${topicName}`;
  }
  $("copy-topic").addEventListener("click", guard(async () => {
    await navigator.clipboard.writeText(await topic());
    api.toast(t("copiedTopic"));
  }));
  const qrButton = $("show-topic-qr"), qrPanel = $("topic-qr-panel"), qrCanvas = $("topic-qr");
  async function renderTopicQr(platform) {
    const webTopic = await topic(), topicName = webTopic.slice("https://ntfy.sh/".length);
    const target = platform === "android" ? `ntfy://ntfy.sh/${topicName}?display=Soton%20Attendance` : webTopic;
    await QRCode.toCanvas(qrCanvas, target, { width: 220, margin: 2 });
    qrCanvas.hidden = false;
    $("topic-qr-android").setAttribute("aria-pressed", String(platform === "android"));
    $("topic-qr-ios").setAttribute("aria-pressed", String(platform === "ios"));
    $("topic-qr-help").textContent = platform === "android" ? t("qrAndroidHelp") : t("qrIosHelp", { topic: topicName });
  }
  qrButton.addEventListener("click", guard(async () => {
    const opening = qrPanel.hidden;
    qrPanel.hidden = !opening;
    qrButton.setAttribute("aria-expanded", String(opening));
    if (opening) await renderTopicQr("android");
  }));
  $("topic-qr-android").addEventListener("click", guard(() => renderTopicQr("android")));
  $("topic-qr-ios").addEventListener("click", guard(() => renderTopicQr("ios")));
  function refreshLocale() {
    if (qrPanel.hidden || qrCanvas.hidden) return;
    void guard(() => renderTopicQr($("topic-qr-ios").getAttribute("aria-pressed") === "true" ? "ios" : "android"))();
  }
  $("refresh-delivery").addEventListener("click", guard(async () => {
    const result = await message("CLOUD_REQUEST", { action: "notifications" }), root = $("phone-notifications");
    root.replaceChildren();
    const rows = result.notifications || [];
    $("delivery-status").textContent = rows.length ? t("deliveryRecorded") : t("deliveryEmpty");
    for (const n of rows.slice(0, 10)) {
      const row = node("div", "", "list-item"), status = n.phone_receipt_confirmed_at ? t("receiptConfirmed") : { queued: t("deliveryQueued"), sending: t("deliverySending"), accepted: t("deliveryAccepted"), uncertain: t("deliveryUncertain"), discarded: t("deliveryDiscarded") }[n.delivery_state] || t("deliveryUnknown");
      row.append(node("span", `${n.title} \xB7 ${status}${n.last_error ? ` \xB7 ${n.last_error}` : ""}`));
      if (!n.phone_receipt_confirmed_at && ["accepted", "uncertain"].includes(n.delivery_state)) row.append(button(t("confirmReceipt"), guard(async () => {
        await message("CLOUD_REQUEST", { action: "confirm-receipt", notificationId: n.id });
        $("refresh-delivery").click();
      })));
      root.append(row);
    }
  }));
  async function init(data) {
    draftWeek=data.attendanceDraft?.rows?.length?(data.attendanceDraft.weekStartDate||''):null;
    if (data.attendanceDraft?.version === 1 && Array.isArray(data.attendanceDraft.rows)) api.preview.push(...data.attendanceDraft.rows);
    $("review-draft").checked = Boolean(data.attendanceDraft?.reviewedAt);
    api.renderPreview();
    ready = true;
    await render();
    if (api.preview.length) $("draft-status").textContent = t("draftRestored");
  }
  return { init, draftChanged, render, activateDraft, refreshLocale };
}
export { createOptionsUpgrade };
