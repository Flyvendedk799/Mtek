import {test,expect} from "../../support/fixtures.ts";
import type {Page} from "@playwright/test";
import type {MtekApp,ExtensionContext} from "../../../../packages/runtime-web/src/runtime.js";
import type {InspectorController,InspectorOverlay} from "../../../../packages/inspector/src/index.js";
import {writeRecord} from "../m4/configurator-support.ts";

interface Studio {app:MtekApp;inspector:InspectorController;overlay:InspectorOverlay|undefined;context:ExtensionContext;diagnostics:string[];runtimeDiagnostics:string[];rebuild():Promise<void>}
interface StudioWindow extends Window {__inspectionStudio:Studio;__oldInspectionApp?:MtekApp;__sceneReads?:number}
test.use({viewport:{width:1280,height:1000},deviceScaleFactor:1.5});
const step = (page: Page, frames = 1, delta = 0): Promise<void> => page.evaluate(({frames,delta}) => (window as unknown as StudioWindow).__inspectionStudio.app.debug!.step(frames,delta),{frames,delta});
async function start(page: Page): Promise<void> {
  await page.goto("/inspection-studio/index.html?verify=1");
  await expect(page.locator("#status")).toHaveText("Live scene");
}
async function verifyIndependentPose(page: Page, theta: number, phi: number) {
  const report = await page.evaluate(({theta,phi}) => {
    const studio = (window as unknown as StudioWindow).__inspectionStudio, snapshot = studio.inspector.spatialSnapshot(), scene = snapshot.scene!, actor = scene.entities.find(e => e.id === snapshot.selectedId)!;
    const player = studio.context.animation(actor.id)!, lines = studio.overlay!.geometry().lines.filter(line => line.kind === "skeleton");
    // Independent source-scene transform, not the supplied world matrix or runtime math library.
    const c = Math.cos(theta), s = Math.sin(theta), k = 1/64;
    const expected = [c*1.1*k,0,-s*1.1*k,0,0,.9*k,0,0,s*1.3*k,0,c*1.3*k,0,-1,0,0,1];
    const matrixError = Math.max(...actor.worldMatrix.map((v,i) => Math.abs(v-expected[i]!)));
    const camera = {x:7*Math.cos(phi),y:3.8,z:7*Math.sin(phi)}, back = {x:camera.x,y:camera.y-.9,z:camera.z};
    const length = Math.hypot(back.x,back.y,back.z); back.x/=length; back.y/=length; back.z/=length;
    const horizontal = Math.hypot(back.x,back.z), right = {x:back.z/horizontal,y:0,z:-back.x/horizontal};
    const up = {x:back.y*right.z,y:back.z*right.x-back.x*right.z,z:-back.y*right.x}, f = 1/Math.tan(.85/2), aspect = scene.viewport.width/scene.viewport.height;
    const project = (name: string) => {
      const p = player.jointPosition(name), world = {x:-1+c*1.1*k*p.x+s*1.3*k*p.z,y:.9*k*p.y,z:-s*1.1*k*p.x+c*1.3*k*p.z};
      const dx=world.x-camera.x,dy=world.y-camera.y,dz=world.z-camera.z,depth=-(back.x*dx+back.y*dy+back.z*dz);
      return {x:(right.x*dx+right.y*dy+right.z*dz)*f/(depth*aspect),y:(up.x*dx+up.y*dy+up.z*dz)*f/depth,depth};
    };
    let expectedSegments=0,matchedSegments=0,maxProjectionError=0;
    for (const node of player.skin.nodes) {
      if (node.parent < 0) continue;
      const a=project(player.skin.nodes[node.parent]!.name),b=project(node.name);
      if ([a,b].some(p => p.depth < .1 || p.depth > 50 || Math.abs(p.x)>1 || Math.abs(p.y)>1) || Math.hypot(a.x-b.x,a.y-b.y)<.005) continue;
      expectedSegments++;
      const error = Math.min(...lines.map(line => Math.max(Math.abs(a.x-line.start.x),Math.abs(a.y-line.start.y),Math.abs(b.x-line.end.x),Math.abs(b.y-line.end.y))));
      if (error < .00005) matchedSegments++; maxProjectionError=Math.max(maxProjectionError,error);
    }
    return {matrixError,expectedSegments,matchedSegments,maxProjectionError,lines:lines.length,diagnostics:studio.diagnostics};
  },{theta,phi});
  expect(report.matrixError).toBeLessThan(.000001); expect(report.expectedSegments).toBeGreaterThan(10);
  expect(report.matchedSegments).toBe(report.expectedSegments); expect(report.maxProjectionError).toBeLessThan(.00005); expect(report.diagnostics).toEqual([]);
  return report;
}

