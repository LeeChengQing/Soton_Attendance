import {mkdir,rm,copyFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root=new URL('../',import.meta.url),out=new URL('../extension/',import.meta.url);
await rm(out,{recursive:true,force:true});
await mkdir(new URL('assets/tesseract-core/',out),{recursive:true});
await mkdir(new URL('assets/lang/',out),{recursive:true});
await mkdir(new URL('licenses/',out),{recursive:true});
const copy=async(src,dest)=>copyFile(new URL(src,root),new URL(dest,out));
for(const name of ['options.html','options.css']) await copy(`src/${name}`,name);
await copy('README.md','README.md');
await copy('src/icon.png','icon.png');
await copy('node_modules/pdfjs-dist/build/pdf.worker.min.mjs','assets/pdf.worker.min.mjs');
await copy('node_modules/tesseract.js/dist/worker.min.js','assets/worker.min.js');
for(const suffix of ['lstm','simd-lstm','relaxedsimd-lstm']) {
  await copy(`node_modules/tesseract.js-core/tesseract-core-${suffix}.wasm.js`,`assets/tesseract-core/tesseract-core-${suffix}.wasm.js`);
  await copy(`node_modules/tesseract.js-core/tesseract-core-${suffix}.wasm`,`assets/tesseract-core/tesseract-core-${suffix}.wasm`);
}
await copy('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz','assets/lang/eng.traineddata.gz');
for(const [source,name] of [
  ['node_modules/jsqr/LICENSE','jsqr-LICENSE'],
  ['node_modules/pdfjs-dist/LICENSE','pdfjs-LICENSE'],
  ['node_modules/tesseract.js/LICENSE.md','tesseract-js-LICENSE'],
  ['node_modules/tesseract.js-core/LICENSE','tesseract-core-LICENSE']
]) await copy(source,`licenses/${name}`);

for(const [entry,outfile,format] of [['options','options.js','esm'],['background','background.js','esm'],['content','content.js','iife']]) {
  await build({entryPoints:[fileURLToPath(new URL(`src/${entry}.js`,root))],outfile:fileURLToPath(new URL(outfile,out)),bundle:true,platform:'browser',format,target:['chrome120'],logLevel:'warning',legalComments:'none'});
}

await writeFile(new URL('manifest.json',out),JSON.stringify({
  manifest_version:3,name:'Attendance 自动打卡',version:'2.4.0',description:'本机识别课表与二维码，按每周课程结束前五分钟自动填写 Microsoft Forms，并同步手机提醒。',
  minimum_chrome_version:'120',permissions:['storage','alarms','notifications','tabs'],
  host_permissions:['https://forms.office.com/*','https://forms.cloud.microsoft/*','https://qckpwckfukyurkobrsig.supabase.co/*'],
  action:{default_title:'打开 Attendance 设置',default_icon:'icon.png'},options_page:'options.html',
  icons:{128:'icon.png'},background:{service_worker:'background.js',type:'module'},
  content_scripts:[{matches:['https://forms.office.com/*','https://forms.cloud.microsoft/*'],js:['content.js'],run_at:'document_idle'}],
  content_security_policy:{extension_pages:"script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"}
},null,2));
console.log('Built extension/');
