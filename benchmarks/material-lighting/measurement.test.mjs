import test from "node:test";
import assert from "node:assert/strict";
import {csvRecords,presentedData,schedule,jobKey,qualifyJob,coverageProblems,nativeConsistency} from "./measurement-data.mjs";
import {gpuBusy} from "./windows-monitor.mjs";

const lossLog="[ETW Status] EventsLost=0 BuffersLost=0, OverflowedPresents=0";
const header="ProcessID,SwapChainAddress,CPUStartQPC,DisplayLatency,DisplayTimeAbs,DisplayedTime,FrameId,PresentMode,VidPnSourceId,LayerIndex\n";
const csv=header+"123,0x1,55,5,10,10,1,Composed: Flip,0,0\n123,0x1,65,5,20,10,2,Composed: Flip,0,0\n123,0x1,75,5,30,10,3,Composed: Flip,0,0\n";
const parameters={pid:123,frequency:1000,qpcClock:{offsetMs:100,uncertaintyMs:.1},browserClock:{offsetMs:50,uncertaintyMs:.1},presentation:{captureWindow:{start:0,end:50},rafTimestamps:[0,1,2]},captureLog:lossLog};

function record(pass="cpu",implementation="mtek"){
  const zero=Object.fromEntries(["liveBuffers","liveTextures","liveSamplers","liveShaderModules","livePipelines","liveBindGroups","liveListeners"].map(k=>[k,0]));
  const job={scene:"product",quality:"low",pass,implementation,repeat:0};
  const gpu={milliseconds:.2,spanMilliseconds:.3,passes:[{kind:"render",milliseconds:.1},{kind:"render",milliseconds:.1}],encoders:1};
  return {job,status:"completed",pageErrors:[],setup:{...job,adapter:{vendor:"amd",description:"AMD Radeon RX 7900 XTX",isFallbackAdapter:false},crossOriginIsolated:true,minimumClockDelta:.005,unknownTextureFormats:[]},sample:{mode:pass,frames:3,renderedFrames:2,milliseconds:[.1,.2],gpu:[structuredClone(gpu),structuredClone(gpu)],info:{diagnostics:[]},counters:{frames:[0,1].map(()=>({delta:{renderPassesBegun:2,computePassesBegun:0,commandEncodersCreated:1},quadInstances:0}))}},disposed:{validation:[],losses:[],allDevicesDestroyed:true,result:{runtime:zero}},hostLoad:{valid:true,busyBeforePercent:1,busyDuringPercent:2,gpuBeforePercent:0,externalGpuPeakPercent:0}};
}
const qualified=r=>qualifyJob(r,{samples:2,warmup:1});

