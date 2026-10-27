// Decision 0224: the CPU references of the composable-animation acceptance (support/animation-reference.ts), and the example's source against
// the lines and numbers the references transcribe. The references are what the browser specs trust, so they are checked here by properties
// that do not use the running engine.
import { describe, expect, it } from "vitest";
import { ANIMATION_SOURCE_LITERALS, animationConstant, animationSource } from "./animation-example.ts";
import { BLEND_LAYOUT, bendSide, boundaryPixels, compareMasks, groundHeight, legReach, minimumDrop, project, rasterMask, readSkinnedMesh, referenceBlendWeights, heroRig, rotateByQuat, type Camera, type V3 } from "./animation-reference.ts";

describe("the example's source against the references", () => {
  const source = animationSource();
  it("contains the lines the references transcribe", () => {
    for (const literal of ANIMATION_SOURCE_LITERALS) expect(source, literal).toContain(literal);
    for (const { clip, x, y } of BLEND_LAYOUT) expect(source).toContain(`animation.blend_sample(Model, "${clip}", ${x.toFixed(1)}, ${y.toFixed(1)});`);
  });
  it("has the ground function the references transcribe", () => {
    for (const piece of [
      "let strip = 1.0 - smoothstep(2.8, 3.2, abs(x));",
      "let stairs = 0.15 * smoothstep(3.35, 3.65, z) + 0.15 * smoothstep(4.35, 4.65, z);",
      "let ramp = 0.3 * clamp((z - 7.5) / 1.5, 0.0, 1.0);",
      "smoothstep(-0.05, 0.05, x)",
      "smoothstep(-0.1, 0.1, z)",
      "(1.0 - smoothstep(1.9, 2.1, z))",
      "return strip * (stairs - ramp + curb);",
      "let e = 0.05;",
    ]) expect(source, piece).toContain(piece);
  });
  it("has constants the specs read", () => {
    expect(animationConstant("FIGURE_BASE")).toBe(0.91);
    expect(animationConstant("SOLE")).toBe(0.08);
    expect(animationConstant("ARM_REACH")).toBe(0.5);
    expect(animationConstant("WAVE_FADE")).toBe(0.4);
    expect(animationConstant("FOLLOW")).toBe(0.12);
  });
  it("has colliders of the heights the ground function says (box centre plus half the size)", () => {
    // Curb: y 0.1 and 0.2 high; riser: 0.075 and 0.15; plateau: 0.15 and 0.3; the ramp's top face runs from 0.3 at z = 7.5 down to 0 at z = 9.
    expect(source).toContain("position: vec3(1.5, 0.1, 1.0);");
    expect(source).toContain("mesh: Box { size: vec3(3.0, 0.2, 2.0) };");
    expect(source).toContain("position: vec3(0.0, 0.075, 4.0);");
    expect(source).toContain("mesh: Box { size: vec3(6.0, 0.15, 1.0) };");
    expect(source).toContain("position: vec3(0.0, 0.15, 6.0);");
    expect(source).toContain("mesh: Box { size: vec3(6.0, 0.3, 3.0) };");
    expect(groundHeight(1.5, 1.0)).toBeCloseTo(0.2, 12);
    expect(groundHeight(0, 4.0)).toBeCloseTo(0.15, 12);
    expect(groundHeight(0, 6.0)).toBeCloseTo(0.3, 12);
    expect(groundHeight(0, 7.5)).toBeCloseTo(0.3, 12);
    expect(groundHeight(0, 9)).toBeCloseTo(0, 12);
    expect(groundHeight(0, -3)).toBe(0);
    expect(groundHeight(5, 6)).toBe(0);
  });
});

