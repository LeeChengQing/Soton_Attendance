import {buildFillPlan,isSuccess,assertDateAgreement,validateFormsUrl,sameDateValue} from './forms.js';
import {todayMalaysia} from './schedule.js';
import {bindingForCourse,validateBindingForCourse} from './bindings.js';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const items=()=>[...document.querySelectorAll('[data-automation-id="questionItem"]')];
const submitButton=()=>document.querySelector('[data-automation-id="submitButton"]');
const formTitle=()=>document.querySelector('[data-automation-id="formTitle"]')?.textContent?.trim()||'';

function show(message,positive=false) {
  let box=document.getElementById('attendance-helper-status');
  if(!box) {
    box=document.createElement('aside');box.id='attendance-helper-status';box.setAttribute('role','status');box.setAttribute('aria-live','polite');
    box.style.cssText='position:fixed;right:18px;bottom:18px;z-index:2147483647;max-width:440px;padding:16px 20px;border-radius:12px;box-shadow:0 4px 24px #0003;font:15px/1.6 system-ui;color:white;white-space:pre-line';
    document.body.append(box);
  }
  box.style.background=positive?'#253745':'#11212d';box.textContent=message;
}

function readQuestions() {
  return items().map(item=>{
    const inputs=[...item.querySelectorAll('input')],radio=inputs.filter(e=>e.type==='radio');
    const date=inputs.find(e=>e.getAttribute('role')==='combobox');
    const text=inputs.filter(e=>e.matches('[data-automation-id="textInput"]'));
    if(item.querySelector('textarea,select,input[type="checkbox"]') || (!radio.length && !date && text.length!==1)) throw Error('表单含暂不支持的题型，无法启用自动打卡。');
    return {title:item.querySelector('[data-automation-id="questionTitle"]')?.textContent?.trim()||'',type:radio.length?'radio':date?'date':'text',placeholder:date?.placeholder||'',options:radio.map(e=>e.value)};
  });
}

function control(index,entry) {
  const item=items()[index];
  if(!item) return null;
  if(entry.type==='radio') return [...item.querySelectorAll('input[type="radio"]')].find(e=>e.value===entry.value);
  return item.querySelector(entry.type==='date'?'input[role="combobox"]':'input[data-automation-id="textInput"]');
}

async function fillDate(input,expected) {
  if(sameDateValue(input.value,expected)) return;
  if(input.getAttribute('aria-expanded')!=='true') input.click();
  const root=()=>document.getElementById(input.getAttribute('aria-controls'))||document;
  const currentDay=()=>{
    const cell=root().querySelector('[role="gridcell"][aria-current="date"]:not([aria-disabled="true"])');
    if(cell?.getClientRects().length) return cell.querySelector('button')||cell;
    const button=root().querySelector('button.ms-CalendarDay-dayIsToday');
    return button&&!button.disabled&&button.getClientRects().length?button:null;
  };
  let today=null;
  for(let i=0;i<50;i++) {
    today=currentDay();
    if(today) break;
    if(i===10) {
      const goToday=root().querySelector('button.js-goToday');
      if(goToday&&!goToday.disabled) goToday.click();
    }
    await pause(100);
  }
  if(!today) throw Error('找不到日期控件中的今天，未提交。');
  today.click();
  for(let i=0;i<20&&!sameDateValue(input.value,expected);i++) await pause(100);
  if(!sameDateValue(input.value,expected)) throw Error('表单选中的日期与今日日期不一致，未提交。');
}

async function fill(plan) {
  for(let i=0;i<plan.length;i++) {
    const entry=plan[i],el=control(i,entry);
    if(!el || el.disabled || el.readOnly) throw Error(`第 ${i+1} 题无法填写。`);
    if(entry.type==='radio') el.click();
    else if(entry.type==='date') await fillDate(el,entry.value);
    else {
      el.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,entry.value);
      el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));el.blur();
    }
    await pause(180);
  }
  await pause(500);
  if(!answersMatch(plan)) throw Error('填写后的答案或日期核对失败，未提交。');
}

function answersMatch(plan) {
  const questions=items();
  if(questions.length!==plan.length) return false;
  return plan.every((entry,i)=>{
    const el=control(i,entry);
    if(!el || el.getAttribute('aria-invalid')==='true') return false;
    if(entry.type==='radio') {
      const checked=[...questions[i].querySelectorAll('input[type="radio"]')].filter(input=>input.checked);
      return checked.length===1 && checked[0]===el && el.value===entry.value;
    }
    return entry.type==='date'?sameDateValue(el.value,entry.value):el.value===entry.value;
  });
}

