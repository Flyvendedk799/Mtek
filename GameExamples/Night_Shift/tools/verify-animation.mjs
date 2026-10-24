// Observe the real generated animation transforms at windup, contact and recovery.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { startStaticServer } from '../../../tests/browser/support/serve.ts';
const out=resolve('tests/browser/results/room-clearer'); mkdirSync(out,{recursive:true});
const server=await startStaticServer(resolve('GameExamples/Night_Shift'));
const browser=await chromium.launch({channel:'chromium',headless:true,args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{window.mtekHostOptions={devicePixelRatio:1,test:{manualClock:true}}});
const step=n=>page.evaluate(n=>window.mtekApp.debug.step(n,1/120),n);
const state=()=>page.evaluate(()=>window.mtekApp.debug.scene());
const key=(code,down)=>page.evaluate(([c,d])=>window.mtekApp.debug[d?'pressKey':'releaseKey'](c),[code,down]);
const entity=(s,name)=>s.entities.find(e=>e.name===name||e.name.endsWith('.'+name));
try {
  await page.goto(server.url+'/host/');await page.waitForFunction(()=>window.mtekApp?.debug);
  await page.evaluate(()=>window.mtekApp.setInput('active',true));await step(4);
  await page.locator('#menu').evaluate(e=>e.hidden=true);await page.locator('#game').focus();
  await page.evaluate(()=>window.mtekApp.setInput('yaw',Math.PI));await step(2);
  const idle=await state();await page.screenshot({path:out+'/pose-idle.png'});
  await page.mouse.down({button:'right'});await step(120);
  const aimed=await state();
  // At rest the front-sight tip must coincide with the camera ray in view space.
  const tip={x:aimed.state.weapon_socket.x+aimed.state.rig_offset.x,
    y:aimed.state.weapon_socket.y+aimed.state.rig_offset.y+.0705};
  assert.ok(Math.abs(tip.x)<.001 && Math.abs(tip.y)<.001,'iron sight must align with the camera ray');
  await page.screenshot({path:out+'/pose-aimed.png'});
  for (const [width,height] of [[1024,768],[1920,1080]]) {
    await page.setViewportSize({width,height}); await step(2);
    await page.screenshot({path:out+`/aim-${width}x${height}.png`});
  }
  await page.setViewportSize({width:1440,height:900});
  await page.mouse.up({button:'right'});await step(100);
  await page.mouse.down();await step(1);await page.mouse.up();await step(2);
  const kicked=await state();
  assert.ok(kicked.state.recoil>.8,'shot kicks before spring recovery');
  assert.ok(kicked.state.slide_time > 0 && kicked.state.slide_time < .03,'native slide clip advances through retraction');
  await page.screenshot({path:out+'/pose-recoil.png'});
  await step(55);assert.ok(Math.abs((await state()).state.recoil)<.02,'recoil settles');
  assert.ok(Math.abs((await state()).state.slide_time-.085)<.0001,'native slide clip holds at its end without looping');
  await key('KeyR',true);await step(1);await key('KeyR',false);await step(62);
  const magOut=await state();
  assert.ok(entity(magOut,'Magazine').position.y<-.34,'magazine extracted during reload');
  await page.screenshot({path:out+'/pose-magazine-out.png'});
  await step(96);assert.equal((await state()).state.ammo,12);
  assert.ok(Math.abs(entity(await state(),'Magazine').position.y+.14)<.001,'magazine reseated');
  await key('KeyF',true);await step(1);await key('KeyF',false);await step(8);
  const windup=await state();await page.screenshot({path:out+'/pose-windup.png'});
  await step(15);const contact=await state();await page.screenshot({path:out+'/pose-contact.png'});
  assert.ok(contact.state.strike_socket.z < windup.state.strike_socket.z-.12,'contact extends forward after windup');
  await step(45);assert.equal((await state()).state.punch,0);await page.screenshot({path:out+'/pose-recovered.png'});
  // Empty magazine visibly locks the slide; it closes only after insertion.
  for(let shot=0;shot<12;shot++) {
    await page.mouse.down();await step(1);await page.mouse.up();await step(26);
  }
  assert.equal((await state()).state.ammo,0);
  assert.ok(Math.abs((await state()).state.slide_time-.025)<.001,'empty slide holds open');
  await page.screenshot({path:out+'/pose-empty-slide.png'});
  await key('KeyR',true);await step(1);await key('KeyR',false);await step(62);
  assert.ok(Math.abs((await state()).state.slide_time-.025)<.001,'slide stays open during magazine extraction');
  await step(96);
  assert.equal((await state()).state.ammo,12);
  assert.ok(Math.abs((await state()).state.slide_time-.085)<.001,'slide returns to battery after insertion');
  assert.deepEqual(errors,[]);console.log('PASS: sight alignment, slide cycle, recoil spring, magazine removal/insertion, punch windup/contact/recovery.');
} finally {await browser.close();await server.close();}
