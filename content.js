(() => {
  // src/course-kind.js
  var aliases = { lec: "lecture", lect: "lecture", lecture: "lecture", tut: "tutorial", tutorial: "tutorial", lab: "lab", laboratory: "lab" };
  function parse(value) {
    let kinds = new Set([...String(value || "").matchAll(/(?:^|[^a-z0-9])(lecture|lect|lec|tutorial|tut|laboratory|lab)(?:\d+)?(?=$|[^a-z0-9])/gi)].map((match) => aliases[match[1].toLowerCase()]));
    return kinds.size === 1 ? [...kinds][0] : null;
  }
  function resolveCourseKind({ type, course } = {}) {
    return parse(type) || parse(course);
  }
  function courseKindWarning(session) {
    return `${session.course} \u7F3A\u5C11\u8BFE\u578B\uFF08LEC/TUT/LAB\uFF09\uFF0C\u8BF7\u5728\u8BFE\u8868\u4E2D\u8865\u5168\u540E\u518D\u542F\u7528`;
  }
  function unknownCourseKind(session) {
    let error = Error(courseKindWarning(session));
    return error.code = "course_kind_unknown", error;
  }

  // src/question-title.js
  var questionTitleRules = [
    { labels: ["Required to answer", "\u5FC5\u7B54", "\u5FC5\u586B"] },
    { labels: ["Single line text", "\u5355\u884C\u6587\u672C", "\u55AE\u884C\u6587\u5B57"] },
    { labels: ["Single choice", "\u5355\u9009", "\u55AE\u9078"] },
    { labels: ["Multiple choice", "\u591A\u9009", "\u591A\u9078"] },
    { labels: ["Long answer text", "\u957F\u7B54\u6848\u6587\u672C", "\u9577\u7B54\u6848\u6587\u5B57", "\u591A\u884C\u6587\u672C"] },
    { labels: ["Date", "\u65E5\u671F"], attached: !0 }
  ], escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), tidy = (value) => value.replace(/\s+/g, " ").trim();
  function cleanQuestionTitle(raw, rules = questionTitleRules) {
    let title = tidy(String(raw ?? "").normalize("NFKC")).replace(/^\d+\s*[.)、]\s*/, "").replace(/^[.。]+\s*/, ""), changed = !0;
    for (; changed; ) {
      changed = !1;
      for (let rule of rules) {
        let labels = rule.labels.map((label) => escapeRegex(label).replace(/ /g, "\\s+")).join("|"), match = new RegExp(`(${labels})[\\s.\u3002\u2026]*(?:\\((?:text|radio|checkbox|date)(?:\\s*:[^)]*)?\\))?[\\s.\u3002\u2026]*$`, "i").exec(title);
        if (!match || match.index === 0) continue;
        let prefix = title.slice(0, match.index);
        if (rule.attached) {
          let previous = prefix.at(-1), first = match[1][0], afterMetadata = rules.some((other) => !other.attached && other.labels.some((label) => prefix.toLowerCase().endsWith(label.toLowerCase())));
          if (/\s/.test(previous) || /[a-z]/i.test(first) && !afterMetadata && !(/[.。]/.test(previous) || /[a-z]/.test(previous) && /[A-Z]/.test(first))) continue;
        }
        title = tidy(prefix.replace(/[\s.。…]+$/, "")), changed = !0;
        break;
      }
    }
    return title;
  }
  var normalizeComparable = (value) => cleanQuestionTitle(value).toLowerCase();

  // src/submission-confirmation.js
  var SUCCESS_RULES = [
    ["en_answers_submitted", /\byour answers? have been submitted successfully\b/i],
    ["en_response_submitted", /\byour response (?:was|has been) submitted\b/i],
    ["en_response_recorded", /\byour response has been recorded\b/i],
    ["zh_response_submitted", /(?:(?:你的|您的)(?:响应|答复|回复)已(?:成功)?(?:提交|记录)|已(?:成功)?(?:提交|记录)(?:你的|您的)(?:响应|答复|回复))/i],
    ["ms_response_submitted", /(?:respons|jawapan)\s+(?:anda|awak)\s+(?:telah|sudah)\s+(?:dihantar(?:kan)?|direkodkan)/i],
    ["ms_thanks_submitted", /terima kasih[\s,，]*(?:respons|jawapan).*?(?:dihantar|direkodkan)/i]
  ], FAILURE_RULES = [
    ["en_submission_error", /\b(?:something went wrong|server error|unable to submit|failed to submit)\b/i],
    ["zh_submission_error", /服务器(?:出错|错误)|提交失败|出了点问题/],
    ["ms_submission_error", /\b(?:ralat pelayan|sesuatu telah berlaku|gagal dihantar)\b/i]
  ], SUCCESS_PAGE_SELECTORS = [];
  function isExplicitSuccess(text) {
    return SUCCESS_RULES.find(([, rule]) => rule.test(String(text || "")))?.[0] || null;
  }
  function submissionSignals(before = {}, after = {}, options = {}) {
    let failure = FAILURE_RULES.find(([, rule]) => rule.test(String(after.text || "")))?.[0];
    if (failure) return { state: "failed", signal: failure };
    let text = isExplicitSuccess(after.text);
    if (text) return { state: "success", signal: text };
    if (options.structureSelectorsEnabled === !0) {
      if (before.questionCount > 0 && before.submitVisible === !0 && after.questionCount === 0 && after.submitVisible === !1 && after.successMarker === !0) return { state: "success", signal: "structure_confirmed" };
      if (before.questionCount !== after.questionCount || before.submitVisible !== after.submitVisible || after.successMarker === !0) return { state: "submitted_pending_confirmation", signal: "structure_change" };
    }
    return { state: "submitted_pending_confirmation", signal: "none" };
  }
  function confirmationPage(root) {
    return {
      text: root.body?.innerText?.replace(root.getElementById("attendance-helper-status")?.innerText || "", "") || "",
      questionCount: root.querySelectorAll('[data-automation-id="questionItem"]').length,
      submitVisible: !!root.querySelector('[data-automation-id="submitButton"]'),
      successMarker: SUCCESS_PAGE_SELECTORS.some((selector) => [...root.querySelectorAll(selector)].some((node) => node.getClientRects().length && node.getAttribute("aria-hidden") !== "true"))
    };
  }
  function successPageSummary(root) {
    return [...root.querySelectorAll("[data-automation-id],[role],[aria-label],h1,h2,h3,h4,h5,h6")].filter((node) => !node.closest('#attendance-helper-status,[data-automation-id="questionItem"]') && node.getClientRects().length).slice(0, 100).map((node) => Object.fromEntries([
      ...["data-automation-id", "role", "aria-label"].map((key) => [key, node.getAttribute(key)]),
      ["title", node.matches('h1,h2,h3,h4,h5,h6,[role="heading"],[data-automation-id="formTitle"]') ? node.textContent?.trim() : null]
    ].filter(([, value]) => value).map(([key, value]) => [key, value.slice(0, 250)])));
  }

  // src/v1.0.5/content-forms.js
  function deliveryFromCourse(course, type) {
    let kind = resolveCourseKind({ course, type });
    if (!kind) throw unknownCourseKind({ course });
    return kind;
  }
  var HOSTS = /* @__PURE__ */ new Set(["forms.office.com", "forms.cloud.microsoft"]), normalize = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  function sameDateValue(actual, expected) {
    let pattern = /^\s*\d{1,4}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{1,4}\s*$/;
    if (!pattern.test(String(actual || "")) || !pattern.test(String(expected || ""))) return !1;
    let left = String(actual).match(/\d+/g), right = String(expected).match(/\d+/g);
    return left.length === 3 && right.length === 3 && left.every((part, i) => Number(part) === Number(right[i]));
  }
  function validateFormsUrl(value) {
    let url;
    try {
      url = new URL(String(value).trim());
    } catch {
      throw Error("\u4E8C\u7EF4\u7801\u6216\u94FE\u63A5\u4E0D\u662F\u6709\u6548\u7F51\u5740\u3002");
    }
    if (url.protocol !== "https:" || url.username || url.password || url.port || !HOSTS.has(url.hostname.toLowerCase()) || !(/^\/r\/[\w-]+\/?$/.test(url.pathname) || /^\/Pages\/ResponsePage\.aspx$/i.test(url.pathname))) throw Error("\u53EA\u63A5\u53D7 Microsoft Forms \u7684\u586B\u5199\u94FE\u63A5\u3002");
    if (/^\/Pages\//i.test(url.pathname) && !url.searchParams.get("id")) throw Error("\u8868\u5355\u94FE\u63A5\u7F3A\u5C11 ID\u3002");
    return url.hash = "", url;
  }
  function verifyQuestions(questions, mapping) {
    if (!Array.isArray(questions) || questions.length !== mapping?.length) return !1;
    let actual = new Map(questions.map((q) => [normalizeComparable(q.title), q]));
    return mapping.every((entry) => {
      let q = actual.get(normalizeComparable(entry.title));
      return !q || q.type !== entry.type ? !1 : q.type !== "radio" ? !0 : JSON.stringify([...new Set(optionList(q))].sort()) === JSON.stringify([...new Set(optionList(entry))].sort());
    });
  }
  var questionKey = (question) => normalizeComparable(question?.title), optionList = (question) => [...question?.options || []].map(normalizeComparable);
  function questionSignature(question) {
    return `${question?.type || ""}|${[...new Set(optionList(question))].sort().join("")}`;
  }
  function questionDiff(expected = [], actual = []) {
    let left = new Map(expected.map((q) => [questionKey(q), q])), right = new Map(actual.map((q) => [questionKey(q), q])), added = [], deleted = [], renamed = [], options = [];
    for (let key of left.keys()) right.has(key) || deleted.push(key);
    for (let key of right.keys()) left.has(key) || added.push(key);
    for (let key of left.keys()) {
      let q = right.get(key);
      if (!q) continue;
      q.type !== left.get(key).type && renamed.push({ from: key, to: key });
      let before = [...new Set(optionList(left.get(key)))].sort(), after = [...new Set(optionList(q))].sort();
      JSON.stringify(before) !== JSON.stringify(after) && options.push({ title: key, added: after.filter((v) => !before.includes(v)), removed: before.filter((v) => !after.includes(v)) });
    }
    let unmatchedLeft = deleted.map((key) => left.get(key)), unmatchedRight = added.map((key) => right.get(key));
    for (let oldQuestion of unmatchedLeft) {
      let index = unmatchedRight.findIndex((q) => questionSignature(q) === questionSignature(oldQuestion));
      if (index < 0) continue;
      let [newQuestion] = unmatchedRight.splice(index, 1), oldKey = questionKey(oldQuestion), newKey = questionKey(newQuestion);
      deleted.splice(deleted.indexOf(oldKey), 1), added.splice(added.indexOf(newKey), 1), renamed.push({ from: oldKey, to: newKey });
    }
    return { added: added.sort(), deleted: deleted.sort(), renamed: renamed.sort((a, b) => a.from.localeCompare(b.from)), options: options.sort((a, b) => a.title.localeCompare(b.title)) };
  }
  function formatDate(placeholder, date) {
    let [y, m, d] = date.split("-"), format = String(placeholder || "").match(/(?:yyyy|MM|M|dd|d)[/.-](?:yyyy|MM|M|dd|d)[/.-](?:yyyy|MM|M|dd|d)/)?.[0];
    if (!format) throw Error("\u65E0\u6CD5\u8BC6\u522B\u8868\u5355\u65E5\u671F\u683C\u5F0F\u3002");
    return format.replace(/yyyy|MM|dd|M|d/g, (t) => ({ yyyy: y, MM: m, M: String(+m), dd: d, d: String(+d) })[t]);
  }
  function deliveryOption(options, target) {
    return options.find((value) => target === "lab" ? ["lab", "laboratory"].includes(normalize(value)) : normalize(value) === target);
  }
  function identityOption(options, target) {
    return options.find((value) => target === "international" ? /international/i.test(value) : /\blocal\b/i.test(value) && !/international/i.test(value));
  }
  function buildFillPlan(questions, mapping, profile, date, course, type) {
    if (!verifyQuestions(questions, mapping)) {
      let error = Error("\u8868\u5355\u9898\u76EE\u53D1\u751F\u53D8\u5316\uFF0C\u5DF2\u505C\u6B62\u3002");
      throw error.code = "form_schema_changed", error.diff = questionDiff(mapping, questions), error;
    }
    return mapping.map((entry, i) => {
      let q = questions.find((item) => normalizeComparable(item.title) === normalizeComparable(entry.title)), value;
      if (q.type === "date" && q.required === !1) return { type: "date", field: entry.field, skip: !0 };
      let expectedType = ["student", "name"].includes(entry.field) ? "text" : entry.field === "date" ? "date" : /^(?:delivery|local)(?::|$)/.test(entry.field) ? "radio" : null;
      if (expectedType && q.type !== expectedType) throw Error(`\u7B2C ${i + 1} \u9898\u6620\u5C04\u4E0E\u9898\u578B\u4E0D\u4E00\u81F4\uFF0C\u672A\u63D0\u4EA4\u3002`);
      if (entry.field === "student") value = profile.student;
      else if (entry.field === "name") value = profile.name;
      else if (entry.field === "date") value = q.nativeDate ? date : formatDate(q.placeholder, date);
      else if (entry.field === "delivery" || ["delivery:lecture", "delivery:tutorial", "delivery:lab", "delivery:laboratory"].includes(entry.field)) {
        let target = entry.field === "delivery" ? deliveryFromCourse(course, type) : entry.field.split(":")[1];
        value = deliveryOption(q.options || [], target === "laboratory" ? "lab" : target);
      } else if (entry.field === "local" || ["local:local", "local:international"].includes(entry.field)) {
        let target = entry.field === "local" ? profile.studentType : entry.field.split(":")[1];
        value = identityOption(q.options || [], target);
      } else throw Error(`\u672A\u914D\u7F6E\u7B2C ${i + 1} \u9898\u3002`);
      if (!value) throw Error(`\u7B2C ${i + 1} \u9898\u6CA1\u6709\u5339\u914D\u7684\u7B54\u6848\u3002`);
      return { type: q.type, value, field: entry.field, questionTitle: q.title };
    });
  }
  function assertDateAgreement(occDate, malaysiaDate, computerDate) {
    if (occDate !== malaysiaDate) throw Error("\u4EFB\u52A1\u65E5\u671F\u4E0E\u9A6C\u6765\u897F\u4E9A\u5F53\u5929\u65E5\u671F\u4E0D\u4E00\u81F4\uFF0C\u5DF2\u505C\u6B62\u3002");
    if (computerDate !== malaysiaDate) throw Error("\u7535\u8111\u672C\u5730\u65E5\u671F\u4E0E\u9A6C\u6765\u897F\u4E9A\u65E5\u671F\u4E0D\u4E00\u81F4\uFF0C\u5DF2\u505C\u6B62\u3002");
  }

  // src/form-date.js
  var pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  function markDateDiagnostic(step, fields = {}) {
    let rows = window.__dateDiag ??= [], row = { step, inBackground: document.visibilityState === "hidden", rectCount: 0, ...fields }, last = rows.at(-1);
    last && JSON.stringify({ ...last, count: void 0 }) === JSON.stringify(row) ? last.count++ : rows.push({ ...row, count: 1 }), rows.length > 40 && rows.splice(0, rows.length - 40);
  }
  async function fillDate(input, expected) {
    let deadline = Date.now() + 6e3, path, selected = !1, mismatch = () => Object.assign(Error("\u65E5\u671F\u56DE\u8BFB\u503C\u4E0D\u4E00\u81F4\u6216\u65E5\u671F\u9898\u6821\u9A8C\u5931\u8D25\uFF0C\u672A\u63D0\u4EA4\u3002"), { code: "date_readback_mismatch" }), finish = async () => {
      markDateDiagnostic("date:complete", { path }), input.blur(), await pause(300);
      let question = input.closest('[data-automation-id="questionItem"],[role="group"],fieldset') || input.parentElement, invalid = input.getAttribute("aria-invalid") === "true" || [...question?.querySelectorAll('[role="alert"],[aria-invalid="true"]') || []].some((el) => el.getAttribute("aria-invalid") === "true" || el.textContent.trim());
      if (!sameDateValue(input.value, expected) || invalid) throw mismatch();
    };
    if (sameDateValue(input.value, expected))
      return path = "already-set", finish();
    markDateDiagnostic("date:native");
    try {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, expected);
      for (let type of ["input", "change", "blur"]) input.dispatchEvent(new Event(type, { bubbles: !0 }));
      await pause(0);
    } catch {
    }
    if (sameDateValue(input.value, expected))
      return path = "native", finish();
    markDateDiagnostic("date:calendar"), input.getAttribute("aria-expanded") !== "true" && input.click();
    let root = () => document.getElementById(input.getAttribute("aria-controls")) || document, visible = (el) => {
      if (!el?.isConnected || ["hidden", "collapse"].includes(getComputedStyle(el).visibility)) return !1;
      for (let node = el; node; node = node.parentElement) {
        if (node.hidden || node.getAttribute("aria-hidden") === "true") return !1;
        let style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "collapse") return !1;
      }
      return !0;
    }, disabled = (el) => !!el.disabled || el.getAttribute("aria-disabled") === "true", findGoToday = () => {
      let el = [...root().querySelectorAll('button,[role="button"],a.js-goToday')].find((el2) => visible(el2) && (el2.matches(".js-goToday") || /^(?:转到今日|转到今天|go to today)$/i.test((el2.getAttribute("aria-label") || el2.textContent || "").trim()))), result = { el, disabled: el ? disabled(el) : !1, text: el?.textContent.trim().slice(0, 20) || "", rectCount: el?.getClientRects().length || 0 }, { el: ignored, ...fields } = result;
      return markDateDiagnostic("goToday", fields), result;
    }, currentDay = () => {
      let candidates = ['[aria-current="date"]', '[data-is-today="true"]', 'button[class*="today" i]:not(.js-goToday)'].flatMap((selector) => [...root().querySelectorAll(selector)]).filter((el) => !/^(?:转到今日|转到今天|go to today)$/i.test((el.getAttribute("aria-label") || el.textContent || "").trim()));
      candidates.push(...[...root().querySelectorAll('[role="gridcell"][aria-label],button[aria-label]')].filter((el) => {
        let label = el.getAttribute("aria-label"), date = new Date(Date.parse(label));
        return sameDateValue(label.replace(/[年/月]/g, "-").replace(/日/g, ""), expected) || !Number.isNaN(date.getTime()) && sameDateValue(`${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`, expected);
      }));
      for (let cell of candidates) {
        let day = cell.querySelector("button") || cell;
        if (visible(cell) && visible(day) && !disabled(cell) && !disabled(day))
          return markDateDiagnostic(day.matches("button") ? "todayButton" : "todayCell", { rectCount: day.getClientRects().length }), day;
      }
      return null;
    }, wentToday = !1;
    for (; Date.now() < deadline - 300; ) {
      let goToday = findGoToday();
      if (!wentToday && goToday.el && !goToday.disabled && (path = "goToday", wentToday = !0, goToday.el.click(), await pause(Math.min(150, Math.max(0, deadline - 300 - Date.now()))), sameDateValue(input.value, expected)))
        return finish();
      if (!selected) {
        let today = currentDay();
        today && (path = wentToday ? "goToday" : "today-cell", selected = !0, today.click());
      }
      if (sameDateValue(input.value, expected)) return finish();
      await pause(Math.min(150, Math.max(0, deadline - 300 - Date.now())));
    }
    throw markDateDiagnostic("date:failed", path ? { path } : {}), selected || wentToday ? mismatch() : Object.assign(Error("\u627E\u4E0D\u5230\u65E5\u671F\u63A7\u4EF6\u4E2D\u53EF\u70B9\u51FB\u7684\u201C\u8F6C\u5230\u4ECA\u65E5\u201D\u6216\u4ECA\u5929\u7684\u683C\u5B50\uFF0C\u672A\u63D0\u4EA4\u3002"), { code: "date_picker_today_not_found" });
  }

  // src/bindings.js
  function moduleKey(course) {
    let text = String(course || "").trim();
    return text.match(/\b[A-Za-z]{2,}\d{3,}\b/)?.[0].toUpperCase() || text;
  }
  function bindingForCourse(bindings, course) {
    let key = moduleKey(course), binding = bindings?.[key];
    return binding?.scope === "module" || String(course || "").trim() === key ? binding : void 0;
  }
  function resolveFillPlan(binding, session, profile, date) {
    if (!binding?.verified) throw Error(`${moduleKey(session.course)} \u5C1A\u672A\u7ED1\u5B9A\u5E76\u6838\u5BF9\u5171\u7528\u8868\u5355\u3002`);
    let kind = deliveryFromCourse(session.course, session.type);
    if (!binding.questions) return null;
    for (let entry of binding.mapping) {
      if (!entry.field?.startsWith("delivery:")) continue;
      let fixed = entry.field.split(":")[1];
      if ((fixed === "laboratory" ? "lab" : fixed) !== kind) throw Error(`${session.course} \u7684\u56FA\u5B9A\u8BFE\u578B\u4E0E\u8BFE\u7A0B\u540D\u79F0\u4E0D\u4E00\u81F4\uFF0C\u8BF7\u91CD\u65B0\u6838\u5BF9\u5171\u7528\u8868\u5355\u3002`);
    }
    return buildFillPlan(binding.questions, binding.mapping, profile, date, session.course, session.type);
  }

  // src/submit-delay.js
  function randomSubmitDelay(random = Math.random) {
    return (15 + Math.min(
      5,
      Math.floor(random() * 6)
    )) * 1e3;
  }

  // src/runtime-timing.js
  function scheduleWeekStatus(session, now = Date.now()) {
    let value = session?.weekStartDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return "needs_week_assignment";
    let date = /* @__PURE__ */ new Date(`${value}T00:00:00Z`), start = Date.parse(`${value}T00:00:00+08:00`);
    return !Number.isFinite(start) || date.getUTCDay() !== 1 || date.toISOString().slice(0, 10) !== value || !Number.isFinite(now) ? "needs_week_assignment" : now < start ? "upcoming" : now < start + 7 * 864e5 ? "active" : "expired";
  }
  var FORMS_LOAD_MS = 6e4, LOGIN_REDIRECT_SETTLE_MS = 4e3;
  var VALIDATION_MARGIN_MS = 15e3;
  var CONFIRMATION_WAIT_MS = 3e4, PHASE_TIMEOUTS = Object.freeze({
    opening: FORMS_LOAD_MS + LOGIN_REDIRECT_SETTLE_MS + 26e3,
    reading: FORMS_LOAD_MS + 3e4,
    checking: 1e4,
    filling: 6e4,
    submitting: 20 * 1e3 + VALIDATION_MARGIN_MS + 1e4,
    confirming: 45e3
  });
  function courseEndTimestamp(occ) {
    return occ?.isTest === !0 && occ.testRunId && Number.isFinite(occ.testDeadline) ? occ.testDeadline : !/^\d{4}-\d{2}-\d{2}$/.test(occ?.date || "") || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(occ?.endTime || "") ? NaN : Date.parse(`${occ.date}T${occ.endTime}:00+08:00`);
  }
  function canSubmitBeforeEnd(occ, now, remainingMs = 0) {
    let end = courseEndTimestamp(occ);
    return scheduleWeekStatus(occ, now) === "active" && scheduleWeekStatus(occ, now + remainingMs) === "active" && Number.isFinite(end) && remainingMs >= 0 && now + remainingMs < end;
  }
  function assertBeforeCourseEnd(occ, remainingMs = 0, now = Date.now()) {
    if (!canSubmitBeforeEnd(occ, now, remainingMs))
      throw scheduleWeekStatus(occ, now) !== "active" ? Object.assign(Error("\u8BFE\u8868\u5468\u672A\u5206\u914D\u3001\u672A\u5F00\u59CB\u6216\u5DF2\u8FC7\u671F\uFF0C\u672A\u63D0\u4EA4\u3002"), { code: "schedule_week_inactive" }) : Object.assign(Error("\u8BFE\u7A0B\u5DF2\u7ED3\u675F\u6216\u5269\u4F59\u65F6\u95F4\u4E0D\u8DB3\uFF0C\u672A\u63D0\u4EA4\u3002"), { code: "course_ended" });
  }

  // src/schedule.js
  function todayMalaysia(now = /* @__PURE__ */ new Date()) {
    let parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((p) => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  // src/fill-only.js
  var pause2 = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), items = () => [...document.querySelectorAll('[data-automation-id="questionItem"]')], formTitle = () => document.querySelector('[data-automation-id="formTitle"]')?.textContent?.trim() || "";
  function questionTitle(item) {
    let node = item.querySelector('[data-automation-id="questionTitle"]');
    if (!node) return "";
    let clone = node.cloneNode(!0);
    for (let element of clone.querySelectorAll("*")) {
      let className = element.getAttribute("class") || "";
      (element.matches('[aria-hidden="true"],[hidden],[data-automation-id="questionRequired"],[data-automation-id="requiredStar"]') || /(?:visually[-_]?hidden|screen[-_]?reader|sr[-_]?only)/i.test(className) || element.style.display === "none" || element.style.visibility === "hidden") && element.remove();
    }
    return cleanQuestionTitle(clone.textContent) || cleanQuestionTitle(node.textContent);
  }
  function readQuestions() {
    return items().map((item) => {
      let inputs = [...item.querySelectorAll("input")], radio = inputs.filter((e) => e.type === "radio"), title = questionTitle(item), date = inputs.find((e) => e.type === "date" || e.getAttribute("role") === "combobox" && (/date|日期/i.test(title) || /yyyy|yy|MM[/.-]|[/.-]MM/i.test(e.placeholder))), text = inputs.filter((e) => e.matches('[data-automation-id="textInput"]'));
      if (item.querySelector('textarea,select,input[type="checkbox"]') || !radio.length && !date && text.length !== 1) throw Error("\u8868\u5355\u542B\u6682\u4E0D\u652F\u6301\u7684\u9898\u578B\uFF0C\u65E0\u6CD5\u542F\u7528\u81EA\u52A8\u6253\u5361\u3002");
      let required = !!item.querySelector('[required],[aria-required="true"],[data-automation-id="questionRequired"],[data-automation-id="requiredStar"],[aria-label="Required"],[aria-label="\u5FC5\u586B"]') || /\*/.test(item.querySelector('[data-automation-id="questionTitle"]')?.textContent || "") || item.getAttribute("data-required") === "true";
      return { title, type: radio.length ? "radio" : date ? "date" : "text", required, placeholder: date?.placeholder || "", nativeDate: date?.type === "date", options: radio.map((e) => e.value) };
    });
  }
  function control(index, entry) {
    let item = items().find((candidate) => normalizeComparable(questionTitle(candidate)) === normalizeComparable(entry.questionTitle)) || items()[index];
    return item ? entry.type === "radio" ? [...item.querySelectorAll('input[type="radio"]')].find((e) => e.value === entry.value) : item.querySelector(entry.type === "date" ? 'input[role="combobox"],input[type="date"]' : 'input[data-automation-id="textInput"]') : null;
  }
  async function fill(plan) {
    for (let i = 0; i < plan.length; i++) {
      let entry = plan[i], el = control(i, entry);
      if (!entry.skip) {
        if (!el || el.disabled || el.readOnly && entry.type !== "date") throw Error(`\u7B2C ${i + 1} \u9898\u65E0\u6CD5\u586B\u5199\u3002`);
        entry.type === "radio" ? el.click() : entry.type === "date" && el.type !== "date" ? await fillDate(el, entry.value) : (entry.type === "date" && (window.__dateDiag ??= []).push({ inBackground: document.visibilityState === "hidden", rectCount: 0, step: "date:native" }), el.focus(), Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, entry.value), el.dispatchEvent(new Event("input", { bubbles: !0 })), el.dispatchEvent(new Event("change", { bubbles: !0 })), el.blur()), await pause2(180);
      }
    }
    if (await pause2(500), !answersMatch(plan)) throw Error(AttendanceHotfix.requiresDateCheck(plan) ? "\u586B\u5199\u540E\u7684\u7B54\u6848\u6216\u65E5\u671F\u6838\u5BF9\u5931\u8D25\uFF0C\u672A\u63D0\u4EA4\u3002" : "\u586B\u5199\u540E\u7684\u7B54\u6848\u6838\u5BF9\u5931\u8D25\uFF0C\u672A\u63D0\u4EA4\u3002");
  }
  function answersMatch(plan) {
    let questions = items();
    return questions.length !== plan.length ? !1 : plan.every((entry, i) => {
      if (entry.skip) return !0;
      let el = control(i, entry);
      if (!el || el.getAttribute("aria-invalid") === "true") return !1;
      if (entry.type === "radio") {
        let checked = [...questions[i].querySelectorAll('input[type="radio"]')].filter((input) => input.checked);
        return checked.length === 1 && checked[0] === el && el.value === entry.value;
      }
      return entry.type === "date" ? sameDateValue(el.value, entry.value) : el.value === entry.value;
    });
  }
  async function prepareFill(binding, occ, profile, { onCheck = () => {
  }, onFill = () => {
  } } = {}) {
    let stage = "\u8BFE\u578B\u53EF\u89E3\u6790";
    try {
      if (!binding?.verified || !profile?.student || !profile?.name) throw Error("\u8BF7\u5148\u5B8C\u6210\u5B66\u751F\u8D44\u6599\u548C\u8868\u5355\u7ED1\u5B9A\u3002");
      if (!resolveCourseKind(occ)) throw unknownCourseKind(occ);
      onCheck(stage, !0, ""), stage = "\u8868\u5355\u94FE\u63A5\u4E0E\u7ED1\u5B9A\u4E00\u81F4";
      let expected = validateFormsUrl(binding.url), actual = validateFormsUrl(location.href);
      if (expected.hostname !== actual.hostname || expected.pathname !== actual.pathname || expected.searchParams.get("id") !== actual.searchParams.get("id")) throw Error("\u5F53\u524D\u94FE\u63A5\u4E0E\u7ED1\u5B9A\u4E0D\u4E00\u81F4\uFF0C\u8BF7\u91CD\u65B0\u7ED1\u5B9A\u8BFE\u7A0B\u8868\u5355\u3002");
      if (onCheck(stage, !0, ""), stage = "\u6807\u9898\u4E0E\u9898\u76EE\u6CA1\u53D8", formTitle() !== binding.title) throw Error("\u8868\u5355\u6807\u9898\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u6838\u5BF9\u5E76\u7ED1\u5B9A\u8868\u5355\u3002");
      let questions = readQuestions();
      if (!verifyQuestions(questions, binding.mapping)) throw Error("\u8868\u5355\u9898\u76EE\u6216\u9009\u9879\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u6838\u5BF9\u8868\u5355\u6620\u5C04\u3002");
      onCheck(stage, !0, ""), stage = "\u65E5\u671F\u683C\u5F0F\u53EF\u586B", resolveFillPlan(binding, occ, profile, occ.date);
      let plan = buildFillPlan(questions, binding.mapping, profile, occ.date, occ.course, occ.type), now = /* @__PURE__ */ new Date(), computerDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      if (AttendanceHotfix.requiresDateCheck(plan) && assertDateAgreement(occ.date, todayMalaysia(now), computerDate), onCheck(stage, !0, ""), stage = "\u586B\u5199\u540E\u6838\u5BF9\u901A\u8FC7", await onFill(plan), await fill(plan), !answersMatch(plan)) throw Error("\u586B\u5199\u540E\u7684\u7B54\u6848\u6838\u5BF9\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u8868\u5355\u63A7\u4EF6\u548C\u65E5\u671F\u683C\u5F0F\u3002");
      return onCheck(stage, !0, ""), plan;
    } catch (error) {
      let fixes = { \u8BFE\u578B\u53EF\u89E3\u6790: "\u8BF7\u5728\u8BFE\u8868\u4E2D\u8865\u5168 LEC/TUT/LAB\uFF0C\u5E76\u68C0\u67E5\u5B66\u751F\u8D44\u6599\u3002", \u8868\u5355\u94FE\u63A5\u4E0E\u7ED1\u5B9A\u4E00\u81F4: "\u8BF7\u91CD\u65B0\u7ED1\u5B9A\u8BFE\u7A0B\u8868\u5355\u94FE\u63A5\u3002", \u6807\u9898\u4E0E\u9898\u76EE\u6CA1\u53D8: "\u8BF7\u91CD\u65B0\u6838\u5BF9\u8868\u5355\u6807\u9898\u3001\u9898\u76EE\u548C\u6620\u5C04\u3002", \u65E5\u671F\u683C\u5F0F\u53EF\u586B: "\u8BF7\u68C0\u67E5\u65E5\u671F\u683C\u5F0F\u4E0E\u7535\u8111\u65F6\u533A\u3002", \u586B\u5199\u540E\u6838\u5BF9\u901A\u8FC7: "\u8BF7\u624B\u52A8\u68C0\u67E5\u7B54\u6848\u3001\u65E5\u671F\u63A7\u4EF6\u548C\u5FC5\u586B\u9879\u3002" };
      throw onCheck(stage, !1, `${error.message} ${fixes[stage]}`), error;
    }
  }

  // src/reliability.js
  var PHASE_ERRORS = Object.freeze({ opening: "\u9875\u9762\u672A\u5728 90 \u79D2\u5185\u52A0\u8F7D\u3002", reading: "\u5185\u5BB9\u811A\u672C\u672A\u54CD\u5E94\u6216\u8868\u5355\u672A\u5728 90 \u79D2\u5185\u5C31\u7EEA\u3002", checking: "\u8868\u5355\u6838\u5BF9\u9636\u6BB5\u8D85\u65F6\u3002", filling: "\u8868\u5355\u586B\u5199\u9636\u6BB5\u8D85\u65F6\u3002", submitting: "\u627E\u4E0D\u5230\u63D0\u4EA4\u6309\u94AE\u6216\u63D0\u4EA4\u9636\u6BB5\u8D85\u65F6\u3002", confirming: "\u5DF2\u70B9\u51FB\u63D0\u4EA4\uFF0C\u4F46\u672A\u6536\u5230\u660E\u786E\u6210\u529F\u53CD\u9988\u3002" });
  function redactDiagnostic(value) {
    return String(value || "").replace(/https?:\/\/\S+/gi, "[url]").replace(/\b\d{6,}\b/g, "[redacted]").slice(0, 500);
  }

  // src/diagnostics.js
  var reasons = {
    date_picker_today_not_found: ["\u65E5\u671F\u63A7\u4EF6\u672A\u80FD\u6253\u5F00\u3002", "\u65E5\u671F\u63A7\u4EF6\u672A\u80FD\u6253\u5F00\uFF0C\u5DF2\u6539\u7528\u76F4\u63A5\u8F93\u5165\u6216\u5207\u5230\u524D\u53F0\u91CD\u8BD5\uFF1B\u4ECD\u5931\u8D25\u8BF7\u70B9\u590D\u5236\u8BCA\u65AD"],
    date_readback_mismatch: ["\u65E5\u671F\u56DE\u8BFB\u503C\u4E0D\u4E00\u81F4\u6216\u65E5\u671F\u9898\u6821\u9A8C\u5931\u8D25\u3002", "\u8BF7\u6253\u5F00\u539F\u8868\u5355\u68C0\u67E5\u65E5\u671F\u9898\u7684\u503C\u4E0E\u6821\u9A8C\u63D0\u793A\uFF0C\u5E76\u590D\u5236\u8BCA\u65AD\u3002"],
    test_authorization_expired: ["\u6D4B\u8BD5\u6388\u6743\u5DF2\u8FC7\u671F\u3002", "\u6D4B\u8BD5\u6388\u6743\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u70B9\u51FB\u7ACB\u5373\u6D4B\u8BD5\u6253\u5361"],
    date_fill_hidden_tab: ["\u540E\u53F0\u6807\u7B7E\u9875\u65E5\u671F\u586B\u5199\u5931\u8D25\uFF0C\u672A\u63D0\u4EA4\u3002", "\u5141\u8BB8\u524D\u53F0\u56DE\u9000\u65F6\u5C06\u77ED\u6682\u5207\u5230\u6253\u5361\u9875\u91CD\u8BD5\uFF1B\u5426\u5219\u8BF7\u624B\u52A8\u6838\u67E5\u65E5\u671F\u3002"],
    submission_error: ["Forms \u8FD4\u56DE\u63D0\u4EA4\u9519\u8BEF\uFF0C\u672A\u786E\u8BA4\u8BB0\u5F55\u3002", "\u8BF7\u68C0\u67E5\u5B66\u6821\u8868\u5355\u4E0E\u7F51\u7EDC\uFF1B\u7CFB\u7EDF\u4E0D\u4F1A\u81EA\u52A8\u91CD\u4EA4\uFF0C\u6838\u67E5\u8BB0\u5F55\u540E\u7531\u4F60\u51B3\u5B9A\u662F\u5426\u624B\u52A8\u63D0\u4EA4\u3002"],
    course_kind_unknown: ["\u7F3A\u5C11\u8BFE\u578B\uFF08LEC/TUT/LAB\uFF09\u3002", "\u8BF7\u5728\u8BFE\u8868\u4E2D\u8865\u5168\u8BFE\u578B\uFF0C\u4F8B\u5982 {course}-LEC\uFF0C\u7136\u540E\u91CD\u65B0\u68C0\u67E5\u3002"],
    form_schema_changed: ["\u8868\u5355\u9898\u76EE\u3001\u6807\u9898\u6216\u9009\u9879\u53D1\u751F\u53D8\u5316\u3002", "\u8BF7\u91CD\u65B0\u8BFB\u53D6\u5E76\u4FDD\u5B58\u6B64\u8BFE\u7A0B\u7684\u8868\u5355\u9898\u76EE\uFF0C\u518D\u6838\u5BF9\u6620\u5C04\u3002"],
    login_required: ["\u9700\u8981\u767B\u5F55\u5B66\u6821\u8D26\u53F7\u6216\u53D6\u5F97\u8868\u5355\u8BBF\u95EE\u6743\u9650\u3002", "\u8BF7\u6253\u5F00\u539F\u8868\u5355\u767B\u5F55\u5B66\u6821 Microsoft \u8D26\u53F7\uFF0C\u5E76\u786E\u8BA4\u8BBF\u95EE\u6743\u9650\u3002"],
    phase_timeout: ["\u6B64\u9636\u6BB5\u7B49\u5F85\u8D85\u65F6\u3002", "\u8BF7\u68C0\u67E5\u7F51\u7EDC\u548C\u5B66\u6821\u767B\u5F55\u72B6\u6001\uFF0C\u518D\u6253\u5F00\u539F\u8868\u5355\u68C0\u67E5\u3002"],
    date_mismatch: ["\u8BFE\u7A0B\u65E5\u671F\u4E0E\u5F53\u524D\u65E5\u671F\u6216\u8868\u5355\u65E5\u671F\u4E0D\u4E00\u81F4\u3002", "\u8BF7\u68C0\u67E5\u8BFE\u8868\u65E5\u671F\u3001\u7535\u8111\u65E5\u671F\u4E0E\u65F6\u533A\uFF0C\u5E76\u6838\u5BF9\u8868\u5355\u65E5\u671F\u3002"],
    answer_mismatch: ["\u586B\u5199\u540E\u7684\u7B54\u6848\u672A\u901A\u8FC7\u6838\u5BF9\u3002", "\u8BF7\u6253\u5F00\u539F\u8868\u5355\uFF0C\u68C0\u67E5\u7B54\u6848\u3001\u5FC5\u586B\u9879\u548C\u9898\u76EE\u6620\u5C04\u3002"],
    submit_unconfirmed: ["\u5DF2\u5C1D\u8BD5\u63D0\u4EA4\uFF0C\u4F46\u6CA1\u6709\u6536\u5230\u660E\u786E\u6210\u529F\u53CD\u9988\u3002", "\u8BF7\u6253\u5F00\u539F\u8868\u5355\u68C0\u67E5\u7ED3\u679C\uFF1B\u786E\u8BA4\u524D\u4E0D\u8981\u91CD\u590D\u63D0\u4EA4\uFF0C\u53EF\u5728\u8BB0\u5F55\u4E2D\u624B\u52A8\u6807\u8BB0\u5DF2\u63D0\u4EA4\u3002"],
    course_ended: ["\u8BFE\u7A0B\u5DF2\u7ED3\u675F\u6216\u7ED3\u675F\u65F6\u95F4\u65E0\u6548\uFF0C\u672A\u63D0\u4EA4\u3002", "\u8BF7\u68C0\u67E5\u8BFE\u8868\u8D77\u6B62\u65F6\u95F4\uFF0C\u5E76\u624B\u52A8\u5904\u7406\u672C\u6B21\u6253\u5361\u3002"],
    schedule_week_inactive: ["\u8BFE\u8868\u5468\u672A\u5206\u914D\u3001\u672A\u5F00\u59CB\u6216\u5DF2\u8FC7\u671F\uFF0C\u672A\u63D0\u4EA4\u3002", "\u8BF7\u660E\u786E\u5206\u914D\u672C\u5468\u6216\u4E0B\u5468\u8BFE\u8868\uFF1B\u7CFB\u7EDF\u4E0D\u4F1A\u81EA\u52A8\u7EED\u671F\u3002"],
    configuration_changed: ["\u6253\u5361\u914D\u7F6E\u7F3A\u5931\u6216\u5DF2\u53D8\u5316\u3002", "\u8BF7\u4FDD\u5B58\u4E2A\u4EBA\u8D44\u6599\uFF0C\u5E76\u91CD\u65B0\u6838\u5BF9\u6B64\u8BFE\u7A0B\u7684\u8BFE\u8868\u548C\u5171\u7528\u8868\u5355\u3002"],
    phase_failed: ["\u6B64\u9636\u6BB5\u6267\u884C\u5931\u8D25\u3002", "\u8BF7\u6253\u5F00\u539F\u8868\u5355\u68C0\u67E5\uFF0C\u5E76\u590D\u5236\u8BCA\u65AD\u4FE1\u606F\u7ED9\u5F00\u53D1\u8005\u3002"]
  }, ERROR_CODES = Object.freeze(Object.keys(reasons));
  function diagnosticPhase(phase) {
    let canonical = { checking: "validate", filling: "fill", submitting: "submit", confirming: "submit" }[phase] || phase;
    return ["validate", "fill", "submit", "opening", "reading"].includes(canonical) ? canonical : "validate";
  }
  function runError(error = {}, context = {}) {
    let message = typeof error == "string" ? error : error?.message || "", code = error?.code;
    code || (code = /缺少课型|无法判断.*课程类型/.test(message) ? "course_kind_unknown" : /登录|权限/.test(message) ? "login_required" : /日期.*不一致|日期.*变化/.test(message) ? "date_mismatch" : /答案|填写/.test(message) ? "answer_mismatch" : /schema_changed|题目|题型|标题|选项|表单.*不一致/.test(message) ? "form_schema_changed" : /超时/.test(message) ? "phase_timeout" : /配置|绑定|任务已/.test(message) ? "configuration_changed" : "phase_failed");
    let guidance = reasons[code] || reasons.phase_failed, course = String(context.course || error.course || "\u672A\u77E5\u8BFE\u7A0B"), kind = resolveCourseKind({ course, type: context.type }), variant = { lecture: "LEC", tutorial: "TUT", lab: "LAB" }[kind], reason = message || guidance[0];
    return { code, course, phase: diagnosticPhase(context.phase || error.phase), message: variant && !reason.includes("\uFF08\u8BFE\u578B\uFF1A") ? `${reason}\uFF08\u8BFE\u578B\uFF1A${variant}\uFF09` : reason, hint: guidance[1].replaceAll("{course}", course) };
  }
  function formatRunError(error) {
    let phase = { validate: "\u6821\u9A8C", fill: "\u586B\u5199", submit: "\u63D0\u4EA4", opening: "\u6253\u5F00\u8868\u5355", reading: "\u8BFB\u53D6\u8868\u5355" }[error.phase] || error.phase;
    return `${error.course} \xB7 ${phase}\uFF1A${error.message}
\u4E0B\u4E00\u6B65\uFF1A${error.hint}`;
  }
  function createDiagnostic(input = {}, profile = {}) {
    let secrets = [profile.student, profile.name].filter(Boolean).map(String).sort((a, b) => b.length - a.length), safe = (value) => {
      let text = String(value || "");
      for (let secret of secrets) text = text.split(secret).join("[redacted]");
      return redactDiagnostic(text);
    }, durations = { validate: 0, fill: 0, submit: 0 };
    for (let [phase, ms] of Object.entries(input.phaseDurations || {})) if (["validate", "fill", "submit", "opening", "reading", "checking", "filling", "submitting", "confirming"].includes(phase) && Number.isFinite(ms) && ms >= 0) {
      let key = diagnosticPhase(phase);
      durations[key] = (durations[key] || 0) + ms;
    }
    let course = safe(input.course || input.occ?.course), type = safe(input.type || input.occ?.type), error = input.error ? runError(input.error, { course, type, phase: input.error.phase || input.phase }) : null;
    if (error) for (let key of ["course", "message", "hint"]) error[key] = safe(error[key]);
    let timestamp = Date.parse(input.at || "");
    return {
      version: 1,
      at: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : (/* @__PURE__ */ new Date()).toISOString(),
      course,
      state: safe(input.state),
      phaseDurations: durations,
      courseKind: { course, type, resolved: resolveCourseKind({ course, type }), source: resolveCourseKind({ type }) ? "type" : resolveCourseKind({ course }) ? "course" : null },
      questionTitles: (input.questionTitles || []).slice(0, 100).map((q) => ({ before: safe(q.before), after: safe(q.after) })),
      error,
      ...typeof (input.key || input.occ?.key) == "string" ? { key: safe(input.key || input.occ.key) } : {},
      ...["already-set", "native", "goToday", "today-cell", "calendar", "foreground"].includes(input.dateFillPath) ? { dateFillPath: input.dateFillPath } : {},
      ...Array.isArray(input.dateDiag) ? { dateDiag: input.dateDiag.slice(-40).map((row) => ({ inBackground: row?.inBackground === !0, rectCount: Number.isSafeInteger(row?.rectCount) && row.rectCount >= 0 ? row.rectCount : 0, step: safe(row?.step), count: Number.isSafeInteger(row?.count) && row.count > 0 ? row.count : 1, ...typeof row?.disabled == "boolean" ? { disabled: row.disabled } : {}, ...typeof row?.text == "string" ? { text: safe(row.text).slice(0, 20) } : {}, ...["already-set", "native", "goToday", "today-cell"].includes(row?.path) ? { path: row.path } : {}, ...["visible", "hidden", "prerender"].includes(row?.visibilityState) ? { visibilityState: row.visibilityState } : {} })) } : {},
      ...Array.isArray(input.successPage) ? { successPage: input.successPage.slice(0, 100).map((row) => Object.fromEntries(["data-automation-id", "role", "aria-label", "title"].filter((key) => typeof row?.[key] == "string").map((key) => [key, safe(row[key]).slice(0, 250)]))) } : {}
    };
  }

  // src/preflight-page.js
  function schoolLoginAvailable(root = document) {
    let identity = [...root.querySelectorAll('[data-automation-id="userInfo"],[data-automation-id="userName"],[data-automation-id="userEmail"],[data-automation-id="accountInfo"],#O365_MainLink_Me')].map((el) => `${el.textContent} ${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""}`).join(" ");
    if (/[\w.+-]+@(?:[\w-]+\.)?(?:soton\.ac\.uk|southampton\.ac\.uk)/i.test(identity)) return !0;
    let notice = root.querySelector('[data-automation-id="noticeContainer"]')?.textContent || "", signedIn = /(?:Hi,|你好|您好).+(?:owner will see your name and email address|所有者.*姓名.*电子邮件)/i.test(notice), schoolTenant = [...root.querySelectorAll("a[href]")].some((a) => {
      try {
        return /^(?:www\.)?(?:southampton\.ac\.uk|soton\.ac\.uk)$/.test(new URL(a.href).hostname);
      } catch {
        return !1;
      }
    });
    return signedIn && schoolTenant;
  }
  async function runPreflightPage(key) {
    let startedAt = Date.now(), dateDiagStart = window.__dateDiag?.length || 0, profile, names = ["\u5DF2\u767B\u5F55\u5B66\u6821\u8D26\u53F7", "\u8BFE\u578B\u53EF\u89E3\u6790", "\u8868\u5355\u94FE\u63A5\u4E0E\u7ED1\u5B9A\u4E00\u81F4", "\u6807\u9898\u4E0E\u9898\u76EE\u6CA1\u53D8", "\u65E5\u671F\u683C\u5F0F\u53EF\u586B", "\u586B\u5199\u540E\u6838\u5BF9\u901A\u8FC7"], checks = names.map((name) => ({ name, ok: !1, hint: "\u524D\u7F6E\u68C0\u67E5\u672A\u901A\u8FC7\uFF0C\u5C1A\u672A\u68C0\u67E5\u3002" })), check = (name, ok, hint) => Object.assign(checks.find((c) => c.name === name), { ok, hint });
    try {
      let data = await chrome.runtime.sendMessage({ type: "GET_PREFLIGHT", key });
      if (profile = data?.profile, data?.error) throw Error(data.error);
      let deadline = Date.now() + FORMS_LOAD_MS;
      for (; !document.querySelector('[data-automation-id="questionItem"]') && Date.now() < deadline; ) await new Promise((resolve) => setTimeout(resolve, 500));
      let authenticated = schoolLoginAvailable();
      if (check(names[0], authenticated, authenticated ? "" : "\u9700\u8981\u91CD\u65B0\u767B\u5F55\u5B66\u6821 Microsoft \u8D26\u53F7\uFF1B\u767B\u5F55\u540E\u786E\u8BA4\u8868\u5355\u663E\u793A\u5B66\u6821\u8D26\u53F7\u8EAB\u4EFD\u3002"), !authenticated) throw Error(checks[0].hint);
      await prepareFill(data.binding, data.occ, data.profile, { onCheck: check });
    } catch (error) {
      checks.every((c) => c.hint === "\u524D\u7F6E\u68C0\u67E5\u672A\u901A\u8FC7\uFF0C\u5C1A\u672A\u68C0\u67E5\u3002") && check(names[0], !1, error.message);
    }
    await chrome.runtime.sendMessage({ type: "REPORT_PREFLIGHT", key, ok: checks.every((c) => c.ok), checks, elapsedMs: Math.max(0, Date.now() - startedAt), diagnostic: createDiagnostic({ dateDiag: (window.__dateDiag || []).slice(dateDiagStart) }, profile) });
  }

  // src/content.js
  var pause22 = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), items2 = () => [...document.querySelectorAll('[data-automation-id="questionItem"]')], submitButton = () => document.querySelector('[data-automation-id="submitButton"]'), formTitle2 = () => document.querySelector('[data-automation-id="formTitle"]')?.textContent?.trim() || "";
  function show(message, positive = !1) {
    let box = document.getElementById("attendance-helper-status");
    box || (box = document.createElement("aside"), box.id = "attendance-helper-status", box.setAttribute("role", "status"), box.setAttribute("aria-live", "polite"), box.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:2147483647;max-width:440px;padding:16px 20px;border-radius:12px;box-shadow:0 4px 24px #0003;font:15px/1.6 system-ui;color:white;white-space:pre-line", document.body.append(box)), box.style.background = positive ? "#253745" : "#11212d", box.textContent = message;
  }
  function assertSubmissionSnapshot(plan, binding, occ) {
    let fail = (code, message) => {
      throw runError({ code, message }, { course: occ.course, type: occ.type, phase: "submit" });
    };
    todayMalaysia() !== occ.date && fail("date_mismatch", "\u63D0\u4EA4\u524D\u8BFE\u7A0B\u65E5\u671F\u4E0E\u5F53\u524D\u65E5\u671F\u4E0D\u4E00\u81F4\uFF0C\u505C\u6B62\u63D0\u4EA4\u3002"), answersMatch(plan) || fail("answer_mismatch", "\u63D0\u4EA4\u524D\u8868\u5355\u7B54\u6848\u5DF2\u53D8\u5316\uFF0C\u505C\u6B62\u63D0\u4EA4\u3002"), formTitle2() !== binding.title && fail("form_schema_changed", "\u63D0\u4EA4\u524D\u8868\u5355\u6807\u9898\u5DF2\u53D8\u5316\uFF0C\u505C\u6B62\u63D0\u4EA4\u3002"), (!submitButton() || submitButton().disabled) && fail("phase_failed", "\u63D0\u4EA4\u6309\u94AE\u4E0D\u53EF\u7528\uFF0C\u505C\u6B62\u63D0\u4EA4\u3002");
  }
  function watchDryRun(plan, course, onInvalid) {
    let check = () => {
      if (answersMatch(plan)) return;
      clearInterval(timer), document.removeEventListener("input", check, !0), document.removeEventListener("change", check, !0);
      let failure = runError({ code: "answer_mismatch", message: "\u8868\u5355\u7B54\u6848\u5DF2\u53D8\u5316\uFF0C\u6838\u5BF9\u4E0D\u518D\u901A\u8FC7\uFF1B\u672A\u63D0\u4EA4\u3002" }, { course, phase: "fill" });
      show(formatRunError(failure)), onInvalid?.(failure);
    }, timer = setInterval(check, 1e3);
    document.addEventListener("input", check, !0), document.addEventListener("change", check, !0);
  }
  async function report(key, state, detail = "", extra = {}) {
    let result = await chrome.runtime.sendMessage({ type: "REPORT_RUN", key, state, detail, ...extra });
    if (result?.error) throw Error(result.error);
  }
  async function reportPhase(key, phase, diagnostic, submissionBefore) {
    let result = await chrome.runtime.sendMessage({ type: "REPORT_PHASE", key, phase, ...diagnostic ? { diagnostic } : {}, ...submissionBefore ? { submissionBefore } : {} });
    if (result?.error) throw Error(result.error);
  }
  async function run(key, checkCourse, setupId, itemId) {
    let reserved = !1, clicked = !1, confirmationTestMode = !1, allowForegroundFallback = !0, attemptId = crypto.randomUUID(), occ, binding, profile, phase = "validate", phaseStarted = Date.now(), phaseDurations = {}, questionTitles = [], enterPhase = (next) => {
      phaseDurations[phase] = (phaseDurations[phase] || 0) + Math.max(0, Date.now() - phaseStarted), phase = next, phaseStarted = Date.now();
    };
    window.__dateDiag = [];
    let diagnostic = (error) => {
      markDateDiagnostic("content:submitButton", { rectCount: submitButton()?.getClientRects().length || 0, visibilityState: document.visibilityState });
      let dateDiag = window.__dateDiag.slice(), dateFillPath = dateDiag.findLast((row) => row.path)?.path;
      return createDiagnostic({ occ, state: error ? "failed" : key ? "success" : "filled", error, phaseDurations: { ...phaseDurations, [phase]: (phaseDurations[phase] || 0) + Math.max(0, Date.now() - phaseStarted) }, questionTitles, dateDiag, dateFillPath }, profile);
    }, saveAttempt = (error) => chrome.runtime.sendMessage({ type: "REPORT_ATTEMPT", attemptId, course: occ?.course || checkCourse, setupId, itemId, diagnostic: diagnostic(error) }), setupMessage = async (type, extra = {}) => {
      let result = await chrome.runtime.sendMessage({ type, sessionId: setupId, itemId, ...extra });
      if (result?.error) throw Error(result.error);
      return result;
    };
    try {
      if (setupId) {
        let result = await setupMessage("GET_SETUP_ITEM");
        binding = result.binding, profile = result.profile, checkCourse = result.course, occ = { course: checkCourse, type: result.type, date: todayMalaysia(), time: "\u8BBE\u7F6E\u68C0\u67E5 \xB7 \u4E0D\u63D0\u4EA4" };
      } else if (key) {
        let result = await chrome.runtime.sendMessage({ type: "GET_RUN", key });
        if (result?.error) throw Error(result.error);
        ({ occ, binding, profile } = result), confirmationTestMode = result.confirmationTestMode === !0, allowForegroundFallback = result.allowForegroundFallback !== !1;
      } else {
        let data = await chrome.storage.local.get(["attendanceBindings", "attendanceProfile"]);
        binding = bindingForCourse(data.attendanceBindings, checkCourse), profile = data.attendanceProfile, occ = { course: checkCourse, date: todayMalaysia(), time: "\u4EC5\u586B\u5199\u6D4B\u8BD5" };
      }
      for (let item of items2()) questionTitles.push({ before: item.querySelector('[data-automation-id="questionTitle"]')?.textContent || "", after: questionTitle(item) });
      key && await reportPhase(key, "checking", diagnostic());
      let plan = await prepareFill(binding, occ, profile, { onFill: async () => {
        if (!key && !setupId) {
          let authorization = await chrome.runtime.sendMessage({ type: "AUTHORIZE_AUTOMATION" });
          if (authorization?.ok !== !0) throw Error(authorization?.error || "plugin_license_unavailable");
        }
        enterPhase("fill"), key && await reportPhase(key, "filling"), show(`${occ.course}
\u6B63\u5728\u586B\u5199\u5E76\u6838\u5BF9\u8D44\u6599\u2026`);
      } });
      if (!key) {
        if (await saveAttempt().catch(() => {
        }), setupId) {
          if (buildFillPlan(readQuestions(), binding.mapping, profile, todayMalaysia(), occ.course, occ.type), !answersMatch(plan) || todayMalaysia() !== occ.date || formTitle2() !== binding.title) throw Error("\u7B54\u6848\u3001\u8868\u5355\u6216\u65E5\u671F\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u68C0\u67E5\u3002");
          await setupMessage("REPORT_SETUP_ITEM", { state: "awaiting_confirmation" }), await setupMessage("CONFIRM_SETUP_ITEM"), show(`\u81EA\u52A8\u6838\u5BF9\u901A\u8FC7 \xB7 ${occ.course}
\u672A\u63D0\u4EA4\uFF0C\u7ED3\u679C\u5DF2\u4FDD\u5B58\u5230\u8BBE\u7F6E\u9875\u3002`, !0);
        } else
          show(`\u5DF2\u586B\u5199 \xB7 \u4EC5\u586B\u5199\uFF0C\u672A\u63D0\u4EA4
${occ.course}
\u5355\u9879\u9884\u89C8\u4E0D\u8BA1\u5165\u5B8C\u6574\u8BFE\u578B\u68C0\u67E5\u3002`, !0), watchDryRun(plan, occ.course, async (failure2) => {
            await saveAttempt(failure2).catch(() => {
            });
          });
        return;
      }
      if (enterPhase("submit"), assertBeforeCourseEnd(occ), todayMalaysia() !== occ.date) throw Error("\u63D0\u4EA4\u524D\u65E5\u671F\u5DF2\u53D8\u5316\uFF0C\u672A\u63D0\u4EA4\u3002");
      if (!answersMatch(plan)) throw Error("\u63D0\u4EA4\u524D\u8868\u5355\u7B54\u6848\u5DF2\u53D8\u5316\uFF0C\u672A\u63D0\u4EA4\u3002");
      if (!submitButton() || submitButton().disabled) throw Error("\u8868\u5355\u65E0\u6CD5\u63D0\u4EA4\u3002");
      let submitDelay = randomSubmitDelay();
      assertBeforeCourseEnd(occ, submitDelay + VALIDATION_MARGIN_MS), await reportPhase(key, "submitting"), show(`${occ.course}
\u8D44\u6599\u4E0E\u65E5\u671F\u6838\u5BF9\u901A\u8FC7\uFF0C\u5C06\u5728 ${Math.round(submitDelay / 1e3)} \u79D2\u540E\u63D0\u4EA4\u2026`), await pause22(submitDelay), assertBeforeCourseEnd(occ);
      let reservation = await chrome.runtime.sendMessage({ type: "RESERVE_SUBMISSION", key });
      if (reservation?.error) throw Error(reservation.error);
      if (!reservation?.granted) {
        if (reservation?.reason === "course_ended") {
          show(`${occ.course}
\u8BFE\u7A0B\u5DF2\u7ED3\u675F\uFF0C\u672A\u63D0\u4EA4\u3002`);
          return;
        }
        show(`${occ.course}
\u6B64\u65F6\u6BB5\u5DF2\u7ECF\u5C1D\u8BD5\u63D0\u4EA4\u8FC7\uFF0C\u4E3A\u907F\u514D\u91CD\u590D\u6253\u5361\u4E0D\u4F1A\u518D\u6B21\u70B9\u51FB\u63D0\u4EA4\u3002`);
        return;
      }
      reserved = !0, assertBeforeCourseEnd(occ), buildFillPlan(readQuestions(), binding.mapping, profile, occ.date, occ.course, occ.type), assertSubmissionSnapshot(plan, binding, occ), assertSubmissionSnapshot(plan, binding, occ);
      let before = { questionCount: items2().length, submitVisible: !!submitButton() };
      await reportPhase(key, "confirming", void 0, before), show(`${occ.course}
\u8D44\u6599\u4E0E\u65E5\u671F\u6838\u5BF9\u901A\u8FC7\uFF0C\u6B63\u5728\u63D0\u4EA4\u2026`), assertBeforeCourseEnd(occ), submitButton().click(), clicked = !0;
      let structureSeen = !1, confirmationDeadline = Date.now() + CONFIRMATION_WAIT_MS;
      for (let i = 0; i < 60 && Date.now() < confirmationDeadline; i++) {
        await pause22(500);
        let outcome = submissionSignals(before, confirmationPage(document), { structureSelectorsEnabled: !0 });
        if (structureSeen = structureSeen || outcome.signal === "structure_change", outcome.state === "failed") {
          let failure2 = runError({ code: "submission_error", message: outcome.signal }, { course: occ.course, type: occ.type, phase: "submit" });
          await report(key, "failed", formatRunError(failure2), { error: failure2, diagnostic: diagnostic(failure2) }), show(formatRunError(failure2));
          return;
        }
        if (outcome.state === "success") {
          await report(key, "success", outcome.signal, { diagnostic: { ...diagnostic(), ...confirmationTestMode ? { successPage: createDiagnostic({ successPage: successPageSummary(document) }, profile).successPage } : {} } }), show(`\u6253\u5361\u6210\u529F
${occ.course}`, !0);
          return;
        }
      }
      let failure = runError({ code: "submit_unconfirmed" }, { course: occ.course, type: occ.type, phase });
      await report(key, "submitted_pending_confirmation", structureSeen ? "structure_change" : "none", { error: failure, diagnostic: diagnostic(failure) }), show(formatRunError(failure));
    } catch (error) {
      let failure = runError(error, { course: occ?.course || checkCourse, type: occ?.type, phase });
      if (show(formatRunError(failure)), key && error.code === "date_fill_hidden_tab" && !reserved && !clicked) {
        let message = { key, state: "failed", submissionNotClicked: !0, error: failure, detail: formatRunError(failure), diagnostic: diagnostic(failure) };
        allowForegroundFallback ? await chrome.runtime.sendMessage({ type: "NEED_FOREGROUND", ...message }) : await report(key, "failed", message.detail, message);
        return;
      }
      if (key || await saveAttempt(failure).catch(() => {
      }), setupId && await setupMessage("REPORT_SETUP_ITEM", { state: "failed", detail: formatRunError(failure), error: failure }).catch(() => {
      }), key) try {
        let missed = ["course_ended", "schedule_week_inactive"].includes(error.code) && !clicked;
        await report(key, missed ? "missed" : reserved ? "submitted_pending_confirmation" : "failed", formatRunError(failure), { error: failure, diagnostic: diagnostic(failure), ...missed ? { submissionNotClicked: !0 } : {} });
      } catch {
      }
    }
  }
  async function resumeConfirmation(active) {
    let deadline = Date.now() + CONFIRMATION_WAIT_MS;
    do {
      let outcome = submissionSignals(active.submissionBefore || {}, confirmationPage(document), { structureSelectorsEnabled: !0 });
      if (outcome.state === "success") {
        await report(active.key, "success", outcome.signal, { diagnostic: active.confirmationTestMode ? { successPage: successPageSummary(document) } : {} }), show(`\u6253\u5361\u6210\u529F
Microsoft Forms \u5DF2\u786E\u8BA4\u63D0\u4EA4\u6210\u529F`, !0);
        return;
      }
      if (outcome.state === "failed") {
        let failure = runError({ code: "submission_error" }, { phase: "submit" });
        active.state === "pending" && await report(active.key, "failed", outcome.signal, { error: failure }), show(formatRunError(failure));
        return;
      }
      await pause22(500);
    } while (Date.now() < deadline);
    active.state === "pending" && await report(active.key, "submitted_pending_confirmation", "none", { error: runError({ code: "submit_unconfirmed" }, { phase: "submit" }) }), show("\u5DF2\u5C1D\u8BD5\u63D0\u4EA4\uFF0C\u5C1A\u672A\u786E\u8BA4\u8BB0\u5F55\u3002\u8BF7\u5728\u8BBE\u7F6E\u9875\u624B\u52A8\u6838\u67E5\uFF1B\u7CFB\u7EDF\u4E0D\u4F1A\u81EA\u52A8\u91CD\u65B0\u63D0\u4EA4\u3002");
  }
  globalThis.__attendanceContentLoaded || (globalThis.__attendanceContentLoaded = !0, (async () => {
    let preflightKey = new URLSearchParams(location.hash.slice(1)).get("attendancePreflight");
    if (preflightKey) {
      history.replaceState(null, "", location.pathname + location.search), await runPreflightPage(preflightKey);
      return;
    }
    let identity = await chrome.runtime.sendMessage({ type: "WHO_AM_I" }).catch(() => null);
    if (identity?.kind === "preflight") {
      await runPreflightPage(identity.key);
      return;
    }
    let key, checkCourse, setupId, itemId;
    if (identity?.kind === "run") key = identity.key;
    else if (identity?.kind === "check") checkCourse = identity.course;
    else if (identity?.kind === "setup") ({ setupId, itemId } = identity);
    else {
      let hash = new URLSearchParams(location.hash.slice(1));
      key = hash.get("attendanceRun"), checkCourse = hash.get("attendanceCheck"), setupId = hash.get("attendanceSetup"), itemId = hash.get("attendanceItem");
    }
    if ((key || checkCourse || setupId) && history.replaceState(null, "", location.pathname + location.search), !key && !checkCourse && !setupId) {
      let active = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_RUN" });
      if (active?.key && ["pending", "submitted_pending_confirmation"].includes(active.state)) {
        await resumeConfirmation(active);
        return;
      }
      globalThis.__attendanceContentLoaded = !1;
    }
    if (key)
      try {
        await reportPhase(key, "reading");
      } catch (error) {
        show(error.message);
        return;
      }
    let readyDeadline = Date.now() + FORMS_LOAD_MS;
    for (let i = 0; i < 120 && !submitButton() && Date.now() < readyDeadline; i++) await pause22(500);
    if (!submitButton()) {
      (key || setupId) && await run(key, null, setupId, itemId);
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: "FORM_READY", url: location.href, title: formTitle2(), questions: readQuestions() }).catch(() => {
      });
    } catch (error) {
      chrome.runtime.sendMessage({ type: "FORM_SETUP_ERROR", error: error.message }).catch(() => {
      });
    }
    (key || checkCourse || setupId) && await run(setupId ? null : key, checkCourse, setupId, itemId);
  })());
})();
