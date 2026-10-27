// Independent CPU skinning and ordinary fragment-only transforms for each pose group.
// Only this reference harness changes program/manifest records; the example uses the public SDK.
import {deformSkin} from "../../packages/runtime-web/src/mesh/skinning.js";
import type {MtekAssetMesh,MtekManifest,MtekPrefab} from "../../packages/runtime-web/src/abi/manifest-types.js";
import type {MtekProgram} from "../../packages/runtime-web/src/abi/program.js";
import type {AnimationPlayer,SceneTransform} from "@mtek/runtime-web";
const digest=async(bytes:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),v=>v.toString(16).padStart(2,"0")).join("");
const base64=(bytes:Uint8Array)=>{let s="";for(const byte of bytes)s+=String.fromCharCode(byte);return btoa(s);};
export async function cpuCohortReference(program:MtekProgram,manifest:MtekManifest,base:URL,players:readonly AnimationPlayer[],character:number,enclosures:readonly NonNullable<SceneTransform["bounds"]>[]):Promise<{program:MtekProgram;bounds:readonly {maximum:number;declared:number}[]}>{
  const clone=structuredClone(manifest), files:{url:string;bytes:string}[]=[],prefabs:MtekPrefab[]=[],programPrefabs={...program.prefabs};
  const original=manifest.prefabs!.find(p=>p.name===(character===0?"FoxReference":"ManReference"))!;
  const mesh=manifest.meshes.find(m=>m.id===original.mesh) as MtekAssetMesh,asset=manifest.assets.find(a=>a.kind==="mesh-data"&&a.url===mesh.asset)!;
  if(asset.kind!=="mesh-data")throw new Error("Missing reference mesh data");
  const source=await fetch(new URL(asset.url,base)).then(r=>r.arrayBuffer()),primitive=asset.primitives[mesh.primitive]!,n=primitive.vertexCount;
  const bounds:{maximum:number;declared:number}[]=[];
  // Each distinct CPU-skinned pose gets separate immutable geometry; no GPU output is read.
  for(let group=0;group<players.length;group++){
    const bytes=source.slice(0),positions=new Float32Array(n*3),normals=new Float32Array(n*3);
    deformSkin(mesh.skin!,players[group]!.palette,new Float32Array(source,primitive.offsets.position,n*3),primitive.offsets.normal===undefined?undefined:new Float32Array(source,primitive.offsets.normal,n*3),positions,normals);
    const enclosure=enclosures[group]!;let maximum=0;
    for(let i=0;i<positions.length;i+=3)maximum=Math.max(maximum,Math.hypot(positions[i]!*.75-enclosure.center.x,positions[i+1]!*1.25-enclosure.center.y,positions[i+2]!*.5-enclosure.center.z));
    if(maximum>enclosure.radius)throw new Error("Sampled authored pose escapes its declared final sphere");
    bounds.push({maximum,declared:enclosure.radius});
    new Float32Array(bytes,primitive.offsets.position,n*3).set(positions);
    if(primitive.offsets.normal!==undefined)new Float32Array(bytes,primitive.offsets.normal,n*3).set(normals);
    const sha256=await digest(bytes),url=`assets/${sha256.slice(0,16)}.bin`,id=`mesh:${clone.meshes.length}`;
    const baked=structuredClone(mesh) as {id:string;asset:string;skin?:unknown};baked.id=id;baked.asset=url;delete baked.skin;
    const a={...structuredClone(asset),url,sha256};
    // Reference culling is disabled; the independent transform/raster path determines visible pixels.
    (clone.assets as unknown[]).push(a);(clone.meshes as unknown[]).push(baked);files.push({url,bytes:base64(new Uint8Array(bytes))});
    const prefab={...structuredClone(original),symbol:`${original.symbol}:cpu:${group}`,mesh:id};
    prefabs.push(prefab);programPrefabs[prefab.symbol]=program.prefabs[original.symbol]!;
  }
  (clone.prefabs as MtekPrefab[]).push(...prefabs);
  const response=await fetch(new URL("cpu-reference",base),{method:"POST",body:JSON.stringify({manifest:clone,files})});
  if(!response.ok)throw new Error("Cannot install CPU-skinned reference");
  const referenceBase=new URL(await response.text(),base),entry=program.scenes["Demo"]!;
  return {bounds,program:{...program,baseUrl:referenceBase,manifestUrl:new URL("program.manifest.json",referenceBase),prefabs:programPrefabs,
    scenes:{...program.scenes,Demo:{...entry,update:(context,dt)=>{
      let index=0;
      // Route the source scene's ordinary reference spawns to the independently baked per-group meshes.
      // Actor order/positions/count and material initializers still come from the compiled source.
      const actual=context as {spawn:(id:string,params:Readonly<Record<string,unknown>>)=>unknown};
      const proxy=new Proxy(context,{get:(target,key)=>key==="spawn"?(id:string,params:Readonly<Record<string,unknown>>)=>actual.spawn(id===original.symbol?prefabs[index++%players.length]!.symbol:id,params):Reflect.get(target,key) as unknown});
      entry.update?.(proxy,dt);
    }}}}};
}
