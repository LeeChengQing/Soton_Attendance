import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import QRCode from 'qrcode';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {todayMalaysia} from '../src/schedule.js';
import {buildVariants} from '../src/setup.js';

const extension=fileURLToPath(new URL('../extension/',import.meta.url));
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.gz':'application/octet-stream','.png':'image/png'};
const server=createServer(async(req,res)=>{
  try {
    const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/+/, '');
    if(relative.includes('..')) throw Error('bad path');
    const file=join(extension,relative),data=await readFile(file);
    res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream'});res.end(data);
  } catch {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}/`;
let browser;
try {
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(({base})=>{
    let store={};try {store=JSON.parse(sessionStorage.getItem('smoke-store')||'{}');} catch {}window.__store=store;let nextTab=1;
    const chrome=window.chrome||{};
    chrome.runtime={getURL:path=>base+path,sendMessage:async message=>{window.__lastMessage=message;return {ok:true};},onMessage:{addListener:fn=>{window.__onMessage=fn;}}};
    chrome.storage={local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(key=>key in store).map(key=>[key,key==='attendanceProfile'?Object.fromEntries(Object.entries(store[key]).sort(([a],[b])=>a.localeCompare(b))):store[key]])),set:async values=>{Object.assign(store,values);sessionStorage.setItem('smoke-store',JSON.stringify(store));}},onChanged:{addListener:()=>{}}};
    window.__openedTabs=[];
    chrome.tabs={create:async options=>{const tab={id:nextTab++};window.__lastCreatedUrl=options.url;return tab;},update:async(id,options)=>{window.__lastOpenedUrl=options.url;window.__openedTabs.push({id,url:options.url});}};
    window.chrome=chrome;
  },{base});
  await page.goto(base+'options.html');
  await page.locator('h1').waitFor();
  const workflow=async(id,action='click')=>{await page.locator('#dock-toggle').hover();await page.locator('#'+id)[action]();};
  if(await page.locator('#readiness,#backup-section,#setup-details').count()) throw Error('Removed cards are still present');
  await page.locator('#dock-toggle').hover();
  await page.waitForFunction(()=>document.querySelector('#dock-toggle').getAttribute('aria-expanded')==='true');
  await page.locator('#workflow-panel nav').hover();
  if(!await page.locator('#workflow-panel').isVisible()) throw Error('Hover navigation collapsed while entering its controls');
  await page.mouse.move(5,5);
  await page.waitForFunction(()=>document.querySelector('#dock-toggle').getAttribute('aria-expanded')==='false'&&document.querySelector('#workflow-panel').inert);
  await page.locator('#dock-toggle').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  if(!await page.locator('#workflow-panel').evaluate(el=>el.contains(document.activeElement))) throw Error('Keyboard cannot enter expanded navigation');
  await page.keyboard.press('Escape');
  if(!await page.locator('#dock-toggle').evaluate(el=>el===document.activeElement&&el.getAttribute('aria-expanded')==='false')) throw Error('Escape did not collapse navigation and restore focus');
  await page.locator('#dock-toggle').dispatchEvent('pointerenter',{pointerType:'touch'});
  await page.locator('#dock-toggle').dispatchEvent('click');
  if(!await page.locator('#workflow-panel').isVisible()) throw Error('Tap navigation did not expand');
  await page.locator('h1').click();
  await page.waitForFunction(()=>document.querySelector('#workflow-panel').inert);

  if(!await page.evaluate(()=>document.querySelector('main').lastElementChild?.id==='phone-subscription'&&!document.querySelector('#phone-subscription').open)) throw Error('Subscription entry must be last and collapsed');
  await page.locator('#open-subscription').click();
  if(!await page.locator('#phone-subscription').evaluate(el=>el.open)) throw Error('Subscription shortcut did not open the bottom entry');
  if(await page.locator('#phone-subscription .reminder-plan').count()!==1) throw Error('Only the phone renewal plan should be displayed');
  if(!/¥19\.9/.test(await page.locator('#phone-subscription .plan-price').innerText())||!/学期/.test(await page.locator('#phone-subscription .plan-price').innerText())) throw Error('Phone renewal price should be ¥19.9 per semester');
  if(!await page.getByRole('link',{name:'前往店铺 · 手机提醒续订'}).isVisible()) throw Error('Phone renewal purchase entry is inaccessible');
  await page.locator('#phone-subscription > summary').click();
  await page.locator('#profile-form input[name=student]').fill('12345');
  await page.locator('#profile-form input[name=name]').fill('Test Student');
  await page.locator('#profile-form button').click();
  await page.locator('#add-row').click();
  if(await page.locator('#preview-rows .session-card').count()!==1 || await page.locator('#preview-rows table').count()) throw Error('Timetable review is not a course agenda');
  const manual=page.locator('#preview-rows .session-card').first();
  if(await manual.getAttribute('open')===null) await manual.locator('summary').click();
  await manual.locator('input[placeholder="课程名"]').fill('COMP1311');
  await manual.locator('input[placeholder="课程名"]').press('Tab');
  await page.locator('#add-row').click();
  const extra=page.locator('#preview-rows .session-card').last();
  await extra.locator('input[placeholder="课程名"]').fill('TEMP9999-LEC');
  await extra.locator('input[placeholder="课程名"]').press('Tab');
  await extra.locator('summary').click();
  await workflow('review-draft','check');
  await page.getByRole('button',{name:'删除 TEMP9999-LEC',exact:true}).click();
  await page.waitForFunction(()=>window.__store.attendanceDraft?.rows.length===1);
  if(await page.locator('#review-draft').isChecked() || await page.locator('#preview-rows .session-card').count()!==1) throw Error('Collapsed-row deletion did not remove only its draft or reset review');
  const qr=await QRCode.toBuffer('https://forms.office.com/r/AbC123');
  await page.locator('.binding input[type=file]').setInputFiles({name:'course.png',mimeType:'image/png',buffer:qr});
  await workflow('verify-all-bindings');
  await page.waitForFunction(()=>window.__openedTabs.length===1&&window.__openedTabs[0].url==='https://forms.office.com/r/AbC123');
  await page.evaluate(()=>window.__onMessage({type:'FORM_READY',url:'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=smoke',title:'COMP1311 Attendance',questions:[
    {title:'Student ID',type:'text',options:[]},{title:'Name',type:'text',options:[]},{title:'Date',type:'date',placeholder:'dd/MM/yyyy',options:[]}
  ]},{tab:{id:1}}));
  await page.locator('.mapping input[type=checkbox]').check();
  await page.getByRole('button',{name:'保存表单绑定'}).click();
  await workflow('check-setup');
  await page.waitForFunction(()=>window.__lastMessage?.type==='START_SETUP'||document.querySelector('#persistent-error').textContent.includes('先保存'),null,{timeout:3000});
  if((await page.evaluate(()=>window.__lastMessage)).type!=='START_SETUP') throw Error('Saved profile falsely rejected before testing: '+await page.locator('#persistent-error').textContent());
  await workflow('review-draft','check');
  await workflow('create-tasks');
  await page.waitForFunction(()=>document.querySelector('#persistent-error')?.textContent?.includes('检查并确认'));
  if((await page.evaluate(()=>window.__store.attendanceSessions))?.length) throw Error('Unchecked draft activated');
  const checkData=await page.evaluate(()=>window.__store);
  const checked=buildVariants(checkData.attendanceDraft.rows,checkData.attendanceBindings,checkData.attendanceProfile).map(i=>({...i,state:'passed'}));
  await page.evaluate(items=>window.chrome.storage.local.set({attendanceSetupHistory:[{id:'simulated-confirmed-session',startedAt:new Date().toISOString(),state:'completed',items}]}),checked);
  await page.evaluate(()=>{
    const original=chrome.storage.local.get;window.__originalGet=original;window.__pauseActivation=true;
    document.querySelector('#persistent-error').textContent='';
    chrome.storage.local.get=async keys=>{const data=await original(keys);if(window.__pauseActivation&&keys.includes('attendanceDraft')) {window.__pauseActivation=false;window.__activationReading=true;await new Promise(resolve=>window.__releaseActivation=resolve);}return data;};
  });
  await workflow('create-tasks');
  await page.waitForFunction(()=>window.__activationReading);
  const changing=page.locator('#preview-rows .session-card').first();
  if(!await changing.evaluate(el=>el.open)) await changing.locator('summary').click();
  await changing.locator('input[type=time]').first().fill('08:00');
  await changing.locator('input[type=time]').first().press('Tab');
  await page.evaluate(()=>window.__releaseActivation());
  await page.waitForFunction(()=>window.__store.attendanceSessions?.length||document.querySelector('#persistent-error').textContent.includes('课表已变化'));
  if((await page.evaluate(()=>window.__store.attendanceSessions))?.length) throw Error('A draft edited during activation was enabled without renewed review');
  await page.evaluate(()=>chrome.storage.local.get=window.__originalGet);
  await workflow('review-draft','check');
  await workflow('create-tasks');
  await page.waitForFunction(()=>document.querySelector('#sessions')?.textContent?.includes('COMP1311'));
  if(await page.locator('#term-start, #term-end, #confirm-tomorrow').count()) throw Error('Old term dates or daily confirmation are still visible');
  const created=await page.evaluate(()=>window.__store.attendanceSessions?.[0]);
  if(created?.kind!=='weekly' || created.startDate || created.endDate) throw Error('Task was not created as a weekly automatic session');
  await page.mouse.move(5,5);
  await page.waitForFunction(()=>!document.querySelector('#toast').classList.contains('visible'));
  await page.screenshot({path:fileURLToPath(new URL('../preview.png',import.meta.url)),fullPage:true});
  await mkdir('outputs',{recursive:true});
  for(const [name,width] of [['desktop',1360],['narrow',390],['small',320]]) {
    await page.setViewportSize({width,height:900});
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw Error(`${name} settings overflow`);
    await page.screenshot({path:fileURLToPath(new URL(`../outputs/settings-${name}.png`,import.meta.url)),fullPage:true});
    await page.locator('#dock-toggle').hover();
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw Error(`${name} expanded navigation overflow`);
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#workflow-panel')).opacity==='1');
    await page.evaluate(()=>{const toast=document.querySelector('#toast');toast.textContent='请先检查并确认这些课型：COMP1311。';toast.classList.add('visible');});
    await page.waitForFunction(()=>{
      const toast=document.querySelector('#toast'),panel=document.querySelector('#workflow-panel');
      return toast.getBoundingClientRect().bottom<=panel.getBoundingClientRect().top;
    });
    if(!await page.locator('#create-tasks').evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;})) throw Error(`${name} toast blocked navigation action`);
    await page.screenshot({path:fileURLToPath(new URL(`../outputs/navigation-${name}.png`,import.meta.url))});
    await page.evaluate(()=>document.querySelector('#toast').classList.remove('visible'));
    await page.mouse.move(5,5);
  }
  await page.setViewportSize({width:1360,height:900});
  const unnamed=await page.locator('button,input:not([type=hidden]),select').evaluateAll(elements=>elements.filter(el=>!(el.getAttribute('aria-label')||el.getAttribute('aria-labelledby')||el.labels?.length||el.tagName==='BUTTON'&&el.textContent.trim())).map(el=>el.outerHTML));
  if(unnamed.length) throw Error(`Unnamed settings controls: ${unnamed.join('; ')}`);
  const pdf=await PDFDocument.create(),pdfPage=pdf.addPage([600,800]),font=await pdf.embedFont(StandardFonts.Helvetica);
  pdfPage.drawText('Monday 09:00-10:30 COMP1311 Lecture',{x:60,y:740,size:16,font});
  await page.locator('#timetable-file').setInputFiles({name:'timetable.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});
  await page.waitForFunction(()=>document.querySelectorAll('#preview-rows .session-card').length>=1,null,{timeout:30000});
  for(const [envName,name,mimeType] of [
    ['ATTENDANCE_SAMPLE_PDF','sample.pdf','application/pdf'],
    ['ATTENDANCE_SAMPLE_JPG','sample.jpg','image/jpeg']
  ]) {
    const samplePath=process.env[envName];
    if(!samplePath) continue;
    const before=await page.locator('#preview-rows .session-card').count();
    await page.locator('#timetable-file').setInputFiles({name,mimeType,buffer:await readFile(samplePath)});
    await page.waitForFunction(before=>document.querySelectorAll('#preview-rows .session-card').length>=before+20 || document.querySelector('#import-status')?.textContent?.includes('没有可靠识别'),before,{timeout:90000});
    const after=await page.locator('#preview-rows .session-card').count();
    if(after!==before+20) throw Error(`${name} imported ${after-before} rows: ${await page.locator('#import-status').textContent()}`);
    if(!(await page.locator('#import-status').textContent()).includes('请删除不属于自己的 Group')) throw Error(`${name} did not warn about parallel lab groups`);
    if(await page.locator('#preview-rows .agenda-day').count()<4) throw Error(`${name} did not group lessons by day`);
    const imported=await page.locator('#preview-rows .session-card').evaluateAll(rows=>rows.map(row=>({
      course:row.querySelector('input[placeholder="课程名"]')?.value,
      weekday:row.querySelector('select')?.value,
      times:[...row.querySelectorAll('input[type="time"]')].map(input=>input.value)
    })));
    if(!imported.some(row=>row.course==='COMP1314-LAB Group 1' && row.weekday==='3' && row.times.join('-')==='11:00-13:00')) {
      throw Error(`${name} missed the Wednesday two-hour lab`);
    }
    if(envName==='ATTENDANCE_SAMPLE_PDF' || (envName==='ATTENDANCE_SAMPLE_JPG' && !process.env.ATTENDANCE_SAMPLE_PDF)) {
      await page.locator('section[aria-labelledby="import-heading"]').screenshot({path:fileURLToPath(new URL('../preview-agenda.png',import.meta.url))});
    }
    if(envName==='ATTENDANCE_SAMPLE_JPG') {
      const pngBase64=await page.evaluate(async encoded=>{
        const image=new Image();image.src=`data:image/jpeg;base64,${encoded}`;await image.decode();
        const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
        canvas.getContext('2d').drawImage(image,0,0);return canvas.toDataURL('image/png').split(',')[1];
      },(await readFile(samplePath)).toString('base64'));
      const pngBefore=await page.locator('#preview-rows .session-card').count();
      await page.locator('#timetable-file').setInputFiles({name:'sample.png',mimeType:'image/png',buffer:Buffer.from(pngBase64,'base64')});
      await page.waitForFunction(count=>document.querySelectorAll('#preview-rows .session-card').length>=count+20 || document.querySelector('#import-status')?.textContent?.includes('没有可靠识别'),pngBefore,{timeout:90000});
      if(await page.locator('#preview-rows .session-card').count()!==pngBefore+20) throw Error(`sample.png import failed: ${await page.locator('#import-status').textContent()}`);
    }
  }
  await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=220;
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1600,220);
    ctx.fillStyle='black';ctx.font='46px Arial';ctx.fillText('Tuesday 11:00-12:00 COMP1300 Lab',40,115);
    canvas.id='scan-fixture';document.body.append(canvas);
  });
  const image=await page.locator('#scan-fixture').screenshot({type:'jpeg',quality:95});
  if(image[0]!==0xff || image[1]!==0xd8) throw Error(`Screenshot was not JPEG: ${Buffer.from(image).subarray(0,8).toString('hex')}`);
  let before=await page.locator('#preview-rows .session-card').count();
  await page.locator('#timetable-file').setInputFiles({name:'scan.jpg',mimeType:'image/jpeg',buffer:image});
  await page.waitForFunction(before=>document.querySelectorAll('#preview-rows .session-card').length>=before+1,before,{timeout:90000});
  const png=await page.locator('#scan-fixture').screenshot({type:'png'});
  before=await page.locator('#preview-rows .session-card').count();
  await page.locator('#timetable-file').setInputFiles({name:'scan.png',mimeType:'image/png',buffer:png});
  await page.waitForFunction(before=>document.querySelectorAll('#preview-rows .session-card').length>=before+1 || document.querySelector('#import-status')?.textContent?.includes('只支持'),before,{timeout:90000});
  if(await page.locator('#preview-rows .session-card').count()<before+1) throw Error(`PNG import failed: ${await page.locator('#import-status').textContent()}`);
  if(image[0]!==0xff || image[1]!==0xd8) throw Error(`JPEG buffer changed: ${Buffer.from(image).subarray(0,8).toString('hex')}`);
  const scan=await PDFDocument.create(),scanPage=scan.addPage([800,150]),embedded=await scan.embedJpg(Uint8Array.from(image));
  scanPage.drawImage(embedded,{x:0,y:0,width:800,height:150});
  before=await page.locator('#preview-rows .session-card').count();
  await page.locator('#timetable-file').setInputFiles({name:'scanned.pdf',mimeType:'application/pdf',buffer:Buffer.from(await scan.save())});
  await page.waitForFunction(before=>document.querySelectorAll('#preview-rows .session-card').length>=before+1,before,{timeout:90000});
  // Reload restores the autosaved, inactive draft without modifying active tasks.
  await page.waitForFunction(()=>window.__store.attendanceDraft?.rows?.length===document.querySelectorAll('#preview-rows .session-card').length);
  const draftBeforeReload=await page.evaluate(()=>window.__store.attendanceDraft.rows.length);
  await page.reload();
  try {await page.waitForFunction(count=>document.querySelectorAll('#preview-rows .session-card').length===count,draftBeforeReload);} catch(e) {throw Error(`Reload expected ${draftBeforeReload}, got ${await page.locator('#preview-rows .session-card').count()}; ${errors.join('; ')}; ${await page.locator('#persistent-error').textContent()}`);}
  if(!(await page.evaluate(()=>window.__store.attendanceSessions))?.length) throw Error('Draft reload lost active tasks');
  await page.locator('#add-row').click();
  const labCard=page.locator('#preview-rows .session-card[open]').last();
  await labCard.locator('input[placeholder="课程名"]').fill('COMP9999-LAB Group 1');
  await labCard.locator('input[placeholder="课程名"]').press('Tab');
  await page.locator('#add-row').click();
  const tutorialCard=page.locator('#preview-rows .session-card[open]').last();
  await tutorialCard.locator('input[placeholder="课程名"]').fill('COMP9999-TUT');
  await tutorialCard.locator('input[placeholder="课程名"]').press('Tab');
  const moduleBinding=page.locator('.binding').filter({has:page.locator('h3',{hasText:'COMP9999'})});
  if(await moduleBinding.count()!==1 || await page.locator('.binding h3').filter({hasText:'COMP9999'}).count()!==1) throw Error('Course variants did not share one module card');
  await moduleBinding.locator('input[type=url]').fill('https://forms.office.com/r/SharedTest');
  const allBindingInputs=page.locator('.binding input[type=url]');
  for(let index=0;index<await allBindingInputs.count();index++) {
    if(!await allBindingInputs.nth(index).inputValue()) await allBindingInputs.nth(index).fill(`https://forms.office.com/r/Bulk${index}`);
  }
  const bindingCount=await page.locator('.binding').count();
  const openedBefore=await page.evaluate(()=>window.__openedTabs.length);
  await workflow('verify-all-bindings');
  try {await page.waitForFunction(({before,count})=>window.__openedTabs.length===before+count,{before:openedBefore,count:bindingCount});} catch(error) {
    throw Error(`${error.message}; opened=${JSON.stringify(await page.evaluate(()=>window.__openedTabs))}; persistent=${await page.locator('#persistent-error').textContent()}`);
  }
  const moduleTab=await page.evaluate(()=>window.__openedTabs.find(tab=>tab.url.includes('SharedTest'))?.id);
  await page.evaluate(tabId=>window.__onMessage({type:'FORM_READY',url:'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=tutorial-smoke',title:'COMP9999 Attendance',questions:[
    {title:'1.Enter your University Student ID Number',type:'text',options:[]},
    {title:'2.Name',type:'text',options:[]},
    {title:'3.Date of Class the attended',type:'date',placeholder:'dd/MM/yyyy',options:[]},
    {title:'4.Module Delivery',type:'radio',options:['Lecture','Tutorial','Laboratory']},
    {title:'5.Please choose one from the below',type:'radio',options:["I'm a Local Student","I'm an International Student"]}
    ]},{tab:{id:tabId}}),moduleTab);
  const tutorialChoices=await moduleBinding.locator('.mapping-row select').evaluateAll(selects=>selects.map(select=>({selected:select.value,choices:[...select.options].map(option=>option.value)})));
  if(JSON.stringify(tutorialChoices)!==JSON.stringify([
    {selected:'student',choices:['student']},{selected:'name',choices:['name']},{selected:'date',choices:['date']},
    {selected:'delivery',choices:['delivery','delivery:lecture','delivery:tutorial','delivery:lab']},
    {selected:'local',choices:['local','local:local','local:international']}
  ])) throw Error(`Question-specific mapping choices incorrect: ${JSON.stringify(tutorialChoices)}`);
  await moduleBinding.locator('.mapping input[type=checkbox]').check();
  await moduleBinding.getByRole('button',{name:'保存表单绑定'}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.binding')].some(card=>card.querySelector('h3')?.textContent==='COMP9999' && card.textContent.includes('已核对')));
  const shared=await page.evaluate(()=>window.__store.attendanceBindings?.COMP9999);
  if(shared?.scope!=='module' || shared?.url!=='https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=tutorial-smoke') throw Error('Shared module binding was not saved');
  if(await moduleBinding.getByLabel('COMP9999 仅填写测试的课型').count() || await page.locator('#import-comparison').count()) throw Error('Removed course choice or import comparison remains');
  const form=await browser.newPage(),day=todayMalaysia(),shownDate=day.split('-').reverse().join('/');
  const formUrl='https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=smoke';
  const mockFormHtml=`<!doctype html><meta charset="utf-8"><div data-automation-id="formTitle">COMP1311 Attendance</div><div data-automation-id="questionItem"><div data-automation-id="questionTitle">Student ID</div><input data-automation-id="textInput"></div><div data-automation-id="questionItem"><div data-automation-id="questionTitle">Name</div><input data-automation-id="textInput"></div><div data-automation-id="questionItem"><div data-automation-id="questionTitle">Date</div><input role="combobox" placeholder="dd/MM/yyyy" value="${shownDate}" aria-controls="correct-calendar" onclick="window.__dateClicked=true;document.querySelector('#correct-calendar').hidden=false"></div><div id="correct-calendar" hidden><button class="js-goToday" onclick="window.__goTodayClicked=true">转到今日</button><button class="ms-CalendarDay-dayIsToday" onclick="document.querySelector('[role=combobox]').value='${shownDate}';document.querySelector('#correct-calendar').hidden=true">Today</button></div><button data-automation-id="submitButton" onclick="this.remove();document.body.append('Your response was submitted')">Submit</button>`;
  const setupForm=await browser.newPage();
  await setupForm.addInitScript(({formUrl})=>{
    window.__setupMessages=[];window.__submitClicks=0;
    document.addEventListener('click',event=>{if(event.target.matches('[data-automation-id="submitButton"]')) window.__submitClicks++;},true);
    const chrome=window.chrome||{};chrome.runtime={sendMessage:async message=>{
      window.__setupMessages.push(message);
      if(message.type==='GET_SETUP_ITEM') return {course:'COMP1311',binding:{scope:'module',url:formUrl,title:'COMP1311 Attendance',verified:true,mapping:[{title:'Student ID',type:'text',options:[],field:'student'},{title:'Name',type:'text',options:[],field:'name'},{title:'Date',type:'date',options:[],field:'date'}]},profile:{student:'12345',name:'Test Student',studentType:'local'}};
      return {ok:true};
    }};window.chrome=chrome;
  },{formUrl});
  await setupForm.route('https://forms.cloud.microsoft/Pages/ResponsePage.aspx*',route=>route.fulfill({contentType:'text/html',body:mockFormHtml}));
  await setupForm.goto(formUrl+'#attendanceSetup=isolated-session&attendanceItem=one');
  await setupForm.addScriptTag({content:await readFile(join(extension,'content.js'),'utf8')});
  await setupForm.waitForFunction(()=>window.__setupMessages.some(m=>m.state==='awaiting_confirmation'));
  if(await setupForm.evaluate(()=>window.__setupMessages.some(m=>m.type==='CONFIRM_SETUP_ITEM'))) throw Error('Setup passed without student confirmation');
  await setupForm.getByRole('button',{name:'我已查看并确认全部答案'}).click();
  await setupForm.waitForFunction(()=>window.__setupMessages.some(m=>m.type==='CONFIRM_SETUP_ITEM'));
  if(await setupForm.evaluate(()=>window.__submitClicks)!==0||await setupForm.locator('[data-automation-id="submitButton"]').count()!==1) throw Error('Complete setup check clicked submit');
  await form.addInitScript(({formUrl,day})=>{
    window.__reports=[];
    const chrome=window.chrome||{};
    chrome.runtime={sendMessage:async message=>{
      if(message.type==='GET_RUN') return {occ:{course:'COMP1311',date:day,time:'09:00'},binding:{url:formUrl,title:'COMP1311 Attendance',verified:true,mapping:[
        {title:'Student ID',type:'text',options:[],field:'student'},
        {title:'Name',type:'text',options:[],field:'name'},
        {title:'Date',type:'date',options:[],field:'date'}
      ]},profile:{student:'12345',name:'Test Student',studentType:'local'}};
      if(message.type==='REPORT_RUN') window.__reports.push(message.state);
      return {ok:true};
    }};window.chrome=chrome;
  },{formUrl,day});
  await form.route('https://forms.cloud.microsoft/Pages/ResponsePage.aspx*',route=>route.fulfill({contentType:'text/html',body:mockFormHtml}));
  await form.goto(formUrl+'#attendanceRun=smoke');
  await form.addScriptTag({content:await readFile(join(extension,'content.js'),'utf8')});
  await form.waitForFunction(()=>window.__reports?.includes('success'),null,{timeout:15000});
  const values=await form.locator('[data-automation-id="questionItem"] input').evaluateAll(elements=>elements.map(x=>x.value));
  if(JSON.stringify(values)!==JSON.stringify(['12345','Test Student',shownDate])) throw Error(`Form values incorrect: ${JSON.stringify(values)}`);
  if(!await form.evaluate(()=>window.__dateClicked&&window.__goTodayClicked)) throw Error('Date did not go to today before selection');
  const calendar=await browser.newPage(),calendarUrl='https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=calendar';
  const previous=new Date(`${day}T00:00:00Z`);previous.setUTCDate(previous.getUTCDate()-1);
  const previousDate=`${previous.getUTCFullYear()}/${previous.getUTCMonth()+1}/${previous.getUTCDate()}`;
  const calendarDate=`${day.slice(0,4)}/${Number(day.slice(5,7))}/${Number(day.slice(8,10))}`;
  const calendarHtml=`<!doctype html><meta charset="utf-8"><div data-automation-id="formTitle">COMP1311 Calendar Test</div><div data-automation-id="questionItem"><div data-automation-id="questionTitle">Date</div><input id="date-input" role="combobox" aria-expanded="true" aria-controls="DatePicker-Callout1" placeholder="yyyy/M/d" value="${previousDate}" onclick="window.__calendarToggled=true"></div><div id="DatePicker-Callout1"><button class="js-goToday" onclick="window.__goTodayClicked=true">转到今日</button><table><tr><td role="gridcell" aria-current="date" aria-disabled="false"><button type="button" onclick="if(window.__goTodayClicked) document.querySelector('#date-input').value='${calendarDate}'">${Number(day.slice(8,10))}</button></td></tr></table></div><button data-automation-id="submitButton" onclick="this.remove();document.body.append('Your response was submitted')">Submit</button>`;
  await calendar.addInitScript(({calendarUrl,day})=>{
    window.__reports=[];const chrome=window.chrome||{};
    chrome.runtime={sendMessage:async message=>{
      if(message.type==='GET_RUN') return {occ:{course:'COMP1311',date:day,time:'09:00'},binding:{url:calendarUrl,title:'COMP1311 Calendar Test',verified:true,mapping:[{title:'Date',type:'date',options:[],field:'date'}]},profile:{student:'12345',name:'Test Student',studentType:'local'}};
      if(message.type==='REPORT_RUN') window.__reports.push(message.state);
      return {ok:true};
    }};window.chrome=chrome;
  },{calendarUrl,day});
  await calendar.route('https://forms.cloud.microsoft/Pages/ResponsePage.aspx*',route=>route.fulfill({contentType:'text/html',body:calendarHtml}));
  await calendar.goto(calendarUrl+'#attendanceRun=calendar');
  await calendar.addScriptTag({content:await readFile(join(extension,'content.js'),'utf8')});
  await calendar.waitForFunction(()=>window.__reports?.includes('success'),null,{timeout:15000});
  if(await calendar.locator('#date-input').inputValue()!==calendarDate || await calendar.evaluate(()=>window.__calendarToggled||!window.__goTodayClicked)) throw Error('Already-open calendar did not correct the previous date safely');
  const labForm=await browser.newPage(),labFormUrl='https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=lab-smoke';
  const labFormHtml='<!doctype html><meta charset="utf-8"><div data-automation-id="formTitle">COMP9999 Attendance</div><div data-automation-id="questionItem"><div data-automation-id="questionTitle">Student ID</div><input data-automation-id="textInput"></div><div data-automation-id="questionItem"><div data-automation-id="questionTitle">Name</div><input data-automation-id="textInput"></div><div data-automation-id="questionItem"><div data-automation-id="questionTitle">Module Delivery</div><label><input type="radio" name="delivery" value="Lecture">Lecture</label><label><input type="radio" name="delivery" value="Lab">Lab</label></div><button data-automation-id="submitButton">Submit</button>';
  await labForm.addInitScript(({labFormUrl})=>{
    const chrome=window.chrome||{};
    chrome.storage={local:{get:async()=>({attendanceBindings:{COMP9999:{url:labFormUrl,title:'COMP9999 Attendance',verified:true,scope:'module',mapping:[
      {title:'Student ID',type:'text',options:[],field:'student'},
      {title:'Name',type:'text',options:[],field:'name'},
      {title:'Module Delivery',type:'radio',options:['Lecture','Lab'],field:'delivery:lab'}
    ]}},attendanceProfile:{student:'12345',name:'Test Student',studentType:'local'}})}};
    chrome.runtime={sendMessage:async()=>({ok:true})};window.chrome=chrome;
  },{labFormUrl});
  await labForm.route('https://forms.cloud.microsoft/Pages/ResponsePage.aspx*',route=>route.fulfill({contentType:'text/html',body:labFormHtml}));
  await labForm.goto(labFormUrl+'#attendanceCheck=COMP9999-LAB%20Group%201');
  await labForm.addScriptTag({content:await readFile(join(extension,'content.js'),'utf8')});
  await labForm.waitForFunction(()=>document.querySelector('#attendance-helper-status')?.textContent?.includes('仅填写，未提交'),null,{timeout:15000});
  if(!await labForm.locator('input[value="Lab"]').isChecked() || await labForm.locator('input[value="Lecture"]').isChecked()) throw Error('Lab form selection was incorrect');
  if(await labForm.locator('[data-automation-id="submitButton"]').count()!==1) throw Error('Lab only-fill test submitted the form');
  const tutorialForm=await browser.newPage(),tutorialFormUrl='https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=tutorial-smoke';
  const tutorialFormHtml=`<!doctype html><meta charset="utf-8"><div data-automation-id="formTitle">COMP9999 Attendance</div><div data-automation-id="questionItem"><div data-automation-id="questionTitle">1.Enter your University Student ID Number</div><input data-automation-id="textInput"></div><div data-automation-id="questionItem"><div data-automation-id="questionTitle">2.Name</div><input data-automation-id="textInput"></div><div data-automation-id="questionItem"><div data-automation-id="questionTitle">3.Date of Class the attended</div><input role="combobox" placeholder="dd/MM/yyyy" onclick="if(!document.querySelector('.ms-CalendarDay-dayIsToday')){const b=document.createElement('button');b.className='ms-CalendarDay-dayIsToday';b.textContent='Today';b.onclick=()=>{if(window.__tutorialToday) document.querySelector('[role=combobox]').value='${shownDate}';b.remove();document.querySelector('.js-goToday').remove()};const g=document.createElement('button');g.className='js-goToday';g.textContent='Go to today';g.onclick=()=>window.__tutorialToday=true;document.body.append(g,b)}"></div><div data-automation-id="questionItem"><div data-automation-id="questionTitle">4.Module Delivery</div><label><input type="radio" name="delivery" value="Lecture">Lecture</label><label><input type="radio" name="delivery" value="Tutorial">Tutorial</label><label><input type="radio" name="delivery" value="Laboratory">Laboratory</label></div><div data-automation-id="questionItem"><div data-automation-id="questionTitle">5.Please choose one from the below</div><label><input type="radio" name="identity" value="I'm a Local Student">Local</label><label><input type="radio" name="identity" value="I'm an International Student">International</label></div><button data-automation-id="submitButton">Submit</button>`;
  await tutorialForm.addInitScript(({tutorialFormUrl})=>{
    const chrome=window.chrome||{};
    chrome.storage={local:{get:async()=>({attendanceBindings:{COMP9999:{url:tutorialFormUrl,title:'COMP9999 Attendance',verified:true,scope:'module',mapping:[
      {title:'1.Enter your University Student ID Number',type:'text',options:[],field:'student'},
      {title:'2.Name',type:'text',options:[],field:'name'},
      {title:'3.Date of Class the attended',type:'date',placeholder:'dd/MM/yyyy',options:[],field:'date'},
      {title:'4.Module Delivery',type:'radio',options:['Lecture','Tutorial','Laboratory'],field:'delivery'},
      {title:'5.Please choose one from the below',type:'radio',options:["I'm a Local Student","I'm an International Student"],field:'local'}
    ]}},attendanceProfile:{student:'12345',name:'Test Student',studentType:'local'}})}};
    chrome.runtime={sendMessage:async()=>({ok:true})};window.chrome=chrome;
  },{tutorialFormUrl});
  await tutorialForm.route('https://forms.cloud.microsoft/Pages/ResponsePage.aspx*',route=>route.fulfill({contentType:'text/html',body:tutorialFormHtml}));
  await tutorialForm.goto(tutorialFormUrl+'#attendanceCheck=COMP9999-TUT');
  await tutorialForm.addScriptTag({content:await readFile(join(extension,'content.js'),'utf8')});
  await tutorialForm.waitForFunction(()=>document.querySelector('#attendance-helper-status')?.textContent?.includes('仅填写，未提交'),null,{timeout:15000});
  if(!await tutorialForm.locator('input[value="Tutorial"]').isChecked() || !await tutorialForm.locator('input[value="I\'m a Local Student"]').isChecked()) throw Error('Tutorial or Local radio selection was incorrect');
  if(!await tutorialForm.locator('#attendance-helper-status').textContent().then(text=>text.includes('COMP9999-TUT · Module Delivery: Tutorial'))) throw Error('Only-fill pass did not identify the verified course and delivery');
  if(await tutorialForm.locator('input[role="combobox"]').inputValue()!==shownDate || await tutorialForm.locator('[data-automation-id="submitButton"]').count()!==1) throw Error('Tutorial date selection or only-fill state was incorrect');
  await tutorialForm.locator('input[value="Lecture"]').click();
  await tutorialForm.waitForFunction(()=>document.querySelector('#attendance-helper-status')?.textContent?.includes('核对不再通过'),null,{timeout:5000});
  const conflictForm=await browser.newPage(),conflictUrl='https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=conflict';
  const conflictHtml='<!doctype html><meta charset="utf-8"><div data-automation-id="formTitle">COMP9999 Attendance</div><div data-automation-id="questionItem"><div data-automation-id="questionTitle">Module Delivery</div><label><input type="radio" name="lecture-group" value="Lecture">Lecture</label><label><input type="radio" name="other-group" value="Tutorial" checked>Tutorial</label></div><button data-automation-id="submitButton">Submit</button>';
  await conflictForm.addInitScript(({conflictUrl})=>{const chrome=window.chrome||{};chrome.storage={local:{get:async()=>({attendanceBindings:{COMP9999:{url:conflictUrl,title:'COMP9999 Attendance',verified:true,scope:'module',mapping:[{title:'Module Delivery',type:'radio',options:['Lecture','Tutorial'],field:'delivery'}]}},attendanceProfile:{student:'12345',name:'Test Student',studentType:'local'}})}};chrome.runtime={sendMessage:async()=>({ok:true})};window.chrome=chrome;},{conflictUrl});
  await conflictForm.route('https://forms.cloud.microsoft/Pages/ResponsePage.aspx*',route=>route.fulfill({contentType:'text/html',body:conflictHtml}));
  await conflictForm.goto(conflictUrl+'#attendanceCheck=COMP9999-LEC');
  await conflictForm.addScriptTag({content:await readFile(join(extension,'content.js'),'utf8')});
  await conflictForm.waitForFunction(()=>document.querySelector('#attendance-helper-status')?.textContent?.includes('核对失败'),null,{timeout:15000});
  if(await conflictForm.locator('#attendance-helper-status').textContent().then(text=>text.includes('核对通过'))) throw Error('Conflicting radio answers were accepted');
  const stale=await browser.newPage(),yesterday=new Date(`${day}T00:00:00Z`);yesterday.setUTCDate(yesterday.getUTCDate()-1);
  await stale.addInitScript(({formUrl,date})=>{
    window.__reports=[];const chrome=window.chrome||{};
    chrome.runtime={sendMessage:async message=>{
      if(message.type==='GET_RUN') return {occ:{course:'COMP1311',date,time:'09:00'},binding:{url:formUrl,title:'COMP1311 Attendance',verified:true,mapping:[]},profile:{student:'12345',name:'Test Student',studentType:'local'}};
      if(message.type==='REPORT_RUN') window.__reports.push(message.state);
      return {ok:true};
    }};window.chrome=chrome;
  },{formUrl,date:yesterday.toISOString().slice(0,10)});
  await stale.route('https://forms.cloud.microsoft/Pages/ResponsePage.aspx*',route=>route.fulfill({contentType:'text/html',body:mockFormHtml}));
  await stale.goto(formUrl+'#attendanceRun=stale');
  await stale.addScriptTag({content:await readFile(join(extension,'content.js'),'utf8')});
  await stale.waitForFunction(()=>window.__reports?.includes('failed'),null,{timeout:15000});
  if(await stale.locator('[data-automation-id="submitButton"]').count()!==1) throw Error('Date mismatch submitted the form');
  await page.evaluate(()=>{window.__store.attendanceRecords={sample:{state:'success',at:'2026-09-30T09:00:00Z'}};});
  page.on('dialog',dialog=>dialog.accept());
  if(await page.locator('#preview-rows .session-card').count()===0) throw Error('Clear preview test had no courses');
  await page.locator('#clear-preview').click();
  if(await page.locator('#preview-rows .session-card').count()!==0 || (await page.evaluate(()=>window.__store.attendanceSessions))?.length===0) throw Error('Section 2 clear affected saved tasks or left preview rows');
  await page.locator('#clear-bindings').click();
  const afterBindings=await page.evaluate(()=>window.__store);
  if(Object.keys(afterBindings.attendanceBindings||{}).length || !afterBindings.attendanceSessions?.length || !afterBindings.attendanceProfile?.student) throw Error('Section 3 clear affected other sections');
  await page.locator('#clear-sessions').click();
  const afterSessions=await page.evaluate(()=>window.__store);
  if(afterSessions.attendanceSessions?.length || !afterSessions.attendanceProfile?.student || !afterSessions.attendanceRecords?.sample) throw Error('Section 4 clear affected profile or records');
  if(!await page.locator('#sessions').textContent().then(text=>text.includes('还没有任务'))) throw Error('Section 4 did not update its empty state');
  if(errors.length) throw Error(`Browser errors: ${errors.join('; ')}`);
  console.log('Options page, QR, PDF/JPG/PNG OCR, category-specific mapping, Lab/Tutorial selection, date selection, confirmed form submission, and independent section clearing passed.');
} finally {
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
