// End-to-end test of the actual compiled Mtek game. No injected health, kills or room changes.
// Run from the repository root after `mtek build --mode test GameExamples/Night_Shift`.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { startStaticServer } from '../../../tests/browser/support/serve.ts';
const out = resolve('tests/browser/results/room-clearer');
mkdirSync(out, { recursive: true });
const server = await startStaticServer(resolve('GameExamples/Night_Shift'));
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => { window.mtekDiagnostics = []; window.mtekHostOptions = { devicePixelRatio: 1, test: { manualClock: true }, onDiagnostic: d => { if (d.severity === 'error') window.mtekDiagnostics.push(d.message); } }; });
const state = () => page.evaluate(() => window.mtekApp.debug.scene());
const step = (n = 1, dt = 1 / 60) => page.evaluate(([n, dt]) => window.mtekApp.debug.step(n, dt), [n, dt]);
const input = (name, value) => page.evaluate(([name, value]) => window.mtekApp.setInput(name, value), [name, value]);
const key = (code, down) => page.evaluate(([code, down]) => window.mtekApp.debug[down ? 'pressKey' : 'releaseKey'](code), [code, down]);
const guards = s => s.entities.filter(e => /^Guard\d$/.test(e.name) && e.position.y > -1);
async function open() {
  await page.goto(server.url + '/host/index.html');
  await page.waitForFunction(() => window.mtekApp?.debug);
  await input('active', true); await step(4);
  await page.locator('#menu').evaluate(e => { e.hidden = true; });
  await page.locator('#game').focus();
}
async function aimAt(target, height = 1.65) {
  const s = await state(), eye = s.state.eye;
  const dx = target.x - eye.x, dy = target.y + height - eye.y, dz = target.z - eye.z;
  await input('yaw', Math.atan2(-dx, -dz));
  await input('pitch', Math.atan2(dy, Math.hypot(dx, dz)));
  await step();
}
try {
  await open();
  for(const name of ['Guard1','Guard2']) {
    await aimAt(guards(await state()).find(g=>g.name===name).position);
    await page.mouse.down();await step();await page.mouse.up();await step(14);
  }
  let observed=false;
  for(let frame=0;frame<1500;frame++) {
    await step();const s=await state();
    const magazine=s.entities.find(e=>e.name.includes('Guard0') && e.name.endsWith('NpcMagazine'));
    if(magazine?.position.y<-.27) {
      const guard=guards(s).find(g=>g.name==='Guard0');await aimAt(guard.position,1.2);
      await page.screenshot({path:out+'/npc-reload.png'});
      const position={...guard.position};const health=s.state.health;
      await step(10);const held=guards(await state()).find(g=>g.name==='Guard0');
      assert.ok(Math.hypot(held.position.x-position.x,held.position.z-position.z)<.001,'reloading NPC must plant feet');
      assert.equal((await state()).state.health,health,'NPC cannot fire during reload');
      await aimAt(held.position,1.0);await page.mouse.down();await step();await page.mouse.up();await step(5);
      assert.ok((await state()).entities.find(e=>e.name.includes('Guard0') && e.name.endsWith('NpcMagazine')).position.y>-.15,'hit cancels reload');
      let restarted=false;
      for(let frame=0;frame<100;frame++) {
        await step();
        if((await state()).entities.find(e=>e.name.includes('Guard0') && e.name.endsWith('NpcMagazine')).position.y<-.27) {restarted=true;break;}
      }
      assert.ok(restarted,'empty NPC restarts reload after hit recovery');
      await step(75);
      assert.ok((await state()).entities.find(e=>e.name.includes('Guard0') && e.name.endsWith('NpcMagazine')).position.y>-.15,'NPC magazine reseats');
      observed=true;break;
    }
  }
  assert.ok(observed,'NPC must visibly reload after six shots');
  await open();await key('KeyW',true);await key('ShiftLeft',true);await step(35);
  assert.ok((await state()).state.sprint_pose>.9,'sprinting lowers the weapon smoothly');
  await page.screenshot({path:out+'/movement-sprint.png'});
  await key('KeyW',false);await key('ShiftLeft',false);await step(50);
  assert.ok((await state()).state.sprint_pose<.01,'stopping restores weapon posture');
  await open();await input('yaw',Math.PI);await key('KeyW',true);await step(120);
  const blocked=await state();await step(30);const stopped=await state();
  assert.ok(Math.abs(stopped.state.bob-blocked.state.bob)<.001,'wall collision stops gait phase');
  assert.ok(stopped.state.motion<.01,'wall collision settles movement sway');
  await key('KeyW',false);
  assert.deepEqual(errors,[]);console.log('PASS: NPC reload, planted recovery, magazine reseating, collision-aware movement feedback.');
} finally {await browser.close();await server.close();}
