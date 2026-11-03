import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {root} from './build.mjs';
export function assertPermissions(manifest,baseline) {
  assert.equal(baseline.version,'1.0.5','Permission baseline must be V1.0.5');
  for(const key of ['permissions','host_permissions']) assert.deepEqual(manifest[key],baseline[key],`${key} changed from V1.0.5`);
  assert.deepEqual(manifest.content_scripts?.map(script=>script.matches),baseline.content_scripts?.map(script=>script.matches),'content_scripts.matches changed from V1.0.5');
  assert.deepEqual(manifest.optional_permissions,['power'],'optional_permissions must equal [power]');
}
export async function verifyPermissions(path=resolve(root,'dist/attendance-v1.0.6/manifest.json')) {
  const [manifest,baseline]=await Promise.all([readFile(path,'utf8'),readFile(resolve(root,'tests/fixtures/v1.0.5-manifest.json'),'utf8')]);
  assertPermissions(JSON.parse(manifest),JSON.parse(baseline));
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)) {
  try {await verifyPermissions(process.argv[2]&&resolve(process.argv[2]));console.log('Permissions PASS: V1.0.5 required permissions; optional power only.');}
  catch(error) {console.error(error.message);process.exitCode=1;}
}
