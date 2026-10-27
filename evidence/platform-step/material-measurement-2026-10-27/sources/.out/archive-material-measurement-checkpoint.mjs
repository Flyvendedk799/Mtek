import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync} from 'node:fs';
import {join,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {sanitizeReport} from '../tests/browser/support/sanitize-report.ts';
const root=process.cwd(),dest=join(root,'evidence/platform-step/material-measurement-2026-10-27');assert(!existsSync(join(dest,'validation.json')),'Checkpoint frozen');
const hash=b=>createHash('sha256').update(b).digest('hex'),files=[];
const walk=p=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(p,e.name)):[join(p,e.name)]);
function capture(source,target,exact=false){
 const original=readFileSync(join(root,source));let bytes=original;
 if(!exact&&source.endsWith('.json'))bytes=Buffer.from(JSON.stringify(sanitizeReport(JSON.parse(original.toString())),null,2)+'\n');
 else if(!exact&&/\.(log|jsonl)$/.test(source))bytes=Buffer.from(sanitizeReport(original.toString()));
 const compressed=!exact&&bytes.length>50000&&!source.endsWith('.png');if(compressed){bytes=gzipSync(bytes,{level:9});target+='.gz';}
 const path=join(dest,target);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);files.push({path:target,bytes:bytes.length,sha256:hash(bytes),original:{path:source,bytes:original.length,sha256:hash(original)},sanitized:!exact,compressed});
}
for(const version of [1,2,3,4]){
 const name=`material-measurement-preflight-v${version}`,base=join(root,'.out',name);
 for(const file of walk(base)){
  const name=relative(base,file).replaceAll('\\','/');
  if(/^(?:run\.json|report\.json|attempts\.jsonl|passes\/.*\/(?:record\.json|presentmon-process\.json|presentmon\.csv|native\.png|offscreen\.png))$/.test(name))capture(relative(root,file),`preflights/v${version}/${name}`);
 }
 capture(`.out/${name}.log`,`logs/${name}.log`);
}
for(const name of ['presentmon-material-probe-v2','material-native-checkpoint-proof','material-native-checkpoint-proof-v2']){
 const base=join(root,'.out',name);
 for(const file of walk(base)){
  const name=relative(base,file).replaceAll('\\','/');if(name.startsWith('site/')||name.startsWith('projects/'))continue;
  if(/\.(json|csv|png)$/.test(name))capture(relative(root,file),`correctness/${relative(base,file).replaceAll('\\','/')}`.replace('correctness/',`correctness/${relative(join(root,'.out'),base)}/`));
 }
}
for(const name of ['material-measurement-unit-final.log','material-measurement-lint-final.log','material-measurement-counter-final.log','material-measurement-types-final.log','checkpoint-native-proof.log','checkpoint-native-proof-v2.log'])capture(`.out/${name}`,`logs/${name}`);
const sources=readdirSync('benchmarks/material-lighting').filter(n=>/\.(mjs|json|ps1|md)$/.test(n)).map(n=>`benchmarks/material-lighting/${n}`);
sources.push('benchmarks/runtime/harness/instrument.ts','benchmarks/runtime/harness/instrument.test.ts','spec/decisions/0213-qualified-material-measurements.md','.out/checkpoint-native-proof.mjs','.out/archive-material-measurement-checkpoint.mjs');
for(const source of sources)capture(source,`sources/${source}`,true);
const native=JSON.parse(readFileSync('.out/material-native-checkpoint-proof-v2/result.json'));
assert.equal(native.status,'passed');assert(native.cases.every(c=>c.comparison.passed&&c.comparison.meanAbsoluteRgb8===0));assert.equal(native.cases.find(c=>c.implementation==='mtek').rafOnly.status,'passed');
const last=JSON.parse(readFileSync('.out/material-measurement-preflight-v4/run.json'));assert.equal(last.progress.accepted,0);assert.equal(last.progress.total,8);assert.equal(last.performanceEligible,false);
const unit=readFileSync('.out/material-measurement-unit-final.log','utf8'),counter=readFileSync('.out/material-measurement-counter-final.log','utf8');assert(unit.includes('# pass 17')&&unit.includes('# fail 0'));assert(counter.includes('11 passed (11)'));
const validation={format:'mtek-material-measurement-checkpoint/1',date:'2026-10-27',performanceEligible:false,roadmapComplete:false,userRequestedPause:true,checks:{materialUnits:17,counterUnits:11,nativeReadbackExactMatches:2,rafOnlyNegativeControl:'passed',materialLint:'passed',runtimeBenchmarkTypes:'passed',fullProtocol3VisualMatrix:'not run',full240PassPerformanceRun:'not run',latestPreflight:{accepted:0,total:8,status:'interference'}},files};
writeFileSync(join(dest,'validation.json'),JSON.stringify(validation,null,2)+'\n');
for(const f of files)assert.equal(hash(readFileSync(join(dest,f.path))),f.sha256);
console.log(JSON.stringify({files:files.length,sources:sources.length,checks:validation.checks}));
