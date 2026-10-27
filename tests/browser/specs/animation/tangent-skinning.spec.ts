import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { test, expect } from "../../support/fixtures.ts";
import type { runTangentSkinningProbe } from "../../support/tangent-skinning-probe.ts";
import { writeRecord } from "../m4/configurator-support.ts";

for (const [actors, mixed] of [...[1, 10, 50].map(actors => [actors, false] as const), [6, true]] as const) for (const vertices of [63, 1025]) {
  test(`tangent frames: ${String(actors)} actors, ${String(vertices)} vertices, ${mixed ? "three pipelines" : "tangent pipeline"}`, async ({ page, gpu }) => {
    expect(gpu.available).toBe(true);
    const bundle = await build({ entryPoints: [fileURLToPath(new URL("../../support/tangent-skinning-probe.ts", import.meta.url))], bundle: true, write: false, format: "iife", globalName: "tangentProbe", target: "es2022" });
    await page.goto("/env.html"); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const report = await page.evaluate(async ({ actors, vertices, mixed }) => (window as unknown as { tangentProbe: { runTangentSkinningProbe: typeof runTangentSkinningProbe } }).tangentProbe.runTangentSkinningProbe(actors, vertices, mixed), { actors, vertices, mixed });
    writeRecord(`tangent-skinning-${String(actors)}-${String(vertices)}-${mixed ? "mixed" : "all"}-${test.info().project.name}.json`, report);
    expect(report.storageBufferLimit).toBeGreaterThanOrEqual(8); expect(report.validation).toBeNull();
    for (const error of [report.positionNormalError, report.tangentGpuError, report.tangentCpuError, report.orthogonalityError]) expect(error).toBeLessThan(0.00003);
    expect(report.uploaded).toBe(report.expectedUpload); expect(report.outputBytes).toBe(report.expectedOutputBytes); expect(report.live).toBe(0);
    expect(report.rejectedRequests).toHaveLength(5); expect(report.invalidRequestsAllocatedNothing).toBe(true);
    expect(report.borrowedInputSurvived).toBe(true);
    expect(report.handedness.positive).toBeGreaterThan(0); expect(report.handedness.negative).toBeGreaterThan(0); expect(report.handedness.unavailable).toBeGreaterThan(0);
    if (mixed) expect(new Set(report.profiles)).toEqual(new Set(["position", "normal", "tangent"]));
  });
}
