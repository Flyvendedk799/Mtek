import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {copyFileSync,existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from "node:fs";
import {dirname,join,resolve} from "node:path";
import {execFileSync,spawnSync} from "node:child_process";
import {build} from "esbuild";
import protocol from "./protocol.json" with {type:"json"};
import {actorPosition,camera,models,settings} from "./layout.ts";
import {definitionHash} from "./freeze.ts";

export const root=resolve(import.meta.dirname,"../../.."), here=import.meta.dirname;
export const site=join(root,"benchmarks/runtime/.out/animation/site");
const cli=join(root,"target/debug",process.platform==="win32"?"mtek.exe":"mtek");
interface Provenance {models:Array<{model:string;files:Record<string,{sha256:string}>}>;sharedLicenses?:Record<string,{sha256:string}>}
export function verifyAssets():void {
  const provenance=JSON.parse(readFileSync(join(here,"assets/provenance.json"),"utf8")) as Provenance;
  for(const model of provenance.models)for(const [file,record] of Object.entries(model.files)){
    const bytes=readFileSync(join(here,"assets",model.model,file));
    if(createHash("sha256").update(bytes).digest("hex")!==record.sha256)throw new Error(`Changed original asset: ${model.model}/${file}`);
  }
  for(const [file,record] of Object.entries(provenance.sharedLicenses??{}))if(createHash("sha256").update(readFileSync(join(here,"assets/licenses",file))).digest("hex")!==record.sha256)throw new Error(`Changed license text: ${file}`);
}
function preparedFiles(directory:string,prefix=""):Record<string,string>{
  const result:Record<string,string>={};
  for(const entry of readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const key=prefix+entry.name;if(key==="PREPARED.json")continue;
    if(entry.isDirectory())Object.assign(result,preparedFiles(join(directory,entry.name),key+"/"));
    else result[key]=createHash("sha256").update(readFileSync(join(directory,entry.name))).digest("hex");
  }
  return result;
}
export function verifyPrepared():void{
  verifyAssets();
  const record=JSON.parse(readFileSync(join(site,"PREPARED.json"),"utf8")) as {definitions:string;files:Record<string,string>};
  if(record.definitions!==definitionHash().hash||JSON.stringify(record.files)!==JSON.stringify(preparedFiles(site)))throw new Error("Prepared animation artifacts are stale or altered; prepare them again");
}
interface Glb {images:Array<{bufferView:number;mimeType:string}>;bufferViews:Array<{byteOffset?:number;byteLength:number}>}
export function embeddedImage(bytes:Buffer):{bytes:Buffer;extension:string} {
  const length=bytes.readUInt32LE(12),g=JSON.parse(bytes.subarray(20,20+length).toString("utf8")) as Glb;
  const image=g.images[0]!,view=g.bufferViews[image.bufferView]!;
  const binary=20+length+8+(view.byteOffset??0);
  return {bytes:bytes.subarray(binary,binary+view.byteLength),extension:image.mimeType==="image/png"?"png":"jpg"};
}
/** Flat benchmark materials are explicit. Preserve the BIN chunk and all geometry/skin/animation JSON. */
export function materialFreeGlb(bytes:Buffer):Buffer {
  const jsonLength=bytes.readUInt32LE(12);
  const gltf=JSON.parse(bytes.subarray(20,20+jsonLength).toString("utf8")) as Record<string,unknown> & {meshes:Array<{primitives:Array<{material?:number}>}>};
  for(const mesh of gltf.meshes)for(const primitive of mesh.primitives)delete primitive.material;
  for(const key of ["materials","textures","samplers","images"])delete gltf[key];
  const json=Buffer.from(JSON.stringify(gltf)),padded=Buffer.alloc(Math.ceil(json.length/4)*4,0x20);json.copy(padded);
  const tail=bytes.subarray(20+jsonLength),header=Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(20+padded.length+tail.length,8);
  header.writeUInt32LE(padded.length,12);header.writeUInt32LE(0x4e4f534a,16);
  return Buffer.concat([header,padded,tail]);
}
export async function prepare():Promise<void>{
  verifyAssets();mkdirSync(site,{recursive:true});
  const threeEntry=createRequire(import.meta.url).resolve("three");
  const actualThree=JSON.parse(readFileSync(join(dirname(threeEntry),"../package.json"),"utf8")) as {version:string};
  if(actualThree.version!==protocol.threeVersion)throw new Error(`Baseline version changed: ${actualThree.version}`);
  if(!existsSync(cli))throw new Error("Build mtek-cli before preparing animation benchmarks");
  const inventory:Record<string,unknown>={};
  const compatibility:Record<string,unknown>={};
  for(const model of models){
    const source=readFileSync(join(here,"assets",model,`${model}.glb`)),image=embeddedImage(source),derived=materialFreeGlb(source);
    mkdirSync(join(site,"assets"),{recursive:true});copyFileSync(join(here,"assets",model,`${model}.glb`),join(site,"assets",`${model}-original.glb`));
    writeFileSync(join(site,"assets",`${model}.glb`),derived);writeFileSync(join(site,"assets",`${model}.${image.extension}`),image.bytes);
    for(const count of protocol.actors)for(const textured of [false,true]){
      if(textured&&count!==1)continue;
      const key=`${model}-${count}${textured?"-textured":""}`,work=join(root,"benchmarks/runtime/.out/animation/work",key);
      mkdirSync(join(work,"src"),{recursive:true});mkdirSync(join(work,"models"),{recursive:true});
      writeFileSync(join(work,"mtek.toml"),`[project]\nname = "animation-${key.toLowerCase()}"\nlanguage = "0.1"\n\n[host.inputs]\ncamera_x = "Demo.camera_x"\n`);
      writeFileSync(join(work,"models/model.glb"),derived);writeFileSync(join(work,"models",`base.${image.extension}`),image.bytes);
      const view=camera(count,textured),modelSettings=settings[model];
      let text=`const MODEL = asset.glb("../models/model.glb");\n`;
      if(textured)text+=`const MAP = asset.texture("../models/base.${image.extension}");\nmaterial Character {\n    param map: texture = texture.white();\n    param filter: sampler = sampler.linear_repeat();\n    fragment(input: SurfaceInput) -> color {\n        return color.linear(sample(map, filter, input.uv).xyz, 1.0);\n    }\n}\n`;
      const vec=(values:readonly number[])=>`vec3(${values.map(v=>Number.isInteger(v)?`${v}.0`:String(v)).join(", ")})`;
      text+=`scene Demo {\n    clear_color: ${protocol.clearColor};\n    state camera_x: f32 = 0.0;\n    camera Main {\n        position: bind(vec3(camera_x + ${view.position[0]}.0, ${view.position[1]}, ${view.position[2]}));\n        target: bind(vec3(camera_x, ${view.target[1]}, ${view.target[2]}));\n        projection: Orthographic { height: ${view.height}.0; near: 0.1; far: 200.0 };\n    }\n`;
      for(let i=0;i<count;i++)text+=`    entity Actor${String(i).padStart(2,"0")} {\n        position: ${vec(actorPosition(i,count))};\n        rotation: quat.euler(${modelSettings.rotationX}, 0.0, ${modelSettings.rotationZ});\n        scale: vec3(${modelSettings.scale}, ${modelSettings.scale}, ${modelSettings.scale});\n        mesh: MODEL.mesh("${modelSettings.mesh}");\n        clip: "${modelSettings.clip}";\n        material: ${textured?"Character { map: MAP }":`Unlit { color: ${protocol.color} }`};\n    }\n`;
      text+="}\n";writeFileSync(join(work,"src/main.mtek"),text);
      if(count===1&&!textured){
        writeFileSync(join(work,"models/model.glb"),source);
        const original=spawnSync(cli,["check","--format","json",work],{cwd:root,encoding:"utf8",windowsHide:true});
        compatibility[model]={originalSha256:createHash("sha256").update(source).digest("hex"),originalImportExitCode:original.status,originalDiagnostics:original.stdout.trim()?JSON.parse(original.stdout) as unknown:original.stderr,benchmarkMaterialReplacement:"Explicit and identical on both implementations; complete BIN chunk and all geometry, nodes, skins and animations retained"};
        writeFileSync(join(work,"models/model.glb"),derived);
      }
      execFileSync(cli,["build","--mode","release","--out",join(site,"mtek",key),work],{cwd:root,stdio:"pipe",windowsHide:true});
      inventory[key]={model,count,textured,sourceSha256:createHash("sha256").update(source).digest("hex"),derivedSha256:createHash("sha256").update(derived).digest("hex"),conversion:"Explicit material replacement; unchanged BIN, geometry, nodes, skins and animations",...modelSettings};
    }
  }
  writeFileSync(join(site,"inventory.json"),JSON.stringify(inventory,null,2)+"\n");
  writeFileSync(join(site,"compatibility.json"),JSON.stringify(compatibility,null,2)+"\n");
  for(const engine of ["mtek","three"]){
    await build({entryPoints:[join(here,"page.ts")],outfile:join(site,`page-${engine}.js`),bundle:true,format:"esm",target:"es2022",logLevel:"warning",alias:{"@animation-implementation":join(here,`${engine}-adapter.ts`)}});
    writeFileSync(join(site,`index-${engine}.html`),`<!doctype html><meta charset="utf-8"><title>Matched animation · ${engine}</title><script type="module" src="./page-${engine}.js"></script>`);
  }
  copyFileSync(join(site,"index-mtek.html"),join(site,"index.html"));
  await build({entryPoints:[join(here,"demo.ts")],outfile:join(site,"demo.js"),bundle:true,format:"esm",target:"es2022",logLevel:"warning"});
  copyFileSync(join(here,"demo.html"),join(site,"demo.html"));
  writeFileSync(join(site,"PREPARED.json"),JSON.stringify({definitions:definitionHash().hash,files:preparedFiles(site)},null,2)+"\n");
  console.log(`Prepared ${Object.keys(inventory).length} animation programs at ${site}`);
}
if(process.argv[1]!==undefined&&resolve(process.argv[1])===join(here,"prepare.ts"))await prepare();
