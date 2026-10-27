import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,readdir,mkdir,writeFile,rename,copyFile} from "node:fs/promises";
import {join,dirname,resolve,sep} from "node:path";

export const sha256=bytes=>createHash("sha256").update(bytes).digest("hex");
export const readJson=async path=>JSON.parse(await readFile(path,"utf8"));
export async function writeJson(path,value){
  await mkdir(dirname(path),{recursive:true});const temporary=`${path}.${String(process.pid)}.tmp`;
  await writeFile(temporary,JSON.stringify(value,null,2)+"\n");await rename(temporary,path);
}
export function inside(directory,path){
  const absolute=resolve(directory,path);assert(absolute.startsWith(resolve(directory)+sep),"Artifact path leaves the run directory");return absolute;
}
export async function sourceDefinition(){
  const directory=import.meta.dirname,files=[];
  for(const name of (await readdir(directory)).filter(n=>/\.(mjs|json|ps1)$/.test(n)).sort()){
    const bytes=await readFile(join(directory,name));files.push({path:`benchmarks/material-lighting/${name}`,bytes:bytes.length,sha256:sha256(bytes)});
  }
  for(const path of ["benchmarks/runtime/harness/instrument.ts","benchmarks/runtime/harness/stats.ts","benchmarks/runtime/tools/host-load.ts","tests/browser/support/launch-args.ts"]){const bytes=await readFile(resolve(directory,"../..",path));files.push({path,bytes:bytes.length,sha256:sha256(bytes)});}
  files.sort((a,b)=>a.path.localeCompare(b.path));
  return {sha256:sha256(Buffer.from(JSON.stringify(files))),files};
}
export async function validateBuild(build,directory){
  assert.equal(build.mode,"release");
  for(const [path,identity] of [["content.glb",build.content],["WaterBottle.glb",build.product]]){const bytes=await readFile(inside(directory,path));assert.equal(sha256(bytes),identity.sha256);}
  for(const c of build.cases)for(const f of c.files){const bytes=await readFile(inside(directory,`programs/${c.id}/${f.path}`));assert.equal(bytes.length,f.bytes);assert.equal(sha256(bytes),f.sha256);}
  for(const f of build.harness.chunks){const bytes=await readFile(inside(directory,f.path));assert.equal(sha256(bytes),f.sha256);}
}

export async function snapshotSources(definition,build,output){
  const files=new Map([...definition.files,...build.harness.inputs].map(f=>[f.path,f]));
  for(const f of files.values()){
    const bytes=await readFile(resolve(import.meta.dirname,"../..",f.path));assert.equal(sha256(bytes),f.sha256,`Source changed before snapshot: ${f.path}`);
    const target=inside(join(output,"sources"),f.path);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);
  }
}

export async function validateSources(definition,build,output){
  assert.equal(sha256(Buffer.from(JSON.stringify(definition.files))),definition.sha256,"Source list identity differs");
  for(const f of [...definition.files,...build.harness.inputs]){
    const bytes=await readFile(inside(join(output,"sources"),f.path));assert.equal(sha256(bytes),f.sha256,`Source snapshot differs: ${f.path}`);
  }
}
export async function copyVisualPrerequisite(path,output,build){
  const report=await readJson(path);
  assert.equal(report.backend,"hardware");assert.equal(report.status,"passed");assert.equal(report.completeMatrix,true);assert.equal(report.visualPrerequisitesPassed,true);
  assert.equal(report.cases.length,10);assert(report.cases.every(c=>c.status==="passed"));
  assert.equal(report.build.mode,"release");assert.equal(report.build.protocolSha256,build.protocolSha256);
  assert.equal(report.build.content.sha256,build.content.sha256);assert.equal(report.build.product.sha256,build.product.sha256);assert.equal(report.build.harness.sha256,build.harness.sha256);
  assert.deepEqual(report.build.cases.map(c=>({id:c.id,files:c.files})),build.cases.map(c=>({id:c.id,files:c.files})),"Visual gate did not exercise these compiler packages");
  const directory=join(output,"prerequisites");await mkdir(directory,{recursive:true});
  for(const c of report.cases)for(const implementation of Object.values(c.implementations)){
    for(const image of [...implementation.images,...(implementation.control?[implementation.control.image]:[])]){
      const original=inside(dirname(path),image.path),bytes=await readFile(original);assert.equal(sha256(bytes),image.sha256);await copyFile(original,inside(directory,image.path));
    }
  }
  await copyFile(path,join(directory,"hardware.json"));return {report,sha256:sha256(await readFile(path)),path:"prerequisites/hardware.json"};
}
