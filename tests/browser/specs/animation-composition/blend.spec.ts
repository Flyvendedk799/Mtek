// Decision 0224: the 2D blend space and the root motion of `examples/animation-composition`, on the real engine, on the hardware
// and the software WebGPU configurations, with the manual clock and scripted keys.
//
// Every expected number is derived from something other than the running program's own result:
//   weights      the Delaunay barycentric coordinates of the parameter in the example's sample layout, worked out by hand
//                (support/animation-reference.ts, `referenceBlendWeights`), with the hull clamp of decision 0220;
//   continuity   the weights' Lipschitz constant from the triangle altitudes, and the fastest joint motion of the clips
//                themselves, measured by playing each clip alone on a CPU player;
//   root motion  the translation of the `Root` joint over one cycle of the clip in the GLB file, divided by its duration;
//   display rate the animation clock is variable-step (phase 3 advances by the frame time, spec/animation.md 1.1), so a result that
//                depends on the weights is a function of the frame partition within the documented sample-and-hold of the
//                weights; what the program computes itself with the frame time (the parameter's exponential follow, the layer
//                fades) is independent of it, and is asserted equal.
import { expect, test } from "../../support/fixtures.ts";
import { ANIMATION_SOURCE_LITERALS, animationSource } from "../../support/animation-example.ts";
import { BLEND_LAYOUT, add, cpuPose, clipTravel, dist, heroRig, norm, referenceBlendWeights, rotateY, scale, sub, type V3 } from "../../support/animation-reference.ts";
import { TRACKED, collectProblems, figure, run, writeProbe } from "../../support/animation-harness.ts";
import { hold, plan, wait, type PatternName } from "../../support/movement-drive.ts";
import { STEP } from "../../support/movement-example.ts";

const W = ["KeyW"], RUN = ["KeyW", "ShiftLeft"], E = ["KeyE"], Q = ["KeyQ"], WE = ["KeyW", "KeyE"], WQ = ["KeyW", "KeyQ"];

