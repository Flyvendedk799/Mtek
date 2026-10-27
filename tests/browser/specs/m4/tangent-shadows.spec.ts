import { expect, test } from "../../support/fixtures.ts";
import { writeRecord } from "./configurator-support.ts";
import type { MtekApp, MtekMountOptions } from "../../../../packages/runtime-web/src/host/types.js";

type Host = { __mtekMount(options: MtekMountOptions): Promise<MtekApp>; __shadowTangent?: { app: MtekApp; diagnostics: string[] } };
const live = ["liveBuffers", "liveTextures", "liveSamplers", "liveShaderModules", "livePipelines", "liveBindGroups", "liveListeners"];
const difference = (a: number[], b: number[], threshold: number): number => {
  let count = 0;
  for (let i = 0; i < a.length; i += 4) if (Math.max(...[0, 1, 2].map(c => Math.abs(a[i + c]! - b[i + c]!))) > threshold) count++;
  return count;
};

for (const quality of ["low", "medium", "high"] as const) {
  test(`imported tangent skin shadows: ${quality}, independent translation, culling and recovery`, async ({ page, gpu }) => {
    expect(gpu.available).toBe(true);
    const capture = async (skin: boolean, frames: number, disableCulling = false, hidden = false) => {
      await page.goto(`/m4/pbr_tangent_shadow_${skin ? "skin" : "reference"}/index.html`);
      const initial = await page.evaluate(async ({ skin, frames, quality, disableCulling, hidden }) => {
        const host = window as unknown as Host, diagnostics: string[] = [];
        let shader = "";
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Preserve the native receiver with .call.
        const original = GPUDevice.prototype.createShaderModule;
        GPUDevice.prototype.createShaderModule = function(descriptor) { if (descriptor.label === "mtek GPU skinning") shader = descriptor.code; return original.call(this, descriptor); };
        try {
          const app = await host.__mtekMount({ inputs: { caster_x: skin ? 5 : 5 + 1.4 * frames / 60, caster_visible: !hidden },
            rendering: { shadows: { light: "Sun", quality } }, onDiagnostic: d => diagnostics.push(d.code),
            test: { manualClock: true, disableCulling, renderTarget: { width: 97, height: 97 }, recovery: { delaysMs: [0, 0, 0] } } });
          host.__shadowTangent = { app, diagnostics };
          app.debug!.step(skin ? frames : 1, skin ? 1 / 60 : 0);
          return { pixels: Array.from((await app.debug!.readPixels()).data), counters: app.debug!.counters(), shader };
        } finally { GPUDevice.prototype.createShaderModule = original; }
      }, { skin, frames, quality, disableCulling, hidden });
      let recovered: number[] | undefined;
      if (skin && frames === 45 && !disableCulling) {
        await page.evaluate(() => (window as unknown as Host).__shadowTangent!.app.debug!.loseDevice());
        await page.waitForFunction(() => { const h = (window as unknown as Host).__shadowTangent!; return h.app.state === "running" && h.diagnostics.includes("MTEK-W8061"); });
        recovered = await page.evaluate(async () => { const app = (window as unknown as Host).__shadowTangent!.app; app.debug!.step(1, 0); return Array.from((await app.debug!.readPixels()).data); });
      }
      const disposed = await page.evaluate(() => { const h = (window as unknown as Host).__shadowTangent!; h.app.dispose(); return { counters: h.app.debug!.counters(), diagnostics: h.diagnostics }; });
      for (const key of live) expect(disposed.counters[key], key).toBe(0);
      expect(disposed.diagnostics.filter(code => code.startsWith("MTEK-E"))).toEqual([]);
      return { skin, frames, disableCulling, hidden, ...initial, recovered, disposed };
    };
    const a = await capture(true, 15), b = await capture(true, 45), referenceA = await capture(false, 15), referenceB = await capture(false, 45);
    const unculled = await capture(true, 45, true), hidden = await capture(false, 45, false, true);
    const comparisons = { referenceA: difference(a.pixels, referenceA.pixels, 2), referenceB: difference(b.pixels, referenceB.pixels, 2),
      culling: difference(b.pixels, unculled.pixels, 0), recovery: difference(b.pixels, b.recovered!, 0),
      animation: difference(a.pixels, b.pixels, 40), shadow: difference(b.pixels, hidden.pixels, 40) };
    writeRecord(`tangent-shadows-${quality}-${test.info().project.name}.json`, { a, b, referenceA, referenceB, unculled, hidden, comparisons });
    expect(a.shader).toContain("outputTangents"); expect(a.counters["culledObjects"]).toBeGreaterThan(0);
    expect(comparisons.referenceA).toBe(0); expect(comparisons.referenceB).toBe(0); expect(comparisons.culling).toBe(0); expect(comparisons.recovery).toBe(0);
    expect(comparisons.animation).toBeGreaterThan(70); expect(comparisons.shadow).toBeGreaterThan(70);
  });
}
