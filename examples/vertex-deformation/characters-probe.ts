import { deformSkin } from "../../packages/runtime-web/src/mesh/skinning.js";
import { runMixedSamplerProbe } from "./mixed-sampler-probe.js";
import type { MtekManifest, MtekAssetMesh } from "../../packages/runtime-web/src/abi/manifest-types.js";
import type { MtekProgram } from "../../packages/runtime-web/src/abi/program.js";
import type { ExtensionContext } from "../../packages/runtime-web/src/host/extensions.js";
import type { MtekApp, MtekMountOptions } from "../../packages/runtime-web/src/host/types.js";

type PixelShot = { pixels: Uint8Array; counters: Record<string, number> };
const expect = (ok: unknown, message: string): void => { if (!ok) throw new Error(message); };
function difference(a: Uint8Array, b: Uint8Array): { maxError: number; differingPixels: number; changedPixels: number } {
  expect(a.length === b.length, "Reference target sizes differ");
  let maxError = 0, differingPixels = 0, changedPixels = 0;
  for (let i = 0; i < a.length; i += 4) {
    let e = 0; for (let c = 0; c < 4; c++) e = Math.max(e, Math.abs(a[i + c]! - b[i + c]!));
    maxError = Math.max(maxError, e); if (e > 2) differingPixels++; if (e > 10) changedPixels++;
  }
  return { maxError, differingPixels, changedPixels };
}
const digest = async (bytes: ArrayBuffer): Promise<string> => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(v => v.toString(16).padStart(2, "0")).join("");
const base64 = (bytes: Uint8Array): string => { let s = ""; for (const byte of bytes) s += String.fromCharCode(byte); return btoa(s); };

