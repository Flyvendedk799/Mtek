import { expect, test } from "../../support/fixtures.ts";
import { writeRecord } from "../m4/configurator-support.ts";
import type { MtekApp, MtekMountOptions } from "../../../../packages/runtime-web/src/host/types.js";
import type { ExtensionContext } from "../../../../packages/runtime-web/src/host/extensions.js";

type Host = { __mtekMount(options: MtekMountOptions): Promise<MtekApp> };

test("mounted distance policies refresh poses when an actor approaches the active camera",async({page,gpu})=>{
  expect(gpu.available).toBe(true); await page.goto("/m4/animation_crowd/index.html");
  const result = await page.evaluate(async()=>{
    let context: ExtensionContext | undefined;
    const app=await (window as unknown as Host).__mtekMount({inputs:{count:1},test:{manualClock:true,renderTarget:{width:32,height:32}},extensions:[{
      id:"distance-policy",apiVersion:1,setup(c){context=c;const actor=c.readTransforms().find(actor=>actor.name==="Actor00")!;
        c.animation(actor.id)!.setUpdatePolicy([{distance:0,interval:0},{distance:10,interval:0.5}]);},
    }]});
    const actor=context!.readTransforms().find(actor=>actor.name==="Actor00")!,rig=context!.animation(actor.id)!;
    const initial=rig.revision;
    app.debug!.step(1,0.1);
    const far={revision:rig.revision,time:rig.clock.time(0),x:rig.jointPosition("Joint").x};
    context!.writeTransforms([{id:actor.id,position:{x:0,y:18,z:0}}]);
    app.debug!.step(1,0.1);
    await app.debug!.readPixels();
    const near={revision:rig.revision,time:rig.clock.time(0),x:rig.jointPosition("Joint").x};
    app.dispose();return {initial,far,near,disposed:app.debug!.counters()};
  });
  expect(result.far.revision).toBe(result.initial); expect(result.far.time).toBeCloseTo(0.1); expect(result.far.x).toBe(0);
  expect(result.near.revision).toBeGreaterThan(result.initial); expect(result.near.time).toBeCloseTo(0.2); expect(result.near.x).toBeCloseTo(0.28);
  expect(result.disposed["liveBuffers"]).toBe(0);
  writeRecord(`animation-distance-${test.info().project.name}.json`,result);
});

test("cohorts detach and rejoin without resource growth and rebuild after device loss",async({page,gpu})=>{
  expect(gpu.available).toBe(true);await page.goto("/m4/animation_crowd/index.html");
  const before=await page.evaluate(async()=>{
    const host=window as unknown as Host & {__cohort?:{app:MtekApp;diagnostics:string[];pixels:number[];buffers:number;checkpoints:number[]}};
    let context:ExtensionContext|undefined,epoch="",time=0;
    const diagnostics:string[]=[];
    const app=await host.__mtekMount({inputs:{count:10},onDiagnostic:d=>diagnostics.push(d.code),test:{manualClock:true,renderTarget:{width:80,height:80},recovery:{delaysMs:[0,0,0]}},extensions:[{
      id:"recovering-cohorts",apiVersion:1,setup(c){context=c;},beforeFrame(c){
        const actors=c.readTransforms().filter(actor=>actor.name.startsWith("Actor")).sort((a,b)=>a.name.localeCompare(b.name));
        if(epoch!==actors[0]!.id){epoch=actors[0]!.id;c.shareAnimation(epoch,actors.slice(1).map(actor=>actor.id));c.animation(epoch)!.clock.seek(0,time);c.animation(epoch)!.evaluate();}
      },afterFrame(c){time=c.animation(epoch)!.clock.time(0);},
    }]});
    app.debug!.step(1,0.05);await app.debug!.readPixels();
    const actors=context!.readTransforms().filter(actor=>actor.name.startsWith("Actor")).sort((a,b)=>a.name.localeCompare(b.name));
    const buffers=app.debug!.counters()["liveBuffers"]!,checkpoints:number[]=[];
    for(let i=0;i<5;i++){
      context!.detachAnimation(actors[1]!.id).transition("Slide",0,true,1);app.debug!.step(1,0.01);
      if(app.debug!.counters()["drawCalls"]!==2)throw new Error("Detached actor was not drawn separately");
      context!.shareAnimation(actors[0]!.id,[actors[1]!.id]);app.debug!.step(1,0.01);await app.debug!.readPixels();
      checkpoints.push(app.debug!.counters()["liveBuffers"]!);
    }
    const pixels=Array.from((await app.debug!.readPixels()).data);
    host.__cohort={app,diagnostics,pixels,buffers,checkpoints};app.debug!.loseDevice();return {buffers,checkpoints};
  });
  await page.waitForFunction(()=>{const h=(window as unknown as {__cohort:{app:MtekApp;diagnostics:string[]}}).__cohort;return h.app.state==="running"&&h.diagnostics.includes("MTEK-W8061");});
  const after=await page.evaluate(async()=>{
    const h=(window as unknown as {__cohort:{app:MtekApp;pixels:number[]}}).__cohort;
    h.app.debug!.step(1,0);const pixels=(await h.app.debug!.readPixels()).data;
    let error=0;for(let i=0;i<pixels.length;i++)error=Math.max(error,Math.abs(pixels[i]!-h.pixels[i]!));
    const counters=h.app.debug!.counters();h.app.dispose();return {error,counters,disposed:h.app.debug!.counters()};
  });
  expect(before.checkpoints).toEqual(Array(5).fill(before.buffers));expect(after.error).toBe(0);expect(after.counters["drawCalls"]).toBe(1);
  for(const key of ["liveBuffers","liveTextures","livePipelines","liveBindGroups","liveShaderModules","liveListeners"])expect(after.disposed[key],key).toBe(0);
  writeRecord(`crowd-recovery-${test.info().project.name}.json`,{before,after});
});