function watchDryRun(plan,course) {
  const check=()=>{
    if(answersMatch(plan)) return;
    clearInterval(timer);
    document.removeEventListener('input',check,true);
    document.removeEventListener('change',check,true);
    show(`${course}\n表单答案已变化，核对不再通过；未提交。`);
  };
  const timer=setInterval(check,1000);
  document.addEventListener('input',check,true);
  document.addEventListener('change',check,true);
}

async function report(key,state,detail='') {
  const result=await chrome.runtime.sendMessage({type:'REPORT_RUN',key,state,detail});
  if(result?.error) throw Error(result.error);
}

async function run(key,checkCourse) {
  let pending=false;
  try {
    let occ,binding,profile;
    if(key) {
      const result=await chrome.runtime.sendMessage({type:'GET_RUN',key});
      if(result?.error) throw Error(result.error);
      ({occ,binding,profile}=result);
    } else {
      const data=await chrome.storage.local.get(['attendanceBindings','attendanceProfile']);
      binding=bindingForCourse(data.attendanceBindings,checkCourse);profile=data.attendanceProfile;
      occ={course:checkCourse,date:todayMalaysia(),time:'仅填写测试'};
    }
    if(!binding?.verified || !profile?.student || !profile?.name) throw Error('请先在扩展设置页完成资料和表单配置。');
    validateBindingForCourse(binding,occ.course,profile,occ.date);
    const now=new Date(),computerDate=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    assertDateAgreement(occ.date,todayMalaysia(now),computerDate);
    const expected=validateFormsUrl(binding.url),actual=validateFormsUrl(location.href);
    if(expected.hostname!==actual.hostname || expected.pathname!==actual.pathname || expected.searchParams.get('id')!==actual.searchParams.get('id')) throw Error('当前表单与课程绑定的表单不一致。');
    if(formTitle()!==binding.title) throw Error('表单标题发生变化，未提交。');
    const plan=buildFillPlan(readQuestions(),binding.mapping,profile,occ.date,occ.course);
    show(`${occ.course}\n正在填写并核对资料与当日日期…`);
    await fill(plan);
    if(!answersMatch(plan)) throw Error('表单答案已变化，未通过核对；未提交。');
    if(!key) {const delivery=plan.find(entry=>entry.field?.startsWith('delivery'))?.value;show(`核对通过 · 仅填写，未提交\n${occ.course}${delivery?` · Module Delivery: ${delivery}`:''}`,true);watchDryRun(plan,occ.course);return;}
    if(todayMalaysia()!==occ.date) throw Error('提交前日期已变化，未提交。');
    if(!answersMatch(plan)) throw Error('提交前表单答案已变化，未提交。');
    if(!submitButton() || submitButton().disabled) throw Error('表单无法提交。');
    await report(key,'pending');pending=true;
    show(`${occ.course}\n资料与日期核对通过，正在提交…`);
    submitButton().click();
    for(let i=0;i<60;i++) {
      await pause(500);
      const visible=document.body.innerText.replace(document.getElementById('attendance-helper-status')?.innerText||'','');
      if(!submitButton() && isSuccess(visible)) {await report(key,'success');show(`打卡成功\n${occ.course}`,true);return;}
    }
    await report(key,'unknown','已点击提交，但未收到明确成功反馈。');
    show(`${occ.course}\n打卡结果不明，请查看原表单；不会自动重试。`);
  } catch(error) {
    show(`${checkCourse||key}\n${error.message}`);
    if(key) try {await report(key,pending?'unknown':'failed',error.message);} catch { /* watchdog or previous result has already resolved this run */ }
  }
}

(async()=>{
  const hash=new URLSearchParams(location.hash.slice(1));
  const key=hash.get('attendanceRun'),checkCourse=hash.get('attendanceCheck');
  if(key||checkCourse) history.replaceState(null,'',location.pathname+location.search);
  for(let i=0;i<120&&!submitButton();i++) await pause(500);
  if(!submitButton()) {if(key) await run(key,null);return;}
  try {chrome.runtime.sendMessage({type:'FORM_READY',url:location.href,title:formTitle(),questions:readQuestions()}).catch(()=>{});} catch(error) {chrome.runtime.sendMessage({type:'FORM_SETUP_ERROR',error:error.message}).catch(()=>{});}
  if(key||checkCourse) await run(key,checkCourse);
})();
