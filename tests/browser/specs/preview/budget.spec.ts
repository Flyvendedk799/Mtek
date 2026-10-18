// M6-10: a runaway handler never hangs the page (spec/ai-and-benchmarks.md section 5, decision 0075).
//
//  - `fixtures/preview/runaway_update`: from the sixth frame on, `update` runs two nested loops of 2^31 - 1 iterations.
//    Built with `--mode preview` and opened as the unmodified page (policy, external bootstrap), the frame's loop
//    budget ends it: E8080 at the inner loop, the overlay shows it, the scene stops, and the main thread was never
//    blocked for more than the time the budget takes to spend. The same program built in release mode is the control:
//    its page is stuck, which is what the preview mode exists to prevent.
//  - The numbers are derived, not read from the runtime. The budget is B = `manifest.preview.loopBudget`; the counter
//    is decremented once per iteration of either loop and the check at the head of an iteration throws when it goes below
//    zero, so the outer loop's one iteration and B - 1 inner iterations pass and the inner loop's next check throws:
//    `total` (which the inner body increments) is exactly B - 1 and the reported loop is the inner `for`.
//  - `--loop-budget` changes B end to end (a second build with 12345).
//  - A loop that really works (200 000 iterations of f32 maths per frame) is not stopped and costs what is measured.
//  - A loop in the state initialiser fails the mount with E8080 (kind `budget-exceeded`) and the overlay.
import type { Page } from "@playwright/test";
import { expect, test } from "../../support/fixtures.ts";
import {
  DEFAULT_LOOP_BUDGET,
  LOOP_COST,
  RUNAWAY_INIT,
  RUNAWAY_UPDATE,
  RUNAWAY_UPDATE_SMALL,
  SMALL_BUDGET,
  releaseOf,
} from "../../support/preview-fixtures.ts";
import { exposeApp, installHeartbeat, locate, longestStall, manifestOf, newContext, within, type PageMtek } from "./preview-support.ts";

/** The time the overlay may take to appear, and the longest the main thread may stand still: generous, the budget is about 0.1 s. */
const OVERLAY_TIMEOUT_MS = 20_000;
const LONGEST_STALL_MS = 5_000;

test.beforeEach(({ gpu }) => {
  void gpu;
});

