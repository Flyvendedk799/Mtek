import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {prepareMaterials} from '../benchmarks/material-lighting/prepare.mjs';
import {startServer} from '../benchmarks/material-lighting/server.mjs';
import {softwareLaunchArgs,hardwareLaunchArgs,browserChannel} from '../tests/browser/support/launch-args.ts';
const backend=process.argv[2],out=resolve(`.out/product-normal-diagnostic-${backend}`);
await mkdir(out,{recursive:true}); await prepareMaterials();
const server=await startServer(resolve('benchmarks/material-lighting/.out/site'));
const browser=await chromium.launch({channel:browserChannel(),headless:true,args:backend==='software'?softwareLaunchArgs():hardwareLaunchArgs()});
try{
  const result=[];
  for(const control of [false,true]){
    const page=await browser.newPage(); await page.goto(server.url);await page.waitForFunction(()=>window.materialSuite);
    await page.evaluate(()=>{window.shaders=[];const original=GPUDevice.prototype.createShaderModule;GPUDevice.prototype.createShaderModule=function(d){window.shaders.push(d.code);return original.call(this,d);};});
    const setup=await page.evaluate(control=>window.materialSuite.setup('three','product','standard','correctness',control),control);
    const shots=[];
    for(const frames of [1,7]){const state=await page.evaluate(n=>window.materialSuite.advance(n),frames),shot=await page.evaluate(()=>window.materialSuite.pixels());shots.push({state,...shot});}
    const shaders=await page.evaluate(()=>window.shaders);for(let i=0;i<shaders.length;i++)await writeFile(`${out}/${control?'control':'normal'}-${i}.wgsl`,shaders[i]);
    result.push({control,setup,shots,disposed:await page.evaluate(()=>window.materialSuite.dispose())});await page.close();
  }
  const decode=shot=>Buffer.from(shot.data,'base64'),different=(a,b)=>{const counts={over0:0,over2:0,over8:0,max:0};for(let i=0;i<a.length;i+=4){const d=Math.max(...[0,1,2].map(c=>Math.abs(a[i+c]-b[i+c])));if(d>0)counts.over0++;if(d>2)counts.over2++;if(d>8)counts.over8++;counts.max=Math.max(counts.max,d);}return counts;};
  const comparisons=[0,1].map(i=>different(decode(result[0].shots[i]),decode(result[1].shots[i])));
  await writeFile(`${out}/result.json`,JSON.stringify({result,comparisons},null,2));console.log(JSON.stringify({comparisons,normal:result[0].shots[0].state.info.productIdentity,control:result[1].shots[0].state.info.productIdentity}));
}finally{await browser.close();await server.close();}
