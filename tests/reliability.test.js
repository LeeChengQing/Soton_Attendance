import test from 'node:test';
import assert from 'node:assert/strict';
import {isSchoolLoginOrPermissionUrl,classifyWake,phaseTimeout,redactDiagnostic} from '../src/reliability.js';

test('detects Microsoft login and Forms permission URLs without reading page text',()=>{
  assert.equal(isSchoolLoginOrPermissionUrl('https://login.microsoftonline.com/common/oauth2/authorize'),true);
  assert.equal(isSchoolLoginOrPermissionUrl('https://forms.office.com/Pages/ResponsePage.aspx?error=access_denied'),true);
  assert.equal(isSchoolLoginOrPermissionUrl('https://forms.office.com/r/example'),false);
});

test('classifies a delayed wake beyond the grace window as device sleep',()=>{
  assert.equal(classifyWake(1000,121001,120000),'missed_sleep');
  assert.equal(classifyWake(1000,121000,120000),'launch');
});

test('defines independent bounded phase timeouts',()=>{
  assert.equal(phaseTimeout('opening'),10000);
  assert.equal(phaseTimeout('reading'),20000);
  assert.equal(phaseTimeout('confirming'),30000);
  assert.equal(phaseTimeout('not-a-phase'),null);
});

test('redacts URL-like and long numeric values from diagnostics',()=>{
  assert.equal(redactDiagnostic('阶段失败 https://example.invalid/x?id=1 student 123456789'),'阶段失败 [url] student [redacted]');
});
