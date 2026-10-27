// Decision 0224: foot placement of `examples/animation-composition` on the real engine, both backends, manual clock.
//
// The program supplies ground points under the feet of its `Ghost` (the animation without any goal), at the height the animation
// lifts each foot to; the runtime solves both legs and lowers the hips by the least amount that lets both reach (spec/animation.md
// 3.4). The expectations are computed from the example's ground function (transcribed in support/animation-reference.ts) and the
// joints of the unplaced figure:
//   stance   a foot stands on the ground: its world height is the ground's plus the ankle height, within the soft reach margin
//            (at most 0.368 * softness * (cmax - cmin), the miss of a target at full extension);
//   drop     at the curb's edge one foot is 0.2 m below the other; the hips drop is the smaller root of |T - (P - delta up)| = cmax - w,
//            derived here from the unplaced pose, equals the runtime's `requiredDrop`, is reached after the smoothing, and leaves the
//            binding leg exactly at the exact-reach limit and the other inside it.
import { expect, test } from "../../support/fixtures.ts";
import { animationConstant } from "../../support/animation-example.ts";
import { dist, figureToWorld, groundHeight, legReach, minimumDrop, sub, type V3 } from "../../support/animation-reference.ts";
import { collectProblems, figure, run, writeProbe } from "../../support/animation-harness.ts";
import { hold, tap, wait } from "../../support/movement-drive.ts";
import type { Sample } from "../../support/animation-drive.ts";

const FIGURE_BASE = animationConstant("FIGURE_BASE");
const SOLE = animationConstant("SOLE");
const SOFTNESS = 0.05;
const FLEXION_MAX = (150 * Math.PI) / 180;

const worldOf = (s: Sample, local: V3): V3 => figureToWorld(s.hero, FIGURE_BASE, local);

/** The unit normal of the example's ground at (x, z): `ground_normal`, central differences of 0.05 m. */
function groundNormal(x: number, z: number): V3 {
  const e = 0.05;
  const n: V3 = [groundHeight(x - e, z) - groundHeight(x + e, z), 2 * e, groundHeight(x, z - e) - groundHeight(x, z + e)];
  const l = Math.hypot(...n);
  return [n[0] / l, n[1] / l, n[2] / l];
}