describe("the blend weights of the layout", () => {
  const IDLE = 0, WALK = 1, RUN = 2, LEFT = 3, RIGHT = 4;
  it("are one at every sample and zero elsewhere", () => {
    for (const [i, { x, y }] of BLEND_LAYOUT.entries()) {
      const w = referenceBlendWeights(x, y);
      expect(w[i]).toBeCloseTo(1, 12);
      expect(w.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
    }
  });
  it("are nonnegative and a partition of unity everywhere, including far outside the hull", () => {
    for (let k = 0; k < 2000; k += 1) {
      const x = ((k * 7919) % 1000) / 250 - 2, y = ((k * 104729) % 1000) / 250 - 1;
      const w = referenceBlendWeights(x, y);
      expect(Math.min(...w)).toBeGreaterThanOrEqual(0);
      expect(w.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
    }
  });
  it("interpolate linearly along every hull edge and along the line through idle (the 1D cases)", () => {
    expect(referenceBlendWeights(0, 0.5)).toEqual([expect.closeTo(0.5, 12), expect.closeTo(0.5, 12), 0, 0, 0]);
    expect(referenceBlendWeights(0, 1.75)[WALK]).toBeCloseTo(0.25, 12);
    expect(referenceBlendWeights(0.5, 0)[RIGHT]).toBeCloseTo(0.5, 12);
    expect(referenceBlendWeights(-0.25, 0)[LEFT]).toBeCloseTo(0.25, 12);
    // Edge RIGHT-RUN: the point at one quarter of the way.
    const edge = referenceBlendWeights(0.75, 0.5);
    expect(edge[RIGHT]).toBeCloseTo(0.75, 12);
    expect(edge[RUN]).toBeCloseTo(0.25, 12);
  });
  it("clamp to the nearest hull point outside", () => {
    // (1, 1) is outside the hull; its nearest point on the edge RIGHT-RUN is (0.6, 0.8).
    const a = referenceBlendWeights(1, 1), b = referenceBlendWeights(0.6, 0.8);
    for (let i = 0; i < 5; i += 1) expect(a[i]).toBeCloseTo(b[i]!, 12);
    expect(referenceBlendWeights(0, -3)).toEqual(referenceBlendWeights(0, 0));
    expect(referenceBlendWeights(0, 9)[RUN]).toBeCloseTo(1, 12);
    expect(referenceBlendWeights(0.5, 0.5)[IDLE]).toBeCloseTo(0, 12);
  });
  it("are continuous: a tenth of the step gives a tenth of the change, through vertices, edges and the hull", () => {
    const path = (t: number): [number, number] => [-1.5 + 3 * t, 2.4 - 2.6 * t];
    const change = (h: number): number => {
      let worst = 0;
      for (let t = 0; t < 1 - h; t += 0.013) {
        const a = referenceBlendWeights(...path(t)), b = referenceBlendWeights(...path(t + h));
        worst = Math.max(worst, ...a.map((v, i) => Math.abs(v - b[i]!)));
      }
      return worst;
    };
    expect(change(1e-4) / change(1e-3)).toBeLessThan(0.15);
    expect(change(1e-3) / change(1e-2)).toBeLessThan(0.15);
  });
});

describe("the minimum hips drop", () => {
  const hip: V3 = [0, 1, 0];
  const reach = legReach(hip, [0, 0.55, 0.1], [0, 0.1, 0]);
  it("is zero when the target is within the exact reach and otherwise puts the target on the limit", () => {
    expect(minimumDrop(hip, [0, 0.3, 0], reach)).toBe(0);
    for (const y of [0.1, 0, -0.2, -0.5]) {
      const target: V3 = [0.05, y, 0.1];
      const drop = minimumDrop(hip, target, reach);
      const d = Math.hypot(target[0] - hip[0], target[1] - (hip[1] - drop), target[2] - hip[2]);
      if (drop > 0) expect(d).toBeCloseTo(reach.cmax - reach.w, 9);
      else expect(d).toBeLessThanOrEqual(reach.cmax - reach.w + 1e-12);
    }
  });
  it("is the smallest drop: a smaller one leaves the target out of reach (brute force)", () => {
    const target: V3 = [0.05, -0.1, 0.1];
    const drop = minimumDrop(hip, target, reach);
    expect(drop).toBeGreaterThan(0);
    let found = Infinity;
    for (let d = 0; d < 1; d += 1e-5) {
      if (Math.hypot(target[0] - hip[0], target[1] - (hip[1] - d), target[2] - hip[2]) <= reach.cmax - reach.w) { found = d; break; }
    }
    expect(drop).toBeCloseTo(found, 4);
  });
  it("has the reach of a two-bone leg: cmax is the sum of the chords, cmin the chord at 150 degrees", () => {
    expect(reach.cmax).toBeCloseTo(reach.a + reach.b, 12);
    expect(reach.cmin).toBeCloseTo(Math.sqrt(reach.a ** 2 + reach.b ** 2 + 2 * reach.a * reach.b * Math.cos((150 * Math.PI) / 180)), 12);
    expect(reach.w).toBeCloseTo(0.05 * (reach.cmax - reach.cmin), 12);
  });
});

describe("bendSide, rotations, the camera and the rasteriser", () => {
  it("is positive for a knee in front of the hip-ankle line and negative behind it", () => {
    expect(bendSide([0, 1, 0], [0, 0.5, 0.1], [0, 0, 0], [0, 0, 1])).toBeCloseTo(0.1, 12);
    expect(bendSide([0, 1, 0], [0, 0.5, -0.1], [0, 0, 0], [0, 0, 1])).toBeCloseTo(-0.1, 12);
  });
  it("rotates by a unit quaternion", () => {
    const q = { x: 0, y: Math.sin(0.3), z: 0, w: Math.cos(0.3) };
    const v = rotateByQuat(q, [0, 0, 1]);
    expect(v[0]).toBeCloseTo(Math.sin(0.6), 12);
    expect(v[2]).toBeCloseTo(Math.cos(0.6), 12);
  });
  const camera: Camera = { eye: [0, 0, 0], target: [0, 0, 1], fovY: 0.8, width: 200, height: 100 };
  it("projects the target to the middle of the picture, with +Y up and, looking along +Z, +X to the left", () => {
    const c = project(camera, [0, 0, 5]);
    expect([c.x, c.y, c.depth]).toEqual([100, 50, 5]);
    expect(project(camera, [0, 1, 5]).y).toBeLessThan(50);
    expect(project(camera, [1, 0, 5]).x).toBeLessThan(100);
    // The vertical field of view: a point at the edge of the picture.
    expect(project(camera, [0, 5 * Math.tan(0.4), 5]).y).toBeCloseTo(0, 9);
  });
  it("rasterises the pixels whose centres a triangle covers", () => {
    const wide: Camera = { ...camera, fovY: 1, width: 20, height: 20 };
    const t = Math.tan(0.5);
    // A triangle covering the right half of the picture below the diagonal, at depth 1 (positive x is on the left).
    const mask = rasterMask(wide, [-t, -t, 1, -t, t, 1, t, -t, 1], [0, 1, 2]);
    const set = mask.reduce((s, v) => s + v, 0);
    expect(set).toBeGreaterThan(190);
    expect(set).toBeLessThanOrEqual(210);
    expect(boundaryPixels(mask, 20, 20)).toBeGreaterThan(30);
    const same = compareMasks(mask, mask, 20, 20);
    expect(same.difference).toBe(0);
    expect(same.iou).toBe(1);
    expect(same.centroidShift).toBe(0);
    const empty = compareMasks(mask, new Uint8Array(400), 20, 20);
    expect(empty.iou).toBe(0);
  });
  it("reads the mesh of the Hero's model", () => {
    const mesh = readSkinnedMesh(heroRig().bytes);
    expect(mesh.positions.length).toBe(mesh.joints.length * 3);
    expect(mesh.indices.length).toBeGreaterThan(1000);
  });
});
