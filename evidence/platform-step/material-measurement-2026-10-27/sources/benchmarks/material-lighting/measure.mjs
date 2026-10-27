import assert from "node:assert/strict";
import {mkdir,readFile,appendFile,open,unlink,readdir,rename} from "node:fs/promises";
import {join,resolve} from "node:path";
import {createRequire} from "node:module";
import {randomUUID} from "node:crypto";
import {cpus,release,platform} from "node:os";
import {chromium} from "@playwright/test";
import {prepareMaterials} from "./prepare.mjs";
import {startServer} from "./server.mjs";
import {protocol} from "./scenes.mjs";
import {createWindowsMonitor,calibrateClock} from "./windows-monitor.mjs";
import {ensurePresentMon,startPresentMon} from "./presentmon.mjs";
import {waitForQuiet,observeHost} from "./host-observation.mjs";
import {schedule,jobKey,qualifyJob,presentedData,nativeConsistency,coverageProblems,groupMeasurements} from "./measurement-data.mjs";
import {sha256,readJson,writeJson,inside,sourceDefinition,validateBuild,validateSources,snapshotSources,copyVisualPrerequisite} from "./run-files.mjs";
import {browserChannel} from "../../tests/browser/support/launch-args.ts";
import {materialLaunchArgs} from "./launch.mjs";
import {analyze} from "./report.mjs";
const {PNG}=createRequire(import.meta.url)("playwright-core/lib/utilsBundle"),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function deadline(promise,ms,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} timed out`)),ms);})]);}finally{clearTimeout(timer);}}

function options(args){
  const result={output:resolve(args[0]??`target/material-measurement-${Date.now()}`),resume:false,preflight:false,visual:null};
  assert(!args[0]?.startsWith("--"),"Use measure.mjs <output-directory> [--preflight | --visual=<hardware.json>] [--resume]");
  for(const arg of args.slice(1)){if(arg==="--resume")result.resume=true;else if(arg==="--preflight")result.preflight=true;else if(arg.startsWith("--visual="))result.visual=resolve(arg.slice(9));else throw new Error(`Unknown argument ${arg}`);}
  assert(result.preflight||result.visual||result.resume,"A complete current hardware visual report is required");return result;
}
async function acquireLock(directory,resume){
  const path=join(directory,"run.lock"),token=randomUUID();
  try{const lock=await open(path,"wx");await lock.writeFile(JSON.stringify({pid:process.pid,token}));await lock.close();}
  catch(error){
    if(error.code!=="EEXIST"||!resume)throw error;const owner=await readJson(path);
    let live=true;try{process.kill(owner.pid,0);}catch(error){if(error.code==="ESRCH")live=false;else throw error;}
    assert(!live,`Run process ${String(owner.pid)} is still live; observe that process instead of restarting`);
    await rename(inside(directory,"run.lock"),inside(directory,`run.lock.stale-${randomUUID()}`));return acquireLock(directory,false);
  }
  return async()=>{const owner=await readJson(path);assert.equal(owner.token,token);await unlink(path);};
}
async function gpuProcess(browser){
  const cdp=await browser.newBrowserCDPSession();try{const info=await cdp.send("SystemInfo.getProcessInfo"),gpu=info.processInfo.filter(p=>p.type.toLowerCase()==="gpu");assert.equal(gpu.length,1,"Ambiguous browser GPU process");return {pid:gpu[0].id,processes:info.processInfo};}finally{await cdp.detach();}
}
async function scanAttempts(output){
  const records=[],root=join(output,"passes");let directories;try{directories=await readdir(root);}catch(error){if(error.code==="ENOENT")return records;throw error;}
  for(const job of directories)for(const attempt of await readdir(inside(root,job))){
    if(!/^attempt-\d+$/.test(attempt))continue;const path=`passes/${job}/${attempt}/record.json`;
    try{const record=await readJson(inside(output,path));assert.equal(jobKey(record.job),job);assert.equal(`attempt-${String(record.attempt)}`,attempt);records.push({...record,path});}catch(error){if(error.code!=="ENOENT")throw error;}
  }
  return records;
}
async function nextAttempt(output,job){
  let directories=[];try{directories=await readdir(join(output,"passes",jobKey(job)));}catch(error){if(error.code!=="ENOENT")throw error;}
  return 1+Math.max(0,...directories.map(n=>/^attempt-(\d+)$/.exec(n)).filter(Boolean).map(m=>Number(m[1])));
}
async function screenshotConsistency({page,browser,server,job,directory,visual,frame}){
  const image=await page.locator("canvas").screenshot({path:join(directory,"native.png")});let reference,referenceSource;
  const pair=visual?.report.cases.find(c=>c.name===job.scene&&c.quality===job.quality)?.implementations[job.implementation];
  const source=pair?.images.find(i=>i.frame===(job.scene==="particles"?frame:1));
  if(source){reference=await readFile(join(visual.directory,source.path));referenceSource={path:`prerequisites/${source.path}`,sha256:source.sha256};assert.equal(sha256(reference),source.sha256);}
  else{
    assert(!visual,"Visual report lacks the matching reference frame");
    const context=await browser.newContext(),offscreen=await context.newPage();
    try{await offscreen.goto(server.url);await offscreen.waitForFunction(()=>window.materialSuite);await offscreen.evaluate(job=>window.materialSuite.setup(job.implementation,job.scene,job.quality),job);await offscreen.evaluate(n=>window.materialSuite.advance(n),job.scene==="particles"?frame:1);const p=await offscreen.evaluate(()=>window.materialSuite.pixels());reference=PNG.sync.write({width:p.width,height:p.height,data:Buffer.from(p.data,"base64")});await offscreen.evaluate(()=>window.materialSuite.dispose());}
    finally{await context.close();}
    await (await import("node:fs/promises")).writeFile(join(directory,"offscreen.png"),reference);referenceSource={path:"offscreen.png",sha256:sha256(reference)};
  }
  const a=PNG.sync.read(image),b=PNG.sync.read(reference);assert.equal(a.width,b.width);assert.equal(a.height,b.height);
  return {path:"native.png",sha256:sha256(image),reference:referenceSource,...nativeConsistency(a.data,b.data,a.width,a.height)};
}

async function execute({job,attempt,directory,browser,headlessBrowser,monitor,tool,server,visual,samples,warmup}){
  await mkdir(directory,{recursive:true});const record={job,attempt,startedAt:new Date().toISOString(),status:"running",pageErrors:[]};let context,page,observer,capture;
  try{
    const profile=protocol.profiles[job.quality];context=await browser.newContext({viewport:job.pass==="presented"?{width:profile.width,height:profile.height}:{width:Math.max(900,profile.width),height:Math.max(600,profile.height)}});page=await context.newPage();
    page.on("pageerror",error=>record.pageErrors.push(error.message));await page.goto(server.url);await page.waitForFunction(()=>window.materialSuite);
    if(job.pass==="presented")await page.bringToFront();
    record.setup=await deadline(page.evaluate(job=>window.materialSuite.setup(job.implementation,job.scene,job.quality,job.pass),job),60000,"Renderer setup");
    record.warmup=await deadline(page.evaluate(n=>window.materialSuite.advance(n),warmup),60000,"Warmup");record.browserGpu=await gpuProcess(browser);
    const quiet=await waitForQuiet(monitor,[record.browserGpu.pid]);
    if(!quiet.quiet){record.status="interference";record.hostLoad=quiet;throw new Error("CPU/external GPU did not become quiet; pass retained without running known-unqualified work");}
    if(job.pass==="presented"){
      await page.evaluate(async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>requestAnimationFrame(resolve));});
      record.clocks={qpc:await calibrateClock(async()=>{const r=await monitor.request("clock");return r.qpc/monitor.metadata.frequency*1000;}),browser:await calibrateClock(()=>page.evaluate(()=>performance.now()))};
      const browserCdp=await browser.newBrowserCDPSession();try{const target=await page.context().newCDPSession(page);try{const info=await target.send("Target.getTargetInfo");const window=await browserCdp.send("Browser.getWindowForTarget",{targetId:info.targetInfo.targetId});record.nativeWindow=await browserCdp.send("Browser.getWindowBounds",{windowId:window.windowId});assert.equal(record.nativeWindow.bounds.windowState,"normal");}finally{await target.detach();}}finally{await browserCdp.detach();}
      capture=await startPresentMon(tool,record.browserGpu.pid,directory,`MtekMaterials-${process.pid}-${randomUUID().slice(0,8)}`);
    }
    observer=observeHost(monitor,[record.browserGpu.pid],quiet);
    record.sample=await deadline(page.evaluate(n=>window.materialSuite.samples(n),samples),120000,"Measurement");
    record.hostLoad=await observer.finish();observer=null;
    if(capture){
      record.etw=await capture.stop();capture=null;
      const csv=await readFile(join(directory,"presentmon.csv"),"utf8");
      record.presentation=presentedData(csv,{pid:record.browserGpu.pid,frequency:monitor.metadata.frequency,qpcClock:record.clocks.qpc,browserClock:record.clocks.browser,presentation:record.sample.presentation,captureLog:record.etw.stdout});
      record.clocks.after=await calibrateClock(()=>page.evaluate(()=>performance.now()));
      assert(Math.abs(record.clocks.after.offsetMs-record.clocks.browser.offsetMs)<=protocol.measurement.clockOffsetDriftLimitMs,"Presentation clock alignment drifted");
      const current=await gpuProcess(browser);assert.equal(current.pid,record.browserGpu.pid,"Browser GPU process changed during capture");
      record.nativeConsistency=await screenshotConsistency({page,browser:headlessBrowser,server,job,directory,visual,frame:samples+warmup});
    }
    record.disposed=await page.evaluate(()=>window.materialSuite.dispose());record.status="completed";
  }catch(error){record.error=String(error);if(record.status!=="interference")record.status="failed";}
  finally{
    if(observer)record.hostLoad=await observer.finish().catch(error=>({valid:false,error:String(error)}));
    if(capture)record.etw=await capture.stop().catch(error=>({error:String(error)}));
    if(page&&!record.disposed)try{record.disposed=await page.evaluate(()=>window.materialSuite.dispose());}catch(error){record.disposeError=String(error);}
    await context?.close();record.finishedAt=new Date().toISOString();record.qualification=qualifyJob(record,{samples,warmup});
  }
  record.artifacts=[];
  for(const name of await readdir(directory))if(/\.(png|csv|json)$/.test(name)){const bytes=await readFile(join(directory,name));record.artifacts.push({path:name,bytes:bytes.length,sha256:sha256(bytes)});}
  await writeJson(join(directory,"record.json"),record);return record;
}

async function main(){
  const config=options(process.argv.slice(2));await mkdir(config.output,{recursive:true});const unlock=await acquireLock(config.output,config.resume);
  let monitor,server,headlessBrowser,visibleBrowser,state;const runPath=join(config.output,"run.json"),journal=join(config.output,"attempts.jsonl");
  try{
    const definition=await sourceDefinition(),jobs=config.preflight?schedule({scenes:["product"],qualities:["low"],repeats:1}):schedule();
    const samples=config.preflight?16:protocol.measurement.samples,warmup=config.preflight?30:protocol.measurement.warmupFrames;
    let attempts=[],visual;
    if(config.resume){state=await readJson(runPath);assert.equal(state.definition.sha256,definition.sha256,"Measurement code changed since this run");assert.equal(state.preflight,config.preflight);attempts=await scanAttempts(config.output);await validateBuild(state.build,join(config.output,"site"));await validateSources(state.definition,state.build,config.output);}
    else{assert(!(await readdir(config.output)).includes("run.json"),"Run already exists; use --resume");const build=await prepareMaterials({siteDirectory:join(config.output,"site"),projectDirectory:join(config.output,"projects")});state={format:"mtek-material-measurement/1",startedAt:new Date().toISOString(),status:"running",preflight:config.preflight,performanceEligible:false,definition,protocol,samples,warmup,build,jobs,progress:{accepted:0,total:jobs.length}};}
    if(!config.resume)await snapshotSources(definition,state.build,config.output);
    if(!config.preflight){
      if(config.resume){const report=await readJson(join(config.output,"prerequisites/hardware.json"));visual={report,directory:join(config.output,"prerequisites")};}
      else{const copied=await copyVisualPrerequisite(config.visual,config.output,state.build);state.visual={path:copied.path,sha256:copied.sha256};visual={report:copied.report,directory:join(config.output,"prerequisites")};}
    }
    monitor=await createWindowsMonitor();const tool=await ensurePresentMon(monitor);state.osMonitor=monitor.metadata;state.presentMon=tool;
    const launch={channel:browserChannel(),args:materialLaunchArgs("hardware")};headlessBrowser=await chromium.launch({...launch,headless:true});
    const info=await headlessBrowser.newBrowserCDPSession();state.environment={node:process.version,os:{platform:platform(),release:release()},cpus:{model:cpus()[0].model,logical:cpus().length},browser:headlessBrowser.version(),launchArgs:launch.args,systemInfo:await info.send("SystemInfo.getInfo")};await info.detach();
    server=await startServer(join(config.output,"site"));await writeJson(runPath,state);
    for(const job of jobs){
      if(attempts.some(r=>jobKey(r.job)===jobKey(job)&&r.qualification?.qualified))continue;
      if(job.pass==="presented"&&!visibleBrowser)visibleBrowser=await chromium.launch({...launch,headless:false,args:[...launch.args,"--window-size=1500,1000"]});
      for(let retry=0;retry<(config.preflight?1:protocol.measurement.maxAttemptsPerInvocation);retry++){
        const attempt=await nextAttempt(config.output,job),directory=join(config.output,"passes",jobKey(job),`attempt-${String(attempt)}`);
        state.current={job,attempt,pid:process.pid};await writeJson(runPath,state);
        const record=await execute({job,attempt,directory,browser:job.pass==="presented"?visibleBrowser:headlessBrowser,headlessBrowser,monitor,tool,server,visual,samples,warmup,preflight:config.preflight});
        record.path=`passes/${jobKey(job)}/attempt-${String(attempt)}/record.json`;await appendFile(journal,JSON.stringify({job,attempt,path:record.path,status:record.status,qualification:record.qualification})+"\n");attempts.push(record);
        const accepted=attempts.filter(r=>r.qualification.qualified);state.progress={accepted:accepted.length,total:jobs.length,attempts:attempts.length};delete state.current;await writeJson(runPath,state);
        console.log(`[${String(accepted.length)}/${String(jobs.length)}] ${jobKey(job)} attempt ${String(attempt)}: ${record.qualification.qualified?"accepted":record.qualification.errors.join("; ")}${record.error?` (${record.error})`:""}`);
        if(record.qualification.qualified||record.status==="failed")break;
        await sleep(1000);
      }
    }
    const accepted=attempts.filter(r=>r.qualification.qualified),problems=coverageProblems(accepted,jobs),current=await sourceDefinition();
    if(current.sha256!==state.definition.sha256)problems.push("Measurement sources changed during this run");
    state.status=problems.length?"incomplete":config.preflight?"preflight-passed":"completed";state.performanceEligible=!config.preflight&&problems.length===0;state.problems=problems;state.groups=groupMeasurements(accepted);state.finishedAt=new Date().toISOString();
    await writeJson(runPath,state);
    const report=await analyze(config.output);await writeJson(join(config.output,"report.json"),report);
    if(!report.performanceEligible&&!config.preflight){state.performanceEligible=false;state.status="incomplete";state.problems=report.problems;await writeJson(runPath,state);}
    console.log(JSON.stringify({status:state.status,performanceEligible:state.performanceEligible,progress:state.progress,problems:report.problems}));if(report.problems.length)process.exitCode=1;
  }catch(error){if(state){state.status="failed";state.failure=String(error);await writeJson(runPath,state);}throw error;}
  finally{await visibleBrowser?.close();await headlessBrowser?.close();await monitor?.close();await server?.close();await unlock();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
