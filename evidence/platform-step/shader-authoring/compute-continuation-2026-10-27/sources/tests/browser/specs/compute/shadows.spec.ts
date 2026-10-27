import { test, expect } from "../../support/fixtures.ts";
import type { ShadowApi } from "../../pages/compute-shadow.ts";
import { writeRecord } from "../m4/configurator-support.ts";

for (const quality of ["low", "medium", "high"] as const) for (const mode of ["off-camera", "final-bounds"] as const) {
  test(`compute shadows match CPU geometry: ${quality}, ${mode}, pending and recovery`, async ({ page, gpu }) => {
    expect(gpu.available).toBe(true);
    if (test.info().project.name === "hardware") expect(gpu.record.gpu.adapter!.info.isFallbackAdapter).toBe(false);
    await page.goto("/compute/index.html");
    const report = await page.evaluate(async ({ quality, mode }) => (window as unknown as { __computeShadows: ShadowApi }).__computeShadows.run(quality, mode), { quality, mode });
    writeRecord(`compute-shadow-${quality}-${mode}-${test.info().project.name}.json`, report);
    expect(report.outputMismatches).toBe(0); expect(report.cpuDifferentPixels).toBeLessThanOrEqual(4); expect(report.unculledDifferentPixels).toBeLessThanOrEqual(4);
    expect(report.shadowDifferentPixels).toBeGreaterThan(40); expect(report.changedFromOriginal).toBeGreaterThan(40);
    expect(report.dispatchPending).toBe(true); expect(report.pendingDifferentPixels).toBe(0);
    expect(report.recoveredDifferentPixels).toBe(0); expect(report.detachedDifferentPixels).toBe(0);
    expect(report.resumedDifferentPixels).toBe(0); expect(report.dispatchFinished).toBe(true);
    expect(report.updatedOutputMismatches).toBe(0); expect(report.updatedCpuDifferentPixels).toBeLessThanOrEqual(4);
    expect(report.updatedChangedPixels).toBeGreaterThan(40); expect(report.updatedShadowDifferentPixels).toBeGreaterThan(40);
    if (mode === "off-camera") expect(report.counters["culledObjects"]).toBeGreaterThan(0);
    expect(report.diagnostics.filter(message => message.startsWith("MTEK-E"))).toEqual([]);
    expect(report.disposed).toHaveLength(7);
    for (const counters of report.disposed) for (const key of ["liveBuffers", "liveTextures", "liveSamplers", "liveShaderModules", "livePipelines", "liveBindGroups", "liveListeners"]) expect(counters[key], key).toBe(0);
    await page.locator("#preview").screenshot({ path: test.info().outputPath("compute-shadow.png") });
  });
}
