import assert from "node:assert/strict";
import {readFile,writeFile,mkdir,open} from "node:fs/promises";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {build} from "esbuild";
import {prepareComposition} from "./prepare.mjs";
const here=import.meta.dirname,repo=resolve(here,"../.."),output=resolve(process.argv[2]??`target/composition-cpu-${Date.now()}`);
await mkdir(output,{recursive:true});const path=join(output,"cpu.json"),handle=await open(path,"wx");await handle.close();
const report={format:"mtek-production-composition-cpu/1",startedAt:new Date().toISOString(),status:"running",cases:[],interruptions:[],restorations:[]};
try{
  report.derivation=await prepareComposition();
  await build({entryPoints:[join(here,"controller.ts")],outfile:join(output,"controller.mjs"),bundle:true,platform:"node",format:"esm"});
  const {CompositionController,defaults}=await import(pathToFileURL(join(output,"controller.mjs"))),{createAnimationController}=await import(pathToFileURL(join(repo,"packages/runtime-web/dist/runtime.js")));
  const manifest=JSON.parse(await readFile(join(here,".out/scene/program.manifest.json"),"utf8"));
  const geometry=new Map();
  for(const mesh of manifest.meshes.filter(m=>m.kind==="asset")){
    const asset=manifest.assets.find(a=>a.url===mesh.asset),primitive=asset.primitives[mesh.primitive],bytes=await readFile(join(here,".out/scene",mesh.asset)),positions=new Float32Array(bytes.buffer,bytes.byteOffset+primitive.offsets.position,primitive.vertexCount*3),vertices={};
    for(const side of ["L","R"]){vertices[side]=[];for(let v=0;v<primitive.vertexCount;v++){let weight=0;for(let j=0;j<4;j++)if(new RegExp(`^leg_joint_${side}_[1235]$`).test(mesh.skin.nodes[mesh.skin.joints[mesh.skin.indices[v][j]]].name))weight+=mesh.skin.weights[v][j];if(weight>.5)vertices[side].push(v);}}
    geometry.set(mesh.id,{positions,vertices});
  }
  const rates={fps30:[1/30],fps60:[1/60],fps144:[1/144],jitter:[.006,.024,.04,.01]};
  for(const mesh of manifest.meshes.filter(m=>m.kind==="asset"))for(const root of [false,true])for(const additive of [false,true])for(const [rate,pattern] of Object.entries(rates)){
    const animation=createAnimationController(mesh.skin),profile=report.derivation.footProfiles[mesh.skin.nodes.find(n=>n.name==="Skeleton_torso_joint_1").translation[2]<.7?"Original":"Longer"],c=new CompositionController(animation.player,{x:0,y:0,z:0},{left:profile.left.minimum,right:profile.right.minimum});c.configure({...defaults,root,additive});
    const maxima={},orientationMaxima={},soles={L:{minimum:Infinity,maximum:-Infinity},R:{minimum:Infinity,maximum:-Infinity}},markers=[0,0],duration=6;let time=0,frames=0;
    try{
      while(time<duration-1e-12){
        const delta=Math.min(pattern[frames%pattern.length],duration-time);c.beforeFrame(delta);animation.update(delta,true);
        for(const r of c.residuals()){maxima[r.name]=Math.max(maxima[r.name]??0,r.distance);orientationMaxima[r.name]=Math.max(orientationMaxima[r.name]??0,r.orientationError);}
        const geo=geometry.get(mesh.id);
        for(const side of ["L","R"]){
          let minimum=Infinity;for(const v of geo.vertices[side]){let z=0;for(let j=0;j<4;j++){const at=mesh.skin.indices[v][j]*16,w=mesh.skin.weights[v][j],p=animation.player.palette;z+=w*(p[at+2]*geo.positions[v*3]+p[at+6]*geo.positions[v*3+1]+p[at+10]*geo.positions[v*3+2]+p[at+14]);}minimum=Math.min(minimum,z*2+c.origin.y);}
          const goal=c.goals.find(g=>g.name===(side==="L"?"leftFoot":"rightFoot")),surface=goal.world.y-2*(c.bind.get(goal.node).position.z-profile[side==="L"?"left":"right"].minimum),offset=minimum-surface;
          soles[side].minimum=Math.min(soles[side].minimum,offset);soles[side].maximum=Math.max(soles[side].maximum,offset);
        }
        const p=animation.player;for(const [index,phase] of [.25,.75].entries())if(p.locomotion.active?p.locomotion.crossedPhase(phase):p.clock.crossed(0,p.clock.duration(0)*phase))markers[index]++;
        assert(p.pose.every(Number.isFinite));time+=delta;frames++;
      }
      // Apply the last completed frame's extracted motion without advancing time.
      c.beforeFrame(0);animation.update(0,true);
      const p=animation.player,rootIndex=p.skin.nodes.findIndex(n=>n.name==="MotionRoot"),hipIndex=p.skin.nodes.findIndex(n=>n.name==="Skeleton_torso_joint_1");
      const row={mesh:mesh.id,root,additive,rate,frames,time,maxima,orientationMaxima,soles,markers,origin:c.origin,extracted:c.extracted,rootPose:Array.from(p.pose.slice(rootIndex*10,rootIndex*10+3)),hipPose:Array.from(p.pose.slice(hipIndex*10,hipIndex*10+3)),layerMasks:p.inspect().layers.map(l=>({id:l.id,mask:l.mask,additive:l.additive,weight:l.weight}))};report.cases.push(row);
      assert(Math.max(...Object.values(maxima))<.002,`Target residual exceeds 2 mm: ${JSON.stringify(row)}`);
      assert(Math.max(...Object.values(orientationMaxima))<.0001,`Orientation residual exceeds 0.1 mrad: ${JSON.stringify(row)}`);
      for(const sole of Object.values(soles))assert(sole.minimum>-.003&&sole.maximum<.003,`Deformed sole differs from its surface/lift by more than 3 mm: ${JSON.stringify(row)}`);
      assert.deepEqual(markers,[3,3]);
      if(root){assert(Math.abs(c.origin.x-.618*(duration-.1))<1e-6);assert(Math.abs(c.origin.z)<1e-8);assert(Math.abs(c.extracted.x-.3*(duration-.1))<1e-6);assert.deepEqual(row.rootPose,[0,0,0]);assert(p.pose[hipIndex*10+2]<p.skin.nodes[hipIndex].translation[2]-.03,"Pelvis adjustment was discarded by root ownership");}
      assert.equal(p.inspect().layers[0].mask[p.skin.nodes.findIndex(n=>n.name==="leg_joint_R_2")],0);
    }finally{animation.dispose();}
  }
  for(const mesh of manifest.meshes.filter(m=>m.kind==="asset"))for(const root of [false,true]){
    const profile=report.derivation.footProfiles[mesh.skin.nodes.find(n=>n.name==="Skeleton_torso_joint_1").translation[2]<.7?"Original":"Longer"],minima={left:profile.left.minimum,right:profile.right.minimum},a=createAnimationController(mesh.skin),c=new CompositionController(a.player,{x:0,y:0,z:0},minima);
    const b=createAnimationController(mesh.skin),d=new CompositionController(b.player,{x:0,y:0,z:0},minima);
    try{
      c.configure({...defaults,root});for(let i=0;i<120;i++){c.beforeFrame(1/60);a.update(1/60,true);}c.beforeFrame(0);a.update(0,true);
      const state=c.captureForRecovery();assert(state.transitionComplete);d.restore(state);d.beforeFrame(0);b.update(0,true);
      const maximum=Math.max(...b.player.palette.map((value,i)=>Math.abs(value-a.player.palette[i])));report.restorations.push({mesh:mesh.id,root,maximum,originError:Math.hypot(c.origin.x-d.origin.x,c.origin.y-d.origin.y,c.origin.z-d.origin.z)});
      assert(maximum<2e-6);assert.deepEqual(c.origin,d.origin);
    }finally{a.dispose();b.dispose();}
  }
  for(const mesh of manifest.meshes.filter(m=>m.kind==="asset")){
    const animation=createAnimationController(mesh.skin),profile=report.derivation.footProfiles[mesh.skin.nodes.find(n=>n.name==="Skeleton_torso_joint_1").translation[2]<.7?"Original":"Longer"],c=new CompositionController(animation.player,{x:0,y:0,z:0},{left:profile.left.minimum,right:profile.right.minimum});
    try{
      for(let i=0;i<20;i++){c.beforeFrame(1/60);animation.update(1/60,true);}
      c.interrupt("Run",.4);c.beforeFrame(.12);animation.update(.12,true);const before=animation.player.pose.slice();c.interrupt("Idle",.3);const after=animation.player.pose.slice(),maximumJump=Math.max(...after.map((v,i)=>Math.abs(v-before[i])));
      report.interruptions.push({mesh:mesh.id,maximumJump});assert(maximumJump<1e-7,"Interrupted composition reapplied layers/procedural/IK");
    }finally{animation.dispose();}
  }
  report.status="passed";console.log(`${report.cases.length} production composition/rate cases and ${report.interruptions.length} interruptions passed`);
}catch(error){report.status="failed";report.failure=String(error);console.error(error);process.exitCode=1;}
finally{
  report.sources=[];for(const file of ["controller.ts","glb.mjs","prepare.mjs","verify-cpu.mjs","scene/src/main.mtek"]){const bytes=await readFile(join(here,file));report.sources.push({path:`examples/character-composition/${file}`,sha256:createHash("sha256").update(bytes).digest("hex")});}
  report.finishedAt=new Date().toISOString();await writeFile(path,JSON.stringify(report,null,2)+"\n");
}
