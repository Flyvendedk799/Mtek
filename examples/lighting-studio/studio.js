import program, { mountMtek } from "./.out/app.js";
import { decodeRadiance } from "./.out/lighting-api.js";
import { InspectorController, mountInspectorPanel } from "./.out/inspector.js";

const canvas = document.querySelector("#canvas"), status = document.querySelector("#status"), diagnostics = document.querySelector("#diagnostics");
const control = id => document.getElementById(id);
const value = id => Number(control(id).value);
let app, paused = false, revision = 0, queue = Promise.resolve(), source;
let inspector, removeInspectorPanel;
function disposeInspector() {
  removeInspectorPanel?.(); removeInspectorPanel = undefined;
  inspector?.dispose(); inspector = undefined; control("scene-inspector").hidden = true;
}
function studioPanorama() {
  const width = 128, height = 64, data = new Float32Array(width * height * 4);
  const length = Math.hypot(0.45, 0.65, 0.6), windowDirection = [0.45 / length, 0.65 / length, 0.6 / length];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const theta = (y + 0.5) / height * Math.PI, phi = ((x + 0.5) / width - 0.5) * Math.PI * 2;
    const direction = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
    const dot = direction.reduce((sum, component, i) => sum + component * windowDirection[i], 0), light = Math.exp((dot - 1) / 0.025) * 4;
    const sky = direction[1] > 0 ? [0.16 + direction[1] * 0.2, 0.25 + direction[1] * 0.25, 0.45 + direction[1] * 0.3] : [0.09, 0.08, 0.07];
    data.set(sky.map((v, c) => v + light * [1, 0.8, 0.55][c]).concat(1), (y * width + x) * 4);
  }
  return { width, height, data };
}
source = studioPanorama();
function rebuild() {
  const current = ++revision;
  status.textContent = "Preparing lighting…";
  queue = queue.catch(() => {}).then(async () => {
    if (current !== revision) return;
    app?.dispose(); app = undefined; disposeInspector(); diagnostics.hidden = true; diagnostics.textContent = "";
    try {
      if (control("inspector").checked) {
        inspector = new InspectorController({onError: error => {if(current !== revision)return;diagnostics.hidden=false;diagnostics.textContent += `${String(error)}\n`;}});
        control("scene-inspector").hidden = false;
        removeInspectorPanel = mountInspectorPanel(inspector, control("scene-inspector"));
      }
      const next = await mountMtek(canvas, program, {
        extensions: inspector === undefined ? [] : [inspector.extension],
        hostServices: {"mtek.inspector.metrics": {read: () => {
          const counters = app?.debug?.counters();
          if (counters === undefined) return {};
          const {liveBuffers,liveTextures,liveEntities,drawCalls,culledObjects,frameTimeMs,cpuUpdateMs,renderPrepMs} = counters;
          return {liveBuffers,liveTextures,liveEntities,drawCalls,culledObjects,frameTimeMs,cpuUpdateMs,renderPrepMs};
        }}},
        inputs: { camera_yaw: value("camera"), sun_yaw: value("sun"), roughness: value("roughness") },
        rendering: {
          ...(control("shadows").checked ? { shadows: { light: "Sun", quality: control("shadow-quality").value, center: [0, 0, 0], size: 18, distance: 16, far: 34 } } : {}),
          ...(control("environment").checked ? { environment: { ...source, intensity: value("intensity"), rotation: value("rotation"), quality: control("env-quality").value } } : {}),
        },
        onDiagnostic: d => { if (current !== revision) return; diagnostics.hidden = false; diagnostics.textContent += `${d.code}: ${d.message}\n`; },
      });
      if (current !== revision) { next.dispose(); disposeInspector(); return; }
      app = next;
      for (const [id, input] of [["camera", "camera_yaw"], ["sun", "sun_yaw"], ["roughness", "roughness"]]) app.setInput(input, value(id));
      if (paused) app.pause(); status.textContent = "Live · directional shadows + HDR IBL";
      if (!control("shadows").checked && !control("environment").checked) status.textContent = "Live · direct light only";
      else if (!control("shadows").checked) status.textContent = "Live · direct light + HDR IBL";
      else if (!control("environment").checked) status.textContent = "Live · directional shadows";
      status.dataset.revision = String(current);
    } catch (error) {
      disposeInspector();
      if (current !== revision) return;
      status.textContent = "Lighting could not start"; diagnostics.hidden = false; diagnostics.textContent += String(error);
    }
  });
}
for (const [id, input] of [["camera", "camera_yaw"], ["sun", "sun_yaw"], ["roughness", "roughness"]]) {
  control(id).addEventListener("input", () => app?.setInput(input, value(id)));
}
let timer;
for (const id of ["shadows", "environment", "shadow-quality", "env-quality", "rotation", "intensity"]) {
  control(id).addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(rebuild, 180); });
}
control("pause").addEventListener("click", () => {
  paused = !paused; if (paused) app?.pause(); else app?.resume(); control("pause").textContent = paused ? "Resume motion" : "Pause motion";
});
control("inspector").addEventListener("change", rebuild);
let fileRevision = 0;
control("hdr").addEventListener("change", async event => {
  const file = event.target.files[0], current = ++fileRevision; if (file === undefined) return;
  try { const next = decodeRadiance(new Uint8Array(await file.arrayBuffer())); if (current !== fileRevision) return; source = next; rebuild(); }
  catch (error) { diagnostics.hidden = false; diagnostics.textContent = String(error); }
});
control("reset").addEventListener("click", () => { fileRevision++; control("hdr").value = ""; source = studioPanorama(); rebuild(); });
window.addEventListener("pagehide", () => { revision++; clearTimeout(timer); app?.dispose(); disposeInspector(); });
rebuild();
