import {sameDateValue} from './forms.js';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function fillDate(input,expected) {
  if(input.getAttribute('aria-expanded')!=='true') input.click();
  const root=()=>document.getElementById(input.getAttribute('aria-controls'))||document;
  const visible=el=>el&&el.getClientRects().length;
  let goToday;
  for(let i=0;i<50;i++) {
    goToday=[...root().querySelectorAll('button,[role="button"],a.js-goToday')].find(el=>visible(el)&&(el.matches('.js-goToday')||/^(?:转到今日|转到今天|go to today)$/i.test((el.getAttribute('aria-label')||el.textContent||'').trim())));
    if(goToday) break;
    await pause(100);
  }
  if(!goToday) throw Error('找不到日期控件中的“转到今日”，未提交。');
  // Fluent Calendar disables this button when it already displays the current month.
  if(!goToday.disabled&&goToday.getAttribute('aria-disabled')!=='true') goToday.click();
  // Forms redraws the month asynchronously. Never select its previous-month overflow day first.
  await pause(200);
  const currentDay=()=>{
    const cell=root().querySelector('[role="gridcell"][aria-current="date"]:not([aria-disabled="true"])');
    if(visible(cell)) {const day=cell.querySelector('button')||cell;if(!day.disabled&&day.getAttribute('aria-disabled')!=='true') return day;}
    const button=root().querySelector('button.ms-CalendarDay-dayIsToday');
    return button&&!button.disabled&&button.getClientRects().length?button:null;
  };
  let today=null;
  for(let i=0;i<50;i++) {
    today=currentDay();
    if(today) break;
    await pause(100);
  }
  if(!today) throw Error('找不到日期控件中的今天，未提交。');
  today.click();
  for(let i=0;i<20&&!sameDateValue(input.value,expected);i++) await pause(100);
  if(!sameDateValue(input.value,expected)) throw Error('表单选中的日期与今日日期不一致，未提交。');
}
