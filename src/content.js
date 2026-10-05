import {fillDate} from './form-date.js';
import {buildFillPlan,isSuccess,assertDateAgreement,validateFormsUrl,sameDateValue} from './forms.js';
import {todayMalaysia} from './schedule.js';
import {bindingForCourse,validateBindingForCourse} from './bindings.js';
import {randomSubmitDelay} from './submit-delay.js';

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
    const title=item.querySelector('[data-automation-id="questionTitle"]')?.textContent?.trim()||'';
    const date=inputs.find(e=>e.type==='date'||e.getAttribute('role')==='combobox'&&(/date|日期/i.test(title)||/yyyy|yy|MM[/.-]|[/.-]MM/i.test(e.placeholder)));
    const text=inputs.filter(e=>e.matches('[data-automation-id="textInput"]'));
    if(item.querySelector('textarea,select,input[type="checkbox"]') || (!radio.length && !date && text.length!==1)) throw Error('表单含暂不支持的题型，无法启用自动打卡。');
    const required=Boolean(item.querySelector('[required],[aria-required="true"],[data-automation-id="questionRequired"],[data-automation-id="requiredStar"],[aria-label="Required"],[aria-label="必填"]'))||/\*/.test(title)||item.getAttribute('data-required')==='true';
    return {title,type:radio.length?'radio':date?'date':'text',required,placeholder:date?.placeholder||'',nativeDate:date?.type==='date',options:radio.map(e=>e.value)};
  });
}

function control(index,entry) {
  const item=items()[index];
  if(!item) return null;
  if(entry.type==='radio') return [...item.querySelectorAll('input[type="radio"]')].find(e=>e.value===entry.value);
  return item.querySelector(entry.type==='date'?'input[role="combobox"],input[type="date"]':'input[data-automation-id="textInput"]');
}


async function fill(plan) {
  for(let i=0;i<plan.length;i++) {
    const entry=plan[i],el=control(i,entry);
    if(entry.skip) continue;
    if(!el || el.disabled || el.readOnly&&entry.type!=='date') throw Error(`第 ${i+1} 题无法填写。`);
    if(entry.type==='radio') el.click();
    else if(entry.type==='date'&&el.type!=='date') await fillDate(el,entry.value);
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
    if(entry.skip) return true;
    const el=control(i,entry);
    if(!el || el.getAttribute('aria-invalid')==='true') return false;
    if(entry.type==='radio') {
      const checked=[...questions[i].querySelectorAll('input[type="radio"]')].filter(input=>input.checked);
      return checked.length===1 && checked[0]===el && el.value===entry.value;
    }
    return entry.type==='date'?sameDateValue(el.value,entry.value):el.value===entry.value;
  });
}

function watchDryRun(plan,course,onInvalid) {
  const check=()=>{
    if(answersMatch(plan)) return;
    clearInterval(timer);
    document.removeEventListener('input',check,true);
    document.removeEventListener('change',check,true);
    show(`${course}\n表单答案已变化，核对不再通过；未提交。`);
    onInvalid?.();
  };
  const timer=setInterval(check,1000);
  document.addEventListener('input',check,true);
  document.addEventListener('change',check,true);
}

async function report(key,state,detail='') {
  const result=await chrome.runtime.sendMessage({type:'REPORT_RUN',key,state,detail});
  if(result?.error) throw Error(result.error);
}

