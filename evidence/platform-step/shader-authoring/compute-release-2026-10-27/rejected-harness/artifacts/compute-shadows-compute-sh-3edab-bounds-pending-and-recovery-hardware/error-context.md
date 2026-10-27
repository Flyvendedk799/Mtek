# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: compute\shadows.spec.ts >> compute shadows match CPU geometry: high, final-bounds, pending and recovery
- Location: specs\compute\shadows.spec.ts:6:3

# Error details

```
Error: expect(received).toBeLessThanOrEqual(expected)

Expected: <= 4
Received:    576
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - heading "Compute acceptance lab" [level=1] [ref=e2]
  - paragraph [ref=e3]: Development fixture. Ordinary source builds still report E4901. Each button runs a bounded correctness probe; no probe runs automatically.
  - button "Compare numerical output" [ref=e4]
  - button "Compare geometry and recovery" [ref=e5]
  - button "Compare compute shadows" [ref=e6]
  - generic "Captured computed geometry" [ref=e8]
  - generic [ref=e9]: Ready. No GPU requested yet.
```

# Test source

```ts
  1  | import { test, expect } from "../../support/fixtures.ts";
  2  | import type { ShadowApi } from "../../pages/compute-shadow.ts";
  3  | import { writeRecord } from "../m4/configurator-support.ts";
  4  | 
  5  | for (const quality of ["low", "medium", "high"] as const) for (const mode of ["off-camera", "final-bounds"] as const) {
  6  |   test(`compute shadows match CPU geometry: ${quality}, ${mode}, pending and recovery`, async ({ page, gpu }) => {
  7  |     expect(gpu.available).toBe(true);
  8  |     if (test.info().project.name === "hardware") expect(gpu.record.gpu.adapter!.info.isFallbackAdapter).toBe(false);
  9  |     await page.goto("/compute/index.html");
  10 |     const report = await page.evaluate(async ({ quality, mode }) => (window as unknown as { __computeShadows: ShadowApi }).__computeShadows.run(quality, mode), { quality, mode });
  11 |     writeRecord(`compute-shadow-${quality}-${mode}-${test.info().project.name}.json`, report);
> 12 |     expect(report.outputMismatches).toBe(0); expect(report.cpuDifferentPixels).toBeLessThanOrEqual(4); expect(report.unculledDifferentPixels).toBeLessThanOrEqual(4);
     |                                                                                ^ Error: expect(received).toBeLessThanOrEqual(expected)
  13 |     expect(report.shadowDifferentPixels).toBeGreaterThan(40); expect(report.changedFromOriginal).toBeGreaterThan(40);
  14 |     expect(report.dispatchPending).toBe(true); expect(report.pendingDifferentPixels).toBe(0);
  15 |     expect(report.recoveredDifferentPixels).toBe(0); expect(report.detachedDifferentPixels).toBe(0);
  16 |     if (mode === "off-camera") expect(report.counters["culledObjects"]).toBeGreaterThan(0);
  17 |     expect(report.diagnostics.filter(message => message.startsWith("MTEK-E"))).toEqual([]);
  18 |     expect(report.disposed).toHaveLength(5);
  19 |     for (const counters of report.disposed) for (const key of ["liveBuffers", "liveTextures", "liveSamplers", "liveShaderModules", "livePipelines", "liveBindGroups", "liveListeners"]) expect(counters[key], key).toBe(0);
  20 |     await page.locator("#preview").screenshot({ path: test.info().outputPath("compute-shadow.png") });
  21 |   });
  22 | }
  23 | 
```