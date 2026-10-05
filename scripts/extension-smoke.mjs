import {chromium} from 'playwright';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {todayMalaysia} from '../src/schedule.js';
const profile=await mkdtemp(join(tmpdir(),'attendance-mv3-'));
let context;
try {
  context=await chromium.launchPersistentContext(profile,{channel:process.env.ATTENDANCE_TEST_BROWSER||'chromium',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${resolve('extension')}`,`--load-extension=${resolve('extension')}`,'--host-resolver-rules=MAP qckpwckfukyurkobrsig.supabase.co ~NOTFOUND, MAP forms.office.com ~NOTFOUND, MAP forms.cloud.microsoft ~NOTFOUND']});
  await context.route('https://qckpwckfukyurkobrsig.supabase.co/**',route=>route.abort());
  let worker=context.serviceWorkers()[0];if(!worker) worker=await context.waitForEvent('serviceworker',{timeout:15000});
  const id=new URL(worker.url()).host;
  if(!/^[a-p]{32}$/.test(id)) throw Error('Not a real extension runtime ID');
  const page=await context.newPage();await page.goto(`chrome-extension://${id}/options.html`);
  await page.locator('#readiness strong').waitFor();
  const day=todayMalaysia(),weekday=(new Date(`${day}T00:00:00Z`).getUTCDay()+1)%7;
  await page.evaluate(async weekday=>{
    await chrome.storage.local.set({attendanceProfile:{student:'12345',name:'Isolated Test',studentType:'local'},attendanceSessions:[{id:'future',kind:'weekly',course:'COMP1311',weekday,time:'09:00',endTime:'10:00',exceptions:[],createdAt:new Date().toISOString()}],attendanceScheduleMode:'weekly'});
    const result=await chrome.runtime.sendMessage({type:'REBUILD_SCHEDULE'});if(result.error) throw Error(result.error);
  },weekday);
  const alarms=await worker.evaluate(()=>chrome.alarms.getAll());
  if(!alarms.some(a=>a.name==='attendance-next')) throw Error('Real MV3 next alarm missing');
  const drafts=[{id:'draft',kind:'weekly',course:'COMP1311-LEC',weekday:1,time:'11:00',endTime:'12:00',exceptions:[]}];
  await page.evaluate(rows=>chrome.storage.local.set({attendanceDraft:{version:1,rows,reviewedAt:null}}),drafts);
  await page.reload();await page.locator('.session-card').waitFor();
  if(await page.locator('.session-card').count()!==1) throw Error('Actual extension storage did not restore draft');
  const viewportChecks=[];
  for(const [name,width] of [['desktop',1360],['narrow',390]]) {
    await page.setViewportSize({width,height:900});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    if(overflow) throw Error(`${name} settings overflow`);
    await mkdir('outputs',{recursive:true});await page.screenshot({path:resolve(`outputs/settings-${name}.png`),fullPage:true});viewportChecks.push(name);
  }
  const unnamed=await page.locator('button,input:not([type=hidden]),select').evaluateAll(elements=>elements.filter(el=>!(el.getAttribute('aria-label')||el.getAttribute('aria-labelledby')||el.labels?.length||el.tagName==='BUTTON'&&el.textContent.trim())).map(el=>el.outerHTML));
  if(unnamed.length) throw Error(`Unnamed settings controls: ${unnamed.join('\n')}`);
  // CDP stops the actual worker; the next extension message creates a new worker.
  const cdp=await context.newCDPSession(page);await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  const restarted=await page.evaluate(()=>chrome.runtime.sendMessage({type:'REBUILD_SCHEDULE'}));
  if(restarted?.error) throw Error(restarted.error);
  const after=await page.evaluate(()=>chrome.alarms.getAll());if(!after.some(a=>a.name==='attendance-next')) throw Error('MV3 restart failed to reconstruct alarm');
  const evidence={platform:process.platform,browser:await context.browser()?.version(),extensionId:id,checks:['MV3 installed startup','real runtime messaging','local alarms with blocked cloud','persistent draft reload','worker stop/reconstruction','accessible settings controls',...viewportChecks],externalNetwork:'blocked Forms and production cloud hosts',schoolSubmissions:0};
  await writeFile('outputs/mv3-verification.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
} finally {
  await context?.close();const target=resolve(profile);if(!target.startsWith(resolve(tmpdir())+ '\\')&&!target.startsWith(resolve(tmpdir())+'/')) throw Error('Unexpected temporary profile path');
  await rm(target,{recursive:true,force:true});
}
