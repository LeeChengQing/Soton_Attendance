import test from 'node:test';
import assert from 'node:assert/strict';
import {createZip,zipEntries,validateCandidateFiles} from '../scripts/package-candidate.mjs';
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
