import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {startServer} from '../benchmarks/material-lighting/server.mjs';
import {softwareLaunchArgs,hardwareLaunchArgs,browserChannel} from '../tests/browser/support/launch-args.ts';
const backend=process.argv[2],out=resolve(`.out/product-texture-diagnostic-${backend}`);await mkdir(out,{recursive:true});
const server=await startServer(resolve('benchmarks/material-lighting/.out/site'));
const browser=await chromium.launch({channel:browserChannel(),headless:true,args:backend==='software'?softwareLaunchArgs():hardwareLaunchArgs()});
try{
 const page=await browser.newPage();await page.goto(server.url);await page.waitForFunction(()=>window.materialSuite);
 await page.evaluate(()=>{
  const views=new WeakMap(),textures=new WeakSet();window.normalTexture=null;
  const createTexture=GPUDevice.prototype.createTexture,createView=GPUTexture.prototype.createView,createGroup=GPUDevice.prototype.createBindGroup;
  GPUDevice.prototype.createTexture=function(d){const size=d.size;const large=(size.width??size[0])===2048&&(size.height??size[1])===2048&&d.format==='rgba8unorm';const texture=createTexture.call(this,large?{...d,usage:d.usage|1}:d);if(large)textures.add(texture);return texture;};
  GPUTexture.prototype.createView=function(d){const view=createView.call(this,d);views.set(view,this);return view;};
  GPUDevice.prototype.createBindGroup=function(d){const entries=[...d.entries];if(entries.some(e=>e.binding===14)){const normal=views.get(entries.find(e=>e.binding===10)?.resource);if(normal&&textures.has(normal))window.normalTexture={device:this,texture:normal};}return createGroup.call(this,d);};
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
 const disposed=await page.evaluate(()=>window.materialSuite.dispose());await writeFile(`${out}/result.json`,JSON.stringify({setup,data,disposed},null,2));console.log(JSON.stringify(data));
}finally{await browser.close();await server.close();}
