import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

import { build } from 'esbuild';

test('admin pricing editor saves integer prices, shows audit history and schedules ten Malaysia days',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage();let data=pricingFixture();const audit=[];const writes=[];
    await page.route('**/*',async route=>{
      if(route.request().url().includes('/api/admin/pricing')){
        if(route.request().method()==='POST'){
          const input=route.request().postDataJSON();writes.push(input);const row=data.products.find(p=>p.id===input.id);const old={...row};
          Object.assign(row,input.values,{effective_amount_minor:input.values.regular_amount_minor,version:row.version+1});
          audit.push({id:1,actor:'admin-session:local',changed_at:new Date().toISOString(),entity_id:row.id,old_value:old,new_value:{...row}});
          await route.fulfill({contentType:'application/json',body:'{"ok":true}'});
        }else await route.fulfill({contentType:'application/json',body:JSON.stringify({...data,audit})});
      }else await route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});
    });
    await page.goto('http://pricing.local');
    const result=await build({stdin:{contents:"import React from 'react';import {createRoot} from 'react-dom/client';import {PricingEditor} from './app/admin/pricing/PricingEditor';createRoot(document.getElementById('root')).render(<PricingEditor/>);",loader:'tsx',resolveDir:resolve('..','Auto-Check Website')},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
    await page.addScriptTag({content:result.outputFiles[0].text});
    const campaign=page.locator('form').first();
    await campaign.locator('[name=start]').fill('2030-01-01T10:00');
    assert.equal(await campaign.locator('[name=end]').inputValue(),'2030-01-11T10:00');
    const bundle=page.locator('form').filter({has:page.getByRole('heading',{name:'bundle · MYR'})});
    await bundle.locator('[name=regular]').fill('3600');await bundle.getByRole('button',{name:'保存',exact:true}).click();
    await page.waitForFunction(()=>document.body.textContent.includes('当前结账价：36.00'));
    assert.equal(writes[0].values.regular_amount_minor,3600);
    await page.locator('details').first().locator('summary').click();
    assert.match(await page.locator('details pre').innerText(),/3500/);
    assert.match(await page.locator('details pre').innerText(),/3600/);
  } finally {await browser.close();}
});

function pricingFixture(active=false) {
  const now=Date.now();
  return {server_now:new Date(now).toISOString(),checkout_allowed:true,providers:['stripe'],
    campaign:{id:'grand-opening',name:'Grand Opening Sale',enabled:active,state:active?'active':'disabled',starts_at:new Date(now-1000).toISOString(),ends_at:new Date(now+2500).toISOString(),version:1},
    products:[['bundle',3500,2690],['extension',2499,1990],['phone',1199,990],['yearly',1999,null]].map(([key,regular,promo])=>({id:key+':myr',product_key:key,currency:'myr',regular_amount_minor:regular,promotional_amount_minor:promo,effective_amount_minor:active&&promo?promo:regular,promotion_active:active&&!!promo,promotion_enabled:!!promo,enabled:true,version:1,campaign_ends_at:new Date(now+2500).toISOString()}))};
}

test('canonical extension panel refreshes administrator prices and disables purchases after API failure',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage();let data=pricingFixture(),failure=false;
    await page.route('**/*',async route=>{
      if(route.request().url().includes('/functions/v1/device-api'))await route.fulfill({status:failure?503:200,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'Content-Type,Authorization','access-control-allow-methods':'POST,OPTIONS'},contentType:'application/json',body:JSON.stringify(data)});
      else await route.fulfill({contentType:'text/html',body:'<main><strong id="subscription-price"></strong><a id="purchase-subscription">Buy phone</a></main>'});
    });
    await page.goto('http://pricing.local');
    await page.evaluate(()=>{globalThis.chrome={storage:{local:{get:async()=>({})}}};});
    const result=await build({stdin:{contents:"import {startPricingPanel} from './src/pricing.js';window.refreshPricing=startPricingPanel({openPurchase:()=>{}});",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
    await page.addScriptTag({content:result.outputFiles[0].text});
    await page.waitForFunction(()=>document.querySelector('#canonical-pricing')?.textContent.includes('35.00'));
    data.products[0].regular_amount_minor=3600;data.products[0].effective_amount_minor=3600;
    await page.evaluate(()=>window.refreshPricing());
    assert.match(await page.locator('#canonical-pricing').innerText(),/36\.00/);
    failure=true;await page.evaluate(()=>window.refreshPricing());
    assert.equal(await page.locator('#canonical-pricing button:enabled').count(),0);
    assert.equal(await page.locator('#purchase-subscription').getAttribute('aria-disabled'),'true');
  } finally {await browser.close();}
});

