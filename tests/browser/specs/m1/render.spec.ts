// M1 exit gate (task M1-21): checked-in Mtek sources, built from source by the CLI in global setup, render
// through WebGPU, and the output follows the declared scene. Every assertion reads back the offscreen
// `rgba8unorm-srgb` target (spec/testing.md section 6.3); nothing is a screenshot. Expected pixels come
// from the independent CPU reference (support/m1-reference.ts) with the matrices of
// spec/runtime-abi.md section 8.3.
import type { TestInfo } from "@playwright/test";
import { expect, test } from "../../support/fixtures.ts";
import { expectPixel, expectedColour, expectedRgb8, projectedCentre, type SceneSpec } from "../../support/m1-reference.ts";
import { SCENE_A, SCENE_A_MOVED, SCENE_A_RENAMED, SCENE_B } from "../../support/m1-scenes.ts";
import { mountAndCapture, rgbAt, rgbClose, type Capture } from "./support.ts";

/** Grid of sample points: every GRID_STRIDE pixels, starting GRID_STRIDE / 2 in. */
const GRID_STRIDE = 4;

function note(testInfo: TestInfo, description: string): void {
  testInfo.annotations.push({ type: "m1-pixel", description });
}

function describeSceneChecks(scene: SceneSpec, title: string): void {
  test(`${title}: entity centres show their Unlit colour and points outside every silhouette the clear colour`, async ({ page }, testInfo) => {
    const capture = await mountAndCapture(page, scene.fixture, scene.renderTarget);
    expect(capture).toMatchObject({ ...scene.renderTarget, format: "rgba8unorm-srgb" });
    expect(capture.data.length).toBe(scene.renderTarget.width * scene.renderTarget.height * 4);
    expect(capture.reported, "no runtime diagnostics").toEqual([]);
    expect(capture.overlayPresent).toBe(false);
    expect(capture.counters["drawCalls"], "one draw per entity").toBe(scene.entities.length);

    // The world holds the declared transforms (names come from the manifest, not from the runtime).
    expect(capture.entities.map((entity) => entity.name)).toEqual(scene.entities.map((entity) => entity.name));
    capture.entities.forEach((entity, index) => {
      const declared = scene.entities[index]?.position ?? [NaN, NaN, NaN];
      expect(entity.position).toEqual({ x: declared[0], y: declared[1], z: declared[2] });
    });

    // 1. The projected centre of every entity: the front-most entity there (the entity itself, or the one
    //    that hides it) must be drawn in its Unlit colour.
    for (const [index, entity] of scene.entities.entries()) {
      const centre = projectedCentre(scene, index);
      const px = Math.floor(centre.x);
      const py = Math.floor(centre.y);
      const expectation = expectPixel(scene, px, py);
      expect(expectation.kind, `${entity.name}: the centre pixel is robust`).toBe("entity");
      const expected = expectedColour(scene, expectation);
      const actual = rgbAt(capture, px, py);
      const shown = expectation.kind === "entity" ? (scene.entities[expectation.index]?.name ?? "?") : expectation.kind;
      note(
        testInfo,
        `${scene.fixture}: ${entity.name} centre projects to (${centre.x.toFixed(2)}, ${centre.y.toFixed(2)}) -> pixel (${String(px)}, ${String(py)}) shows ${shown}: expected rgb(${expected.join(",")}) actual rgb(${actual.join(",")})`,
      );
      expect(rgbClose(actual, expected), `${entity.name} centre (${String(px)}, ${String(py)}): ${actual.join(",")} vs ${expected.join(",")}`).toBe(true);
    }

    // 2. A grid over the whole target: every robust sample point matches the reference, which includes
    //    the clear colour wherever no silhouette is (rays at +-1.5 px all miss).
    const mismatches: string[] = [];
    const counts = new Map<string, number>();
    let ambiguous = 0;
    for (let y = GRID_STRIDE / 2; y < scene.renderTarget.height; y += GRID_STRIDE) {
      for (let x = GRID_STRIDE / 2; x < scene.renderTarget.width; x += GRID_STRIDE) {
        const expectation = expectPixel(scene, x, y);
        if (expectation.kind === "ambiguous") {
          ambiguous += 1;
          continue;
        }
        const key = expectation.kind === "clear" ? "clear" : (scene.entities[expectation.index]?.name ?? "?");
        counts.set(key, (counts.get(key) ?? 0) + 1);
        const expected = expectedColour(scene, expectation);
        const actual = rgbAt(capture, x, y);
        if (!rgbClose(actual, expected)) mismatches.push(`(${String(x)}, ${String(y)}) ${key}: ${actual.join(",")} vs ${expected.join(",")}`);
      }
    }
    note(
      testInfo,
      `${scene.fixture}: grid samples ${[...counts].map(([key, count]) => `${key} ${String(count)}`).join(", ")}, edge (not asserted) ${String(ambiguous)}; clear rgb(${expectedRgb8(scene.clearColor).join(",")})`,
    );
    expect(mismatches, "grid samples that differ from the CPU reference").toEqual([]);
    expect(counts.get("clear") ?? 0, "clear-colour samples outside every silhouette").toBeGreaterThanOrEqual(50);
  });
}

