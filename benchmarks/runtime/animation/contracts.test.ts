import {mkdtempSync,readFileSync,readdirSync,rmdirSync,unlinkSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {afterEach,describe,expect,it,vi} from "vitest";
import {embeddedImage,materialFreeGlb,verifyAssets} from "./prepare.ts";
import {AnimationGpuTimer,sumPassDurations} from "./gpu-timer.ts";
import {parity} from "./run.ts";
import {models} from "./layout.ts";
import {generate,p95Runs,writeReport} from "./report.ts";
import {definitionHash} from "./freeze.ts";
import protocol from "./protocol.json" with {type:"json"};
import {waitForCleanWindow} from "./load-policy.ts";

describe("pinned production asset contract",()=>{
  it("verifies originals and preserves geometry, hierarchy, skins, clips and the complete BIN chunk during explicit material replacement",()=>{
    verifyAssets();
    for(const model of models){
      const original=readFileSync(join(import.meta.dirname,"assets",model,`${model}.glb`)),derived=materialFreeGlb(original);
      const read=(bytes:Buffer)=>JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString("utf8")) as Record<string,unknown>;
      const a=read(original),b=read(derived);
      expect(derived.subarray(20+derived.readUInt32LE(12))).toEqual(original.subarray(20+original.readUInt32LE(12)));
      for(const key of ["nodes","skins","accessors","bufferViews","animations"])expect(b[key],`${model}/${key}`).toEqual(a[key]);
      expect(b["materials"]).toBeUndefined();
      expect(embeddedImage(original).bytes.length).toBeGreaterThan(100);
    }
  });
});

describe("matched parity gates",()=>{
  const row=()=>({phase:0,joints:[0,0,0],pixels:Array.from({length:40},()=>[112,200,168,255]).flat()});
  it("rejects a displaced skeleton and a differing picture before performance is reported",()=>{
    expect(parity([row()],[row()])["passed"]).toBe(true);
    const displaced=row();displaced.joints[0]=0.01;expect(parity([row()],[displaced])["passed"]).toBe(false);
    const picture=row();picture.pixels[0]=0;expect(parity([row()],[picture])["passed"]).toBe(false);
    const blank=row();blank.pixels=Array.from({length:40},()=>[16,24,32,255]).flat();expect(()=>parity([row()],[blank])).toThrow(/visible/);
  });
});

describe("report acceptance",()=>{
  it("defers measurements across busy windows without accepting noise or losing accumulated wait time",async()=>{
    const notify=vi.fn(),observations=[{busyBeforePercent:45,waitedForQuietMs:10000,noisy:true},{busyBeforePercent:36,waitedForQuietMs:10000,noisy:true},{busyBeforePercent:8,waitedForQuietMs:250,noisy:false}];
    const result=await waitForCleanWindow(notify,()=>Promise.resolve(observations.shift()!));
    expect(result).toEqual({busyBeforePercent:8,waitedForQuietMs:20250,noisy:false});expect(notify).toHaveBeenCalledTimes(2);
  });
  it("regenerates a complete matrix deterministically and rejects missing pass/memory evidence",()=>{
    const directory=mkdtempSync(join(tmpdir(),"mtek-animation-report-"));
    const save=(file:string,data:unknown)=>writeFileSync(join(directory,file),JSON.stringify(data));
    const adapter={vendor:"test-fixture",device:"test-fixture",isFallbackAdapter:false};
    const gpu={result:{info:{adapter},samples:Array<number>(protocol.gpuFrames).fill(1),computePassCounts:Array<number>(protocol.gpuFrames).fill(1),renderPassCounts:Array<number>(protocol.gpuFrames).fill(1)}};
    try{
      save("run.json",{status:"passed",smoke:false,completed:210,definitions:definitionHash()});
      for(const model of models)for(const count of protocol.actors){
        save(`${model}-${count}-parity.json`,{passed:true});save(`${model}-${count}-culling.json`,{culledVersusUnculled:{passed:true},culledVersusThree:{passed:true}});
        for(const engine of ["mtek","three"])for(let i=0;i<protocol.runs;i++){
          const prefix=`${model}-${count}-${engine}`;
          save(`${prefix}-cpu-${i}.json`,{result:{info:{adapter},samples:Array<number>(protocol.cpuFrames).fill(2)}});
          save(`${prefix}-gpu-${i}.json`,gpu);
          save(`${prefix}-cadence-${i}.json`,{result:{info:{adapter},samples:Array<number>(protocol.cadenceFrames-1).fill(3)}});
          save(`${prefix}-counts-${i}.json`,{result:{info:{adapter},counters:{writeBufferBytes:64,drawCalls:1}}});
          save(`${prefix}-memory-${i}.json`,{result:{info:{adapter},live:{liveBufferBytes:1024}},heapWhileLive:{usedSize:2048},heapAfter:{usedSize:1024}});
        }
      }
      writeReport(directory);expect(()=>writeReport(directory,true)).not.toThrow();
      expect(generate(directory).markdown).toContain("CesiumMan | 50 | three");
      save("Fox-1-mtek-gpu-0.json",{...gpu,result:{...gpu.result,computePassCounts:[]}});expect(()=>generate(directory)).toThrow(/compute/);
      save("Fox-1-mtek-gpu-0.json",gpu);save("Fox-1-mtek-memory-0.json",{result:{info:{adapter},live:{liveBufferBytes:1024}},heapAfter:{usedSize:1024}});expect(()=>generate(directory)).toThrow(/memory/);
    }finally{for(const file of readdirSync(directory))unlinkSync(join(directory,file));rmdirSync(directory);}
  });
  it("keeps individual-run p95s, rejects short/nonfinite data and preserves unavailable GPU timing",()=>{
    const result=p95Runs([{result:{samples:[1,2,3,4,5]}},{result:{samples:[2,4,6,8,10]}},{result:{samples:[3,6,9,12,15]}}],5)!;
    expect(result.runs).toEqual([5,10,15]);expect(result.median).toBe(10);
    expect(()=>p95Runs([{result:{samples:[1,2]}}],5)).toThrow(/Incomplete/);
    expect(()=>p95Runs([{result:{samples:[1,NaN]}}],2)).toThrow(/invalid/);
    expect(p95Runs([{result:{status:"not-run"}}],300)).toBeNull();
  });
});

