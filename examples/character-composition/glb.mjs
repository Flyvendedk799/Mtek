// Deterministic example-only derivatives. The original pinned asset is never rewritten.
import {Matrix4,Matrix3,Vector3,Quaternion} from "three";
export function parseGlb(bytes){
  if(bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length)throw new Error("Invalid GLB");
  const size=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+size).toString()),offset=20+size;
  if(bytes.readUInt32LE(offset+4)!==0x004e4942)throw new Error("Expected embedded binary chunk");
  return {json,bin:Buffer.from(bytes.subarray(offset+8,offset+8+bytes.readUInt32LE(offset)))};
}
export function readAccessor(glb,index){
  const a=glb.json.accessors[index],view=glb.json.bufferViews[a.bufferView],width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type],size={5121:1,5123:2,5125:4,5126:4}[a.componentType];
  if(!width||!size||a.sparse)throw new Error("Unsupported derivative accessor");
  const data=new DataView(glb.bin.buffer,glb.bin.byteOffset,glb.bin.byteLength),out=[];
  for(let i=0;i<a.count;i++)for(let c=0;c<width;c++){
    const at=(view.byteOffset??0)+(a.byteOffset??0)+i*(view.byteStride??size*width)+c*size;
    out.push(a.componentType===5126?data.getFloat32(at,true):a.componentType===5125?data.getUint32(at,true):a.componentType===5123?data.getUint16(at,true):data.getUint8(at));
  }
  return out;
}
export function appendAccessor(glb,values,type){
  const width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[type],padding=(4-glb.bin.length%4)%4,offset=glb.bin.length+padding,data=Buffer.alloc(values.length*4);
  values.forEach((value,i)=>data.writeFloatLE(Math.fround(value),i*4));glb.bin=Buffer.concat([glb.bin,Buffer.alloc(padding),data]);
  const view=glb.json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:data.length})-1,accessor={bufferView:view,componentType:5126,count:values.length/width,type};
  if(type!=="MAT4"){
    accessor.min=Array.from({length:width},(_,c)=>values.filter((_,i)=>i%width===c).reduce((a,b)=>Math.min(a,b),Infinity));
    accessor.max=Array.from({length:width},(_,c)=>values.filter((_,i)=>i%width===c).reduce((a,b)=>Math.max(a,b),-Infinity));
  }
  return glb.json.accessors.push(accessor)-1;
}
export function encodeGlb(glb){
  glb.json.buffers[0].byteLength=glb.bin.length;
  const json=Buffer.from(JSON.stringify(glb.json)),jp=(4-json.length%4)%4,bp=(4-glb.bin.length%4)%4,jchunk=Buffer.concat([json,Buffer.alloc(jp,32)]),bchunk=Buffer.concat([glb.bin,Buffer.alloc(bp)]),out=Buffer.alloc(28+jchunk.length+bchunk.length);
  out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(jchunk.length,12);out.writeUInt32LE(0x4e4f534a,16);jchunk.copy(out,20);
  const offset=20+jchunk.length;out.writeUInt32LE(bchunk.length,offset);out.writeUInt32LE(0x004e4942,offset+4);bchunk.copy(out,offset+8);return out;
}
export function globalBinds(json){
  const parents=json.nodes.map(()=>-1);json.nodes.forEach((n,i)=>(n.children??[]).forEach(child=>{parents[child]=i;}));
  const matrices=[];
  const get=i=>{
    if(matrices[i])return matrices[i];const n=json.nodes[i],local=n.matrix?new Matrix4().fromArray(n.matrix):new Matrix4().compose(new Vector3().fromArray(n.translation??[0,0,0]),new Quaternion().fromArray(n.rotation??[0,0,0,1]).normalize(),new Vector3().fromArray(n.scale??[1,1,1]));
    matrices[i]=parents[i]<0?local:get(parents[i]).clone().multiply(local);return matrices[i];
  };json.nodes.forEach((_,i)=>get(i));return matrices;
}
export function addDemoClips(glb){
  const pelvis=glb.json.nodes.findIndex(n=>n.name==="Skeleton_torso_joint_1"),parent=glb.json.nodes.find(n=>(n.children??[]).includes(pelvis));
  if(pelvis<0||!parent||glb.json.nodes.some(n=>n.name==="MotionRoot"))throw new Error("Cannot add the explicit trajectory root");
  const root=glb.json.nodes.push({name:"MotionRoot",translation:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1],children:[pelvis]})-1;
  parent.children=parent.children.map(index=>index===pelvis?root:index);glb.json.skins[0].skeleton=root;
  const original=structuredClone(glb.json.animations[0]);original.name="Walk";const clips=[original];
  const idle=structuredClone(original);idle.name="Idle";
  for(const s of idle.samplers){const times=readAccessor(glb,s.input),values=readAccessor(glb,s.output),type=glb.json.accessors[s.output].type,width=type==="VEC4"?4:3;s.output=appendAccessor(glb,times.flatMap(()=>values.slice(0,width)),type);}
  const run=structuredClone(original);run.name="Run";for(const s of run.samplers)s.input=appendAccessor(glb,readAccessor(glb,s.input).map(t=>t*.55),"SCALAR");
  const travel=structuredClone(original);travel.name="Travel";
  const duration=Math.max(...original.samplers.flatMap(s=>readAccessor(glb,s.input)));
  travel.channels.push({sampler:travel.samplers.length,target:{node:root,path:"translation"}});
  travel.samplers.push({input:appendAccessor(glb,[0,duration],"SCALAR"),output:appendAccessor(glb,[0,0,0,.3*duration,0,0],"VEC3"),interpolation:"LINEAR"});
  const rotationClip=(name,definitions)=>{
    const clip={name,samplers:[],channels:[]};
    for(const [nodeName,axis,angles] of definitions){
      const node=glb.json.nodes.findIndex(n=>n.name===nodeName);if(node<0)throw new Error("Missing demo bone "+nodeName);
      const bind=new Quaternion().fromArray(glb.json.nodes[node].rotation??[0,0,0,1]).normalize(),values=angles.flatMap(angle=>bind.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(...axis),angle)).toArray());
      clip.channels.push({sampler:clip.samplers.length,target:{node,path:"rotation"}});clip.samplers.push({input:appendAccessor(glb,[0,.5,1,1.5,2],"SCALAR"),output:appendAccessor(glb,values,"VEC4"),interpolation:"LINEAR"});
    }return clip;
  };
  clips.push(idle,run,travel,
    rotationClip("UpperAction",[["torso_joint_3",[1,0,0],[0,.08,-.08,.08,0]],["Skeleton_arm_joint_R",[0,0,1],[0,.25,.45,.25,0]]]),
    rotationClip("Nod",[["Skeleton_neck_joint_2",[0,1,0],[0,.14,0,-.14,0]]]));
  glb.json.animations=clips;glb.json.asset.extras={...(glb.json.asset.extras??{}),mtekExampleDerivative:"Original Walk; generated hold, time-scaled Run, linear root Travel and procedural UpperAction/Nod. Not additional artist-authored motion."};
}
export function proportionVariant(source){
  const glb={json:structuredClone(source.json),bin:Buffer.from(source.bin)},sourceBinds=globalBinds(source.json),multipliers={};
  for(const node of glb.json.nodes){
    const leg=/^leg_joint_[LR]_[235]$/.test(node.name??""),arm=/^Skeleton_arm_joint_[LR]__/.test(node.name??"");
    const scale=leg?1.2:arm?.9:1;if(scale!==1&&node.translation){node.translation=node.translation.map(v=>v*scale);multipliers[node.name]=scale;}
    if(node.name==="Skeleton_torso_joint_1"){node.translation[2]+=.108;multipliers[node.name]=1;}
  }
  const targetBinds=globalBinds(glb.json),skin=glb.json.skins[0],meshNode=glb.json.nodes.findIndex(n=>n.mesh===0),inverseMesh=targetBinds[meshNode].clone().invert(),inverseBind=readAccessor(source,skin.inverseBindMatrices);
  const changes=skin.joints.map((joint,i)=>inverseMesh.clone().multiply(targetBinds[joint]).multiply(new Matrix4().fromArray(inverseBind.slice(i*16,i*16+16)))),normals=changes.map(m=>new Matrix3().getNormalMatrix(m));
  const primitive=glb.json.meshes[0].primitives[0],attributes=primitive.attributes,positions=readAccessor(source,attributes.POSITION),originalNormals=readAccessor(source,attributes.NORMAL),indices=readAccessor(source,attributes.JOINTS_0),weights=readAccessor(source,attributes.WEIGHTS_0),out=[],nout=[];
  let maximumDisplacement=0;
  for(let i=0;i<positions.length/3;i++){
    const p=new Vector3().fromArray(positions,i*3),n=new Vector3().fromArray(originalNormals,i*3),q=new Vector3(),r=new Vector3();
    for(let j=0;j<4;j++){const weight=weights[i*4+j],index=indices[i*4+j];if(weight){q.addScaledVector(p.clone().applyMatrix4(changes[index]),weight);r.addScaledVector(n.clone().applyMatrix3(normals[index]),weight);}}
    maximumDisplacement=Math.max(maximumDisplacement,q.distanceTo(p));out.push(...q.toArray());nout.push(...r.normalize().toArray());
  }
  attributes.POSITION=appendAccessor(glb,out,"VEC3");attributes.NORMAL=appendAccessor(glb,nout,"VEC3");
  skin.inverseBindMatrices=appendAccessor(glb,skin.joints.flatMap(joint=>targetBinds[joint].clone().invert().multiply(targetBinds[meshNode]).toArray()),"MAT4");
  glb.json.asset.extras={...(glb.json.asset.extras??{}),mtekProportionDerivative:{legs:1.2,arms:.9,rootLift:.108}};
  if(maximumDisplacement<.05)throw new Error("Proportion derivative did not alter geometry");
  return {glb,multipliers,maximumDisplacement};
}
export function writeRetargetedClips(glb,skin){
  glb.json.animations=skin.clips.map(clip=>{
    const result={name:clip.name,samplers:[],channels:[]};
    for(const c of clip.channels){const node=glb.json.nodes.findIndex(n=>n.name===skin.nodes[c.node].name);if(node<0)throw new Error("Unmapped derivative clip node");
      result.channels.push({sampler:result.samplers.length,target:{node,path:c.path}});result.samplers.push({input:appendAccessor(glb,c.times,"SCALAR"),output:appendAccessor(glb,c.values,c.path==="rotation"?"VEC4":"VEC3"),interpolation:c.interpolation.toUpperCase()});}
    return result;
  });
}
export function footProfile(glb){
  const primitive=glb.json.meshes[0].primitives[0],positions=readAccessor(glb,primitive.attributes.POSITION),indices=readAccessor(glb,primitive.attributes.JOINTS_0),weights=readAccessor(glb,primitive.attributes.WEIGHTS_0),skin=glb.json.skins[0],result={};
  for(const [side,key] of [["L","left"],["R","right"]]){
    let minimum=Infinity,vertices=0;
    for(let v=0;v<positions.length/3;v++){let weight=0;for(let j=0;j<4;j++)if(new RegExp(`^leg_joint_${side}_[35]$`).test(glb.json.nodes[skin.joints[indices[v*4+j]]].name))weight+=weights[v*4+j];
      if(weight>.8){vertices++;minimum=Math.min(minimum,positions[v*3+2]);}}
    if(vertices<20||!Number.isFinite(minimum))throw new Error("Missing explicit foot vertices");result[key]={minimum,vertices};
  }return result;
}
