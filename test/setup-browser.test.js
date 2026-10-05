import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {build} from 'esbuild';
import {todayMalaysia} from '../src/schedule.js';

test('one setup action opens and fills Lecture, Laboratory and Tutorial tabs without submitting',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const listeners={},tabs=[],alarms=new Map(),url='https://forms.office.com/Pages/ResponsePage.aspx?id=isolated-variants';
    const day=todayMalaysia();
    const questions=[{title:'Student ID',type:'text',options:[]},{title:'Name',type:'text',options:[]},{title:'Date',type:'date',placeholder:'yyyy/M/d',options:[]},{title:'Module Delivery',type:'radio',options:['Lecture','Laboratory','Tutorial']}];
    const binding={scope:'module',verified:true,url,title:'COMP1311 Attendance',questions,mapping:questions.map((q,n)=>({...q,field:['student','name','date','delivery'][n]}))};
    const store={attendanceProfile:{student:'123',name:'Student',studentType:'local'},attendanceBindings:{COMP1311:binding},attendanceDraft:{version:1,rows:['LEC','LAB','TUT'].map(suffix=>({course:`COMP1311-${suffix}`}))}};
    const bundle=await build({entryPoints:['src/content.js'],bundle:true,write:false,format:'iife'});
    const html=`<div data-automation-id="formTitle">COMP1311 Attendance</div><div data-automation-id="questionItem"><div data-automation-id="questionTitle">Student ID</div><input data-automation-id="textInput"></div><div data-automation-id="questionItem"><div data-automation-id="questionTitle">Name</div><input data-automation-id="textInput"></div><div data-automation-id="questionItem"><div data-automation-id="questionTitle">Date</div><input required readonly role="combobox" aria-expanded="true" aria-controls="calendar" placeholder="yyyy/M/d" value="2026/9/30"></div><div id="calendar"><button class="js-goToday" onclick="window.wentToday=true">转到今日</button><button class="ms-CalendarDay-dayIsToday" onclick="if(window.wentToday) document.querySelector('[role=combobox]').value='${day.replaceAll('-','/')}'">Today</button></div><div data-automation-id="questionItem"><div data-automation-id="questionTitle">Module Delivery</div>${questions[3].options.map(value=>`<label><input type="radio" name="delivery" value="${value}">${value}</label>`).join('')}</div><button data-automation-id="submitButton" onclick="window.submitClicks=(window.submitClicks||0)+1">Submit</button>`;
    const event=name=>({addListener:fn=>listeners[name]=fn});
    const send=(message,sender)=>new Promise(resolve=>{if(!listeners.message(message,sender,resolve)) resolve({});});
    globalThis.chrome={
      runtime:{id:'abcdefghijklmnopabcdefghijklmnop',getURL:path=>`chrome-extension://abcdefghijklmnopabcdefghijklmnop/${path}`,onMessage:event('message'),onStartup:event('startup'),onInstalled:event('installed')},
      storage:{local:{get:async keys=>structuredClone(Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in store).map(k=>[k,store[k]]))),set:async values=>Object.assign(store,structuredClone(values))}},
      action:{onClicked:event('action')},notifications:{onClicked:event('notificationClick'),onButtonClicked:event('notificationButton')},
      alarms:{create:async(name,value)=>alarms.set(name,value),clear:async name=>alarms.delete(name),onAlarm:event('alarm')},
      tabs:{onRemoved:event('tabRemoved'),get:async id=>tabs.find(t=>t.id===id)||Promise.reject(Error('missing tab')),
        create:async()=>{const page=await browser.newPage(),tab={id:tabs.length+1,page};tabs.push(tab);
          await page.exposeFunction('backgroundMessage',message=>send(message,{id:chrome.runtime.id,url,tab:{id:tab.id,url}}));
          await page.addInitScript(()=>{window.chrome={runtime:{sendMessage:message=>window.backgroundMessage(message)}};});
          await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:html}));return {id:tab.id};},
        update:async(id,options)=>{const tab=tabs.find(t=>t.id===id);await tab.page.goto(options.url);await tab.page.addScriptTag({content:bundle.outputFiles[0].text});return {id};}}
    };
    await import(`../src/background.js?browser=${Date.now()}`);
    const result=await send({type:'START_SETUP',moduleKey:'COMP1311'},{id:chrome.runtime.id,url:chrome.runtime.getURL('options.html'),tab:{id:99}});
    assert.equal(result.error,undefined);assert.equal(tabs.length,3);
    for(const [n,delivery] of questions[3].options.entries()) {
      // Course order is LEC, LAB, TUT; each page must receive its own answers.
      const page=tabs[n].page;
      await page.getByRole('button',{name:'我已查看并确认全部答案'}).waitFor({timeout:3000});
      assert.equal(await page.locator('input[name=delivery]:checked').inputValue(),delivery);
      assert.equal(await page.locator('[role=combobox]').inputValue(),day.replaceAll('-','/'));
      assert.equal(await page.evaluate(()=>window.wentToday),true);
      assert.equal(await page.evaluate(()=>window.submitClicks||0),0);
    }
    for(const n of [2,0,1]) {
      await tabs[n].page.getByRole('button',{name:'我已查看并确认全部答案'}).click();
      await tabs[n].page.waitForFunction(()=>document.querySelector('#attendance-helper-status')?.textContent.includes('已确认此课型'));
    }
    assert.equal(store.attendanceSetupSession.state,'completed');
    assert.equal(store.attendanceSetupSession.items.every(i=>i.state==='passed'),true);
    assert.equal(store.attendanceRecords,undefined);
    assert.equal(store.attendanceCloudOutbox.items.filter(i=>i.action==='setup-summary').length,1);
    for(const tab of tabs) assert.equal(await tab.page.evaluate(()=>window.submitClicks||0),0);
  } finally {await browser.close();}
});
