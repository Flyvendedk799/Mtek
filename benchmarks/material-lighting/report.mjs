import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import {join,resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {isDeepStrictEqual} from "node:util";
import {schedule,jobKey,qualifyJob,coverageProblems,groupMeasurements,presentedData,nativeConsistency} from "./measurement-data.mjs";
import {sha256,readJson,writeJson,inside,validateBuild,validateSources} from "./run-files.mjs";
import {protocol} from "./scenes.mjs";
import {busyPercent} from "../runtime/tools/host-load.ts";
import {gpuBusy} from "./windows-monitor.mjs";
const {PNG}=createRequire(import.meta.url)("playwright-core/lib/utilsBundle");

export function recheckHost(record){
  const load=record.hostLoad;assert(load?.valid,"Missing host observations");
  const before=load.observations?.at(-1);assert(before&&load.gpuSamples?.length>0,"Missing raw host observations");
  assert(before.cpuAfter.total>before.cpuBefore.total);assert.equal(before.cpu,busyPercent(before.cpuBefore,before.cpuAfter));
  assert.equal(load.busyBeforePercent,before.cpu);assert.equal(load.gpuBeforePercent,gpuBusy(before.rawGpu,[record.browserGpu.pid]).externalEnginePeakPercent);
  assert(load.cpuAfter.total>load.cpuBefore.total);assert.equal(load.busyDuringPercent,busyPercent(load.cpuBefore,load.cpuAfter));
  assert.equal(load.externalGpuPeakPercent,Math.max(...load.gpuSamples.map(s=>gpuBusy(s.raw,[record.browserGpu.pid]).externalEnginePeakPercent)));
}

export async function analyze(directory){
  directory=resolve(directory);const state=await readJson(join(directory,"run.json")),problems=[],accepted=[],attempts=[];
  const check=async(label,fn)=>{try{await fn();}catch(error){problems.push(`${label}: ${String(error)}`);}};
  await check("Protocol",()=>assert.deepEqual(state.protocol,protocol));
  await check("Source snapshots",()=>validateSources(state.definition,state.build,directory));
  await check("Compiled packages",()=>validateBuild(state.build,join(directory,"site")));
  const jobs=state.preflight?schedule({scenes:["product"],qualities:["low"],repeats:1}):schedule();
  await check("Schedule",()=>assert.deepEqual(state.jobs,jobs));
  await check("Sample policy",()=>{assert.equal(state.samples,state.preflight?16:protocol.measurement.samples);assert.equal(state.warmup,state.preflight?30:protocol.measurement.warmupFrames);});
  let visual;
  if(!state.preflight)await check("Visual prerequisite",async()=>{
    const path=inside(directory,state.visual.path),bytes=await readFile(path);assert.equal(sha256(bytes),state.visual.sha256);visual=JSON.parse(bytes);
    assert.equal(visual.backend,"hardware");assert.equal(visual.status,"passed");assert.equal(visual.completeMatrix,true);assert.equal(visual.visualPrerequisitesPassed,true);
    assert.equal(visual.cases.length,10);assert(visual.cases.every(c=>c.status==="passed"));
    assert.equal(visual.build.mode,"release");assert.equal(visual.build.protocolSha256,state.build.protocolSha256);assert.equal(visual.build.content.sha256,state.build.content.sha256);assert.equal(visual.build.product.sha256,state.build.product.sha256);
    assert.deepEqual(visual.build.harness,state.build.harness);assert.deepEqual(visual.build.cases,state.build.cases);
    for(const c of visual.cases)for(const engine of Object.values(c.implementations))for(const image of [...engine.images,...(engine.control?[engine.control.image]:[])])assert.equal(sha256(await readFile(inside(dirname(path),image.path))),image.sha256);
  });
  const root=join(directory,"passes");
  for(const name of await readdir(root))for(const attempt of await readdir(inside(root,name))){
    if(!/^attempt-\d+$/.test(attempt))continue;const path=`passes/${name}/${attempt}/record.json`;let r;
    try{r=await readJson(inside(directory,path));}catch(error){if(error.code==="ENOENT"){attempts.push({path,status:"interrupted"});continue;}throw error;}
    const identity={path,sha256:sha256(await readFile(inside(directory,path))),status:r.status,job:r.job,attempt:r.attempt};attempts.push(identity);
    if(!r.qualification?.qualified)continue;
    const errors=[];try{
      assert.equal(jobKey(r.job),name);assert.equal(`attempt-${String(r.attempt)}`,attempt);
      for(const artifact of r.artifacts){const b=await readFile(inside(dirname(inside(directory,path)),artifact.path));assert.equal(b.length,artifact.bytes);assert.equal(sha256(b),artifact.sha256);}
      recheckHost(r);
      if(r.job.pass==="presented"){
        assert(r.artifacts.some(f=>f.path==="presentmon.csv")&&r.artifacts.some(f=>f.path==="native.png"));
        const folder=dirname(inside(directory,path)),csv=await readFile(join(folder,"presentmon.csv"),"utf8");
        const data=presentedData(csv,{pid:r.browserGpu.pid,frequency:state.osMonitor.frequency,qpcClock:r.clocks.qpc,browserClock:r.clocks.browser,presentation:r.sample.presentation,captureLog:r.etw.stdout});
        assert.deepEqual(data,r.presentation);assert.equal(r.etw.code,0);assert.equal(r.etw.stop.code,0);
        assert.deepEqual(await readJson(join(folder,"presentmon-process.json")),r.etw);
        assert(Math.abs(r.clocks.after.offsetMs-r.clocks.browser.offsetMs)<=protocol.measurement.clockOffsetDriftLimitMs);
        assert.equal(r.nativeWindow.bounds.windowState,"normal");
        const source=r.nativeConsistency.reference;
        if(visual){const c=visual.cases.find(c=>c.name===r.job.scene&&c.quality===r.job.quality),expected=c.implementations[r.job.implementation].images.find(i=>i.frame===(r.job.scene==="particles"?state.samples+state.warmup:1));assert.equal(source.path,`prerequisites/${expected.path}`);assert.equal(source.sha256,expected.sha256);}
        const ref=await readFile(inside(source.path.startsWith("prerequisites/")?directory:folder,source.path));assert.equal(sha256(ref),source.sha256);
        const a=PNG.sync.read(await readFile(join(folder,"native.png"))),b=PNG.sync.read(ref);assert.equal(a.width,b.width);assert.equal(a.height,b.height);
        const comparison=nativeConsistency(a.data,b.data,a.width,a.height);for(const [key,value]of Object.entries(comparison))assert.equal(r.nativeConsistency[key],value);
      }
      const qualification=qualifyJob(r,{samples:state.samples,warmup:state.warmup});assert.deepEqual(qualification,r.qualification);assert(qualification.qualified);
    }catch(error){errors.push(String(error));}
    identity.verified=errors.length===0;if(errors.length){identity.errors=errors;problems.push(`${name}/${attempt}: ${errors.join("; ")}`);}else accepted.push(r);
  }
  problems.push(...coverageProblems(accepted,jobs));
  const complete=problems.length===0;
  return {format:"mtek-material-measurement-report/1",performanceEligible:complete&&!state.preflight,status:complete?(state.preflight?"preflight-passed":"passed"):"incomplete",preflight:state.preflight,runSha256:sha256(await readFile(join(directory,"run.json"))),definition:state.definition.sha256,protocol:state.build.protocolSha256,environment:state.environment,workload:{content:state.build.content.sha256,product:state.build.product.sha256,reference:state.build.referenceVersion},counts:{accepted:accepted.length,total:jobs.length,attempts:attempts.length},problems,attempts,groups:groupMeasurements(accepted)};
}

/** Compare only complete reports from the same protocol, source definition,
 * original assets, reference version, browser, CPU and physical GPU/driver. */
export function regressions(baseline,candidate){
  assert(baseline.performanceEligible&&candidate.performanceEligible,"Only complete qualified reports can establish or compare budgets");
  for(const key of ["definition","protocol","workload"])assert(isDeepStrictEqual(baseline[key],candidate[key]),`Incompatible ${key}`);
  const environment=e=>({os:e.os,cpus:e.cpus,browser:e.browser,launchArgs:e.launchArgs,devices:e.systemInfo.gpu.devices});
  assert.deepEqual(environment(baseline.environment),environment(candidate.environment),"Physical/browser environment changed");
  const rules=protocol.measurement.regressions,failures=[],comparisons=[];
  assert.equal(candidate.groups.length,20);assert.equal(baseline.groups.length,20);
  for(const c of candidate.groups){const b=baseline.groups.find(b=>b.scene===c.scene&&b.quality===c.quality&&b.implementation===c.implementation);assert(b,"Missing baseline workload");
    for(const metric of ["cpuP95","gpuP95","gpuSpanP95","cadenceP95","bufferBytes","textureBytes","drawsP95","uploadBytesP95"]){
      const before=b.medians[metric],after=c.medians[metric];assert(Number.isFinite(before)&&before>=0&&Number.isFinite(after)&&after>=0,"Incomplete group statistics");
      const cadence=metric==="cadenceP95",timing=metric.endsWith("P95")&&!["drawsP95","uploadBytesP95"].includes(metric),memory=metric.endsWith("Bytes");
      const relative=timing?(cadence?rules.cadenceRelativeIncreasePercent:rules.cpuGpuRelativeIncreasePercent):memory?rules.descriptorBytesRelativeIncreasePercent:rules.drawUploadIncreasePercent,absolute=timing?(cadence?rules.cadenceAbsoluteIncreaseMs:rules.cpuGpuAbsoluteIncreaseMs):0;
      const failed=after>before*(1+relative/100)&&after-before>absolute,comparison={scene:c.scene,quality:c.quality,implementation:c.implementation,metric,before,after,relativeLimitPercent:relative,absoluteLimit:absolute,failed};comparisons.push(comparison);if(failed)failures.push(comparison);
    }
  }
  return {status:failures.length?"regressed":"passed",failures,comparisons};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const directory=resolve(process.argv[2]??""),baselineArg=process.argv[3];
  assert(process.argv[2]&&!process.argv[2].startsWith("--"),"Use report.mjs <run-directory> [--baseline=<qualified-run-directory>]");
  assert(!baselineArg||baselineArg.startsWith("--baseline="));
  const report=await analyze(directory);
  if(baselineArg)report.regressions=regressions(await analyze(resolve(baselineArg.slice(11))),report);
  await writeJson(join(directory,"report.json"),report);
  console.log(JSON.stringify({status:report.status,performanceEligible:report.performanceEligible,counts:report.counts,problems:report.problems,regressions:report.regressions?.status}));
  if(report.status==="incomplete"||report.regressions?.status==="regressed")process.exitCode=1;
}
