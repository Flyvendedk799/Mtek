import assert from "node:assert/strict";
import {summarize,median} from "../runtime/harness/stats.ts";
import {protocol,describeScene} from "./scenes.mjs";
import {ReferenceParticles} from "./particles.mjs";

/** RFC 4180 quoting, including commas/newlines in an application field. */
export function csvRecords(text){
  text=text.replace(/^\uFEFF/,"");const rows=[];let row=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else quoted=false;}else cell+=c;}
    else if(c==='"'){assert.equal(cell,"");quoted=true;}
    else if(c===","){row.push(cell);cell="";}
    else if(c==="\n"||c==="\r"){if(c==="\r"&&text[i+1]==="\n")i++;row.push(cell);if(row.some(v=>v!==""))rows.push(row);row=[];cell="";}
    else cell+=c;
  }
  assert(!quoted,"Unterminated CSV quote");if(cell!==""||row.length){row.push(cell);rows.push(row);}
  if(!rows.length)return [];
  const headers=rows.shift();assert.equal(new Set(headers).size,headers.length,"Duplicate CSV column");assert(headers.every(Boolean));
  return rows.map(values=>{assert.equal(values.length,headers.length,"Malformed CSV row");return Object.fromEntries(headers.map((key,i)=>[key,values[i]]));});
}

/** ETW displayed timestamps, not RAF intervals. QPC conversion bounds the sample
 * window; cadence uses the native DisplayTimeAbs values within one swapchain. */
export function presentedData(csv,{pid,frequency,qpcClock,browserClock,presentation,captureLog}){
  const statuses=[...captureLog.matchAll(/EventsLost=(\d+) BuffersLost=(\d+), OverflowedPresents=(\d+)/g)];
  assert(statuses.length>0,"No ETW loss-status observation");assert(statuses.every(m=>m.slice(1).every(v=>Number(v)===0)),"ETW capture lost events or presents");
  const limit=protocol.measurement.clockUncertaintyLimitMs;
  assert(qpcClock.uncertaintyMs<=limit&&browserClock.uncertaintyMs<=limit,"Presentation clock alignment is too uncertain");
  const qpcAt=t=>(t-browserClock.offsetMs+qpcClock.offsetMs)*frequency/1000;
  const window={start:qpcAt(presentation.captureWindow.start),end:qpcAt(presentation.captureWindow.end)};
  assert(window.end>window.start&&Number.isFinite(window.start)&&Number.isFinite(window.end));
  const records=csvRecords(csv),chains=new Map();let notDisplayedRows=0;
  for(const row of records){
    assert.equal(Number(row.ProcessID),pid,"Unexpected process in presentation capture");
    const start=Number(row.CPUStartQPC);assert(Number.isSafeInteger(start)&&start>0,"Invalid QPC value");
    if(row.DisplayTimeAbs==="NA"||row.DisplayedTime==="NA"){
      if(start>=window.start&&start<=window.end)notDisplayedRows++;continue;
    }
    const latency=Number(row.DisplayLatency),displayMs=Number(row.DisplayTimeAbs),duration=Number(row.DisplayedTime);
    assert([latency,displayMs,duration].every(Number.isFinite)&&latency>=0&&duration>=0,"Invalid ETW display data");
    const displayQpc=start+latency*frequency/1000;if(displayQpc<window.start||displayQpc>window.end)continue;
    const key=row.SwapChainAddress;assert(key&&row.PresentMode&&row.PresentMode!=="Unknown","Unattributed displayed frame");
    if(!chains.has(key))chains.set(key,[]);chains.get(key).push({displayMs,displayQpc,durationMs:duration,frameId:row.FrameId,presentMode:row.PresentMode,source:row.VidPnSourceId,layer:row.LayerIndex});
  }
  const cohorts=[...chains].map(([address,rows])=>({address,rows})),active=cohorts.filter(c=>c.rows.length>=2);
  assert.equal(active.length,1,"No displayed stream or ambiguous browser swapchains");
  const selected=active[0],times=[...new Set(selected.rows.map(r=>r.displayMs))].sort((a,b)=>a-b),intervals=times.slice(1).map((t,i)=>t-times[i]);
  assert(intervals.length>0&&intervals.every(v=>v>0&&Number.isFinite(v)));
  return {source:"PresentMon 2.6.0 ETW",windowQpc:window,processId:pid,swapchain:selected.address,rawRows:records.length,displayedRows:selected.rows.length,uniqueDisplayTimes:times.length,notDisplayedOsRows:notDisplayedRows,cohorts:cohorts.map(c=>({address:c.address,rows:c.rows.length})),timestampsMs:times,intervalsMs:intervals,cadence:summarize(intervals),framesPerSecond:1000/((times.at(-1)-times[0])/(times.length-1)),modes:[...new Set(selected.rows.map(r=>r.presentMode))],boundaries:"OS display events of the isolated browser; no per-JavaScript-frame latency or physical pixel scanout measurement is inferred"};
}

