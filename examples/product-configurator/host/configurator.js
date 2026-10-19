// @ts-check
// The generated app.d.ts supplies both sides of this boundary. There is no use of debug.scene().
import program, { mountMtek } from "../dist/app.js";

/** @template {Element} T @param {string} selector @param {{ new(...args: never[]): T }} type @returns {T} */
function element(selector, type) {
  const result = document.querySelector(selector);
  if (!(result instanceof type)) throw new Error(`Missing ${selector}`);
  return result;
}
const canvas = element("#mtek", HTMLCanvasElement);
const controls = element("#controls", HTMLFormElement);
const quantity = element("#quantity", HTMLInputElement);
const angle = element("#angle", HTMLInputElement);
const rotate = element("#rotate", HTMLButtonElement);
const previewToggle = element("#preview-toggle", HTMLButtonElement);
const previewStatus = element("#preview-status", HTMLElement);
const status = element("#status", HTMLElement);
const canvasWrap = element("#canvas-wrap", HTMLElement);
const placeholder = element("#preview-placeholder", HTMLElement);
const finishNames = ["Sea glass", "Warm clay", "Midnight"];
const frameNames = ["Natural oak", "Walnut"];
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
/** @type {import('../dist/app.js').Inputs} */
const selection = { finish: 0, frame_finish: 0, quantity: 1, auto_rotate: false, angle: -0.25 };
/** @type {import('../dist/runtime.js').MtekApp<import('../dist/app.js').Inputs, import('../dist/app.js').Outputs> | undefined} */
let app;
/** @type {(() => void)[]} */
let subscriptions = [];
let generation = 0;
let open = true;
let requestedRotation = false;
let mountTail = Promise.resolve();
/** @type {Set<string>} */
const previewKeys = new Set();
// Test harnesses may supply deterministic mount options; normal embeds need neither global.
const host = /** @type {Window & { mtekHostOptions?: import('../dist/runtime.js').MtekMountOptions<import('../dist/app.js').Inputs>, mtekApp?: typeof app }} */ (window);
Object.assign(selection, host.mtekHostOptions?.inputs);
requestedRotation = selection.auto_rotate;

