// M4-09 (decision 0056): device loss and allocation failure on hardware. `app.debug.loseDevice()` destroys the real
// GPU device; the runtime must pause, report W8060, rebuild every GPU resource on a new device from the manifest
// and the retained CPU state, and produce exactly the output of a run that never lost its device. Repeated failure
// must end in `failed` with E8062 and the overlay after at most three attempts. The program is
// `examples/pulse-cube` (state, an update handler, `bind(frame.time)`), so the retained state is observable.
import { expect, test } from "../../support/fixtures.ts";
import { readPulseCubeStatus } from "../../support/m3-fixtures.ts";
import { NOT_RUN_PREFIX } from "../../support/run-summary.ts";
import { captureOrThrow, drawnPixels, mount, openFixture, scene, status, step, waitForState } from "./resilience-support.ts";
import type { Capture, Counters } from "./resilience-support.ts";

const URL = "/m3/pulse-cube/index.html";
const DT = 1 / 60;
const TARGET = { width: 64, height: 64 };
/** The pulse-cube scene does not set a clear colour: black. */
const CLEAR = [0, 0, 0];
/** Bind groups are created when a frame first encodes them, so they are compared after the next frames. */
const LIVE = ["liveBuffers", "liveTextures", "liveSamplers", "liveShaderModules", "livePipelines", "liveListeners", "liveEntities"];