/** Pixels whose colour is the given RGB (±2/255), with their centroid. */
function footprint(capture: Capture, rgb: readonly number[]): { count: number; x: number; y: number } {
  let count = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < capture.height; y += 1) {
    for (let x = 0; x < capture.width; x += 1) {
      if (!rgbClose(rgbAt(capture, x, y), rgb)) continue;
      count += 1;
      sx += x + 0.5;
      sy += y + 0.5;
    }
  }
  return { count, x: sx / count, y: sy / count };
}

test.describe("M1 scenes compiled by the CLI render through WebGPU", () => {
  test.beforeEach(({ gpu }) => {
    void gpu;
  });

  describeSceneChecks(SCENE_A, "A (perspective camera with a target, one Box)");
  describeSceneChecks(SCENE_B, "B (orthographic camera with a rotation, Plane + nested scaled Sphere + Sphere, module constants)");

  test("changing A's declared position moves the box's pixel footprint in the direction the CPU projection predicts", async ({ page }, testInfo) => {
    const before = await mountAndCapture(page, SCENE_A.fixture, SCENE_A.renderTarget);
    const after = await mountAndCapture(page, SCENE_A_MOVED.fixture, SCENE_A_MOVED.renderTarget);
    const boxColour = expectedRgb8(SCENE_A.entities[0]?.color ?? "");
    const a = footprint(before, boxColour);
    const b = footprint(after, boxColour);
    const predictedFrom = projectedCentre(SCENE_A, 0);
    const predictedTo = projectedCentre(SCENE_A_MOVED, 0);
    const predicted = { x: predictedTo.x - predictedFrom.x, y: predictedTo.y - predictedFrom.y };
    const measured = { x: b.x - a.x, y: b.y - a.y };
    note(
      testInfo,
      `A footprint ${String(a.count)} px centroid (${a.x.toFixed(2)}, ${a.y.toFixed(2)}); A-moved footprint ${String(b.count)} px centroid (${b.x.toFixed(2)}, ${b.y.toFixed(2)}); measured shift (${measured.x.toFixed(2)}, ${measured.y.toFixed(2)}) px, CPU-predicted centre shift (${predicted.x.toFixed(2)}, ${predicted.y.toFixed(2)}) px`,
    );
    expect(a.count).toBeGreaterThan(100);
    expect(b.count).toBeGreaterThan(100);
    // The output changed, and in the predicted direction along both axes.
    expect(Math.abs(predicted.x)).toBeGreaterThan(10);
    expect(Math.abs(predicted.y)).toBeGreaterThan(10);
    expect(Math.sign(measured.x)).toBe(Math.sign(predicted.x));
    expect(Math.sign(measured.y)).toBe(Math.sign(predicted.y));
    // By about the predicted distance (a box's centroid is not exactly its projected centre in perspective).
    const error = Math.hypot(measured.x - predicted.x, measured.y - predicted.y);
    expect(error, "centroid shift vs predicted shift (px)").toBeLessThan(0.2 * Math.hypot(predicted.x, predicted.y));

    // Where the box was is now the clear colour; where the reference puts it is the box colour.
    const oldPixel = [Math.floor(predictedFrom.x), Math.floor(predictedFrom.y)] as const;
    const newPixel = [Math.floor(predictedTo.x), Math.floor(predictedTo.y)] as const;
    expect(expectPixel(SCENE_A_MOVED, ...oldPixel)).toEqual({ kind: "clear" });
    expect(expectPixel(SCENE_A_MOVED, ...newPixel)).toEqual({ kind: "entity", index: 0 });
    expect(rgbClose(rgbAt(after, ...oldPixel), expectedRgb8(SCENE_A.clearColor)), `old centre ${rgbAt(after, ...oldPixel).join(",")}`).toBe(true);
    expect(rgbClose(rgbAt(after, ...newPixel), boxColour), `new centre ${rgbAt(after, ...newPixel).join(",")}`).toBe(true);
    expect(rgbClose(rgbAt(before, ...newPixel), expectedRgb8(SCENE_A.clearColor)), "the new centre was clear before").toBe(true);
  });

  test("renaming A's scene, camera and entity changes nothing in the output (no name-dependent paths)", async ({ page }) => {
    const original = await mountAndCapture(page, SCENE_A.fixture, SCENE_A.renderTarget);
    const renamed = await mountAndCapture(page, SCENE_A_RENAMED.fixture, SCENE_A_RENAMED.renderTarget);
    expect(renamed.entities.map((entity) => entity.name)).toEqual(["Parcel"]);
    expect(renamed.reported).toEqual([]);
    expect(renamed.counters["drawCalls"]).toBe(original.counters["drawCalls"]);
    expect(Buffer.from(renamed.data).equals(Buffer.from(original.data)), "byte-identical readback").toBe(true);
  });
});
