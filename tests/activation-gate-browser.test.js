import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {build} from 'esbuild';
import {readFile,mkdir} from 'node:fs/promises';
import {messages} from '../src/options-locale.js';

const files=['src/options.html','src/options.js','src/options-upgrade.js','src/activation-gate.js'];
test('all literal UI translation keys exist in both supported dictionaries',async()=>{
  const keys=new Set();
  for(const file of files){const text=await readFile(file,'utf8');for(const match of text.matchAll(/(?:data-i18n(?:-aria-label|-placeholder|-title)?=["']|\bt\(["'])([\w.]+)["']/g))keys.add(match[1]);}
  for(const language of ['zh','en']) for(const key of keys) assert.equal(typeof messages[language][key],'string',`${language}: ${key}`);
  assert.deepEqual(Object.keys(messages.zh).sort(),Object.keys(messages.en).sort());
});

const bundle=(await build({entryPoints:['src/activation-gate.js'],bundle:true,write:false,format:'iife',globalName:'GateUI',define:{__ATTENDANCE_DEV__:'false'},logLevel:'silent'})).outputFiles[0].text;
async function fixture(browser,{state='LOCKED_NEW',allowed=false,language='zh',result='invalid',retry=1,viewport={width:1280,height:720},links={}}={}) {
  const page=await browser.newPage({viewport});
  page.gateEvidence={logs:[],requests:[]};page.on('console',message=>page.gateEvidence.logs.push(message.text()));page.on('request',request=>{if(request.postData())page.gateEvidence.requests.push({url:request.url(),body:request.postData()});});
  await page.route('https://gate.invalid/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html></html>'}));
  await page.goto('https://gate.invalid/');
  const html=(await readFile('src/options.html','utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link\b[^>]*>/g,'');
  await page.setContent(html);
  await page.addStyleTag({content:await readFile('src/options.css','utf8')});
  await page.addStyleTag({content:await readFile('src/activation-gate.css','utf8')});
  await page.evaluate(({state,allowed,language,result,retry,links})=>{
    window.gateState={state,allowed,expiresAt:'2026-01-01T00:00:00Z',deviceId:'device-12345678-9012',links};
    window.calls=[];window.storage={attendanceLanguage:language};window.logs=[];window.outcome=result;window.listeners=[];
    window.chrome={storage:{local:{get:async()=>({...window.storage}),set:async value=>Object.assign(window.storage,value)},onChanged:{addListener:fn=>window.listeners.push(fn)}},runtime:{sendMessage:async message=>{
      if(message.action==='activate-plugin-license')window.calls.push({type:message.type,action:message.action});else window.calls.push(message);
      if(message.type==='GET_LICENSE_GATE')return {...window.gateState};
      if(message.action==='activate-plugin-license') {
        if(window.outcome==='pending') await new Promise(resolve=>window.finishActivation=resolve);
        if(window.outcome==='invalid')return {error:'license_revoked',httpStatus:410};
        if(window.outcome==='rate')return {error:'rate_limited',httpStatus:429,retryAfterSeconds:retry};
        if(window.outcome==='network')return {error:'cloud_request_failed'};
        if(window.outcome==='server')return {error:'cloud_request_failed',httpStatus:503};
        window.gateState={...window.gateState,state:'UNLOCKED',allowed:true};return {ok:true};
      }
      return {ok:true};
    }}};
  },{state,allowed,language,result,retry,links});
  await page.addScriptTag({content:bundle});await page.evaluate(()=>GateUI.initActivationGate());
  return page;
}
test('dialog traps focus, rejects format locally, normalizes paste, unifies errors and clears submitted key',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await fixture(browser);const input=page.locator('#gate-key');
    await input.focus();assert.equal(await page.locator('.app-layout').evaluate(el=>el.inert),true);
    await page.keyboard.press('Escape');assert.equal(await page.locator('#activation-gate').isVisible(),true);
    await input.fill('bad');await page.keyboard.press('Enter');assert.equal(await page.locator('#gate-error').innerText(),'请检查密钥格式');
    assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.action==='activate-plugin-license').length),0);
    await input.fill('ac–lic–abcd efgh\njklm—npqr stuv wxyz 2345 abcd');
    assert.equal(await input.inputValue(),'ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345-ABCD');
    await page.keyboard.press('Enter');await page.waitForFunction(()=>!document.getElementById('gate-error').hidden);
    assert.match(await page.locator('#gate-error').innerText(),/0\/O、1\/I/);assert.equal(await input.inputValue(),'');
    assert.equal(await input.getAttribute('aria-invalid'),'true');assert.equal(await page.locator('#gate-error').getAttribute('role'),'alert');
    const tabbable=page.locator('#gate-card a[href],#gate-card button:not(:disabled),#gate-card input:not(:disabled)');
    const visible=[];for(const element of await tabbable.all())if(await element.isVisible())visible.push(element);
    await visible.at(-1).focus();await page.keyboard.press('Tab');assert.equal(await visible[0].evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('Shift+Tab');assert.equal(await visible.at(-1).evaluate(el=>el===document.activeElement),true);
  }finally {await browser.close();}
});
test('verification disables controls; success waits one second and unlocks; synthetic key never leaks',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await fixture(browser,{result:'pending'});const marker='AC-LIC-ZZZZ-YYYY-XXXX-WWWW';
    await page.locator('#gate-key').fill(marker);await page.locator('#gate-submit').click();
    assert.equal(await page.locator('#gate-key').isDisabled(),true);assert.equal(await page.locator('#gate-submit').isDisabled(),true);
    await page.evaluate(()=>{window.outcome='success';window.finishActivation();});
    await page.locator('#gate-success').waitFor();assert.equal(await page.locator('#gate-key').inputValue(),'');
    await page.waitForTimeout(300);assert.equal(await page.locator('#activation-gate').isVisible(),true);
    await page.locator('#activation-gate').waitFor({state:'hidden'});
    assert.equal(await page.locator('.app-layout').evaluate(el=>el.inert),false);
    assert.equal((await page.evaluate(()=>JSON.stringify({storage:window.storage,calls:window.calls,logs:window.logs,dom:document.documentElement.outerHTML}))).includes(marker),false);assert.equal(JSON.stringify(page.gateEvidence).includes(marker),false);
  }finally {await browser.close();}
});
test('expired variants, English, reduced transparency and three viewport sizes',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    for(const viewport of [{width:1280,height:720},{width:1920,height:1080},{width:800,height:600}]) {
      const page=await fixture(browser,{state:'LOCKED_EXPIRED',language:'en',viewport});
      assert.equal(await page.locator('#gate-title').innerText(),'License no longer active');assert.match(await page.locator('#gate-reassure').innerText(),/will not be deleted/);
      assert.equal(await page.locator('#gate-form').isVisible(),false);await page.locator('#gate-new-key').click();assert.equal(await page.locator('#gate-key').isVisible(),true);
      await page.locator('#gate-reduce').check();assert.equal(await page.locator('#gate-card').evaluate(el=>getComputedStyle(el).backdropFilter),'none');
      assert.equal(await page.evaluate(()=>window.storage.attendanceReduceTransparency),true);
      assert.equal(await page.locator('#activation-gate').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
      assert.doesNotMatch(await page.locator('body').innerText(),/licenseHeading|licenseDescription|gate\.(?:title|subtitle|err\.)/);
      await mkdir('outputs',{recursive:true});await page.screenshot({path:`outputs/activation-gate-${viewport.width}.png`});await page.close();
    }
  }finally {await browser.close();}
});
test('rate limit counts down without live-region spam and network errors retain visible input',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    for(const [result,expected] of [['rate','尝试次数过多'],['network','无法连接授权服务'],['server','授权服务暂时不可用']]) {
      const page=await fixture(browser,{result});await page.locator('#gate-key').fill('ABCD-EFGH-IJKL-MNOP');await page.locator('#gate-submit').click();
      await page.waitForFunction(()=>!document.getElementById('gate-error').hidden);assert.match(await page.locator('#gate-error').innerText(),new RegExp(expected));
      if(result==='rate'){assert.equal(await page.locator('#gate-submit').isDisabled(),true);await page.waitForTimeout(1200);assert.equal(await page.locator('#gate-submit').isDisabled(),false);}
      else assert.equal(await page.locator('#gate-key').inputValue(),'ABCD-EFGH-IJKL-MNOP');
      await page.close();
    }
  }finally {await browser.close();}
});

