import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {join} from 'node:path';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {scanReleaseZip} from '../scripts/scan-release.mjs';
import * as packageCandidate from '../scripts/package-candidate.mjs';
const {createZip,zipEntries,validateCandidateFiles}=packageCandidate;

test('packaging snapshots permit a new candidate asset absent from the live runtime',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'attendance-snapshot-'));
  try {
    await writeFile(join(directory,'options.css'),'existing');
    const files=await packageCandidate.snapshot(directory,['options.css','activation-gate.css']);
    assert.equal(files[0].data.toString(),'existing');assert.equal(files[1].data,null);
  }finally {assert.ok(directory.startsWith(join(tmpdir(),'attendance-snapshot-')));await rm(directory,{recursive:true,force:true});}
});
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

test('complete candidate rejects obsolete endpoints and encoded privileged keys in shipped text',()=>{
  const names=['manifest.json','background.js','content.js','options.js','options.html','options.css','activation-gate.css','popup.html','popup.css','popup.js','vendor/gsap.min.js','icon.png','logo.png','README.md','attendance-hotfix.js','options-dashboard.js','build-info.json','assets/pdf.worker.min.mjs','assets/worker.min.js','assets/lang/eng.traineddata.gz',...['lstm','simd-lstm','relaxedsimd-lstm'].map(s=>`assets/tesseract-core/tesseract-core-${s}.wasm.js`),...['jsqr','pdfjs','tesseract-js','tesseract-core'].map(n=>`licenses/${n}-LICENSE`)];
  const files=names.map(name=>({name,data:Buffer.from(name==='manifest.json'?JSON.stringify({version:'1.1.0',manifest_version:3}):'')}));
  assert.doesNotThrow(()=>validateCandidateFiles(files,'1.1.0'));
  for(const name of names.filter(name=>name.startsWith('assets/'))) assert.throws(()=>validateCandidateFiles(files.filter(file=>file.name!==name),'1.1.0'),/Missing/);
  const target=files.find(f=>f.name==='README.md');
  for(const unsafe of ['https://legacy-china.supabase.co/functions/v1/device-api','CHINA_SUPABASE_URL','/functions/v1/activate-license','sb_secret_fixture','sk_test_fixture123456789',`eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')}.signature`]) {
    target.data=Buffer.from(unsafe);
    assert.throws(()=>validateCandidateFiles(files,'1.1.0'),/credential|backend|endpoint/);
  }
  target.data=Buffer.from('https://qckpwckfukyurkobrsig.supabase.co/functions/v1/device-api');
  assert.doesNotThrow(()=>validateCandidateFiles(files,'1.1.0'));
});

test('release selection excludes exactly three standalone cores, preserving every other payload',()=>{
  const removed=['lstm','simd-lstm','relaxedsimd-lstm'].map(s=>`assets/tesseract-core/tesseract-core-${s}.wasm`);
  const retained=[...removed.map(name=>`${name}.js`),'assets/lang/eng.traineddata.gz','assets/worker.min.js','assets/pdf.worker.min.mjs','licenses/tesseract-core-LICENSE','other.wasm','assets/tesseract-core/future.wasm'];
  const files=[...removed,...retained].map(name=>({name,data:Buffer.from(name)}));
  assert.equal(typeof packageCandidate.selectReleaseFiles,'function');
  const selected=packageCandidate.selectReleaseFiles(files);
  assert.deepEqual(selected.map(file=>file.name),retained);
  for(const file of selected) assert.equal(file,files.find(original=>original.name===file.name));
  assert.equal(files.length,removed.length+retained.length);
});

