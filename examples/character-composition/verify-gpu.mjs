import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {readFile,writeFile,mkdir,open,readdir} from "node:fs/promises";
import {createServer} from "node:http";
import {join,resolve,extname,sep} from "node:path";
import {build} from "esbuild";
import {chromium} from "@playwright/test";
import {browserChannel,hardwareLaunchArgs,softwareLaunchArgs} from "../../tests/browser/support/launch-args.ts";
import {prepareComposition} from "./prepare.mjs";
// Reuse the PNG decoder shipped by the repository's pinned Playwright test tool.
const {PNG}=createRequire(import.meta.url)("playwright-core/lib/utilsBundle");
const here=import.meta.dirname,backend=process.argv[2]??"hardware",output=resolve(process.argv[3]??`target/composition-gpu-${Date.now()}`);
assert(["hardware","software"].includes(backend));await mkdir(output,{recursive:true});const reportPath=join(output,`${backend}.json`),handle=await open(reportPath,"wx");await handle.close();
const launchArgs=backend==="hardware"?hardwareLaunchArgs():softwareLaunchArgs(),report={format:"mtek-production-composition-gpu/1",backend,launchArgs,startedAt:new Date().toISOString(),status:"running",cases:[]};
let browser,server,page;
try{
  report.derivation=await prepareComposition();const reference=await build({entryPoints:[join(here,"reference.ts")],bundle:true,write:false,format:"iife",globalName:"compositionReference",target:"es2022"});
  report.referenceHarnessSha256=createHash("sha256").update(reference.outputFiles[0].contents).digest("hex");
  const files=new Map();let referenceCount=0;
  server=createServer(async(request,response)=>{
    try{
      const path=decodeURIComponent(new URL(request.url??"/","http://localhost").pathname);
      if(path==="/cpu-reference"&&request.method==="POST"){
        const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;assert(size<=16*1024*1024);chunks.push(chunk);}
        const payload=JSON.parse(Buffer.concat(chunks).toString("utf8")),prefix=`/cpu/${++referenceCount}/`;files.set(prefix+"program.manifest.json",Buffer.from(JSON.stringify(payload.manifest)));
        for(const file of payload.files){assert(/^assets\/[0-9a-f]{16}\.bin$/.test(file.url));files.set(prefix+file.url,Buffer.from(file.bytes,"base64"));}
        response.writeHead(200,{"content-type":"text/plain"});response.end(prefix);return;
      }
      const cached=files.get(path),cpu=/^\/cpu\/\d+\//.test(path),root=cpu?join(here,".out/scene"):here,relative=cpu?path.replace(/^\/cpu\/\d+\//,"/"):path==="/"?"/index.html":path,file=resolve(root,`.${relative}`);assert(file.startsWith(root+sep));
      const bytes=cached??await readFile(file);response.writeHead(200,{"content-type":({".html":"text/html",".js":"text/javascript",".json":"application/json",".png":"image/png",".jpg":"image/jpeg"})[extname(file)]??"application/octet-stream","cache-control":"no-store"});response.end(bytes);
    }catch(error){response.writeHead(404);response.end(String(error));}
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const base=`http://127.0.0.1:${server.address().port}/`;
  browser=await chromium.launch({channel:browserChannel(),headless:true,args:launchArgs});report.browser=browser.version();page=await browser.newPage({viewport:{width:1440,height:1100}});
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(base+"?verify=1");await page.waitForFunction(()=>document.querySelector("#status").textContent.startsWith("Two composed"));await page.addScriptTag({content:reference.outputFiles[0].text});
  report.adapter=await page.evaluate(async()=>{const a=await navigator.gpu.requestAdapter();if(!a)throw new Error("No adapter");const i=a.info;return {vendor:i.vendor,architecture:i.architecture,device:i.device,description:i.description,isFallbackAdapter:i.isFallbackAdapter};});
  assert.equal(report.adapter.isFallbackAdapter,backend==="software");if(backend==="software")assert(/swiftshader/i.test(JSON.stringify(report.adapter)));
  const step=async(frames=1,delta=0)=>page.evaluate(({frames,delta})=>window.compositionWorkshop.workshop.app.debug.step(frames,delta),{frames,delta});
  const compare=async name=>{
    const result=await page.evaluate(async()=>{
      const w=window.compositionWorkshop.workshop,shot=await w.app.debug.readPixels(),module=await import(new URL("./.out/scene/app.js",location.href)),cpu=await window.compositionReference.captureCpuReference(module,w.actors,w.context.readTransforms(),new URL("/",location.href));
      let maximum=0,overTolerance=0;for(let i=0;i<shot.data.length;i+=4){let delta=0;for(let c=0;c<4;c++)delta=Math.max(delta,Math.abs(shot.data[i+c]-cpu[i+c]));maximum=Math.max(maximum,delta);if(delta>2)overTolerance++;}
      const residuals=w.actors.map(a=>({name:a.name,targets:a.controller.residuals(),pelvis:a.controller.pelvisAdjustment})),origins=w.actors.map(a=>({...a.controller.origin}));
      for(const a of w.actors)a.controller.origin.y+=2000;w.app.debug.step(1,0);const floor=await w.app.debug.readPixels();let changed=0;for(let i=0;i<shot.data.length;i+=4)if(Math.max(...[0,1,2].map(c=>Math.abs(shot.data[i+c]-floor.data[i+c])))>10)changed++;
      for(let i=0;i<w.actors.length;i++)Object.assign(w.actors[i].controller.origin,origins[i]);w.app.debug.step(1,0);
      const encode=data=>{let text="";for(const byte of data)text+=String.fromCharCode(byte);return btoa(text);};
      return {maximum,overTolerance,changed,residuals,counters:w.app.debug.counters(),diagnostics:w.diagnostics,
        pixels:{format:"rgba8unorm-srgb",width:shot.width,height:shot.height,actual:encode(shot.data),cpu:encode(cpu)},
        actors:w.actors.map(a=>({name:a.name,settings:a.controller.settings,palette:Array.from(a.controller.player.palette),pose:Array.from(a.controller.player.pose)})),transforms:w.context.readTransforms()};
    });
    report.cases.push({name,...result});assert.equal(result.overTolerance,0,JSON.stringify(result));assert(result.changed>200,"Characters/props did not affect pixels");for(const actor of result.residuals)for(const target of actor.targets){assert(target.distance<.002);assert(target.orientationError<.0001);}return result;
  };
  await step(60,1/60);await compare("locomotion-action-feet-grips");
  await page.locator("#additive").check();await page.locator("#action").fill("0.9");await step(30,1/60);await compare("additive-action");
  await page.locator("#run").click();await step(1,.1);
  const interruption=await page.evaluate(()=>{const w=window.compositionWorkshop.workshop,before=w.actors.map(a=>Array.from(a.controller.player.pose));w.interrupt("Idle");return Math.max(...w.actors.flatMap((a,n)=>Array.from(a.controller.player.pose,(v,i)=>Math.abs(v-before[n][i]))));});assert(interruption<1e-7);report.interruption=interruption;
  await step(30,1/60);await compare("interrupted-transition");
  await page.locator("#root").check();await step(120,1/60);await step();await compare("root-owned-trajectory");
  const before=await page.evaluate(async()=>Array.from((await window.compositionWorkshop.workshop.app.debug.readPixels()).data));await page.evaluate(()=>window.compositionWorkshop.workshop.app.debug.loseDevice());
  await page.waitForFunction(()=>{const w=window.compositionWorkshop.workshop;return w.app.state==="running"&&w.diagnostics.some(d=>d.code==="MTEK-W8061");});await step();
  const recovery=await page.evaluate(async before=>{const w=window.compositionWorkshop.workshop,after=(await w.app.debug.readPixels()).data;let maximum=0;for(let i=0;i<after.length;i++)maximum=Math.max(maximum,Math.abs(after[i]-before[i]));return {maximum,restartedFade:w.restartedFade,counters:w.app.debug.counters()};},before);
  report.recovery=recovery;assert.equal(recovery.maximum,0);assert.equal(recovery.restartedFade,false);await compare("recovered-root-composition");
  // Device recovery retains the CPU world, including an unfinished fade's source.
  await page.locator("#root").uncheck();await page.locator("#run").click();await step(1,.05);
  const partial=await page.evaluate(async()=>{const w=window.compositionWorkshop.workshop;return {pixels:Array.from((await w.app.debug.readPixels()).data),progress:w.actors.map(a=>a.controller.player.inspect().transition.progress)};});
  assert(partial.progress.every(p=>p>0&&p<1));
  await page.evaluate(()=>window.compositionWorkshop.workshop.app.debug.loseDevice());
  await page.waitForFunction(()=>{const w=window.compositionWorkshop.workshop;return w.app.state==="running"&&w.diagnostics.filter(d=>d.code==="MTEK-W8061").length===2;});await step();
  report.unfinishedFade=await page.evaluate(async before=>{const w=window.compositionWorkshop.workshop,after=(await w.app.debug.readPixels()).data;let maximum=0;for(let i=0;i<after.length;i++)maximum=Math.max(maximum,Math.abs(after[i]-before.pixels[i]));let a="",b="";for(let i=0;i<after.length;i++){a+=String.fromCharCode(before.pixels[i]);b+=String.fromCharCode(after[i]);}return {maximum,pixels:{before:btoa(a),after:btoa(b),width:241,height:193},progressBefore:before.progress,progressAfter:w.actors.map(a=>a.controller.player.inspect().transition.progress),resumedAtTarget:w.restartedFade,clips:w.actors.map(a=>a.controller.player.inspect().clip),finite:w.actors.every(a=>a.controller.player.pose.every(Number.isFinite))};},partial);
  assert.equal(report.unfinishedFade.maximum,0);assert.deepEqual(report.unfinishedFade.progressAfter,partial.progress);assert.equal(report.unfinishedFade.resumedAtTarget,false);assert.equal(report.unfinishedFade.finite,true);assert.deepEqual(report.unfinishedFade.clips,["Run","Run"]);
  report.disposed=await page.evaluate(()=>{const w=window.compositionWorkshop.workshop;w.dispose();return w.app.debug.counters();});
  for(const key of ["liveBuffers","liveTextures","liveSamplers","liveShaderModules","livePipelines","liveBindGroups","liveListeners"])assert.equal(report.disposed[key],0,key);
  await page.goto(base+"?verify=1&visible=1");await page.waitForFunction(()=>document.querySelector("#status").textContent.startsWith("Two composed"));await page.locator("#additive").check();await page.locator("#root").check();await step(120,1/60);await step();
  await page.locator("[data-mtek-inspector]").getByRole("listbox",{name:"Scene entities"}).selectOption({label:"Longer"});
  await page.locator("#overlay").uncheck();
  const native=await page.locator("canvas").first().screenshot(),decoded=PNG.sync.read(native),colours=new Set();let painted=0;
  for(let i=0;i<decoded.data.length;i+=4){const r=decoded.data[i],g=decoded.data[i+1],b=decoded.data[i+2];colours.add(`${r},${g},${b}`);if(Math.max(Math.abs(r-23),Math.abs(g-35),Math.abs(b-47))>15)painted++;}
  report.visibleCanvas={colours:colours.size,painted,width:decoded.width,height:decoded.height};
  await writeFile(join(output,`${backend}-canvas.png`),native);assert(colours.size>20&&painted>5000,"Visible canvas contained no rendered scene");
  await page.locator("#overlay").check();await step();
  await page.screenshot({path:join(output,`${backend}-workshop.png`),fullPage:true});
  // Exercise every live control and retain ownership after actual UI resets.
  for(const id of ["speed","action","procedural"]){await page.locator(`#${id}`).fill("0");await step();await page.locator(`#${id}`).fill("1");await step();}
  for(const id of ["feet","grip"]){await page.locator(`#${id}`).uncheck();await step();assert.equal(await page.evaluate(id=>window.compositionWorkshop.workshop.actors.every(a=>!a.controller.goals.some(g=>g.name.endsWith(id==="feet"?"Foot":"Grip"))),id),true);await page.locator(`#${id}`).check();await step();}
  await page.locator("#root").uncheck();await page.locator("#blend").click();await step();assert.equal(await page.evaluate(()=>window.compositionWorkshop.workshop.actors.every(a=>a.controller.player.locomotion.active)),true);
  await page.locator("#pause").click();assert.equal(await page.evaluate(()=>window.compositionWorkshop.workshop.app.state),"paused");
  await page.locator("#pause").click();assert.equal(await page.evaluate(()=>window.compositionWorkshop.workshop.app.state),"running");
  report.resets=[];
  for(let i=0;i<3;i++){
    await page.evaluate(()=>{window.previousCompositionApp=window.compositionWorkshop.workshop.app;});await page.locator("#reset").click();
    await page.waitForFunction(()=>{const w=window.compositionWorkshop?.workshop;return w&&w.app!==window.previousCompositionApp&&w.actors.length===2;});
    const reset=await page.evaluate(()=>({counters:window.previousCompositionApp.debug.counters(),origins:window.compositionWorkshop.workshop.actors.map(a=>a.controller.origin.x),panels:document.querySelectorAll("[data-mtek-inspector]").length}));
    report.resets.push(reset);assert.deepEqual(reset.origins,[-1.600000023841858,1.600000023841858]);assert.equal(reset.panels,1);
    for(const key of ["liveBuffers","liveTextures","liveSamplers","liveShaderModules","livePipelines","liveBindGroups","liveListeners"])assert.equal(reset.counters[key],0,key);
  }
  report.visibleDisposed=await page.evaluate(()=>{const w=window.compositionWorkshop.workshop;w.dispose();return {counters:w.app.debug.counters(),panels:document.querySelectorAll("[data-mtek-inspector]").length};});
  assert.equal(report.visibleDisposed.panels,0);for(const key of ["liveBuffers","liveTextures","liveSamplers","liveShaderModules","livePipelines","liveBindGroups","liveListeners"])assert.equal(report.visibleDisposed.counters[key],0,key);
  assert.equal(await page.locator("#errors").textContent(),"");assert.deepEqual(errors,[]);
  report.referencePrograms=referenceCount;report.errors=errors;report.status="passed";console.log(`${backend}: five CPU/GPU references, interruption, steady/unfinished-fade recovery, controls, resets and visible workshop passed`);
}catch(error){report.status="failed";report.failure=String(error);try{report.pageState=await page?.evaluate(()=>({status:document.querySelector("#status")?.textContent,errors:document.querySelector("#errors")?.textContent,diagnostics:window.compositionWorkshop?.workshop?.diagnostics}));}catch{}console.error(error);process.exitCode=1;}
finally{
  await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));report.files=[];
  async function collect(directory,prefix=""){for(const item of await readdir(directory,{withFileTypes:true})){const path=join(directory,item.name),name=prefix+item.name;if(item.isDirectory())await collect(path,name+"/");else{const bytes=await readFile(path);report.files.push({path:name,sha256:createHash("sha256").update(bytes).digest("hex"),bytes:bytes.length});}}}
  await collect(join(here,".out/scene"));report.sources=[];
  for(const file of ["controller.ts","workshop.ts","main.ts","reference.ts","glb.mjs","prepare.mjs","verify-gpu.mjs","index.html","composition.js","scene/src/main.mtek","scene/mtek.toml"]){const bytes=await readFile(join(here,file));report.sources.push({path:`examples/character-composition/${file}`,sha256:createHash("sha256").update(bytes).digest("hex"),bytes:bytes.length});}
  report.finishedAt=new Date().toISOString();await writeFile(reportPath,JSON.stringify(report,null,2)+"\n");
}
