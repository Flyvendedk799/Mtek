import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {join} from "node:path";
import metadata from "./assets/WaterBottle/provenance.json" with {type:"json"};
const hash=b=>createHash("sha256").update(b).digest("hex");
export function verifyProduct(bytes){
  if(bytes.length!==metadata.bytes||hash(bytes)!==metadata.sha256)throw new Error("Unchanged product asset hash mismatch");
  if(bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length||bytes.readUInt32LE(16)!==0x4e4f534a)throw new Error("Invalid product GLB container");
  const length=bytes.readUInt32LE(12),document=JSON.parse(bytes.subarray(20,20+length).toString()),bin=bytes.subarray(28+length),mesh=document.meshes.find(m=>m.name===metadata.mesh);
  if(!mesh||mesh.primitives.length!==1)throw new Error("Product primitive identity changed");
  const primitive=mesh.primitives[0],position=document.accessors[primitive.attributes.POSITION];
  const node=document.nodes.find(n=>n.name===metadata.node);
  if(!node||JSON.stringify(node.rotation)!==JSON.stringify(metadata.nodeRotation))throw new Error("Authored product node rotation changed");
  if(position.count!==metadata.vertices||document.accessors[primitive.indices].count!==metadata.indices||JSON.stringify(position.min)!==JSON.stringify(metadata.bounds.min)||JSON.stringify(position.max)!==JSON.stringify(metadata.bounds.max)||document.materials[primitive.material].name!==metadata.material)throw new Error("Product geometry/material identity changed");
  return {bytes,document,bin,primitive,metadata};
}
export async function readProduct(){return verifyProduct(await readFile(join(import.meta.dirname,"assets/WaterBottle/WaterBottle.glb")));}
function stream(product,index){
  const accessor=product.document.accessors[index],view=product.document.bufferViews[accessor.bufferView],components={VEC2:2,VEC3:3,VEC4:4,SCALAR:1}[accessor.type],componentBytes=accessor.componentType===5126?4:2,width=components*componentBytes,stride=view.byteStride??width,offset=(view.byteOffset??0)+(accessor.byteOffset??0),result=Buffer.alloc(accessor.count*width);
  for(let v=0;v<accessor.count;v++)product.bin.copy(result,v*width,offset+v*stride,offset+v*stride+width);
  return result;
}
/** Check the compiler's actual packed streams against original accessors, byte
 * for byte. Selecting the original named mesh does not convert the source GLB. */
export async function verifyPackedProduct(directory,product){
  const manifest=JSON.parse(await readFile(join(directory,"program.manifest.json"),"utf8"));
  const entry=manifest.assets.find(a=>a.kind==="mesh-data"&&a.primitives.some(p=>p.source.mesh===metadata.mesh));
  if(!entry)throw new Error("Compiled package omitted the product mesh");
  const primitive=entry.primitives.find(p=>p.source.mesh===metadata.mesh),bytes=await readFile(join(directory,entry.url)),attributes={POSITION:"position",NORMAL:"normal",TEXCOORD_0:"uv",TANGENT:"tangent"},streams=[];
  for(const [semantic,name]of Object.entries(attributes)){
    const original=stream(product,product.primitive.attributes[semantic]),offset=primitive.offsets[name];
    if(!primitive.attributes.includes(name)||!Number.isInteger(offset)||!bytes.subarray(offset,offset+original.length).equals(original))throw new Error(`Product ${semantic} changed in packaging`);
    streams.push({semantic,bytes:original.length,sha256:hash(original)});
  }
  const indices=stream(product,product.primitive.indices);
  if(primitive.indexFormat!=="uint16"||!bytes.subarray(primitive.offsets.indices,primitive.offsets.indices+indices.length).equals(indices))throw new Error("Product indices changed in packaging");
  if(!manifest.shaders.some(s=>s.material==="std/materials.mtek::Pbr"&&s.vertexAttributes.includes("tangent")))throw new Error("Product shader does not consume authored tangents");
  return {sourceSha256:metadata.sha256,mesh:metadata.mesh,material:metadata.material,vertices:primitive.vertexCount,indices:primitive.indexCount,streams,indexSha256:hash(indices),nodes:product.document.nodes};
}
