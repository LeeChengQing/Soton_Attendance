import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {build} from 'esbuild';

test('scheduled submission bypasses absent and optional dates but blocks a wrong required date or answer',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const bundle=await build({entryPoints:['src/content.js'],bundle:true,write:false,format:'iife'});
  try {
    for(const kind of ['absent','optional','required','wrong-answer']) {
      const page=await browser.newPage({timezoneId:'Pacific/Honolulu'});
      const questions=[{title:'Student ID',type:'text',required:true,options:[]}];
      if(['optional','required'].includes(kind)) questions.push({title:'Date',type:'date',required:kind==='required',placeholder:'yyyy/M/d',options:[]});
      const url='https://forms.office.com/Pages/ResponsePage.aspx?id=fixture';
      const binding={scope:'module',verified:true,url,title:'Attendance',questions,mapping:questions.map(q=>({...q,field:q.type==='date'?'date':'student'}))};
      await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<div data-automation-id="formTitle">Attendance</div><div data-automation-id="questionItem"><div data-automation-id="questionTitle">Student ID</div><input required data-automation-id="textInput" role="combobox" ${kind==='wrong-answer'?'oninput="this.value=\'wrong\'"':''}></div>${questions.length===2?`<div data-automation-id="questionItem"><div data-automation-id="questionTitle">Date</div><input ${kind==='required'?'required':''} readonly role="combobox" aria-expanded="true" aria-controls="calendar" aria-invalid="true" placeholder="yyyy/M/d" value="2026/10/4"></div><div id="calendar"><button class="js-goToday">Go to today</button><button class="ms-CalendarDay-dayIsToday">5</button></div>`:''}<button data-automation-id="submitButton" onclick="window.submitClicks++;this.remove();document.body.append('Your response was submitted')">Submit</button>`}));
      await page.addInitScript(({binding,kind})=>{
        const RealDate=Date;
        window.Date=class extends RealDate {constructor(...args){super(...(args.length?args:['2026-10-05T00:10:00Z']));}static now(){return new RealDate('2026-10-05T00:10:00Z').getTime();}};
        // Required Date uses the same local day, to exercise the calendar value check.
        if(kind==='required') Date.prototype.getDate=function(){return 5;};
        const originalTimeout=window.setTimeout;window.setTimeout=(fn,ms,...args)=>originalTimeout(fn,Math.min(ms,10),...args);
        window.submitClicks=0;window.reports=[];
        window.chrome={runtime:{sendMessage:async message=>{if(message.type==='GET_RUN') return {binding,profile:{student:'123',name:'Jane'},occ:{course:'COMP1311-LEC',date:'2026-10-05',time:'09:00'}};if(message.type==='REPORT_RUN') reports.push(message);return {};}}};
      },{binding,kind});
      await page.goto(`${url}#attendanceRun=fixture`);
      await page.addScriptTag({content:bundle.outputFiles[0].text});
      await page.waitForFunction(()=>reports.some(r=>['failed','unknown','success'].includes(r.state)),{},{timeout:4000});
      const result=await page.evaluate(()=>({clicks:submitClicks,reports}));
      assert.equal(result.clicks,['absent','optional'].includes(kind)?1:0,kind);
      assert.equal(result.reports.at(-1).state,['absent','optional'].includes(kind)?'success':'failed',kind);
      await page.close();
    }
  } finally {await browser.close();}
});
