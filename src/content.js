import {fillDate} from './form-date.js';
import {buildFillPlan,submissionSignals,assertDateAgreement,validateFormsUrl,validatePreSubmit,normalizeComparable} from './forms.js';
import {todayMalaysia} from './schedule.js';
import {bindingForCourse,validateBindingForCourse} from './bindings.js';
import {randomSubmitDelay} from './submit-delay.js';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const items=()=>[...document.querySelectorAll('[data-automation-id="questionItem"]')];
const submitButton=()=>document.querySelector('[data-automation-id="submitButton"],button[type="submit"],input[type="submit"]')||[...document.querySelectorAll('button')].find(button=>button.textContent.trim().toLowerCase()==='submit');
const formTitle=()=>document.querySelector('[data-automation-id="formTitle"]')?.textContent?.trim()||'';

function assertFormAvailable() {
  const visible=selector=>[...document.querySelectorAll(selector)].some(element=>element.getClientRects().length>0);
  if(visible('iframe[src*="captcha" i],iframe[title*="captcha" i],iframe[title*="challenge" i],[data-sitekey],#captcha,[id*="captcha" i]')) throw Error('检测到 CAPTCHA 验证，需要人工完成后重新运行。');
  const text=(document.body?.innerText||'').replace(/\s+/g,' ').toLowerCase();
  if(/(?:this form|the form) is (?:now )?closed|no longer accepting responses|form is not accepting responses|此表单已关闭|不再接受回复/.test(text)) throw Error('表单已关闭，未提交。');
  if(/your session has expired|sign in to access this form|please sign in to continue|登录已过期|请先登录/.test(text)) throw Error('Microsoft 登录已过期或需要登录，请人工处理。');
}

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
  const current=items(),item=entry.questionTitle
    ?current.find(candidate=>normalizeComparable(candidate.querySelector('[data-automation-id="questionTitle"]')?.textContent||'')===normalizeComparable(entry.questionTitle))
    :current[index];
  if(!item) return null;
  if(entry.type==='radio') return [...item.querySelectorAll('input[type="radio"]')].find(e=>e.value===entry.value);
  return item.querySelector(entry.type==='date'?'input[role="combobox"],input[type="date"]':'input[data-automation-id="textInput"]');
}
function selectedRadioValues(index,entry) {
  const current=items(),item=entry.questionTitle
    ?current.find(candidate=>normalizeComparable(candidate.querySelector('[data-automation-id="questionTitle"]')?.textContent||'')===normalizeComparable(entry.questionTitle))
    :current[index];
  return item?[...item.querySelectorAll('input[type="radio"]:checked')].map(element=>element.value):[];
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
  const questions=readQuestions();
  const answers=plan.map((entry,index)=>{
    if(entry.skip) return {value:'',valid:true};
    const el=control(index,entry);
    if(!el||el.getAttribute('aria-invalid')==='true') return {value:'',valid:false};
    if(entry.type==='radio') return {value:el.value,checked:el.checked,valid:true,selectedValues:selectedRadioValues(index,entry)};
    return {value:el.value,valid:true};
  });
  return validatePreSubmit(plan,questions,answers).ok;
}