test.describe("a runaway update stops with E8080 instead of hanging the page", () => {
  for (const [name, budget] of [
    [RUNAWAY_UPDATE, DEFAULT_LOOP_BUDGET],
    [RUNAWAY_UPDATE_SMALL, SMALL_BUDGET],
  ] as const) {
    test(`${name}: the loop budget of ${String(budget)} ends the frame at the inner loop`, async ({ page }) => {
      expect(manifestOf(name).preview).toEqual({ loopBudget: budget });
      await installHeartbeat(page);
      await exposeApp(page, name, { test: {} });
      const started = Date.now();
      await page.goto(`/preview/${name}/index.html`);
      await page.waitForSelector("[data-mtek-overlay]", { timeout: OVERLAY_TIMEOUT_MS });
      const seconds = (Date.now() - started) / 1000;

      // The page answers: nothing is stuck.
      expect(await within(page.evaluate(() => 6 * 7), 3000)).toBe(42);
      const stall = await longestStall(page);
      expect(stall, "the longest the main thread stood still, in ms").toBeLessThan(LONGEST_STALL_MS);
      test.info().annotations.push({ type: "measurement", description: `${name}: overlay after ${seconds.toFixed(2)} s, longest main-thread stall ${stall.toFixed(0)} ms` });

      const run = await page.evaluate(() => {
        const mtek = (window as unknown as { __mtek: PageMtek }).__mtek;
        const app = mtek.app;
        const overlay = document.querySelector("[data-mtek-overlay]");
        const before = app?.debug.counters()["framesRendered"] ?? Number.NaN;
        return {
          state: app?.state,
          error: mtek.error,
          diagnostics: mtek.diagnostics,
          scene: app?.debug.scene().state,
          framesBefore: before,
          overlayRole: overlay?.getAttribute("role"),
          overlayText: overlay?.textContent ?? "",
          location: overlay?.querySelector("[data-mtek-location]")?.textContent ?? "",
          sections: [...document.querySelectorAll("[data-mtek-diagnostic]")].map((s) => s.getAttribute("data-mtek-diagnostic")),
        };
      });

      expect(run.error).toBeNull();
      expect(run.state).toBe("failed");
      // One diagnostic, E8080, at the loop of the program that spent the last iteration (the inner `for`).
      expect(run.diagnostics.map((d) => d.code)).toEqual(["MTEK-E8080"]);
      const [e8080] = run.diagnostics;
      expect(e8080?.severity).toBe("error");
      expect(e8080?.phase).toBe("runtime:update");
      expect(e8080?.message).toContain(`${String(budget)} iterations per frame`);
      const inner = locate(name, "for j in 0..2147483647");
      expect(e8080?.source).toMatchObject({ file: "src/main.mtek", startLine: inner.line, startColumn: inner.column });
      expect(run.location).toBe(`src/main.mtek:${String(inner.line)}:${String(inner.column)}`);
      expect(run.sections).toEqual(["MTEK-E8080"]);
      expect(run.overlayRole).toBe("alert");
      expect(run.overlayText).toContain("execution budget exceeded");

      // The program ran: six frames counted, and the inner body ran exactly B - 1 times before the check that threw.
      expect(run.scene?.["frames"]).toBe(6);
      expect(run.scene?.["total"]).toBe(budget - 1);

      // The scene is stopped for good: no further frame is rendered.
      await page.waitForTimeout(500);
      const framesAfter = await page.evaluate(() => (window as unknown as { __mtek: PageMtek }).__mtek.app?.debug.counters()["framesRendered"]);
      expect(framesAfter).toBe(run.framesBefore);
    });
  }

  test("the unmodified page (the generated bootstrap.js, nothing exposed) shows the same overlay", async ({ page }) => {
    await installHeartbeat(page);
    await page.goto(`/preview/${RUNAWAY_UPDATE}/index.html`);
    await page.waitForSelector("[data-mtek-overlay]", { timeout: OVERLAY_TIMEOUT_MS });
    expect(await within(page.evaluate(() => 6 * 7), 3000)).toBe(42);
    expect(await longestStall(page)).toBeLessThan(LONGEST_STALL_MS);
    const text = await page.locator("[data-mtek-overlay]").textContent();
    expect(text).toContain("MTEK-E8080: execution budget exceeded");
    const inner = locate(RUNAWAY_UPDATE, "for j in 0..2147483647");
    expect(text).toContain(`src/main.mtek:${String(inner.line)}:${String(inner.column)}`);
    // The page's own files: policy page, one external script, no inline script.
    expect(await page.locator("script").count()).toBe(1);
    expect(await page.locator("script").first().getAttribute("src")).toBe("./bootstrap.js");
    expect(await page.locator("script").first().textContent()).toBe("");
  });

  test("the same program built in release mode blocks the page for good (the control)", async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await newContext(browser);
    try {
      const page = await context.newPage();
      await installHeartbeat(page);
      await page.goto(`/preview/${releaseOf(RUNAWAY_UPDATE)}/index.html`, { waitUntil: "commit" });
      // Frames 1 to 5 run, the sixth never ends: after a few seconds the page does not answer.
      await page.waitForTimeout(4000);
      expect(await within(page.evaluate(() => 1), 3000), "a release build of the runaway program must hang the page").toBe("timeout");
    } finally {
      await within(context.close(), 20_000);
    }
  });
});

