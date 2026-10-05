import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {build} from 'esbuild';

test('Forms crosses September to October by going to today before selecting the day',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage();
    const bundle=await build({stdin:{contents:"import {fillDate} from './src/form-date.js';window.fillDate=fillDate;",resolveDir:process.cwd()},bundle:true,write:false});
    for(const [initial,goToday] of [['2026/9/30','转到今日'],['2026/10/1','Go to today']]) {
      await page.setContent(`<input id="date" role="combobox" aria-expanded="true" aria-controls="calendar" value="${initial}"><div id="calendar"><button>${goToday}</button><table><tr><td role="gridcell" aria-current="date"><button>1</button></td></tr></table></div>`);
      await page.evaluate(()=>{
        window.order=[];window.currentMonth=false;
        document.querySelector('#calendar > button').onclick=()=>{window.order.push('goToday');window.currentMonth=true;};
        document.querySelector('td button').onclick=()=>{window.order.push('selectToday');document.querySelector('#date').value=window.currentMonth?'2026/10/1':'2026/9/30';};
      });
      await page.addScriptTag({content:bundle.outputFiles[0].text});
      let error;try {await page.evaluate(()=>window.fillDate(document.querySelector('#date'),'2026-10-01'));} catch(e) {error=e;}
      assert.deepEqual(await page.evaluate(()=>window.order),['goToday','selectToday']);
      assert.equal(error,undefined);
      assert.equal(await page.locator('#date').inputValue(),'2026/10/1');
    }
  } finally {await browser.close();}
});

test('Forms already on the current month can select today when Go to today is disabled',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage();
    const bundle=await build({stdin:{contents:"import {fillDate} from './src/form-date.js';window.fillDate=fillDate;",resolveDir:process.cwd()},bundle:true,write:false});
    await page.setContent('<input id="date" role="combobox" aria-expanded="true" aria-controls="calendar" value="2026/10/1"><div id="calendar"><button class="js-goToday" disabled>Go to today</button><button class="ms-CalendarDay-dayIsToday" onclick="window.selected=true;document.querySelector(\'#date\').value=\'2026/10/1\'">1</button></div>');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(()=>window.fillDate(document.querySelector('#date'),'2026-10-01'));
    assert.equal(await page.evaluate(()=>window.selected),true);
    assert.equal(await page.locator('#date').inputValue(),'2026/10/1');
  } finally {await browser.close();}
});
