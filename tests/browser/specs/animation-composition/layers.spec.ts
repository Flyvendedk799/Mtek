// Decision 0224: the upper-body layer of `examples/animation-composition` on the real engine, both backends, manual clock.
//
//   mask    the `Wave` clip is a whole-body pose (hips, legs, tail and the waving arm), the layer is masked to `Spine1` and its
//           descendants: every joint outside that subtree must be exactly where the same run without the layer puts it. The
//           reference run is the example's own `Ghost`, the same blend of the same clips with no layer, no goal and no placement
//           (keys P and T switch the example's foot placement and tail goal off, so the only difference between the figures is the layer);
//   fade    weights follow `from + (to - from) * smoothstep(elapsed / 0.4)` from the weight at the moment of each key change
//           (spec/animation.md 1.2), at every frame partition, because the fade is advanced by the frame time and nothing else;
//   phase   the layer's clock runs on through weight zero, so its time is the time since it was set, whatever the fades did.
import { expect, test } from "../../support/fixtures.ts";
import { animationConstant } from "../../support/animation-example.ts";
import { dist, heroRig, smoothstep01, type V3 } from "../../support/animation-reference.ts";
import { collectProblems, figure, run, writeProbe } from "../../support/animation-harness.ts";
import { hold, plan, wait, type PatternName, type Step } from "../../support/movement-drive.ts";

// The program's constant is an f32.
const FADE = Math.fround(animationConstant("WAVE_FADE"));
const F = ["KeyF"];

/** Names of the node `root` and its descendants in the Hero's skeleton, from the model file. */
function subtree(root: string): Set<string> {
  const { nodes } = heroRig().skin;
  const out = new Set<string>();
  nodes.forEach((node, i) => {
    for (let at = i; at >= 0; at = nodes[at]!.parent) {
      if (nodes[at]!.name === root) {
        out.add(node.name);
        break;
      }
    }
  });
  return out;
}

/** The weight a layer faded by key events has at `time`: events are [time, target]; each fade starts from the weight reached so far. */
function referenceWeight(events: ReadonlyArray<readonly [number, number]>, time: number, initial = 0): number {
  let from = initial, to = initial, start = 0;
  const at = (t: number): number => (t - start >= FADE ? to : from + (to - from) * smoothstep01((t - start) / FADE));
  for (const [t, target] of events) {
    // An event at the start of a frame is at the end time of the previous frame: it does not act on that frame's sample.
    if (t >= time - 1e-9) break;
    from = at(t);
    to = target;
    start = t;
  }
  return at(time);
}

/** The times (sums of frame times before the frame) at which the plan presses or releases `key`. */
function keyTimes(steps: readonly Step[], pattern: PatternName, key: string): { press: number[]; release: number[] } {
  const press: number[] = [], release: number[] = [];
  let time = 0;
  for (const frame of plan(steps, pattern, 7)) {
    if (frame.press.includes(key) && !frame.release.includes(key)) press.push(time);
    if (frame.release.includes(key) && !frame.press.includes(key)) release.push(time);
    time += frame.dt;
  }
  return { press, release };
}

