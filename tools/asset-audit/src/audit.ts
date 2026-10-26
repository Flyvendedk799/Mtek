import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {closeSync,existsSync,fstatSync,mkdirSync,mkdtempSync,openSync,readFileSync,readSync,writeFileSync} from "node:fs";
import {basename,dirname,extname,join,relative,resolve} from "node:path";
import {inventory,MAX_FILE_BYTES,object} from "./inventory.ts";

export interface Expected {status:"passed"|"rejected";codes?:readonly string[]}
export interface Probe {id:string;mesh:string;primitive?:number;material?:string;clip?:string;expected?:Expected}
export interface Entry {id:string;file:string;sha256?:string;provenance?:string;expectedImport?:Expected;probes:readonly Probe[]}
export interface Corpus {schemaVersion:1;entries:readonly Entry[]}
export interface Check {status:"passed"|"rejected"|"not-run";codes:string[];diagnostics:unknown[];raw?:unknown;reason?:string;exitCode?:number|null;source?:string}
export interface CompilerIdentity {available:boolean;file:string;sha256?:string;version?:string;reason?:string}
export interface Result {id:string;file:string;sha256:string|null;bytes:number|null;inventory:object|null;inventoryError:string|null;inputUnchanged:boolean|null;import:Check;probes:Array<{id:string;status:Check["status"]|"blocked";check?:Check}>;expectationsMatched:boolean|null;notes:string[];provenance:string|null}
export const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
export function readAsset(file:string,maximum=MAX_FILE_BYTES):Buffer {
  const fd=openSync(file,"r");try{
    const stat=fstatSync(fd);if(!stat.isFile()||stat.size>maximum)throw new Error(`Input must be a local file no larger than ${maximum} bytes`);
    const buffer=Buffer.alloc(stat.size+1);let count=0;
    while(count<buffer.length){const size=readSync(fd,buffer,count,buffer.length-count,null);if(size===0)break;count+=size;}
    if(count>stat.size)throw new Error("Input grew while reading; retry with a stable source");
    return buffer.subarray(0,count);
  }finally{closeSync(fd);}
}
const text = (value:unknown,label:string):string => {if(typeof value!=="string"||value.length===0||value.length>1024)throw new Error(`Invalid ${label}`);return value;};
function expected(value:unknown):Expected|undefined {
  if(value===undefined)return undefined;const row=object(value);
  if(row["status"]!=="passed"&&row["status"]!=="rejected")throw new Error("Expected status must be passed or rejected");
  const codes=row["codes"];if(codes!==undefined&&(!Array.isArray(codes)||codes.some(code=>typeof code!=="string"||!/^MTEK-E\d{4}$/.test(code))))throw new Error("Invalid expected diagnostic codes");
  return {status:row["status"],...(codes===undefined?{}:{codes:codes as string[]})};
}
export function parseCorpus(value:unknown):Corpus {
  const root=object(value),entries=root["entries"];
  if(root["schemaVersion"]!==1||!Array.isArray(entries)||entries.length===0||entries.length>64)throw new Error("Corpus requires version 1 and 1–64 entries");
  const ids=new Set<string>();
  return {schemaVersion:1,entries:entries.map(raw=>{
    const row=object(raw),id=text(row["id"],"entry ID"),file=text(row["file"],"local file path");
    if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)||ids.has(id))throw new Error("Entry IDs must be unique lowercase identifiers");ids.add(id);
    if(/^[a-z][a-z0-9+.-]*:\/\//i.test(file)||file.startsWith("\\\\")||file.startsWith("//"))throw new Error("Use local filesystem paths, not URLs or UNC paths");
    const digest=row["sha256"];if(digest!==undefined&&(typeof digest!=="string"||!/^[a-f0-9]{64}$/i.test(digest)))throw new Error("Invalid source SHA-256");
    const probes=row["probes"]??[];if(!Array.isArray(probes)||probes.length>128)throw new Error("At most 128 usage probes are allowed per asset");
    const probeIds=new Set<string>();
    const parsed=probes.map(raw=>{const probe=object(raw),id=text(probe["id"],"probe ID"),mesh=text(probe["mesh"],"mesh name");if(probeIds.has(id))throw new Error("Probe IDs must be unique");probeIds.add(id);
      const primitive=probe["primitive"];if(primitive!==undefined&&(!Number.isSafeInteger(primitive)||(primitive as number)<0))throw new Error("Primitive index must be a nonnegative safe integer");
      const expectation=expected(probe["expected"]);
      return {id,mesh,...(primitive===undefined?{}:{primitive:primitive as number}),...(probe["material"]===undefined?{}:{material:text(probe["material"],"material name")}),...(probe["clip"]===undefined?{}:{clip:text(probe["clip"],"clip name")}),...(expectation===undefined?{}:{expected:expectation})};});
    const expectation=expected(row["expectedImport"]);
    return {id,file,probes:parsed,...(digest===undefined?{}:{sha256:digest}),...(row["provenance"]===undefined?{}:{provenance:text(row["provenance"],"provenance")}),...(expectation===undefined?{}:{expectedImport:expectation})};
  })};
}
/** Mtek uses \u{HEX}, not JSON's \uXXXX; escape interpolation markers too. */
export function mtekString(value:string):string {
  let out='"';for(const char of value){const point=char.codePointAt(0)!;
    if(point>=0xd800&&point<=0xdfff)throw new Error("Unpaired surrogate in probe name");
    if(char==='"'||char==='\\'||char==='$')out+='\\'+char;
    else if(point<32||point===127)out+=`\\u{${point.toString(16)}}`;else out+=char;
  }return out+'"';
}
export function probeSource(file:string,probe?:Probe):string {
  const mesh=probe===undefined?"":probe.primitive===undefined?`MODEL.mesh(${mtekString(probe.mesh)})`:`MODEL.primitive(${mtekString(probe.mesh)}, ${probe.primitive})`;
  return `const MODEL = asset.glb(${mtekString("../models/"+file)});\nscene Audit {\n    camera Main {}\n${probe===undefined?"":`    entity Part {\n        mesh: ${mesh};\n${probe.material===undefined?"":`        material: MODEL.material(${mtekString(probe.material)});\n`}${probe.clip===undefined?"":`        clip: ${mtekString(probe.clip)};\n`}    }\n`}}\n`;
}
export function compilerCheck(compiler:string,project:string):Check {
  const result=spawnSync(compiler,["check","--format","json",project],{encoding:"utf8",windowsHide:true,timeout:10000,maxBuffer:4*1024*1024,env:{...process.env,RAYON_NUM_THREADS:"1"}});
  if(result.error!==undefined||result.signal!==null||![0,1].includes(result.status??-1))return {status:"not-run",codes:[],diagnostics:[],reason:result.error?.message??`Compiler did not complete normally (${String(result.status)})`,exitCode:result.status};
  try {
    const raw:unknown=JSON.parse(result.stdout),root=object(raw),diagnostics=root["diagnostics"];
    if(root["schemaVersion"]!==1||root["tool"]!=="mtek"||!Array.isArray(diagnostics))throw new Error("Unrecognized compiler diagnostic envelope");
    const errors=diagnostics.map(value=>object(value)).filter(row=>row["severity"]==="error");
    if((result.status===0&&errors.length!==0)||(result.status===1&&errors.length===0))throw new Error("Compiler exit status contradicts its diagnostics");
    const codes=errors.map(row=>text(row["code"],"compiler diagnostic code"));
    return {status:result.status===0?"passed":"rejected",codes:[...new Set(codes)].sort(),diagnostics,raw,exitCode:result.status};
  }catch(error){return {status:"not-run",codes:[],diagnostics:[],reason:`Invalid compiler JSON: ${error instanceof Error?error.message:String(error)}`,exitCode:result.status};}
}
const matches=(expectation:Expected,check:Check):boolean=>expectation.status===check.status&&(expectation.codes===undefined||JSON.stringify([...new Set(expectation.codes)].sort())===JSON.stringify([...new Set(check.codes)].sort()));
export function auditEntry(entry:Entry,base:string,workRoot:string,run:(project:string)=>Check):Result {
  const file=resolve(base,entry.file),result:Result={id:entry.id,file:entry.file,sha256:null,bytes:null,inventory:null,inventoryError:null,inputUnchanged:null,import:{status:"not-run",codes:[],diagnostics:[]},probes:[],expectationsMatched:null,notes:[],provenance:entry.provenance??null};
  try {
    const bytes=readAsset(file);
    result.sha256=sha256(bytes);result.bytes=bytes.length;
    if(entry.sha256!==undefined&&entry.sha256.toLowerCase()!==result.sha256)throw new Error("Source SHA-256 differs from the pinned corpus input");
    try{result.inventory=inventory(bytes);}catch(error){result.inventoryError=error instanceof Error?error.message:String(error);}
    mkdirSync(workRoot,{recursive:true});const work=mkdtempSync(join(workRoot,entry.id+"-")),model="model"+extname(file);
    mkdirSync(join(work,"src"));mkdirSync(join(work,"models"));writeFileSync(join(work,"models",model),bytes);
    writeFileSync(join(work,"mtek.toml"),'[project]\nname = "asset-audit"\nlanguage = "0.1"\n');
    const source=probeSource(model);writeFileSync(join(work,"src/main.mtek"),source);result.import={...run(work),source};
    for(const probe of entry.probes){
      if(result.import.status!=="passed"){result.probes.push({id:probe.id,status:"blocked"});continue;}
      const source=probeSource(model,probe);writeFileSync(join(work,"src/main.mtek"),source);const check={...run(work),source};result.probes.push({id:probe.id,status:check.status,check});
    }
    result.inputUnchanged=sha256(readAsset(file))===result.sha256;
    if(!result.inputUnchanged)result.notes.push("Source changed while auditing; discard compatibility conclusions and retry.");
    if(entry.probes.length===0)result.notes.push("No mesh/material/clip use was requested. Import success alone is not full asset compatibility.");
    result.notes.push("No build, packaged-byte budget, rendered pixels or runtime/device validation was performed.");
    const expectedChecks=entry.expectedImport!==undefined&&entry.probes.every(probe=>probe.expected!==undefined);
    if(expectedChecks)result.expectationsMatched=matches(entry.expectedImport!,result.import)&&entry.probes.every((probe,index)=>{
      const actual=result.probes[index]!;return actual.status!=="blocked"&&actual.check!==undefined&&matches(probe.expected!,actual.check);
    })&&result.inputUnchanged;
  }catch(error){result.import={status:"not-run",codes:[],diagnostics:[],reason:error instanceof Error?error.message:String(error)};result.expectationsMatched=false;}
  return result;
}
export function compilerIdentity(path:string):CompilerIdentity {
  try{const version=spawnSync(path,["--version"],{encoding:"utf8",windowsHide:true,timeout:5000,maxBuffer:4096});return {available:existsSync(path)&&version.status===0,file:basename(path),sha256:sha256(readFileSync(path)),version:version.status===0?version.stdout.trim():"unavailable"};}
  catch(error){return {available:false,file:basename(path),reason:error instanceof Error?error.message:String(error)};}
}
export function displayPath(root:string,path:string):string{return relative(root,path).replaceAll("\\","/");}
export function corpusBase(path:string):string{return dirname(resolve(path));}
