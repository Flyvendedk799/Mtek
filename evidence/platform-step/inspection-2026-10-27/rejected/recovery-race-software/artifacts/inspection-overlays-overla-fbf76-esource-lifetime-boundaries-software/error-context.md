# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: inspection\overlays.spec.ts >> overlay disposal, source reset and device recovery preserve resource/lifetime boundaries
- Location: specs\inspection\overlays.spec.ts:97:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: false
Received: true

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
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
        - alert [ref=e9]:
          - heading "Mtek could not run this program" [level=1] [ref=e10]
          - generic [ref=e11]:
            - 'heading "MTEK-E5401: scene change failed" [level=2] [ref=e12]'
            - paragraph [ref=e13]: "reset() of Studio failed: the scene could not be prepared. The current scene keeps running."
            - paragraph [ref=e14]: "MTEK-E8050: Preparing the scene failed: The candidate was discarded because its application or GPU device is no longer current (application recovering)."
        - generic [ref=e15]:
          - generic [ref=e16]:
            - text: Camera orbit
            - slider "Camera orbit" [ref=e17]: "0.8"
          - generic [ref=e18]:
            - text: Rig parent rotation
            - slider "Rig parent rotation" [ref=e19]: "0.15"
          - button "Pause scene" [ref=e20] [cursor=pointer]
          - button "Reset scene" [ref=e21] [cursor=pointer]
        - generic [ref=e22]:
          - generic [ref=e23]:
            - text: Upper-body action weight
            - slider "Upper-body action weight" [ref=e24]: "0"
          - generic [ref=e25]:
            - checkbox "Additive action" [ref=e26]
            - text: Additive action
          - generic [ref=e27]:
            - text: Procedural neck lift
            - slider "Procedural neck lift" [ref=e28]: "0"
          - generic [ref=e29]:
            - generic [ref=e30]:
              - checkbox "Right-hand IK target" [ref=e31]
              - text: Right-hand IK target
            - generic [ref=e32]:
              - generic [ref=e33]:
                - text: X
                - spinbutton "X" [ref=e34]: "-7"
              - generic [ref=e35]:
                - text: "Y"
                - spinbutton "Y" [ref=e36]: "9"
              - generic [ref=e37]:
                - text: Z
                - spinbutton "Z" [ref=e38]: "1"
        - generic [ref=e40]:
          - generic [ref=e41]:
            - checkbox "World overlays" [checked] [active] [ref=e42]
            - text: World overlays
          - generic [ref=e43]:
            - checkbox "Bounds" [checked] [ref=e44]
            - text: Bounds
          - generic [ref=e45]:
            - checkbox "Skeleton" [checked] [ref=e46]
            - text: Skeleton
          - generic [ref=e47]:
            - checkbox "IK" [checked] [ref=e48]
            - text: IK
          - generic [ref=e49]:
            - checkbox "Colliders" [checked] [ref=e50]
            - text: Colliders
          - generic [ref=e51]:
            - checkbox "Contacts" [checked] [ref=e52]
            - text: Contacts
          - generic [ref=e53]:
            - checkbox "All scene bounds/colliders" [ref=e54]
            - text: All scene bounds/colliders
        - status [ref=e55]: Live scene
        - generic [ref=e56]: "MTEK-E5401: reset() of Studio failed: the scene could not be prepared. The current scene keeps running."
        - generic [ref=e57]: Select Fox to inspect animation, Crate for contact data, or RigParent to edit its transform. R resets through the source scene. Skeleton/IK positions precede material vertex deformation.
      - complementary [ref=e58]:
        - region "Mtek scene inspector" [ref=e59]:
          - generic [ref=e60]:
            - generic [ref=e61]:
              - generic [ref=e62]:
                - heading "Scene inspector" [level=2] [ref=e63]
                - paragraph [ref=e64]: Extension API 1
              - generic [ref=e65]: Connected
            - generic [ref=e66]:
              - heading "Entities" [level=3] [ref=e67]
              - searchbox "Filter entities" [ref=e68]
              - listbox "Scene entities" [ref=e69]:
                - option "Choose an entity" [ref=e70]
                - option "Sun" [ref=e71]
                - option "Floor" [ref=e72]
                - option "RigParent" [ref=e73]
                - option "Fox" [selected] [ref=e74]
                - option "Crate" [ref=e75]
              - generic [ref=e76]: 5 shown · 5 total
              - code [ref=e77]: scene:1:src/main.mtek::Studio.RigParent.Fox
              - generic [ref=e78]: "Authored local bounds: center (0, 30, 0), radius 200"
            - generic [ref=e79]:
              - heading "Local transform" [level=3] [ref=e80]
              - generic [ref=e81]:
                - group "Position" [ref=e82]:
                  - generic [ref=e84]:
                    - generic [ref=e85]:
                      - text: X
                      - spinbutton "position x" [ref=e86]: "0"
                    - generic [ref=e87]:
                      - text: "Y"
                      - spinbutton "position y" [ref=e88]: "0"
                    - generic [ref=e89]:
                      - text: Z
                      - spinbutton "position z" [ref=e90]: "0"
                - group "Rotation" [ref=e91]:
                  - generic [ref=e93]:
                    - generic [ref=e94]:
                      - text: X
                      - spinbutton "rotation x" [ref=e95]: "0"
                    - generic [ref=e96]:
                      - text: "Y"
                      - spinbutton "rotation y" [ref=e97]: "0"
                    - generic [ref=e98]:
                      - text: Z
                      - spinbutton "rotation z" [ref=e99]: "0"
                    - generic [ref=e100]:
                      - text: W
                      - spinbutton "rotation w" [ref=e101]: "1"
                - group "Scale" [ref=e102]:
                  - generic [ref=e104]:
                    - generic [ref=e105]:
                      - text: X
                      - spinbutton "scale x" [ref=e106]: "0.015625"
                    - generic [ref=e107]:
                      - text: "Y"
                      - spinbutton "scale y" [ref=e108]: "0.015625"
                    - generic [ref=e109]:
                      - text: Z
                      - spinbutton "scale z" [ref=e110]: "0.015625"
                - generic [ref=e111]:
                  - button "Apply edits" [ref=e112] [cursor=pointer]
                  - button "Reset fields" [ref=e113] [cursor=pointer]
                  - button "Undo" [disabled] [ref=e114]
                  - button "Redo" [disabled] [ref=e115]
              - generic [ref=e116]: Edits apply on the next scene frame. Resume or step a paused scene to apply them. Bindings and physics can overwrite local transforms.
            - generic [ref=e117]:
              - heading "Animation" [level=3] [ref=e118]
              - paragraph [ref=e119]: clip · playing · 0.012 / 0.708 s
              - combobox "Switch animation clip" [ref=e120]:
                - option "Switch clip…" [selected]
                - option "Survey"
                - option "Walk"
                - option "Run"
              - generic [ref=e121]:
                - text: Animation time
                - slider "Animation time" [ref=e122]: "0.0116666999999999"
              - generic [ref=e123]:
                - button "Pause base clip" [ref=e124] [cursor=pointer]
                - button "Make pose independent" [ref=e125] [cursor=pointer]
              - generic [ref=e126]: Shared-pose controls can affect other actors. Make the pose independent first to edit only this actor.
              - group [ref=e127]:
                - generic "Skeleton · 24 joints" [ref=e128] [cursor=pointer]
              - group [ref=e129]:
                - generic "Transitions, layers (0) and IK (0)" [ref=e130] [cursor=pointer]
            - generic [ref=e131]:
              - heading "World and collisions" [level=3] [ref=e132]
              - group [ref=e133]:
                - generic "World transforms, draw bounds and contacts" [ref=e134] [cursor=pointer]
            - generic [ref=e135]:
              - heading "Host metrics" [level=3] [ref=e136]
              - generic [ref=e137]: Metrics unavailable
              - generic [ref=e138]: Live observations, not benchmark measurements.
            - paragraph [ref=e140]: Transform history is local to this inspector session.
  - generic:
    - status "Inspector overlay status": bounds · skeleton · ik · colliders · contacts
