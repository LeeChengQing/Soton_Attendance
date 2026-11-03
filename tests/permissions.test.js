import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {assertPermissions} from '../scripts/assert-permissions.mjs';
import {releaseGates} from '../scripts/package-candidate.mjs';
const baseline=JSON.parse(await readFile(new URL('./fixtures/v1.0.5-manifest.json',import.meta.url)));
const manifest=JSON.parse(await readFile(new URL('../src/manifest.json',import.meta.url)));
test('V1.0.6 permissions retain the frozen V1.0.5 contract',()=>assert.doesNotThrow(()=>assertPermissions(manifest,baseline)));
test('permission additions, removals, order, hosts and content match drift are rejected',()=>{
  for(const mutate of [m=>m.permissions.push('history'),m=>m.permissions.pop(),m=>m.permissions.reverse(),m=>m.host_permissions.push('<all_urls>'),m=>m.content_scripts[0].matches.pop(),m=>m.content_scripts.push(m.content_scripts[0]),m=>m.optional_permissions=[],m=>m.optional_permissions.push('tabs')]) {
    const changed=structuredClone(manifest);mutate(changed);assert.throws(()=>assertPermissions(changed,baseline));
  }
});
test('permissions CLI fails with a nonzero exit for the old optional permission contract',()=>{
  const result=spawnSync(process.execPath,['scripts/assert-permissions.mjs','tests/fixtures/v1.0.5-manifest.json'],{encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/optional_permissions/);
});
test('release gate sequence includes every required command',()=>assert.deepEqual(releaseGates,[['test'],['run','smoke'],['run','test:mv3'],['run','assert:permissions']]));
