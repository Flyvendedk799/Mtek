import {cohortActors,sampleCohorts} from "./cohort-controls.js";
import {cpuCohortReference} from "./cohorts-reference.js";
import type {MtekManifest} from "../../packages/runtime-web/src/abi/manifest-types.js";
import type {MtekProgram} from "../../packages/runtime-web/src/abi/program.js";
import type {ExtensionContext,MtekApp,MtekMountOptions} from "@mtek/runtime-web";
const assert=(value:unknown,message:string):void=>{if(!value)throw new Error(message);};
const difference=(a:Uint8Array,b:Uint8Array)=>{
  assert(a.length===b.length,"Target sizes differ");let maximum=0,overTolerance=0,changed=0;
  for(let i=0;i<a.length;i+=4){let delta=0;for(let c=0;c<4;c++)delta=Math.max(delta,Math.abs(a[i+c]!-b[i+c]!));maximum=Math.max(maximum,delta);if(delta>2)overTolerance++;if(delta>10)changed++;}
  return {maximum,overTolerance,changed};
};
const ownership=["liveBuffers","liveTextures","liveSamplers","liveShaderModules","livePipelines","liveBindGroups","liveListeners"] as const;
const release=(app:MtekApp)=>{app.dispose();const counts=app.debug!.counters();for(const key of ownership)assert(counts[key]===0,`Retained ${key}`);return counts;};
export async function runCohortsProbe(base:string){
  const baseUrl=new URL(base),module=await import(new URL("app.js",baseUrl).href) as {default:MtekProgram;mountMtek:(canvas:HTMLCanvasElement,program:MtekProgram,options:MtekMountOptions)=>Promise<MtekApp>};
  const program=module.default,manifest=await fetch(program.manifestUrl).then(r=>r.json()) as MtekManifest,adapter=await navigator.gpu.requestAdapter();assert(adapter!==null,"No adapter");
  const info=adapter!.info,environment={vendor:info.vendor,architecture:info.architecture,device:info.device,description:info.description,isFallbackAdapter:info.isFallbackAdapter};
  const diagnostics:string[]=[],cases:object[]=[],lifetime:object[]=[];
  (globalThis as unknown as {__cohortProgress:object}).__cohortProgress={cases,lifetime,diagnostics};
  for(const character of [0,1])for(const [count,groups] of [[1,1],[10,1],[50,5]] as const)for(const shadows of [false,true]){
    const options:MtekMountOptions={inputs:{count,character,shape:[.75,1.25,.5],reference:false},test:{manualClock:true,renderTarget:{width:193,height:193},recovery:{delaysMs:[0,0,0]}},
      ...(shadows?{rendering:{shadows:{light:"Sun",quality:"low",size:38,far:100}}}:{}),onDiagnostic:d=>diagnostics.push(d.code)};
    const capture=async(share:boolean,disableInstancing:boolean,reference=false,source=program)=>{
      let context:ExtensionContext|undefined;
      const app=await module.mountMtek(document.createElement("canvas"),source,{...options,inputs:{...options.inputs,reference},test:{...options.test,disableInstancing,disableCulling:reference},extensions:[{id:"cohort-probe",apiVersion:1,setup:c=>{context=c;}}]});
      try{
        app.debug!.step(2,0);assert(cohortActors(context!).length===count,"Population differs from source count");
        if(source===program)sampleCohorts(context!,groups,share);
        app.debug!.step(1,0);const shot=await app.debug!.readPixels();
        return {app,context:context!,pixels:shot.data,counters:app.debug!.counters()};
      }catch(error){release(app);throw error;}
    };
    const independent=await capture(false,false),individual=await capture(true,true),instanced=await capture(true,false),transform=await capture(false,true,true);
    const disposed:Record<string,Readonly<Record<string,number>>>={};
    try{
      const actors=cohortActors(instanced.context),players=actors.slice(0,groups).map(e=>instanced.context.animation(e.id)!);
      const paletteHashes=await Promise.all(players.map(async player=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new Float32Array(player.palette).buffer)),value=>value.toString(16).padStart(2,"0")).join("")));
      assert(new Set(paletteHashes).size===groups,"Pose groups did not retain distinct sampled palettes");
      const cpuReference=await cpuCohortReference(program,manifest,baseUrl,players,character,actors.slice(0,groups).map(e=>e.bounds!)),cpu=await capture(false,true,true,cpuReference.program);
      const deltas={individual:difference(independent.pixels,individual.pixels),instanced:difference(independent.pixels,instanced.pixels),transform:difference(instanced.pixels,transform.pixels),cpu:difference(instanced.pixels,cpu.pixels)};
      const cpuDisposed=release(cpu.app);
      const reduction=independent.counters["drawCalls"]!-instanced.counters["drawCalls"]!;
      const independentActors=cohortActors(independent.context);
      independent.context.writeTransforms(independentActors.map(e=>({id:e.id,position:{x:e.position.x,y:2000,z:e.position.z}})));independent.app.debug!.step(1,0);
      const floor=await independent.app.debug!.readPixels(),geometryChanged=difference(independent.pixels,floor.data).changed;
      assert(geometryChanged>count*2,"Character pixels were not visible above the floor control");
      const outside=(entities:typeof actors)=>entities.map((e,i)=>({id:e.id,position:i%3===0?{x:2000,y:e.position.y,z:e.position.z}:e.position}));
      independent.context.writeTransforms(outside(independentActors));instanced.context.writeTransforms(outside(actors));
      independent.app.debug!.step(1,0);instanced.app.debug!.step(1,0);
      const culledIndependent=await independent.app.debug!.readPixels(),culledInstanced=await instanced.app.debug!.readPixels(),culling={...difference(culledIndependent.data,culledInstanced.data),expected:Math.ceil(count/3),actual:instanced.app.debug!.counters()["culledObjects"]!};
      assert(culling.maximum===0&&culling.actual===culling.expected,"Authored cohort culling disagreed with independent rendering");
      independent.context.writeTransforms(independentActors.map(e=>({id:e.id,position:e.position})));instanced.context.writeTransforms(actors.map(e=>({id:e.id,position:e.position})));
      independent.app.debug!.step(1,0);instanced.app.debug!.step(1,0);
      const display=document.querySelector<HTMLCanvasElement>("canvas")!;display.width=193;display.height=193;display.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(instanced.pixels),193,193),0,0);
      const row={character:character===0?"Fox":"CesiumMan",count,groups,shadows,paletteHashes,sampledBounds:cpuReference.bounds,deltas,culling,reduction,geometryChanged,preview:display.toDataURL("image/png"),independent:independent.counters,individual:individual.counters,instanced:instanced.counters,cpuDisposed,disposed};cases.push(row);
      for(const delta of Object.values(deltas))assert(delta.overTolerance===0,JSON.stringify(row));
      assert(reduction===count-groups,`Expected ${count-groups} fewer colour draws, got ${reduction}`);
      assert(instanced.counters["instancedDraws"]===(count>groups?groups:0),"Authored cohort did not instance");
      if(count===10){
        const app=instanced.app,c=instanced.context,counts:Record<string,number>[]=[];
        const stable=()=>Object.fromEntries(ownership.map(key=>[key,app.debug!.counters()[key]!]));
        for(let cycle=0;cycle<4;cycle++){
          c.detachAnimation(actors[1]!.id);app.debug!.step(1,0);const detached=await app.debug!.readPixels();
          assert(app.debug!.counters()["drawCalls"]===instanced.counters["drawCalls"]!+1,"Detach did not split a draw");assert(difference(instanced.pixels,detached.data).maximum===0,"Held detach changed pixels");
          c.shareAnimation(actors[0]!.id,[actors[1]!.id]);app.debug!.step(1,0);const rejoined=await app.debug!.readPixels();
          assert(difference(instanced.pixels,rejoined.data).maximum===0,"Rejoin changed pixels");counts.push(stable());
        }
        assert(counts.every(value=>JSON.stringify(value)===JSON.stringify(counts[0])),"Detach/rejoin resources grew");
        const recoveries=app.debug!.counters()["deviceRecoveries"]!;app.debug!.loseDevice();const deadline=performance.now()+10000;
        while(app.state!=="running"||app.debug!.counters()["deviceRecoveries"]!==recoveries+1){assert(app.state!=="failed"&&performance.now()<deadline,"Recovery failed");await new Promise(resolve=>setTimeout(resolve,10));}
        // Reconstruction creates new players. Explicitly rebuild the host-owned grouping/pose.
        sampleCohorts(c,groups,true);app.debug!.step(1,0);const recovered=await app.debug!.readPixels(),delta=difference(instanced.pixels,recovered.data);
        assert(delta.maximum===0,"Recovery changed cohort image");lifetime.push({character,shadows,counts,recovery:delta,counters:app.debug!.counters()});
      }
    }finally{for(const [name,result] of Object.entries({independent,individual,instanced,transform}))disposed[name]=release(result.app);}
  }
  assert(diagnostics.every(code=>["MTEK-W8060","MTEK-W8061"].includes(code)),`Unexpected diagnostics: ${diagnostics.join("; ")}`);
  return {adapter:environment,cases,lifetime,diagnostics};
}
