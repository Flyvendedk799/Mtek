import {readFileSync,writeFileSync} from "node:fs";
import {join,relative,resolve} from "node:path";
import {median,summarize} from "../harness/stats.ts";
import protocol from "./protocol.json" with {type:"json"};
import {models,settings} from "./layout.ts";
import {root} from "./prepare.ts";
import {definitionHash} from "./freeze.ts";

interface Raw {
  result:{samples?:number[];compute?:number[];render?:number[];computePassCounts?:number[];renderPassCounts?:number[];counters?:Record<string,number>;live?:Record<string,number>;status?:string;info?:{adapter?:{vendor:string;device:string;isFallbackAdapter:boolean};clock?:unknown}};
  heapBefore?:{usedSize:number;backingStorageSize?:number}|null;
  heapWhileLive?:{usedSize:number;backingStorageSize?:number}|null;
  heapAfter?:{usedSize:number;backingStorageSize?:number}|null;
}
export function p95Runs(records:readonly Raw[],minimum:number):{runs:number[];median:number}|null {
  if(records.some(record=>record.result.status==="not-run"))return null;
  const runs=records.map(record=>{const samples=record.result.samples;if(samples===undefined||samples.length<minimum||samples.some(value=>!Number.isFinite(value)||value<0))throw new Error("Incomplete or invalid measurement samples");return summarize(samples).p95;});
  return {runs,median:median(runs)};
}
export function generate(runDir:string):{summary:object;markdown:string}{
  const meta=JSON.parse(readFileSync(join(runDir,"run.json"),"utf8")) as {status:string;smoke:boolean;definitions:{hash:string};completed:number};
  if(meta.status!=="passed"||meta.smoke)throw new Error("Only a completed non-smoke run can produce a performance report");
  if(meta.definitions.hash!==definitionHash().hash)throw new Error("Use the measured definitions to regenerate this report");
  const expected=protocol.models.length*protocol.actors.length*(5+protocol.runs*5*2);
  if(meta.completed!==expected)throw new Error(`Incomplete benchmark matrix: ${meta.completed}/${expected} passes`);
  const rows=[];
  let adapterKey:string|undefined;
  for(const model of models)for(const count of protocol.actors){
    const gate=JSON.parse(readFileSync(join(runDir,`${model}-${count}-parity.json`),"utf8")) as {passed:boolean};
    const culling=JSON.parse(readFileSync(join(runDir,`${model}-${count}-culling.json`),"utf8")) as {culledVersusUnculled:{passed:boolean};culledVersusThree:{passed:boolean}};
    if(!gate.passed||!culling.culledVersusUnculled.passed||!culling.culledVersusThree.passed)throw new Error("Parity must pass before reporting timings");
    for(const engine of ["mtek","three"] as const){
      const read=(pass:string)=>Array.from({length:protocol.runs},(_,i)=>JSON.parse(readFileSync(join(runDir,`${model}-${count}-${engine}-${pass}-${i}.json`),"utf8")) as Raw);
      const cpuRecords=read("cpu"),gpuRecords=read("gpu"),counts=read("counts"),memory=read("memory"),cadenceRecords=read("cadence");
      for(const raw of [...cpuRecords,...gpuRecords,...counts,...memory,...cadenceRecords]){
        const adapter=raw.result.info?.adapter;if(adapter===undefined||adapter.isFallbackAdapter)throw new Error("Missing real application adapter evidence");
        const key=JSON.stringify(adapter);if(adapterKey!==undefined&&adapterKey!==key)throw new Error("Different adapters were measured");adapterKey=key;
      }
      const gpu=p95Runs(gpuRecords,protocol.gpuFrames);
      if(gpu!==null)for(const record of gpuRecords){
        if(record.result.renderPassCounts?.length!==record.result.samples?.length||record.result.renderPassCounts?.some(count=>!Number.isInteger(count)||count<1)!==false)throw new Error("Incomplete render-pass timestamps");
        if(engine==="mtek"&&(record.result.computePassCounts?.length!==record.result.samples?.length||record.result.computePassCounts?.some(count=>!Number.isInteger(count)||count<1)!==false))throw new Error("Skinning compute was omitted from timestamps");
      }
      for(const record of counts)for(const field of ["writeBufferBytes","drawCalls"])if(!Number.isFinite(record.result.counters?.[field])||record.result.counters![field]!<=0)throw new Error(`Missing upload/draw evidence: ${field}`);
      for(const record of memory)if(!Number.isFinite(record.result.live?.["liveBufferBytes"])||record.result.live!["liveBufferBytes"]!<=0||!Number.isFinite(record.heapWhileLive?.usedSize)||!Number.isFinite(record.heapAfter?.usedSize))throw new Error("Missing live/disposed memory evidence");
      const cpu=p95Runs(cpuRecords,protocol.cpuFrames)!,cadence=p95Runs(cadenceRecords,protocol.cadenceFrames-1)!;
      rows.push({model,actors:count,engine,verticesPerActor:settings[model].vertices,jointsPerActor:settings[model].joints,cpuP95Ms:cpu,gpuPassSumP95Ms:gpu,rafIntervalP95Ms:cadence,
        allWriteBufferBytesPerFrame:counts.map(record=>record.result.counters!["writeBufferBytes"]!/protocol.countFrames),drawCallsPerFrame:counts.map(record=>record.result.counters!["drawCalls"]!/protocol.countFrames),
        liveGpuBufferBytes:memory.map(record=>record.result.live!["liveBufferBytes"]!),liveJsHeapUsedBytes:memory.map(record=>record.heapWhileLive!.usedSize),liveJsBackingStorageBytes:memory.map(record=>record.heapWhileLive!.backingStorageSize??null),afterDisposeJsHeapBytes:memory.map(record=>record.heapAfter!.usedSize),clock:cpuRecords[0]!.result.info?.clock});
    }
  }
  const fmt=(value:number|null)=>value===null?"unavailable":value.toFixed(3);
  const lines=["# Matched animation benchmark","Run: "+relative(root,runDir).replaceAll("\\","/")+". Definitions: "+meta.definitions.hash+".","","Both engines use WebGPU, independent actors, original geometry/joint/clip data, opaque flat color, identical cameras and a 640 × 360 sRGB target. Mtek uses the production release runtime; Three.js is pinned to 0.186.1. Source material replacement is explicit on both sides. All four pose phases and edge-culling comparisons must pass before timings are accepted.","","Numbers below are the median of three per-run p95 values. CPU time brackets the complete synchronous update/render/submit call; queue completion is awaited outside that interval. GPU time sums every compute and render pass across all submissions, including Mtek skinning. It excludes queue gaps, transfers outside passes, presentation and instrument readback. RAF is callback interval in headless Chromium, not presented-frame cadence.","","| Asset | Actors | Engine | CPU p95 ms | GPU pass-sum p95 ms | RAF interval p95 ms | writeBuffer B/frame | Live GPU buffer MiB | Live JS heap MiB |","|---|---:|---|---:|---:|---:|---:|---:|---:|"];
  for(const row of rows)lines.push(`| ${row.model} | ${row.actors} | ${row.engine} | ${fmt(row.cpuP95Ms.median)} | ${fmt(row.gpuPassSumP95Ms?.median??null)} | ${fmt(row.rafIntervalP95Ms.median)} | ${median(row.allWriteBufferBytesPerFrame).toFixed(0)} | ${(median(row.liveGpuBufferBytes)/1048576).toFixed(2)} | ${(median(row.liveJsHeapUsedBytes)/1048576).toFixed(2)} |`);
  lines.push("","Memory is observed logical GPU buffer allocation and GC-controlled JS heap while the application is alive. It is not physical VRAM, driver memory or process RSS. Engine-specific pages prevent Three.js code from being loaded in the Mtek page. JS includes engine/harness code and application representation; backing storage and post-disposal heap are retained in raw results. Source GLB image payload remains in the common material-free derivative; compiler packing and GLTFLoader retention differ.","","CPU results near the recorded performance.now quantum are precision-limited. Instrumented counting/GPU/memory passes are separate from CPU timing. Raw samples, per-pass compute/render counts, host load, source/asset/build hashes, application adapter identities, PNG parity images and original import compatibility diagnostics are retained.","","These results cover two externally authored characters and one recorded physical computer. They do not establish general rendering superiority, mobile/integrated-GPU support, production PBR material parity or a second maintained baseline runtime. Cesium Man's original mixed min/mag sampler is rejected by the current importer; the original is preserved and that limitation is recorded. The benchmark and textured demo use explicit material replacement.","");
  return {summary:{format:"mtek-matched-animation-summary/1",definitions:meta.definitions,run:relative(root,runDir).replaceAll("\\","/"),rows},markdown:lines.join("\n")};
}
export function writeReport(runDir:string,check=false):void{
  const generated=generate(runDir),outputs:{file:string;text:string}[]=[{file:"summary.json",text:JSON.stringify(generated.summary,null,2)+"\n"},{file:"report.md",text:generated.markdown}];
  for(const output of outputs){const path=join(runDir,output.file);if(check){if(readFileSync(path,"utf8")!==output.text)throw new Error(`Stale report: ${output.file}`);}else writeFileSync(path,output.text);}
}
if(process.argv[1]!==undefined&&resolve(process.argv[1])===join(import.meta.dirname,"report.ts")){
  const runDir=process.argv.find(arg=>arg.startsWith("--run="))?.slice(6);if(runDir===undefined)throw new Error("Pass --run=<completed result directory>");writeReport(resolve(runDir),process.argv.includes("--check"));
}
