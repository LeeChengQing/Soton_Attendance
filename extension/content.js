(() => {
  // src/forms.js
  var HOSTS = /* @__PURE__ */ new Set(["forms.office.com", "forms.cloud.microsoft"]);
  var normalize = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  var normalizeComparable = (value) => normalize(String(value ?? "").normalize("NFKC"));
  function calendarDate(value, order = "") {
    const text = String(value || "").normalize("NFKC").trim();
    if (!/^\d{1,4}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{1,4}$/.test(text)) return [];
    const parts = text.match(/\d+/g);
    if (!parts || parts.length !== 3) return [];
    let y, m, d;
    if (order) {
      const names = order.split(/[/.-]/).map((part) => part.toLowerCase());
      const values = Object.fromEntries(names.map((name, index) => [name[0], Number(parts[index])]));
      ({ y, m, d } = values);
    } else if (parts[0].length === 4) [y, m, d] = parts.map(Number);
    else if (parts[2].length === 4) {
      const [first, second, year] = parts.map(Number);
      const candidates = [[year, first, second], [year, second, first]];
      return candidates.map((value2) => canonicalDate(...value2)).filter(Boolean);
    } else return [];
    const normalized = canonicalDate(y, m, d);
    return normalized ? [normalized] : [];
  }
  function canonicalDate(year, month, day) {
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  function sameDateValue(actual, expected, formatHint = "") {
    const hint = formatHint.match(/(?:yyyy|yy|MM|M|dd|d)([/.-])(?:yyyy|yy|MM|M|dd|d)(?:\1)(?:yyyy|yy|MM|M|dd|d)/i)?.[0] || "";
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(String(expected || ""));
    const actualIso = /^\d{4}-\d{2}-\d{2}$/.test(String(actual || ""));
    const expectedCanonical = calendarDate(expected, iso ? "" : hint), actualCanonical = calendarDate(actual, actualIso ? "" : hint);
    return expectedCanonical.some((date) => actualCanonical.includes(date));
  }
  function validatePreSubmit(plan = [], questions = [], answers = []) {
    const errors = [], mapped = new Map(plan.map((entry, index) => [normalizeComparable(entry.questionTitle), { ...entry, answer: answers[index] }]));
    if (!questions.length) errors.push("\u65E0\u6CD5\u8BFB\u53D6\u8868\u5355\u9898\u76EE\u3002");
    const currentTitles = new Set(questions.map((question) => normalizeComparable(question.title)));
    for (const entry of plan) if (!entry.skip && !currentTitles.has(normalizeComparable(entry.questionTitle))) errors.push(`${entry.questionTitle || "\u5DF2\u6620\u5C04\u9898\u76EE"}\u5DF2\u4ECE\u8868\u5355\u4E2D\u6D88\u5931\u3002`);
    for (const question of questions) {
      const title = String(question.title || "").trim() || "Untitled question";
      const entry = mapped.get(normalizeComparable(title));
      if (question.required === false && (!entry || entry.skip)) continue;
      if (!entry || entry.skip) {
        errors.push(`${title} is required but is not mapped.`);
        continue;
      }
      const answer = entry.answer;
      if (!answer || answer.valid === false || answer.value == null || String(answer.value).trim() === "") {
        errors.push(`${title} is empty.`);
        continue;
      }
      if (entry.type === "radio" && answer.checked !== true) errors.push(`${title} has no selected option.`);
      if (entry.type === "radio" && Array.isArray(answer.selectedValues) && answer.selectedValues.length > 1) errors.push(`${title} has conflicting selections.`);
      if (entry.type === "date" && !sameDateValue(answer.value, entry.expectedDate || entry.value, entry.dateFormat || "")) errors.push(`${title} does not match the expected date.`);
      if (entry.type === "text" && String(answer.value) !== String(entry.value)) errors.push(`${title} does not match the expected value.`);
      if (entry.type === "radio" && String(answer.value) !== String(entry.value)) errors.push(`${title} does not match the expected option.`);
    }
    return { ok: errors.length === 0, errors };
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
    const words = (value) => normalize(value).match(/[a-z]+/g) || [];
    const kinds = (value) => [...new Set(words(value).map((word) => word === "laboratory" ? "lab" : word).filter((word) => ["lecture", "tutorial", "lab"].includes(word)))];
    const matches = options.filter((value) => {
      const labels = words(value), negative = labels.some((word, index) => ["no", "not", "non", "without", "never"].includes(word) && labels.slice(index + 1, index + 4).some((next) => ["lecture", "tutorial", "lab", "laboratory"].includes(next)));
      return !negative && kinds(value).length === 1 && kinds(value)[0] === target;
    });
    return matches.length === 1 ? matches[0] : void 0;
  }
  function identityOption(options, target) {
    const matches = options.filter((value) => {
      const text = normalize(value), negative = /\b(?:not|no|non|without|never)\b/.test(text);
      return !negative && (target === "international" ? /\binternational\b/.test(text) : /\blocal\b/.test(text) && !/\binternational\b/.test(text));
    });
    return matches.length === 1 ? matches[0] : void 0;
  }
  function buildFillPlan(questions, mapping, profile, date, course) {
    const unused = new Set(questions), resolved = mapping.map((entry) => {
      let question = questions.find((item) => unused.has(item) && normalizeComparable(item.title) === normalizeComparable(entry.title));
      if (!question) question = questions.find((item) => unused.has(item) && matchesMappedMeaning(entry, item));
      if (question) unused.delete(question);
      return { entry, question };
    });
    if (resolved.some((item) => !item.question)) {
      const error = Error("\u8868\u5355\u9898\u76EE\u53D1\u751F\u53D8\u5316\uFF0C\u5DF2\u505C\u6B62\u3002");
      error.code = "form_schema_changed";
      error.diff = questionDiff(mapping, questions);
      throw error;
    }
    return resolved.map(({ entry, question: q }, i) => {
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
      return { type: q.type, value, field: entry.field, questionTitle: q.title, ...q.type === "date" ? { expectedDate: date, dateFormat: q.placeholder || "" } : {} };
    });
  }
  function matchesMappedMeaning(entry, question) {
    const title = normalizeComparable(question.title), options = (question.options || []).map(normalizeComparable), field = entry.field || "";
    if ((field === "student" || field === "name") && question.type !== "text") return false;
    if ((field === "delivery" || field.startsWith("delivery:")) && question.type !== "radio") return false;
    if ((field === "local" || field.startsWith("local:")) && question.type !== "radio") return false;
    if (field === "student") return /\b(?:student|university|learner)\b.*\b(?:id|number|no)\b|\b(?:id|identification)\s*(?:number|no\.?|#)\b|学号/.test(title);
    if (field === "name") return /\bname\b|姓名/.test(title);
    if (field === "date") return question.type === "date";
    if (field === "skip") return question.type === "date" && question.required === false;
    if (field === "delivery" || field.startsWith("delivery:")) {
      const kinds = ["lecture", "tutorial", "lab"].filter((kind) => options.some((option) => kind === "lab" ? /\b(?:lab|laboratory)\b/.test(option) : new RegExp(`\\b${kind}\\b`).test(option)));
      return kinds.length >= 2 || /\b(?:delivery|session type|class type|lesson type)\b/.test(title);
    }
    if (field === "local" || field.startsWith("local:")) return options.some((option) => /\blocal\b/.test(option)) && options.some((option) => /\binternational\b/.test(option));
    return false;
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
  var submitButton = () => document.querySelector('[data-automation-id="submitButton"],button[type="submit"],input[type="submit"]') || [...document.querySelectorAll("button")].find((button) => button.textContent.trim().toLowerCase() === "submit");
  var formTitle = () => document.querySelector('[data-automation-id="formTitle"]')?.textContent?.trim() || "";
  function assertFormAvailable() {
    const visible = (selector) => [...document.querySelectorAll(selector)].some((element) => element.getClientRects().length > 0);
    if (visible('iframe[src*="captcha" i],iframe[title*="captcha" i],iframe[title*="challenge" i],[data-sitekey],#captcha,[id*="captcha" i]')) throw Error("\u68C0\u6D4B\u5230 CAPTCHA \u9A8C\u8BC1\uFF0C\u9700\u8981\u4EBA\u5DE5\u5B8C\u6210\u540E\u91CD\u65B0\u8FD0\u884C\u3002");
    const text = (document.body?.innerText || "").replace(/\s+/g, " ").toLowerCase();
    if (/(?:this form|the form) is (?:now )?closed|no longer accepting responses|form is not accepting responses|此表单已关闭|不再接受回复/.test(text)) throw Error("\u8868\u5355\u5DF2\u5173\u95ED\uFF0C\u672A\u63D0\u4EA4\u3002");
    if (/your session has expired|sign in to access this form|please sign in to continue|登录已过期|请先登录/.test(text)) throw Error("Microsoft \u767B\u5F55\u5DF2\u8FC7\u671F\u6216\u9700\u8981\u767B\u5F55\uFF0C\u8BF7\u4EBA\u5DE5\u5904\u7406\u3002");
  }
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
    const current = items(), item = entry.questionTitle ? current.find((candidate) => normalizeComparable(candidate.querySelector('[data-automation-id="questionTitle"]')?.textContent || "") === normalizeComparable(entry.questionTitle)) : current[index];
    if (!item) return null;
    if (entry.type === "radio") return [...item.querySelectorAll('input[type="radio"]')].find((e) => e.value === entry.value);
    return item.querySelector(entry.type === "date" ? 'input[role="combobox"],input[type="date"]' : 'input[data-automation-id="textInput"]');
  }
  function selectedRadioValues(index, entry) {
    const current = items(), item = entry.questionTitle ? current.find((candidate) => normalizeComparable(candidate.querySelector('[data-automation-id="questionTitle"]')?.textContent || "") === normalizeComparable(entry.questionTitle)) : current[index];
    return item ? [...item.querySelectorAll('input[type="radio"]:checked')].map((element) => element.value) : [];
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
    const questions = readQuestions();
    const answers = plan.map((entry, index) => {
      if (entry.skip) return { value: "", valid: true };
      const el = control(index, entry);
      if (!el || el.getAttribute("aria-invalid") === "true") return { value: "", valid: false };
      if (entry.type === "radio") return { value: el.value, checked: el.checked, valid: true, selectedValues: selectedRadioValues(index, entry) };
      return { value: el.value, valid: true };
    });
    return validatePreSubmit(plan, questions, answers).ok;
  }
  function assertPreSubmit(plan) {
    const questions = readQuestions();
    const answers = plan.map((entry, index) => {
      if (entry.skip) return { value: "", valid: true };
      const el = control(index, entry);
      if (!el || el.getAttribute("aria-invalid") === "true") return { value: "", valid: false };
      return entry.type === "radio" ? { value: el.value, checked: el.checked, valid: true, selectedValues: selectedRadioValues(index, entry) } : { value: el.value, valid: true };
    });
    const result = validatePreSubmit(plan, questions, answers);
    if (!result.ok) throw Error(`\u63D0\u4EA4\u524D\u6821\u9A8C\u5931\u8D25\uFF1A${result.errors.join("\uFF1B")}`);
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
    let clicked = false;
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
      assertFormAvailable();
      if (formTitle() !== binding.title) throw Error("\u8868\u5355\u6807\u9898\u53D1\u751F\u53D8\u5316\uFF0C\u672A\u63D0\u4EA4\u3002");
      const plan = buildFillPlan(readQuestions(), binding.mapping, profile, occ.date, occ.course);
      const requiresDate = plan.some((entry) => entry.type === "date" && !entry.skip);
      if (requiresDate) assertDateAgreement(occ.date, todayMalaysia(now), computerDate);
      show(`${occ.course}
\u6B63\u5728\u586B\u5199\u5E76\u6838\u5BF9\u8D44\u6599${requiresDate ? "\u4E0E\u5F53\u65E5\u65E5\u671F" : ""}\u2026`);
      if (key) await reportPhase(key, "checking");
      if (key) await reportPhase(key, "filling");
      await fill(plan);
      assertPreSubmit(plan);
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
      assertFormAvailable();
      if (todayMalaysia() !== occ.date) throw Error("\u63D0\u4EA4\u524D\u65E5\u671F\u5DF2\u53D8\u5316\uFF0C\u672A\u63D0\u4EA4\u3002");
      assertPreSubmit(plan);
      if (!submitButton() || submitButton().disabled) throw Error("\u8868\u5355\u65E0\u6CD5\u63D0\u4EA4\u3002");
      const reservation = await chrome.runtime.sendMessage({ type: "RESERVE_SUBMISSION", key });
      if (reservation?.error) throw Error(reservation.error);
      if (!reservation?.granted) {
        show(`${occ.course}
\u6B64\u65F6\u6BB5\u5DF2\u7ECF\u5C1D\u8BD5\u63D0\u4EA4\u8FC7\uFF0C\u4E3A\u907F\u514D\u91CD\u590D\u6253\u5361\u4E0D\u4F1A\u518D\u6B21\u70B9\u51FB\u63D0\u4EA4\u3002`);
        return;
      }
      buildFillPlan(readQuestions(), binding.mapping, profile, occ.date, occ.course);
      assertFormAvailable();
      if (todayMalaysia() !== occ.date || !answersMatch(plan) || formTitle() !== binding.title || !submitButton() || submitButton().disabled) throw Error("\u6388\u6743\u540E\u8868\u5355\u6216\u65E5\u671F\u5DF2\u53D8\u5316\uFF0C\u505C\u6B62\u63D0\u4EA4\u3002");
      const submitDelay = randomSubmitDelay();
      show(`${occ.course}
\u8D44\u6599\u4E0E\u65E5\u671F\u6838\u5BF9\u901A\u8FC7\uFF0C\u5C06\u5728 ${Math.round(submitDelay / 1e3)} \u79D2\u540E\u63D0\u4EA4\u2026`);
      await pause2(submitDelay);
      assertFormAvailable();
      if (todayMalaysia() !== occ.date || !answersMatch(plan) || formTitle() !== binding.title || !submitButton() || submitButton().disabled) throw Error("\u7B49\u5F85\u671F\u95F4\u8868\u5355\u6216\u65E5\u671F\u53D1\u751F\u53D8\u5316\uFF0C\u505C\u6B62\u63D0\u4EA4\u3002");
      await reportPhase(key, "confirming");
      const before = { questionCount: items().length, submitVisible: Boolean(submitButton()) };
      show(`${occ.course}
\u8D44\u6599\u4E0E\u65E5\u671F\u6838\u5BF9\u901A\u8FC7\uFF0C\u6B63\u5728\u63D0\u4EA4\u2026`);
      clicked = true;
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
        await report(key, clicked ? "submitted_pending_confirmation" : "failed", clicked ? "phase_error" : error.code === "form_schema_changed" ? "schema_changed" : safeRunDetail(error.message));
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
