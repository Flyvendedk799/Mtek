import { test, expect } from "../../support/fixtures.ts";
import type { ComputeAcceptanceApi } from "../../pages/compute.ts";
import { writeRecord } from "../m4/configurator-support.ts";

function released(counters: Readonly<Record<string, number>>): void {
  // Registry ownership counters, not retained CPU scene-snapshot counts such as liveEntities.
  for (const name of ["liveBuffers", "liveTextures", "liveSamplers", "liveShaderModules", "livePipelines", "liveBindGroups", "liveListeners"]) expect(counters[name], name).toBe(0);
}

test("source compute matches CPU and independent WGSL, including tails and all invocation fields", async ({ page, gpu }) => {
  expect(gpu.available).toBe(true);
  if (test.info().project.name === "hardware") expect(gpu.record.gpu.adapter!.info.isFallbackAdapter).toBe(false);
  await page.goto("/compute/index.html");
  const report = await page.evaluate(async () => (window as unknown as { __computeAcceptance: ComputeAcceptanceApi }).__computeAcceptance.numerical());
  writeRecord(`compute-numerical-${test.info().project.name}.json`, report);
  expect(report.cases).toHaveLength(13);
  for (const result of report.cases) { expect(result.cpuMismatches, `${result.name}/${result.domain.join("x")}`).toBe(0); expect(result.directMismatches, `${result.name}/${result.domain.join("x")}`).toBe(0); }
  expect(report.diagnostics).toEqual([]); expect(report.directErrors).toEqual([]); released(report.disposed);
});

test("computed geometry matches CPU/direct-WGSL pixels through recovery, detach and reset", async ({ page, gpu }) => {
  expect(gpu.available).toBe(true);
  if (test.info().project.name === "hardware") expect(gpu.record.gpu.adapter!.info.isFallbackAdapter).toBe(false);
  await page.goto("/compute/index.html");
  const report = await page.evaluate(async () => (window as unknown as { __computeAcceptance: ComputeAcceptanceApi }).__computeAcceptance.render());
  writeRecord(`compute-render-${test.info().project.name}.json`, report);
  expect(report.outputMismatches).toBe(0); expect(report.cpuDifferentPixels).toBeLessThanOrEqual(4); expect(report.directDifferentPixels).toBeLessThanOrEqual(4);
  expect(report.changedFromOriginal).toBeGreaterThan(100); expect(report.recoveredDifferentPixels).toBe(0); expect(report.disposedAttachmentDifferentPixels).toBe(0);
  expect(report.resetHandleState).toBe("ready"); expect(report.resetAttachmentState).toBe("disposed"); expect(report.oldHandleState).toBe("disposed"); expect(report.replacementAttachmentState).toBe("disposed");
  expect(report.diagnostics.filter((diagnostic) => diagnostic.startsWith("MTEK-E"))).toEqual([]);
  expect(report.diagnostics.some((diagnostic) => diagnostic.startsWith("MTEK-W8061"))).toBe(true);
  expect(report.directErrors).toEqual([]); released(report.disposed);
  await page.locator("#preview").screenshot({ path: test.info().outputPath("computed-geometry.png") });
});