test('an already activated open page locks again on revocation and maintenance focuses visible content',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await fixture(browser,{result:'success'});await page.locator('#gate-key').fill('ABCD-EFGH-IJKL-MNOP');await page.locator('#gate-submit').click();await page.locator('#activation-gate').waitFor({state:'hidden'});
    await page.evaluate(()=>{window.gateState={...window.gateState,state:'LOCKED_REVOKED',allowed:false};window.listeners.forEach(fn=>fn({attendancePluginLicense:{newValue:{plan:'expired'}}},'local'));});
    await page.locator('#activation-gate').waitFor({state:'visible'});assert.equal(await page.locator('#activation-gate').evaluate(el=>getComputedStyle(el).opacity),'1');
    await page.close();const maintenance=await fixture(browser,{state:'LOCKED_MAINT'});
    await maintenance.waitForTimeout(100);assert.equal(await maintenance.locator('#gate-card').evaluate(el=>el.contains(document.activeElement)),true);
  }finally {await browser.close();}
});

test('forced colors and reduced motion use opaque accessible fallback; cached paid users survive messaging failure',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await fixture(browser);
    await page.emulateMedia({forcedColors:'active',reducedMotion:'reduce'});
    await page.waitForFunction(()=>matchMedia('(forced-colors: active)').matches&&getComputedStyle(document.getElementById('gate-card')).backdropFilter==='none');
    const styles=await page.locator('#gate-card').evaluate(el=>({filter:getComputedStyle(el).backdropFilter,border:getComputedStyle(el).borderTopWidth,animation:getComputedStyle(el).animationName}));
    assert.equal(styles.filter,'none');assert.equal(styles.border,'2px');assert.equal(styles.animation,'none');await page.close();
    const paid=await fixture(browser,{allowed:true,state:'UNLOCKED'});
    await paid.waitForTimeout(50);
    await paid.evaluate(()=>{window.storage.attendancePluginLicense={plan:'lifetime_license',activatedAt:1};window.chrome.runtime.sendMessage=async()=>{throw Error('worker temporarily unavailable');};window.dispatchEvent(new Event('focus'));});
    await paid.locator('#gate-grace').waitFor({state:'visible'});assert.equal(await paid.locator('#activation-gate').isVisible(),false);assert.equal(await paid.locator('.app-layout').evaluate(el=>el.inert),false);
  }finally {await browser.close();}
});
