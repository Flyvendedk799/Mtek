// Smoke-test the packaged production entry page and record observed presentation cadence.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { startStaticServer } from '../../../tests/browser/support/serve.ts';
const out = resolve('tests/browser/results/room-clearer');
mkdirSync(out, { recursive: true });
const server = await startStaticServer(resolve('GameExamples/Night_Shift/dist'));
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.goto(server.url);
  await page.waitForFunction(() => !document.querySelector('#start').disabled);
  assert.equal(await page.evaluate(() => window.mtekApp.debug), undefined);
  await page.screenshot({ path: out + '/title.png' });
  await page.locator('#start').click();
  await page.waitForFunction(() => document.pointerLockElement !== null);
  const cadence = await page.evaluate(async () => {
    const adapter = await navigator.gpu.requestAdapter();
    const times = []; let last = 0;
    await new Promise(resolve => {
      function frame(time) {
        if (last) times.push(time - last);
        last = time;
        if (times.length < 180) requestAnimationFrame(frame); else resolve();
      }
      requestAnimationFrame(frame);
    });
    times.sort((a, b) => a - b);
    return { medianMs: times[90], p95Ms: times[171], adapter: adapter?.info?.description, appState: window.mtekApp.state };
  });
  await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up();
  await page.screenshot({ path: out + '/release.png' });
  assert.equal(cadence.appState, 'running');
  assert.deepEqual(errors, []);
  const report = { browser: browser.version(), viewport: '1440x900', ...cadence, errors };
  writeFileSync(out + '/release-report.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally { await browser.close(); await server.close(); }
