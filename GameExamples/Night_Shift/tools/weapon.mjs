// Original procedural bevelled slide and a short, non-looping mechanical cycle.
// Regenerate with node GameExamples/Night_Shift/tools/weapon.mjs.
import { mkdirSync, writeFileSync } from 'node:fs';
const positions = [], normals = [];
const ring = [[-.0245,-.035],[.0245,-.035],[.0325,-.027],[.0325,.027],[.0245,.035],[-.0245,.035],[-.0325,.027],[-.0325,-.027]];
function tri(a,b,c,n) { positions.push(...a,...b,...c); normals.push(...n,...n,...n); }
for (let i=0;i<ring.length;i++) {
  const a=ring[i], b=ring[(i+1)%ring.length], dx=b[0]-a[0], dy=b[1]-a[1], len=Math.hypot(dx,dy);
  const n=[dy/len,-dx/len,0];
  const p=[...a,-.135],q=[...b,-.135],r=[...b,.135],s=[...a,.135];
  tri(p,q,r,n);tri(p,r,s,n);
  tri([0,0,.135],s,r,[0,0,1]);
  tri([0,0,-.135],q,p,[0,0,-1]);
}
const times=[0,.008,.018,.025,.04,.06,.085];
const travel=[0,.025,.055,.055,.045,.018,0];
const uvs=positions.flatMap((v,i)=>i%3===0 ? [v/.065+.5,(positions[i+2]+.135)/.27] : []);
const arrays=[positions,normals,times,travel.flatMap(z=>[0,0,z]),uvs];
const views=[], chunks=[];
let offset=0;
for(const values of arrays){
  const bytes=Buffer.alloc(values.length*4);
  values.forEach((v,i)=>bytes.writeFloatLE(v,i*4));
  views.push({buffer:0,byteOffset:offset,byteLength:bytes.length});
  chunks.push(bytes);offset+=bytes.length;
}
const doc={
  asset:{version:'2.0',generator:'Mtek room-clearer original weapon'},
  buffers:[{byteLength:offset}],bufferViews:views,
  accessors:[
    {bufferView:0,componentType:5126,count:positions.length/3,type:'VEC3',min:[-.0325,-.035,-.135],max:[.0325,.035,.135]},
    {bufferView:1,componentType:5126,count:normals.length/3,type:'VEC3'},
    {bufferView:2,componentType:5126,count:times.length,type:'SCALAR',min:[0],max:[.085]},
    {bufferView:3,componentType:5126,count:times.length,type:'VEC3'},
    {bufferView:4,componentType:5126,count:uvs.length/2,type:'VEC2'},
  ],
  meshes:[{name:'Slide',primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:4}}]}],
  nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0,
  animations:[{name:'Cycle',samplers:[{input:2,output:3,interpolation:'LINEAR'}],channels:[{sampler:0,target:{node:0,path:'translation'}}]}],
};
let json=Buffer.from(JSON.stringify(doc));
json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
const bin=Buffer.concat(chunks), header=Buffer.alloc(12), jh=Buffer.alloc(8), bh=Buffer.alloc(8);
header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+bin.length,8);
jh.writeUInt32LE(json.length);jh.writeUInt32LE(0x4e4f534a,4);
bh.writeUInt32LE(bin.length);bh.writeUInt32LE(0x004e4942,4);
mkdirSync(new URL('../models/',import.meta.url),{recursive:true});
writeFileSync(new URL('../models/slide.glb',import.meta.url),Buffer.concat([header,jh,json,bh,bin]));
