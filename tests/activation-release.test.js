import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createZip} from '../scripts/package-candidate.mjs';
import {scanReleaseEntries,scanReleaseZip} from '../scripts/scan-release.mjs';

test('release scan rejects synthetic backdoors and checks final inflated ZIP contents',()=>{
  for(const marker of ['__ATTENDANCE_DEV__','developerMode','跳过插件授权校验','开发调试 · 免激活','[Developer Debug]','\\u8df3\\u8fc7插件授权校验']) {
    const files=[{name:'background.js',data:Buffer.from(marker)}];
    assert.throws(()=>scanReleaseEntries(files),/Development bypass/);
    assert.throws(()=>scanReleaseZip(createZip(files)),/Development bypass/);
  }
  assert.deepEqual(scanReleaseZip(createZip([{name:'background.js',data:Buffer.from('const licensed=true;')}])).findings,[]);
});
test('compile-time flag removes developer branches and strings from actual entry bundles',async()=>{
  for(const entry of ['src/background.js','src/options.js']) {
    const output=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'browser',minifySyntax:true,define:{__ATTENDANCE_DEV__:'false'},logLevel:'silent'});
    scanReleaseEntries(output.outputFiles.map(file=>({name:entry,data:file.contents})));
  }
});
