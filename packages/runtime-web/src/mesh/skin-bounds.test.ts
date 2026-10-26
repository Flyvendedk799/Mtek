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