test("full schedule is balanced across 240 fresh passes and three repeats",()=>{
  const jobs=schedule();assert.equal(jobs.length,240);assert.equal(new Set(jobs.map(jobKey)).size,240);
  assert.equal(jobs.filter((_,i)=>i%2===0).filter(j=>j.implementation==="mtek").length,60);
  for(const repeat of [0,1,2])assert.equal(jobs.filter(j=>j.repeat===repeat).length,80);
});
test("CSV reads quoted commas/newlines and refuses malformed rows",()=>{
  assert.deepEqual(csvRecords('\uFEFFApplication,ProcessID\r\n"A,\nB",123\r\n'),[{Application:"A,\nB",ProcessID:"123"}]);
  assert.throws(()=>csvRecords('a,b\n1\n'));assert.throws(()=>csvRecords('a,b\n"unterminated'));
});
test("OS cadence comes from displayed timestamps, independently of RAF",()=>{
  const data=presentedData(csv,parameters);assert.deepEqual(data.intervalsMs,[10,10]);assert.equal(data.framesPerSecond,100);assert.equal(data.uniqueDisplayTimes,3);
});
test("RAF-only control cannot supply missing display evidence",()=>assert.throws(()=>presentedData("",parameters),/displayed stream/));
test("ambiguous swapchains, other processes, ETW loss and uncertain clocks reject cadence",()=>{
  assert.throws(()=>presentedData(csv+"123,0x2,55,5,10,10,1,Composed: Flip,0,0\n123,0x2,65,5,20,10,2,Composed: Flip,0,0\n",parameters),/ambiguous/);
  assert.throws(()=>presentedData(csv.replace("123,0x1","456,0x1"),parameters),/Unexpected process/);
  assert.throws(()=>presentedData(csv,{...parameters,captureLog:lossLog.replace("EventsLost=0","EventsLost=1")}),/lost/);
  assert.throws(()=>presentedData(csv,{...parameters,browserClock:{offsetMs:50,uncertaintyMs:1}}),/uncertain/);
});
test("complete quiet CPU data passes; missing samples, software and wrong identities fail",()=>{
  const r=record();assert.equal(qualified(r).qualified,true);
  r.sample.milliseconds.pop();assert.equal(qualified(r).qualified,false);
  const software=record();software.setup.adapter.description="SwiftShader";assert.equal(qualified(software).qualified,false);
  const swapped=record();swapped.setup.scene="particles";assert.equal(qualified(swapped).qualified,false);
});
test("busy or unavailable host observations cannot qualify timing",()=>{
  for(const patch of [{valid:false},{busyBeforePercent:90},{externalGpuPeakPercent:20},{gpuBeforePercent:NaN}]){
    const r=record();Object.assign(r.hostLoad,patch);assert.equal(qualified(r).qualified,false);
  }
});
test("GPU timestamps require observed work and every frame",()=>{
  const r=record("gpu");assert.equal(qualified(r).qualified,true);r.sample.gpu[0].milliseconds=0;assert.equal(qualified(r).qualified,false);
});
test("a missing shadow pass or untimed encoder cannot pass cross-instrument coverage",()=>{
  const jobs=schedule({scenes:["product"],qualities:["low"],passes:["gpu","counts"],repeats:1});
  const records=jobs.map(j=>{const r=record(j.pass,j.implementation);r.job=j;r.qualification=qualified(r);return r;});
  assert.deepEqual(coverageProblems(records,jobs),[]);
  records[0].sample.gpu[0].passes.pop();assert(coverageProblems(records,jobs).some(p=>p.includes("GPU coverage mismatch")));
  assert(coverageProblems(records.slice(1),jobs).some(p=>p.startsWith("Missing")));
});
test("native screenshots reject dropped colour channels and clipped viewports",()=>{
  const reference=Uint8Array.from({length:100*100*4},(_,i)=>i%4===3?255:100),changed=Uint8Array.from(reference,(v,i)=>i%4===0?0:v);
  assert(nativeConsistency(reference,reference,100,100).passed);assert(!nativeConsistency(changed,reference,100,100).passed);
  const r=record("presented");r.presentation={intervalsMs:[3,3]};r.nativeConsistency={passed:true};r.sample.presentation={visibility:"visible",focused:true,visibilityFailures:[],devicePixelRatio:1,canvas:{x:0,y:0,width:640,height:360},viewport:{width:625,height:360}};
  assert.equal(qualified(r).qualified,false);r.sample.presentation.viewport.width=640;assert.equal(qualified(r).qualified,true);
});
test("retained resources or an empty particle stream reject a fast pass",()=>{
  const r=record();r.disposed.result.runtime.liveBuffers=1;assert.equal(qualified(r).qualified,false);
  const particles=record("counts");particles.job.scene="particles";particles.setup.scene="particles";assert.equal(qualified(particles).qualified,false);
});
test("GPU host observation excludes only the measured process and refuses missing counters",()=>{
  const sample={counterRows:3,nonzero:[{name:"pid_10_luid_0x0_0x1_phys_0_eng_0_engtype_3D",percent:20},{name:"pid_11_luid_0x0_0x1_phys_0_eng_0_engtype_3D",percent:6},{name:"pid_12_luid_0x0_0x1_phys_0_eng_1_engtype_Copy",percent:5}]};
  assert.equal(gpuBusy(sample,[10]).externalEnginePeakPercent,6);assert.equal(gpuBusy(sample,[10]).allEnginePeakPercent,26);
  assert.throws(()=>gpuBusy({counterRows:0,nonzero:[]}));
});
