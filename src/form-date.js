import {sameDateValue} from './forms.js';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function markDateDiagnostic(step,fields={}) {
  const rows=window.__dateDiag??=[];
  const row={step,inBackground:document.visibilityState==='hidden',rectCount:0,...fields};
  const last=rows.at(-1);
  if(last&&JSON.stringify({...last,count:undefined})===JSON.stringify(row)) last.count++;
  else rows.push({...row,count:1});
  if(rows.length>40) rows.splice(0,rows.length-40);
}

export async function fillDate(input,expected) {
  const deadline=Date.now()+6000;
  let path,selected=false;
  const mismatch=()=>Object.assign(Error('日期回读值不一致或日期题校验失败，未提交。'),{code:'date_readback_mismatch'});
  const finish=async()=>{
    markDateDiagnostic('date:complete',{path});
    input.blur();
    await pause(300);
    const question=input.closest('[data-automation-id="questionItem"],[role="group"],fieldset')||input.parentElement;
    const invalid=input.getAttribute('aria-invalid')==='true'||[...(question?.querySelectorAll('[role="alert"],[aria-invalid="true"]')||[])].some(el=>el.getAttribute('aria-invalid')==='true'||el.textContent.trim());
    if(!sameDateValue(input.value,expected)||invalid) throw mismatch();
  };
  if(sameDateValue(input.value,expected)) {path='already-set';return finish();}
  markDateDiagnostic('date:native');
  try {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,expected);
    for(const type of ['input','change','blur']) input.dispatchEvent(new Event(type,{bubbles:true}));
    await pause(0);
  } catch {}
  if(sameDateValue(input.value,expected)) {path='native';return finish();}
  markDateDiagnostic('date:calendar');
  if(input.getAttribute('aria-expanded')!=='true') input.click();
  const root=()=>document.getElementById(input.getAttribute('aria-controls'))||document;
  // Background tabs can have zero layout rectangles; keep semantic/CSS visibility checks.
  const visible=el=>{
    if(!el?.isConnected||['hidden','collapse'].includes(getComputedStyle(el).visibility)) return false;
    for(let node=el;node;node=node.parentElement) {
      if(node.hidden||node.getAttribute('aria-hidden')==='true') return false;
      const style=getComputedStyle(node);
      if(style.display==='none'||style.visibility==='collapse') return false;
    }
    return true;
  };
  const disabled=el=>!!el.disabled||el.getAttribute('aria-disabled')==='true';
  const findGoToday=()=>{
    const el=[...root().querySelectorAll('button,[role="button"],a.js-goToday')].find(el=>visible(el)&&(el.matches('.js-goToday')||/^(?:转到今日|转到今天|go to today)$/i.test((el.getAttribute('aria-label')||el.textContent||'').trim())));
    const result={el,disabled:el?disabled(el):false,text:el?.textContent.trim().slice(0,20)||'',rectCount:el?.getClientRects().length||0};
    const {el:ignored,...fields}=result;
    markDateDiagnostic('goToday',fields);
    return result;
  };
  const currentDay=()=>{
    const candidates=['[aria-current="date"]','[data-is-today="true"]','button[class*="today" i]:not(.js-goToday)'].flatMap(selector=>[...root().querySelectorAll(selector)]).filter(el=>!/^(?:转到今日|转到今天|go to today)$/i.test((el.getAttribute('aria-label')||el.textContent||'').trim()));
    candidates.push(...[...root().querySelectorAll('[role="gridcell"][aria-label],button[aria-label]')].filter(el=>{
      const label=el.getAttribute('aria-label'),date=new Date(Date.parse(label));
      return sameDateValue(label.replace(/[年/月]/g,'-').replace(/日/g,''),expected)||(!Number.isNaN(date.getTime())&&sameDateValue(`${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}`,expected));
    }));
    for(const cell of candidates) {
      const day=cell.querySelector('button')||cell;
      if(visible(cell)&&visible(day)&&!disabled(cell)&&!disabled(day)) {
        markDateDiagnostic(day.matches('button')?'todayButton':'todayCell',{rectCount:day.getClientRects().length});
        return day;
      }
    }
    return null;
  };
  let wentToday=false;
  while(Date.now()<deadline-300) {
    const goToday=findGoToday();
    if(!wentToday&&goToday.el&&!goToday.disabled) {
      path='goToday';wentToday=true;goToday.el.click();
      await pause(Math.min(150,Math.max(0,deadline-300-Date.now())));
      if(sameDateValue(input.value,expected)) return finish();
    }
    if(!selected) {
      const today=currentDay();
      if(today) {path=wentToday?'goToday':'today-cell';selected=true;today.click();}
    }
    if(sameDateValue(input.value,expected)) return finish();
    await pause(Math.min(150,Math.max(0,deadline-300-Date.now())));
  }
  markDateDiagnostic('date:failed',path?{path}:{});
  if(selected||wentToday) throw mismatch();
  throw Object.assign(Error('找不到日期控件中可点击的“转到今日”或今天的格子，未提交。'),{code:'date_picker_today_not_found'});
}
