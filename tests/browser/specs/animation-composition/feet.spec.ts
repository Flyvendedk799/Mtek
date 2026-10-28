// Decision 0224: foot placement of `examples/animation-composition` on the real engine, both backends, manual clock.
//
// The program supplies ground points under the feet the animation gives it (`animation.animated_joint_position`, the pose before any goal),
// at the height the animation lifts each foot to, and a contact weight for each foot that is one in stance and falls to zero as the animation lifts the foot; the runtime solves both legs and lowers the hips by the least amount that lets both reach (spec/animation.md
// 3.4). The expectations are computed from the example's ground function (transcribed in support/animation-reference.ts) and the
// animated joints (which the first test of layers.spec.ts and retarget-free CPU player check, see animated.spec.ts):
//   stance   a foot stands on the ground: its world height is the ground's plus the ankle height, within the soft reach margin
//            (at most 0.368 * softness * (cmax - cmin), the miss of a target at full extension);
//   drop     at the curb's edge one foot is 0.2 m below the other; the hips drop is the smaller root of |T - (P - delta up)| = cmax - w,
//            derived here from the unplaced pose, equals the runtime's `requiredDrop`, is reached after the smoothing, and leaves the
//            binding leg exactly at the exact-reach limit and the other inside it.
import { expect, test } from "../../support/fixtures.ts";
import { animationConstant } from "../../support/animation-example.ts";
import { dist, figureToWorld, groundHeight, legReach, minimumDrop, smoothstep01, sub, type V3 } from "../../support/animation-reference.ts";
import { collectProblems, figure, run, writeProbe } from "../../support/animation-harness.ts";
import { hold, tap, wait } from "../../support/movement-drive.ts";
import type { Sample } from "../../support/animation-drive.ts";

