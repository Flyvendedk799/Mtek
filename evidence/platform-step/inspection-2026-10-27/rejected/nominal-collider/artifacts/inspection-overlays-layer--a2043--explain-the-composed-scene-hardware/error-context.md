# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: inspection\overlays.spec.ts >> layer/IK diagnostics and real physics contact overlays explain the composed scene
- Location: specs\inspection\overlays.spec.ts:66:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 3
+ Received  + 3

  Object {
    "kind": "box",
    "size": Object {
-     "x": 0.699999988079071,
-     "y": 0.699999988079071,
-     "z": 0.699999988079071,
+     "x": 0.7,
+     "y": 0.7,
+     "z": 0.7,
    },
  }
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - main [ref=e2]:
    - generic [ref=e3]:
      - heading "Inspect a live scene" [level=1] [ref=e4]
      - paragraph [ref=e5]: Follow a layered character pose, its inherited transforms, and a falling body's contacts.
    - generic [ref=e6]:
      - generic [ref=e7]:
        - generic "Animated Fox and a falling crate" [ref=e8]
        - generic [ref=e9]:
          - generic [ref=e10]:
            - text: Camera orbit
            - slider "Camera orbit" [ref=e11]: "0.8"
          - generic [ref=e12]:
            - text: Rig parent rotation
            - slider "Rig parent rotation" [ref=e13]: "0.15"
          - button "Pause scene" [ref=e14] [cursor=pointer]
          - button "Reset scene" [ref=e15] [cursor=pointer]
        - generic [ref=e16]:
          - generic [ref=e17]:
            - text: Upper-body action weight
            - slider "Upper-body action weight" [ref=e18]: "0.6"
          - generic [ref=e19]:
            - checkbox "Additive action" [ref=e20]
            - text: Additive action
          - generic [ref=e21]:
            - text: Procedural neck lift
            - slider "Procedural neck lift" [ref=e22]: "2"
          - generic [ref=e23]:
            - generic [ref=e24]:
              - checkbox "Right-hand IK target" [checked] [ref=e25]
              - text: Right-hand IK target
            - generic [ref=e26]:
              - generic [ref=e27]:
                - text: X
                - spinbutton "X" [ref=e28]: "-7"
              - generic [ref=e29]:
                - text: "Y"
                - spinbutton "Y" [ref=e30]: "9"
              - generic [ref=e31]:
                - text: Z
                - spinbutton "Z" [ref=e32]: "1"
        - generic [ref=e34]:
          - generic [ref=e35]:
            - checkbox "World overlays" [checked] [ref=e36]
            - text: World overlays
          - generic [ref=e37]:
            - checkbox "Bounds" [checked] [ref=e38]
            - text: Bounds
          - generic [ref=e39]:
            - checkbox "Skeleton" [checked] [ref=e40]
            - text: Skeleton
          - generic [ref=e41]:
            - checkbox "IK" [checked] [ref=e42]
            - text: IK
          - generic [ref=e43]:
            - checkbox "Colliders" [checked] [ref=e44]
            - text: Colliders
          - generic [ref=e45]:
            - checkbox "Contacts" [checked] [ref=e46]
            - text: Contacts
          - generic [ref=e47]:
            - checkbox "All scene bounds/colliders" [ref=e48]
            - text: All scene bounds/colliders
        - status [ref=e49]: Live scene
        - generic [ref=e50]: Select Fox to inspect animation, Crate for contact data, or RigParent to edit its transform. R resets through the source scene. Skeleton/IK positions precede material vertex deformation.
      - complementary [ref=e51]:
        - region "Mtek scene inspector" [active] [ref=e52]:
          - generic [ref=e53]:
            - generic [ref=e54]:
              - generic [ref=e55]:
                - heading "Scene inspector" [level=2] [ref=e56]
                - paragraph [ref=e57]: Extension API 1
              - generic [ref=e58]: Connected
            - generic [ref=e59]:
              - heading "Entities" [level=3] [ref=e60]
              - searchbox "Filter entities" [ref=e61]
              - listbox "Scene entities" [ref=e62]:
                - option "Choose an entity" [ref=e63]
                - option "Sun" [ref=e64]
                - option "Floor" [ref=e65]
                - option "RigParent" [ref=e66]
                - option "Fox" [ref=e67]
                - option "Crate" [selected] [ref=e68]
              - generic [ref=e69]: 5 shown · 5 total
              - code [ref=e70]: scene:1:src/main.mtek::Studio.Crate
            - generic [ref=e71]:
              - heading "Local transform" [level=3] [ref=e72]
              - generic [ref=e73]:
                - group "Position" [ref=e74]:
                  - generic [ref=e76]:
                    - generic [ref=e77]:
                      - text: X
                      - spinbutton "position x" [ref=e78]: "1.4011532068252563"
                    - generic [ref=e79]:
                      - text: "Y"
                      - spinbutton "position y" [ref=e80]: "0.34993070363998413"
                    - generic [ref=e81]:
                      - text: Z
                      - spinbutton "position z" [ref=e82]: "0.5005362629890442"
                - group "Rotation" [ref=e83]:
                  - generic [ref=e85]:
                    - generic [ref=e86]:
                      - text: X
                      - spinbutton "rotation x" [ref=e87]: "-9.340047881778446e-7"
                    - generic [ref=e88]:
                      - text: "Y"
                      - spinbutton "rotation y" [ref=e89]: "-0.000001477166165386734"
                    - generic [ref=e90]:
                      - text: Z
                      - spinbutton "rotation z" [ref=e91]: "3.3954458444895863e-7"
                    - generic [ref=e92]:
                      - text: W
                      - spinbutton "rotation w" [ref=e93]: "1"
                - group "Scale" [ref=e94]:
                  - generic [ref=e96]:
                    - generic [ref=e97]:
                      - text: X
                      - spinbutton "scale x" [ref=e98]: "1"
                    - generic [ref=e99]:
                      - text: "Y"
                      - spinbutton "scale y" [ref=e100]: "1"
                    - generic [ref=e101]:
                      - text: Z
                      - spinbutton "scale z" [ref=e102]: "1"
                - generic [ref=e103]:
                  - button "Apply edits" [ref=e104] [cursor=pointer]
                  - button "Reset fields" [ref=e105] [cursor=pointer]
                  - button "Undo" [disabled] [ref=e106]
                  - button "Redo" [disabled] [ref=e107]
              - generic [ref=e108]: Edits apply on the next scene frame. Resume or step a paused scene to apply them. Bindings and physics can overwrite local transforms.
            - generic [ref=e109]:
              - heading "World and collisions" [level=3] [ref=e110]
              - group [ref=e111]:
                - generic "World transforms, draw bounds and contacts" [ref=e112] [cursor=pointer]
                - generic [ref=e113]:
                  - generic [ref=e114]: "Rendered frame: 62 · viewport 1263 × 822"
                  - paragraph [ref=e115]: "World origin: (1.401, 0.350, 0.501)"
                  - paragraph [ref=e116]: "mesh bounds: center (1.401, 0.350, 0.501), radius 0.606 · retained by camera culling"
                  - paragraph [ref=e117]: dynamic · active · box full extents (0.700, 0.700, 0.700) · solid
                  - paragraph [ref=e118]: "Physics position: (1.401, 0.350, 0.501) · friction 0.6 · restitution 0"
                  - generic [ref=e119]: 4 observed contacts
                  - paragraph [ref=e120]: Floor · scene:1:src/main.mtek::Studio.Floor · point (1.051, -0.000, 0.850) · normal (0.000, -1.000, 0.000) · separation -0.00574
                  - paragraph [ref=e121]: Floor · scene:1:src/main.mtek::Studio.Floor · point (1.051, -0.000, 0.150) · normal (0.000, -1.000, 0.000) · separation -0.00574
                  - paragraph [ref=e122]: Floor · scene:1:src/main.mtek::Studio.Floor · point (1.751, -0.000, 0.850) · normal (0.000, -1.000, 0.000) · separation -0.00574
                  - paragraph [ref=e123]: Floor · scene:1:src/main.mtek::Studio.Floor · point (1.751, -0.000, 0.150) · normal (0.000, -1.000, 0.000) · separation -0.00574
            - generic [ref=e124]:
              - heading "Host metrics" [level=3] [ref=e125]
              - generic [ref=e126]: Metrics unavailable
              - generic [ref=e127]: Live observations, not benchmark measurements.
            - paragraph [ref=e129]: Transform history is local to this inspector session.
  - status "Inspector overlay status": bounds · skeleton · ik · colliders · contacts