test.describe("upper-body layer of the example (decision 0224)", () => {
  let problems: ReturnType<typeof collectProblems>;
  test.beforeEach(({ page, gpu }) => {
    void gpu;
    problems = collectProblems(page);
  });
  test.afterEach(() => problems.check());

  test("the mask moves only the Spine1 subtree: every other joint is where it is without the layer", async ({ page }) => {
    const steps = [hold(["KeyP", "KeyT"], 1), wait(60), hold(F, 90), wait(30)];
    const result = await run(page, steps, { model: "all", ghost: "all" });
    const inside = subtree("Spine1");
    expect([...inside].sort()).toEqual(["Head", "HeadTop_End", "LeftArm", "LeftForeArm", "LeftHand", "Neck", "RightArm", "RightForeArm", "RightHand", "Spine1"]);
    const names = Object.keys(result.samples[0]!.model.nodes);
    expect(names.length).toBe(heroRig().skin.nodes.length);
    const before = result.samples[60]!;
    const faded = result.samples[61 + 70]!;
    expect(faded.model.layers[0]?.weight, "the layer is fully faded in").toBe(1);
    expect(before.model.layers[0]?.weight, "and out before the key").toBe(0);
    let outsideBefore = 0, outsideFaded = 0, moved = 0;
    const movedBy: Record<string, number> = {};
    for (const name of names) {
      const dBefore = dist(figure(before, "model", name), figure(before, "ghost", name));
      const dFaded = dist(figure(faded, "model", name), figure(faded, "ghost", name));
      if (inside.has(name)) {
        movedBy[name] = dFaded;
        moved = Math.max(moved, dFaded);
        expect(dBefore, `${name} before the layer`).toBeLessThan(1e-6);
      } else {
        outsideBefore = Math.max(outsideBefore, dBefore);
        outsideFaded = Math.max(outsideFaded, dFaded);
      }
    }
    // Over the whole run, whatever the weight: outside the subtree no joint ever differs from the unlayered figure.
    let outsideEver = 0;
    for (const s of result.samples) for (const name of names) if (!inside.has(name)) outsideEver = Math.max(outsideEver, dist(figure(s, "model", name), figure(s, "ghost", name)));
    writeProbe("layer-mask", { outsideBefore, outsideFaded, outsideEver, insideMovedBy: movedBy });
    expect(outsideEver, "largest distance of a joint outside the mask from the unlayered figure over the run").toBeLessThan(1e-6);
    // Inside it the waving shows: the right hand is raised and off to the side, and the layer changed the arms, neck and head.
    expect(movedBy["RightHand"], "the right hand moved").toBeGreaterThan(0.3);
    expect(movedBy["HeadTop_End"], "the head turned (its top moved)").toBeGreaterThan(0.02);
    expect(movedBy["LeftHand"], "the left hand moved (its parent Spine1 turned)").toBeGreaterThan(0.01);
    expect(figure(faded, "model", "RightHand")[1], "the waving hand is above the shoulder").toBeGreaterThan(figure(faded, "model", "RightArm")[1]);
    // The clip itself is whole-body: without the mask the legs would have moved (the Wave pose differs from idle in the hips and feet).
    const clip = heroRig().skin.clips.find((c) => c.name === "Wave")!;
    const hipsNode = heroRig().skin.nodes.findIndex((n) => n.name === "Hips");
    expect(clip.channels.some((c) => c.node === hipsNode), "the Wave clip has channels outside the masked subtree").toBe(true);
  });

  const PATTERNS: PatternName[] = ["tick", "30", "60", "144", "jitter"];
  const FADE_STEPS = [wait(40), hold(F, 40), wait(60), hold(F, 12), hold([], 5), hold(F, 20), hold([], 14), hold(F, 60), wait(80)];

  for (const pattern of PATTERNS) {
    test(`the layer weight follows the smoothstep from where it was at each key change, interrupted fades included (frame pattern ${pattern})`, async ({ page }) => {
      const result = await run(page, FADE_STEPS, { pattern, seed: 7, model: ["Hips"], ghost: ["Hips"] });
      const { press, release } = keyTimes(FADE_STEPS, pattern, "KeyF");
      expect(press.length, "three presses").toBe(3 + 1);
      expect(release.length).toBe(3 + 1);
      const events = [...press.map((t) => [t, 1] as const), ...release.map((t) => [t, 0] as const)].sort((a, b) => a[0] - b[0]);
      let worst = 0, interrupted = 0, phase = 0;
      const frames = plan(FADE_STEPS, pattern, 7);
      for (const s of result.samples) {
        const layer = s.model.layers.find((l) => l.id === "wave");
        expect(layer, "the layer exists after the first frame").toBeDefined();
        const expected = referenceWeight(events, s.time);
        worst = Math.max(worst, Math.abs(layer!.weight - expected));
        // The remaining fade time is what is left of FADE since the last key change, and the target is the last key's.
        const last = events.filter(([t]) => t < s.time - 1e-9).at(-1);
        if (last !== undefined) {
          expect(layer!.targetWeight, `target at ${s.time.toFixed(3)} s`).toBe(last[1]);
          if (s.time - last[0] < FADE - 0.05 && layer!.weight > 0.05 && layer!.weight < 0.95) interrupted += 1;
        }
        // The layer's clock: set in the update of the first frame (after the advance), then advanced by every frame, whatever the weight.
        const clockTime = (s.time - frames[0]!.dt) % 1.6;
        phase = Math.max(phase, Math.min(Math.abs(layer!.time - clockTime), 1.6 - Math.abs(layer!.time - clockTime)));
      }
      writeProbe(`layer-fade-${pattern}`, { worstWeightError: worst, samples: result.samples.length, midFadeSamples: interrupted, worstPhaseError: phase });
      expect(worst, "largest difference between the layer's weight and the reference").toBeLessThan(1e-9);
      expect(phase, "the layer's clock is the time since it was set").toBeLessThan(1e-6);
      expect(interrupted, "samples in the middle of a fade").toBeGreaterThan(10);
      expect(Math.max(...result.samples.map((x) => x.model.layers[0]!.weight)), "reaches one during the long hold").toBe(1);
      expect(result.samples.at(-1)?.model.layers[0]?.weight, "and is faded out at the end").toBe(0);
    });
  }

  test("the weight is continuous: it never moves by more than the smoothstep's steepest slope times the time since the last frame", async ({ page }) => {
    const result = await run(page, FADE_STEPS, { model: ["Hips"], ghost: ["Hips"] });
    let worst = 0;
    for (let i = 1; i < result.samples.length; i += 1) {
      const a = result.samples[i - 1]!, b = result.samples[i]!;
      const dw = Math.abs(b.model.layers[0]!.weight - a.model.layers[0]!.weight);
      worst = Math.max(worst, dw / (b.time - a.time));
    }
    writeProbe("layer-slope", { steepest: worst, bound: 1.5 / FADE });
    // d/dt of a smoothstep fade from `from` to `to` is at most 1.5 |to - from| / FADE.
    expect(worst).toBeLessThanOrEqual(1.5 / FADE + 1e-9);
  });

  test("hips of the layered figure are those of the unlayered one while the wave is on (nothing moves the body)", async ({ page }) => {
    const steps = [hold(["KeyP", "KeyT"], 1), wait(30), hold(F, 60)];
    const result = await run(page, steps, { model: ["Hips", "LeftFoot", "RightFoot"], ghost: ["Hips", "LeftFoot", "RightFoot"] });
    const last = result.samples.at(-1)!;
    const same = (name: string): number => dist(figure(last, "model", name) as V3, figure(last, "ghost", name) as V3);
    expect(same("Hips")).toBeLessThan(1e-6);
    expect(same("LeftFoot")).toBeLessThan(1e-6);
    expect(same("RightFoot")).toBeLessThan(1e-6);
  });
});
