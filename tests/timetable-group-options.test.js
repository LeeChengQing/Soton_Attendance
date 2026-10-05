import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

test('student profile exposes Do not filter and Group 1/2/3 without layout overflow',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1280,height:900},javaScriptEnabled:false});
    await page.goto(pathToFileURL(resolve('src/options.html')).href);
    const group=page.locator('#profile-form select[name="group"]');
    assert.equal(await group.inputValue(),'all');
    assert.deepEqual(await group.locator('option').evaluateAll(options=>options.map(option=>option.value)),['all','1','2','3']);

    for(const width of [1280,390]) {
      await page.setViewportSize({width,height:900});
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
      assert.equal(overflow,false,`${width}px profile should not scroll horizontally`);
    }
  } finally {
    await browser.close();
  }
});