describe("whole-workload GPU pass sums",()=>{
  afterEach(()=>vi.unstubAllGlobals());
  it("sums nanosecond differences before conversion and rejects missing/non-monotonic timestamps",()=>{
    const origin=9007199254740993000n;
    expect(sumPassDurations(new BigUint64Array([origin,origin+1000000n,origin+2000000n,origin+4000000n]),["compute","render"]).totalMs).toBe(3);
    expect(()=>sumPassDurations(new BigUint64Array([3n,2n]),["compute"])).toThrow(/monotonic/);
    expect(()=>sumPassDurations(new BigUint64Array(),["render"])).toThrow(/Missing/);
  });
  it("captures a compute encoder created by a device factory bound before timer installation",async()=>{
    class Buffer {
      data=new ArrayBuffer(1024);
      async mapAsync():Promise<void>{await Promise.resolve();}
      getMappedRange():ArrayBuffer{return this.data;}
      unmap():void{}
      destroy():void{}
    }
    class Queries {values=new BigUint64Array(128);destroy():void{}}
    class Encoder {
      beginComputePass(descriptor:GPUComputePassDescriptor={}):{end():void}{return this.pass(descriptor,"compute");}
      beginRenderPass(descriptor:GPURenderPassDescriptor):{end():void}{return this.pass(descriptor,"render");}
      pass(descriptor:{timestampWrites?:GPUComputePassTimestampWrites|GPURenderPassTimestampWrites},kind:string):{end():void}{
        const writes=descriptor.timestampWrites;
        if(writes!==undefined){const values=(writes.querySet as unknown as Queries).values;values[writes.beginningOfPassWriteIndex!]=kind==="compute"?0n:1000000n;values[writes.endOfPassWriteIndex!]=kind==="compute"?500000n:2000000n;}
        return {end(){}};
      }
      resolveQuerySet(query:Queries,start:number,count:number,target:Buffer):void{new BigUint64Array(target.data).set(query.values.subarray(start,start+count));}
      copyBufferToBuffer(source:Buffer,_offset:number,target:Buffer,_to:number,size:number):void{new Uint8Array(target.data).set(new Uint8Array(source.data,0,size));}
      finish():object{return {};}
    }
    vi.stubGlobal("GPUCommandEncoder",Encoder);
    const device={createQuerySet:()=>new Queries(),createBuffer:()=>new Buffer(),createCommandEncoder:()=>new Encoder(),queue:{submit(){}}};
    const capturedFactory=device.createCommandEncoder.bind(device);
    const timer=new AnimationGpuTimer(device as unknown as GPUDevice);
    try{timer.begin();capturedFactory().beginComputePass().end();device.createCommandEncoder().beginRenderPass({colorAttachments:[]}).end();
      const result=await timer.finish();expect(result.computePasses).toBe(1);expect(result.renderPasses).toBe(1);expect(result.totalMs).toBe(1.5);
    }finally{timer.dispose();}
  });
});
