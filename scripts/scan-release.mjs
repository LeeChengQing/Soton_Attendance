import {readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {inflateRawSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';

const forbidden=[/__ATTENDANCE_DEV__/,/developerMode/,/developer-mode\.js/,/跳过插件授权校验/,/开发调试\s*[·・]?\s*免激活/,/\[Developer Debug\]/,/license bypass/i];
export function scanReleaseEntries(files) {
  const findings=[];
  for(const file of files) {
    const text=Buffer.from(file.data).toString('utf8').replace(/\\u([a-f0-9]{4})/gi,(_,hex)=>String.fromCharCode(Number.parseInt(hex,16)));
    for(const pattern of forbidden) if(pattern.test(text)||pattern.test(file.name)) findings.push({file:file.name,rule:pattern.source});
  }
  const report={passed:findings.length===0,filesScanned:files.length,findings};
  if(findings.length){const error=Error('Development bypass found in release: '+findings.map(f=>f.file).join(', '));error.report=report;throw error;}
  return report;
}
export function scanReleaseZip(zip) {
  // Inflate entries in memory from central-directory sizes, including ZIPs with data descriptors.
  let end=-1;
  for(let i=zip.length-22;i>=Math.max(0,zip.length-65557);i--) if(zip.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0) throw Error('Invalid release ZIP');
  if(zip.readUInt16LE(end+4)||zip.readUInt16LE(end+6)) throw Error('Multi-volume ZIP unsupported');
  const files=[],count=zip.readUInt16LE(end+10);let offset=zip.readUInt32LE(end+16);
  if(!count||count===65535) throw Error('Empty or ZIP64 release unsupported');
  for(let i=0;i<count;i++) {
    if(offset+46>zip.length||zip.readUInt32LE(offset)!==0x02014b50)throw Error('Invalid ZIP directory');
    const method=zip.readUInt16LE(offset+10),flags=zip.readUInt16LE(offset+8),size=zip.readUInt32LE(offset+20),expanded=zip.readUInt32LE(offset+24),length=zip.readUInt16LE(offset+28),extra=zip.readUInt16LE(offset+30),comment=zip.readUInt16LE(offset+32),local=zip.readUInt32LE(offset+42);
    const name=zip.subarray(offset+46,offset+46+length).toString('utf8');
    if(flags&1||![0,8].includes(method)||local+30>zip.length||zip.readUInt32LE(local)!==0x04034b50)throw Error('Unsupported ZIP entry');
    const start=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28);
    if(start+size>zip.length)throw Error('Truncated ZIP entry');
    const bytes=zip.subarray(start,start+size),data=method===8?inflateRawSync(bytes,{maxOutputLength:Math.max(1,expanded)}):bytes;
    if(data.length!==expanded)throw Error('ZIP entry size mismatch');
    files.push({name,data});offset+=46+length+extra+comment;
  }
  return {...scanReleaseEntries(files),archive:'ZIP',decompressedBytes:files.reduce((sum,file)=>sum+file.data.length,0)};
}
export async function scanReleaseDirectory(directory,prefix='') {
  const files=[];
  for(const entry of await readdir(join(directory,prefix),{withFileTypes:true})) {
    const name=prefix?`${prefix}/${entry.name}`:entry.name;
    if(entry.isDirectory())files.push(...await collect(join(directory,name),name));
    else files.push({name,data:await readFile(join(directory,name))});
  }
  return scanReleaseEntries(files);
}
async function collect(directory,prefix) {
  const files=[];
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    const name=`${prefix}/${entry.name}`;
    if(entry.isDirectory())files.push(...await collect(join(directory,entry.name),name));else files.push({name,data:await readFile(join(directory,entry.name))});
  }
  return files;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  let report;
  try {report=scanReleaseZip(await readFile(process.argv[2]));}
  catch(error){report=error.report||{passed:false,error:error.message};process.exitCode=1;}
  if(process.argv[3])await writeFile(process.argv[3],JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}
