import test from 'node:test';
import assert from 'node:assert/strict';
import {isSettingsSender} from '../src/settings-sender.js';
const runtime={id:'abcdefghijklmnopabcdefghijklmnop',getURL:path=>`chrome-extension://abcdefghijklmnopabcdefghijklmnop/${path}`};
test('settings in a real browser tab can use settings operations',()=>{
  const url=runtime.getURL('options.html');
  assert.equal(isSettingsSender({id:runtime.id,url,tab:{id:7,url}},runtime),true);
  assert.equal(isSettingsSender({id:runtime.id,url},runtime),true);
});
test('school content scripts and other extensions cannot use settings operations',()=>{
  for(const sender of [{},{id:'other',url:runtime.getURL('options.html')},{id:runtime.id,url:'https://forms.office.com',tab:{url:runtime.getURL('options.html')}},{url:runtime.getURL('options.html')+'.evil'},{url:'https://example.org/options.html'}]) assert.equal(isSettingsSender(sender,runtime),false);
});