const FIGURE_BASE = animationConstant("FIGURE_BASE");
const SOLE = animationConstant("SOLE");
const LIFT_FREE = Math.fround(animationConstant("LIFT_FREE"));
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

  test("walking over the steps, the plateau and the ramp: feet in stance are planted on the ground, feet in the air follow the animation, and the weights are the program's", async ({ page }) => {
    // Walk from the foot of the stairs over the plateau and down the ramp (the Hero stays on the line x = 0, so one foot is on each side of it).
    const result = await run(page, [tap("Digit3"), wait(30), hold(["KeyW"], 330), wait(30)], { model: "all", animated: "all" });
    let onPlateau = 0, onRamp = 0, onRiser = 0, stance = 0, swing = 0, worstStance = 0, lowered = 0, worstWeight = 0, weightSamples = 0;
    let beyondLag = 0, airBelow = Infinity, swingWeightMax = 0, stanceWeightMin = 1, freeFeet = 0;
    for (const [index, s] of result.samples.entries()) {
      if (index < 31) continue;
      const fp = s.model.footPlacement;
      const previous = result.samples[index - 1]!;
      const steady = Math.abs(Number(s.state["blend_y"]) - Number(previous.state["blend_y"])) < 1e-6 && Math.abs(Number(s.state["blend_x"]) - Number(previous.state["blend_x"])) < 1e-6;
      for (const side of ["Left", "Right"]) {
        const lf = figure(s, "animated", `${side}Foot`);
        const foot = worldOf(s, figure(s, "model", `${side}Foot`));
        const animatedFoot = worldOf(s, lf);
        const n = groundNormal(animatedFoot[0], animatedFoot[2]);
        const lift = Math.max(lf[1] - SOLE, 0);
        const weight = 1 - smoothstep01(lift / LIFT_FREE);
        const ground = groundHeight(animatedFoot[0], animatedFoot[2]);
        if (fp !== null && steady) {
          worstWeight = Math.max(worstWeight, Math.abs((side === "Left" ? fp.left : fp.right).weight - weight));
          weightSamples += 1;
        }
        const z = foot[2];
        if (z > 5.0 && z < 7.2) onPlateau += 1;
        if (z > 7.8 && z < 9.0) onRamp += 1;
        if ((z > 3.3 && z < 3.7) || (z > 4.3 && z < 4.7)) onRiser += 1;
        if (weight >= 0.99) {
          // In stance: the program's target is the ground at the animated foot plus the sole offset along the normal.
          stance += 1;
          stanceWeightMin = Math.min(stanceWeightMin, weight);
          const error = Math.abs(foot[1] - (ground + lift + SOLE * n[1]));
          worstStance = Math.max(worstStance, error);
          beyondLag = Math.max(beyondLag, error - (fp === null ? 0 : Math.abs(fp.requiredDrop - fp.drop)));
        } else if (lift >= 0.04) {
          // In the air (the animation lifts the foot by at least 4 cm): not pinned. The foot stays above the ground by at least half of what the animation lifts it,
          // and the weight is under a half, so the animated foot is what the program asks for.
          swing += 1;
          swingWeightMax = Math.max(swingWeightMax, weight);
          airBelow = Math.min(airBelow, foot[1] - ground - SOLE - 0.5 * lift + (fp === null ? 0 : Math.abs(fp.requiredDrop - fp.drop)));
          if (weight < 0.5) freeFeet += 1;
        }
      }
      if (fp !== null) lowered = Math.max(lowered, fp.drop);
    }
    // The miss of a target at full extension: 0.368 * softness * (cmax - cmin) of the leg (spec/animation.md 3.3).
    const reach = legReach(figure(result.samples[40]!, "animated", "LeftUpLeg"), figure(result.samples[40]!, "animated", "LeftLeg"), figure(result.samples[40]!, "animated", "LeftFoot"), SOFTNESS, FLEXION_MAX);
    const bound = Math.exp(-1) * reach.w + 0.001;
    writeProbe("feet-course", { worstStance, worstStanceBeyondLag: beyondLag, bound, frames: { plateau: onPlateau, ramp: onRamp, riser: onRiser, stance, swing, free: freeFeet }, largestDrop: lowered, worstWeightError: worstWeight, weightSamples, airMargin: airBelow, swingWeightMax });
    expect(onPlateau, "foot samples on the plateau").toBeGreaterThan(100);
    expect(onRamp, "foot samples on the ramp").toBeGreaterThan(20);
    expect(onRiser, "foot samples on the risers").toBeGreaterThan(10);
    expect(stance, "foot samples in stance").toBeGreaterThan(150);
    expect(swing, "foot samples in the air").toBeGreaterThan(100);
    // Moving over an edge the target jumps and the hips follow with the smoothing (0.1 s): a planted foot may be short of its target by what the hips still
    // have to drop (the placement reports both), on top of the soft margin.
    expect(beyondLag, "a foot in stance: its height error beyond the hips' lag (m)").toBeLessThanOrEqual(bound);
    // (the soft reach margin may leave a nearly straight leg short of its target by up to `bound`, and the hips' lag by what they still have to drop)
    expect(airBelow, "a foot in the air stays above the ground by half of the animation's lift, give or take the soft reach margin (m)").toBeGreaterThanOrEqual(-bound);
    expect(freeFeet, "feet whose contact weight is under a half while lifted").toBeGreaterThan(30);
    // The contact weights the placement holds are 1 - smoothstep(lift / LIFT_FREE) of the animated foot's lift, in every frame in which the parameter is steady.
    expect(weightSamples, "frames with a steady blend").toBeGreaterThan(300);
    expect(worstWeight, "largest difference between a placement weight and the weight of the animated foot's lift").toBeLessThan(1e-4);
    expect(lowered, "the hips were lowered where a foot was on lower ground").toBeGreaterThan(0.005);
  });

  test("the hips drop at the curb's edge is the minimum that lets both feet reach, derived from the unplaced pose", async ({ page }) => {
    // The Hero stands at x = 0.03, z = 1 on the curb (0.2 m high for x >= 0): the left foot (x = 0.16) on it, the right (x = -0.10) on the floor.
    const result = await run(page, [tap("Digit2"), wait(120)], { model: "all", animated: "all" });
    const s = result.samples.at(-1)!;
    const wantedAt = (x: Sample): number => {
      let wanted = 0;
      const originY = x.hero.position.y - FIGURE_BASE;
      for (const side of ["Left", "Right"]) {
        const reach = legReach(figure(x, "animated", `${side}UpLeg`), figure(x, "animated", `${side}Leg`), figure(x, "animated", `${side}Foot`), SOFTNESS, FLEXION_MAX);
        const ankle = figure(x, "animated", `${side}Foot`), w = worldOf(x, ankle), n = groundNormal(w[0], w[2]);
        wanted = Math.max(wanted, minimumDrop(figure(x, "animated", `${side}UpLeg`), [ankle[0], groundHeight(w[0], w[2]) + Math.max(ankle[1] - SOLE, 0) + SOLE * n[1] - originY, ankle[2]], reach));
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
      const hip = figure(s, "animated", `${side}UpLeg`), knee = figure(s, "animated", `${side}Leg`), ankle = figure(s, "animated", `${side}Foot`);
      const reach = legReach(hip, knee, ankle, SOFTNESS, FLEXION_MAX);
      const animatedWorld = worldOf(s, ankle);
      const g = groundHeight(animatedWorld[0], animatedWorld[2]);
      const n = groundNormal(animatedWorld[0], animatedWorld[2]);
      expect(n[1], `${side} foot stands on flat ground`).toBeCloseTo(1, 3);
      // Target in the mesh frame: the animated foot lifted by the ground's height over the figure's plane.
      const lift = Math.max(ankle[1] - SOLE, 0);
      const target: V3 = [ankle[0], g + lift + SOLE * n[1] - originY, ankle[2]];
      const required = minimumDrop(hip, target, reach);
      wanted = Math.max(wanted, required);
      const placedHip = figure(s, "model", `${side}UpLeg`);
      legs.push({ side, required, distance: dist(placedHip, target), limit: reach.cmax - reach.w, ground: g });
    }
    const hipsDrop = figure(s, "animated", "Hips")[1] - figure(s, "model", "Hips")[1];
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
      const animatedFoot = worldOf(s, figure(s, "animated", `${side}Foot`));
      const expectedY = groundHeight(animatedFoot[0], animatedFoot[2]) + SOLE;
      expect(Math.abs(foot[1] - expectedY), `${side} ankle height above the ground it stands on`).toBeLessThan(2e-3);
      expect(Math.hypot(foot[0] - animatedFoot[0], foot[2] - animatedFoot[2]), `${side} foot keeps its place on the ground plane`).toBeLessThan(2e-3);
    }
  });

  test("on flat ground at idle the legs are inside the exact reach: nothing is lowered", async ({ page }) => {
    const result = await run(page, [wait(90)], { model: "all", animated: "all" });
    const s = result.samples.at(-1)!;
    expect(s.model.footPlacement?.requiredDrop).toBe(0);
    expect(s.model.footPlacement?.drop, "the drop settles back to nothing").toBeLessThan(1e-5);
    expect(dist(figure(s, "model", "Hips"), figure(s, "animated", "Hips")), "hips are the unplaced ones").toBeLessThan(1e-5);
    for (const side of ["Left", "Right"]) expect(dist(figure(s, "model", `${side}Foot`), figure(s, "animated", `${side}Foot`)), `${side} foot`).toBeLessThan(2e-3);
  });

  test("P switches the placement off: at the curb's edge the foot over the floor then hangs 0.2 m above it", async ({ page }) => {
    const on = await run(page, [tap("Digit2"), wait(90)], { model: ["RightFoot", "Hips"], animated: [] });
    const off = await run(page, [hold(["KeyP"], 1), tap("Digit2"), wait(90)], { model: ["RightFoot", "Hips"], animated: [] });
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