```

# Test source

```ts
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
  52  |   expect(await page.evaluate(() => {
  53  |     const canvas=document.querySelector("[data-mtek-inspector-overlay]")!.shadowRoot!.querySelector("canvas")!;
  54  |     return getComputedStyle(canvas).backgroundColor;
  55  |   })).toBe("rgba(0, 0, 0, 0)");
  56  |   const initial=await verifyIndependentPose(page,.15,.8);
  57  |   await page.locator("#parent").fill("0.75"); await page.locator("#camera").fill("1.4"); await step(page);
  58  |   const moved=await verifyIndependentPose(page,.75,1.4);
  59  |   await page.locator("#canvas").evaluate(canvas => {canvas.style.borderWidth="7px";canvas.style.padding="11px";});
  60  |   await page.setViewportSize({width:1150,height:900}); await step(page,2);
  61  |   await expect.poll(() => page.evaluate(() => {
  62  |     const target=document.querySelector<HTMLCanvasElement>("#canvas")!.getBoundingClientRect(),overlay=document.querySelector<HTMLCanvasElement>("[data-mtek-inspector-overlay]")!.getBoundingClientRect();
  63  |     return Math.max(Math.abs(overlay.x-target.x-18),Math.abs(overlay.y-target.y-18),Math.abs(overlay.width-target.width+36),Math.abs(overlay.height-target.height+36));
  64  |   })).toBeLessThan(.6);
  65  |   await step(page); const resized=await verifyIndependentPose(page,.75,1.4);
  66  |   await page.screenshot({path:test.info().outputPath("inspection-pose-overlay.png"),fullPage:true});
  67  |   expect(errors).toEqual([]); writeRecord(`inspection-pose-${test.info().project.name}.json`,{initial,moved,resized,errors,dpr:1.5});
  68  | });
  69  | 
  70  | test("layer/IK diagnostics and real physics contact overlays explain the composed scene", async ({page,gpu}) => {
  71  |   expect(gpu.available).toBe(true); await start(page);
  72  |   await page.locator("#layer").fill("0.6"); await page.locator("#lift").fill("2"); await page.locator("#grip").check(); await step(page,1,.12);
  73  |   const panel=page.locator("[data-mtek-inspector]");
  74  |   await panel.locator("summary").filter({hasText:/^Transitions, layers/}).click();
  75  |   await expect(panel.getByText(/upper-body · Run · override · weight 0.600/)).toBeVisible();
  76  |   const pose=await page.evaluate(() => {
  77  |     const s=(window as unknown as StudioWindow).__inspectionStudio,d=s.inspector.snapshot().animation!.diagnostics!;
  78  |     return {layers:d.layers.map(l=>({id:l.id,weight:l.weight,mask:l.mask})),ik:d.ik,procedural:d.proceduralOverride,ikLines:s.overlay!.geometry().lines.filter(l=>l.kind==="ik").length};
  79  |   });
  80  |   expect(pose.layers[0]!.weight).toBe(.6); expect(pose.layers[0]!.mask.some(w=>w===0)).toBe(true); expect(pose.layers[0]!.mask.some(w=>w===1)).toBe(true);
  81  |   expect(pose.procedural).toBe(true); expect(pose.ik).toHaveLength(1); expect(pose.ikLines).toBeGreaterThan(3);
  82  |   await step(page,60,1/60);
  83  |   await panel.getByRole("listbox",{name:"Scene entities"}).selectOption({label:"Crate"});
  84  |   await panel.getByText("World transforms, draw bounds and contacts",{exact:true}).click();
  85  |   const physics=await page.evaluate(() => {
  86  |     const s=(window as unknown as StudioWindow).__inspectionStudio,scene=s.inspector.spatialSnapshot().scene!,id=s.inspector.snapshot().selectedId!,body=scene.bodies.find(b=>b.entityId===id)!;
  87  |     const before=s.app.debug!.counters()["physicsSteps"]; s.context.inspectScene!(); const after=s.app.debug!.counters()["physicsSteps"];
  88  |     return {body,before,after,kinds:s.overlay!.geometry().lines.map(l=>l.kind),diagnostics:s.diagnostics};
  89  |   });
  90  |   expect(physics.body.active).toBe(true); expect(physics.body.collider.shape).toEqual({kind:"box",size:{x:.7,y:.7,z:.7}});
  91  |   expect(physics.body.contacts!.length).toBeGreaterThan(0); expect(physics.before).toBe(physics.after);
  92  |   expect(physics.kinds).toContain("collider"); expect(physics.kinds).toContain("contact"); expect(physics.diagnostics).toEqual([]);
  93  |   await expect(panel.getByText(/observed contacts/)).toBeVisible(); await page.screenshot({path:test.info().outputPath("inspection-contacts.png"),fullPage:true});
  94  |   writeRecord(`inspection-composition-${test.info().project.name}.json`,{pose,physics});
  95  | });
  96  | 
  97  | test("overlay disposal, source reset and device recovery preserve resource/lifetime boundaries", async ({page,gpu}) => {
  98  |   expect(gpu.available).toBe(true); await start(page);
  99  |   await page.evaluate(() => {
  100 |     const w=window as unknown as StudioWindow,c=w.__inspectionStudio.context,read=c.inspectScene!.bind(c);w.__sceneReads=0;
  101 |     c.inspectScene=()=>{w.__sceneReads!++;return read();};
  102 |   });
  103 |   await page.locator("#overlays").uncheck(); await step(page,3);
  104 |   expect(await page.evaluate(() => (window as unknown as StudioWindow).__sceneReads)).toBe(0);
  105 |   await expect(page.locator("[data-mtek-inspector-overlay]")).toHaveCount(0);
  106 |   await page.locator("#overlays").check(); await step(page);
  107 |   const before=await page.evaluate(() => {const s=(window as unknown as StudioWindow).__inspectionStudio;s.app.debug!.loseDevice();return s.overlay!.geometry().lines;});
  108 |   await expect.poll(() => page.evaluate(() => (window as unknown as StudioWindow).__inspectionStudio.app.state)).toBe("running");
  109 |   await step(page); const after=await page.evaluate(() => (window as unknown as StudioWindow).__inspectionStudio.overlay!.geometry().lines);
  110 |   expect(after).toEqual(before);
  111 |   const oldId=await page.evaluate(() => {const s=(window as unknown as StudioWindow).__inspectionStudio,id=s.inspector.snapshot().selectedId!;s.app.debug!.pressKey("KeyR");s.app.debug!.step(1,.02);s.app.debug!.releaseKey("KeyR");return id;});
> 112 |   await expect.poll(() => page.evaluate(old => {const s=(window as unknown as StudioWindow).__inspectionStudio;s.app.debug!.step(1,.11);return s.context.readTransforms().some(e=>e.id===old);},oldId)).toBe(false);
      |                                                                                                                                                                                                         ^ Error: expect(received).toBe(expected) // Object.is equality
  113 |   expect(await page.evaluate(() => (window as unknown as StudioWindow).__inspectionStudio.inspector.spatialSnapshot().selectedId)).toBeNull();
  114 |   await page.evaluate(() => {const w=window as unknown as StudioWindow;w.__oldInspectionApp=w.__inspectionStudio.app;});
  115 |   await page.locator("#reset").click(); await expect(page.locator("#status")).toHaveText("Live scene");
  116 |   const disposed=await page.evaluate(() => (window as unknown as StudioWindow).__oldInspectionApp!.debug!.counters());
  117 |   for(const key of ["liveBuffers","liveTextures","liveSamplers","liveShaderModules","livePipelines","liveBindGroups","liveListeners"])expect(disposed[key],key).toBe(0);
  118 |   await expect(page.locator("[data-mtek-inspector-overlay]")).toHaveCount(1);
  119 |   writeRecord(`inspection-lifetime-${test.info().project.name}.json`,{overlayOffReads:0,recoveryExact:true,sourceReset:true,remount:true,disposed});
  120 | });
  121 | 
  122 | test("lighting studio exposes world bounds as an optional public-package overlay", async ({page,gpu}) => {
  123 |   expect(gpu.available).toBe(true); await page.goto("/lighting-studio/index.html");
  124 |   await expect(page.locator("#status")).toHaveText("Live · directional shadows + HDR IBL");
  125 |   await page.locator("#inspector").check(); const panel=page.locator("[data-mtek-inspector]");
  126 |   await panel.getByRole("listbox",{name:"Scene entities"}).selectOption({label:"Ceramic"}); await page.locator("#overlays").check();
  127 |   const canvas=page.locator("[data-mtek-inspector-overlay]"); await expect(canvas).toBeVisible();
  128 |   await expect.poll(async()=>Number(await canvas.getAttribute("data-segments"))).toBeGreaterThan(30);
  129 |   await page.screenshot({path:test.info().outputPath("lighting-world-bounds.png"),fullPage:true});
  130 |   await page.locator("#inspector").uncheck(); await expect(canvas).toHaveCount(0); await expect(panel).toHaveCount(0);
  131 |   await expect(page.locator("#diagnostics")).toBeHidden();
  132 | });
  133 | 
```