/** A few paused poses; no requestAnimationFrame loop and no timing claims. */
export async function runCharacterProbe(base: string) {
  const baseUrl = new URL(base), module = await import(new URL("app.js", baseUrl).href) as { default: MtekProgram; mountMtek: (canvas: HTMLCanvasElement, program: MtekProgram, options: MtekMountOptions) => Promise<MtekApp> };
  const program = module.default, manifest = await fetch(program.manifestUrl).then(r => r.json()) as MtekManifest;
  const adapter = await navigator.gpu.requestAdapter(); expect(adapter !== null, "No WebGPU adapter");
  const info = adapter!.info;
  const adapterInfo = { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description, isFallbackAdapter: info.isFallbackAdapter };
  const meshAssets = await Promise.all(manifest.assets.filter(a => a.kind === "mesh-data").map(async a => ({ asset: a, bytes: await fetch(new URL(a.url, baseUrl)).then(r => r.arrayBuffer()) })));
  const meshes = manifest.meshes.filter((m): m is MtekAssetMesh => m.kind === "asset");
  const canvas = document.querySelector("canvas")!;
  const diagnostics: string[] = [], cases: object[] = [], boundsCases: object[] = [], recovery: object[] = [], replacements: object[] = [], disposal: object[] = [], animationChanges: object[] = [], assetMaterialCases: object[] = [];
  (globalThis as unknown as { __characterProgress: object }).__characterProgress = { adapter: adapterInfo, cases, boundsCases, recovery, replacements, disposal, animationChanges, assetMaterialCases, diagnostics };
  const read = async (app: MtekApp): Promise<PixelShot> => ({ pixels: (await app.debug!.readPixels()).data, counters: app.debug!.counters() });
  const set = (app: MtekApp, inputs: Record<string, unknown>): void => { for (const [key, value] of Object.entries(inputs)) expect(app.setInput(key, value).ok, `Rejected input ${key}`); };
  const resources = (app: MtekApp): Record<string, number> => Object.fromEntries(["liveBuffers", "liveTextures", "liveSamplers", "livePipelines", "liveBindGroups", "liveShaderModules"].map(key => [key, app.debug!.counters()[key]!]));
  const liveZero = (app: MtekApp): void => { for (const [key, count] of Object.entries(resources(app))) expect(count === 0, `${key} retained after disposal: ${count}`); };

  const unshadowed = new Map<string, Uint8Array>();
  for (const shadows of [false, true]) {
    let access: ExtensionContext | undefined;
    const options: MtekMountOptions = {
      test: { manualClock: true, renderTarget: { width: 97, height: 97 }, recovery: { delaysMs: [0, 0, 0] } },
      ...(shadows ? { rendering: { shadows: { light: "Sun", quality: "low", size: 12, far: 40 } } } : {}),
      onDiagnostic: d => diagnostics.push(`${d.code}: ${d.message}`),
      extensions: [{ id: "character-correctness", apiVersion: 1, setup: context => { access = context; } }],
    };
    const app = await module.mountMtek(canvas, program, options);
    try {
      const entity = (name: string) => { const e = access!.readTransforms().find(e => e.name === name); expect(e !== undefined, `Missing ${name}`); return e!; };
      const player = (name: string) => { const p = access!.animation(entity(name).id); expect(p !== undefined, `Missing skin ${name}`); return p!; };
      const pose = (name: string, clip: string, time: number): void => {
        for (const n of [name, `${name}Reference`, ...(name === "Man" ? ["ManOriginal"] : [])]) { const p = player(n); expect(p.transition(clip, 0, false, 1), `Missing clip ${clip}`); p.clock.seek(0, time); p.clock.pause(0); p.evaluate(); }
      };
      // A static-mesh program containing CPU-skinned positions/normals. Its fragment shader and
      // ordinary object transform are the reference; it executes no GPU skinning or authored vertex stage.
      const cpuReference = async (character: number, shape: number[], x: number, y: number, original = false): Promise<PixelShot> => {
        const clone = structuredClone(manifest), files: { url: string; bytes: string }[] = [];
        for (const mesh of meshes) {
          const source = meshAssets.find(a => a.asset.url === mesh.asset)!;
          const primitive = source.asset.primitives[mesh.primitive]!;
          const name = mesh.skin!.joints.length === 24 ? "Fox" : "Man", p = player(name);
          const n = primitive.vertexCount, bytes = source.bytes.slice(0), output = new Float32Array(n * 3), normals = new Float32Array(n * 3);
          const positions = new Float32Array(source.bytes, primitive.offsets.position, n * 3);
          const originalNormals = primitive.offsets.normal === undefined ? undefined : new Float32Array(source.bytes, primitive.offsets.normal, n * 3);
          deformSkin(mesh.skin!, p.palette, positions, originalNormals, output, normals);
          new Float32Array(bytes, primitive.offsets.position, n * 3).set(output);
          if (primitive.offsets.normal !== undefined) new Float32Array(bytes, primitive.offsets.normal, n * 3).set(normals);
          const hash = await digest(bytes), url = `assets/${hash.slice(0, 16)}.bin`;
          const target = clone.meshes.find(m => m.id === mesh.id) as unknown as { asset: string; skin?: unknown };
          target.asset = url; delete target.skin;
          const asset = clone.assets.find(a => a.url === mesh.asset)! as unknown as { url: string; sha256: string; primitives: { boundingSphere: { center: number[]; radius: number } }[] };
          asset.url = url; asset.sha256 = hash;
          const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
          for (let i = 0; i < output.length; i++) { min[i % 3] = Math.min(min[i % 3]!, output[i]!); max[i % 3] = Math.max(max[i % 3]!, output[i]!); }
          const center = min.map((v, i) => (v + max[i]!) / 2);
          let radius = 0; for (let i = 0; i < output.length; i += 3) radius = Math.max(radius, Math.hypot(output[i]! - center[0]!, output[i + 1]! - center[1]!, output[i + 2]! - center[2]!));
          asset.primitives[mesh.primitive]!.boundingSphere = { center, radius: radius + 0.001 };
          files.push({ url, bytes: base64(new Uint8Array(bytes)) });
        }
        const response = await fetch(new URL("cpu-reference", baseUrl), { method: "POST", body: JSON.stringify({ manifest: clone, files }) });
        expect(response.ok, "Could not install CPU reference");
        const referenceBase = new URL(await response.text(), baseUrl);
        const cpuCanvas = document.createElement("canvas");
        const cpu = await module.mountMtek(cpuCanvas, { ...program, baseUrl: referenceBase, manifestUrl: new URL("program.manifest.json", referenceBase) }, { ...options, extensions: [] });
        try { set(cpu, { character, shape, shift_x: x, shift_y: y, authored: false, reference: !original, original }); cpu.debug!.step(1, 1 / 60); return await read(cpu); }
        finally { cpu.dispose(); liveZero(cpu); }
      };
      for (const [character, name] of [[0, "Fox"], [1, "Man"]] as const) {
        let firstPose: Uint8Array | undefined, changedPixels = 0;
        for (const clip of player(name).skin.clips) for (const fraction of [0, 0.37]) for (const shape of [[1, 1, 1], [0.75, 1.25, 0.5]]) {
          const time = clip.duration * fraction; pose(name, clip.name, time);
          set(app, { character, shape, shift_x: -10, shift_y: 0.5, authored: true, reference: false, bound_radius: 1 });
          app.debug!.step(1, 1 / 60); const authored = await read(app);
          const bound = entity(name).bounds!;
          const mesh = meshes.find(m => m.skin!.joints.length === player(name).skin.joints.length)!, source = meshAssets.find(a => a.asset.url === mesh.asset)!;
          const primitive = source.asset.primitives[mesh.primitive]!, output = new Float32Array(primitive.vertexCount * 3);
          deformSkin(mesh.skin!, player(name).palette, new Float32Array(source.bytes, primitive.offsets.position, output.length), undefined, output, new Float32Array(output.length));
          const offset = name === "Fox" ? [-640, 32, 0] : [-5, 0, 0.25];
          let maximumRadius = 0; for (let i = 0; i < output.length; i += 3) maximumRadius = Math.max(maximumRadius, Math.hypot(output[i]! * shape[0]! + offset[0]! - bound.center.x, output[i + 1]! * shape[1]! + offset[1]! - bound.center.y, output[i + 2]! * shape[2]! + offset[2]! - bound.center.z));
          expect(maximumRadius <= bound.radius, `${name} sampled pose lies outside the authored sphere`);
          set(app, { authored: false, reference: true }); app.debug!.step(1, 1 / 60); const ordinary = await read(app);
          const cpu = await cpuReference(character, shape, -10, 0.5);
          const gpuDifference = difference(authored.pixels, ordinary.pixels), cpuDifference = difference(authored.pixels, cpu.pixels);
          const key = JSON.stringify([name, clip.name, fraction, shape]);
          const shadowChangedPixels = shadows ? difference(unshadowed.get(key)!, authored.pixels).changedPixels : 0;
          if (!shadows) unshadowed.set(key, authored.pixels);
          else expect(shadowChangedPixels > 10, `${name} shadow did not affect the image`);
          const paletteSha256 = await digest(player(name).palette.slice().buffer);
          const row = { shadows, character: name, clip: clip.name, fraction, shape, gpuDifference, cpuDifference, shadowChangedPixels, paletteSha256, maximumRadius, declaredRadius: bound.radius, counters: authored.counters };
          cases.push(row);
          expect(gpuDifference.differingPixels === 0 && cpuDifference.differingPixels === 0, JSON.stringify(row));
          expect(authored.counters["culledObjects"] === 0, `${name} visible deformed sphere was culled`);
          if (shape[0] === 1) { if (firstPose === undefined) firstPose = authored.pixels; else changedPixels = Math.max(changedPixels, difference(firstPose, authored.pixels).changedPixels); }
        }
        animationChanges.push({ shadows, character: name, changedPixels }); expect(changedPixels > 10, `${name} clip poses did not change rendered pixels`);
        if (name === "Man") {
          set(app, { authored: false, reference: false, original: true, shape: [1, 1, 1], shift_x: -10, shift_y: 0.5 }); app.debug!.step(1, 1 / 60);
          const actual = await read(app), expected = await cpuReference(character, [1, 1, 1], -10, 0.5, true);
          const d = difference(actual.pixels, expected.pixels);
          set(app, { original: false }); app.debug!.step(1, 1 / 60); const floor = await read(app);
          const geometryChangedPixels = difference(actual.pixels, floor.pixels).changedPixels;
          assetMaterialCases.push({shadows, character:name, ...d, geometryChangedPixels});
          expect(d.differingPixels === 0 && geometryChangedPixels > 10, "Native CesiumMan material did not match CPU reference");
        }
        for (const [x, radius, culled] of [[20, 1, 1], [-10, 1, 0], [20, 0, 0], [-10, 1, 0]]) {
          set(app, { character, authored: true, reference: false, shape: [1, 1, 1], shift_x: x, bound_radius: radius }); app.debug!.step(1, 1 / 60);
          const counters = app.debug!.counters(); boundsCases.push({ shadows, character: name, x, radius, expectedCulled: culled, counters }); expect(counters["culledObjects"] === culled, `Unexpected ${name} culling result`);
        }
        set(app, { shift_x: -9.5, shift_y: 0.75, shape: [0.75, 1.25, 0.5] }); app.debug!.step(1, 1 / 60); const before = await read(app);
        const priorRecoveries = app.debug!.counters()["deviceRecoveries"]!;
        app.debug!.loseDevice(); const deadline = performance.now() + 10000;
        while (app.state !== "running" || app.debug!.counters()["deviceRecoveries"] !== priorRecoveries + 1) { expect(app.state !== "failed" && performance.now() < deadline, "Character recovery failed"); await new Promise(resolve => setTimeout(resolve, 10)); }
        app.debug!.step(1, 1 / 60); const after = await read(app), recoveryDifference = difference(before.pixels, after.pixels);
        recovery.push({ shadows, character: name, ...recoveryDifference, counters: after.counters }); expect(recoveryDifference.maxError === 0, `Recovery changed ${name}`);
        const selectedClip = player(name).skin.clips.at(-1)!;
        const live: Record<string, number>[] = [];
        for (let round = 0; round < 3; round++) {
          expect((await app.replaceProgram!(program)).ok, "Character program replacement rejected"); app.debug!.step(1, 1 / 60);
          pose(name, selectedClip.name, selectedClip.duration * 0.37);
          set(app, { character, authored: true, reference: false, shape: [0.75, 1.25, 0.5], shift_x: -10, shift_y: 0.5 }); app.debug!.step(1, 1 / 60);
          const actual = await read(app); set(app, { authored: false, reference: true }); app.debug!.step(1, 1 / 60); const expected = await read(app);
          const d = difference(actual.pixels, expected.pixels), counts = resources(app); live.push(counts);
          replacements.push({ shadows, character: name, round, ...d, live: counts }); expect(d.differingPixels === 0, `Replacement changed ${name}`);
        }
        expect(JSON.stringify(live[1]) === JSON.stringify(live[2]), "Character replacement resources did not plateau");
      }
    } finally { app.dispose(); liveZero(app); disposal.push(app.debug!.counters()); }
  }
  expect(diagnostics.every(d => /^MTEK-(W8060|W8061|W8070):/.test(d)), `Unexpected diagnostics: ${diagnostics.join("; ")}`);
  const samplers = await runMixedSamplerProbe();
  return { adapter: adapterInfo, cases, animationChanges, boundsCases, recovery, replacements, disposal, diagnostics, samplers, assetMaterialCases };
}