test.describe("a loop that does real work is not stopped, and costs what is measured", () => {
  /** Median `cpuUpdateMs` of 60 frames after 10 warm-up frames, with the manual clock (the same frames in both builds). */
  async function medianUpdateMs(page: Page, name: string): Promise<{ median: number; state: string; frames: number; diagnostics: string[] }> {
    await exposeApp(page, name, { test: { manualClock: true, renderTarget: { width: 64, height: 64 } } });
    await page.goto(`/preview/${name}/index.html`);
    await page.waitForFunction(
      () => (window as unknown as { __mtek?: PageMtek }).__mtek?.app != null || (window as unknown as { __mtek?: PageMtek }).__mtek?.error != null,
      undefined,
      { timeout: 30_000 },
    );
    const mountError = await page.evaluate(() => (window as unknown as { __mtek: PageMtek }).__mtek.error);
    expect(mountError, `${name} mounts`).toBeNull();
    return page.evaluate(() => {
      const mtek = (window as unknown as { __mtek: PageMtek }).__mtek;
      const app = mtek.app;
      if (app === null) throw new Error("not mounted");
      app.debug.step(10, 0.016);
      const samples: number[] = [];
      for (let i = 0; i < 60; i += 1) {
        app.debug.step(1, 0.016);
        samples.push(app.debug.counters()["cpuUpdateMs"] ?? Number.NaN);
      }
      samples.sort((a, b) => a - b);
      return { median: samples[30] ?? Number.NaN, state: app.state, frames: app.debug.scene().state["frames"] ?? 0, diagnostics: mtek.diagnostics.map((d) => d.code) };
    });
  }

  test("200 000 iterations per frame run for 70 frames in a preview, and the checks cost a small multiple at most", async ({ page, browser }) => {
    const preview = await medianUpdateMs(page, LOOP_COST);
    expect(preview).toMatchObject({ state: "running", frames: 70, diagnostics: [] });

    const context = await newContext(browser);
    try {
      const control = await context.newPage();
      const release = await medianUpdateMs(control, releaseOf(LOOP_COST));
      expect(release).toMatchObject({ state: "running", frames: 70, diagnostics: [] });
      const ratio = preview.median / release.median;
      test.info().annotations.push({
        type: "measurement",
        description: `loop_cost (200 000 f32 iterations per frame): median update ${release.median.toFixed(2)} ms release, ${preview.median.toFixed(2)} ms preview, ratio ${ratio.toFixed(2)}`,
      });
      expect(release.median).toBeGreaterThan(0);
      // A guard against a pathological cost (the first design, `--ctx.budget` through the guarded context on every
      // iteration, was thirty times a plain read); the measured ratio is in the annotation and decision 0075.
      expect(ratio).toBeLessThan(3);
    } finally {
      await context.close();
    }
    // The budget it ran under is the default: 200 000 iterations a frame is 2 % of it.
    expect(manifestOf(LOOP_COST).preview?.loopBudget).toBe(DEFAULT_LOOP_BUDGET);
  });
});

test.describe("a runaway loop while the scene is initialised fails the mount", () => {
  test("E8080 with the kind budget-exceeded, at the loop, in the overlay", async ({ page }) => {
    await installHeartbeat(page);
    await exposeApp(page, RUNAWAY_INIT, {});
    await page.goto(`/preview/${RUNAWAY_INIT}/index.html`);
    await page.waitForSelector("[data-mtek-overlay]", { timeout: OVERLAY_TIMEOUT_MS });
    expect(await within(page.evaluate(() => 1), 3000)).toBe(1);
    expect(await longestStall(page)).toBeLessThan(LONGEST_STALL_MS);
    const run = await page.evaluate(() => ({
      app: (window as unknown as { __mtek: PageMtek }).__mtek.app,
      error: (window as unknown as { __mtek: PageMtek }).__mtek.error,
      diagnostics: (window as unknown as { __mtek: PageMtek }).__mtek.diagnostics.map((d) => ({ code: d.code, phase: d.phase, source: d.source, message: d.message })),
      overlay: document.querySelector("[data-mtek-overlay]")?.textContent ?? "",
    }));
    expect(run.app).toBeNull();
    expect(run.error).toMatchObject({ kind: "budget-exceeded", codes: ["MTEK-E8080"] });
    expect(run.diagnostics).toHaveLength(1);
    const inner = locate(RUNAWAY_INIT, "for j in 0..n");
    expect(run.diagnostics[0]).toMatchObject({
      code: "MTEK-E8080",
      phase: "runtime:mount",
      source: { file: "src/main.mtek", startLine: inner.line, startColumn: inner.column },
    });
    expect(run.diagnostics[0]?.message).toContain("while the scene was initialised");
    expect(run.overlay).toContain("MTEK-E8080");
  });
});

test("the builds the specs serve: previews carry the budget, the release controls do not", () => {
  // A guard for the setup: the controls must be what they claim, or the specs above prove nothing.
  for (const name of [RUNAWAY_UPDATE, RUNAWAY_UPDATE_SMALL, RUNAWAY_INIT, LOOP_COST]) {
    expect(manifestOf(name).preview?.loopBudget, name).toBeGreaterThan(0);
  }
  for (const name of [releaseOf(RUNAWAY_UPDATE), releaseOf(LOOP_COST)]) expect(manifestOf(name).preview, name).toBeUndefined();
});