test.describe("2D blend space and root motion of the example (decision 0224)", () => {
  let problems: ReturnType<typeof collectProblems>;
  test.beforeEach(({ page, gpu }) => {
    void gpu;
    problems = collectProblems(page);
  });
  test.afterEach(() => problems.check());

  test("the program's sample layout is the one the reference transcribes", () => {
    const source = animationSource();
    for (const literal of ANIMATION_SOURCE_LITERALS) expect(source, literal).toContain(literal);
    for (const { clip, x, y } of BLEND_LAYOUT) expect(source).toContain(`animation.blend_sample(Model, "${clip}", ${x.toFixed(1)}, ${y.toFixed(1)});`);
  });

  /** Largest displacement of each tracked joint between two evaluations `dt` apart over two cycles of every clip played alone. */
  function clipStepBound(dt: number): Map<string, number> {
    const bound = new Map<string, number>();
    const skin = heroRig().skin;
    for (const clip of BLEND_LAYOUT.map((l) => l.clip)) {
      const duration = skin.clips.find((c) => c.name === clip)!.duration;
      let previous = cpuPoseOwned(clip, 0);
      for (let t = dt; t <= 2 * duration; t += dt) {
        const now = cpuPoseOwned(clip, t);
        for (const name of TRACKED) if (name !== "Root") bound.set(name, Math.max(bound.get(name) ?? 0, dist(now.get(name)!, previous.get(name)!)));
        previous = now;
      }
    }
    return bound;
  }
  /** The pose with the root travel taken out, as the example displays it (it owns the `Root` joint). */
  const cpuPoseOwned = (clip: string, t: number): Map<string, V3> => cpuPose(heroRig().skin, clip, t, "Root").nodes;

  /** Largest distance between two clips' poses of a tracked joint at one shared normalised phase. */
  function clipDifferenceBound(): Map<string, number> {
    const bound = new Map<string, number>();
    const skin = heroRig().skin;
    const clips = BLEND_LAYOUT.map((l) => ({ name: l.clip, duration: skin.clips.find((c) => c.name === l.clip)!.duration }));
    for (let k = 0; k < 40; k += 1) {
      const poses = clips.map((c) => cpuPoseOwned(c.name, (k / 40) * c.duration));
      for (let i = 0; i < poses.length; i += 1) for (let j = i + 1; j < poses.length; j += 1) for (const name of TRACKED) if (name !== "Root") bound.set(name, Math.max(bound.get(name) ?? 0, dist(poses[i]!.get(name)!, poses[j]!.get(name)!)));
    }
    return bound;
  }

  test("the weights are the Delaunay barycentric weights of the parameter, with the hull clamp, and the pose is continuous while it moves", async ({ page }) => {
    const steps = [wait(30), hold(WE, 90), wait(90), hold(WQ, 90), hold(RUN, 90), hold(E, 90), hold(Q, 120), wait(100)];
    const result = await run(page, steps);
    const samples = result.samples;
    const layoutOrder = BLEND_LAYOUT.map((l) => l.clip);
    let worst = 0;
    let outside = 0;
    let threeWay = 0;
    let previous: { p: [number, number]; w: number[] } | undefined;
    let lipschitzWorst = 0;
    for (const s of samples) {
      const blend = s.model.blend;
      expect(blend, "a blend space is active").not.toBeNull();
      const p: [number, number] = [Number(s.state["blend_x"]), Number(s.state["blend_y"])];
      expect(blend!.parameter.x).toBeCloseTo(p[0], 6);
      expect(blend!.parameter.y).toBeCloseTo(p[1], 6);
      expect(blend!.samples.map((x) => x.clip)).toEqual(layoutOrder);
      const w = blend!.samples.map((x) => x.weight);
      const expected = referenceBlendWeights(p[0], p[1]);
      for (let i = 0; i < w.length; i += 1) worst = Math.max(worst, Math.abs(w[i]! - expected[i]!));
      expect(w.reduce((sum, v) => sum + v, 0)).toBeCloseTo(1, 9);
      if (w.filter((v) => v > 1e-6).length >= 3) threeWay += 1;
      // Outside the hull: the triangle LEFT, RIGHT, RUN, edge RIGHT-RUN is x = 1 - y / 2.
      if (p[0] > 1 - p[1] / 2 + 0.02 && p[1] > 0.02) outside += 1;
      if (previous !== undefined) {
        const dp = Math.hypot(p[0] - previous.p[0], p[1] - previous.p[1]);
        for (let i = 0; i < w.length; i += 1) lipschitzWorst = Math.max(lipschitzWorst, dp === 0 ? 0 : Math.abs(w[i]! - previous.w[i]!) / dp);
      }
      previous = { p, w };
    }
    writeProbe("blend-weights", { samples: samples.length, worstWeightError: worst, outsideHullSamples: outside, threeWaySamples: threeWay, lipschitz: lipschitzWorst });
    expect(worst, "largest difference between a weight of the run and of the reference").toBeLessThan(2e-6);
    // The run visits the interior of every triangle region, the hull edge beyond and clamps outside it.
    expect(threeWay, "samples with three active clips").toBeGreaterThan(30);
    expect(outside, "samples whose parameter is outside the hull").toBeGreaterThan(30);
    // Continuity of the weights: the largest altitude-based gradient of the layout is 1 / 0.4472 (triangle LEFT, WALK, RUN).
    expect(lipschitzWorst, "weights change by at most the layout's Lipschitz constant times the parameter step").toBeLessThan(1 / 0.4472 + 1e-3);
    // At a sample the weight is one: the parameter has settled on RUN, on the right strafe, on the left strafe and on idle.
    const settled = (at: number): number[] => samples[at]!.model.blend!.samples.map((x) => x.weight);
    expect(settled(30 + 90 + 90 + 90 + 90 - 1)[2], "run after 1.5 s of Shift+W").toBeGreaterThan(0.99999);
    expect(settled(30 + 90 * 5 - 1)[4], "right strafe after 1.5 s of E").toBeGreaterThan(0.99999);
    expect(settled(30 + 90 * 5 + 120 - 1)[3], "left strafe after 2 s of Q").toBeGreaterThan(0.99999);
    expect(settled(samples.length - 1)[0], "idle after 1.7 s of no keys").toBeGreaterThan(0.99999);

    // The pose is continuous: in one frame a joint moves by at most what the fastest clip alone moves it, plus what the change of the
    // weights moves it (half their L1 change times the largest distance between two clips' poses at one phase), each with
    // 25 % and 3 mm for the 32-bit positions and the blend of rotations.
    const bound = clipStepBound(STEP);
    const apart = clipDifferenceBound();
    let ratioWorst = 0;
    for (let i = 1; i < samples.length; i += 1) {
      const dw = samples[i]!.model.blend!.samples.reduce((sum, x, k) => sum + Math.abs(x.weight - samples[i - 1]!.model.blend!.samples[k]!.weight), 0);
      for (const name of TRACKED) {
        if (name === "Root") continue;
        const a = figure(samples[i - 1]!, "ghost", name);
        const b = figure(samples[i]!, "ghost", name);
        const step = dist(a, b);
        const allowed = 1.25 * (bound.get(name)! + 0.5 * dw * apart.get(name)!) + 0.003;
        ratioWorst = Math.max(ratioWorst, step / allowed);
        expect(step, `${name} in frame ${String(i)}`).toBeLessThanOrEqual(allowed);
      }
    }
    writeProbe("blend-continuity", { worstRatioToAllowed: ratioWorst, clipStep: Object.fromEntries(bound), clipDifference: Object.fromEntries(apart) });
    // The bound is not vacuous: the clips differ from each other by far more than a frame's motion.
    expect(apart.get("LeftHand")!, "idle and run differ by more than a step").toBeGreaterThan(5 * bound.get("LeftHand")!);
  });

  const GAITS: ReadonlyArray<{ name: string; keys: string[]; clip: string; cycle: number; cycles: number }> = [
    { name: "walk", keys: W, clip: "Walk", cycle: 1.0, cycles: 1 },
    { name: "run", keys: RUN, clip: "Run", cycle: 0.7, cycles: 1 },
    { name: "strafe left", keys: Q, clip: "StrafeLeft", cycle: 0.8, cycles: 2 },
    { name: "strafe right", keys: E, clip: "StrafeRight", cycle: 0.8, cycles: 2 },
  ];

  for (const gait of GAITS) {
    test(`root motion: the body moves at the speed of the ${gait.name} clip's own travel`, async ({ page }) => {
      const travel = clipTravel(heroRig().skin, gait.clip, "Root");
      // Whole cycles; the tick pattern (one frame per fixed tick) makes the lag between the animation and the body constant.
      const ticks = Math.round(gait.cycles * gait.cycle / STEP);
      const result = await run(page, [wait(10), hold(gait.keys, 60), hold(gait.keys, ticks)], { sample: "boundary" });
      const a = result.samples[1]!, b = result.samples[2]!;
      const dt = b.time - a.time;
      const speed: V3 = scale(sub([b.hero.position.x, b.hero.position.y, b.hero.position.z], [a.hero.position.x, a.hero.position.y, a.hero.position.z]), 1 / dt);
      writeProbe(`root-${gait.clip}`, { clipTravel: travel, measured: speed, window: dt });
      expect(norm(travel), "the clip travels").toBeGreaterThan(0.5);
      // 2 mm/s over the window: the body is moved in 32-bit floats by the fixed ticks (measured below 0.7 mm/s on both backends).
      expect(Math.abs(speed[0] - travel[0]), "x speed against the clip's").toBeLessThan(0.002);
      expect(Math.abs(speed[1]), "no vertical travel on flat ground").toBeLessThan(0.002);
      expect(Math.abs(speed[2] - travel[2]), "z speed against the clip's").toBeLessThan(0.002);
    });
  }

  test("root motion follows the facing: after a turn the body walks along the heading", async ({ page }) => {
    const travel = clipTravel(heroRig().skin, "Walk", "Root");
    const result = await run(page, [wait(10), hold(["KeyA"], 47), wait(40), hold(W, 150), hold(W, 60)], { sample: "boundary" });
    const heading = Number(result.samples[3]!.state["heading"]);
    const a = result.samples[3]!, b = result.samples[4]!;
    const dt = b.time - a.time;
    const d = sub([b.hero.position.x, 0, b.hero.position.z], [a.hero.position.x, 0, a.hero.position.z]);
    const expected = rotateY(scale(travel, dt), heading);
    writeProbe("root-heading", { heading, displacement: d, expected });
    expect(heading, "turned about 47 ticks at 2 rad/s").toBeCloseTo(2 * 47 * STEP, 2);
    expect(dist(d, expected), "displacement over one second against the clip's, turned by the heading").toBeLessThan(0.002);
    expect(norm(add(d, [0, 0, 0]))).toBeGreaterThan(1);
  });

  test("display rate: the program's own frame-time arithmetic is exact, the weight-dependent results agree within the sample-and-hold of the weights", async ({ page }) => {
    test.setTimeout(300_000);
    const script = [wait(30), hold(W, 150), wait(240)];
    const patterns: PatternName[] = ["30", "60", "144", "jitter"];
    const runs = new Map<PatternName, Awaited<ReturnType<typeof run>>>();
    for (const pattern of patterns) runs.set(pattern, await run(page, script, { pattern, sample: "boundary", seed: 7 }));
    const reference = runs.get("144")!;
    const rows: Array<Record<string, unknown>> = [];
    for (const pattern of patterns) {
      const other = runs.get(pattern)!;
      expect(other.samples.length).toBe(reference.samples.length);
      let parameter = 0, position = 0, phase = 0;
      for (let i = 0; i < other.samples.length; i += 1) {
        const a = reference.samples[i]!, b = other.samples[i]!;
        expect(Math.abs(a.time - b.time), `time at boundary ${String(i)}`).toBeLessThan(1e-4);
        parameter = Math.max(parameter, Math.abs(Number(a.state["blend_y"]) - Number(b.state["blend_y"])), Math.abs(Number(a.state["blend_x"]) - Number(b.state["blend_x"])));
        position = Math.max(position, dist([a.hero.position.x, a.hero.position.y, a.hero.position.z], [b.hero.position.x, b.hero.position.y, b.hero.position.z]));
        phase = Math.max(phase, Math.abs((a.model.blend?.phase ?? 0) - (b.model.blend?.phase ?? 0)));
      }
      const last = other.samples.at(-1)!, lastRef = reference.samples.at(-1)!;
      rows.push({ pattern, parameter, position, phase, finalPosition: dist([last.hero.position.x, last.hero.position.y, last.hero.position.z], [lastRef.hero.position.x, lastRef.hero.position.y, lastRef.hero.position.z]) });
    }
    writeProbe("display-rate", rows);
    // The parameter follows the keys with `1 - exp(-dt / tau)` per frame, which composes exactly: the same at every boundary.
    const speed = norm(clipTravel(heroRig().skin, "Walk", "Root"));
    const rate = (clip: string): number => 1 / heroRig().skin.clips.find((c) => c.name === clip)!.duration;
    const rateGap = rate("Walk") - rate("Idle");
    for (const row of rows) {
      const frames = plan(script, row["pattern"] as PatternName, 7);
      const longest = Math.max(...frames.map((f) => f.dt), 1 / 144);
      expect(row["parameter"] as number, `parameter, pattern ${String(row["pattern"])}`).toBeLessThan(2e-6);
      // The weights an advance uses are those at its start (spec/animation.md 1.1), a left-endpoint rule: the pose lags the parameter by
      // half a frame, and the program starts the blend in its first update, after the first advance, so the phase origin is one frame
      // late. Hence the phase differs between two partitions by at most (idle rate + half the rate gap) times the longer frame, the
      // body by at most the walking speed times (a frame and a tick, the lag of the fixed step). After the body has stopped the lags
      // cancel: the resting positions agree to 1 cm.
      expect(row["position"] as number, `position, pattern ${String(row["pattern"])}`).toBeLessThan(speed * (longest + STEP) + 0.002);
      expect(row["phase"] as number, `phase, pattern ${String(row["pattern"])}`).toBeLessThan((rate("Idle") + 0.5 * rateGap) * longest + 1e-3);
      expect(row["finalPosition"] as number, `resting position, pattern ${String(row["pattern"])}`).toBeLessThan(0.01);
    }
  });
});
