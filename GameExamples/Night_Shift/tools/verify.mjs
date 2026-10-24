// End-to-end test of the actual compiled Mtek game. No injected health, kills or room changes.
// Run from the repository root after `mtek build --mode test GameExamples/Night_Shift`.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
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
const covers = s => s.spawned.filter(e => e.prefab.endsWith('Solid') && e.alive);
function blocked(p, solids, radius = .40) {
  return Math.abs(p.x) > 6.15 || p.z > 7.8 || p.z < -9.1 || (p.z < -7.4 && Math.abs(p.x) > .9) || solids.some(c => Math.abs(p.x-c.position.x) < c.scale.x/2+radius && Math.abs(p.z-c.position.z) < c.scale.z/2+radius);
}
function lineClear(a, b, solids) {
  // Independently sample the sight line at 5 cm intervals, including occluder height.
  const length = Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z), steps = Math.ceil(length/.05);
  for(let i=0;i<=steps;i++) {
    const t=i/Math.max(steps,1), p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t};
    if(solids.some(c=>Math.abs(p.x-c.position.x)<c.scale.x/2 && Math.abs(p.y-c.position.y)<c.scale.y/2 && Math.abs(p.z-c.position.z)<c.scale.z/2)) return false;
  }
  return true;
}
function pathTo(start, goal, solids) {
  const cell = p => [Math.round(p.x*2),Math.round(p.z*2)];
  const [sx,sz]=cell(start), [gx,gz]=cell(goal), first=`${sx},${sz}`, end=`${gx},${gz}`;
  const queue=[[sx,sz]], previous=new Map([[first,null]]);
  for(let n=0;n<queue.length;n++) {
    const [x,z]=queue[n], id=`${x},${z}`;
    if(id===end) { const path=[]; for(let k=id;k!==first;k=previous.get(k)) { const [px,pz]=k.split(',').map(Number);path.push({x:px/2,z:pz/2}); } return path.reverse(); }
    for(const [dx,dz] of [[0,-1],[-1,0],[1,0],[0,1]]) {
      const nx=x+dx,nz=z+dz,key=`${nx},${nz}`;
      if(!previous.has(key) && !blocked({x:nx/2,z:nz/2},solids)) { previous.set(key,id);queue.push([nx,nz]); }
    }
  }
  throw new Error(`No walkable route from ${first} to ${end}`);
}
async function walkTo(goal, stopRoom) {
  const initial=await state(), path=pathTo(initial.state.eye,goal,covers(initial));
  for(const point of path) {
    for(let attempts=0;attempts<18;attempts++) {
      const s=await state(); if(s.state.room!==stopRoom || s.state.victory) { await key('KeyW',false); return; }
      const dx=point.x-s.state.eye.x,dz=point.z-s.state.eye.z;
      if(Math.hypot(dx,dz)<.18) break;
      await input('yaw',Math.atan2(-dx,-dz)); await input('pitch',0);
      await key('KeyW',true); await step(3);
    }
  }
  await key('KeyW',false); await step(4);
}
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
  assert.equal(guards(await state()).length, 3);
  await page.screenshot({ path: out + '/gameplay.png' });
  // Pause freezes simulation; release movement to avoid a held key affecting the next case.
  await input('active', false); await step(2); const paused = await state();
  await key('KeyW', true); await step(60);
  assert.equal((await state()).state.elapsed, paused.state.elapsed);
  await key('KeyW', false); await input('active', true); await step(2);
  // Six real encounters: aim, shoot and physically walk through each unlocked exit.
  const rooms = [];
  for (let room = 0; room < 6; room++) {
    const population = [3, 4, 5, 5, 6, 7][room];
    assert.equal(guards(await state()).length, population);
    const entry=await state(), solids=covers(entry);
    assert.equal(solids.length,[3,6,5,6,5,6][room]);
    for(const guard of guards(entry)) assert.equal(blocked(guard.position,solids,.34),false,`${guard.name} must spawn outside furniture`);
    const frameCosts = await page.evaluate(() => {
      const samples = [];
      for (let i=0;i<32;i++) { const start=performance.now(); window.mtekApp.debug.step(1,1/60); samples.push(performance.now()-start); }
      samples.sort((a,b)=>a-b);
      return { medianCpuMs:samples[16], p95CpuMs:samples[30] };
    }); // allow the doorway fade to finish and observe all active rigs
    await page.screenshot({path:out+`/room-${room+1}.png`});
    for (let attempts = 0; guards(await state()).length && attempts < 40; attempts++) {
      const s=await state();
      const visible=guards(s).filter(g=>lineClear(s.state.eye,{...g.position,y:1.65},covers(s)));
      let guard=visible[0];
      if(!guard) {
        guard=guards(s)[0];
        const candidates=[];
        for(let x=-5.5;x<=5.5;x+=1) for(let z=5;z>=-6;z-=1) {
          const p={x,y:1.65,z};
          if(!blocked(p,covers(s)) && lineClear(p,{...guard.position,y:1.65},covers(s))) candidates.push(p);
        }
        candidates.sort((a,b)=>Math.hypot(a.x-s.state.eye.x,a.z-s.state.eye.z)-Math.hypot(b.x-s.state.eye.x,b.z-s.state.eye.z));
        assert.ok(candidates.length,'reachable shooting angle');
        await walkTo(candidates[0],room); continue;
      }
      await aimAt(guard.position);
      await page.mouse.down(); await step(); await page.mouse.up(); await step(13);
    }
    let s = await state();
    assert.equal(guards(s).length, 0, `room ${room + 1} cleared by shooting`);
    assert.equal(s.state.room_kills, population);
    assert.ok(s.state.health > 0);
    rooms.push({ room: room + 1, enemies: population, kills: s.state.kills, health: s.state.health, ...frameCosts });
    console.log(`Room ${room + 1}: ${s.state.kills}/30 cleared`);
    await input('yaw', 0); await input('pitch', 0); await step(40);
    assert.equal((await state()).state.door, 1);
    await walkTo({x:0,z:-9},room);
    await key('KeyW', false); await step(4);
    if (room < 5) assert.equal((await state()).state.room, room + 1);
  }
  const won = await state();
  assert.equal(won.state.kills, 30); assert.equal(won.state.victory, true);
  await page.screenshot({ path: out + '/complete.png' });
  // An actual aimed shot must hit the enemy under the aligned front sight.
  await open();
  await aimAt(guards(await state()).find(g=>g.name==='Guard1').position);
  await page.mouse.down({button:'right'});await step(30);
  await aimAt(guards(await state()).find(g=>g.name==='Guard1').position);
  await page.mouse.down();await step();await page.mouse.up();await step(13);
  assert.equal((await state()).state.headshots,1,'aimed shot follows the sight line');
  await page.mouse.up({button:'right'});
  // Fresh run: delayed melee impact, two-strike kill, healing reward and reload finish.
  await open();
  await key('KeyW', true);
  for (let i = 0; i < 150; i++) {
    await step(); const s = await state(); const g = guards(s).find(g => g.name === 'Guard1');
    if (g && Math.hypot(g.position.x - s.state.eye.x, g.position.z - s.state.eye.z) < 1.55) break;
  }
  await key('KeyW', false); await step(8);
  let s = await state(); let target = guards(s).find(g => g.name === 'Guard1');
  assert.ok(target); await aimAt(target.position, 1.3);
  await key('KeyF', true); await step(); await key('KeyF', false);
  assert.equal((await state()).state.kills, 0, 'punch damage waits for contact frame');
  await step(16);
  s = await state(); target = guards(s).find(g => g.name === 'Guard1');
  assert.ok(target, 'one punch staggers rather than kills');
  await aimAt(target.position, 1.3);
  await key('KeyF', true); await step(); await key('KeyF', false);
  assert.ok((await state()).state.melee_buffer > 0, 'follow-up punch buffered during recovery');
  await step(36);
  assert.equal((await state()).state.melee_kills, 1);
  await page.screenshot({ path: out + '/melee.png' });
  for(let frame=0;frame<40 && (await state()).state.punch>0;frame++) await step();
  await page.mouse.down(); await step(); await page.mouse.up(); await step(14);
  assert.ok((await state()).state.ammo < 12);
  await key('KeyR', true); await step(); await key('KeyR', false);
  assert.ok((await state()).state.reload > 0);
  await step(35); await page.screenshot({ path: out + '/reload.png' }); await step(45);
  assert.equal((await state()).state.ammo, 12);
  // Takedown is a separate one-hit action at short range; dodge cooldown is independent.
  await open();
  await key('KeyW', true);
  for (let i = 0; i < 150; i++) {
    await step(); const s = await state(); const g = guards(s).find(g => g.name === 'Guard1');
    if (g && Math.hypot(g.position.x - s.state.eye.x, g.position.z - s.state.eye.z) < 1.4) break;
  }
  await key('KeyW', false); await step(8);
  s = await state(); target = guards(s).find(g => g.name === 'Guard1');
  assert.ok(target); await aimAt(target.position, 1.3);
  await key('KeyE', true); await step(); await key('KeyE', false);
  assert.equal((await state()).state.finishing,true,'takedown selects a visible nearby target');
  const beforeClose=(await state()).state.eye;
  await step(9);await page.screenshot({path:out+'/takedown-approach.png'});
  const afterClose=(await state()).state.eye;
  assert.ok(Math.hypot(afterClose.x-beforeClose.x,afterClose.z-beforeClose.z)>.08,'takedown steps into contact');
  await step(6);await page.screenshot({path:out+'/takedown-contact.png'});
  await step(10);
  assert.equal((await state()).state.melee_kills, 1);
  await key('Space', true); await step(); await key('Space', false);
  assert.ok((await state()).state.dash > 0);
  assert.ok((await state()).state.immunity > 0);
  await step(60); assert.equal((await state()).state.dash_wait, 0);
  // The production pointer-lock adapter captures, turns, pauses on unlock and resumes.
  await open();
  await page.locator('#menu').evaluate(e => { e.hidden = false; });
  await page.locator('#start').click();
  await page.waitForFunction(() => document.pointerLockElement === document.querySelector('#game'));
  await page.mouse.move(850, 420); await step(2);
  assert.notEqual((await state()).state.yaw, 0);
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForFunction(() => document.pointerLockElement === null); await step(2);
  assert.equal((await state()).state.active, false);
  await page.locator('#start').click();
  await page.waitForFunction(() => document.pointerLockElement !== null); await step(2);
  assert.equal((await state()).state.active, true);
  // Let the actual AI defeat the stationary player, then restart using the real Enter event.
  for (let i = 0; i < 30 && (await state()).state.health > 0; i++) await step(60);
  assert.equal((await state()).state.health, 0);
  await page.waitForFunction(() => document.pointerLockElement === null);
  await step(2);
  await page.keyboard.down('Enter'); await step(2); await page.keyboard.up('Enter'); await step(4);
  await page.waitForFunction(() => document.pointerLockElement !== null);
  await page.waitForFunction(() => { window.mtekApp.debug.step(1, 1/60); return window.mtekApp.debug.scene().state.health === 100; });
  await step(4);
  assert.equal((await state()).state.health, 100);
  assert.equal((await state()).state.kills, 0);
  assert.equal((await state()).state.room, 0);
  assert.equal((await state()).state.active, true);
  assert.deepEqual(await page.evaluate(() => window.mtekDiagnostics), []);
  assert.deepEqual(errors, []);
  const report = { browser: browser.version(), rooms, final: won.state, counters: await page.evaluate(() => window.mtekApp.debug.counters()), errors };
  writeFileSync(out + '/report.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ result: 'PASS', rooms, kills: won.state.kills, melee: 'PASS', reload: 'PASS', pause: 'PASS' }));
} finally { await browser.close(); await server.close(); }
