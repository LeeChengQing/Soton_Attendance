import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

test('phone subscription defaults to one RM renewal card per semester without layout overflow',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1280,height:900},javaScriptEnabled:false});
    await page.goto(pathToFileURL(resolve('src/options.html')).href);
    await page.locator('#phone-subscription > summary').click();

    assert.equal(await page.locator('#phone-subscription .reminder-plan').count(),1);
    assert.equal(await page.locator('#phone-subscription .reminder-plan h3').innerText(),'手机提醒续订');
    assert.match(await page.locator('#phone-subscription .plan-price').innerText(),/RM 11\.99\s*\/\s*学期/);

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