test("production pose overlays match independent parent/camera transforms and resized content boxes", async ({page,gpu}) => {
  expect(gpu.available).toBe(true); if (test.info().project.name === "hardware") expect(gpu.record.gpu.adapter!.info.isFallbackAdapter).toBe(false);
  const errors:string[]=[]; page.on("pageerror",error => errors.push(error.message)); await start(page);
  await page.locator("#bounds").uncheck(); await step(page,1,.2);
  expect(await page.evaluate(() => {
    const canvas=document.querySelector("[data-mtek-inspector-overlay]")!.shadowRoot!.querySelector("canvas")!;
    return getComputedStyle(canvas).backgroundColor;
  })).toBe("rgba(0, 0, 0, 0)");
  const initial=await verifyIndependentPose(page,.15,.8);
  await page.locator("#parent").fill("0.75"); await page.locator("#camera").fill("1.4"); await step(page);
  const moved=await verifyIndependentPose(page,.75,1.4);
  await page.locator("#canvas").evaluate(canvas => {canvas.style.borderWidth="7px";canvas.style.padding="11px";});
  await page.setViewportSize({width:1150,height:900}); await step(page,2);
  await expect.poll(() => page.evaluate(() => {
    const target=document.querySelector<HTMLCanvasElement>("#canvas")!.getBoundingClientRect(),overlay=document.querySelector<HTMLCanvasElement>("[data-mtek-inspector-overlay]")!.getBoundingClientRect();
    return Math.max(Math.abs(overlay.x-target.x-18),Math.abs(overlay.y-target.y-18),Math.abs(overlay.width-target.width+36),Math.abs(overlay.height-target.height+36));
  })).toBeLessThan(.6);
  await step(page); const resized=await verifyIndependentPose(page,.75,1.4);
  await page.screenshot({path:test.info().outputPath("inspection-pose-overlay.png"),fullPage:true});
  expect(errors).toEqual([]); writeRecord(`inspection-pose-${test.info().project.name}.json`,{initial,moved,resized,errors,dpr:1.5});
});

test("layer/IK diagnostics and real physics contact overlays explain the composed scene", async ({page,gpu}) => {
  expect(gpu.available).toBe(true); await start(page);
  await page.locator("#layer").fill("0.6"); await page.locator("#lift").fill("2"); await page.locator("#grip").check(); await step(page,1,.12);
  const panel=page.locator("[data-mtek-inspector]");
  await panel.locator("summary").filter({hasText:/^Transitions, layers/}).click();
  await expect(panel.getByText(/upper-body · Run · override · weight 0.600/)).toBeVisible();
  const pose=await page.evaluate(() => {
    const s=(window as unknown as StudioWindow).__inspectionStudio,d=s.inspector.snapshot().animation!.diagnostics!;
    return {layers:d.layers.map(l=>({id:l.id,weight:l.weight,mask:l.mask})),ik:d.ik,procedural:d.proceduralOverride,ikLines:s.overlay!.geometry().lines.filter(l=>l.kind==="ik").length};
  });
  expect(pose.layers[0]!.weight).toBe(.6); expect(pose.layers[0]!.mask.some(w=>w===0)).toBe(true); expect(pose.layers[0]!.mask.some(w=>w===1)).toBe(true);
  expect(pose.procedural).toBe(true); expect(pose.ik).toHaveLength(1); expect(pose.ikLines).toBeGreaterThan(3);
  await step(page,60,1/60);
  await panel.getByRole("listbox",{name:"Scene entities"}).selectOption({label:"Crate"});
  await panel.getByText("World transforms, draw bounds and contacts",{exact:true}).click();
  const physics=await page.evaluate(() => {
    const s=(window as unknown as StudioWindow).__inspectionStudio,scene=s.inspector.spatialSnapshot().scene!,id=s.inspector.snapshot().selectedId!,body=scene.bodies.find(b=>b.entityId===id)!;
    const before=s.app.debug!.counters()["physicsSteps"]; s.context.inspectScene!(); const after=s.app.debug!.counters()["physicsSteps"];
    return {body,before,after,kinds:s.overlay!.geometry().lines.map(l=>l.kind),diagnostics:s.diagnostics};
  });
  expect(physics.body.active).toBe(true); expect(physics.body.collider.shape).toEqual({kind:"box",size:{x:.7,y:.7,z:.7}});
  expect(physics.body.contacts!.length).toBeGreaterThan(0); expect(physics.before).toBe(physics.after);
  expect(physics.kinds).toContain("collider"); expect(physics.kinds).toContain("contact"); expect(physics.diagnostics).toEqual([]);
  await expect(panel.getByText(/observed contacts/)).toBeVisible(); await page.screenshot({path:test.info().outputPath("inspection-contacts.png"),fullPage:true});
  writeRecord(`inspection-composition-${test.info().project.name}.json`,{pose,physics});
});

