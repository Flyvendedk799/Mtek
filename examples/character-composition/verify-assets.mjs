import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,writeFile,mkdir,open} from "node:fs/promises";
import {resolve,join} from "node:path";
import {parseGlb,readAccessor} from "./glb.mjs";
import {prepareComposition} from "./prepare.mjs";
const here=import.meta.dirname,repo=resolve(here,"../.."),output=resolve(process.argv[2]??`target/composition-assets-${Date.now()}`),hash=b=>createHash("sha256").update(b).digest("hex");
await mkdir(output,{recursive:true});const path=join(output,"assets.json"),handle=await open(path,"wx");await handle.close();
const report={format:"mtek-character-composition-derivation-check/1",startedAt:new Date().toISOString(),status:"running"};
try{
  const first=await prepareComposition(),sourceBytes=await readFile(join(here,"scene/models/Source.glb")),targetBytes=await readFile(join(here,"scene/models/LongLegs.glb")),originalBytes=await readFile(join(repo,"benchmarks/runtime/animation/assets/CesiumMan/CesiumMan.glb"));
  const original=parseGlb(originalBytes),source=parseGlb(sourceBytes),target=parseGlb(targetBytes);
  assert.deepEqual(source.bin.subarray(0,original.bin.length),original.bin,"Source derivative changed original binary data");
  const walk={...source.json.animations.find(a=>a.name==="Walk")};if(original.json.animations[0].name===undefined)delete walk.name;else walk.name=original.json.animations[0].name;assert.deepEqual(walk,original.json.animations[0]);
  assert.deepEqual(source.json.meshes,original.json.meshes);assert.deepEqual(source.json.materials,original.json.materials);
  for(const glb of [source,target])for(const image of original.json.images){const a=original.json.bufferViews[image.bufferView],b=glb.json.bufferViews[image.bufferView];assert.deepEqual(glb.bin.subarray(b.byteOffset,b.byteOffset+b.byteLength),original.bin.subarray(a.byteOffset,a.byteOffset+a.byteLength));}
  report.original={sha256:hash(originalBytes),bytes:originalBytes.length,walkChannels:walk.channels.length,binaryPrefixUnchanged:true,textureBytesUnchanged:true};
  report.proportions=[];
  for(const [name,multiplier] of Object.entries(first.retarget.nodeTranslationScales)){
    const a=source.json.nodes.find(n=>n.name===name),b=target.json.nodes.find(n=>n.name===name);assert.deepEqual(a.rotation,b.rotation);assert.deepEqual(a.scale,b.scale);
    if(name==="Skeleton_torso_joint_1"){assert(Math.abs(b.translation[2]-a.translation[2]-.108)<1e-9);continue;}
    const ratio=Math.hypot(...b.translation)/Math.hypot(...a.translation);assert(Math.abs(ratio-multiplier)<1e-9);report.proportions.push({name,ratio,expected:multiplier});
  }
  report.mappedClips=[];
  for(const sourceClip of source.json.animations){
    const targetClip=target.json.animations.find(a=>a.name===sourceClip.name);assert(targetClip);assert.equal(targetClip.channels.length,sourceClip.channels.length);
    for(const channel of sourceClip.channels){
      const name=source.json.nodes[channel.target.node].name,mapped=targetClip.channels.find(c=>target.json.nodes[c.target.node].name===name&&c.target.path===channel.target.path);assert(mapped);
      const a=sourceClip.samplers[channel.sampler],b=targetClip.samplers[mapped.sampler];assert.equal(a.interpolation??"LINEAR",b.interpolation??"LINEAR");assert.deepEqual(readAccessor(source,a.input),readAccessor(target,b.input));
      if(channel.target.path==="scale")assert.deepEqual(readAccessor(source,a.output),readAccessor(target,b.output),"Retargeting changed original scale keys");
    }
    report.mappedClips.push({name:sourceClip.name,channels:sourceClip.channels.length,timesAndScaleKeysPreserved:true});
  }
  const second=await prepareComposition();assert.deepEqual(first,second);assert.equal(hash(await readFile(join(here,"scene/models/Source.glb"))),hash(sourceBytes));assert.equal(hash(await readFile(join(here,"scene/models/LongLegs.glb"))),hash(targetBytes));
  report.derivation=second;report.repeatedDerivationIdentical=true;report.status="passed";console.log("Original track/texture preservation, named clip mapping, changed proportions and repeated derivation passed");
}catch(error){report.status="failed";report.failure=String(error);console.error(error);process.exitCode=1;}
finally{report.sources=[];for(const name of ["verify-assets.mjs","glb.mjs","prepare.mjs"]){const bytes=await readFile(join(here,name));report.sources.push({path:`examples/character-composition/${name}`,sha256:hash(bytes)});}report.finishedAt=new Date().toISOString();await writeFile(path,JSON.stringify(report,null,2)+"\n");}
