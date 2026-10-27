import {mkdir,readFile,writeFile,readdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {resolve,join,relative,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {makeContent} from "./assets.mjs";
import {protocol,describeScene,mtekSource} from "./scenes.mjs";
const here=import.meta.dirname,repo=resolve(here,"../.."),hash=b=>createHash("sha256").update(b).digest("hex");
export async function prepareMaterials({bundle=true}={}){
  const three=JSON.parse(await readFile(join(repo,"node_modules/three/package.json"),"utf8"));
  if(three.version!==protocol.reference.version)throw new Error("Reference version differs from protocol");
  const cli=process.env.MTEK_BIN?resolve(process.env.MTEK_BIN):join(repo,"target/debug",process.platform==="win32"?"mtek.exe":"mtek"),content=makeContent(),site=join(here,".out/site"),cases=[];
  await mkdir(site,{recursive:true});await writeFile(join(site,"content.glb"),content);
  for(const scene of protocol.scenes)for(const quality of Object.keys(protocol.profiles))for(const control of scene==="particles"?[false,true]:[false]){
    const id=`${scene}-${quality}${control?"-control":""}`,project=join(here,".out/projects",id),output=join(site,"programs",id);
    await mkdir(join(project,"src"),{recursive:true});await mkdir(join(project,"models"),{recursive:true});
    await writeFile(join(project,"models/content.glb"),content);await writeFile(join(project,"mtek.toml"),`[project]\nname = "material-${id}"\nlanguage = "0.1"\n`);
    await writeFile(join(project,"src/main.mtek"),mtekSource(describeScene(scene,quality),{control}));
    execFileSync(cli,["fmt",join(project,"src/main.mtek")],{cwd:repo,stdio:"pipe",windowsHide:true});
    execFileSync(cli,["build","--mode","test","--out",output,project],{cwd:repo,stdio:"pipe",windowsHide:true});
    const source=await readFile(join(project,"src/main.mtek")),files=[];
    async function collect(directory,prefix=""){
      for(const entry of await readdir(directory,{withFileTypes:true})){const path=join(directory,entry.name),name=prefix+entry.name;if(entry.isDirectory())await collect(path,name+"/");else{const b=await readFile(path);files.push({path:name,bytes:b.length,sha256:hash(b)});}}
    }
    await collect(output);cases.push({id,scene,quality,control,sourceSha256:hash(source),program:`programs/${id}/app.js`,files});
  }
  let harness=null;
  if(bundle){
    const built=await build({entryPoints:[join(here,"page.mjs")],outdir:site,splitting:true,chunkNames:"chunks/[name]-[hash]",bundle:true,write:false,format:"esm",target:"es2022",metafile:true}),chunks=[];
    for(const file of built.outputFiles){await mkdir(dirname(file.path),{recursive:true});await writeFile(file.path,file.contents);chunks.push({path:relative(site,file.path).replaceAll("\\","/"),sha256:hash(file.contents),bytes:file.contents.length});}
    const inputs=[];for(const path of Object.keys(built.metafile.inputs).sort()){const b=await readFile(resolve(path));inputs.push({path:relative(repo,resolve(path)).replaceAll("\\","/"),sha256:hash(b)});}
    harness={sha256:chunks.find(c=>c.path==="page.js").sha256,bytes:chunks.reduce((n,c)=>n+c.bytes,0),chunks,inputs};
    await writeFile(join(site,"index.html"),'<!doctype html><meta charset="utf-8"><title>Material/lighting comparison probe</title><canvas></canvas><pre id="status">Preparing</pre><script type="module" src="./page.js"></script>');
  }
  const record={format:"mtek-material-lighting-build/1",preparedAt:new Date().toISOString(),protocolSha256:hash(await readFile(join(here,"protocol.json"))),content:{bytes:content.length,sha256:hash(content)},referenceVersion:three.version,cliSha256:hash(await readFile(cli)),cases,harness};
  await writeFile(join(site,"build.json"),JSON.stringify(record,null,2)+"\n");return record;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const r=await prepareMaterials({bundle:!process.argv.includes("--assets-only")});console.log(`Prepared ${r.cases.length} compiler packages; common GLB ${r.content.sha256}`);}
