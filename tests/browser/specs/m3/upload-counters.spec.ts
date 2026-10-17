/**
 * M3-GATE: measured upload counters for the complete Demo (input to hypothesis H3, "upload volume per
 * edit is bounded and attributable", `spec/decisions/0001-why-a-new-language.md`).
 *
 * Each scenario steps the manual clock and reports the registry's `uploads` / `uploadBytes` deltas from
 * `debug.counters()`. The numbers are written to `m3-upload-counters.json` in the results directory so the
 * gate can commit them as evidence; the assertions pin the property H3 depends on: a frame in which nothing
 * changed uploads nothing, and a changing frame uploads a small bounded amount.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../../support/fixtures.ts";
import { readPulseCubeStatus } from "../../support/m3-fixtures.ts";
import { NOT_RUN_PREFIX } from "../../support/run-summary.ts";

interface Totals {
  uploads: number;
  uploadBytes: number;
}

interface Scenario extends Totals {
  scenario: string;
  frames: number;
  uploadsPerFrame: number;
  bytesPerFrame: number;
}

interface CounterApp {
  setInput(name: string, value: unknown): unknown;
  debug: {
    step(frames: number, dtSeconds: number): void;
    counters(): Record<string, number>;
    pressKey(code: string): void;
    releaseKey(code: string): void;
  };
}

interface MountWindow {
  __mtekMount: (options?: Record<string, unknown>) => Promise<CounterApp>;
  __app?: CounterApp;
}

const DT = 1 / 60;

test.describe("pulse-cube upload counters (H3)", () => {
  test("uploads happen only for what changed, and the volume is bounded", async ({ page, gpu }, testInfo) => {
    void gpu;
    const status = readPulseCubeStatus();
    if (status === null || !status.ok) {
      test.skip(true, `${NOT_RUN_PREFIX} pulse-cube did not build`);
      return;
    }
    await page.goto("/m3/pulse-cube/index.html");

    const result = await page.evaluate(
      async ({ dt }) => {
        const w = window as unknown as MountWindow;
        const app = (w.__app = await w.__mtekMount({
          test: { manualClock: true, renderTarget: { width: 64, height: 64 } },
        }));
        const totals = (): Totals => {
          const c = app.debug.counters();
          return { uploads: c["uploads"] ?? NaN, uploadBytes: c["uploadBytes"] ?? NaN };
        };
        const measure = (scenario: string, frames: number, act: () => void): Scenario => {
          const before = totals();
          act();
          const after = totals();
          const uploads = after.uploads - before.uploads;
          const uploadBytes = after.uploadBytes - before.uploadBytes;
          return {
            scenario,
            frames,
            uploads,
            uploadBytes,
            uploadsPerFrame: uploads / frames,
            bytesPerFrame: uploadBytes / frames,
          };
        };

        const mounted = totals();
        const scenarios: Scenario[] = [];
        scenarios.push(measure("first frame (every block is written once)", 1, () => app.debug.step(1, dt)));
        scenarios.push(measure("60 rotating frames (dt = 1/60)", 60, () => app.debug.step(60, dt)));
        scenarios.push(measure("60 frames with dt = 0 (nothing changes)", 60, () => app.debug.step(60, 0)));
        scenarios.push(
          measure("Space pressed, then 1 frame at dt = 0", 1, () => {
            app.debug.pressKey("Space");
            app.debug.step(1, 0);
            app.debug.releaseKey("Space");
          }),
        );
        scenarios.push(
          measure('setInput("tint") then 1 frame at dt = 0', 1, () => {
            app.setInput("tint", "#f04f72");
            app.debug.step(1, 0);
          }),
        );
        scenarios.push(measure("60 frames with dt = 0 after the edits", 60, () => app.debug.step(60, 0)));
        return { mounted, scenarios };
      },
      { dt: DT },
    );

    const dir = process.env["MTEK_RESULTS_DIR"];
    if (dir !== undefined) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "m3-upload-counters.json"), `${JSON.stringify(result, null, 2)}\n`);
    }
    await testInfo.attach("m3-upload-counters", {
      body: JSON.stringify(result, null, 2),
      contentType: "application/json",
    });

    const byName = (prefix: string): Scenario => {
      const found = result.scenarios.find((scenario) => scenario.scenario.startsWith(prefix));
      if (found === undefined) throw new Error(`no scenario ${prefix}`);
      return found;
    };
    // A frame in which nothing changed uploads nothing (writeIfChanged), whatever happened before it.
    for (const quiet of ["60 frames with dt = 0 (nothing", "Space pressed", "60 frames with dt = 0 after"]) {
      expect(byName(quiet).uploads, quiet).toBe(0);
      expect(byName(quiet).uploadBytes, quiet).toBe(0);
    }
    // A changing frame uploads a small, bounded amount: the object block and the bound material block.
    const rotating = byName("60 rotating frames");
    expect(rotating.uploadsPerFrame).toBeLessThanOrEqual(4);
    expect(rotating.bytesPerFrame).toBeLessThanOrEqual(512);
    expect(rotating.uploadBytes).toBeGreaterThan(0);
    // A host input edit costs exactly one write of the material parameter block.
    const tint = byName('setInput("tint")');
    expect(tint.uploads).toBe(1);
    expect(tint.uploadBytes).toBeGreaterThan(0);
    expect(tint.uploadBytes).toBeLessThanOrEqual(256);
  });
});
