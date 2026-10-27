import {BoxGeometry,SphereGeometry,PlaneGeometry} from "three";
import {createRequire} from "node:module";
import {materials,protocol} from "./scenes.mjs";
const {PNG}=createRequire(import.meta.url)("playwright-core/lib/utilsBundle");
/** One deterministic uncompressed GLB is supplied to both engines unchanged. */
export function makeContent(){
  const json={asset:{version:"2.0",generator:"Mtek material-lighting protocol 1; Three 0.186.1 geometry"},scene:0,scenes:[{nodes:[]}],nodes:[],meshes:[],materials:[],buffers:[{byteLength:0}],bufferViews:[],accessors:[],images:[],textures:[],samplers:[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}]},chunks=[];let length=0;
  const view=(bytes)=>{const pad=(4-length%4)%4;if(pad){chunks.push(Buffer.alloc(pad));length+=pad;}const id=json.bufferViews.length;json.bufferViews.push({buffer:0,byteOffset:length,byteLength:bytes.length});chunks.push(bytes);length+=bytes.length;return id;};
  const accessor=(array,type,componentType)=>{
    const width={VEC2:2,VEC3:3,SCALAR:1}[type],copy=Buffer.alloc(array.length*(componentType===5126?4:2));array.forEach((v,i)=>componentType===5126?copy.writeFloatLE(v,i*4):copy.writeUInt16LE(v,i*2));
    const record={bufferView:view(copy),componentType,count:array.length/width,type};
    if(type==="VEC3"){record.min=Array.from({length:3},(_,c)=>array.filter((_,i)=>i%3===c).reduce((a,b)=>Math.min(a,b),Infinity));record.max=Array.from({length:3},(_,c)=>array.filter((_,i)=>i%3===c).reduce((a,b)=>Math.max(a,b),-Infinity));}
    return json.accessors.push(record)-1;
  };
  for(const kind of ["base","normal","orm","emission"]){
    const png=new PNG({width:64,height:64});
    for(let y=0;y<64;y++)for(let x=0;x<64;x++){
      const at=(y*64+x)*4,tile=((x>>3)+(y>>3))%2;
      const rgb=kind==="base"?(tile?[165,110,58]:[70,135,180]):kind==="normal"?[128+Math.round(25*Math.sin(x*Math.PI/8)),128+Math.round(25*Math.cos(y*Math.PI/8)),250]:kind==="orm"?[tile?230:180,tile?220:160,tile?180:100]:[tile?80:20,tile?35:15,10];
      png.data.set([...rgb,255],at);
    }
    const image=json.images.push({bufferView:view(PNG.sync.write(png)),mimeType:"image/png"})-1;json.textures.push({source:image,sampler:0});
  }
  // Glass is a source/host PBR material: the current GLB import profile is OPAQUE-only.
  for(const m of materials.filter(m=>m.name!=="Glass")){
    const record={name:m.name,pbrMetallicRoughness:{baseColorFactor:m.color,metallicFactor:m.metallic,roughnessFactor:m.roughness}};
    if(m.color[3]<1)record.alphaMode="BLEND";
    if(m.mapped){record.pbrMetallicRoughness.baseColorTexture={index:0};record.pbrMetallicRoughness.metallicRoughnessTexture={index:2};record.normalTexture={index:1,scale:.35};record.occlusionTexture={index:2,strength:.7};record.emissiveTexture={index:3};record.emissiveFactor=[.03,.02,.01];}
    json.materials.push(record);
  }
  for(const [name,geometry] of [["Box",new BoxGeometry(1,1,1)],["Quad",new PlaneGeometry(1,1).rotateX(-Math.PI/2)],...Object.entries(protocol.profiles).map(([name,p])=>["Sphere_"+name,new SphereGeometry(.5,p.sphereSegments,p.sphereRings)])]){
    const attributes={};for(const [attribute,type] of [["position","VEC3"],["normal","VEC3"],["uv","VEC2"]])attributes[{position:"POSITION",normal:"NORMAL",uv:"TEXCOORD_0"}[attribute]]=accessor(Array.from(geometry.getAttribute(attribute).array),type,5126);
    const mesh=json.meshes.push({name,primitives:[{attributes,indices:accessor(Array.from(geometry.index.array),"SCALAR",5123),material:0,mode:4}]})-1;
    json.scenes[0].nodes.push(json.nodes.push({name,mesh})-1);geometry.dispose();
  }
  json.buffers[0].byteLength=length;const text=Buffer.from(JSON.stringify(json)),jp=(4-text.length%4)%4,bp=(4-length%4)%4,j=Buffer.concat([text,Buffer.alloc(jp,32)]),bin=Buffer.concat([...chunks,Buffer.alloc(bp)]),bytes=Buffer.alloc(28+j.length+bin.length);
  bytes.writeUInt32LE(0x46546c67,0);bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);bytes.writeUInt32LE(j.length,12);bytes.writeUInt32LE(0x4e4f534a,16);j.copy(bytes,20);const at=20+j.length;bytes.writeUInt32LE(bin.length,at);bytes.writeUInt32LE(0x004e4942,at+4);bin.copy(bytes,at+8);return bytes;
}