test('website pricing uses server campaign time, expires without deployment and refreshes administrator changes',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage();const ends=Date.now()+2500;let amount=3500,failure=false;
    await page.route('**/*',async route=>{
      if(route.request().url().includes('/api/pricing')){
        const data=pricingFixture(Date.now()<ends);data.campaign.ends_at=new Date(ends).toISOString();
        data.products[0].regular_amount_minor=amount;data.products[0].effective_amount_minor=Date.now()<ends?2690:amount;
        await route.fulfill({status:failure?503:200,contentType:'application/json',body:JSON.stringify(data)});
      } else await route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});
    });
    await page.goto('http://pricing.local');
    await page.evaluate(()=>{Date.now=()=>Date.parse('2050-01-01T00:00:00Z');});
    const contents=`
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {SiteConfigProvider,usePackagePrice,useSiteConfig} from './components/SiteConfigProvider';
      const config={packages:['bundle','extension','mobile_notification','mobile_notification_yearly'].map(id=>({id,amount:1,promotionalAmount:null,enabled:true,visible:true})),offer:{enabled:false,showCountdown:true,startsAt:'',endsAt:''},settings:{checkoutEnabled:true}};
      function Prices(){const amount=usePackagePrice('bundle'),{config,pricingReady}=useSiteConfig();return <><p id="amount">{pricingReady?amount:'unavailable'}</p><button disabled={!config.settings.checkoutEnabled}>Buy</button></>;}
      createRoot(document.getElementById('root')).render(<SiteConfigProvider config={config} initialNow={0}><Prices/></SiteConfigProvider>);
    `;
    const result=await build({stdin:{contents,loader:'tsx',resolveDir:resolve('..','Auto-Check Website')},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},tsconfigRaw:{compilerOptions:{baseUrl:resolve('..','Auto-Check Website'),paths:{'@/*':['./*']}}}});
    await page.addScriptTag({content:result.outputFiles[0].text});
    await page.waitForFunction(()=>document.querySelector('#amount')?.textContent==='2690');
    await page.waitForFunction(()=>document.querySelector('#amount')?.textContent==='3500',{timeout:8000});
    amount=3600;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForFunction(()=>document.querySelector('#amount')?.textContent==='3600');
    failure=true;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForFunction(()=>document.querySelector('#amount')?.textContent==='unavailable');
    assert.equal(await page.getByRole('button',{name:'Buy'}).isDisabled(),true);
  } finally {await browser.close();}
});

test('phone subscription defaults to one RM renewal card per semester without layout overflow',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1280,height:900},javaScriptEnabled:false});
    await page.goto(pathToFileURL(resolve('src/options.html')).href);
    await page.locator('#phone-subscription > summary').click();

    assert.equal(await page.locator('#phone-subscription .reminder-plan').count(),1);
    assert.equal(await page.locator('#phone-subscription .reminder-plan h3').innerText(),'手机提醒订阅');
    assert.match(await page.locator('#phone-subscription .plan-price').innerText(),/读取价格/);

    for(const width of [1280,390]) {
      await page.setViewportSize({width,height:900});
      const layout=await page.evaluate(()=>({
        pageWidth:document.documentElement.scrollWidth,
        viewportWidth:window.innerWidth,
        cardFits:document.querySelector('.reminder-plan').getBoundingClientRect().right<=window.innerWidth,
      }));
      assert.ok(layout.pageWidth<=layout.viewportWidth,`${width}px viewport should not scroll horizontally`);
      assert.ok(layout.cardFits,`${width}px viewport should contain the renewal card`);
    }
  } finally {
    await browser.close();
  }
});
