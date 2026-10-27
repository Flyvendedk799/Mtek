import assert from "node:assert/strict";
import {cpus} from "node:os";
import {readCpuTimes,busyPercent} from "../runtime/tools/host-load.ts";
import {gpuBusy} from "./windows-monitor.mjs";
import {protocol} from "./scenes.mjs";
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function waitForQuiet(monitor,excludedPids,maximumMs=protocol.measurement.maxQuietWaitMs){
  const start=Date.now(),observations=[];
  for(;;){
    const before=readCpuTimes(),gpu=await monitor.request("gpu");await delay(250);const after=readCpuTimes();
    assert(after.total>before.total,"CPU counters did not advance");
    const observation={cpu:busyPercent(before,after),cpuBefore:before,cpuAfter:after,gpu:gpuBusy(gpu,excludedPids).externalEnginePeakPercent,rawGpu:gpu};observations.push(observation);
    const quiet=observation.cpu<=protocol.measurement.hostBusyLimitPercent&&observation.gpu<=protocol.measurement.externalGpuBusyLimitPercent;
    if(quiet||Date.now()-start>=maximumMs)return {quiet,busyBeforePercent:observation.cpu,gpuBeforePercent:observation.gpu,waitedMs:Date.now()-start,observations};
    await delay(1000);
  }
}

export function observeHost(monitor,excludedPids,before){
  const cpuBefore=readCpuTimes(),samples=[];let stopped=false;
  const polling=(async()=>{
    while(!stopped){
      try{const raw=await monitor.request("gpu");samples.push({raw,...gpuBusy(raw,excludedPids)});}catch(error){samples.push({error:String(error)});}
      if(!stopped)await delay(protocol.measurement.gpuPollIntervalMs);
    }
  })();
  return {async finish(){
    const cpuAfter=readCpuTimes();stopped=true;await polling;
    const valid=cpuAfter.total>cpuBefore.total&&samples.length>0&&samples.every(s=>!s.error);
    return {...before,valid,busyDuringPercent:busyPercent(cpuBefore,cpuAfter),externalGpuPeakPercent:samples.some(s=>s.error)?null:Math.max(0,...samples.map(s=>s.externalEnginePeakPercent)),logicalCpus:cpus().length,cpuBefore,cpuAfter,gpuSamples:samples};
  }};
}
