import { expect, test } from "../../support/fixtures.ts";
import { srgbToLinear } from "../../support/m1-reference.ts";
import { linearRgbToSrgb8, shadePbr, type Vec3 } from "../../support/reference-shading.ts";
import { writeRecord } from "./configurator-support.ts";
import type { MtekApp, MtekMountOptions } from "../../../../packages/runtime-web/src/host/types.js";

type Host = { __mtekMount(options: MtekMountOptions): Promise<MtekApp>; __tangent?: { app: MtekApp; diagnostics: string[] } };
const unit = (v: number[]): Vec3 => v.map(c => c / Math.hypot(...v)) as unknown as Vec3;
const texel = [200, 180, 230].map(v => v / 255 * 2 - 1);
function basis(tangent: readonly number[], sign = 1): Vec3 {
  const [x, y] = unit([...tangent]);
  return unit([x * texel[0]! - y * sign * texel[1]!, y * texel[0]! + x * sign * texel[1]!, texel[2]!]);
}
function transformedTangent(sx: number, sy: number, angle: number): Vec3 {
  return unit([Math.cos(angle) * sx - Math.sin(angle) * sy, Math.sin(angle) * sx + Math.cos(angle) * sy, 0]);
}
function expectedPixel(normal: Vec3, view: Vec3, authored: boolean): readonly number[] {
  const colour = [128, 64, 192].map(v => srgbToLinear(v / 255));
  const radiance = shadePbr({ N: normal, V: view, baseColor: authored ? [0.3, 0.4, 0.5] : colour as unknown as Vec3,
    metallic: 0, roughness: 0.6, ambientColor: [1, 1, 1], ambientIntensity: 0.3,
    lights: [{ kind: "directional", direction: [Math.sin(0.6) * Math.cos(0.4), -Math.sin(0.4), -Math.cos(0.6) * Math.cos(0.4)], color: [1, 1, 1], intensity: 3 }] });
  return linearRgbToSrgb8(radiance);
}

