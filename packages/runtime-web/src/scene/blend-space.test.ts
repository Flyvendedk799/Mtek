import { describe, expect, it } from "vitest";
import type { MtekSkin } from "../abi/manifest-types.js";
import { animatedSkin } from "../test-support/animated-skin.js";
import { createAnimationController } from "../animation.js";
import { blendWeights, MAX_BLEND_SAMPLES } from "./blend-space.js";
import { SkeletonPlayer } from "./skeleton.js";

type Point = readonly [number, number];
function random(seed: number): () => number {
  let state = seed;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
}
const grid = (n: number): Point[] => Array.from({ length: n * n }, (_, i) => [i % n, Math.floor(i / n)] as Point);
const scattered = (count: number, seed: number): Point[] => { const r = random(seed); return Array.from({ length: count }, () => [r() * 6, r() * 4] as Point); };
const sets: Record<string, Point[]> = {
  triangle: [[0, 0], [4, 0], [0, 4]],
  grid3: grid(3),
  grid5: grid(5),
  hexagon: [[0, 0], ...Array.from({ length: 6 }, (_, i) => [Math.cos(i * Math.PI / 3), Math.sin(i * Math.PI / 3)] as Point)],
  hullEdge: [[0, 0], [1, 0], [2, 0], [3, 0], [1, 2], [2.5, 3], [0, 3]],
  scattered: scattered(12, 7),
  scatteredMany: scattered(MAX_BLEND_SAMPLES, 99),
  directions: [[0, 0], [2, 0], [4, 0], [2, 3], [2, -3], [-1.5, 0.5]],
};
const weightsAt = (solve: ReturnType<typeof blendWeights>, n: number, x: number, y: number): number[] => {
  const out = new Float64Array(n); solve(x, y, out); return [...out];
};
const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

