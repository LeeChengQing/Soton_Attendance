import {mkdir,copyFile,readFile,writeFile,cp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {build} from 'esbuild';
import {scanReleaseDirectory} from './scan-release.mjs';

export const root=resolve(import.meta.dirname,'..');
export const liveFiles=['manifest.json','background.js','content.js','options.js','options.html','options.css','activation-gate.css','options-dashboard.js','attendance-hotfix.js','popup.html','popup.css','popup.js'];
export function v105Plugin(entry) {
  const variants=entry==='background'?['forms','schedule','cloud','outbox','backup']:entry==='content'?['forms']:[];
  return {
    name:'preserve-v105-entry-variants',
    setup(api) {
      api.onResolve({filter:/^\.\.?\/.*\.js$/},args=>{
        const name=args.path.split('/').at(-1).slice(0,-3);
        if(variants.includes(name)&&[join(root,'src'),join(root,'src/v1.0.5')].includes(args.resolveDir)) return {path:join(root,`src/v1.0.5/${entry}-${name}.js`)};
      });
    }
  };
}
export async function buildCandidate({debug=false}={}) {
  const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  const out=join(root,`dist/attendance-v${pkg.version}${debug?'-developer-debug':''}`);
  await mkdir(out,{recursive:true});
  for(const name of ['manifest.json','options.html','options.css','activation-gate.css','options-dashboard.js','attendance-hotfix.js','logo.png','popup.html','popup.css','popup.js']) await copyFile(join(root,'src',name),join(out,name));
  await copyFile(join(root,'src/icon.png'),join(out,'icon.png'));
  for(const name of ['assets','licenses','vendor']) await cp(join(root,name),join(out,name),{recursive:true});
  await copyFile(join(root,'README.md'),join(out,'README.md'));
  for(const entry of ['options','background','content','popup']) {
    await build({entryPoints:[join(root,`src/${entry}.js`)],outfile:join(out,`${entry}.js`),bundle:true,minifySyntax:true,platform:'browser',format:entry==='content'?'iife':'esm',target:['chrome120'],logLevel:'warning',legalComments:'none',define:{__ATTENDANCE_DEV__:String(debug)},plugins:[v105Plugin(entry)]});
    if(entry==='options') {
      // Preserve the private __commonJS property keys emitted by the live pnpm build.
      // These are code, not comments: keep them rather than weakening parity checks.
      const versions={ 'regenerator-runtime':'0.13.11','tesseract.js':'7.0.0','jsqr':'1.4.0','qrcode':'1.5.4','dijkstrajs':'1.0.3' };
      const path=join(out,'options.js'),code=await readFile(path,'utf8');
      await writeFile(path,code.replace(/^(\s*)"node_modules\/([^/]+)\/([^"\n]+)"\(/gm,(match,indent,pkg,suffix)=>versions[pkg]?`${indent}"node_modules/.pnpm/${pkg}@${versions[pkg]}/node_modules/${pkg}/${suffix}"(`:match));
    }
  }
  const manifest=JSON.parse(await readFile(join(out,'manifest.json'),'utf8'));
  manifest.version=pkg.version;
  manifest.version_name=debug?`${pkg.version} Developer Debug — license bypass`:`${pkg.version.replace(/\.0$/,'')} Release`;
  if(debug) manifest.name+=' [Developer Debug]';
  manifest.optional_permissions=['power'];
  await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2));
  if(!debug) await scanReleaseDirectory(out);
  return out;
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)) {
  const out=await buildCandidate({debug:process.argv.includes('--debug')});
  console.log(`Built candidate: ${out}`);
  console.log('Run npm run candidate to verify and package; npm run release to verify, back up and replace root runtime files.');
}
