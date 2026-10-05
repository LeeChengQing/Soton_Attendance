import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {deflateRawSync,inflateRawSync} from 'node:zlib';
import {resolve,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
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
const required=['manifest.json','background.js','content.js','options.js','options.html','options.css','icon.png','README.md','assets/pdf.worker.min.mjs','assets/worker.min.js','assets/lang/eng.traineddata.gz',...['lstm','simd-lstm','relaxedsimd-lstm'].flatMap(s=>[`assets/tesseract-core/tesseract-core-${s}.wasm`,`assets/tesseract-core/tesseract-core-${s}.wasm.js`]),...['jsqr','pdfjs','tesseract-js','tesseract-core'].map(n=>`licenses/${n}-LICENSE`)];
export function validateCandidateFiles(files,version) {
  if(files.some(f=>!required.includes(f.name))) throw Error('Unexpected candidate file; credentials must never enter packages');
  if(required.some(name=>!files.some(f=>f.name===name))) throw Error('Missing required candidate assets');
  const manifest=JSON.parse(files.find(f=>f.name==='manifest.json').data);
  if(manifest.version!==version||manifest.manifest_version!==3) throw Error('Manifest/package version mismatch');
  for(const file of files.filter(f=>/\.(?:js|html|json)$/.test(f.name))) {
    if(/ATTENDANCE_SCHEDULER_SECRET|SUPABASE_SERVICE_ROLE_KEY|sb_secret_|-----BEGIN PRIVATE KEY-----/.test(file.data.toString())) throw Error('Privileged credential reference in candidate');
  }
}
export function validateManifestReleaseType(manifest,version,release) {
  const expected=release?'V1.0.0 Release':`${version} candidate`;
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
async function main() {
  const release=process.argv.includes('--release');
  const root=resolve(fileURLToPath(new URL('../',import.meta.url))),out=join(root,'extension'),pkg=JSON.parse(await readFile(join(root,'package.json'))),files=await tree(out);
  validateCandidateFiles(files,pkg.version);
  validateManifestReleaseType(JSON.parse(files.find(f=>f.name==='manifest.json').data),pkg.version,release);
  // Compare every generated executable against current source using the real bundler.
  for(const [entry,format] of [['options','esm'],['background','esm'],['content','iife']]) {
    const result=await build({entryPoints:[join(root,'src',`${entry}.js`)],outfile:join(out,`${entry}.js`),write:false,bundle:true,platform:'browser',format,target:['chrome120'],logLevel:'warning',legalComments:'none'});
    if(!Buffer.from(result.outputFiles[0].contents).equals(files.find(f=>f.name===`${entry}.js`).data)) throw Error(`${entry} bundle/source mismatch; rebuild first`);
  }
  for(const name of ['options.html','options.css','icon.png']) if(!(await readFile(join(root,'src',name))).equals(files.find(f=>f.name===name).data)) throw Error(`${name} source mismatch`);
  if(!(await readFile(join(root,'README.md'))).equals(files.find(f=>f.name==='README.md').data)) throw Error('README source mismatch');
  const tracked=execFileSync('git',['ls-files','-z','--','src','supabase','scripts','tests'],{cwd:root}).toString('utf8').split('\0').filter(Boolean).sort((a,b)=>a.localeCompare(b,'en'));
  const sources=[];for(const path of tracked) sources.push({path,sha256:sha(await readFile(join(root,path)))});
  const zip=createZip(files),verified=zipEntries(zip);if(verified.length!==files.length||verified.some((f,i)=>!f.data.equals(files[i].data))) throw Error('ZIP roundtrip mismatch');
  if(!zip.equals(createZip(files))) throw Error('ZIP is not deterministic');
  const directory=join(root,'outputs');await mkdir(directory,{recursive:true});
  const filename=release?'Soton-Auto-Check-v1.0.0-latest-Windows-macOS.zip':`Soton-Auto-Check-v${pkg.version}-candidate-Windows-macOS.zip`;
  const releaseDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur'}).format(new Date());
  const provenance={candidate:!release,release,releaseName:release?'Soton Auto-Check V1.0.0 Release':undefined,releaseDate:release?releaseDate:undefined,version:pkg.version,baseRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceTreeSha256:sha(JSON.stringify(sources)),packageJsonSha256:sha(await readFile(join(root,'package.json'))),zipSha256:sha(zip),sourceFiles:sources,files:files.map(f=>({name:f.name,sha256:sha(f.data),bytes:f.data.length})),verificationLimits:['Database rollback/concurrency requires isolated PostgreSQL','Installed Windows/macOS Chrome and novice student trial require release review'],productionDeployment:false};
  const stem=release?'release-provenance':'candidate-provenance';
  await writeFile(join(directory,filename),zip);await writeFile(join(directory,`${filename}.sha256`),`${sha(zip)}  ${filename}\n`);await writeFile(join(directory,`${stem}.json`),JSON.stringify(provenance,null,2));
  console.log(`${release?'Release':'Candidate'}: ${join(directory,filename)}\nSHA-256: ${sha(zip)}\nVerified ${files.length} files, current bundles, deterministic ZIP.`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) await main();