for (const kind of ["regular", "mirrored", "degenerate", "transform", "skin", "varying", "authored", "fallback", "instanced"] as const) {
  test(`authored tangent PBR: ${kind}, independent frame reference, recovery and disposal`, async ({ page, gpu }) => {
    expect(gpu.available).toBe(true);
    await page.goto(`/m4/pbr_tangent_${kind}/index.html`);
    const width = kind === "instanced" ? 129 : 65;
    const initial = await page.evaluate(async width => {
      const host = window as unknown as Host, diagnostics: string[] = [];
      let inspection: (() => unknown) | undefined;
      let dispatches = 0, skinningShader = "";
      const devicePrototype = GPUDevice.prototype, passPrototype = GPUComputePassEncoder.prototype;
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Native hooks preserve the actual receiver with .call below.
      const originalModule = devicePrototype.createShaderModule, originalDispatch = passPrototype.dispatchWorkgroups;
      devicePrototype.createShaderModule = function(descriptor) { if (descriptor.label === "mtek GPU skinning") skinningShader = descriptor.code; return originalModule.call(this, descriptor); };
      passPrototype.dispatchWorkgroups = function(x, y, z) { dispatches++; return originalDispatch.call(this, x, y, z); };
      try {
      const app = await host.__mtekMount({ test: { manualClock: true, renderTarget: { width, height: 65 }, recovery: { delaysMs: [0, 0, 0] } }, onDiagnostic: d => diagnostics.push(d.code),
        extensions: [{ id: "tangent-inspection", apiVersion: 1, setup(context) { inspection = () => context.inspectScene?.(); } }] });
      host.__tangent = { app, diagnostics }; app.debug!.step(1, 1 / 60);
      return { pixels: Array.from((await app.debug!.readPixels()).data), counters: app.debug!.counters(), inspection: inspection?.(), dispatches, skinningShader };
      } finally { devicePrototype.createShaderModule = originalModule; passPrototype.dispatchWorkgroups = originalDispatch; }
    }, width);
    const cases = kind === "instanced" ? [{ x: 32, tangent: transformedTangent(1.4, 0.7, 0.8) }, { x: 96, tangent: transformedTangent(0.7, 1.4, -1) }] : [{ x: 32, tangent: kind === "varying" ? transformedTangent(1, 1, -0.4) : kind === "transform" || kind === "skin" ? transformedTangent(1.4, 0.7, -0.4) : kind === "authored" ? [0, -1, 0] : kind === "fallback" ? [-1, 0, 0] : [0, 1, 0] }];
    const samples = cases.map(({ x, tangent }) => {
      const worldX = (x - (width - 1) / 2) * 2 / 65;
      const normal = basis(tangent, kind === "mirrored" ? -1 : 1), expected = expectedPixel(normal, unit([-worldX, 0, 2]), kind === "authored" || kind === "fallback");
      const actual = initial.pixels.slice((32 * width + x) * 4, (32 * width + x) * 4 + 3);
      const wrongNormal = kind === "varying" ? basis(transformedTangent(1.4, 0.7, -0.4)) : kind === "degenerate" ? [0, 0, 1] as const : kind === "regular" ? basis([1, 0, 0]) : kind === "mirrored" ? basis([-1, 0, 0]) : kind === "transform" || kind === "skin" ? basis(transformedTangent(1 / 1.4, 1 / 0.7, -0.4)) : kind === "instanced" ? basis(cases.find(c => c.x !== x)!.tangent) : basis([0, 1, 0]);
      const counterfactual = expectedPixel(wrongNormal, unit([-worldX, 0, 2]), kind === "authored" || kind === "fallback");
      return { x, normal, actual, expected, counterfactual, separation: Math.max(...expected.map((v, c) => Math.abs(v - counterfactual[c]!))) };
    });
    // Retain the failing reference too, rather than losing evidence to an early assertion.
    writeRecord(`tangent-pbr-initial-${kind}-${test.info().project.name}.json`, { kind, width, ...initial, samples });
    for (const sample of samples) {
      expect(sample.separation, "The declared light/view must distinguish an incorrect frame beyond the pixel tolerance").toBeGreaterThanOrEqual(8);
      for (let c = 0; c < 3; c++) expect(Math.abs(sample.actual[c]! - sample.expected[c]!), `${kind} x=${String(sample.x)}: ${sample.actual.join(",")} vs ${sample.expected.join(",")}`).toBeLessThanOrEqual(3);
    }
    if (kind === "instanced") expect(initial.counters["instancedDraws"]).toBeGreaterThan(0);
    if (kind === "skin") { expect(initial.dispatches).toBeGreaterThan(0); expect(initial.skinningShader).toContain("outputTangents"); }
    await page.evaluate(() => (window as unknown as Host).__tangent!.app.debug!.loseDevice());
    await page.waitForFunction(() => { const h = (window as unknown as Host).__tangent!; return h.app.state === "running" && h.diagnostics.includes("MTEK-W8061"); });
    const after = await page.evaluate(async () => {
      const h = (window as unknown as Host).__tangent!; h.app.debug!.step(1, 1 / 60);
      const pixels = Array.from((await h.app.debug!.readPixels()).data); h.app.dispose();
      return { pixels, counters: h.app.debug!.counters(), diagnostics: h.diagnostics };
    });
    expect(after.pixels).toEqual(initial.pixels); expect(after.diagnostics.filter(code => code.startsWith("MTEK-E"))).toEqual([]);
    for (const key of ["liveBuffers", "liveTextures", "liveSamplers", "liveShaderModules", "livePipelines", "liveBindGroups", "liveListeners"]) expect(after.counters[key], key).toBe(0);
    writeRecord(`tangent-pbr-recovery-${kind}-${test.info().project.name}.json`, after);
  });
}
