import { describe, expect, it } from "vitest";
import { identity } from "../math/mat4.js";
import { animatedSkin } from "../test-support/animated-skin.js";
import { deformSkin } from "./skinning.js";
import { SkinBounds } from "./skin-bounds.js";

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
