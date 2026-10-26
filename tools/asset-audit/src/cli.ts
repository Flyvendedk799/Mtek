import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from "node:fs";
import {basename,join,resolve} from "node:path";
import {auditEntry,compilerCheck,compilerIdentity,corpusBase,parseCorpus,readAsset,sha256,type Corpus} from "./audit.ts";
import {MAX_JSON_BYTES} from "./inventory.ts";
import {markdown} from "./report.ts";
const root=resolve(import.meta.dirname,"../../..");
const invocation=process.env["INIT_CWD"]??process.cwd();
const args=process.argv.slice(2),allowed=new Set(["corpus","file","mesh","primitive","material","clip","compiler","out","check","help"]),seen=new Set<string>();
for(const arg of args){const key=arg.slice(2).split("=")[0]!;if(!arg.startsWith("--")||!allowed.has(key)||seen.has(key))throw new Error(`Unknown or duplicate argument: ${arg}`);seen.add(key);if(["check","help"].includes(key)?arg!==`--${key}`:!arg.includes("=")||arg.endsWith("="))throw new Error(`Invalid argument: ${arg}`);}
if(args.includes("--help")){
  console.log("node tools/asset-audit/src/cli.ts --corpus=<json> | --file=<local-model> [--mesh=<name> --primitive=<index> --material=<name> --clip=<name>] [--compiler=<existing-binary>] [--out=<fresh-directory>] [--check]\n--check verifies every pinned corpus expectation; otherwise rejected or untested usage yields a nonzero exit status. No compiler build or GPU work occurs.");
}else{
  const option=(key:string):string|undefined=>args.find(arg=>arg.startsWith(`--${key}=`))?.slice(key.length+3);
  const corpusArg=option("corpus"),fileArg=option("file"),check=args.includes("--check");
  if((corpusArg===undefined)===(fileArg===undefined))throw new Error("Choose exactly one --corpus=<json> or --file=<local-file>");
  if(fileArg!==undefined&&check)throw new Error("--check requires a corpus with explicit expected outcomes");
  const mesh=option("mesh");if(["primitive","material","clip"].some(key=>option(key)!==undefined)&&mesh===undefined)throw new Error("Usage options require --mesh");
  if(corpusArg!==undefined&&mesh!==undefined)throw new Error("Put corpus usage probes in the corpus JSON");
  const corpusPath=corpusArg===undefined?undefined:resolve(invocation,corpusArg);
  const corpusBytes=corpusPath===undefined?null:readAsset(corpusPath,MAX_JSON_BYTES);
  const corpus:Corpus=corpusBytes===null?parseCorpus({schemaVersion:1,entries:[{id:"input",file:fileArg!,probes:mesh===undefined?[]:[{id:"requested-use",mesh,...(option("primitive")===undefined?{}:{primitive:Number(option("primitive"))}),...(option("material")===undefined?{}:{material:option("material")}),...(option("clip")===undefined?{}:{clip:option("clip")})}]}]}):parseCorpus(JSON.parse(corpusBytes.toString("utf8")) as unknown);
  if(check&&corpus.entries.some(entry=>entry.sha256===undefined||entry.expectedImport===undefined||entry.probes.some(probe=>probe.expected===undefined)))throw new Error("--check requires a source SHA-256 and explicit expectations for each import and requested probe");
  const base=corpusPath===undefined?invocation:corpusBase(corpusPath),compiler=resolve(invocation,option("compiler")??join(root,"target/debug",process.platform==="win32"?"mtek.exe":"mtek"));
  const out=resolve(invocation,option("out")??join(root,"target/asset-audit",new Date().toISOString().replaceAll(":","-")));
  if(existsSync(join(out,"report.json")))throw new Error("Audit output already exists; choose a fresh directory to preserve the earlier evidence");
  mkdirSync(out,{recursive:true});const identity=compilerIdentity(compiler),results=[];
  for(const entry of corpus.entries){console.log(`Checking ${entry.id} (serial, existing compiler only)`);results.push(auditEntry(entry,base,join(root,"target/asset-audit-work"),project=>compilerCheck(compiler,project)));}
  const identityAfter=compilerIdentity(compiler),compilerUnchanged=identity.available&&identityAfter.available&&identity.sha256===identityAfter.sha256;
  const completed=compilerUnchanged&&results.every(row=>row.import.status!=="not-run"&&row.probes.every(probe=>probe.status!=="not-run")&&row.inputUnchanged===true);
  const passed=check?completed&&results.every(row=>row.expectationsMatched===true):completed&&results.every(row=>row.import.status==="passed"&&row.probes.length>0&&row.probes.every(probe=>probe.status==="passed"));
  const sourceFiles=Object.fromEntries(readdirSync(import.meta.dirname).filter(file=>file.endsWith(".ts")).sort().map(file=>[file,sha256(readFileSync(join(import.meta.dirname,file)))]));
  const report={schemaVersion:1,recordedAt:new Date().toISOString(),tool:{name:"@mtek/asset-audit",version:"0.1.0-dev",sourceFiles},mode:check?"corpus-expectations":"asset-readiness",status:passed?"passed":"failed-or-incomplete",compiler:identity,compilerUnchanged,corpus:{file:corpusPath===undefined?null:basename(corpusPath),sha256:corpusBytes===null?null:sha256(corpusBytes),entries:corpus.entries},policy:{serial:true,compilerThreads:1,compilerTimeoutMs:10000,buildCompiler:false,externalResourceFetch:false,convertSources:false,gpuWork:false,limits:{fileBytes:67108864,jsonBytes:16777216,entries:64,probesPerEntry:128},scope:"declaration import plus only the explicitly requested mesh/material/clip checks"},results};
  writeFileSync(join(out,"report.json"),JSON.stringify(report,null,2)+"\n");writeFileSync(join(out,"report.md"),markdown(results,identity,{mode:report.mode,status:report.status,compilerUnchanged}));
  console.log(`${passed?"Passed":"Failed/incomplete"}: ${join(out,"report.md")}`);process.exitCode=passed?0:1;
}