test('ZIP-only exclusion does not break the existing live replacement verification',async()=>{
  const names=['manifest.json','build-info.json',...['lstm','simd-lstm','relaxedsimd-lstm'].flatMap(s=>[`assets/tesseract-core/tesseract-core-${s}.wasm`,`assets/tesseract-core/tesseract-core-${s}.wasm.js`])].sort((a,b)=>a.localeCompare(b,'en'));
  const original=names.map(name=>({name,data:Buffer.from(name==='manifest.json'?JSON.stringify({version:'1.1.0',version_name:'1.1 Release'}):name)}));
  const memory=new Map();for(const dir of ['out','root']) for(const file of original) memory.set(join(dir,file.name),file.data);
  const tree=async dir=>original.map(file=>({name:file.name,data:memory.get(join(dir,file.name))}));
  const snapshot=async(dir,list)=>Promise.all(list.map(async name=>({name,data:memory.get(join(dir,name))})));
  const source=readFileSync(new URL('../scripts/package-candidate.mjs',import.meta.url),'utf8');
  const main=source.slice(source.indexOf('async function main()'),source.indexOf('\nif(process.argv[1]'));
  await runInNewContext(`${main}; main()`,{
    process:{argv:['node','packager','--replace']},root:'root',join,Buffer,JSON,Error,
    buildCandidate:async()=> 'out',tree:async dir=>dir===join('root','src')?[]:tree(dir),snapshot,
    readFile:async()=>JSON.stringify({version:'1.1.0'}),writeFile:async(path,data)=>memory.set(path,Buffer.from(data)),
    mkdir:async()=>{},mkdtemp:async()=> 'backup',copyFile:async(from,to)=>memory.set(to,memory.get(from)),
    sha:()=> 'fixture-hash',releaseGates:[],runNpm(){},verifyPermissions:async()=>{},execFileSync:()=> 'fixture-commit',
    selectReleaseFiles:packageCandidate.selectReleaseFiles,validateCandidateFiles(){},validateManifestReleaseType(){},createZip,zipEntries,scanReleaseZip,console:{log(){}}
  });
  const packed=zipEntries(memory.get(join('root','dist','attendance-v1.1.0.zip')));
  assert.equal(packed.filter(file=>file.name.endsWith('.wasm')).length,0);
  for(const file of original.filter(file=>file.name!=='build-info.json')) assert.deepEqual(memory.get(join('root',file.name)),file.data);
});

for(const variant of ['relaxedsimd-lstm','simd-lstm','lstm']) {
  test(`${variant}: embedded WASM equals the standalone vendor binary`,()=>{
    const base=new URL(`../assets/tesseract-core/tesseract-core-${variant}.wasm`,import.meta.url);
    const script=readFileSync(new URL(`${base}.js`),'utf8');
    const start=script.indexOf('AGFzbQ');assert.ok(start>0);
    const embedded=Buffer.from(script.slice(start,script.indexOf('"',start)),'base64');
    assert.deepEqual(embedded,readFileSync(base));
  });
  test(`${variant}: simulated capability selection requests the retained JS core`,async()=>{
    const module={exports:{}},loaded=[];
    const scope={importScripts:path=>{loaded.push(path);scope.TesseractCore=()=>{};}};
    runInNewContext(readFileSync(new URL('../node_modules/tesseract.js/src/worker-script/browser/getCore.js',import.meta.url),'utf8'),{
      module,global:scope,require:name=>name==='wasm-feature-detect'?{simd:async()=>variant!=='lstm',relaxedSimd:async()=>variant==='relaxedsimd-lstm'}:{dependencies:{'tesseract.js-core':'^7.0.0'}}
    });
    await module.exports(true,'chrome-extension://fixture/assets/tesseract-core',{progress(){}});
    assert.deepEqual(loaded,[`chrome-extension://fixture/assets/tesseract-core/tesseract-core-${variant}.wasm.js`]);
  });
}

test('V1.0.6 release command requires the test, smoke, MV3 and permission gates',()=>{
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(pkg.scripts.release,'node scripts/package-candidate.mjs --replace');
  assert.equal(pkg.scripts.candidate,'node scripts/package-candidate.mjs');
});

test('release packaging rejects a candidate-marked manifest',()=>{
  assert.equal(typeof packageCandidate.validateManifestReleaseType,'function');
  assert.throws(()=>packageCandidate.validateManifestReleaseType({version:'1.0.0',version_name:'1.0.0 candidate'},'1.0.0',true),/display name/);
  assert.doesNotThrow(()=>packageCandidate.validateManifestReleaseType({version:'1.0.0',version_name:'1.0 Release'},'1.0.0',true));
});
