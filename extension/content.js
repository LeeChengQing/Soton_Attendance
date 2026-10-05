(() => {
  // src/forms.js
  var HOSTS = /* @__PURE__ */ new Set(["forms.office.com", "forms.cloud.microsoft"]);
  var normalize = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  var normalizeComparable = (value) => normalize(String(value ?? "").normalize("NFKC"));
  function sameDateValue(actual, expected) {
    const pattern = /^\s*\d{1,4}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{1,4}\s*$/;
    if (!pattern.test(String(actual || "")) || !pattern.test(String(expected || ""))) return false;
    const left = String(actual).match(/\d+/g), right = String(expected).match(/\d+/g);
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
    url.hash = "";
    return url;
  }
  function verifyQuestions(questions, mapping) {
    if (!Array.isArray(questions) || questions.length !== mapping?.length) return false;
    const actual = new Map(questions.map((q) => [normalizeComparable(q.title), q]));
    return mapping.every((entry) => {
      const q = actual.get(normalizeComparable(entry.title));
      if (!q || q.type !== entry.type) return false;
      if (q.type !== "radio") return true;
      return JSON.stringify([...new Set(optionList(q))].sort()) === JSON.stringify([...new Set(optionList(entry))].sort());
    });
  }
  var successRules = [
    ["en_answers_submitted", /\byour answers? have been submitted successfully\b/i],
    ["en_response_submitted", /\byour response was submitted\b/i],
    ["en_response_recorded", /\byour response has been (?:submitted|recorded)\b/i],
    ["zh_response_submitted", /(?:你的|您的)(?:响应|答复|回复)已(?:成功)?(?:提交|记录)/i],
    ["ms_response_submitted", /(?:respons|jawapan)\s+(?:anda|awak)\s+(?:telah|sudah)\s+(?:dihantar|dihantar(?:kan)?|direkodkan)/i],
    ["ms_thanks_submitted", /terima kasih[\s,，]*(?:respons|jawapan).*?(?:dihantar|direkodkan)/i]
  ];
  function isExplicitSuccess(text) {
    const value = String(text || "");
    return successRules.find(([, rule]) => rule.test(value))?.[0] || null;
  }
  function structureChanged(before = {}, after = {}, enabled = false) {
    if (!enabled) return false;
    return before.questionCount !== after.questionCount || before.submitVisible !== after.submitVisible;
  }
  function submissionSignals(before = {}, after = {}, options = {}) {
    const textSignal = isExplicitSuccess(after.text);
    if (textSignal) return { state: "success", signal: textSignal };
    if (structureChanged(before, after, options.structureSelectorsEnabled === true)) return { state: "submitted_pending_confirmation", signal: "structure_change" };
    return { state: "submitted_pending_confirmation", signal: "none" };
  }
  var questionKey = (question) => normalizeComparable(question?.title);
  var optionList = (question) => [...question?.options || []].map(normalizeComparable);
  function questionSignature(question) {
    return `${question?.type || ""}|${[...new Set(optionList(question))].sort().join("")}`;
  }
  function questionDiff(expected = [], actual = []) {
    const left = new Map(expected.map((q) => [questionKey(q), q])), right = new Map(actual.map((q) => [questionKey(q), q]));
    const added = [], deleted = [], renamed = [], options = [];
    for (const key of left.keys()) if (!right.has(key)) deleted.push(key);
    for (const key of right.keys()) if (!left.has(key)) added.push(key);
    for (const key of left.keys()) {
      const q = right.get(key);
      if (!q) continue;
      if (q.type !== left.get(key).type) renamed.push({ from: key, to: key });
      const before = [...new Set(optionList(left.get(key)))].sort(), after = [...new Set(optionList(q))].sort();
      if (JSON.stringify(before) !== JSON.stringify(after)) options.push({ title: key, added: after.filter((v) => !before.includes(v)), removed: before.filter((v) => !after.includes(v)) });
    }
    const unmatchedLeft = deleted.map((key) => left.get(key)), unmatchedRight = added.map((key) => right.get(key));
    for (const oldQuestion of unmatchedLeft) {
      const index = unmatchedRight.findIndex((q) => questionSignature(q) === questionSignature(oldQuestion));
      if (index < 0) continue;
      const [newQuestion] = unmatchedRight.splice(index, 1), oldKey = questionKey(oldQuestion), newKey = questionKey(newQuestion);
      deleted.splice(deleted.indexOf(oldKey), 1);
      added.splice(added.indexOf(newKey), 1);
      renamed.push({ from: oldKey, to: newKey });
    }
    return { added: added.sort(), deleted: deleted.sort(), renamed: renamed.sort((a, b) => a.from.localeCompare(b.from)), options: options.sort((a, b) => a.title.localeCompare(b.title)) };
  }
  function formatDate(placeholder, date) {
    const [y, m, d] = date.split("-");
    const format = String(placeholder || "").match(/(?:yyyy|MM|M|dd|d)[/.-](?:yyyy|MM|M|dd|d)[/.-](?:yyyy|MM|M|dd|d)/)?.[0];
    if (!format) throw Error("\u65E0\u6CD5\u8BC6\u522B\u8868\u5355\u65E5\u671F\u683C\u5F0F\u3002");
    return format.replace(/yyyy|MM|dd|M|d/g, (t) => ({ yyyy: y, MM: m, M: String(+m), dd: d, d: String(+d) })[t]);
  }
  function deliveryFromCourse(course) {
    if (/(?:^|\W)(?:tut|tutorial)\b/i.test(course || "")) return "tutorial";
    if (/(?:^|\W)(?:lab|laboratory)\b/i.test(course || "")) return "lab";
    if (/(?:^|\W)(?:lec|lecture)\b/i.test(course || "")) return "lecture";
    throw Error("\u65E0\u6CD5\u5224\u65AD\u6B64\u8BFE\u7A0B\u7C7B\u578B\uFF0C\u8BF7\u9009\u62E9 Lecture\u3001Tutorial \u6216 Laboratory\u3002");
  }
  function deliveryOption(options, target) {
    return options.find((value) => target === "lab" ? ["lab", "laboratory"].includes(normalize(value)) : normalize(value) === target);
  }
  function identityOption(options, target) {
    return options.find((value) => target === "international" ? /international/i.test(value) : /\blocal\b/i.test(value) && !/international/i.test(value));
  }
  function buildFillPlan(questions, mapping, profile, date, course) {
    if (!verifyQuestions(questions, mapping)) {
      const error = Error("\u8868\u5355\u9898\u76EE\u53D1\u751F\u53D8\u5316\uFF0C\u5DF2\u505C\u6B62\u3002");
      error.code = "form_schema_changed";
      error.diff = questionDiff(mapping, questions);
      throw error;
    }
    return mapping.map((entry, i) => {
      const q = questions.find((item) => normalizeComparable(item.title) === normalizeComparable(entry.title));
      let value;
      if (q.type === "date" && q.required === false) return { type: "date", field: entry.field, skip: true };
      const expectedType = ["student", "name"].includes(entry.field) ? "text" : entry.field === "date" ? "date" : /^(?:delivery|local)(?::|$)/.test(entry.field) ? "radio" : null;
      if (expectedType && q.type !== expectedType) throw Error(`\u7B2C ${i + 1} \u9898\u6620\u5C04\u4E0E\u9898\u578B\u4E0D\u4E00\u81F4\uFF0C\u672A\u63D0\u4EA4\u3002`);
      if (entry.field === "student") value = profile.student;
      else if (entry.field === "name") value = profile.name;
      else if (entry.field === "date") value = q.nativeDate ? date : formatDate(q.placeholder, date);
      else if (entry.field === "delivery" || ["delivery:lecture", "delivery:tutorial", "delivery:lab", "delivery:laboratory"].includes(entry.field)) {
        const target = entry.field === "delivery" ? deliveryFromCourse(course) : entry.field.split(":")[1];
        value = deliveryOption(q.options || [], target === "laboratory" ? "lab" : target);
      } else if (entry.field === "local" || ["local:local", "local:international"].includes(entry.field)) {
        const target = entry.field === "local" ? profile.studentType : entry.field.split(":")[1];
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
  async function fillDate(input, expected) {
    if (input.getAttribute("aria-expanded") !== "true") input.click();
    const root = () => document.getElementById(input.getAttribute("aria-controls")) || document;
    const visible = (el) => el && el.getClientRects().length;
    let goToday;
    for (let i = 0; i < 50; i++) {
      goToday = [...root().querySelectorAll('button,[role="button"],a.js-goToday')].find((el) => visible(el) && (el.matches(".js-goToday") || /^(?:转到今日|转到今天|go to today)$/i.test((el.getAttribute("aria-label") || el.textContent || "").trim())));
      if (goToday) break;
      await pause(100);
    }
    if (!goToday) throw Error("\u627E\u4E0D\u5230\u65E5\u671F\u63A7\u4EF6\u4E2D\u7684\u201C\u8F6C\u5230\u4ECA\u65E5\u201D\uFF0C\u672A\u63D0\u4EA4\u3002");
    if (!goToday.disabled && goToday.getAttribute("aria-disabled") !== "true") goToday.click();
    await pause(200);
    const currentDay = () => {
      const cell = root().querySelector('[role="gridcell"][aria-current="date"]:not([aria-disabled="true"])');
      if (visible(cell)) {
        const day = cell.querySelector("button") || cell;
        if (!day.disabled && day.getAttribute("aria-disabled") !== "true") return day;
      }
      const button = root().querySelector("button.ms-CalendarDay-dayIsToday");
      return button && !button.disabled && button.getClientRects().length ? button : null;
    };
    let today = null;
    for (let i = 0; i < 50; i++) {
      today = currentDay();
      if (today) break;
      await pause(100);
    }
    if (!today) throw Error("\u627E\u4E0D\u5230\u65E5\u671F\u63A7\u4EF6\u4E2D\u7684\u4ECA\u5929\uFF0C\u672A\u63D0\u4EA4\u3002");
    today.click();
    for (let i = 0; i < 20 && !sameDateValue(input.value, expected); i++) await pause(100);
    if (!sameDateValue(input.value, expected)) throw Error("\u8868\u5355\u9009\u4E2D\u7684\u65E5\u671F\u4E0E\u4ECA\u65E5\u65E5\u671F\u4E0D\u4E00\u81F4\uFF0C\u672A\u63D0\u4EA4\u3002");
  }

  // src/schedule.js
  function todayMalaysia(now = /* @__PURE__ */ new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((p) => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  // src/bindings.js
  function moduleKey(course) {
    const text = String(course || "").trim();
    return text.match(/\b[A-Za-z]{2,}\d{3,}\b/)?.[0].toUpperCase() || text;
  }
  function bindingForCourse(bindings, course) {
    const key = moduleKey(course), binding = bindings?.[key];
    return binding?.scope === "module" || String(course || "").trim() === key ? binding : void 0;
  }
  function validateBindingForCourse(binding, course, profile, date) {
    if (!binding?.verified) throw Error(`${moduleKey(course)} \u5C1A\u672A\u7ED1\u5B9A\u5E76\u6838\u5BF9\u5171\u7528\u8868\u5355\u3002`);
    if (!binding.questions) return null;
    const plan = buildFillPlan(binding.questions, binding.mapping, profile, date, course);
    for (const [i, entry] of binding.mapping.entries()) {
      if (!entry.field?.startsWith("delivery:")) continue;
      const automatic = binding.mapping.map((item, index) => index === i ? { ...item, field: "delivery" } : item);
      let expected;
      try {
        expected = buildFillPlan(binding.questions, automatic, profile, date, course)[i].value;
      } catch (error) {
        if (/无法判断此课程类型/.test(error.message)) continue;
        throw error;
      }
      if (plan[i].value !== expected) throw Error(`${course} \u7684\u56FA\u5B9A\u8BFE\u578B\u4E0E\u8BFE\u7A0B\u540D\u79F0\u4E0D\u4E00\u81F4\uFF0C\u8BF7\u91CD\u65B0\u6838\u5BF9\u5171\u7528\u8868\u5355\u3002`);
    }
    return plan;
  }

  // src/submit-delay.js
  var MIN_SUBMIT_DELAY_SECONDS = 15;
  var MAX_SUBMIT_DELAY_SECONDS = 20;
  function randomSubmitDelay(random = Math.random) {
    const seconds = MIN_SUBMIT_DELAY_SECONDS + Math.min(
      MAX_SUBMIT_DELAY_SECONDS - MIN_SUBMIT_DELAY_SECONDS,
      Math.floor(random() * (MAX_SUBMIT_DELAY_SECONDS - MIN_SUBMIT_DELAY_SECONDS + 1))
    );
    return seconds * 1e3;
  }

  // src/content.js
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
  function readQuestions() {
    return items().map((item) => {
      const inputs = [...item.querySelectorAll("input")], radio = inputs.filter((e) => e.type === "radio");
      const title = item.querySelector('[data-automation-id="questionTitle"]')?.textContent?.trim() || "";
      const date = inputs.find((e) => e.type === "date" || e.getAttribute("role") === "combobox" && (/date|日期/i.test(title) || /yyyy|yy|MM[/.-]|[/.-]MM/i.test(e.placeholder)));
      const text = inputs.filter((e) => e.matches('[data-automation-id="textInput"]'));
      if (item.querySelector('textarea,select,input[type="checkbox"]') || !radio.length && !date && text.length !== 1) throw Error("\u8868\u5355\u542B\u6682\u4E0D\u652F\u6301\u7684\u9898\u578B\uFF0C\u65E0\u6CD5\u542F\u7528\u81EA\u52A8\u6253\u5361\u3002");
      const required = Boolean(item.querySelector('[required],[aria-required="true"],[data-automation-id="questionRequired"],[data-automation-id="requiredStar"],[aria-label="Required"],[aria-label="\u5FC5\u586B"]')) || /\*/.test(title) || item.getAttribute("data-required") === "true";
      return { title, type: radio.length ? "radio" : date ? "date" : "text", required, placeholder: date?.placeholder || "", nativeDate: date?.type === "date", options: radio.map((e) => e.value) };
    });
  }
  function control(index, entry) {
    const item = items().find((candidate) => normalizeComparable(candidate.querySelector('[data-automation-id="questionTitle"]')?.textContent || "") === normalizeComparable(entry.questionTitle)) || items()[index];
    if (!item) return null;
    if (entry.type === "radio") return [...item.querySelectorAll('input[type="radio"]')].find((e) => e.value === entry.value);
    return item.querySelector(entry.type === "date" ? 'input[role="combobox"],input[type="date"]' : 'input[data-automation-id="textInput"]');
  }
  async function fill(plan) {
    for (let i = 0; i < plan.length; i++) {
      const entry = plan[i], el = control(i, entry);
      if (entry.skip) continue;
      if (!el || el.disabled || el.readOnly && entry.type !== "date") throw Error(`\u7B2C ${i + 1} \u9898\u65E0\u6CD5\u586B\u5199\u3002`);
      if (entry.type === "radio") el.click();
      else if (entry.type === "date" && el.type !== "date") await fillDate(el, entry.value);
      else {
        el.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, entry.value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.blur();
      }
      await pause2(180);
    }
    await pause2(500);
    if (!answersMatch(plan)) throw Error("\u586B\u5199\u540E\u7684\u7B54\u6848\u6216\u65E5\u671F\u6838\u5BF9\u5931\u8D25\uFF0C\u672A\u63D0\u4EA4\u3002");
  }
  function answersMatch(plan) {
    const questions = items();
    if (questions.length !== plan.length) return false;
    return plan.every((entry, i) => {
      if (entry.skip) return true;
      const el = control(i, entry);
      if (!el || el.getAttribute("aria-invalid") === "true") return false;
      if (entry.type === "radio") {
        const checked = [...questions[i].querySelectorAll('input[type="radio"]')].filter((input) => input.checked);
        return checked.length === 1 && checked[0] === el && el.value === entry.value;
      }
      return entry.type === "date" ? sameDateValue(el.value, entry.value) : el.value === entry.value;
    });
  }
  function watchDryRun(plan, course, onInvalid) {
    const check = () => {
      if (answersMatch(plan)) return;
      clearInterval(timer);
      document.removeEventListener("input", check, true);
      document.removeEventListener("change", check, true);
      show(`${course}
\u8868\u5355\u7B54\u6848\u5DF2\u53D8\u5316\uFF0C\u6838\u5BF9\u4E0D\u518D\u901A\u8FC7\uFF1B\u672A\u63D0\u4EA4\u3002`);
      onInvalid?.();
    };
    const timer = setInterval(check, 1e3);
    document.addEventListener("input", check, true);
    document.addEventListener("change", check, true);
  }
  async function report(key, state, detail = "") {
    const result = await chrome.runtime.sendMessage({ type: "REPORT_RUN", key, state, detail });
    if (result?.error) throw Error(result.error);
  }
  async function reportPhase(key, phase) {
    const result = await chrome.runtime.sendMessage({ type: "REPORT_PHASE", key, phase });
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
    const setupMessage = async (type, extra = {}) => {
      const result = await chrome.runtime.sendMessage({ type, sessionId: setupId, itemId, ...extra });
      if (result?.error) throw Error(result.error);
      return result;
    };
    try {
      let occ, binding, profile;
      if (setupId) {
        const result = await setupMessage("GET_SETUP_ITEM");
        binding = result.binding;
        profile = result.profile;
        checkCourse = result.course;
        occ = { course: checkCourse, date: todayMalaysia(), time: "\u8BBE\u7F6E\u68C0\u67E5 \xB7 \u4E0D\u63D0\u4EA4" };
      } else if (key) {
        const result = await chrome.runtime.sendMessage({ type: "GET_RUN", key });
        if (result?.error) throw Error(result.error);
        ({ occ, binding, profile } = result);
      } else {
        const data = await chrome.storage.local.get(["attendanceBindings", "attendanceProfile"]);
        binding = bindingForCourse(data.attendanceBindings, checkCourse);
        profile = data.attendanceProfile;
        occ = { course: checkCourse, date: todayMalaysia(), time: "\u4EC5\u586B\u5199\u6D4B\u8BD5" };
      }
      if (!binding?.verified || !profile?.student || !profile?.name) throw Error("\u8BF7\u5148\u5728\u6269\u5C55\u8BBE\u7F6E\u9875\u5B8C\u6210\u8D44\u6599\u548C\u8868\u5355\u914D\u7F6E\u3002");
      validateBindingForCourse(binding, occ.course, profile, occ.date);
      const now = /* @__PURE__ */ new Date(), computerDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const expected = validateFormsUrl(binding.url), actual = validateFormsUrl(location.href);
      if (expected.hostname !== actual.hostname || expected.pathname !== actual.pathname || expected.searchParams.get("id") !== actual.searchParams.get("id")) throw Error("\u5F53\u524D\u8868\u5355\u4E0E\u8BFE\u7A0B\u7ED1\u5B9A\u7684\u8868\u5355\u4E0D\u4E00\u81F4\u3002");
      if (formTitle() !== binding.title) throw Error("\u8868\u5355\u6807\u9898\u53D1\u751F\u53D8\u5316\uFF0C\u672A\u63D0\u4EA4\u3002");
      const plan = buildFillPlan(readQuestions(), binding.mapping, profile, occ.date, occ.course);
      const requiresDate = plan.some((entry) => entry.type === "date" && !entry.skip);
      if (requiresDate) assertDateAgreement(occ.date, todayMalaysia(now), computerDate);
      show(`${occ.course}
\u6B63\u5728\u586B\u5199\u5E76\u6838\u5BF9\u8D44\u6599${requiresDate ? "\u4E0E\u5F53\u65E5\u65E5\u671F" : ""}\u2026`);
      if (key) await reportPhase(key, "checking");
      if (key) await reportPhase(key, "filling");
      await fill(plan);
      if (!answersMatch(plan)) throw Error("\u8868\u5355\u7B54\u6848\u5DF2\u53D8\u5316\uFF0C\u672A\u901A\u8FC7\u6838\u5BF9\uFF1B\u672A\u63D0\u4EA4\u3002");
      if (!key) {
        const delivery = plan.find((entry) => entry.field?.startsWith("delivery"))?.value;
        show(`\u5DF2\u586B\u5199 \xB7 \u4EC5\u586B\u5199\uFF0C\u672A\u63D0\u4EA4
${occ.course}${delivery ? ` \xB7 Module Delivery: ${delivery}` : ""}${setupId ? "\n\u8BF7\u9010\u9898\u67E5\u770B\u7B54\u6848\uFF0C\u518D\u786E\u8BA4\u6B64\u8BFE\u578B\u3002" : "\n\u8BF7\u67E5\u770B\u7B54\u6848\uFF1B\u5355\u9879\u6D4B\u8BD5\u4E0D\u8BA1\u5165\u5B8C\u6574\u8BBE\u7F6E\u68C0\u67E5\u3002"}`, true);
        if (setupId) {
          await setupMessage("REPORT_SETUP_ITEM", { state: "awaiting_confirmation" });
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = "\u6211\u5DF2\u67E5\u770B\u5E76\u786E\u8BA4\u5168\u90E8\u7B54\u6848";
          button.style.cssText = "display:block;margin-top:12px;padding:10px 14px;font:inherit;cursor:pointer";
          button.addEventListener("click", async () => {
            button.disabled = true;
            try {
              buildFillPlan(readQuestions(), binding.mapping, profile, todayMalaysia(), occ.course);
              if (!answersMatch(plan) || todayMalaysia() !== occ.date || formTitle() !== binding.title) throw Error("\u7B54\u6848\u3001\u8868\u5355\u6216\u65E5\u671F\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u68C0\u67E5\u3002");
              await setupMessage("CONFIRM_SETUP_ITEM");
              show(`\u5DF2\u786E\u8BA4\u6B64\u8BFE\u578B \xB7 ${occ.course}
\u672A\u63D0\u4EA4\u3002\u8BF7\u8FD4\u56DE\u8BBE\u7F6E\u9875\u67E5\u770B\u8FDB\u5EA6\u3002`, true);
            } catch (error) {
              show(error.message);
              await setupMessage("REPORT_SETUP_ITEM", { state: "failed", detail: error.message }).catch(() => {
              });
            }
          });
          document.getElementById("attendance-helper-status").append(button);
        }
        watchDryRun(plan, occ.course, setupId ? () => setupMessage("REPORT_SETUP_ITEM", { state: "failed", detail: "\u8868\u5355\u7B54\u6848\u5DF2\u53D8\u5316\uFF0C\u6838\u5BF9\u4E0D\u518D\u901A\u8FC7\uFF1B\u672A\u63D0\u4EA4\u3002" }).catch(() => {
        }) : null);
        return;
      }
      if (todayMalaysia() !== occ.date) throw Error("\u63D0\u4EA4\u524D\u65E5\u671F\u5DF2\u53D8\u5316\uFF0C\u672A\u63D0\u4EA4\u3002");
      if (!answersMatch(plan)) throw Error("\u63D0\u4EA4\u524D\u8868\u5355\u7B54\u6848\u5DF2\u53D8\u5316\uFF0C\u672A\u63D0\u4EA4\u3002");
      if (!submitButton() || submitButton().disabled) throw Error("\u8868\u5355\u65E0\u6CD5\u63D0\u4EA4\u3002");
      const reservation = await chrome.runtime.sendMessage({ type: "RESERVE_SUBMISSION", key });
      if (reservation?.error) throw Error(reservation.error);
      if (!reservation?.granted) {
        show(`${occ.course}
\u6B64\u65F6\u6BB5\u5DF2\u7ECF\u5C1D\u8BD5\u63D0\u4EA4\u8FC7\uFF0C\u4E3A\u907F\u514D\u91CD\u590D\u6253\u5361\u4E0D\u4F1A\u518D\u6B21\u70B9\u51FB\u63D0\u4EA4\u3002`);
        return;
      }
      reserved = true;
      buildFillPlan(readQuestions(), binding.mapping, profile, occ.date, occ.course);
      if (todayMalaysia() !== occ.date || !answersMatch(plan) || formTitle() !== binding.title || !submitButton() || submitButton().disabled) throw Error("\u6388\u6743\u540E\u8868\u5355\u6216\u65E5\u671F\u5DF2\u53D8\u5316\uFF0C\u505C\u6B62\u63D0\u4EA4\u3002");
      const submitDelay = randomSubmitDelay();
      show(`${occ.course}
\u8D44\u6599\u4E0E\u65E5\u671F\u6838\u5BF9\u901A\u8FC7\uFF0C\u5C06\u5728 ${Math.round(submitDelay / 1e3)} \u79D2\u540E\u63D0\u4EA4\u2026`);
      await pause2(submitDelay);
      if (todayMalaysia() !== occ.date || !answersMatch(plan) || formTitle() !== binding.title || !submitButton() || submitButton().disabled) throw Error("\u7B49\u5F85\u671F\u95F4\u8868\u5355\u6216\u65E5\u671F\u53D1\u751F\u53D8\u5316\uFF0C\u505C\u6B62\u63D0\u4EA4\u3002");
      await reportPhase(key, "confirming");
      const before = { questionCount: items().length, submitVisible: Boolean(submitButton()) };
      show(`${occ.course}
\u8D44\u6599\u4E0E\u65E5\u671F\u6838\u5BF9\u901A\u8FC7\uFF0C\u6B63\u5728\u63D0\u4EA4\u2026`);
      submitButton().click();
      let structureSeen = false;
      for (let i = 0; i < 60; i++) {
        await pause2(500);
        const after = { text: document.body.innerText.replace(document.getElementById("attendance-helper-status")?.innerText || "", ""), questionCount: items().length, submitVisible: Boolean(submitButton()) };
        const outcome = submissionSignals(before, after, { structureSelectorsEnabled: false });
        structureSeen = structureSeen || outcome.signal === "structure_change";
        if (outcome.state === "success") {
          await report(key, "success", outcome.signal);
          show(`\u6253\u5361\u6210\u529F
${occ.course}`, true);
          return;
        }
      }
      await report(key, "submitted_pending_confirmation", structureSeen ? "structure_change" : "none");
      show(`${occ.course}
\u5DF2\u70B9\u51FB\u63D0\u4EA4\u4F46\u5C1A\u672A\u786E\u8BA4\u7ED3\u679C\uFF0C\u8BF7\u624B\u52A8\u68C0\u67E5\uFF1B\u4E0D\u4F1A\u91CD\u590D\u63D0\u4EA4\u3002`);
    } catch (error) {
      show(`${checkCourse || key}
${error.message}${error.diff ? `
${diffDescription(error.diff)}` : ""}`);
      if (setupId) await setupMessage("REPORT_SETUP_ITEM", { state: "failed", detail: error.message }).catch(() => {
      });
      if (key) try {
        await report(key, reserved ? "submitted_pending_confirmation" : "failed", reserved ? "phase_error" : error.code === "form_schema_changed" ? "schema_changed" : safeRunDetail(error.message));
      } catch {
      }
    }
  }
  if (!globalThis.__attendanceContentLoaded) {
    globalThis.__attendanceContentLoaded = true;
    (async () => {
      const hash = new URLSearchParams(location.hash.slice(1));
      const key = hash.get("attendanceRun"), checkCourse = hash.get("attendanceCheck");
      const setupId = hash.get("attendanceSetup"), itemId = hash.get("attendanceItem");
      if (key || checkCourse || setupId) history.replaceState(null, "", location.pathname + location.search);
      for (let i = 0; i < 120 && !submitButton(); i++) await pause2(500);
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
})();
