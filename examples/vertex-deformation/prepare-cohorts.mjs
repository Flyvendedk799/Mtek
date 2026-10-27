import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
const here=import.meta.dirname,repo=resolve(here,"../..");
export async function prepareCohorts(){
  const original=join(repo,"benchmarks/runtime/animation/assets"), provenance=JSON.parse(await readFile(join(original,"provenance.json"),"utf8")),records=[];
  await mkdir(join(here,"cohorts/models"),{recursive:true});
  for(const name of ["Fox","CesiumMan"]){
    const expected=provenance.models.find(m=>m.model===name).files[`${name}.glb`],bytes=await readFile(join(original,name,`${name}.glb`));
    if(bytes.length!==expected.bytes||createHash("sha256").update(bytes).digest("hex")!==expected.sha256)throw new Error(`Pinned ${name} changed`);
    await writeFile(join(here,"cohorts/models",`${name}.glb`),bytes);records.push({model:name,commit:provenance.commit,...expected});
  }
  execFileSync(join(repo,"target/debug",process.platform==="win32"?"mtek.exe":"mtek"),["build","--mode","test","--out",join(here,".cohorts-out"),join(here,"cohorts")],{cwd:repo,stdio:"inherit",windowsHide:true});
  return records;
}
if(process.argv[1]&&resolve(process.argv[1])===join(here,"prepare-cohorts.mjs"))await prepareCohorts();
