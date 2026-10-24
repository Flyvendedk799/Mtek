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
  await open();await key('KeyW',true);await step(38);await key('KeyW',false);await step(10);
  let victim=guards(await state()).find(g=>g.name==='Guard1');
  await aimAt(victim.position,1.0);
  await page.mouse.down();await step();await page.mouse.up();
  for(let i=0;i<5;i++){await page.screenshot({path:out+`/review-hit-${i}.png`});await step(5);}
  victim=guards(await state()).find(g=>g.name==='Guard1');await aimAt(victim.position);
  await page.mouse.down();await step();await page.mouse.up();
  for(let i=0;i<9;i++){await page.screenshot({path:out+`/review-fall-${i}.png`});await step(9);}
  await key('KeyR',true);await step();await key('KeyR',false);
  for(let i=0;i<8;i++){await page.screenshot({path:out+`/review-reload-${i}.png`});await step(10);}
  await open();await key('KeyW',true);await step(38);await key('KeyW',false);
  for(let i=0;i<12;i++){await page.screenshot({path:out+`/review-attack-${i}.png`});await step(10);}
  assert.deepEqual(errors,[]);
} finally {await browser.close();await server.close();}
