import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {build} from "esbuild";
const here = import.meta.dirname, repo = resolve(here,"../..");
export async function prepareInspectionStudio(cli, destination = here) {
  const original = join(repo,"benchmarks/runtime/animation/assets"), provenance = JSON.parse(await readFile(join(original,"provenance.json"),"utf8"));
  const expected = provenance.models.find(model => model.model === "Fox").files["Fox.glb"], bytes = await readFile(join(original,"Fox/Fox.glb"));
  if (bytes.length !== expected.bytes || createHash("sha256").update(bytes).digest("hex") !== expected.sha256) throw new Error("Pinned Fox asset changed");
  await mkdir(join(here,"scene/models"),{recursive:true}); await writeFile(join(here,"scene/models/Fox.glb"),bytes);
  await mkdir(destination,{recursive:true});
  for (const file of ["index.html","studio.js"]) if (resolve(destination) !== resolve(here)) await writeFile(join(destination,file),await readFile(join(here,file)));
  execFileSync(cli,["build","--mode","test","--out",join(destination,".out"),join(here,"scene")],{cwd:repo,stdio:"inherit",windowsHide:true});
  execFileSync(process.execPath,["scripts/build.mjs"],{cwd:join(repo,"packages/inspector"),stdio:"inherit",windowsHide:true});
  await build({entryPoints:[join(repo,"packages/inspector/dist/index.js")],outfile:join(destination,".out/inspector.js"),bundle:true,format:"esm",platform:"browser",target:"es2022"});
  return {model:"Fox",commit:provenance.commit,...expected};
}