test.describe("device loss and allocation failure (hardware)", () => {
  test.beforeEach(async ({ page, gpu }) => {
    void gpu;
    const build = readPulseCubeStatus();
    if (build === null) {
      test.skip(true, `${NOT_RUN_PREFIX} pulse-cube build status missing (global setup did not run buildPulseCube)`);
    } else if (!build.ok) {
      test.skip(true, build.reason ?? `${NOT_RUN_PREFIX} pulse-cube build failed`);
    }
    await openFixture(page, URL);
  });

  /** The state after `frames` frames of an application that never lost its device. */
  async function reference(page: Parameters<typeof mount>[0], frames: number): Promise<{ pixels: Capture; scene: Awaited<ReturnType<typeof scene>>; counters: Counters }> {
    await page.evaluate(() => {
      (window as unknown as { __h: { app?: { dispose(): void } } }).__h.app?.dispose();
    });
    await mount(page, { test: { manualClock: true, renderTarget: TARGET } });
    await step(page, frames, DT);
    return { pixels: await captureOrThrow(page), scene: await scene(page), counters: (await status(page)).counters };
  }

  test("recovers after device.destroy(): W8060, three-attempt budget, W8061, and output identical to a run without the loss", async ({ page }, testInfo) => {
    await mount(page, { test: { manualClock: true, renderTarget: TARGET } });
    await step(page, 30, DT);
    const beforeLoss = await captureOrThrow(page);
    expect(drawnPixels(beforeLoss, CLEAR), "the cube is on screen before the loss").toBeGreaterThan(100);
    const sceneBefore = await scene(page);
    const countersBefore = (await status(page)).counters;

    // Lose the device and time the recovery: the first attempt waits the specified 250 ms.
    const elapsed = await page.evaluate(async () => {
      const w = window as unknown as { __h: { app: { state: string; debug: { loseDevice(): void } } } };
      const started = performance.now();
      w.__h.app.debug.loseDevice();
      while (w.__h.app.state !== "recovering") await new Promise((resolve) => setTimeout(resolve, 1));
      const recoveringAt = performance.now();
      while (w.__h.app.state === "recovering") await new Promise((resolve) => setTimeout(resolve, 5));
      return { toRecovering: recoveringAt - started, total: performance.now() - started };
    });
    testInfo.annotations.push({ type: "m4-recovery", description: `loss to recovering ${elapsed.toRecovering.toFixed(0)} ms, total ${elapsed.total.toFixed(0)} ms` });
    expect(elapsed.total).toBeGreaterThanOrEqual(240);
    expect(elapsed.total).toBeLessThan(5000);

    const recovered = await status(page);
    expect(recovered.state).toBe("running");
    expect(recovered.reported.map((d) => d.code)).toEqual(["MTEK-W8060", "MTEK-W8061"]);
    expect(recovered.reported[0]).toMatchObject({ severity: "warning", phase: "runtime:device" });
    expect(recovered.reported[1]?.message).toContain("attempt 1 of 3");
    expect(recovered.overlayText).toBeNull();
    expect(recovered.counters).toMatchObject({ deviceLosses: 1, deviceRecoveries: 1, recoveryAttempts: 1 });
    // The CPU state survived untouched: the loss and the rebuild advanced no time and changed no record.
    expect(await scene(page)).toEqual(sceneBefore);
    expect(recovered.counters["framesRendered"]).toBe(countersBefore["framesRendered"]);
    // Every GPU resource exists again on the new device: the live counts are the ones before the loss, the totals grew.
    for (const name of LIVE) expect(recovered.counters[name], name).toBe(countersBefore[name]);
    expect(recovered.counters["pipelinesCreated"]).toBe((countersBefore["pipelinesCreated"] ?? 0) * 2);
    expect(recovered.counters["shaderModulesCreated"]).toBe((countersBefore["shaderModulesCreated"] ?? 0) * 2);

    await step(page, 30, DT);
    const afterRecovery = await captureOrThrow(page);
    const sceneAfter = await scene(page);
    const countersAfter = (await status(page)).counters;

    const control = await reference(page, 60);
    expect(drawnPixels(control.pixels, CLEAR)).toBeGreaterThan(100);
    expect(afterRecovery.base64, "pixels after the recovery equal the pixels of a run that never lost its device").toBe(control.pixels.base64);
    expect(sceneAfter, "scene state, transforms and material mirrors equal the control run").toEqual(control.scene);
    for (const name of [...LIVE, "liveBindGroups"]) expect(countersAfter[name], name).toBe(control.counters[name]);
    expect(afterRecovery.base64).not.toBe(beforeLoss.base64);
  });

  test("a frame request during the recovery renders nothing, and the device can be lost and recovered again", async ({ page }) => {
    await mount(page, { test: { manualClock: true, renderTarget: TARGET, recovery: { delaysMs: [30, 30, 30] } } });
    await step(page, 5, DT);
    for (const round of [1, 2]) {
      const result = await page.evaluate(async () => {
        const w = window as unknown as {
          __h: { app: { state: string; debug: { loseDevice(): void; step(n: number, dt: number): void; counters(): Record<string, number> } } };
        };
        const app = w.__h.app;
        const before = app.debug.counters()["framesRendered"];
        app.debug.loseDevice();
        while (app.state !== "recovering") await new Promise((resolve) => setTimeout(resolve, 1));
        app.debug.step(3, 1 / 60); // paused: does nothing
        const during = app.debug.counters()["framesRendered"];
        while (app.state === "recovering") await new Promise((resolve) => setTimeout(resolve, 5));
        return { before, during };
      });
      expect(result.during, `round ${String(round)}`).toBe(result.before);
      await waitForState(page, "running");
      await step(page, 2, DT);
    }
    const after = await status(page);
    expect(after.counters).toMatchObject({ deviceLosses: 2, deviceRecoveries: 2, recoveryAttempts: 2 });
    expect(after.reported.map((d) => d.code)).toEqual(["MTEK-W8060", "MTEK-W8061", "MTEK-W8060", "MTEK-W8061"]);
    expect(drawnPixels(await captureOrThrow(page), CLEAR)).toBeGreaterThan(100);
  });

  test("two failed device requests are retried: the third attempt recovers", async ({ page }) => {
    await mount(page, { test: { manualClock: true, renderTarget: TARGET, recovery: { delaysMs: [20, 20, 20], failDeviceRequests: 2 } } });
    await step(page, 10, DT);
    await page.evaluate(() => {
      (window as unknown as { __h: { app: { debug: { loseDevice(): void } } } }).__h.app.debug.loseDevice();
    });
    await waitForState(page, "recovering");
    await waitForState(page, "running");
    const done = await status(page);
    expect(done.counters).toMatchObject({ deviceLosses: 1, deviceRecoveries: 1, recoveryAttempts: 3 });
    expect(done.reported.map((d) => d.code)).toEqual(["MTEK-W8060", "MTEK-W8061"]);
    expect(done.reported[1]?.message).toContain("attempt 3 of 3");
    await step(page, 5, DT);
    expect(drawnPixels(await captureOrThrow(page), CLEAR)).toBeGreaterThan(100);
  });

  test("repeated failure reaches the failed state with E8062 and the overlay after exactly three attempts, and never retries again", async ({ page }) => {
    await mount(page, { test: { manualClock: true, renderTarget: TARGET, recovery: { delaysMs: [20, 40, 80], failDeviceRequests: 3 } } });
    await step(page, 10, DT);
    await page.evaluate(() => {
      (window as unknown as { __h: { app: { debug: { loseDevice(): void } } } }).__h.app.debug.loseDevice();
    });
    await waitForState(page, "failed");
    const failed = await status(page);
    expect(failed.reported.map((d) => d.code)).toEqual(["MTEK-W8060", "MTEK-E8062"]);
    const e8062 = failed.reported[1];
    expect(e8062).toMatchObject({ severity: "error", phase: "runtime:device" });
    expect(e8062?.message).toContain("3 attempts");
    expect(e8062?.notes.filter((note) => note.startsWith("attempt "))).toHaveLength(3);
    expect(failed.counters).toMatchObject({ deviceLosses: 1, deviceRecoveries: 0, recoveryAttempts: 3 });
    expect(failed.overlayRole).toBe("alert");
    expect(failed.overlayText).toContain("MTEK-E8062");

    // No infinite loop: well past the longest delay nothing more happens.
    await page.waitForTimeout(400);
    const later = await status(page);
    expect(later.state).toBe("failed");
    expect(later.counters["recoveryAttempts"]).toBe(3);
    expect(later.reported.map((d) => d.code)).toEqual(["MTEK-W8060", "MTEK-E8062"]);

    // A failed application can still be disposed and removes its overlay.
    await page.evaluate(() => {
      (window as unknown as { __h: { app: { dispose(): void } } }).__h.app.dispose();
    });
    expect((await status(page)).overlayText).toBeNull();
  });

  test("an allocation failure after mount reports E8063, stops the scene and shows the overlay", async ({ page }) => {
    await mount(page, { test: { manualClock: true, renderTarget: TARGET } });
    await step(page, 3, DT);
    const frames = (await status(page)).counters["framesRendered"];
    await page.evaluate(() => {
      (window as unknown as { __h: { app: { debug: { failAllocation(): void } } } }).__h.app.debug.failAllocation();
    });
    const failed = await status(page);
    expect(failed.state).toBe("failed");
    expect(failed.reported.map((d) => d.code)).toEqual(["MTEK-E8063"]);
    expect(failed.reported[0]).toMatchObject({ severity: "error" });
    expect(failed.overlayRole).toBe("alert");
    expect(failed.overlayText).toContain("MTEK-E8063");
    await step(page, 3, DT);
    expect((await status(page)).counters["framesRendered"], "the scene stopped instead of rendering stale data").toBe(frames);
  });
});