describe("blend weights", () => {
  for (const [name, points] of Object.entries(sets)) describe(name, () => {
    const solve = blendWeights(points), n = points.length;
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs) - 2, Math.max(...xs) + 2, Math.min(...ys) - 2, Math.max(...ys) + 2];
    it("is a nonnegative partition of unity, inside and outside the hull, and deterministic", () => {
      const r = random(5), again = blendWeights(points);
      for (let i = 0; i < 400; i++) {
        const x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0), w = weightsAt(solve, n, x, y);
        expect(Math.abs(sum(w) - 1)).toBeLessThan(1e-12);
        expect(Math.min(...w)).toBeGreaterThanOrEqual(0);
        expect(weightsAt(again, n, x, y)).toEqual(w);
      }
    });
    it("is exactly 1 at every sample", () => {
      points.forEach(([x, y], i) => {
        const w = weightsAt(solve, n, x, y);
        expect(w[i]).toBeCloseTo(1, 12);
        expect(Math.abs(sum(w) - w[i]!)).toBeLessThan(1e-12);
      });
    });
    it("changes continuously along paths that cross edges, vertices, the hull and its outside", () => {
      const jump = (step: number): number => {
        const r = random(11), lines: [number, number, number, number][] = [];
        for (let i = 0; i < 6; i++) lines.push([x0 + r() * (x1 - x0), y0 + r() * (y1 - y0), x0 + r() * (x1 - x0), y0 + r() * (y1 - y0)]);
        for (let i = 0; i < 4; i++) { // through two samples and beyond both
          const [a, b] = [points[Math.floor(r() * n)]!, points[Math.floor(r() * n)]!];
          if (a !== b) lines.push([a[0] - (b[0] - a[0]) / 2, a[1] - (b[1] - a[1]) / 2, b[0] + (b[0] - a[0]) / 2, b[1] + (b[1] - a[1]) / 2]);
        }
        let worst = 0;
        for (const [ax, ay, bx, by] of lines) {
          const count = Math.ceil(Math.hypot(bx - ax, by - ay) / step);
          let previous = weightsAt(solve, n, ax, ay);
          for (let i = 1; i <= count; i++) {
            const w = weightsAt(solve, n, ax + (bx - ax) * i / count, ay + (by - ay) * i / count);
            worst = Math.max(worst, sum(w.map((v, k) => Math.abs(v - previous[k]!))));
            previous = w;
          }
        }
        return worst;
      };
      // Lipschitz: a tenfold smaller step gives a tenfold smaller jump. A discontinuity keeps its size.
      const coarse = jump(1e-3), fine = jump(1e-4);
      expect(fine).toBeLessThan(0.3 * coarse + 1e-12);
      expect(fine).toBeLessThan(0.05);
    }, 60000);
  });

  it("stays continuous on degenerate layouts: random subsets of an integer lattice (cocircular and collinear ties)", () => {
    const r = random(2024), lattice = grid(4);
    for (let trial = 0; trial < 40; trial++) {
      const points = lattice.filter(() => r() < 0.55);
      if (points.length < 4) continue;
      const n = points.length, solve = blendWeights(points);
      let worst = 0;
      for (let line = 0; line < 12; line++) {
        const [ax, ay, bx, by] = [r() * 7 - 2, r() * 7 - 2, r() * 7 - 2, r() * 7 - 2];
        const count = Math.ceil(Math.hypot(bx - ax, by - ay) / 2e-3);
        let previous = weightsAt(solve, n, ax, ay);
        for (let i = 1; i <= count; i++) {
          const w = weightsAt(solve, n, ax + (bx - ax) * i / count, ay + (by - ay) * i / count);
          expect(Math.abs(sum(w) - 1)).toBeLessThan(1e-12);
          worst = Math.max(worst, sum(w.map((v, k) => Math.abs(v - previous[k]!))));
          previous = w;
        }
      }
      // Slivers between nearly collinear lattice points allow a steep but finite slope; a gap or overlap jumps by order one.
      expect(worst).toBeLessThan(0.05);
    }
  }, 60000);
  it("gives barycentric weights inside a triangle and splits a grid cell between its diagonal corners", () => {
    const [a, b, c] = weightsAt(blendWeights(sets.triangle!), 3, 1, 1);
    expect([a, b, c].map(v => +v.toFixed(12))).toEqual([0.5, 0.25, 0.25]);
    const cell = weightsAt(blendWeights(grid(3)), 9, 0.5, 0.5);
    expect(sum(cell)).toBeCloseTo(1, 12);
    expect(cell.filter(v => v > 0).length).toBe(2);
    expect(cell.filter(v => v === 0.5).length).toBe(2);
    expect(cell.every((v, i) => v === 0 || [0, 1, 3, 4].includes(i))).toBe(true);
  });
  it("clamps to the nearest point of the hull", () => {
    const square = blendWeights([[0, 0], [1, 0], [1, 1], [0, 1]]);
    expect(weightsAt(square, 4, 5, 0.25)).toEqual(weightsAt(square, 4, 1, 0.25));
    const corner = weightsAt(square, 4, -3, -4);
    expect(corner[0]).toBe(1);
    const triangle = blendWeights(sets.triangle!);
    expect(weightsAt(triangle, 3, 4, 4)).toEqual([0, 0.5, 0.5]);
    expect(weightsAt(triangle, 3, 100, -5)[1]).toBeCloseTo(1, 12);
  });
  it("falls back to piecewise-linear interpolation along collinear samples, ignoring the other axis", () => {
    const oneD = blendWeights([[0, 0], [2, 0], [5, 0]]);
    expect(weightsAt(oneD, 3, 1, 0)).toEqual([0.5, 0.5, 0]);
    expect(weightsAt(oneD, 3, 1, 9)).toEqual([0.5, 0.5, 0]);
    expect(weightsAt(oneD, 3, 3.5, -4)).toEqual([0, 0.5, 0.5]);
    expect(weightsAt(oneD, 3, -9, 0)).toEqual([1, 0, 0]);
    expect(weightsAt(oneD, 3, 99, 3)).toEqual([0, 0, 1]);
    const diagonal = blendWeights([[3, 3], [0, 0], [1, 1]]);
    expect(weightsAt(diagonal, 3, 2, 2).map(v => +v.toFixed(12))).toEqual([0.5, 0, 0.5]);
    expect(weightsAt(diagonal, 3, 2.5, 1.5).map(v => +v.toFixed(12))).toEqual([0.5, 0, 0.5]);
    expect(weightsAt(blendWeights([[2, -1]]), 1, 7, 7)).toEqual([1]);
  });
  it("rejects duplicate, non-finite, too many and no samples", () => {
    expect(() => blendWeights([[0, 0], [1, 1], [0, 0]])).toThrow(RangeError);
    expect(() => blendWeights([[0, 0], [1, 1], [0, 0]])).toThrow(/distinct/);
    expect(() => blendWeights([[1, 2], [1, 2]])).toThrow(/distinct/);
    expect(() => blendWeights([[0, 0], [NaN, 1]])).toThrow(RangeError);
    expect(() => blendWeights([])).toThrow(RangeError);
    expect(() => blendWeights(scattered(MAX_BLEND_SAMPLES + 1, 3))).toThrow(RangeError);
  });
});

