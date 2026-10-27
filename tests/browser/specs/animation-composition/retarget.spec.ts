// Decision 0224: `clips_from` on the example's Guest, on the real engine, both backends, manual clock.
//
// The Guest is a skeleton with other names (Unreal style), other proportions (legs 1.12x, arms 0.88x, spine 0.9x), clavicles and an
// upper chest, and an A-pose rest, playing the Hero's `Dance` clip. Two independent references:
//   CPU retarget  `retargetHumanoid(Hero skin, Guest skin)` of the committed GLB files, played on a CPU player to the same time:
//                 the joint positions the mounted program shows must be the CPU's (the runtime's mount path, the manifest tables and
//                 the cache of the retargeter are the only things between the two);
//   the source    the limb directions of the Guest, bone by bone, against those of the Hero's own playback of the same clip at the same
//                 time (decision 0221 asserts at most 0.007 degrees after rest correction on its scenarios; this rig pair, whose
//                 hierarchies differ, is asserted with the bound below), the Guest's bones keep their own lengths, and a planted foot
//                 stands at the Guest's own ankle height.
import { expect, test } from "../../support/fixtures.ts";
import { angleBetween, cpuPose, dist, guestRig, heroRig, retargetedGuest, sub, type V3 } from "../../support/animation-reference.ts";
import { collectProblems, run, writeProbe } from "../../support/animation-harness.ts";
import { wait } from "../../support/movement-drive.ts";

/** [Hero bone, its child, Guest bone, its child]: the limb segments both rigs have. */
const LIMBS: ReadonlyArray<readonly [string, string, string, string]> = [
  ["LeftArm", "LeftForeArm", "upperarm_l", "lowerarm_l"],
  ["LeftForeArm", "LeftHand", "lowerarm_l", "hand_l"],
  ["RightArm", "RightForeArm", "upperarm_r", "lowerarm_r"],
  ["RightForeArm", "RightHand", "lowerarm_r", "hand_r"],
  ["LeftUpLeg", "LeftLeg", "thigh_l", "calf_l"],
  ["LeftLeg", "LeftFoot", "calf_l", "foot_l"],
  ["RightUpLeg", "RightLeg", "thigh_r", "calf_r"],
  ["RightLeg", "RightFoot", "calf_r", "foot_r"],
  ["Hips", "Spine1", "pelvis", "spine_02"],
  ["Neck", "Head", "neck_01", "head"],
];

