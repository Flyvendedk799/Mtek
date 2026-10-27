// Decision 0224: the left hand's reach and the tail's chain goal of `examples/animation-composition` on the real engine, both
// backends, manual clock; and the anatomy of the solved limbs along whole runs.
//
//   reach     the hand (the `LeftHand` joint, the end of the arm) is asked for the orb, held to 0.5 m of the shoulder (the arm is 0.57 m
//             long); the hand's world position is computed from the joint read and the capsule's pose and compared with the orb's
//             position, which is a constant of the program (a unit test finds it in the source);
//   anatomy   a knee never bends backwards and an elbow never forwards: the joint lies on the front (knee) or the back (elbow) side
//             of the line between the ends of its limb, in every frame of a run over the curb, the stairs and the ramp, and the flexion
//             the solver reports stays inside its range (0 to 150 degrees at the knee, 0 to 145 at the elbow);
//   tail      a chain goal (12 iterations of CCD) leaves the tip within the published 1 mm of a reachable point, or near it.
import { expect, test } from "../../support/fixtures.ts";
import { animationConstant } from "../../support/animation-example.ts";
import { angleBetween, bendSide, dist, figureToWorld, norm, sub, type V3 } from "../../support/animation-reference.ts";
import { collectProblems, figure, run, writeProbe } from "../../support/animation-harness.ts";
import { hold, tap, wait, type Step } from "../../support/movement-drive.ts";
import type { Sample } from "../../support/animation-drive.ts";

const FIGURE_BASE = animationConstant("FIGURE_BASE");
const ARM_REACH = Math.fround(animationConstant("ARM_REACH"));
const ORB: V3 = [0.36, 1.25, -7.7];
const FRONT: V3 = [0, 0, 1];
const BACK: V3 = [0, 0, -1];
const world = (s: Sample, local: V3): V3 => figureToWorld(s.hero, FIGURE_BASE, local);

