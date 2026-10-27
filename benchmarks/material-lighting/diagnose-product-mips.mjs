import {chromium} from '@playwright/test';
import {mkdir,writeFile,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {startServer} from './server.mjs';
import {prepareMaterials} from './prepare.mjs';
import {softwareLaunchArgs,hardwareLaunchArgs,browserChannel} from '../../tests/browser/support/launch-args.ts';
// Diagnostic only: COPY_SRC is added to the original texture allocation so its
// native generated mip chain can be read. No timing result is eligible here.
const backend=process.argv[2]??'hardware',out=resolve(process.argv[3]??`.out/product-mips-${backend}-${Date.now()}`);
assert(['hardware','software'].includes(backend));assert(!process.argv[3]?.startsWith('--'));
await mkdir(out,{recursive:true});const handle=await open(`${out}/result.json`,'wx');await handle.close();await prepareMaterials();
const server=await startServer(resolve('benchmarks/material-lighting/.out/site'));
const browser=await chromium.launch({channel:browserChannel(),headless:true,args:backend==='software'?softwareLaunchArgs():hardwareLaunchArgs()});
try{
 const page=await browser.newPage();await page.goto(server.url);await page.waitForFunction(()=>window.materialSuite);
 await page.evaluate(()=>{
  const views=new WeakMap(),textures=new WeakSet();window.normalTexture=null;
  const createTexture=window.GPUDevice.prototype.createTexture,createView=window.GPUTexture.prototype.createView,createGroup=window.GPUDevice.prototype.createBindGroup;
  window.GPUDevice.prototype.createTexture=function(d){const size=d.size;const large=(size.width??size[0])===2048&&(size.height??size[1])===2048&&d.format==='rgba8unorm';const texture=createTexture.call(this,large?{...d,usage:d.usage|1}:d);if(large)textures.add(texture);return texture;};
  window.GPUTexture.prototype.createView=function(d){const view=createView.call(this,d);views.set(view,this);return view;};
  window.GPUDevice.prototype.createBindGroup=function(d){const entries=[...d.entries];if(entries.some(e=>e.binding===14)){const normal=views.get(entries.find(e=>e.binding===10)?.resource);if(normal&&textures.has(normal))window.normalTexture={device:this,texture:normal};}return createGroup.call(this,d);};
 });
 const setup=await page.evaluate(()=>window.materialSuite.setup('three','product','standard'));
 await page.evaluate(()=>window.materialSuite.advance(1));
 const data=await page.evaluate(async()=>{
  if(!window.normalTexture)throw new Error('Normal GPU texture not found');const {device,texture}=window.normalTexture,result=[];
  for(let mip=0;mip<texture.mipLevelCount;mip++){
   const size=texture.width>>mip,pitch=Math.ceil(size*4/256)*256,buffer=device.createBuffer({size:pitch*size,usage:9}),encoder=device.createCommandEncoder();
   encoder.copyTextureToBuffer({texture,mipLevel:mip},{buffer,bytesPerRow:pitch},[size,size]);device.queue.submit([encoder.finish()]);await buffer.mapAsync(1);
   const raw=new Uint8Array(buffer.getMappedRange()),packed=new Uint8Array(size*size*4);for(let y=0;y<size;y++)packed.set(raw.subarray(y*pitch,y*pitch+size*4),y*size*4);
   const sums=[0,0,0,0],min=[255,255,255,255],max=[0,0,0,0];for(let i=0;i<packed.length;i++){const c=i%4,v=packed[i];sums[c]+=v;min[c]=Math.min(min[c],v);max[c]=Math.max(max[c],v);}
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',packed)),v=>v.toString(16).padStart(2,'0')).join('');
   result.push({mip,size,sha256:digest,min,max,mean:sums.map(s=>s/(size*size))});buffer.unmap();buffer.destroy();
  }
  return result;
 });
 const disposed=await page.evaluate(()=>window.materialSuite.dispose());
 assert.deepEqual(disposed.validation,[]);assert.deepEqual(disposed.losses,[]);assert.equal(disposed.allDevicesDestroyed,true);
 await writeFile(`${out}/result.json`,JSON.stringify({format:'mtek-native-product-mips/1',backend,performanceEligible:false,instrumentation:'COPY_SRC added to native 2048-square rgba8unorm allocations; Three 0.186.1 product normal map at material binding 10',setup,data,disposed},null,2)+'\n');console.log(JSON.stringify(data));
}finally{await browser.close();await server.close();}
