// Verification-only independent CPU skinning plus affine deformation. No GPU output is read.
import {deformSkin} from "../../packages/runtime-web/src/mesh/skinning.js";
import type {MtekAssetMesh,MtekManifest} from "../../packages/runtime-web/src/abi/manifest-types.js";
import type {SceneTransform,ExtensionContext} from "@mtek/runtime-web";
import type {ProgramModule} from "./workshop.js";
import type {CompositionController} from "./controller.js";
const hash=async(bytes:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),v=>v.toString(16).padStart(2,"0")).join("");
const base64=(bytes:Uint8Array)=>{let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);};
export async function captureCpuReference(module:ProgramModule,actors:readonly {name:string;controller:CompositionController}[],transforms:readonly SceneTransform[],server:URL){
  const manifest=await fetch(module.default.manifestUrl).then(r=>r.json()) as MtekManifest,clone=structuredClone(manifest),files:{url:string;bytes:string}[]=[];
  const reference=manifest.materials.find(m=>m.id.endsWith("::Reference"))!,shader=manifest.shaders.find(s=>s.hash===reference.shader)!;
  if(shader.vertexDeformation!==undefined)throw new Error("CPU reference must use a fragment-only shader");
  for(const actor of actors){
    const record=clone.scene.entities.find(e=>e.name===actor.name)!,entity=record as {mesh:string;material:{id:string};clip?:unknown},mesh=clone.meshes.find(m=>m.id===entity.mesh) as MtekAssetMesh,asset=clone.assets.find(a=>a.kind==="mesh-data"&&a.url===mesh.asset)!;
    if(asset.kind!=="mesh-data")throw new Error("Missing reference geometry");
    const source=await fetch(new URL(mesh.asset,module.default.baseUrl)).then(r=>r.arrayBuffer()),primitive=asset.primitives[mesh.primitive]!,n=primitive.vertexCount,bytes=source.slice(0),positions=new Float32Array(n*3),normals=new Float32Array(n*3);
    if(primitive.offsets.normal===undefined)throw new Error("Workshop requires original authored normals");
    deformSkin(mesh.skin!,actor.controller.player.palette,new Float32Array(source,primitive.offsets.position,n*3),new Float32Array(source,primitive.offsets.normal,n*3),positions,normals);
    for(let i=0;i<positions.length;i+=3){positions[i]=positions[i]!*1.03;normals[i]=normals[i]!/1.03;const length=Math.hypot(normals[i]!,normals[i+1]!,normals[i+2]!);for(let c=0;c<3;c++)normals[i+c]=normals[i+c]!/length;}
    new Float32Array(bytes,primitive.offsets.position,n*3).set(positions);new Float32Array(bytes,primitive.offsets.normal,n*3).set(normals);
    const sha256=await hash(bytes),url=`assets/${sha256.slice(0,16)}.bin`;
    (mesh as unknown as {asset:string;skin?:unknown}).asset=url;delete (mesh as unknown as {skin?:unknown}).skin;
    (asset as unknown as {url:string;sha256:string}).url=url;(asset as unknown as {sha256:string}).sha256=sha256;
    entity.material.id=reference.id;delete entity.clip;
    for(const instance of clone.scene.materialInstances)if(instance.entity===record.index)(instance as {material:string}).material=reference.id;
    files.push({url,bytes:base64(new Uint8Array(bytes))});
  }
  const response=await fetch(new URL("cpu-reference",server),{method:"POST",body:JSON.stringify({manifest:clone,files})});if(!response.ok)throw new Error("Cannot install static CPU reference");
  const base=new URL(await response.text(),server);let context:ExtensionContext|undefined;
  const app=await module.mountMtek(document.createElement("canvas"),{...module.default,baseUrl:base,manifestUrl:new URL("program.manifest.json",base)},
    {test:{manualClock:true,renderTarget:{width:241,height:193},disableCulling:true},rendering:{shadows:{light:"Sun",quality:"low",size:18,far:70}},extensions:[{id:"cpu-reference-transforms",apiVersion:1,setup:c=>{context=c;}}]});
  let pixels:Uint8Array;
  try{
    const targets=context!.readTransforms();context!.writeTransforms(transforms.map(source=>{const target=targets.find(e=>e.name===source.name);if(!target)throw new Error("Missing reference entity");return {id:target.id,position:source.position,rotation:source.rotation,scale:source.scale};}));
    app.debug!.step(1,0);pixels=(await app.debug!.readPixels()).data;
  }finally{
    app.dispose();
  }
  for(const key of ["liveBuffers","liveTextures","liveSamplers","liveShaderModules","livePipelines","liveBindGroups","liveListeners"])if(app.debug!.counters()[key]!==0)throw new Error("CPU reference retained "+key);
  return pixels;
}
