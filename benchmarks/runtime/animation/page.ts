import {create,engine} from "@animation-implementation";
import type {AnimationApp,Configuration} from "./types.ts";
import type {Engine} from "./layout.ts";
import {currentDevice,devices,installCounters,installDeviceCapture,snapshotCounters,diffCounters,unknownTextureFormats} from "../harness/instrument.ts";
import {AnimationGpuTimer} from "./gpu-timer.ts";
import protocol from "./protocol.json" with {type:"json"};
import {collectEnvironment} from "../../../tests/browser/support/env-probe.ts";

export type Pass="parity"|"cpu"|"gpu"|"counts"|"cadence"|"memory";
export interface Request extends Configuration {engine:Engine;pass:Pass;smoke?:boolean}
export async function run(request:Request):Promise<Record<string,unknown>>{
  if(request.engine!==engine)throw new Error("Wrong engine-specific benchmark page");
  installDeviceCapture({timestampQuery:request.pass==="gpu"});
  if(request.pass==="counts"||request.pass==="memory")installCounters();
  const before=snapshotCounters(),app:AnimationApp=await create({...request,captureJoints:request.pass==="parity"});
  const record=currentDevice();if(record===undefined)throw new Error("Application requested no GPU device");
  const device=record.device;
  if(!request.smoke&&!crossOriginIsolated)throw new Error("Reportable CPU measurements require an isolated high-resolution clock");
  let quantum=Infinity,last=performance.now();
  for(let i=0;i<2000;i++){const now=performance.now();if(now>last)quantum=Math.min(quantum,now-last);last=now;}
  const adapter=device.adapterInfo;
  const info=()=>({...app.info(),adapter:{vendor:adapter.vendor,architecture:adapter.architecture,device:adapter.device,description:adapter.description,isFallbackAdapter:adapter.isFallbackAdapter},deviceFeatures:[...device.features].sort(),clock:{crossOriginIsolated,observedQuantumMs:Number.isFinite(quantum)?quantum:null}});
  let timer:AnimationGpuTimer|undefined;
  try{
    if(request.pass==="parity"){
      const rows=[];
      for(const at of protocol.parityPhases){app.seek(at);app.frame(0);const pixels=await app.readPixels();rows.push({phase:at,joints:app.joints(),pixels:Array.from(pixels)});}
      return {rows,info:info(),errors:record.errors};
    }
    const warmup=request.smoke?3:protocol.warmupFrames;
    for(let i=0;i<warmup;i++){app.frame(protocol.dt);await device.queue.onSubmittedWorkDone();}
    if(request.pass==="memory"){
      await (window as unknown as {__animationMemoryGate?:()=>Promise<void>}).__animationMemoryGate?.();
      return {live:diffCounters(snapshotCounters(),before),unknownTextureFormats:unknownTextureFormats(),info:info()};
    }
    const count=request.smoke?8:request.pass==="cpu"?protocol.cpuFrames:request.pass==="gpu"?protocol.gpuFrames:request.pass==="counts"?protocol.countFrames:protocol.cadenceFrames;
    const samples:number[]=[],compute:number[]=[],render:number[]=[],passes:number[]=[],computePassCounts:number[]=[],renderPassCounts:number[]=[];
    if(request.pass==="gpu"){
      if(!device.features.has("timestamp-query"))return {status:"not-run",reason:"timestamp-query unavailable",info:info(),errors:record.errors};
      if(devices().filter(device=>!device.destroyed).length!==1)throw new Error("GPU pass instrumentation requires exactly one application device");
      timer=new AnimationGpuTimer(device);
    }
    const measuredBefore=snapshotCounters();let previous:number|undefined;
    for(let i=0;i<count;i++){
      if(request.pass==="cadence"){
        const now=await new Promise<number>(resolve=>requestAnimationFrame(resolve));
        if(previous!==undefined)samples.push(now-previous);previous=now;app.frame(protocol.dt);
      }else if(timer!==undefined){timer.begin();app.frame(protocol.dt);const gpu=await timer.finish();if(request.engine==="mtek"&&gpu.computePasses===0)throw new Error("Mtek skinning compute pass was omitted from GPU timing");if(gpu.renderPasses===0)throw new Error("No render pass in GPU timing");samples.push(gpu.totalMs);compute.push(gpu.computeMs);render.push(gpu.renderMs);passes.push(gpu.passes);computePassCounts.push(gpu.computePasses);renderPassCounts.push(gpu.renderPasses);}
      else{const start=performance.now();app.frame(protocol.dt);const elapsed=performance.now()-start;if(request.pass==="cpu")samples.push(elapsed);await device.queue.onSubmittedWorkDone();}
    }
    return {samples,compute,render,passes,computePassCounts,renderPassCounts,counters:diffCounters(snapshotCounters(),measuredBefore),info:info(),errors:record.errors};
  }finally{timer?.dispose();await app.dispose();await device.queue.onSubmittedWorkDone().catch(()=>undefined);
    if(request.pass==="counts"||request.pass==="memory")Object.assign(window,{__animationDisposed:{counters:diffCounters(snapshotCounters(),before),devices:devices().map(device=>({destroyed:device.destroyed,errors:device.errors,lost:device.lost}))}});
  }
}
Object.assign(window,{__animationBench:{run,environment:collectEnvironment,ready:true}});
