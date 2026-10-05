import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

test('activation leads the subscription panel while recovery stays collapsed until requested',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const context=await browser.newContext({viewport:{width:1280,height:900},javaScriptEnabled:false});
    const page=await context.newPage();
    await page.goto(pathToFileURL(resolve('src/options.html')).href);
    await page.locator('#phone-subscription > summary').click();

    const state=await page.evaluate(()=>{
      const activation=document.querySelector('#activation-form');
      const recovery=document.querySelector('#phone-recovery');
      const summary=recovery?.querySelector(':scope > summary');
      return {
        activationBeforeRecovery:Boolean(activation&&recovery&&(activation.compareDocumentPosition(recovery)&Node.DOCUMENT_POSITION_FOLLOWING)),
        recoveryCollapsed:recovery?.tagName==='DETAILS'&&!recovery.open,
        recoveryHeight:recovery?Math.round(recovery.getBoundingClientRect().height):null,
        headingInSummary:summary?.contains(document.querySelector('#recovery-heading'))===true,
      };
    });
    assert.equal(state.activationBeforeRecovery,true);
    assert.equal(state.recoveryCollapsed,true);
    assert.equal(state.headingInSummary,true);
    assert.ok(state.recoveryHeight<=58,`collapsed recovery teaser should remain compact, got ${state.recoveryHeight}px`);
    assert.equal(await page.locator('#phone-recovery-form').isVisible(),false);

    await page.locator('#phone-recovery > summary').click();
    assert.equal(await page.locator('#phone-recovery-form').isVisible(),true);
    assert.equal(await page.locator('#recovery-key').isVisible(),true);

    const summary=page.locator('#phone-recovery > summary');
    await summary.focus();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#phone-recovery-form').isVisible(),false);
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#phone-recovery-form').isVisible(),true);
  } finally {
    await browser.close();
  }
});
