// M4-09 (decision 0056): the runtime survives the real browser. Resize, pixel ratio, zero size and visibility,
// on hardware, through the offscreen target that follows the canvas (`test.canvasRenderTarget`), so the
// result is read back from pixels and compared with the CPU projection of the independent reference
// (support/m1-reference.ts, the matrices of spec/runtime-abi.md section 8.3). Nothing is a screenshot.
import { expect, test } from "../../support/fixtures.ts";
import { expectedRgb8, projectToPixels, type SceneSpec, type Vec3 } from "../../support/m1-reference.ts";
import { SCENE_A } from "../../support/m1-scenes.ts";
import {
  canvasBackingSize,
  capture,
  captureOrThrow,
  drawnPixels,
  mount,
  openFixture,
  setCanvasCssSize,
  silhouette,
  status,
  step,
  type Capture,
} from "./resilience-support.ts";

const FIXTURE_URL = `/m1/${SCENE_A.fixture}/index.html`;
const CLEAR = expectedRgb8("#202830");
/** The silhouette edge of a pixel-centre rasterisation is within this many pixels of the projected vertex hull. */
const EDGE_TOLERANCE = 2;

/** The unit box of the fixture: centre (0, 0.5, 0), size 1. */
const CORNERS: readonly Vec3[] = [-0.5, 0.5].flatMap((x) => [0, 1].flatMap((y) => [-0.5, 0.5].map((z): Vec3 => [x, y, z])));

