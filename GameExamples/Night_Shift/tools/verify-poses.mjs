// Capture successive poses in the actual game, including a close view of locomotion.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { startStaticServer } from '../../../tests/browser/support/serve.ts';
const out=resolve('tests/browser/results/room-clearer');mkdirSync(out,{recursive:true});
const server=await startStaticServer(resolve('GameExamples/Night_Shift'));
const browser=await chromium.launch({channel:'chromium',headless:true,args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1440,height:900}});
await page.addInitScript(()=>{window.mtekHostOptions={devicePixelRatio:1,test:{manualClock:true}}});
try {
  await page.goto(server.url+'/host/');await page.waitForFunction(()=>window.mtekApp?.debug);
  await page.evaluate(()=>window.mtekApp.setInput('active',true));
  await page.locator('#menu').evaluate(e=>e.hidden=true);
  await page.evaluate(()=>window.mtekApp.debug.step(45,1/60));
  for(let frame=0;frame<8;frame++) {
    await page.screenshot({path:out+`/run-${frame}.png`});
    await page.evaluate(()=>window.mtekApp.debug.step(5,1/60));
  }
  await page.evaluate(()=>window.mtekApp.debug.step(25,1/60));
  await page.screenshot({path:out+'/enemy-close.png'});
} finally {await browser.close();await server.close();}
