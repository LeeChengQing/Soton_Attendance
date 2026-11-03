import {readFile,writeFile,readdir,copyFile,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {transform} from 'esbuild';
import {buildCandidate,root,liveFiles} from './build.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
export async function normalized(name,bytes) {
  if(name.endsWith('.js')) {
    // Compiler parsing preserves strings, regexes, identifiers and ASI semantics.
    // Do not strip whitespace with a regex: that could hide business changes.
    return (await transform(bytes.toString('utf8'),{loader:'js',target:'chrome120',legalComments:'none',minifyWhitespace:true,minifyIdentifiers:false,minifySyntax:false})).code;
  }
  if(name==='manifest.json') return JSON.stringify(JSON.parse(bytes));
  // HTML/CSS and the independent scripts originate in src and must match exactly.
  return bytes;
}
async function snapshot(dir,names) {
  return Object.fromEntries(await Promise.all(names.map(async name=>[name,sha(await readFile(join(dir,name)))])));
}
async function sourceFiles(dir,prefix='') {
  const result=[];
  for(const entry of await readdir(dir,{withFileTypes:true})) {
    const name=join(prefix,entry.name);
    if(entry.isDirectory()) result.push(...await sourceFiles(join(dir,entry.name),name));
    else result.push(name);
  }
  return result.sort();
}
export async function verifyParity({replace=false,reference=join(root,'backups/v1.0.5-live-2026-10-14')}={}) {
  if(replace) throw Error('Parity is historical only. Use npm run release for the V1.0.6 gates and replacement.');
  const sources=await sourceFiles(join(root,'src'));
  const beforeSource=await snapshot(join(root,'src'),sources);
  const beforeBuild=sha(await readFile(join(root,'scripts/build.mjs')));
  const beforeRoot=await snapshot(root,liveFiles);
  const beforeReference=await snapshot(reference,liveFiles);
  const out=await buildCandidate(),candidate=await snapshot(out,liveFiles),comparisons=[];
  for(const name of liveFiles) {
    const a=await normalized(name,await readFile(join(reference,name))), b=await normalized(name,await readFile(join(out,name)));
    const equal=sha(a)===sha(b);
    comparisons.push({file:name,equal,referenceSHA256:beforeReference[name],candidateSHA256:candidate[name],normalizedSHA256:sha(b)});
    console.log(`${equal?'PASS':'FAIL'} ${name}`);
  }
  if(comparisons.some(row=>!row.equal)) throw Error(`Parity failed; root unchanged. Candidate: ${out}`);
  console.log('Intentional differences: source path comments and compiler formatting only. No business logic differences.');
  const backup=null;
  const report={version:'1.0.5',candidate:out,reference,comparisons,historicalOnly:true,replaced:replace,backup,intentionalDifferences:['source path comments','compiler formatting'],sourceHashes:beforeSource};
  await writeFile(join(root,'docs/VERIFY_PARITY_V1.0.5.json'),JSON.stringify(report,null,2)+'\n');
  console.log(`Parity PASS: 新构建与线上 V1.0.5 行为一致。${replace?' Root replaced after parity and tests.':' Root unchanged.'}`);
  return report;
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)) {
  try {
    const index=process.argv.indexOf('--reference');
    if(index>=0&&!process.argv[index+1]) throw Error('--reference requires a directory');
    await verifyParity({replace:process.argv.includes('--replace'),reference:index<0?join(root,'backups/v1.0.5-live-2026-10-14'):resolve(root,process.argv[index+1])});
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
