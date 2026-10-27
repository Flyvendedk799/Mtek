import {createMtek,createThree} from "./adapters.mjs";
import {installDeviceCapture,installCounters,currentDevice,snapshotCounters,diffCounters,devices} from "../runtime/harness/instrument.ts";
import {protocol} from "./scenes.mjs";
import {AllPassTimer} from "./gpu-timer.mjs";
let app,timer,initialized=false,frames=0,mode;const draws=[];
const adapterMetadata=new WeakMap(),describeAdapter=i=>({vendor:i.vendor,architecture:i.architecture,device:i.device,description:i.description,isFallbackAdapter:i.isFallbackAdapter});
const encode=bytes=>{let result="";for(const value of bytes)result+=String.fromCharCode(value);return btoa(result);};
const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
const api={
  async setup(implementation,scene,quality,pass="correctness",control=false){
    if(initialized)throw new Error("Each pass requires a fresh page");initialized=true;mode=pass;
    if(!["mtek","three"].includes(implementation))throw new Error("Unknown implementation");
    if(!["correctness","counts","cpu","gpu"].includes(pass))throw new Error("This pass is not implemented yet");
    installDeviceCapture({timestampQuery:pass==="gpu"});if(["correctness","counts"].includes(pass))installCounters();
    if(["correctness","counts"].includes(pass))for(const method of ["draw","drawIndexed"]){const original=GPURenderPassEncoder.prototype[method];GPURenderPassEncoder.prototype[method]=function(count,instances=1,...rest){draws.push({method,count,instances});return original.call(this,count,instances,...rest);};}
    const acquire=GPUAdapter.prototype.requestDevice;GPUAdapter.prototype.requestDevice=async function(descriptor){const device=await acquire.call(this,descriptor);adapterMetadata.set(device,describeAdapter(this.info));return device;};
    const start=performance.now();app=await (implementation==="mtek"?createMtek:createThree)(scene,quality,{control});await currentDevice().device.queue.onSubmittedWorkDone();
    if(pass==="gpu")timer=new AllPassTimer(currentDevice().device);
    document.querySelector("#status").textContent=`${implementation} ${scene} ${quality}`;
    const adapter=adapterMetadata.get(currentDevice().device);if(!adapter)throw new Error("No metadata for the actual renderer device");
    let minimumClockDelta=Infinity,previous=performance.now();for(let i=0;i<1000;i++){const now=performance.now(),delta=now-previous;if(delta>0)minimumClockDelta=Math.min(minimumClockDelta,delta);previous=now;}
    const resources=performance.getEntriesByType("resource").map(entry=>({path:entry.name.startsWith("blob:")?"<blob>":new URL(entry.name).pathname,decodedBodySize:entry.decodedBodySize}));
    if(implementation==="mtek"&&resources.some(r=>r.path.includes("/chunks/three-")))throw new Error("Unused reference renderer loaded into the Mtek page");
    if(implementation==="three"&&resources.some(r=>r.path.includes("/programs/")))throw new Error("Unused Mtek program loaded into the reference page");
    return {startupCreationMs:performance.now()-start,implementation,scene,quality,adapter,deviceFeatures:currentDevice().features,crossOriginIsolated,minimumClockDelta,resources};
  },
  async advance(count,delta=protocol.measurement.deltaSeconds){
    if(!Number.isInteger(count)||count<0||!Number.isFinite(delta)||delta<0)throw new Error("Invalid frame step");
    for(let i=0;i<count;i++){await nextFrame();draws.length=0;app.frame(delta);frames++;await currentDevice().device.queue.onSubmittedWorkDone();}
    return {frames,info:app.info(),counters:snapshotCounters(),lastFrameDraws:[...draws]};
  },
  async pixels(){const p=await app.read();return {...p,data:encode(p.data)};},
  async samples(count){
    if(!["cpu","counts","gpu"].includes(mode))throw new Error("Select a measurement pass explicitly");
    if(!Number.isInteger(count)||count<1)throw new Error("Invalid sample count");
    const before=snapshotCounters(),milliseconds=[],gpu=[];
    for(let i=0;i<count;i++){
      await nextFrame();if(timer)timer.begin();const t=performance.now();app.frame(protocol.measurement.deltaSeconds);if(mode==="cpu")milliseconds.push(performance.now()-t);frames++;
      if(timer)gpu.push(await timer.end());else await currentDevice().device.queue.onSubmittedWorkDone();
    }
    return {frames,mode,milliseconds:mode==="cpu"?milliseconds:null,gpu:mode==="gpu"?gpu:null,counters:mode==="counts"?diffCounters(snapshotCounters(),before):null,info:app.info()};
  },
  async dispose(){
    const before=snapshotCounters();timer?.dispose();const result=await app.dispose();await new Promise(resolve=>setTimeout(resolve,0));
    const validation=devices().flatMap(d=>d.errors),losses=devices().filter(d=>d.lost&&d.lost.reason!=="destroyed").map(d=>d.lost);
    return {result,before,after:snapshotCounters(),validation,losses,allDevicesDestroyed:devices().every(d=>d.destroyed)};
  },
};
window.materialSuite=api;document.querySelector("#status").textContent="Ready";
