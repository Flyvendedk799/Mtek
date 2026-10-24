// @ts-check
// Browser-only pointer capture. Combat, animation, HUD and progression live in src/*.mtek.
import program, { mountMtek } from '../dist/app.js';
const canvas = /** @type {HTMLCanvasElement} */ (document.querySelector('#game'));
const menu = /** @type {HTMLElement} */ (document.querySelector('#menu'));
const start = /** @type {HTMLButtonElement} */ (document.querySelector('#start'));
const status = /** @type {HTMLElement} */ (document.querySelector('#status'));
/** @type {import('../dist/runtime.js').MtekApp<import('../dist/app.js').Inputs, import('../dist/app.js').Outputs> | undefined} */
let app;
let yaw = 0, pitch = 0, ended = false;
/** @type {(() => void)[]} */
const subscriptions = [];
const controller = new AbortController();
const options = { signal: controller.signal };
// Optional mount options are used by the browser tests, never by normal play.
const host = /** @type {Window & { mtekHostOptions?: import('../dist/runtime.js').MtekMountOptions<import('../dist/app.js').Inputs>, mtekApp?: typeof app }} */ (window);
function focusChanged() {
  const locked = document.pointerLockElement === canvas;
  app?.setInput('active', locked);
  menu.hidden = locked || ended;
  if (!locked && !ended) { start.textContent = 'RESUME CONTRACT'; status.textContent = 'Click to capture the mouse. Escape releases it.'; }
}
document.addEventListener('pointerlockchange', focusChanged, options);
document.addEventListener('pointerlockerror', () => { status.textContent = 'Mouse capture was denied. Click Resume to try again.'; }, options);
document.addEventListener('mousemove', event => {
  if (document.pointerLockElement !== canvas || ended) return;
  yaw -= event.movementX * 0.002;
  yaw = ((yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  pitch = Math.max(-1.15, Math.min(1.15, pitch - event.movementY * 0.002));
  app?.setInput('yaw', yaw); app?.setInput('pitch', pitch);
}, options);
canvas.addEventListener('contextmenu', event => event.preventDefault(), options);
start.addEventListener('click', async () => {
  canvas.focus();
  try { await canvas.requestPointerLock(); } catch { status.textContent = 'Click again to capture the mouse.'; }
}, options);
document.addEventListener('visibilitychange', () => { if (document.hidden) { document.exitPointerLock(); app?.setInput('active', false); } }, options);
window.addEventListener('blur', () => { document.exitPointerLock(); app?.setInput('active', false); }, options);
window.addEventListener('keydown', event => {
  if (event.code === 'Enter' && ended) {
    ended = false; yaw = 0; pitch = 0;
    app?.setInput('yaw', 0); app?.setInput('pitch', 0);
    // The Mtek Enter handler resets the scene; capture remains a browser gesture.
    canvas.focus(); canvas.requestPointerLock();
  }
}, options);
try {
  app = await mountMtek(canvas, program, {
    ...host.mtekHostOptions,
    onDiagnostic(diagnostic) {
      if (diagnostic.severity === 'error') { status.textContent = diagnostic.message; menu.hidden = false; }
      host.mtekHostOptions?.onDiagnostic?.(diagnostic);
    },
  });
  host.mtekApp = app;
  const finish = () => { ended = true; document.exitPointerLock(); menu.hidden = true; };
  subscriptions.push(app.onOutput('health', value => {
    if (value <= 0) finish();
    // reset() restores Mtek's default active=false even if capture has already returned.
    // Reconcile at the settled frame boundary, after the reset's initial values are installed.
    else if (document.pointerLockElement === canvas) app?.setInput('active', true);
  }));
  subscriptions.push(app.onOutput('victory', value => { if (value) finish(); }));
  subscriptions.push(app.onOutput('room', () => { yaw = 0; pitch = 0; app?.setInput('yaw', 0); app?.setInput('pitch', 0); }));
  start.disabled = false; start.textContent = 'BEGIN CONTRACT →';
  status.textContent = 'Click to capture the mouse. Escape releases it.';
} catch (error) {
  status.textContent = `Unable to start: ${error instanceof Error ? error.message : String(error)}. A browser with WebGPU is required.`;
}
window.addEventListener('pagehide', () => {
  controller.abort(); for (const off of subscriptions) off(); app?.dispose();
}, { once: true });
