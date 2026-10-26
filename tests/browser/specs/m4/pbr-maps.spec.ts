// End-to-end GLB -> compiler -> GPU checks against the independent f64 BRDF oracle.
import { expect, test } from "../../support/fixtures.ts";
import { srgbToLinear } from "../../support/m1-reference.ts";
import { linearRgbToSrgb8, shadePbr, type Vec3 } from "../../support/reference-shading.ts";
import { runPlan, writeRecord } from "./configurator-support.ts";
import type { MtekApp, MtekMountOptions } from "../../../../packages/runtime-web/src/host/types.js";

test("imported mapped materials survive device recovery and release GPU resources", async ({ page, gpu }) => {
  expect(gpu.available).toBe(true);
  await page.goto("/m4/pbr_maps_regular/index.html");
  const before = await page.evaluate(async () => {
    const host = window as unknown as { __mtekMount(options: MtekMountOptions): Promise<MtekApp>; __mapped?: { app: MtekApp; diagnostics: string[] } };
    const diagnostics: string[] = [];
    const app = await host.__mtekMount({ test: { manualClock: true, renderTarget: { width: 65, height: 65 }, recovery: { delaysMs: [0, 0, 0] } },
      onDiagnostic: d => diagnostics.push(d.code) });
    host.__mapped = { app, diagnostics };
    app.debug!.step(1, 1 / 60);
    const pixels = Array.from((await app.debug!.readPixels()).data);
    app.debug!.loseDevice();
    return pixels;
  });
  await page.waitForFunction(() => {
    const h = (window as unknown as { __mapped: { app: MtekApp; diagnostics: string[] } }).__mapped;
    return h.app.state === "running" && h.diagnostics.includes("MTEK-W8061");
  });
  const after = await page.evaluate(async () => {
    const h = (window as unknown as { __mapped: { app: MtekApp; diagnostics: string[] } }).__mapped;
    h.app.debug!.step(1, 1 / 60);
    const pixels = Array.from((await h.app.debug!.readPixels()).data);
    h.app.dispose();
    return { pixels, counters: h.app.debug!.counters(), diagnostics: h.diagnostics };
  });
  expect(after.pixels).toEqual(before);
  expect(after.diagnostics.filter(code => code.startsWith("MTEK-E"))).toEqual([]);
  for (const name of ["liveBuffers", "liveTextures", "liveSamplers", "livePipelines", "liveShaderModules", "liveBindGroups", "liveListeners"])
    expect(after.counters[name], name).toBe(0);
  writeRecord(`pbr-maps-recovery-${test.info().project.name}.json`, { diagnostics: after.diagnostics, counters: after.counters });
});

const scenarios = [
  { label: "all channels", sun: 0.2, base_factor: [0.7, 0.6, 0.5], normal_scale: 1, ao_strength: 0.75, metal: 0.6, rough: 0.8, emission: [0.2, 0.1, 0.05] },
  { label: "geometric normal", sun: 0.2, base_factor: [0.7, 0.6, 0.5], normal_scale: 0, ao_strength: 0.75, metal: 0.6, rough: 0.8, emission: [0.2, 0.1, 0.05] },
  { label: "ambient without occlusion", sun: 0, base_factor: [0.7, 0.6, 0.5], normal_scale: 0, ao_strength: 0, metal: 0, rough: 0.8, emission: [0, 0, 0] },
  { label: "ambient with occlusion", sun: 0, base_factor: [0.7, 0.6, 0.5], normal_scale: 0, ao_strength: 1, metal: 0, rough: 0.8, emission: [0, 0, 0] },
  { label: "direct light with occlusion", sun: 0.2, base_factor: [0, 0, 0], normal_scale: 1, ao_strength: 1, metal: 0.6, rough: 0.8, emission: [0, 0, 0] },
  { label: "direct light without occlusion", sun: 0.2, base_factor: [0, 0, 0], normal_scale: 1, ao_strength: 0, metal: 0.6, rough: 0.8, emission: [0, 0, 0] },
  { label: "emissive only", sun: 0, base_factor: [0, 0, 0], normal_scale: 0, ao_strength: 1, metal: 1, rough: 0.2, emission: [0.6, 0.4, 0.2] },
] as const;

for (const uv of ["regular", "mirrored", "degenerate"] as const) {
  test(`GLB PBR maps: ${uv} UVs, factors, colour spaces and indirect-only occlusion`, async ({ page, gpu }) => {
    expect(gpu.available).toBe(true);
    const result = await runPlan(page, `/m4/pbr_maps_${uv}/index.html`, { renderTarget: { width: 65, height: 65 } },
      scenarios.map(({ label, ...inputs }) => ({ label, inputs: Object.entries(inputs) })));
    expect(result.state).toBe("running");
    expect(result.reported.filter(d => d.severity === "error")).toEqual([]);
    const texel: Vec3 = [128, 64, 192].map(x => srgbToLinear(x / 255)) as unknown as Vec3;
    const records: { label: string; actual: number[]; expected: readonly number[] }[] = [];
    for (let i = 0; i < scenarios.length; i++) {
      const scenario = scenarios[i]!, shot = result.shots[i]!;
      expect(shot.inputs.every(input => input.ok)).toBe(true);
      const scale = uv === "degenerate" ? 0 : scenario.normal_scale;
      const vector: Vec3 = [(uv === "mirrored" ? -1 : 1) * scale * (218 / 255 * 2 - 1), scale * (128 / 255 * 2 - 1), 218 / 255 * 2 - 1];
      const length = Math.hypot(...vector), normal = vector.map(x => x / length) as unknown as Vec3;
      const baseColor = texel.map((x, c) => x * scenario.base_factor[c]!) as unknown as Vec3;
      const radiance = shadePbr({
        N: normal, V: [0, 0, 1], baseColor,
        metallic: scenario.metal * 192 / 255, roughness: scenario.rough * 64 / 255,
        ambientColor: [1, 1, 1], ambientIntensity: 0.3 * (1 + scenario.ao_strength * (128 / 255 - 1)),
        lights: [{ kind: "directional", direction: [Math.sin(0.6), 0, -Math.cos(0.6)], color: [1, 1, 1], intensity: scenario.sun }],
      });
      const expected = linearRgbToSrgb8(radiance.map((x, c) => x + scenario.emission[c]! * texel[c]!) as unknown as Vec3);
      const offset = (32 * 65 + 32) * 4, actual = Array.from(shot.data.slice(offset, offset + 3));
      for (let c = 0; c < 3; c++) expect(Math.abs(actual[c]! - expected[c]!), `${scenario.label}, channel ${c}: ${actual.join(",")} vs ${expected.join(",")}`).toBeLessThanOrEqual(3);
      records.push({ label: scenario.label, actual, expected });
    }
    expect(records[4]!.actual).toEqual(records[5]!.actual);
    expect(records[2]!.actual[0]!).toBeGreaterThan(records[3]!.actual[0]! + 10);
    writeRecord(`pbr-maps-${uv}-${test.info().project.name}.json`, { uv, records, counters: result.shots[0]!.counters, assets: result.assets });
  });
}
