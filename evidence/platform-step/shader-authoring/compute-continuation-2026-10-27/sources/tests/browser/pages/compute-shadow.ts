import type { MtekApp, MtekMountOptions, MtekMountProgram } from "../../../packages/runtime-web/src/host/types.js";
import type { LightingQuality } from "../../../packages/runtime-web/src/render/options.js";
import { cubeVertices } from "../../../examples/compute-geometry/geometry.js";
import { mismatchWords, pixelDifference } from "../support/compute-reference.ts";

interface ProgramModule { default: MtekMountProgram; mountMtek(canvas: HTMLCanvasElement, program: MtekMountProgram, options: MtekMountOptions): Promise<MtekApp> }
export type ShadowCase = "off-camera" | "final-bounds";
export interface ShadowReport {
  quality: LightingQuality; mode: ShadowCase; cpuDifferentPixels: number; unculledDifferentPixels: number;
  changedFromOriginal: number; shadowDifferentPixels: number; pendingDifferentPixels: number;
  recoveredDifferentPixels: number; detachedDifferentPixels: number; outputMismatches: number; dispatchPending: boolean;
  resumedDifferentPixels: number; updatedCpuDifferentPixels: number; updatedShadowDifferentPixels: number;
  updatedChangedPixels: number; updatedOutputMismatches: number; dispatchFinished: boolean;
  counters: Readonly<Record<string, number>>; diagnostics: string[]; disposed: Readonly<Record<string, number>>[];
  pixels: Record<string, string>;
}
export interface ShadowApi { run(quality: LightingQuality, mode: ShadowCase): Promise<ShadowReport> }
const base = new URL("./", import.meta.url);
const encode = (pixels: Uint8Array): string => { let text = ""; for (const value of pixels) text += String.fromCharCode(value); return btoa(text); };
const shot = async (app: MtekApp): Promise<Uint8Array> => { app.debug!.step(1, 1 / 60); return (await app.debug!.readPixels()).data; };

/** CPU reference moves the original primitive's entity, never uploads transformed
 * vertices or reads a compute layout. Both render paths retain the shared twin. */