function renderSelection() {
  element("#finish-name", HTMLOutputElement).value = finishNames[selection.finish] ?? "Sea glass";
  element("#frame-name", HTMLOutputElement).value = frameNames[selection.frame_finish] ?? "Natural oak";
  for (const button of controls.querySelectorAll("[data-finish]")) {
    button.setAttribute("aria-pressed", String(Number(button.getAttribute("data-finish")) === selection.finish));
  }
  for (const button of controls.querySelectorAll("[data-frame]")) {
    button.setAttribute("aria-pressed", String(Number(button.getAttribute("data-frame")) === selection.frame_finish));
  }
  quantity.value = String(selection.quantity);
  // Keep the turntable slider readable after more than one revolution.
  angle.value = String(((selection.angle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
  rotate.setAttribute("aria-pressed", String(selection.auto_rotate));
  element("#configuration", HTMLElement).textContent = `${selection.quantity} × ${finishNames[selection.finish]} / ${frameNames[selection.frame_finish]}`;
}

/** @template {keyof typeof selection} K @param {K} name @param {(typeof selection)[K]} value */
function send(name, value) {
  if (app === undefined || app.state === "failed" || app.state === "disposed") return;
  const result = app.setInput(name, value);
  status.textContent = result.ok ? "" : result.error.message;
  if (result.ok && name === "auto_rotate") requestedRotation = Boolean(value);
  // The scene is authoritative. Controls/quote update from onOutput at the settled frame boundary.
}

function release() {
  previewKeys.clear();
  for (const unsubscribe of subscriptions) unsubscribe();
  subscriptions = [];
  app?.dispose();
  app = undefined;
  host.mtekApp = undefined;
}

function mount() {
  const ticket = ++generation;
  release();
  previewStatus.textContent = "Loading your chair…";
  status.textContent = "";
  controls.inert = true;
  // A canvas has one GPUCanvasContext: an old mount must dispose before a new one configures it.
  mountTail = mountTail.then(() => mountAttempt(ticket));
  return mountTail;
}

/** @param {number} ticket */
async function mountAttempt(ticket) {
  if (ticket !== generation || !open) return;
  try {
    const mounted = await mountMtek(canvas, program, {
      ...host.mtekHostOptions,
      inputs: { ...selection },
      onDiagnostic(diagnostic) {
        if (ticket !== generation) return;
        host.mtekHostOptions?.onDiagnostic?.(diagnostic);
        if (diagnostic.severity === "error") status.textContent = diagnostic.message;
        if (app?.state === "failed") {
          controls.inert = true;
          previewStatus.textContent = "Preview unavailable";
        }
      },
    });
    // A slower mount must not resurrect a preview the visitor has already closed or replaced.
    if (ticket !== generation || !open) { mounted.dispose(); return; }
    app = mounted;
    host.mtekApp = mounted;
    if (mounted.state === "failed") throw new Error("This browser could not start the 3D preview.");
    const update = () => { renderSelection(); previewStatus.textContent = "Live 3D preview"; };
    subscriptions = [
      mounted.onOutput("finish", value => { selection.finish = value; update(); }),
      mounted.onOutput("frame_finish", value => { selection.frame_finish = value; update(); }),
      mounted.onOutput("quantity", value => { selection.quantity = value; update(); }),
      mounted.onOutput("auto_rotate", value => { selection.auto_rotate = value; requestedRotation = value; update(); }),
      mounted.onOutput("angle", value => { selection.angle = value; angle.value = String(((value + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI); }),
      mounted.onOutput("unit_price", value => { element("#unit-price", HTMLElement).textContent = `${currency.format(value)} per chair`; }),
      mounted.onOutput("total_price", value => { element("#total-price", HTMLOutputElement).value = currency.format(value); }),
    ];
    controls.inert = false;
  } catch (error) {
    if (ticket !== generation) return;
    release();
    previewStatus.textContent = "Preview unavailable";
    status.textContent = error instanceof Error ? error.message : String(error);
    controls.inert = true;
  }
}

function closePreview() {
  open = false;
  generation += 1;
  release();
  controls.inert = true;
  canvasWrap.hidden = true;
  placeholder.hidden = false;
  previewToggle.textContent = "Open preview ↗";
  previewToggle.setAttribute("aria-expanded", "false");
  previewStatus.textContent = "Preview closed; configuration saved";
}
function openPreview() {
  if (open) return;
  open = true;
  canvasWrap.hidden = false;
  placeholder.hidden = true;
  previewToggle.textContent = "Close preview ↗";
  previewToggle.setAttribute("aria-expanded", "true");
  void mount();
}
previewToggle.addEventListener("click", () => { if (open) closePreview(); else openPreview(); });
element("#open-preview", HTMLButtonElement).addEventListener("click", openPreview);
controls.addEventListener("submit", event => event.preventDefault());
// Runtime input is document-scoped; this embed gives keys to the focused canvas only.
// Preserve a release after focus moves, so a preview key cannot remain stuck down.
document.body.addEventListener("keydown", event => {
  if (event.target === canvas) previewKeys.add(event.code);
  else event.stopPropagation();
});
document.body.addEventListener("keyup", event => {
  if (event.target !== canvas && !previewKeys.has(event.code)) event.stopPropagation();
  previewKeys.delete(event.code);
});
for (const button of controls.querySelectorAll("[data-finish]")) {
  button.addEventListener("click", () => send("finish", Number(button.getAttribute("data-finish"))));
}
for (const button of controls.querySelectorAll("[data-frame]")) {
  button.addEventListener("click", () => send("frame_finish", Number(button.getAttribute("data-frame"))));
}
quantity.addEventListener("change", () => {
  if (!quantity.checkValidity()) { quantity.reportValidity(); quantity.value = String(selection.quantity); return; }
  send("quantity", quantity.valueAsNumber);
});
angle.addEventListener("input", () => { send("auto_rotate", false); send("angle", angle.valueAsNumber); });
rotate.addEventListener("click", () => send("auto_rotate", !requestedRotation));
element("#reset", HTMLButtonElement).addEventListener("click", () => {
  send("finish", 0); send("frame_finish", 0); send("quantity", 1); send("auto_rotate", false); send("angle", -0.25);
});
canvas.addEventListener("pointerdown", () => canvas.focus());
window.addEventListener("pagehide", () => { generation += 1; release(); });
window.addEventListener("pageshow", event => { if (event.persisted && open) void mount(); });
renderSelection();
void mount();
