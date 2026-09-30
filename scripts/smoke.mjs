import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import QRCode from 'qrcode';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {todayMalaysia} from '../src/schedule.js';

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
    const store={};window.__store=store;let nextTab=1;
    const chrome=window.chrome||{};
    chrome.runtime={getURL:path=>base+path,sendMessage:async()=>({ok:true}),onMessage:{addListener:fn=>{window.__onMessage=fn;}}};
    chrome.storage={local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(key=>key in store).map(key=>[key,store[key]])),set:async values=>Object.assign(store,values)},onChanged:{addListener:()=>{}}};
    chrome.tabs={create:async options=>{window.__lastCreatedUrl=options.url;return {id:nextTab++};},update:async(_id,options)=>{window.__lastOpenedUrl=options.url;}};
    window.chrome=chrome;
  },{base});
  await page.goto(base+'options.html');
  await page.locator('h1').waitFor();
  await page.locator('#profile-form input[name=student]').fill('12345');
  await page.locator('#profile-form input[name=name]').fill('Test Student');
  await page.locator('#profile-form button').click();
  await page.locator('#add-row').click();
  if(await page.locator('#preview-rows .session-card').count()!==1 || await page.locator('#preview-rows table').count()) throw Error('Timetable review is not a course agenda');
  const manual=page.locator('#preview-rows .session-card').first();
  if(await manual.getAttribute('open')===null) await manual.locator('summary').click();
  await manual.locator('input[placeholder="课程名"]').fill('COMP1311');
  await manual.locator('input[placeholder="课程名"]').press('Tab');
  const qr=await QRCode.toBuffer('https://forms.office.com/r/AbC123');
  await page.locator('.binding input[type=file]').setInputFiles({name:'course.png',mimeType:'image/png',buffer:qr});
  await page.waitForFunction(()=>window.__lastOpenedUrl==='https://forms.office.com/r/AbC123');
  await page.evaluate(()=>window.__onMessage({type:'FORM_READY',url:'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=smoke',title:'COMP1311 Attendance',questions:[
    {title:'Student ID',type:'text',options:[]},{title:'Name',type:'text',options:[]},{title:'Date',type:'date',placeholder:'dd/MM/yyyy',options:[]}
  ]},{tab:{id:1}}));
  await page.locator('.mapping input[type=checkbox]').check();
  await page.locator('.mapping button').click();
  await page.locator('#create-tasks').click();
  await page.waitForFunction(()=>document.querySelector('#sessions')?.textContent?.includes('COMP1311'));
  if(await page.locator('#term-start, #term-end, #confirm-tomorrow').count()) throw Error('Old term dates or daily confirmation are still visible');
  const created=await page.evaluate(()=>window.__store.attendanceSessions?.[0]);
  if(created?.kind!=='weekly' || created.startDate || created.endDate) throw Error('Task was not created as a weekly automatic session');
  await page.screenshot({path:fileURLToPath(new URL('../preview.png',import.meta.url)),fullPage:true});
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
  await moduleBinding.getByRole('button',{name:'打开并核对表单'}).click();
  await page.evaluate(()=>window.__onMessage({type:'FORM_READY',url:'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=tutorial-smoke',title:'COMP9999 Attendance',questions:[
    {title:'1.Enter your University Student ID Number',type:'text',options:[]},
    {title:'2.Name',type:'text',options:[]},
    {title:'3.Date of Class the attended',type:'date',placeholder:'dd/MM/yyyy',options:[]},
    {title:'4.Module Delivery',type:'radio',options:['Lecture','Tutorial','Laboratory']},
    {title:'5.Please choose one from the below',type:'radio',options:["I'm a Local Student","I'm an International Student"]}
  ]},{tab:{id:2}}));
  const tutorialChoices=await moduleBinding.locator('.mapping-row select').evaluateAll(selects=>selects.map(select=>({selected:select.value,choices:[...select.options].map(option=>option.value)})));
  if(JSON.stringify(tutorialChoices)!==JSON.stringify([
    {selected:'student',choices:['student']},{selected:'name',choices:['name']},{selected:'date',choices:['date']},
    {selected:'delivery',choices:['delivery','delivery:lecture','delivery:tutorial','delivery:lab']},
    {selected:'local',choices:['local','local:local','local:international']}
  ])) throw Error(`Question-specific mapping choices incorrect: ${JSON.stringify(tutorialChoices)}`);
  await moduleBinding.locator('.mapping input[type=checkbox]').check();
  await moduleBinding.locator('.mapping button').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.binding')].some(card=>card.querySelector('h3')?.textContent==='COMP9999' && card.textContent.includes('已核对')));
  const shared=await page.evaluate(()=>window.__store.attendanceBindings?.COMP9999);
  if(shared?.scope!=='module' || shared?.url!=='https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=tutorial-smoke') throw Error('Shared module binding was not saved');
  if(await moduleBinding.getByLabel('COMP9999 仅填写测试的课型').inputValue()!=='') throw Error('Shared module test selected a course without asking');
  const beforeTestUrl=await page.evaluate(()=>window.__lastCreatedUrl);
  await moduleBinding.getByRole('button',{name:'测试所选课型 · 不提交'}).click();
  if(await page.evaluate(()=>window.__lastCreatedUrl)!==beforeTestUrl || !await page.locator('#toast').textContent().then(text=>text.includes('先选择要测试'))) throw Error('Test ran without explicit course choice');
  await moduleBinding.getByLabel('COMP9999 仅填写测试的课型').selectOption('COMP9999-TUT');
  await moduleBinding.getByRole('button',{name:'测试所选课型 · 不提交'}).click();
  if(!String(await page.evaluate(()=>window.__lastCreatedUrl)).includes('attendanceCheck=COMP9999-TUT')) throw Error('Shared module test did not target the selected variant');
  const form=await browser.newPage(),day=todayMalaysia(),shownDate=day.split('-').reverse().join('/');
  const formUrl='https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=smoke';
  const mockFormHtml=`<!doctype html><meta charset="utf-8"><div data-automation-id="formTitle">COMP1311 Attendance</div><div data-automation-id="questionItem"><div data-automation-id="questionTitle">Student ID</div><input data-automation-id="textInput"></div><div data-automation-id="questionItem"><div data-automation-id="questionTitle">Name</div><input data-automation-id="textInput"></div><div data-automation-id="questionItem"><div data-automation-id="questionTitle">Date</div><input role="combobox" placeholder="dd/MM/yyyy" value="${shownDate}" onclick="window.__dateClicked=true"></div><button data-automation-id="submitButton" onclick="this.remove();document.body.append('Your response was submitted')">Submit</button>`;
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
  if(await form.evaluate(()=>window.__dateClicked)) throw Error('Already-correct date input was clicked unnecessarily');
  const calendar=await browser.newPage(),calendarUrl='https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=calendar';
  const previous=new Date(`${day}T00:00:00Z`);previous.setUTCDate(previous.getUTCDate()-1);
  const previousDate=`${previous.getUTCFullYear()}/${previous.getUTCMonth()+1}/${previous.getUTCDate()}`;
  const calendarDate=`${day.slice(0,4)}/${Number(day.slice(5,7))}/${Number(day.slice(8,10))}`;
  const calendarHtml=`<!doctype html><meta charset="utf-8"><div data-automation-id="formTitle">COMP1311 Calendar Test</div><div data-automation-id="questionItem"><div data-automation-id="questionTitle">Date</div><input id="date-input" role="combobox" aria-expanded="true" aria-controls="DatePicker-Callout1" placeholder="yyyy/M/d" value="${previousDate}" onclick="window.__calendarToggled=true"></div><div id="DatePicker-Callout1"><table><tr><td role="gridcell" aria-current="date" aria-disabled="false"><button type="button" onclick="document.querySelector('#date-input').value='${calendarDate}'">${Number(day.slice(8,10))}</button></td></tr></table></div><button data-automation-id="submitButton" onclick="this.remove();document.body.append('Your response was submitted')">Submit</button>`;
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
  if(await calendar.locator('#date-input').inputValue()!==calendarDate || await calendar.evaluate(()=>window.__calendarToggled)) throw Error('Already-open calendar did not correct the previous date safely');
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
  const tutorialFormHtml=`<!doctype html><meta charset="utf-8"><div data-automation-id="formTitle">COMP9999 Attendance</div><div data-automation-id="questionItem"><div data-automation-id="questionTitle">1.Enter your University Student ID Number</div><input data-automation-id="textInput"></div><div data-automation-id="questionItem"><div data-automation-id="questionTitle">2.Name</div><input data-automation-id="textInput"></div><div data-automation-id="questionItem"><div data-automation-id="questionTitle">3.Date of Class the attended</div><input role="combobox" placeholder="dd/MM/yyyy" onclick="if(!document.querySelector('.ms-CalendarDay-dayIsToday')){const b=document.createElement('button');b.className='ms-CalendarDay-dayIsToday';b.textContent='Today';b.onclick=()=>{document.querySelector('[role=combobox]').value='${shownDate}';b.remove()};document.body.append(b)}"></div><div data-automation-id="questionItem"><div data-automation-id="questionTitle">4.Module Delivery</div><label><input type="radio" name="delivery" value="Lecture">Lecture</label><label><input type="radio" name="delivery" value="Tutorial">Tutorial</label><label><input type="radio" name="delivery" value="Laboratory">Laboratory</label></div><div data-automation-id="questionItem"><div data-automation-id="questionTitle">5.Please choose one from the below</div><label><input type="radio" name="identity" value="I'm a Local Student">Local</label><label><input type="radio" name="identity" value="I'm an International Student">International</label></div><button data-automation-id="submitButton">Submit</button>`;
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