/** Where the box's bounding rectangle lies for a target of `width x height`, from the CPU reference. */
function expectedBox(width: number, height: number): { minX: number; maxX: number; minY: number; maxY: number } {
  const scene: SceneSpec = { ...SCENE_A, renderTarget: { width, height } };
  const points = CORNERS.map((corner) => projectToPixels(scene, corner));
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

function expectBoxMatches(pixels: Capture, width: number, height: number, label: string): { width: number; height: number } {
  expect([pixels.width, pixels.height], `${label}: the target has the canvas size`).toEqual([width, height]);
  const actual = silhouette(pixels, CLEAR);
  expect(actual, `${label}: something is drawn`).not.toBeNull();
  if (actual === null) throw new Error("unreachable");
  const expected = expectedBox(width, height);
  const edges = {
    left: [actual.minX, expected.minX],
    right: [actual.maxX + 1, expected.maxX],
    top: [actual.minY, expected.minY],
    bottom: [actual.maxY + 1, expected.maxY],
  } as const;
  for (const [edge, [got, want]] of Object.entries(edges)) {
    expect(Math.abs((got ?? NaN) - (want ?? NaN)), `${label}: ${edge} edge ${String(got)} vs projected ${String(want)}`).toBeLessThanOrEqual(EDGE_TOLERANCE);
  }
  return { width: actual.maxX + 1 - actual.minX, height: actual.maxY + 1 - actual.minY };
}

test.describe("resize, pixel ratio, zero size and visibility (hardware)", () => {
  test.beforeEach(async ({ page, gpu }) => {
    void gpu;
    await openFixture(page, FIXTURE_URL);
    // Own the canvas size: the page's stylesheet would otherwise follow the viewport.
    await setCanvasCssSize(page, 128, 128);
    await mount(page, { pauseWhenHidden: true, test: { manualClock: true, canvasRenderTarget: true } });
  });

  test("a resize during a manual-clock run keeps the box undistorted: edges match the projection at every aspect", async ({ page }, testInfo) => {
    const lines: string[] = [];
    const measured = new Map<string, { width: number; height: number }>();
    await step(page, 2);
    for (const [width, height] of [
      [128, 128],
      [256, 128],
      [128, 256],
      [96, 96],
      [200, 120],
      [128, 128],
    ] as const) {
      await setCanvasCssSize(page, width, height);
      await step(page, 3);
      const pixels = await captureOrThrow(page);
      const box = expectBoxMatches(pixels, width, height, `${String(width)}x${String(height)}`);
      measured.set(`${String(width)}x${String(height)}`, box);
      lines.push(`${String(width)}x${String(height)}: box ${String(box.width)}x${String(box.height)} px, projected ${JSON.stringify(expectedBox(width, height))}`);
      expect(await canvasBackingSize(page)).toEqual({ width, height });
    }
    testInfo.annotations.push({ type: "m4-resize", description: lines.join("; ") });

    // Vertical fov is fixed, so the pixel size of the box depends on the height only: a canvas twice as wide shows
    // the same box, a canvas twice as tall a box twice as large. A stale aspect ratio would stretch it instead.
    const square = measured.get("128x128");
    const wide = measured.get("256x128");
    const tall = measured.get("128x256");
    if (square === undefined || wide === undefined || tall === undefined) throw new Error("missing measurements");
    expect(Math.abs(wide.width - square.width)).toBeLessThanOrEqual(EDGE_TOLERANCE);
    expect(Math.abs(wide.height - square.height)).toBeLessThanOrEqual(EDGE_TOLERANCE);
    expect(Math.abs(tall.width - 2 * square.width)).toBeLessThanOrEqual(2 * EDGE_TOLERANCE);
    expect(Math.abs(tall.height - 2 * square.height)).toBeLessThanOrEqual(2 * EDGE_TOLERANCE);

    const after = await status(page);
    expect(after.state).toBe("running");
    expect(after.reported, "no runtime diagnostics (a stale depth texture would be a validation error)").toEqual([]);
    expect(after.overlayText).toBeNull();
    // The depth texture and the render target are recreated on each size change; the live counts stay at two.
    expect(after.counters["liveTextures"]).toBe(2);
    expect(after.counters["framesSkipped"]).toBe(0);
  });

  test("a change of the pixel ratio resizes the backing store and the picture follows", async ({ page }, testInfo) => {
    await setCanvasCssSize(page, 128, 96);
    await step(page, 1);
    expectBoxMatches(await captureOrThrow(page), 128, 96, "pixel ratio 1");

    const cdp = await page.context().newCDPSession(page);
    // Chromium re-evaluates media queries (and fires their change events) at the next lifecycle update, which a
    // changed window size forces: moving a window to another display changes both, so each step also nudges the width.
    let width = 1280;
    const metrics = (deviceScaleFactor: number): Promise<unknown> => {
      width += 1;
      return cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 720, deviceScaleFactor, mobile: false });
    };
    await metrics(2);
    await page.waitForFunction(() => (document.getElementById("mtek") as HTMLCanvasElement).width === 256, undefined, { timeout: 10_000 });
    expect(await canvasBackingSize(page)).toEqual({ width: 256, height: 192 });
    await step(page, 1);
    const doubled = expectBoxMatches(await captureOrThrow(page), 256, 192, "pixel ratio 2");

    await metrics(1.5);
    await page.waitForFunction(() => (document.getElementById("mtek") as HTMLCanvasElement).width === 192, undefined, { timeout: 10_000 });
    await step(page, 1);
    const fractional = expectBoxMatches(await captureOrThrow(page), 192, 144, "pixel ratio 1.5");

    await metrics(1);
    await page.waitForFunction(() => (document.getElementById("mtek") as HTMLCanvasElement).width === 128, undefined, { timeout: 10_000 });
    await step(page, 1);
    const back = expectBoxMatches(await captureOrThrow(page), 128, 96, "pixel ratio 1 again");
    testInfo.annotations.push({ type: "m4-dpr", description: `box width at dpr 2 / 1.5 / 1: ${String(doubled.width)} / ${String(fractional.width)} / ${String(back.width)}` });
    expect(doubled.width).toBeGreaterThan(back.width * 1.8);
    await cdp.send("Emulation.clearDeviceMetricsOverride");

    const after = await status(page);
    expect(after.state).toBe("running");
    expect(after.reported).toEqual([]);
  });

  test("a zero-sized canvas skips rendering without an error, the simulation goes on, and the same picture returns", async ({ page }) => {
    await step(page, 2);
    const before = await captureOrThrow(page);
    expectBoxMatches(before, 128, 128, "before");
    const rendered = (await status(page)).counters["framesRendered"];

    await setCanvasCssSize(page, 0, 0);
    expect(await canvasBackingSize(page)).toEqual({ width: 0, height: 0 });
    await step(page, 5);
    const hidden = await status(page);
    expect(hidden.state).toBe("running");
    expect(hidden.reported).toEqual([]);
    expect(hidden.overlayText).toBeNull();
    expect(hidden.counters["framesSkipped"]).toBe(5);
    expect(hidden.counters["framesRendered"]).toBe(rendered);
    expect("error" in (await capture(page))).toBe(true);

    await setCanvasCssSize(page, 128, 128);
    await step(page, 1);
    const returned = await captureOrThrow(page);
    expect(returned.base64, "the picture is the one the canvas had before").toBe(before.base64);
    expect(drawnPixels(returned, CLEAR)).toBeGreaterThan(100);
    const after = await status(page);
    expect(after.counters["framesRendered"]).toBe((rendered ?? 0) + 1);
    expect(after.reported).toEqual([]);
  });

  test("a hidden page pauses the frame loop and a visible one resumes it", async ({ page }) => {
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect((await status(page)).state).toBe("paused");
    const frames = (await status(page)).counters["framesRendered"];
    await step(page, 5);
    expect((await status(page)).counters["framesRendered"], "paused frames render nothing").toBe(frames);

    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect((await status(page)).state).toBe("running");
    await step(page, 2);
    expect((await status(page)).counters["framesRendered"]).toBe((frames ?? 0) + 2);
    expectBoxMatches(await captureOrThrow(page), 128, 128, "after becoming visible");
  });
});