test.describe("goals of the example (decision 0224)", () => {
  let problems: ReturnType<typeof collectProblems>;
  test.beforeEach(({ page, gpu }) => {
    void gpu;
    problems = collectProblems(page);
  });
  test.afterEach(() => problems.check());

  test("the left hand reaches the orb: the hand is on the world-space target, with the weight the program sets", async ({ page }) => {
    const result = await run(page, [wait(30), hold(["KeyG"], 120), wait(70)], { model: "all", animated: [] });
    const samples = result.samples;
    let weightError = 0, flexionMin = Infinity, flexionMax = 0;
    for (const s of samples) {
      const limb = s.model.limbs.find((l) => l.id === "limb:left_arm");
      const reach = Number(s.state["reach"]);
      if (reach > 0.001) {
        expect(limb, "a goal while the reach is above the program's threshold").toBeDefined();
        weightError = Math.max(weightError, Math.abs(limb!.weight - reach));
        flexionMin = Math.min(flexionMin, limb!.flexion);
        flexionMax = Math.max(flexionMax, limb!.flexion);
      } else expect(limb, "no goal while the reach is below it").toBeUndefined();
    }
    // 1.5 s of G: the reach has followed to 1 - exp(-1.5 / 0.12) = 1 - 4e-6.
    const settled = samples[30 + 120 - 1]!;
    const hand = world(settled, figure(settled, "model", "LeftHand"));
    const shoulder = world(settled, figure(settled, "model", "LeftArm"));
    const miss = dist(hand, ORB);
    writeProbe("reach", { miss, shoulderToOrb: dist(shoulder, ORB), weightError, flexionMin, flexionMax, reach: settled.state["reach"] });
    expect(dist(shoulder, ORB), "the orb is within the arm's reach").toBeLessThan(ARM_REACH);
    expect(miss, "distance of the hand from the orb (m)").toBeLessThan(1e-3);
    expect(weightError, "the limb's weight is the program's reach").toBeLessThan(1e-6);
    expect(flexionMin, "elbow flexion stays non-negative").toBeGreaterThanOrEqual(0);
    expect(flexionMax, "and below 145 degrees").toBeLessThan((145 * Math.PI) / 180);
    // Letting go: the goal is removed and the hand returns to the animated pose (the hanging arm of the idle clip).
    const after = samples.at(-1)!;
    expect(after.model.limbs, "the goal is cleared once the reach has decayed").toEqual([]);
    expect(dist(world(after, figure(after, "model", "LeftHand")), ORB), "the hand left the orb").toBeGreaterThan(0.3);
  });

  test("walking away while reaching, the hand stops at the arm's reach on the line to the orb, and elbows never bend the wrong way", async ({ page }) => {
    const result = await run(page, [wait(10), hold(["KeyG", "KeyW"], 150), hold(["KeyG"], 40)], { model: "all", animated: [] });
    const samples = result.samples;
    let worstReach = 0, worstAngle = 0, clamped = 0, wrongSide = Infinity, worstMiss = 0;
    for (const s of samples.slice(30)) {
      const hand = world(s, figure(s, "model", "LeftHand"));
      const shoulder = world(s, figure(s, "model", "LeftArm"));
      const toOrb = sub(ORB, shoulder);
      const limb = s.model.limbs.find((l) => l.id === "limb:left_arm");
      if (limb === undefined || Number(s.state["reach"]) < 0.99999) continue;
      const wanted = Math.min(norm(toOrb), ARM_REACH);
      if (norm(toOrb) > ARM_REACH + 0.01) clamped += 1;
      worstReach = Math.max(worstReach, Math.abs(dist(hand, shoulder) - wanted));
      worstAngle = Math.max(worstAngle, angleBetween(sub(hand, shoulder), toOrb));
      worstMiss = Math.max(worstMiss, dist(figure(s, "model", "LeftHand"), [limb.target.x, limb.target.y, limb.target.z]));
      // The elbow lies on the back side of the line from the shoulder to the hand (in the mesh frame the character looks along +Z).
      wrongSide = Math.min(wrongSide, bendSide(figure(s, "model", "LeftArm"), figure(s, "model", "LeftForeArm"), figure(s, "model", "LeftHand"), BACK));
    }
    writeProbe("reach-clamp", { worstMiss, worstReach, worstAngleDegrees: (worstAngle * 180) / Math.PI, clamped, elbowSideMin: wrongSide });
    expect(clamped, "frames in which the orb is out of reach").toBeGreaterThan(30);
    expect(worstReach, "hand-to-shoulder distance against the clamped reach (m)").toBeLessThan(2e-3);
    // The goal is computed from the shoulder as the program reads it at its update; the hips bob and the placement's drop move the shoulder by
    // a few millimetres before the pose is final, which over the 0.5 m of the clamped reach is up to 0.02 rad.
    expect(worstMiss, "the hand is on the goal the solver holds (m)").toBeLessThan(1e-4);
    expect(worstAngle, "the hand stays on the line from the shoulder to the orb (rad)").toBeLessThan(0.02);
    expect(wrongSide, "the elbow is never on the front side").toBeGreaterThanOrEqual(-1e-5);
  });

  const RUNS: ReadonlyArray<{ name: string; steps: Step[] }> = [
    { name: "over the curb and across it", steps: [tap("Digit2"), wait(20), hold(["KeyW", "ShiftLeft"], 110), hold(["KeyW"], 60)] },
    { name: "up the stairs, over the plateau and down the ramp", steps: [tap("Digit3"), wait(20), hold(["KeyW", "ShiftLeft"], 190), hold(["KeyW"], 120)] },
  ];
  for (const { name, steps } of RUNS) {
    test(`knees never bend backwards, ${name}`, async ({ page }) => {
      const result = await run(page, steps, { model: "all", animated: [] });
      let kneeSide = Infinity, flexionMax = 0, flexionMin = Infinity, frames = 0, drop = 0;
      for (const s of result.samples) {
        for (const side of ["Left", "Right"]) {
          const side1 = bendSide(figure(s, "model", `${side}UpLeg`), figure(s, "model", `${side}Leg`), figure(s, "model", `${side}Foot`), FRONT);
          kneeSide = Math.min(kneeSide, side1);
        }
        const fp = s.model.footPlacement;
        if (fp !== null) {
          frames += 1;
          for (const leg of [fp.left, fp.right]) {
            flexionMax = Math.max(flexionMax, leg.flexion);
            flexionMin = Math.min(flexionMin, leg.flexion);
          }
          drop = Math.max(drop, fp.drop);
        }
      }
      writeProbe(`knees-${name.split(" ")[0]}-${name.split(" ")[1]}`, { kneeSideMin: kneeSide, flexionMin, flexionMax, frames, largestDrop: drop });
      expect(frames, "foot placement is active in every frame after setup").toBeGreaterThan(result.samples.length - 3);
      expect(kneeSide, "the knee is on the front side of the hip-ankle line in every frame (m)").toBeGreaterThanOrEqual(-1e-5);
      expect(flexionMin, "knee flexion never negative").toBeGreaterThanOrEqual(0);
      expect(flexionMax, "and never beyond 150 degrees").toBeLessThanOrEqual((150 * Math.PI) / 180);
      expect(drop, "the hips were lowered somewhere on this course").toBeGreaterThan(0.02);
    });
  }

  test("the tail's tip follows the point the chain goal gives it, and the goal is the program's swinging point", async ({ page }) => {
    const result = await run(page, [wait(240)], { model: "all", animated: [] });
    let worst = 0, worstGoal = 0, swing = 0;
    for (const s of result.samples.slice(2)) {
      const chain = s.model.ik.find((c) => c.id === "tail");
      expect(chain, "the tail goal is set every frame").toBeDefined();
      const target: V3 = [chain!.target.x, chain!.target.y, chain!.target.z];
      worst = Math.max(worst, dist(figure(s, "model", "Tail4"), target));
      // The program's point: 0.3 m to the side, 0.75 m up and 0.5 m behind the soles, the side swinging at 2.5 rad/s (frame.time is the clock after this frame).
      const expected: V3 = [0.3 * Math.sin(2.5 * s.time), 0.75, -0.5];
      worstGoal = Math.max(worstGoal, dist(target, expected));
      swing = Math.max(swing, Math.abs(target[0]));
    }
    writeProbe("tail", { worstTipMiss: worst, worstGoalError: worstGoal, swing });
    expect(chainLength(result.samples[2]!), "the chain is the four joints of the tail").toBe(3);
    expect(swing, "the goal swings out to the side").toBeGreaterThan(0.29);
    expect(worstGoal, "the goal is the program's expression (m)").toBeLessThan(1e-5);
    // The point is within the tail's length (0.62 m from its root); 12 iterations of CCD put the tip within a millimetre of it.
    // (the chain goal stops iterating within 1 mm: `chain_goal` uses the default tolerance of `player.ik.set`; the half-micrometre is the 32-bit rounding)
    expect(worst, "largest distance of the tail's tip from its goal (m)").toBeLessThanOrEqual(1e-3 + 5e-7);
  });

  function chainLength(s: Sample): number {
    return (s.model.ik.find((c) => c.id === "tail")?.chain.length ?? 0) - 1;
  }

  test("T switches the tail goal off and the tail goes back to the animation", async ({ page }) => {
    // Foot placement off (P), so that nothing but the goal differs between the figure and its unlayered twin.
    const result = await run(page, [hold(["KeyP"], 1), wait(30), tap("KeyT"), wait(30)], { model: "all", animated: "all" });
    const last = result.samples.at(-1)!;
    expect(last.model.ik, "no chain goal").toEqual([]);
    expect(dist(figure(last, "model", "Tail4"), figure(last, "animated", "Tail4")), "the tail is the animated one").toBeLessThan(1e-6);
    const first = result.samples[20]!;
    expect(dist(figure(first, "model", "Tail4"), figure(first, "animated", "Tail4")), "and with the goal it was not").toBeGreaterThan(0.01);
  });
});