function skin(): MtekSkin {
  const base = animatedSkin();
  const clip = (name: string, duration: number, values: number[]) =>
    ({ name, duration, channels: [{ node: 1, path: "translation" as const, interpolation: "linear" as const, times: [0, duration], values }] });
  return { ...base, clips: [...base.clips,
    clip("run", 0.5, [0, 0, 0, 4, 0, 0]),
    clip("strafe", 2, [0, 0, 0, 0, 2, 0]),
  ] };
}
const triangle = [{ clip: "walk", x: 0, y: 0 }, { clip: "run", x: 1, y: 0 }, { clip: "strafe", x: 0, y: 1 }];

describe("2D blend space playback", () => {
  it("blends three clips of different lengths on one shared cycle", () => {
    const rig = new SkeletonPlayer(skin());
    rig.blend.set({ samples: triangle, parameter: { x: 0.25, y: 0.25 } });
    expect(rig.blend.active).toBe(true);
    expect(rig.blend.duration).toBeCloseTo(1 / (0.5 / 1 + 0.25 / 0.5 + 0.25 / 2));
    rig.advance(rig.blend.duration / 2);
    expect(rig.blend.phase).toBeCloseTo(0.5);
    expect(rig.jointPosition("root").x).toBeCloseTo(0.5 * 1 + 0.25 * 2);
    expect(rig.jointPosition("root").y).toBeCloseTo(0.25 * 1);
    expect(rig.inspect().mode).toBe("locomotion");
    const blend = rig.inspect().blend!;
    expect(blend.parameter).toEqual({ x: 0.25, y: 0.25 });
    expect(blend.samples.map(s => s.weight)).toEqual([0.5, 0.25, 0.25]);
    expect(blend.samples.map(s => [s.clip, s.x, s.y])).toEqual([["walk", 0, 0], ["run", 1, 0], ["strafe", 0, 1]]);
    expect(rig.inspect().locomotion).toBeNull();
  });
  it("never jumps the phase or the pose when the parameter moves smoothly, and is exact at samples", () => {
    const rig = new SkeletonPlayer(skin());
    rig.blend.set({ samples: triangle, parameter: { x: 0, y: 0 }, phase: 0.3 });
    rig.advance(0.1);
    const phase = rig.blend.phase;
    let previous = rig.jointPosition("root");
    for (let step = 1; step <= 100; step++) {
      rig.blend.setParameter(step / 100 * 0.7, step / 100 * 0.2); rig.evaluate();
      const now = rig.jointPosition("root");
      expect(Math.hypot(now.x - previous.x, now.y - previous.y)).toBeLessThan(0.1);
      previous = now;
    }
    expect(rig.blend.phase).toBe(phase);
    rig.blend.setParameter(1, 0); rig.evaluate();
    expect(rig.jointPosition("root").x).toBeCloseTo(4 * rig.blend.phase);
    expect(rig.jointPosition("root").y).toBeCloseTo(0);
    rig.blend.setParameter(40, 40); rig.evaluate();
    expect(rig.blend.inspect()!.samples.map(s => s.weight).reduce((a, b) => a + b)).toBeCloseTo(1);
    expect(rig.blend.inspect()!.samples[1]!.weight).toBeCloseTo(0.5);
  });
  it("accumulates root motion and markers independently of the frame partition, with layers on top", () => {
    const a = new SkeletonPlayer(skin()), b = new SkeletonPlayer(skin());
    for (const rig of [a, b]) {
      rig.blend.set({ samples: triangle, parameter: { x: 0.25, y: 0.25 } }); rig.setRootMotion("root");
      rig.layers.set("arm", { clip: "action", weight: 0.5, mask: { elbow: 1 } });
    }
    const cycle = a.blend.duration;
    a.advance(cycle * 2.5, false);
    for (let i = 0; i < 50; i++) b.advance(cycle * 2.5 / 50);
    a.evaluate(); b.evaluate();
    expect(a.consumeRootMotion().x).toBeCloseTo(2.5 * (0.5 * 2 + 0.25 * 4));
    expect(b.consumeRootMotion().y).toBeCloseTo(2.5 * 0.25 * 2);
    expect(a.blend.phase).toBeCloseTo(b.blend.phase);
    expect(a.blend.crossedPhase(0.1)).toBe(true);
    expect(a.blend.crossed("run", 0.01)).toBe(true);
    expect(a.blend.crossed("missing", 0.01)).toBe(false);
    expect(a.jointPosition("hand").y).toBeCloseTo(b.jointPosition("hand").y);
    expect(a.jointPosition("hand").y).not.toBeCloseTo(0);
  });
  it("shares state with the 1D locomotion API and leaves it in place when sample thresholds are collinear", () => {
    const rig = new SkeletonPlayer(skin());
    rig.locomotion.set({ samples: [{ clip: "walk", threshold: 1 }, { clip: "run", threshold: 3 }], parameter: 2 });
    expect(rig.blend.active).toBe(true);
    expect(rig.blend.parameter).toEqual({ x: 2, y: 0 });
    expect(rig.inspect().blend!.samples.map(s => s.weight)).toEqual([0.5, 0.5]);
    expect(rig.inspect().locomotion!.samples.map(s => s.threshold)).toEqual([1, 3]);
    rig.blend.setParameter(3, 5); rig.evaluate();
    expect(rig.locomotion.parameter).toBe(3);
    expect(rig.inspect().blend!.samples.map(s => s.weight)).toEqual([0, 1]);
    rig.blend.set(undefined);
    expect(rig.locomotion.active).toBe(false);
    expect(rig.inspect().blend).toBeNull();
    rig.blend.set({ samples: [{ clip: "walk", x: 0, y: 1 }, { clip: "run", x: 2, y: 1 }] });
    expect(rig.inspect().locomotion).toBeNull();
    expect(rig.transition("breathe", 0, true, 1)).toBe(true);
    expect(rig.blend.active).toBe(false);
  });
  it("validates atomically", () => {
    const rig = new SkeletonPlayer(skin());
    rig.blend.set({ samples: triangle, parameter: { x: 0.5, y: 0.5 } });
    expect(() => rig.blend.set({ samples: [{ clip: "walk", x: 0, y: 0 }, { clip: "run", x: 0, y: 0 }] })).toThrow(/distinct/);
    expect(() => rig.blend.set({ samples: [{ clip: "walk", x: 0, y: 0 }, { clip: "nope", x: 1, y: 0 }] })).toThrow(RangeError);
    expect(() => rig.blend.set({ samples: triangle, phase: 1 })).toThrow(/phase/);
    expect(() => rig.blend.set({ samples: [] })).toThrow(RangeError);
    expect(() => rig.blend.setParameter(0, NaN)).toThrow(/finite/);
    expect(rig.blend.parameter).toEqual({ x: 0.5, y: 0.5 });
    expect(rig.blend.inspect()!.samples).toHaveLength(3);
    const samples = Array.from({ length: MAX_BLEND_SAMPLES + 1 }, (_, i) => ({ clip: "walk", x: i, y: i * i }));
    expect(() => rig.blend.set({ samples })).toThrow(RangeError);
  });
  it("is driven through the controller", () => {
    const controller = createAnimationController(skin());
    controller.setBlendSpace({ samples: triangle, parameter: { x: 0, y: 0 } });
    controller.setBlendParameter(1, 0);
    controller.update(0.1);
    expect(controller.player.blend.phase).toBeCloseTo(0.2);
    expect(controller.player.blend.playing).toBe(true);
    expect(controller.player.blend.pause()).toBe(true);
    controller.update(0.1);
    expect(controller.player.blend.phase).toBeCloseTo(0.2);
    controller.player.blend.seek(0.5);
    expect(controller.player.blend.resume()).toBe(true);
    controller.setBlendSpace(undefined);
    expect(controller.player.blend.active).toBe(false);
  });
});

