import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {createRequire} from "node:module";
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";

const root=resolve(import.meta.dirname,"../../.."),npmCli=process.env.npm_execpath;
if(!npmCli)throw new Error("Run with npm run verify:package -w @mtek/inspector");
const require=createRequire(import.meta.url),parent=join(root,"target");mkdirSync(parent,{recursive:true});
const scratch=mkdtempSync(join(parent,"inspector-consumer-"));
const npm=(cwd,args)=>execFileSync(process.execPath,[npmCli,...args],{cwd,encoding:"utf8",windowsHide:true,stdio:["ignore","pipe","pipe"]});
const packs=[];
for(const name of ["runtime-web","inspector"]){
  const [record]=JSON.parse(npm(join(root,"packages",name),["pack","--json","--ignore-scripts","--workspaces=false","--pack-destination",scratch]));
  if(!record.files.some(file=>file.path.endsWith(".d.ts"))||record.files.some(file=>file.path.startsWith("src/")&&!file.path.endsWith(".d.ts")))throw new Error("Invalid package boundary");
  packs.push(record);
}
writeFileSync(join(scratch,"package.json"),JSON.stringify({name:"independent-inspector-consumer",private:true,type:"module"}));
npm(scratch,["install","--offline","--ignore-scripts","--no-audit","--no-fund","--workspaces=false",...packs.map(pack=>join(scratch,pack.filename))]);
writeFileSync(join(scratch,"consumer.ts"),`import {InspectorController,mountInspectorPanel,mountInspectorOverlay,buildInspectorOverlay,type InspectorSnapshot,type InspectorOverlay} from "@mtek/inspector";
import type {MtekExtension,ExtensionContext} from "@mtek/runtime-web";
const controller=new InspectorController();
const extension:MtekExtension=controller.extension;
const attach:(parent:HTMLElement)=>()=>void=parent=>mountInspectorPanel(controller,parent);
const snapshot:InspectorSnapshot=controller.snapshot();
const context:ExtensionContext|null=null;
const overlay:(canvas:HTMLCanvasElement)=>InspectorOverlay=canvas=>mountInspectorOverlay(controller,canvas,{bounds:true,skeleton:true,ik:true,colliders:true,contacts:true});
const geometry=buildInspectorOverlay(controller.spatialSnapshot());
void [extension,attach,snapshot,context,overlay,geometry];
`);
writeFileSync(join(scratch,"tsconfig.json"),JSON.stringify({compilerOptions:{module:"NodeNext",moduleResolution:"NodeNext",target:"ES2022",lib:["ES2022","DOM","DOM.Iterable"],types:[],strict:true,noEmit:true,skipLibCheck:false},files:["consumer.ts"]}));
try{execFileSync(process.execPath,[require.resolve("typescript/lib/tsc.js"),"-p",join(scratch,"tsconfig.json")],{cwd:scratch,encoding:"utf8",stdio:"pipe",windowsHide:true});}
catch(error){throw new Error(`Public consumer typecheck failed:\n${error.stdout??error.message}`);}
writeFileSync(join(scratch,"consumer.mjs"),`import assert from "node:assert/strict";
import {InspectorController} from "@mtek/inspector";
import {EXTENSION_API_VERSION} from "@mtek/runtime-web";
assert.equal(EXTENSION_API_VERSION,1);
const inspector=new InspectorController();
let entity={id:"scene:1:Box",name:"Box",position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0,w:1},scale:{x:1,y:1,z:1},visible:true};
const context={apiVersion:1,readTransforms:()=>[structuredClone(entity)],writeTransforms:updates=>{entity={...entity,...updates[0]}},animation:()=>undefined,service:()=>undefined,shareAnimation(){},detachAnimation(){throw new Error("No animation")}};
const cleanup=inspector.extension.setup(context);
inspector.edit([{id:entity.id,position:{x:7,y:0,z:0}}]);assert.equal(entity.position.x,0);
inspector.extension.beforeFrame(context,0);inspector.extension.afterFrame(context,0);assert.equal(inspector.snapshot().entities[0].position.x,7);
inspector.undo();inspector.extension.beforeFrame(context,0);inspector.extension.afterFrame(context,0);assert.equal(entity.position.x,0);
cleanup();assert.equal(inspector.snapshot().status,"detached");inspector.dispose();
await assert.rejects(()=>import("@mtek/inspector/src/controller.js"),{code:"ERR_PACKAGE_PATH_NOT_EXPORTED"});
`);
execFileSync(process.execPath,[join(scratch,"consumer.mjs")],{cwd:scratch,stdio:"pipe",windowsHide:true});
const meta=JSON.parse(readFileSync(join(root,"packages/inspector/dist/metafile.json"),"utf8"));
if(Object.keys(meta.inputs).some(path=>!path.startsWith("src/")))throw new Error("Inspector bundled a runtime implementation dependency");
const out=resolve(process.env.MTEK_INSPECTOR_EVIDENCE_DIR??join(root,".out/inspector-package"));mkdirSync(out,{recursive:true});
const report={recordedAt:new Date().toISOString(),status:"passed",network:"offline installation of local tarballs",typecheck:"strict NodeNext, skipLibCheck=false, no source aliases",runtimeConsumer:"passed without DOM/GPU; frame-queued edit, undo, cleanup, root API and export boundary",inspectorRuntimeDependencies:Object.keys(meta.inputs),packages:packs.map(pack=>({name:pack.name,version:pack.version,files:pack.files.map(file=>file.path),integrity:pack.integrity,sha256:createHash("sha256").update(readFileSync(join(scratch,pack.filename))).digest("hex")}))};
writeFileSync(join(out,"package-consumer.json"),JSON.stringify(report,null,2)+"\n");
console.log("Independent offline tarball consumer: strict public declarations, runtime operations and package boundaries passed.");
