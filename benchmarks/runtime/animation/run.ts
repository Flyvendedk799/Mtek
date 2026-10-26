import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {chromium} from "@playwright/test";
import {startStaticServer} from "../../../tests/browser/support/serve.ts";
import {hardwareLaunchArgs,browserChannel} from "../../../tests/browser/support/launch-args.ts";
import {sanitizeReport} from "../../../tests/browser/support/sanitize-report.ts";
import {buildEnvironmentRecord} from "../../../tests/browser/support/environment.ts";
import type {PageEnvironment} from "../../../tests/browser/support/environment-types.ts";
import {assessAdapter} from "../tools/adapter.ts";
import {withGpuLock} from "../tools/gpu-lock.ts";
import {busyPercent,readCpuTimes,waitForQuiet} from "../tools/host-load.ts";
import {summarize} from "../harness/stats.ts";
import {encodePng} from "../tools/png.ts";
import {site,root,verifyPrepared} from "./prepare.ts";
import {edgeCameraOffset,models,settings,type Engine} from "./layout.ts";
import type {Request,Pass} from "./page.ts";
import {checkFreeze,definitionHash} from "./freeze.ts";
import {waitForCleanWindow} from "./load-policy.ts";
import protocol from "./protocol.json" with {type:"json"};

interface Result {rows?:Array<{phase:number;joints:number[];pixels:number[]}>;samples?:number[];compute?:number[];render?:number[];errors?:string[];[key:string]:unknown}
interface PageApi {run(request:Request):Promise<Result>;environment():Promise<PageEnvironment>;ready:boolean}
function idleGpuLoad():{status:"measured";engineUtilizationSumPercent:number}|{status:"unavailable"}{
  if(process.platform!=="win32")return {status:"unavailable"};
  const probe=spawnSync("powershell.exe",["-NoProfile","-NonInteractive","-Command","Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop | Measure-Object UtilizationPercentage -Sum | Select-Object -ExpandProperty Sum | ConvertTo-Json -Compress"],{encoding:"utf8",windowsHide:true,timeout:15000});
  if(probe.status!==0)return {status:"unavailable"};
  try{const value:unknown=JSON.parse(probe.stdout.trim());return typeof value==="number"&&Number.isFinite(value)?{status:"measured",engineUtilizationSumPercent:value}:{status:"unavailable"};}catch{return {status:"unavailable"};}
}
export function parity(a:NonNullable<Result["rows"]>,b:NonNullable<Result["rows"]>):Record<string,unknown>{
  if(a.length!==b.length)throw new Error("Parity phase count differs");
  let jointError=0,badPixels=0,maximumChannelError=0,pixels=0,maximumPhaseDifferingPixelFraction=0,maximumForegroundDifferingPixelFraction=0;
  const phases=[];
  for(let p=0;p<a.length;p++){
    const left=a[p]!,right=b[p]!;if(left.joints.length!==right.joints.length)throw new Error("Parity joint count differs");
    if(left.joints.length===0||left.joints.length%3!==0)throw new Error("Missing or malformed joint oracle");
    for(let i=0;i<left.joints.length;i+=3)jointError=Math.max(jointError,Math.hypot(left.joints[i]!-right.joints[i]!,left.joints[i+1]!-right.joints[i+1]!,left.joints[i+2]!-right.joints[i+2]!));
    if(left.pixels.length!==right.pixels.length)throw new Error("Parity image sizes differ");
    let bad=0,foreground=0,rightForeground=0,foregroundUnion=0;
    for(let i=0;i<left.pixels.length;i+=4){
      let error=0;for(let c=0;c<4;c++)error=Math.max(error,Math.abs(left.pixels[i+c]!-right.pixels[i+c]!));maximumChannelError=Math.max(maximumChannelError,error);if(error>protocol.pixelChannelTolerance)bad++;
      const a=left.pixels[i]!==16||left.pixels[i+1]!==24||left.pixels[i+2]!==32,b=right.pixels[i]!==16||right.pixels[i+1]!==24||right.pixels[i+2]!==32;
      if(a)foreground++;if(b)rightForeground++;if(a||b)foregroundUnion++;
    }
    if(foreground<30||rightForeground<30)throw new Error("Parity picture contains no visible character");
    badPixels+=bad;pixels+=left.pixels.length/4;phases.push({phase:left.phase,badPixels:bad,foreground,rightForeground,foregroundUnion});
    maximumPhaseDifferingPixelFraction=Math.max(maximumPhaseDifferingPixelFraction,bad/(left.pixels.length/4));
    maximumForegroundDifferingPixelFraction=Math.max(maximumForegroundDifferingPixelFraction,bad/foregroundUnion);
  }
  const differingPixelFraction=badPixels/pixels;
  return {passed:jointError<=protocol.jointToleranceMetres&&maximumPhaseDifferingPixelFraction<=protocol.maximumDifferingPixelFraction&&maximumForegroundDifferingPixelFraction<=protocol.maximumForegroundDifferingPixelFraction,jointError,maximumChannelError,differingPixelFraction,maximumPhaseDifferingPixelFraction,maximumForegroundDifferingPixelFraction,phases};
}
export async function run():Promise<void>{
  const smoke=process.argv.includes("--smoke"),stamp=new Date().toISOString().replaceAll(":","-");
  const outputArg=process.argv.find(arg=>arg.startsWith("--out="))?.slice(6);
  const out=resolve(outputArg??join(root,smoke?"benchmarks/runtime/.out/animation/runs":"evidence/platform-step/matched-animation",stamp));mkdirSync(out,{recursive:true});
  if(!smoke)checkFreeze();
  verifyPrepared();
  const server=await startStaticServer(site,0,{"Cross-Origin-Opener-Policy":"same-origin","Cross-Origin-Embedder-Policy":"require-corp"});
  const args=[...hardwareLaunchArgs(),"--disable-renderer-backgrounding","--disable-background-timer-throttling","--disable-backgrounding-occluded-windows"];
  const browser=await chromium.launch({channel:browserChannel(),headless:true,args});
  const meta={format:"mtek-matched-animation/1",smoke,protocol,definitions:definitionHash(),startedAt:new Date().toISOString(),status:"running",completed:0};
  const save=(name:string,value:unknown)=>writeFileSync(join(out,name),JSON.stringify(sanitizeReport(value,{resultsDir:out}),null,2)+"\n");save("run.json",meta);
  save("build-inputs.json",{prepared:JSON.parse(readFileSync(join(site,"PREPARED.json"),"utf8")) as unknown,inventory:JSON.parse(readFileSync(join(site,"inventory.json"),"utf8")) as unknown,compatibility:JSON.parse(readFileSync(join(site,"compatibility.json"),"utf8")) as unknown,runtimeProvenance:JSON.parse(readFileSync(join(root,"crates/mtek-cli/prebuilt/PROVENANCE.json"),"utf8")) as unknown,packageLockSha256:createHash("sha256").update(readFileSync(join(root,"package-lock.json"))).digest("hex"),compilerSha256:createHash("sha256").update(readFileSync(join(root,"target/debug",process.platform==="win32"?"mtek.exe":"mtek"))).digest("hex")});
  try{
    const context=await browser.newContext(),probe=await context.newPage();await probe.goto(server.url);await probe.waitForFunction(()=>"__animationBench" in window);
    const pageEnvironment=await probe.evaluate(()=>(window as unknown as {__animationBench:PageApi}).__animationBench.environment());
    const environment=buildEnvironmentRecord("matched-animation",pageEnvironment,{name:browser.browserType().name(),channel:browserChannel(),version:browser.version(),headless:true,launchArgs:args});
    save("environment.json",environment);await context.close();
    const verdict=assessAdapter(environment);if(verdict.status!=="hardware")throw new Error(verdict.reason);
    const gpuBefore=idleGpuLoad();save("idle-gpu-before.json",gpuBefore);
    if(!smoke&&gpuBefore.status==="measured"&&gpuBefore.engineUtilizationSumPercent>15)throw new Error("GPU stayed busy before measurement; park other animated applications first");
    const selectedModel=process.argv.find(arg=>arg.startsWith("--model="))?.slice(8);
    const selectedModels=selectedModel===undefined?models:models.filter(model=>model===selectedModel);
    if(selectedModels.length===0||(!smoke&&selectedModel!==undefined))throw new Error("Model subsets are only supported for valid smoke runs");
    const passes:Pass[]=["cpu","gpu","counts","memory","cadence"];
    const execute=async(request:Request,label:string):Promise<Result>=>{
      for(let attempt=0;;attempt++){
      console.log(`Starting ${label}`);
      let quiet=smoke?await waitForQuiet(30,10000):await waitForCleanWindow(()=>console.log(`Waiting for CPU load below 30% before ${label}; no measurements are being collected`));
      const outcome=await withGpuLock(async lock=>{
      if(!smoke&&lock.waitedMs>1000){const recheck=await waitForQuiet(30,10000);quiet={...recheck,waitedForQuietMs:quiet.waitedForQuietMs+recheck.waitedForQuietMs};if(quiet.noisy)return null;}
      const start=readCpuTimes(),context=await browser.newContext(),page=await context.newPage();
      page.setDefaultTimeout(120000);const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
      try{
        await page.goto(`${server.url}/index-${request.engine}.html`);await page.waitForFunction(()=>"__animationBench" in window);
        const cdp=await context.newCDPSession(page);
        let heapWhileLive:unknown=null;
        if(request.pass==="memory")await page.exposeFunction("__animationMemoryGate",async()=>{await cdp.send("HeapProfiler.collectGarbage");heapWhileLive=await cdp.send("Runtime.getHeapUsage");});
        if(request.pass==="memory")await cdp.send("HeapProfiler.collectGarbage");
        const heapBefore=request.pass==="memory"?await cdp.send("Runtime.getHeapUsage"):null;
        let deadline:ReturnType<typeof setTimeout>|undefined;
        const result=await Promise.race([page.evaluate(request=>(window as unknown as {__animationBench:PageApi}).__animationBench.run(request),request),new Promise<never>((_resolve,reject)=>{deadline=setTimeout(()=>reject(new Error(`Pass timed out: ${label}`)),180000);})]).finally(()=>clearTimeout(deadline));
        if(request.pass==="memory")await cdp.send("HeapProfiler.collectGarbage");
        const heapAfter=request.pass==="memory"?await cdp.send("Runtime.getHeapUsage"):null;
        const disposed=await page.evaluate(()=>(window as unknown as {__animationDisposed?:unknown}).__animationDisposed??null);
        if(errors.length>0||result.errors?.length)throw new Error(JSON.stringify({errors,gpu:result.errors}));
        const busyDuringPercent=busyPercent(start,readCpuTimes());
        const record={request,result,disposed,heapBefore,heapWhileLive,heapAfter,hostLoad:{...quiet,busyDuringPercent},lock,errors};
        const rejected=!smoke&&busyDuringPercent>50;
        save(rejected?`${label}-rejected-${attempt}.json`:label+".json",{...(result.rows===undefined?record:{...record,result:{...result,rows:result.rows.map(({pixels,...row})=>({...row,pixelCount:pixels.length/4}))}}),attempt,accepted:!rejected});
        if(rejected){console.log(`Rejected noisy ${label}; preserving attempt ${attempt} and retrying after the host is quiet`);return null;}
        meta.completed++;save("run.json",meta);return result;
      }finally{await context.close();}
      });
      if(outcome!==null)return outcome;
      }
    };
    for(const model of selectedModels)for(const count of protocol.actors){
      const left=await execute({model,count,engine:"mtek",pass:"parity",smoke},`${model}-${count}-mtek-parity`);
      const right=await execute({model,count,engine:"three",pass:"parity",smoke},`${model}-${count}-three-parity`);
      for(const result of [left,right])if(result.rows!.some(row=>row.joints.length!==count*settings[model].joints*3))throw new Error("Parity did not include every actor and joint");
      const gate=parity(left.rows!,right.rows!);save(`${model}-${count}-parity.json`,gate);
      for(const [engine,result] of [["mtek",left],["three",right]] as const)for(const row of result.rows!){writeFileSync(join(out,`${model}-${count}-${engine}-${row.phase}.png`),encodePng(protocol.width,protocol.height,Uint8Array.from(row.pixels)));}
      console.log(`${model} × ${count}: parity ${JSON.stringify(gate)}`);
      if(gate["passed"]!==true)throw new Error(`Matched parity failed for ${model} × ${count}; timings refused`);
      const cameraOffset=edgeCameraOffset(count);
      const edge=await execute({model,count,engine:"mtek",pass:"parity",smoke,culling:true,cameraOffset},`${model}-${count}-mtek-edge-culling`);
      const unculled=await execute({model,count,engine:"mtek",pass:"parity",smoke,culling:false,cameraOffset},`${model}-${count}-mtek-edge-unculled`);
      const edgeThree=await execute({model,count,engine:"three",pass:"parity",smoke,cameraOffset},`${model}-${count}-three-edge`);
      const culling={cameraOffset,culledVersusUnculled:parity(edge.rows!,unculled.rows!),culledVersusThree:parity(edge.rows!,edgeThree.rows!),info:edge.info};
      save(`${model}-${count}-culling.json`,culling);
      if(culling.culledVersusUnculled["passed"]!==true||culling.culledVersusThree["passed"]!==true)throw new Error(`Animated edge-culling parity failed for ${model} × ${count}`);
      for(let iteration=0;iteration<(smoke?1:protocol.runs);iteration++)for(const pass of passes){
        const engines:Engine[]=(iteration+passes.indexOf(pass)+protocol.actors.indexOf(count)+models.indexOf(model))%2===0?["mtek","three"]:["three","mtek"];
        for(const engine of engines){
          const label=`${model}-${count}-${engine}-${pass}-${iteration}`,result=await execute({model,count,engine,pass,smoke},label);
          console.log(label,result.samples?.length?JSON.stringify(summarize(result.samples)):"recorded");
        }
      }
    }
    const gpuAfter=idleGpuLoad();save("idle-gpu-after.json",gpuAfter);
    if(!smoke&&gpuAfter.status==="measured"&&gpuAfter.engineUtilizationSumPercent>15)throw new Error("GPU was still busy after measurement; run remains unpublishable");
    if(!smoke)checkFreeze();verifyPrepared();meta.status="passed";save("run.json",meta);console.log(`Completed ${meta.completed} passes; ${out}`);
  }catch(error){meta.status="failed";save("run.json",{...meta,error:error instanceof Error?error.message:String(error)});throw error;}
  finally{await browser.close();await server.close();}
}
if(process.argv[1]!==undefined&&resolve(process.argv[1])===join(import.meta.dirname,"run.ts"))await run();
