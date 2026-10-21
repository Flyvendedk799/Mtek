// Translucent draws (decision 0138): which materials can blend, the blended pipeline and the back-to-front order.
import { describe, expect, it } from "vitest";

import { ALPHA_BLEND, canBlend } from "./pipelines.js";
import { TRANSLUCENT_KEY_PREFIX, compareDraws, orderTranslucent, type DrawItem } from "./renderer.js";

const draw = (entity: number, translucent: boolean, order = entity): DrawItem =>
  ({ pipelineKey: translucent ? `${TRANSLUCENT_KEY_PREFIX}k` : "k", instance: 0, mesh: 0, entity, order, ...(translucent ? { translucent: true } : {}) }) as unknown as DrawItem;

// A view-projection whose clip w is -z (a camera at the origin looking down -Z), column-major.
const viewProj = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0]);

describe("translucent draws (decision 0138)", () => {
  it("blend only materials with a colour param", () => {
    expect(canBlend({ params: [{ name: "color", type: "color" }] })).toBe(true);
    expect(canBlend({ params: [{ name: "base_color", type: "color" }, { name: "metallic", type: "f32" }] })).toBe(true);
    expect(canBlend({ params: [{ name: "tint", type: "color" }] })).toBe(true);
    expect(canBlend({ params: [{ name: "metallic", type: "f32" }] })).toBe(false);
    expect(canBlend({ params: [{ name: "color", type: "vec4" }] })).toBe(false);
  });

  it("use straight-alpha over blending", () => {
    expect(ALPHA_BLEND.color).toEqual({ srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" });
  });

  it("sort after every opaque draw", () => {
    const sorted = [draw(0, true), draw(1, false), draw(2, false)].sort(compareDraws);
    expect(sorted.map((d) => d.entity)).toEqual([1, 2, 0]);
  });

  it("are drawn back to front, ties in draw-list order, opaque draws untouched", () => {
    // Entity e sits at z = -centre[e]: entity 1 is the farthest.
    const centres = new Float32Array([0, 0, -1, 0, 0, -9, 0, 0, -5, 0, 0, -5]);
    const draws = [draw(9, false), draw(0, true), draw(1, true), draw(2, true), draw(3, true)];
    const centresWithOpaque = new Float32Array(30);
    centresWithOpaque.set(centres);
    expect(orderTranslucent(draws, viewProj, centresWithOpaque).map((d) => d.entity)).toEqual([9, 1, 2, 3, 0]);
  });

  it("leave a frame without translucent draws as it is", () => {
    const draws = [draw(0, false), draw(1, false)];
    expect(orderTranslucent(draws, viewProj, new Float32Array(6))).toBe(draws);
  });
});