test.describe("foot placement of the example (decision 0224)", () => {
  let problems: ReturnType<typeof collectProblems>;
  test.beforeEach(({ page, gpu }) => {
    void gpu;
    problems = collectProblems(page);
  });
  test.afterEach(() => problems.check());

  test("feet land on the steps, the plateau and the ramp: each foot is on the ground under it, at the height the animation lifts it to", async ({ page }) => {
    // Walk from the foot of the stairs over the plateau and down the ramp (the Hero stays on the line x = 0, so one foot is on each side of it).
    const result = await run(page, [tap("Digit3"), wait(30), hold(["KeyW"], 330), wait(30)], { model: "all", ghost: "all" });
    const rows: number[] = [];
    let onPlateau = 0, onRamp = 0, onRiser = 0, worstStance = 0, worstAll = 0, lowered = 0;
    let worstReach = 0, worstAgreement = 0, lagBound = 0;
    for (const s of result.samples.slice(31)) {
      for (const side of ["Left", "Right"]) {
        const lf = figure(s, "ghost", `${side}Foot`);
        const foot = worldOf(s, figure(s, "model", `${side}Foot`));
        const ghostWorld = worldOf(s, lf);
        const g = groundHeight(foot[0], foot[2]);
        const n = groundNormal(ghostWorld[0], ghostWorld[2]);
        // The target of the program: the ground at the animated foot's plane position, plus the lift the animation gives the foot, plus the sole offset along the normal.
        const lift = Math.max(lf[1] - SOLE, 0);
        const expected = groundHeight(ghostWorld[0], ghostWorld[2]) + lift + SOLE * n[1];
        const error = Math.abs(foot[1] - expected);
        const target: V3 = [ghostWorld[0] + SOLE * n[0], expected, ghostWorld[2] + SOLE * n[2]];
        const error3 = dist(foot, target);
        const fpNow = s.model.footPlacement;
        const lag = fpNow === null ? 0 : Math.abs(fpNow.requiredDrop - fpNow.drop);
        const residual = fpNow === null ? 0 : (side === "Left" ? fpNow.left : fpNow.right).residual;
        worstAgreement = Math.max(worstAgreement, Math.abs(error3 - residual));
        void residual;
        lagBound = Math.max(lagBound, error - lag);
        worstAll = Math.max(worstAll, error);
        if (Math.abs(lf[1] - SOLE) < 1e-4) worstStance = Math.max(worstStance, error);
        const z = foot[2];
        if (z > 5.0 && z < 7.2) onPlateau += 1;
        if (z > 7.8 && z < 9.0) onRamp += 1;
        if ((z > 3.3 && z < 3.7) || (z > 4.3 && z < 4.7)) onRiser += 1;
        rows.push(error);
        void g;
      }
      const fp = s.model.footPlacement;
      if (fp !== null) {
        lowered = Math.max(lowered, fp.drop);
        worstReach = Math.max(worstReach, fp.left.residual, fp.right.residual);
      }
    }
    // The miss of a target at full extension: 0.368 * softness * (cmax - cmin) of the leg (spec/animation.md 3.3).
    const reach = legReach(figure(result.samples[40]!, "ghost", "LeftUpLeg"), figure(result.samples[40]!, "ghost", "LeftLeg"), figure(result.samples[40]!, "ghost", "LeftFoot"), SOFTNESS, FLEXION_MAX);
    const bound = Math.exp(-1) * reach.w + 0.001;
    writeProbe("feet-course", { worstAll, worstStance, bound, frames: { plateau: onPlateau, ramp: onRamp, riser: onRiser }, largestDrop: lowered, worstSolverResidual: worstReach, worstAgreement, worstErrorBeyondLag: lagBound, p50: [...rows].sort((a, b) => a - b)[Math.floor(rows.length / 2)], p99: [...rows].sort((a, b) => a - b)[Math.floor(rows.length * 0.99)] });
    expect(onPlateau, "foot samples on the plateau").toBeGreaterThan(100);
    expect(onRamp, "foot samples on the ramp").toBeGreaterThan(20);
    expect(onRiser, "foot samples on the risers").toBeGreaterThan(10);
    expect(worstStance, "a planted foot's height above the ground it stands on, against its target (m)").toBeLessThanOrEqual(bound);
    // Moving over an edge the target jumps and the hips follow with the smoothing (0.1 s): a foot may be short of its target by what the hips still
    // have to drop (the placement reports both), on top of the soft margin.
    expect(lagBound, "any foot's height error beyond the hips' lag (m)").toBeLessThanOrEqual(bound);
    expect(lowered, "the hips were lowered where a foot was on lower ground").toBeGreaterThan(0.005);
  });

  test("the hips drop at the curb's edge is the minimum that lets both feet reach, derived from the unplaced pose", async ({ page }) => {
    // The Hero stands at x = 0.03, z = 1 on the curb (0.2 m high for x >= 0): the left foot (x = 0.16) on it, the right (x = -0.10) on the floor.
    const result = await run(page, [tap("Digit2"), wait(120)], { model: "all", ghost: "all" });
    const s = result.samples.at(-1)!;
    const wantedAt = (x: Sample): number => {
      let wanted = 0;
      const originY = x.hero.position.y - FIGURE_BASE;
      for (const side of ["Left", "Right"]) {
        const reach = legReach(figure(x, "ghost", `${side}UpLeg`), figure(x, "ghost", `${side}Leg`), figure(x, "ghost", `${side}Foot`), SOFTNESS, FLEXION_MAX);
        const ankle = figure(x, "ghost", `${side}Foot`), w = worldOf(x, ankle), n = groundNormal(w[0], w[2]);
        wanted = Math.max(wanted, minimumDrop(figure(x, "ghost", `${side}UpLeg`), [ankle[0], groundHeight(w[0], w[2]) + Math.max(ankle[1] - SOLE, 0) + SOLE * n[1] - originY, ankle[2]], reach));
      }
      return wanted;
    };
    // The smoothing (spec/animation.md 3.4): drop <- drop + (wanted - drop) (1 - exp(-dt / 0.1)), one step at a time from the 40th frame on.
    let smoothing = 0;
    for (let i = 41; i < result.samples.length; i += 1) {
      const a = result.samples[i - 1]!, b = result.samples[i]!;
      const predicted = a.model.footPlacement!.drop + (wantedAt(b) - a.model.footPlacement!.drop) * (1 - Math.exp(-(b.time - a.time) / 0.1));
      smoothing = Math.max(smoothing, Math.abs(b.model.footPlacement!.drop - predicted));
    }
    const fp = s.model.footPlacement!;
    expect(fp, "foot placement is set").not.toBeNull();
    const originY = s.hero.position.y - FIGURE_BASE;
    let wanted = 0;
    const legs: Array<{ side: string; required: number; distance: number; limit: number; ground: number }> = [];
    for (const side of ["Left", "Right"]) {
      const hip = figure(s, "ghost", `${side}UpLeg`), knee = figure(s, "ghost", `${side}Leg`), ankle = figure(s, "ghost", `${side}Foot`);
      const reach = legReach(hip, knee, ankle, SOFTNESS, FLEXION_MAX);
      const ghostWorld = worldOf(s, ankle);
      const g = groundHeight(ghostWorld[0], ghostWorld[2]);
      const n = groundNormal(ghostWorld[0], ghostWorld[2]);
      expect(n[1], `${side} foot stands on flat ground`).toBeCloseTo(1, 3);
      // Target in the mesh frame: the animated foot lifted by the ground's height over the figure's plane.
      const lift = Math.max(ankle[1] - SOLE, 0);
      const target: V3 = [ankle[0], g + lift + SOLE * n[1] - originY, ankle[2]];
      const required = minimumDrop(hip, target, reach);
      wanted = Math.max(wanted, required);
      const placedHip = figure(s, "model", `${side}UpLeg`);
      legs.push({ side, required, distance: dist(placedHip, target), limit: reach.cmax - reach.w, ground: g });
    }
    const hipsDrop = figure(s, "ghost", "Hips")[1] - figure(s, "model", "Hips")[1];
    writeProbe("feet-drop", { smoothing, wanted, requiredDrop: fp.requiredDrop, appliedDrop: fp.drop, hipsDrop, legs, flexion: [fp.left.flexion, fp.right.flexion] });
    expect(legs.map((l) => l.ground), "left on the curb, right on the floor").toEqual([expect.closeTo(0.2, 6), expect.closeTo(0, 6)]);
    expect(wanted, "the unplaced pose needs a drop").toBeGreaterThan(0.1);
    expect(fp.requiredDrop, "the runtime's required drop is the minimum derived here (m)").toBeCloseTo(wanted, 4);
    expect(smoothing, "each frame's drop is the smoothing of the minimum derived here, one step from the previous (m)").toBeLessThan(5e-5);
    // The idle clip breathes (the hips move by +-4 mm at 0.5 Hz), so the minimum moves and the smoothed drop trails it by about 0.1 s of its rate.
    expect(Math.abs(fp.drop - wanted), "the applied drop trails the moving minimum by under 0.1 s of its rate (m)").toBeLessThan(0.1 * 0.004 * Math.PI + 1e-4);
    expect(hipsDrop, "the hips of the placed figure are lower than the unplaced one's by the applied drop (m)").toBeCloseTo(fp.drop, 5);
    // Minimal: the leg that needs the drop is exactly at the exact-reach limit, the other is inside it.
    const binding = legs.reduce((a, b) => (a.required > b.required ? a : b));
    const other = legs.find((l) => l !== binding)!;
    expect(binding.side).toBe("Right");
    // (the applied drop trails the minimum by `fp.drop - wanted` while the idle clip breathes, and the leg is that much beyond the limit)
    expect(Math.abs(binding.distance - binding.limit), "the binding leg's hip-to-target distance equals the exact-reach limit (m)").toBeLessThan(Math.abs(wanted - fp.drop) + 1e-4);
    expect(other.distance, "the other leg is inside its limit").toBeLessThan(other.limit - 0.005);
    expect(other.required, "and needed no drop of its own").toBe(0);
    // Both feet are where the program put them (the world heights of the soles' targets).
    for (const side of ["Left", "Right"]) {
      const foot = worldOf(s, figure(s, "model", `${side}Foot`));
      const ghost = worldOf(s, figure(s, "ghost", `${side}Foot`));
      const expectedY = groundHeight(ghost[0], ghost[2]) + SOLE;
      expect(Math.abs(foot[1] - expectedY), `${side} ankle height above the ground it stands on`).toBeLessThan(2e-3);
      expect(Math.hypot(foot[0] - ghost[0], foot[2] - ghost[2]), `${side} foot keeps its place on the ground plane`).toBeLessThan(2e-3);
    }
  });

  test("on flat ground at idle the legs are inside the exact reach: nothing is lowered", async ({ page }) => {
    const result = await run(page, [wait(90)], { model: "all", ghost: "all" });
    const s = result.samples.at(-1)!;
    expect(s.model.footPlacement?.requiredDrop).toBe(0);
    expect(s.model.footPlacement?.drop, "the drop settles back to nothing").toBeLessThan(1e-5);
    expect(dist(figure(s, "model", "Hips"), figure(s, "ghost", "Hips")), "hips are the unplaced ones").toBeLessThan(1e-5);
    for (const side of ["Left", "Right"]) expect(dist(figure(s, "model", `${side}Foot`), figure(s, "ghost", `${side}Foot`)), `${side} foot`).toBeLessThan(2e-3);
  });

  test("P switches the placement off: at the curb's edge the foot over the floor then hangs 0.2 m above it", async ({ page }) => {
    const on = await run(page, [tap("Digit2"), wait(90)], { model: ["RightFoot", "Hips"], ghost: [] });
    const off = await run(page, [hold(["KeyP"], 1), tap("Digit2"), wait(90)], { model: ["RightFoot", "Hips"], ghost: [] });
    const a = on.samples.at(-1)!, b = off.samples.at(-1)!;
    expect(b.model.footPlacement, "no placement").toBeNull();
    const ya = worldOf(a, figure(a, "model", "RightFoot"))[1];
    const yb = worldOf(b, figure(b, "model", "RightFoot"))[1];
    writeProbe("feet-toggle", { placed: ya, unplaced: yb });
    expect(ya, "placed: the ankle is the ankle height above the floor").toBeCloseTo(SOLE, 2);
    expect(yb, "unplaced: it follows the capsule's height on the curb").toBeCloseTo(0.2 + SOLE, 2);
    expect(sub(figure(a, "model", "Hips"), figure(b, "model", "Hips"))[1], "and the hips are lower when placed").toBeLessThan(-0.1);
  });
});
