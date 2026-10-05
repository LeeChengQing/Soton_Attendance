import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import QRCode from 'qrcode';

test('pasted links and batch scans save all subjects without confirmation or active form tabs',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage();
    const bundle=await build({entryPoints:['src/options.js'],bundle:true,write:false,format:'iife'});
    const html=(await readFile('src/options.html','utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,'');
    await page.setContent(html);
    await page.evaluate(()=>{
      window.store={attendanceLanguage:'en',attendanceProfile:{student:'123',name:'Jane',studentType:'local'},attendanceDraft:{version:1,rows:['COMP1311-LEC','COMP1312-TUT'].map((course,i)=>({id:String(i),course,kind:'weekly',weekday:1,time:'09:00',endTime:'10:00',exceptions:[]}))}};
      window.tabCalls=[];window.formListeners=[];window.storageListeners=[];
      window.chrome={runtime:{id:'test',getURL:path=>path,onMessage:{addListener:fn=>formListeners.push(fn)},sendMessage:async()=>({ok:true})},storage:{onChanged:{addListener:fn=>storageListeners.push(fn)},local:{get:async keys=>structuredClone(Object.fromEntries(keys.filter(key=>key in store).map(key=>[key,store[key]]))),set:async values=>{Object.assign(store,structuredClone(values));for(const fn of storageListeners) fn(values,'local');}}},tabs:{create:async opts=>{tabCalls.push(opts);return {id:tabCalls.length};},remove:async()=>{},update:async(id,{url})=>{setTimeout(()=>{for(const fn of formListeners) fn({type:'FORM_READY',url,title:'Attendance',questions:[{title:'Student ID',type:'text',required:true,options:[]},{title:'Name',type:'text',required:true,options:[]}]},{tab:{id,url}});},10);}}};
    });
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.locator('.binding').first().waitFor();
    await page.locator('.binding input[type=url]').nth(0).fill('https://forms.office.com/r/one');
    await page.waitForFunction(()=>window.store.attendanceBindings?.COMP1311?.verified,{},{timeout:4000});
    assert.equal(await page.locator('.binding .save-binding,.binding input[type=checkbox]').count(),0);
    await page.locator('.binding input[type=url]').nth(1).fill('https://forms.office.com/r/two');
    await page.waitForFunction(()=>window.store.attendanceBindings?.COMP1312?.verified,{},{timeout:4000});
    await page.getByRole('button',{name:'Auto-Scan & Save All',exact:true}).click({force:true});
    await page.waitForFunction(()=>window.tabCalls.length>=4,{},{timeout:4000});
    await page.waitForFunction(()=>document.querySelectorAll('.binding .status.success').length===2);
    assert.equal(await page.evaluate(()=>window.tabCalls.every(tab=>tab.active===false)),true);
    assert.match(await page.locator('.binding .status').first().innerText(),/Bound successfully/);
    assert.equal(await page.locator('#check-setup,#confirm-all-setup').count(),0);
    const qr=await QRCode.toBuffer('https://forms.office.com/r/fromQr');
    await page.locator('.binding input[type=file]').nth(1).setInputFiles({name:'form.png',mimeType:'image/png',buffer:qr});
    await page.waitForFunction(()=>window.store.attendanceBindings.COMP1312.url==='https://forms.office.com/r/fromQr'&&window.store.attendanceBindings.COMP1312.verified);
    // Replacing a valid link immediately disables its old binding, even before the scan completes.
    await page.locator('.binding input[type=url]').first().fill('https://evil.example/form');
    await page.waitForFunction(()=>window.store.attendanceBindings.COMP1311.verified===false);
    assert.equal(await page.locator('.binding .status.success').count(),1);
    await page.getByRole('button',{name:'Auto-Scan & Save All',exact:true}).click({force:true});
    await page.waitForFunction(()=>!document.querySelector('#verify-all-bindings').disabled);
    assert.equal(await page.evaluate(()=>store.attendanceBindings.COMP1312.verified),true,'a bad subject link must not stop the other scans');
  } finally {await browser.close();}
});