async function run(quality: LightingQuality, mode: ShadowCase): Promise<ShadowReport> {
  const module = await import(new URL("shadow/app.js", base).href) as ProgramModule;
  const diagnostics: string[] = [], disposed: Readonly<Record<string, number>>[] = [];
  const offset = { x: mode === "off-camera" ? 0 : -50, y: 0, z: 0.75 };
  const source = { caster_x: mode === "off-camera" ? 5 : 50, caster_y: 3, caster_z: 0 };
  const mount = (inputs: Record<string, number | boolean>, shadows = true, disableCulling = false): Promise<MtekApp> => module.mountMtek(document.querySelector<HTMLCanvasElement>("#mtek")!, module.default, {
    inputs, rendering: shadows ? { shadows: { light: "Sun", quality, size: 20 } } : {},
    test: { manualClock: true, renderTarget: { width: 128, height: 128 }, disableCulling, recovery: { delaysMs: [0, 0, 0] } },
    onDiagnostic: diagnostic => diagnostics.push(`${diagnostic.code}: ${diagnostic.message}`),
  });
  const close = (app: MtekApp): void => { app.dispose(); disposed.push(app.debug!.counters()); };
  const reference = async (inputs: Record<string, number | boolean>, shadows = true, disableCulling = false): Promise<Uint8Array> => {
    const app = await mount(inputs, shadows, disableCulling); try { return await shot(app); } finally { close(app); }
  };
  const target = { caster_x: source.caster_x + offset.x, caster_y: source.caster_y + offset.y, caster_z: source.caster_z + offset.z };
  const cpu = await reference(target), unculled = await reference(target, true, true), unshadowed = await reference(target, false);
  const hidden = await reference({ ...source, caster_visible: false });
  const nextOffset = { ...offset, z: -0.75 };
  const nextTarget = { caster_x: source.caster_x + nextOffset.x, caster_y: source.caster_y + nextOffset.y, caster_z: source.caster_z + nextOffset.z };
  const updatedCpu = await reference(nextTarget), updatedUnshadowed = await reference(nextTarget, false);
  const app = await mount(source);
  try {
    const original = await shot(app), vertices = cubeVertices();
    const handle = await app.createCompute("src/main.mtek::Translate", { offset });
    handle.upload("source", vertices); await handle.dispatch([72]);
    const attachment = handle.attachPositions("src/main.mtek::Demo.Caster", { center: [offset.x, offset.y, offset.z], radius: 0.867 });
    const actual = await shot(app), counters = app.debug!.counters(), output = await handle.readback();
    const expected = Float32Array.from(vertices, (value, i) => Math.fround(value + [offset.x, offset.y, offset.z][i % 3]!));
    // A later staged value must not alter the completed output replayed on recovery.
    handle.setParam("offset", { x: 99, y: 0, z: 0 }); app.debug!.loseDevice();
    const deadline = performance.now() + 15_000;
    while (app.state !== "running" || !diagnostics.some(message => message.startsWith("MTEK-W8061"))) {
      if (app.state === "failed" || app.state === "disposed" || performance.now() > deadline) throw new Error(`shadow recovery ended ${app.state}`);
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const recovered = await shot(app);
    handle.setParam("offset", offset); const pending = handle.dispatch([72]);
    const dispatchPending = handle.inspect().dispatchPending;
    // Submit this frame synchronously while dispatchPending is still true.
    const pendingImage = await shot(app); await pending;
    // Completion must restore both the caster and its shadow without reattaching.
    const resumed = await shot(app);
    // Reuse the recovered handle with new values and the same borrowed output.
    // Bounds are explicit and immutable: replace the lease before rendering the
    // second completed translation, rather than relying on the old sphere.
    handle.setParam("offset", nextOffset); await handle.dispatch([72]);
    attachment.dispose();
    const updatedAttachment = handle.attachPositions("src/main.mtek::Demo.Caster", { center: [nextOffset.x, nextOffset.y, nextOffset.z], radius: 0.867 });
    const updated = await shot(app), updatedOutput = await handle.readback();
    const updatedExpected = Float32Array.from(vertices, (value, i) => Math.fround(value + [nextOffset.x, nextOffset.y, nextOffset.z][i % 3]!));
    const dispatchFinished = !handle.inspect().dispatchPending;
    updatedAttachment.dispose(); const detached = await shot(app);
    close(app);
    document.querySelector<HTMLCanvasElement>("#preview")!.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(actual), 128, 128), 0, 0);
    return { quality, mode, cpuDifferentPixels: pixelDifference(actual, cpu), unculledDifferentPixels: pixelDifference(actual, unculled),
      changedFromOriginal: pixelDifference(actual, original), shadowDifferentPixels: pixelDifference(actual, unshadowed),
      recoveredDifferentPixels: pixelDifference(actual, recovered), pendingDifferentPixels: pixelDifference(pendingImage, hidden),
      detachedDifferentPixels: pixelDifference(original, detached), outputMismatches: mismatchWords(output, expected.buffer), dispatchPending,
      resumedDifferentPixels: pixelDifference(actual, resumed), updatedCpuDifferentPixels: pixelDifference(updated, updatedCpu),
      updatedShadowDifferentPixels: pixelDifference(updated, updatedUnshadowed), updatedChangedPixels: pixelDifference(actual, updated),
      updatedOutputMismatches: mismatchWords(updatedOutput, updatedExpected.buffer), dispatchFinished,
      counters, diagnostics, disposed, pixels: Object.fromEntries(Object.entries({ actual, cpu, unculled, unshadowed, original, hidden, pendingImage, recovered, resumed, updated, updatedCpu, updatedUnshadowed, detached }).map(([name, bytes]) => [name, encode(bytes)])) };
  } finally { app.dispose(); }
}

const api: ShadowApi = { run };
(window as unknown as { __computeShadows: ShadowApi }).__computeShadows = api;
document.getElementById("shadows")!.addEventListener("click", () => { void run("low", "off-camera").then(report => { document.getElementById("status")!.textContent = JSON.stringify({ ...report, pixels: "Raw pixels retained by automated tests" }, null, 2); }).catch((error: unknown) => { document.getElementById("status")!.textContent = String(error); }); });
