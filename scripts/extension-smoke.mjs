import {scheduleWeekStart} from '../src/runtime-timing.js';
import {readFileSync} from 'node:fs';
const releaseVersion=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
import {chromium} from 'playwright';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {todayMalaysia} from '../src/schedule.js';
const profile=await mkdtemp(join(tmpdir(),'attendance-mv3-'));
let context;
try {
  context=await chromium.launchPersistentContext(profile,{channel:process.env.ATTENDANCE_TEST_BROWSER||'chrome',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging','--host-resolver-rules=MAP qckpwckfukyurkobrsig.supabase.co ~NOTFOUND, MAP forms.office.com ~NOTFOUND, MAP forms.cloud.microsoft ~NOTFOUND']});
  await context.route('https://qckpwckfukyurkobrsig.supabase.co/**',route=>route.abort());
  await context.route(/^https?:\/\//,route=>route.abort());
  await context.addInitScript(()=>{const original=globalThis.fetch;globalThis.fetch=(url,...args)=>String(url).endsWith('/functions/v1/device-api')?Promise.reject(Error('Isolated offline fixture')):original(url,...args);});
  const browserSession=await context.browser().newBrowserCDPSession();
  await browserSession.send('Extensions.loadUnpacked',{path:resolve(`dist/attendance-v${releaseVersion}`)});
  let worker=context.serviceWorkers()[0];if(!worker) worker=await context.waitForEvent('serviceworker',{timeout:15000});
  const id=new URL(worker.url()).host;
  if(!/^[a-p]{32}$/.test(id)) throw Error('Not a real extension runtime ID');
  const page=await context.newPage(),pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  page.on('console',message=>{if(['error','warning'].includes(message.type())) pageErrors.push(message.text());});
  await page.goto(`chrome-extension://${id}/options.html`);
  await page.locator('#activation-gate').waitFor({state:'visible'});
  if(!await page.locator('.app-layout').evaluate(el=>el.inert)) throw Error('Unlicensed application is interactive');
  await mkdir('outputs',{recursive:true});
  await page.waitForTimeout(300);
  for(const [width,height] of [[1280,720],[1920,1080],[800,600]]){await page.setViewportSize({width,height});await page.screenshot({path:resolve(`outputs/activation-gate-default-${width}.png`)});}
  const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);await popup.locator('#popup-activation').waitFor({state:'visible'});if(await popup.locator('.popup-card').isVisible())throw Error('Locked popup exposed application');await popup.close();
  await page.evaluate(()=>chrome.storage.local.set({attendancePluginLicense:{plan:'lifetime_license',activatedAt:Date.now(),expiresAt:null}}));
  await page.locator('#activation-gate').waitFor({state:'hidden'});
  await page.locator('#profile-form').waitFor();
  const day=todayMalaysia(),weekday=(new Date(`${day}T00:00:00Z`).getUTCDay()+1)%7;
  await page.evaluate(async ({weekday,weekStartDate})=>{
    await chrome.storage.local.set({attendanceProfile:{student:'12345',name:'Isolated Test',studentType:'local'},attendanceSessions:[{id:'future',kind:'weekly',course:'COMP1311',weekday,weekStartDate,time:'09:00',endTime:'10:00',exceptions:[],createdAt:new Date().toISOString()}],attendanceScheduleMode:'weekly'});
    const result=await chrome.runtime.sendMessage({type:'REBUILD_SCHEDULE'});if(result.error) throw Error(result.error);
  },{weekday,weekStartDate:scheduleWeekStart(Date.now())});
  const alarms=await worker.evaluate(()=>chrome.alarms.getAll());
  if(!alarms.some(a=>a.name==='attendance-next')) throw Error('Real MV3 next alarm missing');
  const drafts=[{id:'draft',kind:'weekly',course:'COMP1311-LEC',weekday:1,time:'11:00',endTime:'12:00',exceptions:[]}];
  await page.evaluate(rows=>chrome.storage.local.set({attendanceDraft:{version:1,rows,reviewedAt:null}}),drafts);
  await page.reload();await page.locator('.session-card').waitFor();
  if(await page.locator('.session-card').count()!==1) throw Error('Actual extension storage did not restore draft');
  if(await page.locator('#health,#preflight-readiness,.brand-check,.brand-initials').count()) throw Error('Redundant settings UI remains');
  if(await page.locator('.version').textContent()!=='V1.1') throw Error('Wrong settings version');
  const sidebarChecks=[];
  for(const [width,height] of [[1366,650],[1440,780],[1536,700],[1280,600],[911,480]]) {
    await page.setViewportSize({width,height});
    for(const language of ['zh','en']) {
      await page.locator('#language-'+language).click();
      const metrics=await page.evaluate(()=>{
        const sidebar=document.querySelector('.app-sidebar'),logo=document.querySelector('.brand-logo');
        const rect=sidebar.getBoundingClientRect(),items=[...sidebar.querySelectorAll('.primary-nav a,.sidebar-caption')];
        return {height:rect.height,scroll:sidebar.scrollHeight>sidebar.clientHeight,overflow:getComputedStyle(sidebar).overflow,logo:logo.complete&&logo.naturalWidth>0,items:items.length,visible:items.every(el=>{const r=el.getBoundingClientRect();return r.top>=rect.top&&r.bottom<=rect.bottom;}),gap:document.querySelector('#overview').getBoundingClientRect().top-document.querySelector('.hero').getBoundingClientRect().bottom};
      });
      if(metrics.height!==height||metrics.scroll||metrics.overflow!=='hidden'||!metrics.logo||metrics.items!==9||!metrics.visible||metrics.gap!==20) throw Error(`Sidebar/overview layout failed: ${width}x${height} ${language} ${JSON.stringify(metrics)}`);
      await page.locator('.app-sidebar').hover();await page.mouse.wheel(0,300);
      if(await page.locator('.app-sidebar').evaluate(el=>el.scrollTop)!==0) throw Error('Sidebar scrolls');
      sidebarChecks.push(`${width}x${height} ${language}`);
    }
  }
  await page.locator('#language-zh').click();
  const viewportChecks=[];
  for(const [name,width] of [['desktop',1360],['narrow',390]]) {
    await page.setViewportSize({width,height:900});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    if(overflow) throw Error(`${name} settings overflow`);
    await mkdir('outputs',{recursive:true});await page.screenshot({path:resolve(`outputs/settings-${name}.png`),fullPage:true});viewportChecks.push(name);
  }
  const unnamed=await page.locator('button:not([hidden]),input:not([type=hidden]):not([hidden]),select:not([hidden])').evaluateAll(elements=>elements.filter(el=>!(el.getAttribute('aria-label')||el.getAttribute('aria-labelledby')||el.labels?.length||el.tagName==='BUTTON'&&el.textContent.trim())).map(el=>el.outerHTML));
  if(unnamed.length) throw Error(`Unnamed settings controls: ${unnamed.join('\n')}`);
  // Real MV3 UI and messaging, with a deterministic API fixture; no provider or database E2E claim.
  const mockCloud = target => target.evaluate(() => {
    globalThis.fetch = async (url, options) => {
      if (!String(url).endsWith('/functions/v1/device-api')) throw Error('Unexpected test network');
      const body = JSON.parse(options.body), {cloudFixture: fixture} = await chrome.storage.local.get('cloudFixture');
      if (options.headers.Authorization !== 'Bearer isolated-token') throw Error('Wrong device binding');
      fixture.calls.push({action: body.action, currency: body.currency, plan: body.plan});
      let result = {ok: true};
      if (body.action === 'activate-plugin-license') {
        if (body.licenseKey !== '12345678-1234-4234-8234-123456789abc') throw Error('Truncated license');
        fixture.licensed = true; result = {ok: true, plan: 'lifetime_license', expires_at: null};
      } else if (body.action === 'plugin-license-status') result = {licensed: fixture.licensed, reason: !fixture.licensed&&fixture.revoked?'license_revoked':undefined, plan: 'lifetime_license', expires_at: null};
      else if (body.action === 'entitlement-status') result = {entitlement: fixture.entitlement};
      else if (body.action === 'create-checkout') result = {checkoutUrl: 'about:blank'};
      await chrome.storage.local.set({cloudFixture: fixture});
      return Response.json(result);
    };
  });
  await page.evaluate(() => chrome.storage.local.set({attendanceCloudDeviceId: 'isolated-device', attendanceCloudToken: 'isolated-token', attendanceNtfyTopic: 'isolated-topic', cloudFixture: {licensed: false, entitlement: null, calls: []}}));
  await mockCloud(worker);
  await page.evaluate(()=>chrome.storage.local.remove('attendancePluginLicense'));
  await page.locator('#activation-gate').waitFor({state:'visible'});
  await page.locator('#gate-key').fill('12345678-1234-4234-8234-123456789abc');
  await page.locator('#gate-submit').click();
  await page.locator('#activation-gate').waitFor({state:'hidden'});
  const phoneWithoutPurchase = await page.evaluate(() => chrome.runtime.sendMessage({type:'CLOUD_REQUEST',action:'entitlement'}));
  if (phoneWithoutPurchase.entitlement !== null) throw Error('Plugin license granted phone entitlement');
  for (const status of ['revoked', 'expired', 'pending', 'active']) {
    await page.evaluate(async status => {
      const {cloudFixture} = await chrome.storage.local.get('cloudFixture');
      cloudFixture.licensed = false;
      cloudFixture.entitlement = {status, phoneNotifications: true, startsAt: '2020-01-01T00:00:00Z', expiresAt: status === 'expired' ? '2021-01-01T00:00:00Z' : '2099-01-01T00:00:00Z', plan: 'sem_subscription'};
      await chrome.storage.local.set({cloudFixture});
      await chrome.runtime.sendMessage({type: 'CLOUD_REQUEST', action: 'plugin-license-status'});
    }, status);
    await page.locator('#phone-subscription').evaluate(el => {el.open = true;});
    await page.locator('#refresh-entitlement').click();
    await page.waitForFunction(active => document.querySelector('#phone-status-card').hidden !== active, status === 'active');
  }
  await page.evaluate(()=>chrome.runtime.sendMessage({type:'CLOUD_REQUEST',action:'checkout',plan:'sem_subscription',source:'stripe',currency:'cny'}));
  await page.waitForFunction(async () => (await chrome.storage.local.get('cloudFixture')).cloudFixture.calls.some(call => call.action === 'create-checkout' && call.currency === 'cny' && call.plan === 'sem_subscription'), null, {timeout: 5000});
  const formUrl='https://forms.office.com/r/license-policy';
  const formPage=await context.newPage();
  await formPage.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<div data-automation-id="formTitle">Local fixture</div><button data-automation-id="submitButton">Submit</button>'}));
  await formPage.goto(formUrl);
  const authorizeForm = target => target.evaluate(async url => {
    const [tab]=await chrome.tabs.query({url});
    const [{result}]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>chrome.runtime.sendMessage({type:'AUTHORIZE_AUTOMATION'})});
    return result;
  },formUrl);
  await page.evaluate(async()=>{const {cloudFixture}=await chrome.storage.local.get('cloudFixture');await chrome.storage.local.set({cloudFixture:{...cloudFixture,revoked:true}});});
  if ((await authorizeForm(worker)).error !== 'plugin_license_required') throw Error('Unlicensed Forms execution was authorized');
  if (await page.locator('#phone-status-card').getAttribute('hidden') !== null) throw Error('Plugin denial disabled paid phone entitlement');
  const nonSettings = await context.newPage();
  await nonSettings.goto(`chrome-extension://${id}/manifest.json`);
  const rejected = await nonSettings.evaluate(() => chrome.runtime.sendMessage({type: 'CLOUD_REQUEST', action: 'activate-plugin-license', licenseKey: 'invalid'}));
  await nonSettings.close();
  if (!rejected?.error) throw Error('Non-settings sender reached licensing');
  await page.locator('#gate-new-key').click();
  await page.locator('#gate-key').fill('12345678-1234-4234-8234-123456789abc');
  await page.locator('#gate-submit').click();
  await page.locator('#activation-gate').waitFor({state:'hidden'});
  // CDP stops the actual worker; the next extension message creates a new worker.
  const cdp=await context.newCDPSession(page);await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  const restarted=await page.evaluate(()=>chrome.runtime.sendMessage({type:'REBUILD_SCHEDULE'}));
  if(restarted?.error) throw Error(restarted.error);
  const after=await page.evaluate(()=>chrome.alarms.getAll());if(!after.some(a=>a.name==='attendance-next')) throw Error('MV3 restart failed to reconstruct alarm');
  worker = context.serviceWorkers().find(item => item.url().includes(id)) || await context.waitForEvent('serviceworker');
  await mockCloud(worker);
  const licenseAfterRestart = await page.evaluate(() => chrome.runtime.sendMessage({type: 'CLOUD_REQUEST', action: 'plugin-license-status'}));
  const persisted = await page.evaluate(() => chrome.storage.local.get(['attendanceCloudToken', 'attendanceCloudDeviceId', 'attendancePluginLicense']));
  if (!licenseAfterRestart.licensed || persisted.attendanceCloudToken !== 'isolated-token' || persisted.attendanceCloudDeviceId !== 'isolated-device' || persisted.attendancePluginLicense?.plan !== 'lifetime_license') throw Error('Worker restart lost activation binding');
  if ((await authorizeForm(worker)).ok !== true) throw Error('Licensed Forms execution failed after worker restart');
  if(pageErrors.length) throw Error(`Settings console errors/warnings: ${pageErrors.join('; ')}`);
  const evidence={platform:process.platform,browser:await context.browser()?.version(),extensionId:id,checks:['MV3 installed startup','real runtime messaging','local alarms with blocked cloud','persistent draft reload','worker stop/reconstruction','plugin activation and binding survive worker restart (mock API)','non-settings licensing rejected','phone entitlement visibility: pending/expired/revoked/active (mock API)','CNY device-bound checkout without plugin license (mock API)','accessible settings controls',...viewportChecks,...sidebarChecks],externalNetwork:'HTTP(S) pages and Forms/production cloud hosts blocked; licensing API mocked in worker',paymentProviderE2E:false,databaseE2E:false,schoolSubmissions:0};
  await writeFile('outputs/mv3-verification.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
} finally {
  await context?.close();const target=resolve(profile);if(!target.startsWith(resolve(tmpdir())+ '\\')&&!target.startsWith(resolve(tmpdir())+'/')) throw Error('Unexpected temporary profile path');
  await rm(target,{recursive:true,force:true});
}