function assertPreSubmit(plan) {
  const questions=readQuestions();
  const answers=plan.map((entry,index)=>{
    if(entry.skip) return {value:'',valid:true};
    const el=control(index,entry);
    if(!el||el.getAttribute('aria-invalid')==='true') return {value:'',valid:false};
    return entry.type==='radio'?{value:el.value,checked:el.checked,valid:true,selectedValues:selectedRadioValues(index,entry)}:{value:el.value,valid:true};
  });
  const result=validatePreSubmit(plan,questions,answers);
  if(!result.ok) throw Error(`提交前校验失败：${result.errors.join('；')}`);
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
async function reportPhase(key,phase) {
  const result=await chrome.runtime.sendMessage({type:'REPORT_PHASE',key,phase});
  if(result?.error) throw Error(result.error);
}
const safeRunDetail=value=>String(value||'').replace(/https?:\/\/\S+/gi,'[url]').replace(/\b\d{6,}\b/g,'[redacted]').slice(0,500);
const diffDescription=diff=>[
  diff?.added?.length?`新增：${diff.added.join('、')}`:'',
  diff?.deleted?.length?`删除：${diff.deleted.join('、')}`:'',
  diff?.renamed?.length?`改名：${diff.renamed.map(item=>`${item.from} → ${item.to}`).join('、')}`:'',
  diff?.options?.length?`选项变化：${diff.options.map(item=>item.title).join('、')}`:''
].filter(Boolean).join('\n');

async function run(key,checkCourse,setupId,itemId) {
  let clicked=false;
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
    assertFormAvailable();
    if(formTitle()!==binding.title) throw Error('表单标题发生变化，未提交。');
    const plan=buildFillPlan(readQuestions(),binding.mapping,profile,occ.date,occ.course);
    const requiresDate=plan.some(entry=>entry.type==='date'&&!entry.skip);
    if(requiresDate) assertDateAgreement(occ.date,todayMalaysia(now),computerDate);
    show(`${occ.course}\n正在填写并核对资料${requiresDate?'与当日日期':''}…`);
    if(key) await reportPhase(key,'checking');
    if(key) await reportPhase(key,'filling');
    await fill(plan);
    assertPreSubmit(plan);
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
    assertFormAvailable();
    if(todayMalaysia()!==occ.date) throw Error('提交前日期已变化，未提交。');
    assertPreSubmit(plan);
    if(!submitButton() || submitButton().disabled) throw Error('表单无法提交。');
    const reservation=await chrome.runtime.sendMessage({type:'RESERVE_SUBMISSION',key});
    if(reservation?.error) throw Error(reservation.error);
    if(!reservation?.granted) {show(`${occ.course}\n此时段已经尝试提交过，为避免重复打卡不会再次点击提交。`);return;}
    buildFillPlan(readQuestions(),binding.mapping,profile,occ.date,occ.course);
    assertFormAvailable();
    if(todayMalaysia()!==occ.date||!answersMatch(plan)||formTitle()!==binding.title||!submitButton()||submitButton().disabled) throw Error('授权后表单或日期已变化，停止提交。');
    const submitDelay=randomSubmitDelay();
    show(`${occ.course}\n资料与日期核对通过，将在 ${Math.round(submitDelay/1000)} 秒后提交…`);
    await pause(submitDelay);
    assertFormAvailable();
    if(todayMalaysia()!==occ.date||!answersMatch(plan)||formTitle()!==binding.title||!submitButton()||submitButton().disabled) throw Error('等待期间表单或日期发生变化，停止提交。');
    await reportPhase(key,'confirming');
    const before={questionCount:items().length,submitVisible:Boolean(submitButton())};
    show(`${occ.course}\n资料与日期核对通过，正在提交…`);
    clicked=true;
    submitButton().click();
    let structureSeen=false;
    for(let i=0;i<60;i++) {
      await pause(500);
      const after={text:document.body.innerText.replace(document.getElementById('attendance-helper-status')?.innerText||'',''),questionCount:items().length,submitVisible:Boolean(submitButton())};
      const outcome=submissionSignals(before,after,{structureSelectorsEnabled:false});
      structureSeen=structureSeen||outcome.signal==='structure_change';
      if(outcome.state==='success') {await report(key,'success',outcome.signal);show(`打卡成功\n${occ.course}`,true);return;}
    }
    await report(key,'submitted_pending_confirmation',structureSeen?'structure_change':'none');
    show(`${occ.course}\n已点击提交但尚未确认结果，请手动检查；不会重复提交。`);
  } catch(error) {
    show(`${checkCourse||key}\n${error.message}${error.diff?`\n${diffDescription(error.diff)}`:''}`);
    if(setupId) await setupMessage('REPORT_SETUP_ITEM',{state:'failed',detail:error.message}).catch(()=>{});
    if(key) try {await report(key,clicked?'submitted_pending_confirmation':'failed',clicked?'phase_error':error.code==='form_schema_changed'?'schema_changed':safeRunDetail(error.message));} catch { /* watchdog or previous result has already resolved this run */ }
  }
}

if(!globalThis.__attendanceContentLoaded) {globalThis.__attendanceContentLoaded=true;
(async()=>{
  const hash=new URLSearchParams(location.hash.slice(1));
  const key=hash.get('attendanceRun'),checkCourse=hash.get('attendanceCheck');
  const setupId=hash.get('attendanceSetup'),itemId=hash.get('attendanceItem');
  if(key||checkCourse||setupId) history.replaceState(null,'',location.pathname+location.search);
  for(let i=0;i<120&&!submitButton();i++) await pause(500);
  if(!submitButton()) {if(key||setupId) await run(key,null,setupId,itemId);return;}
  try {chrome.runtime.sendMessage({type:'FORM_READY',url:location.href,title:formTitle(),questions:readQuestions()}).catch(()=>{});} catch(error) {chrome.runtime.sendMessage({type:'FORM_SETUP_ERROR',error:error.message}).catch(()=>{});}
  if(key||checkCourse||setupId) await run(setupId?null:key,checkCourse,setupId,itemId);
})();}
