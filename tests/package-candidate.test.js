import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as packageCandidate from '../scripts/package-candidate.mjs';
const {createZip,zipEntries,validateCandidateFiles}=packageCandidate;
test('candidate ZIP is deterministic and preserves exact bytes in sorted portable entries',()=>{
  const files=[{name:'options.html',data:Buffer.from('中文')},{name:'manifest.json',data:Buffer.from('{}')}];
  const zip=createZip(files);
  assert.deepEqual(zip,createZip([...files].reverse()));
  const extracted=zipEntries(zip);assert.deepEqual(extracted.map(f=>f.name),['manifest.json','options.html']);assert.equal(extracted[1].data.toString(),'中文');
});
test('candidate rejects secrets, unexpected files and missing required assets',()=>{
  assert.throws(()=>validateCandidateFiles([{name:'.env',data:Buffer.from('secret')}],'2.5.0'));
  assert.throws(()=>validateCandidateFiles([{name:'manifest.json',data:Buffer.from('{"version":"2.4.0"}')}],'2.5.0'));
});

test('release command creates a release-marked manifest',()=>{
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.match(pkg.scripts.release,/scripts\/build\.mjs --release/);
});

test('release packaging rejects a candidate-marked manifest',()=>{
  assert.equal(typeof packageCandidate.validateManifestReleaseType,'function');
  assert.throws(()=>packageCandidate.validateManifestReleaseType({version:'1.0.0',version_name:'1.0.0 candidate'},'1.0.0',true),/display name/);
  assert.doesNotThrow(()=>packageCandidate.validateManifestReleaseType({version:'1.0.0',version_name:'V1.0.0 Release'},'1.0.0',true));
});