for (const [count, groups] of [[1, 1], [10, 1], [50, 5]] as const) {
  test(`${count} actors in ${groups} pose cohorts match independent rendering and release shared resources`, async ({ page, gpu }) => {
    expect(gpu.available).toBe(true);
    await page.goto("/m4/animation_crowd/index.html");
    const result = await page.evaluate(async ({ count, groups }) => {
      const host = window as unknown as Host;
      const capture = async (share: boolean, disableInstancing: boolean) => {
        let initialized = false, context: ExtensionContext | undefined;
        const app = await host.__mtekMount({ inputs: { count }, test: { manualClock: true, renderTarget: { width: 160, height: 160 }, disableInstancing },
          extensions: [{ id: "pose-cohorts", apiVersion: 1, setup(c) { context = c; }, beforeFrame(c) {
            if (initialized) return;
            initialized = true;
            const actors = c.readTransforms().filter(actor => actor.name.startsWith("Actor")).sort((a,b)=>a.name.localeCompare(b.name));
            for (let group = 0; group < groups; group++) {
              const members = actors.filter((_, i) => i % groups === group);
              for (const member of members) {
                const player = c.animation(member.id)!;
                player.clock.seek(0,group / groups); player.evaluate();
              }
              if (share) c.shareAnimation(members[0]!.id,members.slice(1).map(member=>member.id));
            }
          } }] });
        app.debug!.step(1,0.1);
        const before = app.debug!.counters()["uploadBytes"]!;
        app.debug!.step(1,0.1);
        const pixels = Array.from((await app.debug!.readPixels()).data), counters = app.debug!.counters();
        const first = context!.readTransforms().find(actor => actor.name === "Actor00")!;
        const time = context!.animation(first.id)!.clock.time(0);
        app.dispose();
        return { pixels, counters, time, uploaded: counters["uploadBytes"]! - before, disposed: app.debug!.counters() };
      };
      return { independent: await capture(false,false), sharedIndividual: await capture(true,true), sharedInstanced: await capture(true,false) };
    }, { count, groups });
    for (const actual of [result.sharedIndividual,result.sharedInstanced]) {
      let error = 0;
      for (let i=0;i<actual.pixels.length;i++) error = Math.max(error,Math.abs(actual.pixels[i]! - result.independent.pixels[i]!));
      expect(error).toBe(0);
      expect(actual.time).toBeCloseTo(0.2);
      for (const key of ["liveBuffers","liveTextures","livePipelines","liveBindGroups","liveShaderModules","liveListeners"]) expect(actual.disposed[key],key).toBe(0);
    }
    expect(result.independent.counters["drawCalls"]).toBe(count);
    expect(result.sharedIndividual.counters["drawCalls"]).toBe(count);
    expect(result.sharedInstanced.counters["drawCalls"]).toBe(groups);
    expect(result.sharedInstanced.counters["instancedDraws"]).toBe(count === groups ? 0 : groups);
    expect(result.independent.uploaded - result.sharedInstanced.uploaded).toBe((count - groups) * 64);
    const colored = result.sharedInstanced.pixels.filter((value,i)=>i%4!==3 && value>0).length;
    expect(colored).toBeGreaterThan(count * 3);
    writeRecord(`crowd-${count}-${groups}-${test.info().project.name}.json`, {
      count, groups, maximumPixelError: 0, colored,
      independent: { counters:result.independent.counters,uploaded:result.independent.uploaded },
      sharedIndividual: { counters:result.sharedIndividual.counters,uploaded:result.sharedIndividual.uploaded },
      sharedInstanced: { counters:result.sharedInstanced.counters,uploaded:result.sharedInstanced.uploaded,disposed:result.sharedInstanced.disposed },
    });
  });
}
