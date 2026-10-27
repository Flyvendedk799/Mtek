import { describe, expect, it } from "vitest";
import { fromRotationTranslationScale, identity, multiply } from "../math/mat4.js";
import { animatedSkin } from "../test-support/animated-skin.js";
import { deformSkin } from "./skinning.js";
import { SkinBounds, skinWorldScale } from "./skin-bounds.js";

it("expands authored spheres conservatively under inherited nonuniform scale and shear", () => {
  const zero = { x: 0, y: 0, z: 0 }, one = { x: 1, y: 1, z: 1 };
  const parent = fromRotationTranslationScale({ x: 0, y: 0, z: 0, w: 1 }, zero, { x: 6, y: 0.2, z: 1 });
  const child = fromRotationTranslationScale({ x: 0, y: 0, z: Math.sin(Math.PI / 8), w: Math.cos(Math.PI / 8) }, zero, one);
  const model = multiply(parent, child), expansion = skinWorldScale(model);
  const longestColumn = Math.max(...[0, 4, 8].map(i => Math.hypot(model[i]!, model[i + 1]!, model[i + 2]!)));
  let observed = 0;
  for (let azimuth = 0; azimuth < 64; azimuth++) for (let elevation = -4; elevation <= 4; elevation++) {
    const a = azimuth * Math.PI / 32, e = elevation * Math.PI / 8;
    const x = Math.cos(a) * Math.cos(e), y = Math.sin(a) * Math.cos(e), z = Math.sin(e);
    const length = Math.hypot(model[0]! * x + model[4]! * y + model[8]! * z, model[1]! * x + model[5]! * y + model[9]! * z, model[2]! * x + model[6]! * y + model[10]! * z);
    expect(length).toBeLessThanOrEqual(expansion + 1e-10);
    observed = Math.max(observed, length);
  }
  expect(observed).toBeGreaterThan(longestColumn + 1); // Basis-column scaling alone would cull too aggressively.
});

describe("conservative animated bounds", () => {
  it("matches an independent eight-corner oracle under reflected affine shear", () => {
    const base = animatedSkin();
    const positions = new Float32Array([-3, 2, 1, 4, -2, -5, 1, 7, 3]);
    const skin = { ...base, indices: base.indices.map(() => [0, 0, 0, 0]), weights: base.weights.map(() => [1, 0, 0, 0]) };
    const bounds = new SkinBounds(skin, positions), center: [number, number, number] = [0, 0, 0];
    for (let frame = 0; frame < 40; frame++) {
      const palette = new Float32Array(48), matrix = identity();
      matrix[0] = -1.3; matrix[1] = Math.sin(frame); matrix[4] = 0.7; matrix[5] = 2.1;
      matrix[8] = 0.2; matrix[9] = -0.9; matrix[10] = 0.4; matrix[12] = frame * 3;
      palette.set(matrix);
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let corner = 0; corner < 8; corner++) {
        const point = [corner & 1 ? 4 : -3, corner & 2 ? 7 : -2, corner & 4 ? 3 : -5];
        for (let row = 0; row < 3; row++) {
          const value = matrix[row]! * point[0]! + matrix[4+row]! * point[1]! + matrix[8+row]! * point[2]! + matrix[12+row]!;
          lo[row] = Math.min(lo[row]!, value); hi[row] = Math.max(hi[row]!, value);
        }
      }
      const radius = bounds.sphere(palette, center);
      for (let axis = 0; axis < 3; axis++) expect(center[axis]).toBeCloseTo((lo[axis]! + hi[axis]!) / 2, 10);
      const expected = Math.hypot(hi[0]!-lo[0]!,hi[1]!-lo[1]!,hi[2]!-lo[2]!) / 2 + Math.max(1,...lo.map(Math.abs),...hi.map(Math.abs)) * 0.002;
      expect(radius).toBeCloseTo(expected, 10);
    }
  });
  it("encloses deformed vertices under weighted translations, rotations, scale, shear and weight tolerance", () => {
    const base = animatedSkin(),
      skin = {
        ...base,
        weights: base.weights.map((w) => w.map((v) => v * 0.9991)),
      };
    const positions = new Float32Array([2, 1, -1, 3, -2, 1, -1, 4, 0]),
      bounds = new SkinBounds(skin, positions);
    const out = new Float32Array(9),
      normals = new Float32Array(9),
      center: [number, number, number] = [0, 0, 0];
    for (let frame = 0; frame < 100; frame++) {
      const palette = new Float32Array(48);
      for (let j = 0; j < 3; j++) {
        const m = identity(),
          angle = frame * 0.1 + j;
        m[0] = Math.cos(angle) * 2;
        m[1] = Math.sin(angle) * 2;
        m[4] = -Math.sin(angle);
        m[5] = Math.cos(angle);
        m[8] = 0.8;
        m[12] = frame + j * 30;
        m[13] = -frame * 0.3;
        m[14] = j * 2;
        palette.set(m, j * 16);
      }
      const radius = bounds.sphere(palette, center);
      deformSkin(skin, palette, positions, undefined, out, normals);
      expect(Number.isFinite(radius)).toBe(true);
      for (let v = 0; v < 3; v++)
        expect(
          Math.hypot(
            out[v * 3]! - center[0],
            out[v * 3 + 1]! - center[1],
            out[v * 3 + 2]! - center[2],
          ),
        ).toBeLessThanOrEqual(radius);
    }
  });
});
