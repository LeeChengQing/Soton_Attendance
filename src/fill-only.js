import {fillDate} from './form-date.js';
import {cleanQuestionTitle} from './question-title.js';
import {normalizeComparable,sameDateValue,buildFillPlan,validateFormsUrl,assertDateAgreement,verifyQuestions} from './forms.js';
import {resolveCourseKind,unknownCourseKind} from './course-kind.js';
import {resolveFillPlan} from './bindings.js';
import {todayMalaysia} from './schedule.js';
const pause2=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const items=()=>[...document.querySelectorAll('[data-automation-id="questionItem"]')];
const formTitle=()=>document.querySelector('[data-automation-id="formTitle"]')?.textContent?.trim()||'';
function questionTitle(item) {
  const node=item.querySelector('[data-automation-id="questionTitle"]');
  if(!node) return '';
  const clone=node.cloneNode(true);
  for(const element of clone.querySelectorAll('*')) {
    const className=element.getAttribute('class')||'';
    if(element.matches('[aria-hidden="true"],[hidden],[data-automation-id="questionRequired"],[data-automation-id="requiredStar"]') || /(?:visually[-_]?hidden|screen[-_]?reader|sr[-_]?only)/i.test(className) || element.style.display==='none' || element.style.visibility==='hidden') element.remove();
  }
  return cleanQuestionTitle(clone.textContent)||cleanQuestionTitle(node.textContent);
}
function readQuestions() {
  return items().map((item) => {
    const inputs = [...item.querySelectorAll("input")], radio = inputs.filter((e) => e.type === "radio");
    const title = questionTitle(item);
    const date = inputs.find((e) => e.type === "date" || e.getAttribute("role") === "combobox" && (/date|日期/i.test(title) || /yyyy|yy|MM[/.-]|[/.-]MM/i.test(e.placeholder)));
    const text = inputs.filter((e) => e.matches('[data-automation-id="textInput"]'));
    if (item.querySelector('textarea,select,input[type="checkbox"]') || !radio.length && !date && text.length !== 1) throw Error("\u8868\u5355\u542B\u6682\u4E0D\u652F\u6301\u7684\u9898\u578B\uFF0C\u65E0\u6CD5\u542F\u7528\u81EA\u52A8\u6253\u5361\u3002");
    const required = Boolean(item.querySelector('[required],[aria-required="true"],[data-automation-id="questionRequired"],[data-automation-id="requiredStar"],[aria-label="Required"],[aria-label="\u5FC5\u586B"]')) || /\*/.test(item.querySelector('[data-automation-id="questionTitle"]')?.textContent || '') || item.getAttribute("data-required") === "true";
    return { title, type: radio.length ? "radio" : date ? "date" : "text", required, placeholder: date?.placeholder || "", nativeDate: date?.type === "date", options: radio.map((e) => e.value) };
  });
}
function control(index, entry) {
  const item = items().find((candidate) => normalizeComparable(questionTitle(candidate)) === normalizeComparable(entry.questionTitle)) || items()[index];
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
      if(entry.type==='date') (window.__dateDiag??=[]).push({inBackground:document.visibilityState==='hidden',rectCount:0,step:'date:native'});
      el.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, entry.value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.blur();
    }
    await pause2(180);
  }
  await pause2(500);
  if (!answersMatch(plan)) throw Error(AttendanceHotfix.requiresDateCheck(plan) ? "\u586B\u5199\u540E\u7684\u7B54\u6848\u6216\u65E5\u671F\u6838\u5BF9\u5931\u8D25\uFF0C\u672A\u63D0\u4EA4\u3002" : "\u586B\u5199\u540E\u7684\u7B54\u6848\u6838\u5BF9\u5931\u8D25\uFF0C\u672A\u63D0\u4EA4\u3002");
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

export async function prepareFill(binding,occ,profile,{onCheck=()=>{},onFill=()=>{}}={}) {
  let stage='课型可解析';
  try {
    if(!binding?.verified || !profile?.student || !profile?.name) throw Error('请先完成学生资料和表单绑定。');
    if(!resolveCourseKind(occ)) throw unknownCourseKind(occ);
    onCheck(stage,true,'');
    stage='表单链接与绑定一致';
    const expected=validateFormsUrl(binding.url),actual=validateFormsUrl(location.href);
    if(expected.hostname!==actual.hostname || expected.pathname!==actual.pathname || expected.searchParams.get('id')!==actual.searchParams.get('id')) throw Error('当前链接与绑定不一致，请重新绑定课程表单。');
    onCheck(stage,true,'');
    stage='标题与题目没变';
    if(formTitle()!==binding.title) throw Error('表单标题已变化，请重新核对并绑定表单。');
    const questions=readQuestions();
    // Schema validation is shared with the existing fill-only check.
    if(!verifyQuestions(questions,binding.mapping)) throw Error('表单题目或选项已变化，请重新核对表单映射。');
    onCheck(stage,true,'');
    stage='日期格式可填';
    resolveFillPlan(binding,occ,profile,occ.date);
    const plan=buildFillPlan(questions,binding.mapping,profile,occ.date,occ.course,occ.type);
    const now=new Date(),computerDate=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    if(AttendanceHotfix.requiresDateCheck(plan)) assertDateAgreement(occ.date,todayMalaysia(now),computerDate);
    onCheck(stage,true,'');
    stage='填写后核对通过';
    await onFill(plan);
    await fill(plan);
    if(!answersMatch(plan)) throw Error('填写后的答案核对失败，请检查表单控件和日期格式。');
    onCheck(stage,true,'');
    return plan;
  } catch(error) {
    const fixes={'课型可解析':'请在课表中补全 LEC/TUT/LAB，并检查学生资料。','表单链接与绑定一致':'请重新绑定课程表单链接。','标题与题目没变':'请重新核对表单标题、题目和映射。','日期格式可填':'请检查日期格式与电脑时区。','填写后核对通过':'请手动检查答案、日期控件和必填项。'};
    onCheck(stage,false,`${error.message} ${fixes[stage]}`);throw error;
  }
}
export {questionTitle,readQuestions,answersMatch,control};