export const jobKey=job=>`${job.scene}-${job.quality}-${job.pass}-${job.implementation}-r${String(job.repeat)}`;
export function schedule({scenes=protocol.scenes,qualities=Object.keys(protocol.profiles),passes=protocol.measurement.passes,repeats=protocol.measurement.repeats}={}){
  const jobs=[],cases=scenes.flatMap(scene=>qualities.map(quality=>({scene,quality})));
  for(let repeat=0;repeat<repeats;repeat++){
    const rotated=cases.slice(repeat%cases.length).concat(cases.slice(0,repeat%cases.length));
    for(const [index,definition] of rotated.entries())for(let p=0;p<passes.length;p++){
      const pass=passes[(p+repeat)%passes.length],implementations=(index+repeat+p)%2===0?["mtek","three"]:["three","mtek"];
      for(const implementation of implementations)jobs.push({...definition,pass,implementation,repeat});
    }
  }
  return jobs;
}

export function qualifyJob(record,{samples=protocol.measurement.samples,warmup=protocol.measurement.warmupFrames}={}){
  const errors=[],check=(ok,message)=>{if(!ok)errors.push(message);};
  check(record.status==="completed","Measurement did not complete");
  if(!record.setup||!record.sample||!record.disposed)return {qualified:false,errors:[...errors,"Missing setup, samples or disposal"]};
  const {setup,sample,disposed}=record;
  check(setup.implementation===record.job.implementation&&setup.scene===record.job.scene&&setup.quality===record.job.quality&&setup.pass===record.job.pass&&sample.mode===record.job.pass,"Pass identity differs from setup");
  check(setup.adapter?.isFallbackAdapter===false&&setup.adapter.vendor&&setup.adapter.description&&!/swiftshader|llvmpipe|software|basic render/i.test(setup.adapter.description),"Hardware adapter required");check(setup.crossOriginIsolated===true,"Isolated high-resolution clock unavailable");
  check(Number.isFinite(setup.minimumClockDelta)&&setup.minimumClockDelta>0&&setup.minimumClockDelta<=0.02,"CPU clock resolution unavailable or too coarse");
  check(record.pageErrors?.length===0,"Browser errors");check(disposed.validation?.length===0&&disposed.losses?.length===0&&disposed.allDevicesDestroyed===true,"GPU validation/lifetime failure");
  check(sample.info?.diagnostics?.length===0||record.job.implementation!=="mtek","Runtime diagnostics");
  if(record.job.implementation==="mtek")for(const key of ["liveBuffers","liveTextures","liveSamplers","liveShaderModules","livePipelines","liveBindGroups","liveListeners"])check(disposed.result?.runtime?.[key]===0,`Retained ${key}`);
  check(sample.renderedFrames===samples&&sample.frames===samples+warmup,"Incomplete or mismatched frame sequence");
  const load=record.hostLoad;
  check(load&&load.valid===true,"Host CPU/GPU observations unavailable");
  if(load){check([load.busyBeforePercent,load.busyDuringPercent,load.gpuBeforePercent,load.externalGpuPeakPercent].every(v=>Number.isFinite(v)&&v>=0&&v<=100),"Invalid host-load observations");check(load.busyBeforePercent<=protocol.measurement.hostBusyLimitPercent,"CPU busy before pass");check(load.busyDuringPercent<=protocol.measurement.hostBusyDuringLimitPercent,"CPU busy during pass");check(load.gpuBeforePercent<=protocol.measurement.externalGpuBusyLimitPercent&&load.externalGpuPeakPercent<=protocol.measurement.externalGpuBusyLimitPercent,"External GPU work observed");}
  if(record.job.pass==="cpu")check(Array.isArray(sample.milliseconds)&&sample.milliseconds.length===samples&&sample.milliseconds.every(v=>Number.isFinite(v)&&v>=0),"Invalid CPU samples");
  if(record.job.pass==="gpu")check(Array.isArray(sample.gpu)&&sample.gpu.length===samples&&sample.gpu.every(v=>Number.isFinite(v.milliseconds)&&v.milliseconds>0&&Number.isFinite(v.spanMilliseconds)&&v.spanMilliseconds>0&&v.passes.length>=2&&v.passes.every(p=>["render","compute"].includes(p.kind)&&Number.isFinite(p.milliseconds)&&p.milliseconds>=0)),"Incomplete GPU pass timestamps");
  if(record.job.pass==="counts"){
    const frames=sample.counters?.frames;check(frames?.length===samples,"Incomplete counters");check(setup.unknownTextureFormats?.length===0,"Unmeasurable texture formats");
    if(record.job.scene==="particles"&&frames?.length===samples){
      const definition=describeScene(record.job.scene,record.job.quality),reference=new ReferenceParticles(definition.emitters,definition.profile.particleRate);
      for(let i=0;i<warmup;i++)reference.advance(protocol.measurement.deltaSeconds);
      for(const frame of frames){reference.advance(protocol.measurement.deltaSeconds);check(frame.quadInstances===reference.count+definition.emitters.length,"Particle instance stream differs from independent simulation");}
    }
  }
  if(record.job.pass==="presented"){
    const p=sample.presentation,profile=protocol.profiles[record.job.quality];
    check(p&&p.visibility==="visible"&&p.focused&&p.visibilityFailures.length===0,"Native canvas was hidden or unfocused");
    if(p)check(p.devicePixelRatio===1&&p.canvas.x===0&&p.canvas.y===0&&p.canvas.width===profile.width&&p.canvas.height===profile.height&&p.viewport.width>=profile.width&&p.viewport.height>=profile.height,"Native canvas clipped, scaled or resized");
    check(record.presentation?.intervalsMs?.length>0,"Missing OS displayed-frame cadence");
    check(record.nativeConsistency?.passed===true,"Native canvas differs from offscreen reference");
  }
  return {qualified:errors.length===0,errors:[...new Set(errors)]};
}

