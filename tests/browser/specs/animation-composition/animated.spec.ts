// Decision 0224: `animation.animated_joint_position`, the pose before limb, foot and chain goals, on the real engine, both backends, manual clock.
//
// The example places the feet, reaches with the left hand and drives the tail while it walks, so its final pose differs from the animation's.
// The reference for the animated pose is an independent CPU player of the Hero's skin that replays the program's animation calls frame by
// frame (the first advance plays Idle, the first update starts the blend and owns `Root`, every update moves the parameter to the value
// the program computed, here read from its state) and has no goal at all. Every joint the program reads through
// `animated_joint_position` must be where that player has it; the final pose must differ from it, so the test could tell the two apart.
// The example has no twin entity any more: the scene lists no entity but its own.
import { AnimationController } from "../../../../packages/runtime-web/src/animation.js";
import { expect, test } from "../../support/fixtures.ts";
import { animationSource } from "../../support/animation-example.ts";
import { BLEND_LAYOUT, dist, heroRig, type V3 } from "../../support/animation-reference.ts";
import { collectProblems, run, writeProbe } from "../../support/animation-harness.ts";
import { hold, plan, wait, type Step } from "../../support/movement-drive.ts";

test.describe("the animated pose before goals (decision 0224)", () => {
  let problems: ReturnType<typeof collectProblems>;
  test.beforeEach(({ page, gpu }) => {
    void gpu;
    problems = collectProblems(page);
  });
  test.afterEach(() => problems.check());

  test("animated_joint_position is the pose of a goal-free CPU player replaying the program, while the final pose is placed, reached and wagged", async ({ page }) => {
    const steps: Step[] = [wait(20), hold(["KeyW", "KeyE", "KeyG"], 90), hold(["KeyW", "ShiftLeft", "KeyG"], 60), hold(["KeyG"], 40)];
    const result = await run(page, steps, { model: "all", animated: "all" });
    const frames = plan(steps, "tick", 1);
    expect(result.samples.length).toBe(frames.length);
    const hero = heroRig().skin;
    const cpu = new AnimationController(hero, { clip: "Idle" });
    let worst = 0, apart = 0, reaching = 0, placed = 0;
    for (const [i, frame] of frames.entries()) {
      const s = result.samples[i]!;
      cpu.player.advance(frame.dt);
      if (i === 0) {
        cpu.setBlendSpace({ samples: BLEND_LAYOUT.map(({ clip, x, y }) => ({ clip, x, y })), looping: true, speed: 1 });
        cpu.player.setRootMotion("Root");
      }
      cpu.setBlendParameter(Number(s.state["blend_x"]), Number(s.state["blend_y"]));
      cpu.player.evaluate();
      const reference = new Map(cpu.player.inspect?.().nodes.map((n) => [n.name, [n.position.x, n.position.y, n.position.z] as V3]));
      for (const [name, position] of Object.entries(s.animated.nodes)) {
        worst = Math.max(worst, dist(position, reference.get(name)!));
        apart = Math.max(apart, dist(s.model.nodes[name]!, position));
      }
      if (s.model.limbs.length > 0) reaching += 1;
      if (s.model.footPlacement !== null) placed += 1;
    }
    cpu.dispose();
    writeProbe("animated-pose", { worstAnimatedVsCpu: worst, finalApartFromAnimated: apart, framesReaching: reaching, framesPlaced: placed, frames: frames.length });
    expect(worst, "largest distance between an animated joint of the page and the goal-free CPU player's (m)").toBeLessThan(1e-5);
    expect(apart, "the final pose is not the animated one: goals moved it by at least 5 cm somewhere").toBeGreaterThan(0.05);
    expect(reaching, "frames with the hand goal").toBeGreaterThan(100);
    expect(placed, "frames with foot placement").toBeGreaterThan(frames.length - 3);
  });

  test("with every goal off the animated pose is the final pose, to the last bit", async ({ page }) => {
    // P switches foot placement off and T the tail goal; no G, so no hand goal.
    const result = await run(page, [hold(["KeyP", "KeyT"], 1), wait(10), hold(["KeyW"], 80), wait(20)], { model: "all", animated: "all" });
    let worst = 0;
    for (const s of result.samples.slice(3)) for (const [name, position] of Object.entries(s.animated.nodes)) worst = Math.max(worst, dist(position, s.model.nodes[name]!));
    expect(worst, "animated against final with no goal set (m)").toBe(0);
  });

  test("the example has no twin: its scene has the Hero's figure and the Guest as the only skeletons", async ({ page }) => {
    expect(animationSource()).not.toContain("Ghost");
    const result = await run(page, [wait(5)], { model: [], animated: [] });
    expect(Object.keys(result.ids).sort()).toEqual(["Guest", "Model"]);
    expect(result.entityNames).not.toContain("Ghost");
    expect(result.entityNames).toEqual(expect.arrayContaining(["Hero", "Model", "Guest", "Orb"]));
  });
});
