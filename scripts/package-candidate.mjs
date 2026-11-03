import {readFile,writeFile,readdir,mkdir,copyFile,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {deflateRawSync,inflateRawSync} from 'node:zlib';
import {resolve,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildCandidate,root} from './build.mjs';
import {verifyPermissions} from './assert-permissions.mjs';
import {scanReleaseEntries,scanReleaseZip} from './scan-release.mjs';
import {execFileSync,spawnSync} from 'node:child_process';
const sha=data=>createHash('sha256').update(data).digest('hex');
function crc(data) {let value=0xffffffff;for(const byte of data) {value^=byte;for(let n=0;n<8;n++) value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;}
export function createZip(input) {
  const parts=[],central=[];let offset=0;
  for(const f of [...input].sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
    if(f.name.includes('..')||f.name.startsWith('/')||f.name.includes('\\')) throw Error('Unsafe ZIP name');
    const name=Buffer.from(f.name),data=Buffer.from(f.data),compressed=deflateRawSync(data,{level:9}),checksum=crc(data);
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8);local.writeUInt16LE(33,12);local.writeUInt32LE(checksum,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
    parts.push(local,name,compressed);
    const header=Buffer.alloc(46);header.writeUInt32LE(0x02014b50);header.writeUInt16LE(20,4);header.writeUInt16LE(20,6);header.writeUInt16LE(0x800,8);header.writeUInt16LE(8,10);header.writeUInt16LE(33,14);header.writeUInt32LE(checksum,16);header.writeUInt32LE(compressed.length,20);header.writeUInt32LE(data.length,24);header.writeUInt16LE(name.length,28);header.writeUInt32LE(offset,42);
    central.push(header,name);offset+=local.length+name.length+compressed.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(input.length,8);end.writeUInt16LE(input.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...parts,directory,end]);
}
export function zipEntries(zip) {
  const result=[];let offset=0;
  while(zip.readUInt32LE(offset)===0x04034b50) {
    const size=zip.readUInt32LE(offset+18),length=zip.readUInt16LE(offset+26),extra=zip.readUInt16LE(offset+28),start=offset+30+length+extra;
    const name=zip.subarray(offset+30,offset+30+length).toString(),data=inflateRawSync(zip.subarray(start,start+size));
    if(crc(data)!==zip.readUInt32LE(offset+14)) throw Error('ZIP checksum mismatch');result.push({name,data});offset=start+size;
  }
  return result;
}
const standaloneCores=new Set(['lstm','simd-lstm','relaxedsimd-lstm'].map(s=>`assets/tesseract-core/tesseract-core-${s}.wasm`));
export const selectReleaseFiles=files=>files.filter(file=>!standaloneCores.has(file.name));
const required=['manifest.json','background.js','content.js','options.js','options.html','options.css','activation-gate.css','popup.html','popup.css','popup.js','vendor/gsap.min.js','icon.png','logo.png','README.md','attendance-hotfix.js','options-dashboard.js','build-info.json','assets/pdf.worker.min.mjs','assets/worker.min.js','assets/lang/eng.traineddata.gz',...['lstm','simd-lstm','relaxedsimd-lstm'].map(s=>`assets/tesseract-core/tesseract-core-${s}.wasm.js`),...['jsqr','pdfjs','tesseract-js','tesseract-core'].map(n=>`licenses/${n}-LICENSE`)];
export function validateCandidateFiles(files,version) {
  scanReleaseEntries(files);
  if(files.some(f=>!required.includes(f.name))) throw Error('Unexpected candidate file; credentials must never enter packages');
  if(required.some(name=>!files.some(f=>f.name===name))) throw Error('Missing required candidate assets');
  const manifest=JSON.parse(files.find(f=>f.name==='manifest.json').data);
  if(manifest.version!==version||manifest.manifest_version!==3) throw Error('Manifest/package version mismatch');
  for(const file of files.filter(f=>/\.(?:m?js|html|json|css|md)$/.test(f.name))) {
    const text=file.data.toString();
    if(/ATTENDANCE_SCHEDULER_SECRET|SUPABASE_SERVICE_ROLE_KEY|sb_secret_|sk_(?:live|test)_[A-Za-z0-9]{12,}|sk-proj-|sk-svcacct-|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) throw Error('Privileged credential reference in candidate');
    for(const token of text.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g)||[]) {
      let role;
      try {role=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()).role;} catch {continue;}
      if(role==='service_role') throw Error('Privileged credential in candidate');
    }
    if(/CHINA_SUPABASE_|BUSINESS_SUPABASE_|chinaUrl|businessUrl|\/functions\/v1\/activate-license/.test(text)) throw Error('Legacy backend reference in candidate');
    for(const endpoint of text.match(/https:\/\/[a-z0-9-]+\.supabase\.(?:co|cn|net)/g)||[]) {
      if(endpoint!=='https://qckpwckfukyurkobrsig.supabase.co') throw Error('Non-canonical Supabase endpoint in candidate');
    }
  }
}
export function validateManifestReleaseType(manifest,version,release) {
  const expected=`${version.replace(/\.0$/,'')} Release`;
  if(manifest.version_name!==expected) throw Error('Manifest display name does not match package type');
}
async function tree(root,prefix='') {
  const files=[];
  for(const entry of await readdir(join(root,prefix),{withFileTypes:true})) {
    const name=prefix?`${prefix}/${entry.name}`:entry.name;
    if(entry.isDirectory()) files.push(...await tree(root,name));else files.push({name,data:await readFile(join(root,name))});
  }
  return files.sort((a,b)=>a.name.localeCompare(b.name,'en'));
}
export const releaseGates=[['test'],['run','smoke'],['run','test:mv3'],['run','assert:permissions']];
function runNpm(args) {
  const result=process.env.npm_execpath
    ?spawnSync(process.execPath,[process.env.npm_execpath,...args],{cwd:root,stdio:'inherit'})
    :spawnSync(process.platform==='win32'?'npm.cmd':'npm',args,{cwd:root,stdio:'inherit',shell:process.platform==='win32'});
  if(result.error||result.status!==0) throw result.error||Error(`Release gate failed: npm ${args.join(' ')} (${result.status}); root unchanged.`);
}
export async function snapshot(dir,names) {
  return Promise.all(names.map(async name=>({name,data:await readFile(join(dir,name)).catch(error=>{if(error.code==='ENOENT')return null;throw error;})})));
}
async function main() {
  const replace=process.argv.includes('--replace'),out=await buildCandidate();
  const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  const before=await tree(out),liveNames=before.filter(file=>file.name!=='build-info.json').map(file=>file.name);
  const liveBefore=await snapshot(root,liveNames);
  const sourceBefore=sha(JSON.stringify((await tree(join(root,'src'))).map(file=>[file.name,sha(file.data)])));
  for(const args of releaseGates) runNpm(args);
  if(JSON.stringify(before)!==JSON.stringify(await tree(out))) throw Error('Candidate changed during release gates; root unchanged.');
  if(sourceBefore!==sha(JSON.stringify((await tree(join(root,'src'))).map(file=>[file.name,sha(file.data)])))) throw Error('Source changed during release gates; root unchanged.');
  await verifyPermissions(join(out,'manifest.json'));
  const info={version:pkg.version,commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),time:new Date().toISOString(),gates:releaseGates.map(args=>`npm ${args.join(' ')}`)};
  await writeFile(join(out,'build-info.json'),JSON.stringify(info,null,2)+'\n');
  const files=selectReleaseFiles(await tree(out));
  validateCandidateFiles(files,pkg.version);
  validateManifestReleaseType(JSON.parse(files.find(file=>file.name==='manifest.json').data),pkg.version,replace);
  const zip=createZip(files),verified=zipEntries(zip),scan=scanReleaseZip(zip);
  if(verified.length!==files.length||verified.some((file,index)=>file.name!==files[index].name||!file.data.equals(files[index].data))) throw Error('ZIP roundtrip mismatch');
  if(!zip.equals(createZip(files))) throw Error('ZIP is not deterministic');
  const dist=join(root,'dist'),filename=`attendance-v${pkg.version}.zip`;
  await writeFile(join(dist,filename),zip);
  await writeFile(join(dist,'activation-gate-release-scan.json'),JSON.stringify(scan,null,2)+'\n');
  await writeFile(join(dist,'build-info.json'),JSON.stringify(info,null,2)+'\n');
  await writeFile(join(dist,'SHA256SUMS.txt'),[`${sha(zip)}  ${filename}`,...files.map(file=>`${sha(file.data)}  attendance-v${pkg.version}/${file.name}`)].join('\n')+'\n');
  let backup;
  if(replace) {
    if(JSON.stringify(liveBefore)!==JSON.stringify(await snapshot(root,liveNames))) throw Error('Root changed during release gates; refusing replacement.');
    await mkdir(join(root,'backups'),{recursive:true});
    backup=await mkdtemp(join(root,`backups/v${pkg.version}-pre-replace-`));
    for(const {name,data} of liveBefore) if(data!==null) {await mkdir(join(backup,name,'..'),{recursive:true});await copyFile(join(root,name),join(backup,name));}
    if(JSON.stringify(liveBefore)!==JSON.stringify(await snapshot(backup,liveNames))) throw Error('Backup verification failed; root unchanged.');
    try {
      for(const name of liveNames) await copyFile(join(out,name),join(root,name));
      if(JSON.stringify(before.filter(file=>file.name!=='build-info.json'))!==JSON.stringify(await snapshot(root,liveNames))) throw Error('Replacement verification failed');
    } catch(error) {for(const {name,data} of liveBefore) {if(data===null)await rm(join(root,name),{force:true});else await copyFile(join(backup,name),join(root,name));}throw error;}
  }
  console.log(`Packaged: ${join(dist,filename)}\nSHA256: ${sha(zip)}\n${replace?`Root replaced; backup: ${backup}`:'Root unchanged.'}`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {await main();} catch(error) {console.error(error.message);process.exitCode=1;}
}