export function coverageProblems(accepted,jobs=schedule()){
  const problems=[],keys=new Map();for(const r of accepted){const key=jobKey(r.job);if(keys.has(key))problems.push(`Duplicate accepted pass ${key}`);keys.set(key,r);}
  for(const job of jobs)if(!keys.has(jobKey(job)))problems.push(`Missing ${jobKey(job)}`);
  for(const [key,r]of keys){if(!jobs.some(j=>jobKey(j)===key))problems.push(`Unexpected ${key}`);if(!r.qualification?.qualified)problems.push(`Unqualified ${key}`);}
  // A GPU timing pass must cover the same application passes/encoders observed
  // by the independent counter pass at each fixed simulation frame.
  for(const r of accepted.filter(r=>r.job.pass==="gpu")){
    const counter=keys.get(jobKey({...r.job,pass:"counts"}));if(!counter)continue;
    for(let i=0;i<r.sample.gpu.length;i++){
      const gpu=r.sample.gpu[i],counts=counter.sample.counters.frames[i]?.delta;
      if(!counts||gpu.passes.filter(p=>p.kind==="render").length!==counts.renderPassesBegun||gpu.passes.filter(p=>p.kind==="compute").length!==counts.computePassesBegun||gpu.encoders!==counts.commandEncodersCreated){problems.push(`GPU coverage mismatch ${jobKey(r.job)} at sample ${String(i)}`);break;}
    }
  }
  return problems;
}

