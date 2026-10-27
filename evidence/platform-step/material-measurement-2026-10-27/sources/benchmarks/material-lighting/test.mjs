import assert from "node:assert/strict";
import {makeContent} from "./assets.mjs";
import {describeScene,protocol,mtekSource,panorama} from "./scenes.mjs";
import {ReferenceParticles} from "./particles.mjs";
import {compareImages,regionsFor} from "./metrics.mjs";
import {AllPassTimer,summarizePasses} from "./gpu-timer.mjs";
import {readProduct,verifyProduct} from "./product-asset.mjs";
const product=await readProduct();assert.equal(product.metadata.vertices,2549);assert.equal(product.metadata.indices,13530);
const corrupted=Buffer.from(product.bytes);corrupted[corrupted.length-1]^=1;assert.throws(()=>verifyProduct(corrupted),/hash mismatch/);
const productScene=describeScene("product","standard");assert(mtekSource(productScene).includes('PRODUCT.node_rotation("WaterBottle")'));
assert(mtekSource(productScene,{control:true}).includes("Product0.material.normal_scale = 0.0"));
const a=makeContent(),b=makeContent();assert.deepEqual(a,b);assert.equal(a.readUInt32LE(8),a.length);
for(const name of protocol.scenes)for(const quality of Object.keys(protocol.profiles)){
  const s=describeScene(name,quality);assert(s.objects.length>0);assert(mtekSource(s).includes("ambient_intensity: 0.0"));assert(regionsFor(s).every(r=>r.width>0&&r.height>0));
  const e=panorama(quality);assert.equal(e.data.length,e.width*e.height*4);assert(e.data.every(Number.isFinite));
}
const scene=describeScene("particles","standard"),p=new ReferenceParticles(scene.emitters,scene.profile.particleRate),q=new ReferenceParticles(scene.emitters,scene.profile.particleRate);
for(let i=0;i<120;i++){p.advance(1/60);q.advance(1/60);}assert.equal(p.count,240);assert.deepEqual(p.emitters,q.emitters);
const zero=new Uint8Array(40*40*4),solid=Uint8Array.from(zero,(_,i)=>i%4===3?255:100),other=Uint8Array.from(solid,(v,i)=>i%4===0?255:v);
assert(compareImages(solid,solid,40,40).passed);assert(!compareImages(solid,other,40,40).passed);
const blank=Uint8Array.from(zero,(_,i)=>i%4===3?255:[17,26,38][i%4]);assert(!compareImages(blank,blank,40,40).passed);
assert.throws(()=>compareImages(solid,solid,1,1));
const summary=summarizePasses([100n,300n,1000n,1300n],[{kind:"render",encoder:0},{kind:"compute",encoder:1}]);assert.equal(summary.milliseconds,.0005);assert.equal(summary.encoders,2);
assert.throws(()=>summarizePasses([1n,0n],[{encoder:0}]));assert.throws(()=>summarizePasses([0n,0n],[{encoder:0}]));assert.throws(()=>summarizePasses([1n,2n],[]));
class Encoder {beginRenderPass(settings){return settings;}beginComputePass(settings){return settings;}}
const buffer=()=>({destroy(){}}),device={features:new Set(["timestamp-query"]),createQuerySet:()=>({destroy(){}}),createBuffer:buffer},original=Encoder.prototype.beginRenderPass,timer=new AllPassTimer(device,Encoder.prototype),one=new Encoder(),two=new Encoder();
timer.begin();const first=one.beginRenderPass({label:"first"}),second=two.beginComputePass({label:"second"});assert.equal(first.timestampWrites.beginningOfPassWriteIndex,0);assert.equal(second.timestampWrites.beginningOfPassWriteIndex,2);assert.equal(timer.encoders.size,2);assert.equal(timer.passes.length,2);
assert.throws(()=>timer.begin());assert.throws(()=>one.beginRenderPass({timestampWrites:{}}));timer.active=false;timer.dispose();assert.equal(Encoder.prototype.beginRenderPass,original);
console.log("Deterministic content, ten workload/profile definitions, seeded particles, projected regions and negative visual controls passed");