```

# Test source

```ts
  1   | import {test,expect} from "../../support/fixtures.ts";
  2   | import type {Page} from "@playwright/test";
  3   | import type {MtekApp,ExtensionContext} from "../../../../packages/runtime-web/src/runtime.js";
  4   | import type {InspectorController,InspectorOverlay} from "../../../../packages/inspector/src/index.js";
  5   | import {writeRecord} from "../m4/configurator-support.ts";
  6   | 
  7   | interface Studio {app:MtekApp;inspector:InspectorController;overlay:InspectorOverlay|undefined;context:ExtensionContext;diagnostics:string[];rebuild():Promise<void>}
  8   | interface StudioWindow extends Window {__inspectionStudio:Studio;__oldInspectionApp?:MtekApp;__sceneReads?:number}
  9   | test.use({viewport:{width:1280,height:1000},deviceScaleFactor:1.5});
  10  | const step = (page: Page, frames = 1, delta = 0): Promise<void> => page.evaluate(({frames,delta}) => (window as unknown as StudioWindow).__inspectionStudio.app.debug!.step(frames,delta),{frames,delta});
  11  | async function start(page: Page): Promise<void> {
  12  |   await page.goto("/inspection-studio/index.html?verify=1");
  13  |   await expect(page.locator("#status")).toHaveText("Live scene");
  14  | }
  15  | async function verifyIndependentPose(page: Page, theta: number, phi: number) {
  16  |   const report = await page.evaluate(({theta,phi}) => {
  17  |     const studio = (window as unknown as StudioWindow).__inspectionStudio, snapshot = studio.inspector.spatialSnapshot(), scene = snapshot.scene!, actor = scene.entities.find(e => e.id === snapshot.selectedId)!;
  18  |     const player = studio.context.animation(actor.id)!, lines = studio.overlay!.geometry().lines.filter(line => line.kind === "skeleton");
  19  |     // Independent source-scene transform, not the supplied world matrix or runtime math library.
  20  |     const c = Math.cos(theta), s = Math.sin(theta), k = 1/64;
  21  |     const expected = [c*1.1*k,0,-s*1.1*k,0,0,.9*k,0,0,s*1.3*k,0,c*1.3*k,0,-1,0,0,1];
  22  |     const matrixError = Math.max(...actor.worldMatrix.map((v,i) => Math.abs(v-expected[i]!)));
  23  |     const camera = {x:7*Math.cos(phi),y:3.8,z:7*Math.sin(phi)}, back = {x:camera.x,y:camera.y-.9,z:camera.z};
  24  |     const length = Math.hypot(back.x,back.y,back.z); back.x/=length; back.y/=length; back.z/=length;
  25  |     const horizontal = Math.hypot(back.x,back.z), right = {x:back.z/horizontal,y:0,z:-back.x/horizontal};
  26  |     const up = {x:back.y*right.z,y:back.z*right.x-back.x*right.z,z:-back.y*right.x}, f = 1/Math.tan(.85/2), aspect = scene.viewport.width/scene.viewport.height;
  27  |     const project = (name: string) => {
  28  |       const p = player.jointPosition(name), world = {x:-1+c*1.1*k*p.x+s*1.3*k*p.z,y:.9*k*p.y,z:-s*1.1*k*p.x+c*1.3*k*p.z};
  29  |       const dx=world.x-camera.x,dy=world.y-camera.y,dz=world.z-camera.z,depth=-(back.x*dx+back.y*dy+back.z*dz);
  30  |       return {x:(right.x*dx+right.y*dy+right.z*dz)*f/(depth*aspect),y:(up.x*dx+up.y*dy+up.z*dz)*f/depth,depth};
  31  |     };
  32  |     let expectedSegments=0,matchedSegments=0,maxProjectionError=0;
  33  |     for (const node of player.skin.nodes) {
  34  |       if (node.parent < 0) continue;
  35  |       const a=project(player.skin.nodes[node.parent]!.name),b=project(node.name);
  36  |       if ([a,b].some(p => p.depth < .1 || p.depth > 50 || Math.abs(p.x)>1 || Math.abs(p.y)>1) || Math.hypot(a.x-b.x,a.y-b.y)<.005) continue;
  37  |       expectedSegments++;
  38  |       const error = Math.min(...lines.map(line => Math.max(Math.abs(a.x-line.start.x),Math.abs(a.y-line.start.y),Math.abs(b.x-line.end.x),Math.abs(b.y-line.end.y))));
  39  |       if (error < .00005) matchedSegments++; maxProjectionError=Math.max(maxProjectionError,error);
  40  |     }
  41  |     return {matrixError,expectedSegments,matchedSegments,maxProjectionError,lines:lines.length,diagnostics:studio.diagnostics};
  42  |   },{theta,phi});
  43  |   expect(report.matrixError).toBeLessThan(.000001); expect(report.expectedSegments).toBeGreaterThan(10);
  44  |   expect(report.matchedSegments).toBe(report.expectedSegments); expect(report.maxProjectionError).toBeLessThan(.00005); expect(report.diagnostics).toEqual([]);
  45  |   return report;
  46  | }
  47  | 
  48  | test("production pose overlays match independent parent/camera transforms and resized content boxes", async ({page,gpu}) => {
  49  |   expect(gpu.available).toBe(true); if (test.info().project.name === "hardware") expect(gpu.record.gpu.adapter!.info.isFallbackAdapter).toBe(false);
  50  |   const errors:string[]=[]; page.on("pageerror",error => errors.push(error.message)); await start(page);
  51  |   await page.locator("#bounds").uncheck(); await step(page,1,.2);
  52  |   const initial=await verifyIndependentPose(page,.15,.8);
  53  |   await page.locator("#parent").fill("0.75"); await page.locator("#camera").fill("1.4"); await step(page);
  54  |   const moved=await verifyIndependentPose(page,.75,1.4);
  55  |   await page.locator("#canvas").evaluate(canvas => {canvas.style.borderWidth="7px";canvas.style.padding="11px";});
  56  |   await page.setViewportSize({width:1150,height:900}); await step(page,2);
  57  |   await expect.poll(() => page.evaluate(() => {
  58  |     const target=document.querySelector<HTMLCanvasElement>("#canvas")!.getBoundingClientRect(),overlay=document.querySelector<HTMLCanvasElement>("[data-mtek-inspector-overlay]")!.getBoundingClientRect();
  59  |     return Math.max(Math.abs(overlay.x-target.x-18),Math.abs(overlay.y-target.y-18),Math.abs(overlay.width-target.width+36),Math.abs(overlay.height-target.height+36));
  60  |   })).toBeLessThan(.6);
  61  |   await step(page); const resized=await verifyIndependentPose(page,.75,1.4);
  62  |   await page.screenshot({path:test.info().outputPath("inspection-pose-overlay.png"),fullPage:true});
  63  |   expect(errors).toEqual([]); writeRecord(`inspection-pose-${test.info().project.name}.json`,{initial,moved,resized,errors,dpr:1.5});
  64  | });
  65  | 
  66  | test("layer/IK diagnostics and real physics contact overlays explain the composed scene", async ({page,gpu}) => {
  67  |   expect(gpu.available).toBe(true); await start(page);
  68  |   await page.locator("#layer").fill("0.6"); await page.locator("#lift").fill("2"); await page.locator("#grip").check(); await step(page,1,.12);
  69  |   const panel=page.locator("[data-mtek-inspector]");
  70  |   await panel.locator("summary").filter({hasText:/^Transitions, layers/}).click();
  71  |   await expect(panel.getByText(/upper-body · Run · override · weight 0.600/)).toBeVisible();
  72  |   const pose=await page.evaluate(() => {
  73  |     const s=(window as unknown as StudioWindow).__inspectionStudio,d=s.inspector.snapshot().animation!.diagnostics!;
  74  |     return {layers:d.layers.map(l=>({id:l.id,weight:l.weight,mask:l.mask})),ik:d.ik,procedural:d.proceduralOverride,ikLines:s.overlay!.geometry().lines.filter(l=>l.kind==="ik").length};
  75  |   });
  76  |   expect(pose.layers[0]!.weight).toBe(.6); expect(pose.layers[0]!.mask.some(w=>w===0)).toBe(true); expect(pose.layers[0]!.mask.some(w=>w===1)).toBe(true);
  77  |   expect(pose.procedural).toBe(true); expect(pose.ik).toHaveLength(1); expect(pose.ikLines).toBeGreaterThan(3);
  78  |   await step(page,60,1/60);
  79  |   await panel.getByRole("listbox",{name:"Scene entities"}).selectOption({label:"Crate"});
  80  |   await panel.getByText("World transforms, draw bounds and contacts",{exact:true}).click();
  81  |   const physics=await page.evaluate(() => {
  82  |     const s=(window as unknown as StudioWindow).__inspectionStudio,scene=s.inspector.spatialSnapshot().scene!,id=s.inspector.snapshot().selectedId!,body=scene.bodies.find(b=>b.entityId===id)!;
  83  |     const before=s.app.debug!.counters()["physicsSteps"]; s.context.inspectScene!(); const after=s.app.debug!.counters()["physicsSteps"];
  84  |     return {body,before,after,kinds:s.overlay!.geometry().lines.map(l=>l.kind),diagnostics:s.diagnostics};
  85  |   });
> 86  |   expect(physics.body.active).toBe(true); expect(physics.body.collider.shape).toEqual({kind:"box",size:{x:Math.fround(.7),y:Math.fround(.7),z:Math.fround(.7)}});
      |                                                                               ^ Error: expect(received).toEqual(expected) // deep equality
  87  |   expect(physics.body.contacts!.length).toBeGreaterThan(0); expect(physics.before).toBe(physics.after);
  88  |   expect(physics.kinds).toContain("collider"); expect(physics.kinds).toContain("contact"); expect(physics.diagnostics).toEqual([]);
  89  |   await expect(panel.getByText(/observed contacts/)).toBeVisible(); await page.screenshot({path:test.info().outputPath("inspection-contacts.png"),fullPage:true});
  90  |   writeRecord(`inspection-composition-${test.info().project.name}.json`,{pose,physics});
  91  | });
  92  | 
  93  | test("overlay disposal, source reset and device recovery preserve resource/lifetime boundaries", async ({page,gpu}) => {
  94  |   expect(gpu.available).toBe(true); await start(page);
  95  |   await page.evaluate(() => {
  96  |     const w=window as unknown as StudioWindow,c=w.__inspectionStudio.context,read=c.inspectScene!.bind(c);w.__sceneReads=0;
  97  |     c.inspectScene=()=>{w.__sceneReads!++;return read();};
  98  |   });
  99  |   await page.locator("#overlays").uncheck(); await step(page,3);
  100 |   expect(await page.evaluate(() => (window as unknown as StudioWindow).__sceneReads)).toBe(0);
  101 |   await expect(page.locator("[data-mtek-inspector-overlay]")).toHaveCount(0);
  102 |   await page.locator("#overlays").check(); await step(page);
  103 |   const before=await page.evaluate(() => {const s=(window as unknown as StudioWindow).__inspectionStudio;s.app.debug!.loseDevice();return s.overlay!.geometry().lines;});
  104 |   await expect.poll(() => page.evaluate(() => (window as unknown as StudioWindow).__inspectionStudio.app.state)).toBe("running");
  105 |   await step(page); const after=await page.evaluate(() => (window as unknown as StudioWindow).__inspectionStudio.overlay!.geometry().lines);
  106 |   expect(after).toEqual(before);
  107 |   const oldId=await page.evaluate(() => {const s=(window as unknown as StudioWindow).__inspectionStudio,id=s.inspector.snapshot().selectedId!;s.app.debug!.pressKey("KeyR");s.app.debug!.step(1,.02);s.app.debug!.releaseKey("KeyR");return id;});
  108 |   await expect.poll(() => page.evaluate(old => {const s=(window as unknown as StudioWindow).__inspectionStudio;s.app.debug!.step(1,.11);return s.context.readTransforms().some(e=>e.id===old);},oldId)).toBe(false);
  109 |   expect(await page.evaluate(() => (window as unknown as StudioWindow).__inspectionStudio.inspector.spatialSnapshot().selectedId)).toBeNull();
  110 |   await page.evaluate(() => {const w=window as unknown as StudioWindow;w.__oldInspectionApp=w.__inspectionStudio.app;});
  111 |   await page.locator("#reset").click(); await expect(page.locator("#status")).toHaveText("Live scene");
  112 |   const disposed=await page.evaluate(() => (window as unknown as StudioWindow).__oldInspectionApp!.debug!.counters());
  113 |   for(const key of ["liveBuffers","liveTextures","liveSamplers","liveShaderModules","livePipelines","liveBindGroups","liveListeners"])expect(disposed[key],key).toBe(0);
  114 |   await expect(page.locator("[data-mtek-inspector-overlay]")).toHaveCount(1);
  115 |   writeRecord(`inspection-lifetime-${test.info().project.name}.json`,{overlayOffReads:0,recoveryExact:true,sourceReset:true,remount:true,disposed});
  116 | });
  117 | 
  118 | test("lighting studio exposes world bounds as an optional public-package overlay", async ({page,gpu}) => {
  119 |   expect(gpu.available).toBe(true); await page.goto("/lighting-studio/index.html");
  120 |   await expect(page.locator("#status")).toHaveText("Live · directional shadows + HDR IBL");
  121 |   await page.locator("#inspector").check(); const panel=page.locator("[data-mtek-inspector]");
  122 |   await panel.getByRole("listbox",{name:"Scene entities"}).selectOption({label:"Ceramic"}); await page.locator("#overlays").check();
  123 |   const canvas=page.locator("[data-mtek-inspector-overlay]"); await expect(canvas).toBeVisible();
  124 |   await expect.poll(async()=>Number(await canvas.getAttribute("data-segments"))).toBeGreaterThan(30);
  125 |   await page.screenshot({path:test.info().outputPath("lighting-world-bounds.png"),fullPage:true});
  126 |   await page.locator("#inspector").uncheck(); await expect(canvas).toHaveCount(0); await expect(panel).toHaveCount(0);
  127 |   await expect(page.locator("#diagnostics")).toBeHidden();
  128 | });
  129 | 
```