test("overlay disposal, source reset and device recovery preserve resource/lifetime boundaries", async ({page,gpu}) => {
  expect(gpu.available).toBe(true); await start(page);
  await page.evaluate(() => {
    const w=window as unknown as StudioWindow,c=w.__inspectionStudio.context,read=c.inspectScene!.bind(c);w.__sceneReads=0;
    c.inspectScene=()=>{w.__sceneReads!++;return read();};
  });
  await page.locator("#overlays").uncheck(); await step(page,3);
  expect(await page.evaluate(() => (window as unknown as StudioWindow).__sceneReads)).toBe(0);
  await expect(page.locator("[data-mtek-inspector-overlay]")).toHaveCount(0);
  await page.locator("#overlays").check(); await step(page);
  const before=await page.evaluate(() => {const s=(window as unknown as StudioWindow).__inspectionStudio;s.app.debug!.loseDevice();return s.overlay!.geometry().lines;});
  // "running" can still be the pre-loss state. Require the completed-recovery diagnostic as well.
  await expect.poll(() => page.evaluate(() => {const s=(window as unknown as StudioWindow).__inspectionStudio;return s.app.state === "running" && s.runtimeDiagnostics.includes("MTEK-W8061");})).toBe(true);
  await step(page); const after=await page.evaluate(() => (window as unknown as StudioWindow).__inspectionStudio.overlay!.geometry().lines);
  expect(after).toEqual(before);
  const oldId=await page.evaluate(() => {const s=(window as unknown as StudioWindow).__inspectionStudio,id=s.inspector.snapshot().selectedId!;s.app.debug!.pressKey("KeyR");s.app.debug!.step(1,.02);s.app.debug!.releaseKey("KeyR");return id;});
  await expect.poll(() => page.evaluate(old => {const s=(window as unknown as StudioWindow).__inspectionStudio;s.app.debug!.step(1,.11);return s.context.readTransforms().some(e=>e.id===old);},oldId)).toBe(false);
  expect(await page.evaluate(() => (window as unknown as StudioWindow).__inspectionStudio.inspector.spatialSnapshot().selectedId)).toBeNull();
  await page.evaluate(() => {const w=window as unknown as StudioWindow;w.__oldInspectionApp=w.__inspectionStudio.app;});
  await page.locator("#reset").click(); await expect(page.locator("#status")).toHaveText("Live scene");
  const disposed=await page.evaluate(() => (window as unknown as StudioWindow).__oldInspectionApp!.debug!.counters());
  for(const key of ["liveBuffers","liveTextures","liveSamplers","liveShaderModules","livePipelines","liveBindGroups","liveListeners"])expect(disposed[key],key).toBe(0);
  await expect(page.locator("[data-mtek-inspector-overlay]")).toHaveCount(1);
  writeRecord(`inspection-lifetime-${test.info().project.name}.json`,{overlayOffReads:0,recoveryExact:true,sourceReset:true,remount:true,disposed});
});

test("lighting studio exposes world bounds as an optional public-package overlay", async ({page,gpu}) => {
  expect(gpu.available).toBe(true); await page.goto("/lighting-studio/index.html");
  await expect(page.locator("#status")).toHaveText("Live · directional shadows + HDR IBL");
  await page.locator("#inspector").check(); const panel=page.locator("[data-mtek-inspector]");
  await panel.getByRole("listbox",{name:"Scene entities"}).selectOption({label:"Ceramic"}); await page.locator("#overlays").check();
  const canvas=page.locator("[data-mtek-inspector-overlay]"); await expect(canvas).toBeVisible();
  await expect.poll(async()=>Number(await canvas.getAttribute("data-segments"))).toBeGreaterThan(30);
  await page.screenshot({path:test.info().outputPath("lighting-world-bounds.png"),fullPage:true});
  await page.locator("#inspector").uncheck(); await expect(canvas).toHaveCount(0); await expect(panel).toHaveCount(0);
  await expect(page.locator("#diagnostics")).toBeHidden();
});
