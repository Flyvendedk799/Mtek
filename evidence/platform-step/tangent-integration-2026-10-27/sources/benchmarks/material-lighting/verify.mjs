import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {readFile,writeFile,mkdir,open,readdir} from "node:fs/promises";
import {join,resolve} from "node:path";
import {chromium} from "@playwright/test";
import {browserChannel,hardwareLaunchArgs,softwareLaunchArgs} from "../../tests/browser/support/launch-args.ts";
import {prepareMaterials} from "./prepare.mjs";
import {describeScene,protocol} from "./scenes.mjs";
import {compareImages,regionsFor} from "./metrics.mjs";
import {ReferenceParticles} from "./particles.mjs";
import {startServer} from "./server.mjs";
const {PNG}=createRequire(import.meta.url)("playwright-core/lib/utilsBundle"),here=import.meta.dirname,backend=process.argv[2]??"hardware",output=resolve(process.argv[3]??`target/material-lighting-${Date.now()}`);
assert(!process.argv[3]?.startsWith("--"),"The output directory is positional: verify.mjs hardware .out/material-hardware");
for(const arg of process.argv.slice(4))assert(/^--(?:scene|quality)=.+$/.test(arg),`Unknown argument: ${arg}`);
assert(["hardware","software"].includes(backend));await mkdir(output,{recursive:true});const reportPath=join(output,`${backend}.json`),handle=await open(reportPath,"wx");await handle.close();
const select=key=>process.argv.find(arg=>arg.startsWith(`--${key}=`))?.split("=")[1],sceneFilter=select("scene"),qualityFilter=select("quality"),launchArgs=backend==="hardware"?hardwareLaunchArgs():softwareLaunchArgs();
const hash=b=>createHash("sha256").update(b).digest("hex"),report={format:"mtek-material-lighting-correctness/1",backend,launchArgs,startedAt:new Date().toISOString(),status:"running",cases:[]};
let browser,server;
try{
  report.build=await prepareMaterials();report.sources=[];for(const name of (await readdir(here)).filter(name=>/\.(mjs|json)$/.test(name))){const bytes=await readFile(join(here,name));report.sources.push({path:`benchmarks/material-lighting/${name}`,sha256:hash(bytes),bytes:bytes.length});}const root=join(here,".out/site");
  server=await startServer(root);const base=server.url;
  browser=await chromium.launch({channel:browserChannel(),headless:true,args:launchArgs});report.browser=browser.version();
  for(const name of protocol.scenes.filter(n=>!sceneFilter||n===sceneFilter))for(const quality of Object.keys(protocol.profiles).filter(n=>!qualityFilter||n===qualityFilter)){
    const definition=describeScene(name,quality),captures=name==="particles"?protocol.particles.captureFrames:[1],row={name,quality,status:"running",implementations:{},comparisons:[]},images={};report.cases.push(row);
    for(const implementation of ["mtek","three"]){
      const page=await browser.newPage({viewport:{width:Math.max(900,definition.profile.width),height:Math.max(600,definition.profile.height)}}),errors=[];page.on("pageerror",error=>errors.push(error.message));
      const record={status:"running",images:[]};row.implementations[implementation]=record;images[implementation]=[];
      try{
        await page.goto(base);await page.waitForFunction(()=>document.querySelector("#status").textContent==="Ready");
        record.setup=await page.evaluate(async({implementation,name,quality})=>window.materialSuite.setup(implementation,name,quality),{implementation,name,quality});
        assert.equal(record.setup.adapter.isFallbackAdapter,backend==="software");let frames=0;
        for(const count of captures){
          record.state=await page.evaluate(async count=>window.materialSuite.advance(count),count-frames);frames=count;
          const shot=await page.evaluate(async()=>window.materialSuite.pixels()),data=Buffer.from(shot.data,"base64"),png=PNG.sync.write({width:shot.width,height:shot.height,data}),file=`${backend}-${name}-${quality}-${implementation}-${count}.png`;
          await writeFile(join(output,file),png);record.images.push({path:file,sha256:hash(png),bytes:png.length,width:shot.width,height:shot.height,frame:count});images[implementation].push(data);
        }
        record.disposed=await page.evaluate(async()=>window.materialSuite.dispose());assert.deepEqual(record.disposed.validation,[]);assert.deepEqual(record.disposed.losses,[]);assert.equal(record.disposed.allDevicesDestroyed,true);assert.deepEqual(errors,[]);
        if(implementation==="mtek"){
          assert.deepEqual(record.state.info.diagnostics,[]);
          for(const key of ["liveBuffers","liveTextures","liveSamplers","liveShaderModules","livePipelines","liveBindGroups","liveListeners"])assert.equal(record.disposed.result.runtime[key],0,key);
        }
        if(name==="particles"){
          const expected=new ReferenceParticles(definition.emitters,definition.profile.particleRate);for(let i=0;i<captures.at(-1);i++)expected.advance(protocol.particles.dt);
          const observed=record.state.lastFrameDraws.filter(d=>d.method==="drawIndexed"&&d.count===6).reduce((total,d)=>total+d.instances,0);record.particleStructure={expected:expected.count+definition.emitters.length,observed,draws:record.state.lastFrameDraws};assert.equal(observed,record.particleStructure.expected);
        }
        if(name==="particles"||name==="product"){
          const control=await browser.newPage();
          try{
            await control.goto(base);await control.waitForFunction(()=>document.querySelector("#status").textContent==="Ready");
            const setup=await control.evaluate(async({implementation,name,quality})=>window.materialSuite.setup(implementation,name,quality,"correctness",true),{implementation,name,quality});
            const state=await control.evaluate(async()=>window.materialSuite.advance(1)),shot=await control.evaluate(async()=>window.materialSuite.pixels()),data=Buffer.from(shot.data,"base64"),png=PNG.sync.write({width:shot.width,height:shot.height,data}),file=`${backend}-${name}-${quality}-${implementation}-control.png`;
            await writeFile(join(output,file),png);record.control={setup,state,image:{path:file,sha256:hash(png)},changed:[],disposed:await control.evaluate(async()=>window.materialSuite.dispose())};
            assert.equal(record.control.disposed.allDevicesDestroyed,true);assert.deepEqual(record.control.disposed.validation,[]);assert.deepEqual(record.control.disposed.losses,[]);
            if(implementation==="mtek"){assert.deepEqual(state.info.diagnostics,[]);for(const key of ["liveBuffers","liveTextures","liveSamplers","liveShaderModules","livePipelines","liveBindGroups","liveListeners"])assert.equal(record.control.disposed.result.runtime[key],0,key);}
            const region=name==="product"?regionsFor(definition).find(r=>r.id==="Product0"):{x:0,y:0,width:definition.profile.width,height:definition.profile.height};
            const threshold=name==="product"?protocol.product.normalMapControl.changedChannelError:8;
            for(const actual of images[implementation]){let changed=0;for(let y=region.y;y<region.y+region.height;y++)for(let x=region.x;x<region.x+region.width;x++){const at=(y*definition.profile.width+x)*4;if(Math.max(...[0,1,2].map(c=>Math.abs(actual[at+c]-data[at+c])))>threshold)changed++;}record.control.changed.push(changed);assert(changed>=(name==="product"?protocol.product.normalMapControl.minimumChangedPixels[quality]:protocol.visualGate.particleChangedPixelsMin[quality]),`${name} has no visible contribution against its declared control`);}
          }finally{await control.close();}
        }
        record.status="passed";
      }catch(error){record.status="failed";record.failure=String(error);record.errors=errors;try{record.pageState=await page.evaluate(()=>document.querySelector("#status").textContent);}catch{/* The page may already have failed; preserve the original error. */}console.error(`${name}/${quality}/${implementation}: ${error}`);}
      finally{await page.close();}
    }
    if(Object.values(row.implementations).every(r=>r.status==="passed"))for(let i=0;i<captures.length;i++)row.comparisons.push({frame:captures[i],...compareImages(images.mtek[i],images.three[i],definition.profile.width,definition.profile.height,regionsFor(definition,captures[i]))});
    row.status=row.comparisons.length===captures.length&&row.comparisons.every(c=>c.passed)?"passed":"failed";
    console.log(`${name}/${quality}: ${row.status}; ${row.comparisons.map(c=>c.regions.map(r=>`${r.id} MAE ${r.meanAbsoluteRgb8.toFixed(2)}, p95 ${r.p95MaximumChannelError8}`).join("; ")).join(" | ")}`);
    await writeFile(reportPath,JSON.stringify(report,null,2)+"\n");
  }
  report.completeMatrix=report.cases.length===10;report.status=report.cases.length>0&&report.cases.every(c=>c.status==="passed")?"passed":"failed";
  report.visualPrerequisitesPassed=report.completeMatrix&&report.status==="passed";
  report.performanceEligible=false;
  report.performanceBoundary="Visual prerequisites only; complete qualified timing/presentation runner and regression budgets remain pending";
  if(report.status!=="passed")process.exitCode=1;
}catch(error){report.status="failed";report.failure=String(error);console.error(error);process.exitCode=1;}
finally{await browser?.close();await server?.close();report.finishedAt=new Date().toISOString();await writeFile(reportPath,JSON.stringify(report,null,2)+"\n");}