async function run(key,checkCourse,setupId,itemId) {
  let pending=false;
  const setupMessage=async(type,extra={})=>{
    const result=await chrome.runtime.sendMessage({type,sessionId:setupId,itemId,...extra});
    if(result?.error) throw Error(result.error);return result;
  };
  try {
    let occ,binding,profile;
    if(setupId) {
      const result=await setupMessage('GET_SETUP_ITEM');
      binding=result.binding;profile=result.profile;checkCourse=result.course;
      occ={course:checkCourse,date:todayMalaysia(),time:'设置检查 · 不提交'};
    } else if(key) {
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
    const expected=validateFormsUrl(binding.url),actual=validateFormsUrl(location.href);
    if(expected.hostname!==actual.hostname || expected.pathname!==actual.pathname || expected.searchParams.get('id')!==actual.searchParams.get('id')) throw Error('当前表单与课程绑定的表单不一致。');
    if(formTitle()!==binding.title) throw Error('表单标题发生变化，未提交。');
    const plan=buildFillPlan(readQuestions(),binding.mapping,profile,occ.date,occ.course);
    const requiresDate=plan.some(entry=>entry.type==='date'&&!entry.skip);
    if(requiresDate) assertDateAgreement(occ.date,todayMalaysia(now),computerDate);
    show(`${occ.course}\n正在填写并核对资料${requiresDate?'与当日日期':''}…`);
    await fill(plan);
    if(!answersMatch(plan)) throw Error('表单答案已变化，未通过核对；未提交。');
    if(!key) {
      const delivery=plan.find(entry=>entry.field?.startsWith('delivery'))?.value;
      show(`已填写 · 仅填写，未提交\n${occ.course}${delivery?` · Module Delivery: ${delivery}`:''}${setupId?'\n请逐题查看答案，再确认此课型。':'\n请查看答案；单项测试不计入完整设置检查。'}`,true);
      if(setupId) {
        await setupMessage('REPORT_SETUP_ITEM',{state:'awaiting_confirmation'});
        const button=document.createElement('button');button.type='button';button.textContent='我已查看并确认全部答案';
        button.style.cssText='display:block;margin-top:12px;padding:10px 14px;font:inherit;cursor:pointer';
        button.addEventListener('click',async()=>{
          button.disabled=true;
          try {
            buildFillPlan(readQuestions(),binding.mapping,profile,todayMalaysia(),occ.course);
            if(!answersMatch(plan)||todayMalaysia()!==occ.date||formTitle()!==binding.title) throw Error('答案、表单或日期已变化，请重新检查。');
            await setupMessage('CONFIRM_SETUP_ITEM');show(`已确认此课型 · ${occ.course}\n未提交。请返回设置页查看进度。`,true);
          } catch(error) {show(error.message);await setupMessage('REPORT_SETUP_ITEM',{state:'failed',detail:error.message}).catch(()=>{});}
        });
        document.getElementById('attendance-helper-status').append(button);
      }
      watchDryRun(plan,occ.course,setupId?()=>setupMessage('REPORT_SETUP_ITEM',{state:'failed',detail:'表单答案已变化，核对不再通过；未提交。'}).catch(()=>{}):null);return;
    }
    if(todayMalaysia()!==occ.date) throw Error('提交前日期已变化，未提交。');
    if(!answersMatch(plan)) throw Error('提交前表单答案已变化，未提交。');
    if(!submitButton() || submitButton().disabled) throw Error('表单无法提交。');
    await report(key,'pending');pending=true;
    buildFillPlan(readQuestions(),binding.mapping,profile,occ.date,occ.course);
    if(todayMalaysia()!==occ.date||!answersMatch(plan)||formTitle()!==binding.title||!submitButton()||submitButton().disabled) throw Error('授权后表单或日期已变化，停止提交。');
    const submitDelay=randomSubmitDelay();
    show(`${occ.course}\n资料与日期核对通过，将在 ${Math.round(submitDelay/1000)} 秒后提交…`);
    await pause(submitDelay);
    if(todayMalaysia()!==occ.date||!answersMatch(plan)||formTitle()!==binding.title||!submitButton()||submitButton().disabled) throw Error('等待期间表单或日期发生变化，停止提交。');
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
    if(setupId) await setupMessage('REPORT_SETUP_ITEM',{state:'failed',detail:error.message}).catch(()=>{});
    if(key) try {await report(key,pending?'unknown':'failed',error.message);} catch { /* watchdog or previous result has already resolved this run */ }
  }
}

(async()=>{
  const hash=new URLSearchParams(location.hash.slice(1));
  const key=hash.get('attendanceRun'),checkCourse=hash.get('attendanceCheck');
  const setupId=hash.get('attendanceSetup'),itemId=hash.get('attendanceItem');
  if(key||checkCourse||setupId) history.replaceState(null,'',location.pathname+location.search);
  for(let i=0;i<120&&!submitButton();i++) await pause(500);
  if(!submitButton()) {if(key||setupId) await run(key,null,setupId,itemId);return;}
  try {chrome.runtime.sendMessage({type:'FORM_READY',url:location.href,title:formTitle(),questions:readQuestions()}).catch(()=>{});} catch(error) {chrome.runtime.sendMessage({type:'FORM_SETUP_ERROR',error:error.message}).catch(()=>{});}
  if(key||checkCourse||setupId) await run(setupId?null:key,checkCourse,setupId,itemId);
})();
