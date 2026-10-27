# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: compute\acceptance.spec.ts >> computed geometry matches CPU/direct-WGSL pixels through recovery, detach and reset
- Location: specs\compute\acceptance.spec.ts:22:1

# Error details

```
Error: liveEntities

expect(received).toBe(expected) // Object.is equality

Expected: 0
Received: 2
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - heading "Compute acceptance lab" [level=1] [ref=e2]
  - paragraph [ref=e3]: Development fixture. Ordinary source builds still report E4901. Each button runs a bounded correctness probe; no probe runs automatically.
  - button "Compare numerical output" [ref=e4]
  - button "Compare geometry and recovery" [ref=e5]
  - generic "Captured computed geometry" [ref=e7]
  - generic [ref=e8]: Ready. No GPU requested yet.
```

# Test source

```ts
  1  | import { test, expect } from "../../support/fixtures.ts";
  2  | import type { ComputeAcceptanceApi } from "../../pages/compute.ts";
  3  | import { writeRecord } from "../m4/configurator-support.ts";
  4  | 
  5  | function released(counters: Readonly<Record<string, number>>): void {
  6  |   const live = Object.entries(counters).filter(([name]) => name.startsWith("live"));
  7  |   expect(live.length).toBeGreaterThan(4);
> 8  |   for (const [name, value] of live) expect(value, name).toBe(0);
     |                                                         ^ Error: liveEntities
  9  | }
  10 | 
  11 | test("source compute matches CPU and independent WGSL, including tails and all invocation fields", async ({ page, gpu }) => {
  12 |   expect(gpu.available).toBe(true);
  13 |   if (test.info().project.name === "hardware") expect(gpu.record.gpu.adapter!.info.isFallbackAdapter).toBe(false);
  14 |   await page.goto("/compute/index.html");
  15 |   const report = await page.evaluate(async () => (window as unknown as { __computeAcceptance: ComputeAcceptanceApi }).__computeAcceptance.numerical());
  16 |   writeRecord(`compute-numerical-${test.info().project.name}.json`, report);
  17 |   expect(report.cases).toHaveLength(5);
  18 |   for (const result of report.cases) { expect(result.cpuMismatches, `${result.name}/${result.domain.join("x")}`).toBe(0); expect(result.directMismatches, `${result.name}/${result.domain.join("x")}`).toBe(0); }
  19 |   expect(report.diagnostics).toEqual([]); expect(report.directErrors).toEqual([]); released(report.disposed);
  20 | });
  21 | 
  22 | test("computed geometry matches CPU/direct-WGSL pixels through recovery, detach and reset", async ({ page, gpu }) => {
  23 |   expect(gpu.available).toBe(true);
  24 |   if (test.info().project.name === "hardware") expect(gpu.record.gpu.adapter!.info.isFallbackAdapter).toBe(false);
  25 |   await page.goto("/compute/index.html");
  26 |   const report = await page.evaluate(async () => (window as unknown as { __computeAcceptance: ComputeAcceptanceApi }).__computeAcceptance.render());
  27 |   writeRecord(`compute-render-${test.info().project.name}.json`, report);
  28 |   expect(report.outputMismatches).toBe(0); expect(report.cpuDifferentPixels).toBeLessThanOrEqual(4); expect(report.directDifferentPixels).toBeLessThanOrEqual(4);
  29 |   expect(report.changedFromOriginal).toBeGreaterThan(100); expect(report.recoveredDifferentPixels).toBe(0); expect(report.disposedAttachmentDifferentPixels).toBe(0);
  30 |   expect(report.resetHandleState).toBe("ready"); expect(report.resetAttachmentState).toBe("disposed"); expect(report.oldHandleState).toBe("disposed"); expect(report.replacementAttachmentState).toBe("disposed");
  31 |   expect(report.diagnostics.filter((diagnostic) => diagnostic.startsWith("MTEK-E"))).toEqual([]);
  32 |   expect(report.diagnostics.some((diagnostic) => diagnostic.startsWith("MTEK-W8061"))).toBe(true);
  33 |   expect(report.directErrors).toEqual([]); released(report.disposed);
  34 |   await page.screenshot({ path: test.info().outputPath("computed-geometry.png") });
  35 | });
  36 | 
```