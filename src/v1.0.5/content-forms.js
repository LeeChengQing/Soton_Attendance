import {resolveCourseKind,unknownCourseKind} from '../course-kind.js';
import {normalizeComparable} from '../question-title.js';
export function deliveryFromCourse(course,type) {
  const kind=resolveCourseKind({course,type});
  if(!kind) throw unknownCourseKind({course});
  return kind;
}
// Recovered V1.0.5 content runtime variant; see docs/SOURCE_DRIFT_V1.0.5.md.

var HOSTS = /* @__PURE__ */ new Set(["forms.office.com", "forms.cloud.microsoft"]);
var normalize = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
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
import {isExplicitSuccess,submissionSignals} from '../submission-confirmation.js';
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
function deliveryOption(options, target) {
  return options.find((value) => target === "lab" ? ["lab", "laboratory"].includes(normalize(value)) : normalize(value) === target);
}
function identityOption(options, target) {
  return options.find((value) => target === "international" ? /international/i.test(value) : /\blocal\b/i.test(value) && !/international/i.test(value));
}
function buildFillPlan(questions, mapping, profile, date, course, type) {
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
      const target = entry.field === "delivery" ? deliveryFromCourse(course,type) : entry.field.split(":")[1];
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
export { normalize, normalizeComparable, sameDateValue, validateFormsUrl, verifyQuestions, isExplicitSuccess, submissionSignals, questionDiff, buildFillPlan, assertDateAgreement };
