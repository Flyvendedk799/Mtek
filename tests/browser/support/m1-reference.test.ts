// The CPU reference of the M1 pixel assertions, checked against hand-derived values.
import { describe, expect, it } from "vitest";
import {
  expectPixel,
  expectedRgb8,
  invert,
  multiply,
  projectedCentre,
  projectionMatrix,
  quatEuler,
  rotation,
  transform4,
  transformPoint,
  viewMatrix,
  type Mat4,
  type Vec3,
} from "./m1-reference.ts";
import { SCENE_A, SCENE_A_MOVED, SCENE_B } from "./m1-scenes.ts";

function expectClose(actual: readonly number[], expected: readonly number[], digits = 9): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value, `index ${String(index)}`).toBeCloseTo(expected[index] ?? NaN, digits));
}

describe("matrices (spec/runtime-abi.md section 8.3)", () => {
  it("the look-at view puts the target straight ahead on −Z and keeps +Y up", () => {
    const view = viewMatrix({ position: [0, 2, 6], target: [0, 0.5, 0], projection: { kind: "perspective", fovY: 0.9, near: 0.1, far: 1000 } });
    const target = transformPoint(view, [0, 0.5, 0]);
    expectClose(target, [0, 0, -Math.hypot(1.5, 6)]);
    expectClose(transformPoint(view, [0, 2, 6]), [0, 0, 0]);
    // A point above the target is above it on screen (positive view-space y).
    expect(transformPoint(view, [0, 1.5, 0])[1]).toBeGreaterThan(0);
  });

  it("a camera looking straight down along −Y switches to the −Z up vector", () => {
    const view = viewMatrix({ position: [0, 10, 0], target: [0, 0, 0], projection: { kind: "perspective", fovY: 1, near: 0.1, far: 100 } });
    expectClose(transformPoint(view, [0, 0, -1]), [0, 1, -10]);
  });

  it("both projections map z = −near to depth 0 and z = −far to depth 1", () => {
    for (const projection of [
      { kind: "perspective", fovY: 0.9, near: 0.1, far: 1000 },
      { kind: "orthographic", height: 20, near: 0.5, far: 40 },
    ] as const) {
      const p = projectionMatrix(projection, 1.6);
      expect(transformPoint(p, [0, 0, -projection.near])[2]).toBeCloseTo(0, 9);
      expect(transformPoint(p, [0, 0, -projection.far])[2]).toBeCloseTo(1, 9);
    }
    // Orthographic: x' = 2x / (h · a), y' = 2y / h.
    expectClose(transformPoint(projectionMatrix({ kind: "orthographic", height: 20, near: 0.5, far: 40 }, 1.6), [8, 5, -1]).slice(0, 2), [0.5, 0.5]);
  });

  it("invert is the inverse of multiply", () => {
    const m: Mat4 = multiply(projectionMatrix({ kind: "perspective", fovY: 0.9, near: 0.1, far: 1000 }, 1), viewMatrix(SCENE_A.camera));
    expectClose(multiply(invert(m), m), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });
});

describe("quat.euler (spec/language.md section 5.4)", () => {
  it("euler(−π/2, 0, 0) is the rotation the compiler folds for fixture B", () => {
    // The golden app.js of codegen fixture B sets rotation { x: -0.7071067690849304, y: 0, z: 0, w: 0.7071067690849304 }.
    expectClose(quatEuler(-1.5707964, 0, 0), [-0.7071067690849304, 0, 0, 0.7071067690849304], 7);
  });

  it("rotates about Z first, then X, then Y (fixed axes)", () => {
    const apply = (v: Vec3): number[] => transform4(rotation(quatEuler(Math.PI / 2, Math.PI / 2, Math.PI / 2)), v, 0).slice(0, 3);
    // +X: about Z → +Y; about X → +Z; about Y → +X.
    expectClose(apply([1, 0, 0]), [1, 0, 0]);
    // +Y: about Z → −X; about X → −X; about Y → +Z.
    expectClose(apply([0, 1, 0]), [0, 0, 1]);
  });
});

describe("colours", () => {
  it("an sRGB literal decoded to linear and re-encoded by an -srgb target is the literal's bytes", () => {
    expect(expectedRgb8("#6b5cff")).toEqual([0x6b, 0x5c, 0xff]);
    expect(expectedRgb8("#202830")).toEqual([0x20, 0x28, 0x30]);
    expect(expectedRgb8("#3a5f3a")).toEqual([0x3a, 0x5f, 0x3a]);
    expect(() => expectedRgb8("#ffcc0080")).toThrow();
  });
});

describe("expected pixels of the M1 scenes", () => {
  it("A: the box centre (the camera target) projects to the target centre and shows the box", () => {
    const centre = projectedCentre(SCENE_A, 0);
    expectClose([centre.x, centre.y], [64, 64]);
    expect(expectPixel(SCENE_A, 64, 64)).toEqual({ kind: "entity", index: 0 });
    expect(expectPixel(SCENE_A, 2, 2)).toEqual({ kind: "clear" });
  });

  it("A-moved: the box moves right and up on screen; the old centre shows the clear colour", () => {
    const moved = projectedCentre(SCENE_A_MOVED, 0);
    expect(moved.x).toBeGreaterThan(64 + 20);
    expect(moved.y).toBeLessThan(64 - 10);
    expect(expectPixel(SCENE_A_MOVED, 64, 64)).toEqual({ kind: "clear" });
    expect(expectPixel(SCENE_A_MOVED, Math.floor(moved.x), Math.floor(moved.y))).toEqual({ kind: "entity", index: 0 });
  });

  it("B: orthographic, screen-up is −Z; the fountain hides the ground's centre; clear bands left and right", () => {
    const [ground, fountain, lamp] = [0, 1, 2].map((index) => projectedCentre(SCENE_B, index));
    expectClose([ground?.x ?? NaN, ground?.y ?? NaN], [128, 80], 3); // the angle is the f32 nearest to −π/2
    expectClose([fountain?.x ?? NaN, fountain?.y ?? NaN], [128, 80], 3);
    // x = 4 → 4 · 256 / 32 px right of the centre; z = 4 → 4 · 160 / 20 px below it.
    expectClose([lamp?.x ?? NaN, lamp?.y ?? NaN], [160, 112], 3);
    expect(expectPixel(SCENE_B, 128, 80)).toEqual({ kind: "entity", index: 1 });
    expect(expectPixel(SCENE_B, 160, 112)).toEqual({ kind: "entity", index: 2 });
    expect(expectPixel(SCENE_B, 80, 20)).toEqual({ kind: "entity", index: 0 });
    expect(expectPixel(SCENE_B, 10, 80)).toEqual({ kind: "clear" });
    expect(expectPixel(SCENE_B, 250, 150)).toEqual({ kind: "clear" });
  });

  it("pixels on a silhouette edge are ambiguous and never asserted", () => {
    // The plane's left edge is x = −10 → pixel column 128 − 10 · 8 = 48.
    expect(expectPixel(SCENE_B, 48, 40)).toEqual({ kind: "ambiguous" });
    expect(expectPixel(SCENE_B, 47, 40)).toEqual({ kind: "ambiguous" });
    // The fountain's rim (radius 2 → 16 px).
    expect(expectPixel(SCENE_B, 128 + 16, 80)).toEqual({ kind: "ambiguous" });
  });
});