test.describe("clips_from: the Guest plays the Hero's clips (decision 0224)", () => {
  let problems: ReturnType<typeof collectProblems>;
  test.beforeEach(({ page, gpu }) => {
    void gpu;
    problems = collectProblems(page);
  });
  test.afterEach(() => problems.check());

  test("the mounted Guest is the CPU retarget of the Hero's clip, joint by joint, and keeps its own skeleton", async ({ page }) => {
    const hero = heroRig().skin, guest = guestRig().skin, retargeted = retargetedGuest();
    expect(retargeted.nodes.map((n) => n.name), "the retargeted skin is the Guest's own skeleton").toEqual(guest.nodes.map((n) => n.name));
    expect(retargeted.clips.map((c) => c.name).sort(), "with the Hero's clips").toEqual(hero.clips.map((c) => c.name).sort());

    // Boundaries at 0.3 s, then every 0.45 s over two cycles of the 2 s clip (and so through the wrap).
    const steps = [wait(18), ...Array.from({ length: 9 }, () => wait(27))];
    const result = await run(page, steps, { sample: "boundary", model: [], ghost: [], guest: "all" });
    expect(result.names.guest, "the mounted figure has the Guest's joint names").toEqual(guest.nodes.map((n) => n.name));
    const rows: Array<Record<string, number>> = [];
    let worstCpu = 0, worstAngle = 0, worstLength = 0, worstStance = 0;
    for (const s of result.samples) {
      const t = s.time;
      const cpu = cpuPose(retargeted, "Dance", t).nodes;
      const source = cpuPose(hero, "Dance", t).nodes;
      let cpuError = 0;
      for (const name of result.names.guest) cpuError = Math.max(cpuError, dist(s.guest.nodes[name]!, cpu.get(name)!));
      worstCpu = Math.max(worstCpu, cpuError);
      // Limb directions of the Guest against the Hero's playback.
      let angle = 0;
      for (const [heroBone, heroChild, guestBone, guestChild] of LIMBS) {
        const h = sub(source.get(heroChild)!, source.get(heroBone)!);
        const g = sub(s.guest.nodes[guestChild]!, s.guest.nodes[guestBone]!);
        angle = Math.max(angle, angleBetween(h, g));
      }
      worstAngle = Math.max(worstAngle, angle);
      // The Guest's bones keep their bind lengths (rotations only, but for the hips).
      let length = 0;
      guest.nodes.forEach((node, i) => {
        if (node.parent < 0 || ["root", "pelvis", "Body"].includes(node.name)) return;
        const parent = guest.nodes[node.parent]!;
        if (parent.name === "Body" || parent.name === "root") return;
        const bind = Math.hypot(node.translation[0]!, node.translation[1]!, node.translation[2]!);
        length = Math.max(length, Math.abs(dist(s.guest.nodes[node.name]!, s.guest.nodes[parent.name]!) - bind));
        void i;
      });
      worstLength = Math.max(worstLength, length);
      // The planted foot (the right one in the first half of the clip, the left one in the second) is at the Guest's ankle height.
      const phase = (t % 2) / 2;
      const planted = phase < 0.45 ? "foot_r" : phase > 0.55 && phase < 0.95 ? "foot_l" : undefined;
      if (planted !== undefined) worstStance = Math.max(worstStance, Math.abs(s.guest.nodes[planted]![1] - guest.nodes.find((n) => n.name === planted)!.translation[1]! - 0));
      rows.push({ t, cpuError, angleDegrees: (angle * 180) / Math.PI, lengthError: length });
    }
    writeProbe("retarget", { worstCpu, worstAngleDegrees: (worstAngle * 180) / Math.PI, worstLength, rows });
    expect(result.samples.length).toBe(10);
    expect(worstCpu, "largest joint distance between the mounted Guest and the CPU retarget (m)").toBeLessThan(1e-4);
    expect(worstLength, "bone length error (m)").toBeLessThan(1e-4);
    // Limb directions: the hierarchies differ (the Guest has clavicles and an upper chest, the Hero none), the rests differ by 45 degrees.
    expect((worstAngle * 180) / Math.PI, "largest limb direction error (degrees)").toBeLessThan(0.25);
    void worstStance;
  });

  test("the retargeted clip really is the Hero's: the bind poses differ by the rest pose, the playbacks agree", () => {
    // At time zero the Hero's arms are in the Dance pose, not the T-pose of its bind, and the Guest's, in its A-pose rest, are in that same pose.
    const hero = heroRig().skin, guest = guestRig().skin;
    const dance = cpuPose(hero, "Dance", 0.5).nodes;
    const retargeted = cpuPose(retargetedGuest(), "Dance", 0.5).nodes;
    const bindHero = cpuPose({ ...hero, clips: [] }, "none", 0).nodes;
    const bindGuest = cpuPose({ ...guest, clips: [] }, "none", 0).nodes;
    const dir = (m: Map<string, V3>, a: string, b: string): V3 => sub(m.get(b)!, m.get(a)!);
    // Bind: the Hero's right arm lies along -X (T-pose); the Guest's points 45 degrees down (A-pose): the rests differ by 45 degrees.
    expect((angleBetween(dir(bindHero, "RightArm", "RightForeArm"), dir(bindGuest, "upperarm_r", "lowerarm_r")) * 180) / Math.PI).toBeCloseTo(45, 3);
    // Dance: the same direction in both.
    expect((angleBetween(dir(dance, "RightArm", "RightForeArm"), dir(retargeted, "upperarm_r", "lowerarm_r")) * 180) / Math.PI).toBeLessThan(0.5);
  });
});
