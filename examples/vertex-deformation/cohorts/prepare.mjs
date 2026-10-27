import {build} from "esbuild";
import {cp,mkdir} from "node:fs/promises";
import {join,resolve} from "node:path";
import {prepareCohorts} from "../prepare-cohorts.mjs";
const here=import.meta.dirname;
export async function prepareDemo(){
  await prepareCohorts();await mkdir(join(here,".out"),{recursive:true});
  await cp(join(here,"../.cohorts-out"),join(here,".out"),{recursive:true});
  await build({entryPoints:[join(here,"main.ts")],outfile:join(here,"cohorts.js"),bundle:true,format:"esm",platform:"browser",target:"es2022",external:["./.out/app.js"]});
}
if(process.argv[1]&&resolve(process.argv[1])===join(here,"prepare.mjs"))await prepareDemo();
