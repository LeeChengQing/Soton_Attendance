import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

test('activation and recovery fields accept a complete 62-character website key without case conversion', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.goto(pathToFileURL(resolve('src/options.html')).href);
    await page.locator('#phone-subscription > summary').click();
    await page.locator('#phone-recovery > summary').click();
    const key = 'AC-0123-4567-89AB-CDEF-0123-4567-89AB-CDEF-0123-4567-89AB-CDEF';
    for (const selector of ['#activation-key', '#recovery-key']) {
      const input = page.locator(selector);
      const maxLength = Number(await input.getAttribute('maxlength'));
      assert.ok(maxLength >= 64, `${selector} must allow at least 64 characters`);
      assert.equal(await input.getAttribute('autocapitalize'), 'off');
      await input.pressSequentially(key);
      assert.equal(await input.inputValue(), key);
      const internationalKey = 'AC-INTL-MOBM-aB12cD34';
      await input.fill('');
      await input.pressSequentially(internationalKey);
      assert.equal(await input.inputValue(), internationalKey);
    }
  } finally {
    await browser.close();
  }
});
