import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir,open,readFile,readdir,writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import {extname,join,resolve,sep} from "node:path";
import {build} from "esbuild";
import {chromium} from "@playwright/test";
import {browserChannel,hardwareLaunchArgs,softwareLaunchArgs} from "../../tests/browser/support/launch-args.ts";
import {prepareCohorts} from "./prepare-cohorts.mjs";
import {prepareDemo} from "./cohorts/prepare.mjs";
const here=import.meta.dirname,repo=resolve(here,"../.."),backend=process.argv[2]??"hardware",output=resolve(process.argv[3]??`target/authored-cohorts-${Date.now()}`);
assert(["hardware","software"].includes(backend));await mkdir(output,{recursive:true});
const path=join(output,`${backend}.json`),handle=await open(path,"wx");await handle.close();
const launchArgs=backend==="hardware"?hardwareLaunchArgs():softwareLaunchArgs();
const report={contract:"authored production-character deformation with shared-pose instancing",backend,launchArgs,startedAt:new Date().toISOString(),status:"running"};
let browser,server,page;
try{
  report.originalAssets=await prepareCohorts();
  const bundle=await build({entryPoints:[join(here,"cohorts-probe.ts")],bundle:true,write:false,format:"iife",globalName:"cohortProbe",target:"es2022"});
  report.harnessSha256=createHash("sha256").update(bundle.outputFiles[0].contents).digest("hex");
  const files=new Map(),root=join(here,".cohorts-out");let referenceCount=0;
  server=createServer(async(request,response)=>{
    try{
      const pathname=decodeURIComponent(new URL(request.url??"/","http://localhost").pathname);
      if(pathname==="/probe.html"){response.writeHead(200,{"content-type":"text/html"});response.end('<canvas width="193" height="193"></canvas>');return;}
      if(pathname.startsWith("/demo/")){
        const demoRoot=join(here,"cohorts"),file=resolve(demoRoot,`.${pathname.slice(5)}`);assert(file.startsWith(demoRoot+sep));const bytes=await readFile(file);
        response.writeHead(200,{"content-type":({".html":"text/html",".js":"text/javascript",".json":"application/json",".png":"image/png"})[extname(file)]??"application/octet-stream"});response.end(bytes);return;
      }
      if(pathname==="/cpu-reference"&&request.method==="POST"){
        const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;assert(size<=16*1024*1024,"Reference payload too large");chunks.push(chunk);}
        const payload=JSON.parse(Buffer.concat(chunks).toString("utf8")),prefix=`/cpu/${++referenceCount}/`;
        files.set(prefix+"program.manifest.json",Buffer.from(JSON.stringify(payload.manifest)));
        for(const file of payload.files){assert(/^assets\/[0-9a-f]{16}\.bin$/.test(file.url));files.set(prefix+file.url,Buffer.from(file.bytes,"base64"));}
        response.writeHead(200,{"content-type":"text/plain"});response.end(prefix);return;
      }
      const cached=files.get(pathname),relative=pathname.replace(/^\/cpu\/\d+\//,"/"),file=resolve(root,`.${relative}`);assert(file.startsWith(root+sep));
      const bytes=cached??await readFile(file);
      response.writeHead(200,{"content-type":({".js":"text/javascript",".json":"application/json",".png":"image/png"})[extname(file)]??"application/octet-stream","cache-control":"no-store"});response.end(bytes);
    }catch(error){response.writeHead(404);response.end(String(error));}
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const base=`http://127.0.0.1:${server.address().port}/`;
  browser=await chromium.launch({channel:browserChannel(),headless:true,args:launchArgs});report.browser=browser.version();
  page=await browser.newPage();const errors=[];page.on("pageerror",e=>errors.push(e.message));await page.goto(base+"probe.html");await page.addScriptTag({content:bundle.outputFiles[0].text});
  const result=await page.evaluate(base=>window.cohortProbe.runCohortsProbe(base),base);Object.assign(report,result,{errors,cpuReferencePrograms:referenceCount});
  assert.deepEqual(errors,[]);assert.equal(result.cases.length,12);assert.equal(result.lifetime.length,4);assert.equal(referenceCount,12);
  assert.equal(result.adapter.isFallbackAdapter,backend==="software");
  if(backend==="software")assert(/swiftshader/i.test(JSON.stringify(result.adapter)));
  for(const row of result.cases){
    const name=`${backend}-${row.character}-${row.count}-${row.groups}-${row.shadows?"shadow":"colour"}.png`,bytes=Buffer.from(row.preview.split(",")[1],"base64");
    await writeFile(join(output,name),bytes);row.preview={file:name,sha256:createHash("sha256").update(bytes).digest("hex")};
  }
  await prepareDemo();await page.goto(base+"demo/index.html?verify=1");
  await page.waitForFunction(()=>document.querySelector("#status").textContent.includes("10 actors"));
  await page.evaluate(()=>{window.__cohortOld=window.cohortDemo.app;});
  await page.locator("#count").selectOption("50");await page.locator("#groups").selectOption("5");await page.locator("#character").selectOption("1");
  await page.waitForFunction(()=>document.querySelector("#status").textContent.includes("50 actors · 5 pose groups"));
  report.sharedDemo=await page.evaluate(()=>{const c=window.cohortDemo.context,actors=c.readTransforms().filter(e=>e.name==="ManActor");return {actors:actors.length,players:new Set(actors.map(e=>c.animation(e.id))).size};});
  assert.deepEqual(report.sharedDemo,{actors:50,players:5});
  await page.locator("#pause").click();await page.screenshot({path:join(output,`${backend}-demo.png`),fullPage:true});
  await page.locator("#reference").selectOption("reference");await page.waitForFunction(()=>document.querySelector("#status").textContent.includes("50 actors · 5 pose groups"));
  await page.locator("#sharing").selectOption("independent");await page.locator("#shape").selectOption("identity");await page.locator("#shadows").selectOption("off");
  await page.waitForFunction(()=>document.querySelector("#status").textContent.includes("independent · 51 colour + shadow draws · 0 colour instance groups"));
  report.independentDemo=await page.evaluate(()=>{const c=window.cohortDemo.context,actors=c.readTransforms().filter(e=>e.name==="ManReference");return {actors:actors.length,players:new Set(actors.map(e=>c.animation(e.id))).size};});
  assert.deepEqual(report.independentDemo,{actors:50,players:50});
  report.demoDisposed=await page.evaluate(()=>{window.cohortDemo.app.dispose();return {old:window.__cohortOld.debug.counters(),current:window.cohortDemo.app.debug.counters()};});
  for(const counts of Object.values(report.demoDisposed))for(const key of ["liveBuffers","liveTextures","liveSamplers","liveShaderModules","livePipelines","liveBindGroups","liveListeners"])assert.equal(counts[key],0,key);
  assert.equal(await page.locator("#errors").textContent(),"");assert.deepEqual(errors,[]);report.demo="50 actors, five groups, CesiumMan, pause and transform-reference rebuild passed";
  report.files=[];
  async function collect(dir,prefix=""){
    for(const item of await readdir(dir,{withFileTypes:true})){const file=join(dir,item.name),name=prefix+item.name;if(item.isDirectory())await collect(file,name+"/");else{const bytes=await readFile(file);report.files.push({path:name,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")});}}
  }
  await collect(root);
  report.sources=[];
  for(const file of ["cohorts/src/main.mtek","cohorts/mtek.toml","cohorts/main.ts","cohorts/index.html","cohorts/prepare.mjs","cohorts/serve.mjs","cohorts/README.md","prepare-cohorts.mjs","verify-cohorts.mjs","cohorts-probe.ts","cohorts-reference.ts","cohort-controls.ts","tsconfig.json"]){const bytes=await readFile(join(here,file));report.sources.push({path:`examples/vertex-deformation/${file}`,sha256:createHash("sha256").update(bytes).digest("hex")});}
  const demoBundle=await readFile(join(here,"cohorts/cohorts.js"));report.demoBundleSha256=createHash("sha256").update(demoBundle).digest("hex");
  report.status="passed";console.log(`${backend}: 12 production-character cohort/reference cases and four detach/rejoin/recovery checks passed`);
}catch(error){report.status="failed";report.failure=String(error);try{report.partial=await page?.evaluate(()=>window.__cohortProgress);report.pageState=await page?.evaluate(()=>({url:location.href,status:document.querySelector("#status")?.textContent,errors:document.querySelector("#errors")?.textContent,app:window.cohortDemo?.app?.state}));}catch{}process.exitCode=1;console.error(error);}
finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));report.finishedAt=new Date().toISOString();await writeFile(path,JSON.stringify(report,null,2)+"\n");}
