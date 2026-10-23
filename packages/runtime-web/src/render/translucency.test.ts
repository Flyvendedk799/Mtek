// Translucent draws (decision 0138): which materials can blend, the blended pipeline and the back-to-front order.
import { describe, expect, it } from "vitest";

import { ALPHA_BLEND, canBlend } from "./pipelines.js";
import { orthographic, perspective, viewMatrix } from "../math/mat4.js";
import { TRANSLUCENT_KEY_PREFIX, TranslucentOrder, compareDraws, type DrawItem } from "./renderer.js";

const draw = (entity: number, translucent: boolean, order = entity): DrawItem =>
  ({ pipelineKey: translucent ? `${TRANSLUCENT_KEY_PREFIX}k` : "k", instance: 0, mesh: 0, entity, order, ...(translucent ? { translucent: true } : {}) }) as unknown as DrawItem;

// A camera at the origin looking down -Z: view-space z is world z.
const view = viewMatrix({ x: 0, y: 0, z: 0 }, { rotation: { x: 0, y: 0, z: 0, w: 1 } });

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
    const centres = new Float32Array(30);
    centres.set([0, 0, -1, 0, 0, -9, 0, 0, -5, 0, 0, -5]);
    const draws = [draw(9, false), draw(0, true), draw(1, true), draw(2, true), draw(3, true)];
    expect(new TranslucentOrder().order(draws, view, centres).map((d) => d.entity)).toEqual([9, 1, 2, 3, 0]);
  });

  it("are ordered by depth under an orthographic projection, where clip w is 1 everywhere", () => {
    // The camera looks from z = 10 towards the origin; entity 1 is the farthest, entity 2 the nearest. Declared nearest first.
    const eye = viewMatrix({ x: 0, y: 0, z: 10 }, { target: { x: 0, y: 0, z: 0 } });
    const ortho = orthographic(10, 1, 0.1, 100);
    expect(ortho[11]).toBe(0); // no perspective divide: w is constant
    const centres = new Float64Array([0, 0, 0, 0, 0, -3, 0, 0, 2]);
    const draws = [draw(2, true), draw(0, true), draw(1, true)];
    expect(new TranslucentOrder().order(draws, eye, centres).map((d) => d.entity)).toEqual([1, 0, 2]);
  });

  it("are ordered by depth under a perspective projection and a camera that is not on an axis", () => {
    const eye = viewMatrix({ x: 5, y: 5, z: 5 }, { target: { x: 0, y: 0, z: 0 } });
    expect(perspective(1, 1, 0.1, 100)[11]).toBe(-1);
    // Depth along the view direction, not distance from the eye: entity 2 is farther from the eye than entity 0 but nearer in depth.
    const centres = new Float64Array([1, 1, 1, -2, -2, -2, 8, 0, 0, 0, 0, 0]);
    const draws = [draw(0, true), draw(2, true), draw(1, true)];
    expect(new TranslucentOrder().order(draws, eye, centres).map((d) => d.entity)).toEqual([1, 0, 2]);
  });

  it("keep the same array and say so while the order does not change (decision 0173)", () => {
    const centres = new Float64Array([0, 0, -1, 0, 0, -9, 0, 0, -5]);
    const draws = [draw(0, true), draw(1, true), draw(2, true)];
    const orderer = new TranslucentOrder();
    const first = orderer.order(draws, view, centres);
    expect(orderer.unchanged).toBe(false);
    const second = orderer.order(draws, view, centres);
    expect(second).toBe(first);
    expect(orderer.unchanged).toBe(true);
    // Entity 0 moves behind entity 1: the order changes, the array does not.
    centres[2] = -20;
    expect(orderer.order(draws, view, centres)).toBe(first);
    expect(orderer.unchanged).toBe(false);
    expect(first.map((d) => d.entity)).toEqual([0, 1, 2]);
    expect(orderer.order(draws, view, centres)).toBe(first);
    expect(orderer.unchanged).toBe(true);
  });

  it("leave a frame without translucent draws as it is", () => {
    const draws = [draw(0, false), draw(1, false)];
    expect(new TranslucentOrder().order(draws, view, new Float32Array(6))).toBe(draws);
  });
});

describe("sprites (decision 0170)", () => {
  it("the built-in Sprite material always blends", async () => {
    const { alwaysBlends, SPRITE_MATERIAL } = await import("./pipelines.js");
    expect(alwaysBlends({ id: SPRITE_MATERIAL })).toBe(true);
    expect(alwaysBlends({ id: "std/materials.mtek::Unlit" })).toBe(false);
  });
});
