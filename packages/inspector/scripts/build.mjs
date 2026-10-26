import {build} from "esbuild";
import {execFileSync} from "node:child_process";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
execFileSync(process.execPath,[require.resolve("typescript/lib/tsc.js"),"-p","tsconfig.build.json"],{stdio:"inherit",windowsHide:true});
await build({entryPoints:["src/index.ts"],outfile:"dist/index.js",bundle:true,format:"esm",platform:"browser",target:"es2022",sourcemap:true,metafile:true}).then(async result=>{const {writeFile}=await import("node:fs/promises");await writeFile("dist/metafile.json",JSON.stringify(result.metafile,null,2)+"\n");});