describe("layer fades", () => {
  const rig = (): SkeletonPlayer => {
    const player = new SkeletonPlayer(animatedSkin(), "walk");
    player.layers.set("arm", { clip: "action", weight: 1, mask: { elbow: 1 }, speed: 0 });
    player.layers.seek("arm", 0.5);
    player.evaluate();
    return player;
  };
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const layer = (player: SkeletonPlayer) => player.inspect().layers[0]!;
  it("moves the weight continuously along a smoothstep and reports target and remaining time", () => {
    const player = rig();
    expect(player.layers.fade("arm", 0, 1)).toBe(true);
    expect(layer(player)).toMatchObject({ weight: 1, targetWeight: 0, fadeRemaining: 1 });
    for (let i = 1; i <= 4; i++) {
      player.advance(0.25);
      expect(layer(player).weight).toBeCloseTo(1 - smooth(i / 4));
      expect(layer(player).fadeRemaining).toBeCloseTo(1 - i / 4);
      expect(player.jointPosition("hand").y).toBeCloseTo(Math.sin(Math.PI / 2 * (1 - smooth(i / 4))));
    }
    expect(layer(player)).toMatchObject({ weight: 0, targetWeight: 0, fadeRemaining: 0 });
    expect(player.inspect().layers).toHaveLength(1);
    expect(player.jointPosition("hand").y).toBeCloseTo(0);
  });
  it("gives the same weight for any frame partition, including hitches past the end", () => {
    const a = rig(), b = rig();
    a.layers.fade("arm", 0.25, 2); b.layers.fade("arm", 0.25, 2);
    a.advance(1.3); for (let i = 0; i < 130; i++) b.advance(0.01);
    expect(layer(a).weight).toBeCloseTo(layer(b).weight, 12);
    expect(layer(a).fadeRemaining).toBeCloseTo(0.7);
    a.advance(10); b.advance(0.7); b.advance(0.01);
    expect(layer(a).weight).toBe(0.25); expect(layer(b).weight).toBe(0.25);
    expect(layer(a).fadeRemaining).toBe(0); expect(layer(b).fadeRemaining).toBe(0);
  });
  it("is interrupted by another fade from the weight it has now, and by set", () => {
    const player = rig();
    player.layers.fade("arm", 0, 1); player.advance(0.25);
    const mid = 1 - smooth(0.25);
    expect(layer(player).weight).toBeCloseTo(mid);
    player.layers.fade("arm", 1, 0.5);
    expect(layer(player)).toMatchObject({ targetWeight: 1, fadeRemaining: 0.5 });
    expect(layer(player).weight).toBeCloseTo(mid);
    player.advance(0.25);
    expect(layer(player).weight).toBeCloseTo(mid + (1 - mid) * smooth(0.5));
    player.layers.set("arm", { clip: "action", weight: 0.4, mask: { elbow: 1 }, speed: 0 });
    expect(layer(player)).toMatchObject({ weight: 0.4, targetWeight: 0.4, fadeRemaining: 0 });
    player.advance(1);
    expect(layer(player).weight).toBe(0.4);
  });
  it("keeps the layer phase, applies zero-second fades at once, keeps faded-out layers and rejects bad input", () => {
    const player = new SkeletonPlayer(animatedSkin(), "walk");
    player.layers.set("arm", { clip: "action", weight: 1, mask: { elbow: 1 } });
    player.layers.fade("arm", 0, 0.5); player.advance(0.2);
    player.layers.fade("arm", 1, 0.5); player.advance(0.2);
    expect(layer(player).time).toBeCloseTo(0.4);
    player.layers.fade("arm", 0, 0);
    expect(layer(player)).toMatchObject({ weight: 0, targetWeight: 0, fadeRemaining: 0 });
    expect(layer(player).time).toBeCloseTo(0.4);
    player.layers.fade("arm", 0.5, 0); player.evaluate();
    expect(player.jointPosition("hand").y).toBeGreaterThan(0.3);
    expect(player.layers.fade("missing", 1, 1)).toBe(false);
    expect(() => player.layers.fade("arm", 2, 1)).toThrow(RangeError);
    expect(() => player.layers.fade("arm", 1, -1)).toThrow(RangeError);
    expect(() => player.layers.fade("arm", NaN, 1)).toThrow(RangeError);
    expect(layer(player).weight).toBe(0.5);
    player.layers.remove("arm");
    expect(player.inspect().layers).toHaveLength(0);
  });
  it("is available through the controller", () => {
    const controller = createAnimationController(animatedSkin(), { clip: "walk" });
    controller.setLayer("arm", { clip: "action", weight: 0, mask: { elbow: 1 } });
    expect(controller.fadeLayer("arm", 1, 1)).toBe(true);
    controller.update(0.5);
    expect(controller.player.inspect().layers[0]!.weight).toBeCloseTo(0.5);
    expect(controller.fadeLayer("none", 1, 1)).toBe(false);
  });
});
