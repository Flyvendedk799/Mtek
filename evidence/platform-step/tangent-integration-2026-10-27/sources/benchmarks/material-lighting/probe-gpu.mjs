import assert from "node:assert/strict";
import {readFile,writeFile,mkdir,open} from "node:fs/promises";
import {resolve,join} from "node:path";
import {createHash} from "node:crypto";
import {chromium} from "@playwright/test";
import {browserChannel,hardwareLaunchArgs} from "../../tests/browser/support/launch-args.ts";
import {prepareMaterials} from "./prepare.mjs";
import {startServer} from "./server.mjs";
const output=resolve(process.argv[2]??`target/material-gpu-probe-${Date.now()}`);await mkdir(output,{recursive:true});const file=join(output,"probe.json"),handle=await open(file,"wx");await handle.close();
const report={format:"mtek-material-lighting-gpu-instrument-preflight/1",status:"running",startedAt:new Date().toISOString(),cases:[],benchmarkEligible:false};let browser,server;
try{
  report.build=await prepareMaterials();server=await startServer(join(import.meta.dirname,".out/site"));browser=await chromium.launch({channel:browserChannel(),headless:true,args:hardwareLaunchArgs()});report.browser=browser.version();
  for(const implementation of ["mtek","three"]){
    const page=await browser.newPage();try{
      await page.goto(server.url);await page.waitForFunction(()=>document.querySelector("#status").textContent==="Ready");
      const setup=await page.evaluate(async implementation=>window.materialSuite.setup(implementation,"product","low","gpu"),implementation);assert.equal(setup.adapter.isFallbackAdapter,false);assert.equal(setup.crossOriginIsolated,true);
      await page.evaluate(async()=>window.materialSuite.advance(16));const samples=await page.evaluate(async()=>window.materialSuite.samples(16));const disposed=await page.evaluate(async()=>window.materialSuite.dispose());report.cases.push({implementation,setup,samples,disposed});
      assert(samples.gpu.every(s=>s.milliseconds>0&&s.passes.length>=2&&s.encoders>=1));for(const sample of samples.gpu){let sum=0n;for(const p of sample.passes)sum+=BigInt(p.endNanoseconds)-BigInt(p.beginNanoseconds);assert.equal(Number(sum)/1e6,sample.milliseconds);}
      assert.deepEqual(disposed.validation,[]);assert.deepEqual(disposed.losses,[]);assert.equal(disposed.allDevicesDestroyed,true);console.log(`${implementation}: ${samples.gpu[0].passes.length} passes across ${samples.gpu[0].encoders} encoders; all timestamp sums validated`);
    }finally{await page.close();}
  }
  report.status="passed";
}catch(error){report.status="failed";report.failure=String(error);console.error(error);process.exitCode=1;}
finally{await browser?.close();await server?.close();report.sources=[];for(const name of ["gpu-timer.mjs","page.mjs","probe-gpu.mjs"]){const bytes=await readFile(join(import.meta.dirname,name));report.sources.push({path:`benchmarks/material-lighting/${name}`,sha256:createHash("sha256").update(bytes).digest("hex")});}report.finishedAt=new Date().toISOString();await writeFile(file,JSON.stringify(report,null,2)+"\n");}