export function groupMeasurements(accepted){
  const groups=new Map();
  for(const r of accepted){
    const key=`${r.job.scene}/${r.job.quality}/${r.job.implementation}`;if(!groups.has(key))groups.set(key,{scene:r.job.scene,quality:r.job.quality,implementation:r.job.implementation,cpu:[],gpu:[],gpuSpan:[],cadence:[],buffers:[],textures:[],draws:[],uploads:[]});const g=groups.get(key),s=r.sample;
    if(r.job.pass==="cpu")g.cpu.push(summarize(s.milliseconds));
    if(r.job.pass==="gpu"){g.gpu.push(summarize(s.gpu.map(v=>v.milliseconds)));g.gpuSpan.push(summarize(s.gpu.map(v=>v.spanMilliseconds)));}
    if(r.job.pass==="presented")g.cadence.push(r.presentation.cadence);
    if(r.job.pass==="counts"){g.buffers.push(Math.max(s.counters.before.liveBufferBytes,...s.counters.frames.map(f=>f.liveBufferBytes)));g.textures.push(Math.max(s.counters.before.liveTextureBytes,...s.counters.frames.map(f=>f.liveTextureBytes)));g.draws.push(summarize(s.counters.frames.map(f=>f.delta.drawCalls)));g.uploads.push(summarize(s.counters.frames.map(f=>f.delta.writeBufferBytes+f.delta.writeTextureBytes)));}
  }
  return [...groups.values()].map(g=>({...g,medians:{cpuP95:g.cpu.length?median(g.cpu.map(s=>s.p95)):null,gpuP95:g.gpu.length?median(g.gpu.map(s=>s.p95)):null,gpuSpanP95:g.gpuSpan.length?median(g.gpuSpan.map(s=>s.p95)):null,cadenceP95:g.cadence.length?median(g.cadence.map(s=>s.p95)):null,bufferBytes:g.buffers.length?median(g.buffers):null,textureBytes:g.textures.length?median(g.textures):null,drawsP95:g.draws.length?median(g.draws.map(s=>s.p95)):null,uploadBytesP95:g.uploads.length?median(g.uploads.map(s=>s.p95)):null}}));
}

export function nativeConsistency(actual,reference,width,height){
  assert.equal(actual.length,width*height*4);assert.equal(reference.length,actual.length);
  const errors=[];let sum=0,over3=0;
  for(let i=0;i<actual.length;i+=4){let maximum=0;for(let c=0;c<3;c++){const d=Math.abs(actual[i+c]-reference[i+c]);sum+=d;maximum=Math.max(maximum,d);}errors.push(maximum);if(maximum>3)over3++;}
  errors.sort((a,b)=>a-b);const result={meanAbsoluteRgb8:sum/(width*height*3),p95MaximumChannelError8:errors[Math.ceil(errors.length*.95)-1],fractionOver3:over3/(width*height)},gate=protocol.measurement.nativeConsistency;
  return {...result,passed:result.meanAbsoluteRgb8<=gate.meanAbsoluteRgb8&&result.p95MaximumChannelError8<=gate.p95MaximumChannelError8&&result.fractionOver3<=gate.fractionOver3};
}
