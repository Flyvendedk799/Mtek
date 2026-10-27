import program, { mountMtek } from "./.out/app.js";
import { cubeVertices } from "./geometry.js";

const element = id => document.getElementById(id), status = element("status");
let app, compute, attachment, revision = 0, queue = Promise.resolve();
function error(message) { element("diagnostics").hidden = false; element("diagnostics").textContent = String(message); status.textContent = "Could not update geometry"; }
function update() {
  const requested = ++revision, z = Number(element("offset").value);
  element("offset-value").value = String(z);
  if (!element("enabled").checked) { attachment?.dispose(); attachment = undefined; status.textContent = "Original geometry"; return; }
  status.textContent = "Updating…";
  queue = queue.catch(() => {}).then(async () => {
    if (requested !== revision) return;
    if (compute === undefined) {
      const next = await app.createCompute("src/main.mtek::Translate");
      if (requested !== revision) { next.dispose(); return; }
      compute = next; compute.upload("source", cubeVertices());
    }
    compute.setParam("offset", { x: 0, y: 0, z }); await compute.dispatch([72]);
    if (requested !== revision) return;
    // This sphere encloses every translation allowed by the slider, including
    // during a subsequent dispatch; no stale narrow bound can expose bad culling.
    attachment ??= compute.attachPositions("src/main.mtek::Demo.Caster", { center: [0, 0, 0], radius: 3 });
    status.textContent = "Live · compute geometry + shadows";
  }).catch(cause => { if (requested === revision) error(cause); });
}
try {
  app = await mountMtek(element("canvas"), program, { rendering: { shadows: { light: "Sun", quality: "medium", size: 20 } }, onDiagnostic: d => { if (d.severity === "error") error(`${d.code}: ${d.message}`); } });
  element("offset").addEventListener("input", update);
  element("enabled").addEventListener("change", update);
  element("mode").addEventListener("change", () => { app.setInput("caster_x", element("mode").value === "visible" ? 0 : 5); });
  element("release").addEventListener("click", () => {
    ++revision; attachment?.dispose(); attachment = undefined; compute?.dispose(); compute = undefined;
    element("enabled").checked = false; status.textContent = "Compute resources released";
  });
  window.addEventListener("pagehide", () => { ++revision; attachment?.dispose(); compute?.dispose(); app.dispose(); });
  update();
} catch (cause) { error(cause); }
