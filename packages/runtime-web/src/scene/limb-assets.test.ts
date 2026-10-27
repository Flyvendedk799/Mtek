// Limb solving on the real example rigs (CesiumMan, and the character-composition Source and LongLegs variants, whose
// proportions differ). The GLB files are not committed, so these tests run only where a checkout has them; the maps
// are written by hand, exactly as decision 0222 requires (mapping itself is decision 0221).
import path from "node:path";
import { describe, expect, it } from "vitest";
import { glbSkin } from "../test-support/glb-skin.js";
import { DEFAULT_SOFTNESS, KNEE_MAX_FLEXION, ELBOW_MAX_FLEXION } from "./limb-ik.js";
import { referenceDrop } from "./limb-evidence.js";
import type { HumanoidBone, HumanoidMap } from "./humanoid-types.js";
import { SkeletonPlayer } from "./skeleton.js";

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V): V => mul(a, 1 / norm(a));
const angleBetween = (a: V, b: V): number => Math.atan2(norm([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]), dot(a, b));

const examples = path.resolve("../../examples");
const assets: { name: string; file: string; clip: string }[] = [
  { name: "CesiumMan", file: "vertex-deformation/characters/models/CesiumMan.glb", clip: "clip0" },
  { name: "composition Source", file: "character-composition/scene/models/Source.glb", clip: "Walk" },
  { name: "composition LongLegs", file: "character-composition/scene/models/LongLegs.glb", clip: "Walk" },
];
// The names of the CesiumMan skeleton: Skeleton_*, leg_joint_{L,R}_{1,2,3,5} and the arm chains.
const names: Record<string, string> = {
  hips: "Skeleton_torso_joint_1", spine: "Skeleton_torso_joint_2", chest: "torso_joint_3", neck: "Skeleton_neck_joint_1", head: "Skeleton_neck_joint_2",
  leftUpperLeg: "leg_joint_L_1", leftLowerLeg: "leg_joint_L_2", leftFoot: "leg_joint_L_3", leftToes: "leg_joint_L_5",
  rightUpperLeg: "leg_joint_R_1", rightLowerLeg: "leg_joint_R_2", rightFoot: "leg_joint_R_3", rightToes: "leg_joint_R_5",
  leftUpperArm: "Skeleton_arm_joint_L__4_", leftLowerArm: "Skeleton_arm_joint_L__3_", leftHand: "Skeleton_arm_joint_L__2_",
  rightUpperArm: "Skeleton_arm_joint_R", rightLowerArm: "Skeleton_arm_joint_R__2_", rightHand: "Skeleton_arm_joint_R__3_",
};

for (const { name, file, clip } of assets) {
  const skin = glbSkin(path.join(examples, file));
  describe.skipIf(skin === undefined)(`${name} (real skeleton)`, () => {
    const make = (): { player: SkeletonPlayer; map: HumanoidMap; pos: (bone: HumanoidBone) => V } => {
      const player = new SkeletonPlayer(skin!);
      const pos = (bone: HumanoidBone): V => { const p = player.jointPosition(names[bone]!); return [p.x, p.y, p.z]; };
      // Mesh-local axes from the bind pose: up from hips to head, forward from ankle to toes (made horizontal).
      const up = unit(sub(pos("head"), pos("hips"))), toes = sub(pos("leftToes"), pos("leftFoot"));
      const forward = unit(sub(toes, mul(up, dot(toes, up))));
      const map: HumanoidMap = { bones: names as HumanoidMap["bones"], evidence: {}, confidence: 1, unmapped: ["upperChest", "leftShoulder", "rightShoulder"], up, forward };
      player.setHumanoid(map);
      return { player, map, pos };
    };
    it("resolves the hand-written map and finds a mesh-local up that is vertical in the model", () => {
      const { map } = make();
      expect(Math.abs(map.up[2]!)).toBeGreaterThan(0.95); // CesiumMan is authored Z-up in mesh space
    });
    it("meets reachable foot and hand targets, bends knees forward and keeps the elbows on the bind bend side", () => {
      const { player, map, pos } = make();
      const forward = map.forward as unknown as V;
      for (const limb of ["leftLeg", "rightLeg"] as const) {
        const [u, , e] = limb === "leftLeg" ? (["leftUpperLeg", "leftLowerLeg", "leftFoot"] as const) : (["rightUpperLeg", "rightLowerLeg", "rightFoot"] as const);
        const hip = pos(u), foot = pos(e), reach = norm(sub(foot, hip));
        for (const lift of [0, 0.05, 0.1]) {
          const target = add(foot, add(mul(unit(map.up as unknown as V), lift), mul(forward, 0.04)));
          player.ik.setLimb(limb, { limb, target });
          player.evaluate();
          expect(norm(sub(pos(e), target)), `${limb} lift ${lift}`).toBeLessThan(2e-5 + (norm(sub(target, hip)) > reach * 0.97 ? 0.02 : 0));
          const knee = pos(limb === "leftLeg" ? "leftLowerLeg" : "rightLowerLeg"), axis = unit(sub(pos(e), hip)), toKnee = sub(knee, hip);
          const side = sub(toKnee, mul(axis, dot(toKnee, axis)));
          if (norm(side) > 1e-3) expect(dot(unit(side), forward), `${limb} knee side`).toBeGreaterThan(0.2);
        }
        player.ik.remove(limb);
      }
      for (const limb of ["leftArm", "rightArm"] as const) {
        const [u, l, e] = limb === "leftArm" ? (["leftUpperArm", "leftLowerArm", "leftHand"] as const) : (["rightUpperArm", "rightLowerArm", "rightHand"] as const);
        const shoulder = pos(u), hand = pos(e);
        const target = add(add(shoulder, mul(forward, 0.9 * norm(sub(hand, shoulder)))), mul(unit(map.up as unknown as V), -0.05));
        player.ik.setLimb(limb, { limb, target });
        player.evaluate();
        expect(norm(sub(pos(e), target))).toBeLessThan(5e-3); // may lie in the soft zone
        const elbow = pos(l), axis = unit(sub(pos(e), shoulder)), toElbow = sub(elbow, shoulder), side = sub(toElbow, mul(axis, dot(toElbow, axis)));
        expect(angleBetween(sub(elbow, shoulder), sub(pos(e), elbow))).toBeLessThanOrEqual(ELBOW_MAX_FLEXION + 1e-4);
        // The arms are bound out to the side: reaching forward carries the bind bend plane, so the elbow stays on its outer side.
        const upDir = unit(map.up as unknown as V), left = unit([upDir[1] * forward[2] - upDir[2] * forward[1], upDir[2] * forward[0] - upDir[0] * forward[2], upDir[0] * forward[1] - upDir[1] * forward[0]]);
        if (norm(side) > 1e-3) expect(dot(unit(side), mul(left, limb === "leftArm" ? 1 : -1)), `${limb} elbow side`).toBeGreaterThan(0.3);
        player.ik.remove(limb);
      }
      expect(player.pose.every(Number.isFinite)).toBe(true);
    });
    it("keeps both feet on stepped ground along the walk cycle, with the independent minimum hips drop and flexion in range", () => {
      const { player, map, pos } = make();
      const twin = new SkeletonPlayer(skin!, clip);
      player.transition(clip, 0, true, 1);
      const up = unit(map.up as unknown as V);
      const lengths = (u: HumanoidBone, l: HumanoidBone, e: HumanoidBone): [number, number] => [norm(sub(pos(l), pos(u))), norm(sub(pos(e), pos(l)))];
      const legs = [lengths("leftUpperLeg", "leftLowerLeg", "leftFoot"), lengths("rightUpperLeg", "rightLowerLeg", "rightFoot")];
      const reaches = legs.map(([a, b]) => { const R = a + b, min = Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(KNEE_MAX_FLEXION)); return R - DEFAULT_SOFTNESS * (R - min); });
      const twinPos = (bone: HumanoidBone): V => { const p = twin.jointPosition(names[bone]!); return [p.x, p.y, p.z]; };
      const step = 0.04 * norm(sub(pos("head"), pos("hips")));
      let lowered = 0;
      for (const [left, right] of [[0, 0], [-step, 0], [0, -step], [-step, -step], [step, 0]] as const) {
        player.ik.setFootPlacement({ left: { height: left }, right: { height: right }, smoothing: 0, maxDrop: 10 });
        const info0 = player.inspect().footPlacement!;
        for (let k = 0; k < 24; k++) {
          player.advance(1 / 12); twin.advance(1 / 12);
          const uppers: V[] = [twinPos("leftUpperLeg"), twinPos("rightUpperLeg")], animated: V[] = [twinPos("leftFoot"), twinPos("rightFoot")];
          // Height mode keeps the animated lift and follows the ground change, but never goes below ground + sole offset.
          const targets = [left, right].map((h, i) => add(animated[i]!, mul(up, Math.max(h, h + info0.soleOffset - dot(animated[i]!, up))))) as V[];
          const drop = dot(sub(twinPos("hips"), pos("hips")), up), expected = referenceDrop(uppers, targets, up, reaches);
          const info = player.inspect().footPlacement!;
          expect(drop).toBeCloseTo(expected, 4);
          expect(drop).toBeGreaterThanOrEqual(-1e-6);
          for (const [i, bone] of (["leftFoot", "rightFoot"] as const).entries()) expect(info[i === 0 ? "left" : "right"].residual, bone).toBeLessThan(1e-4);
          if (drop > 1e-4) lowered++;
          for (const [u, l, e] of [["leftUpperLeg", "leftLowerLeg", "leftFoot"], ["rightUpperLeg", "rightLowerLeg", "rightFoot"]] as const) {
            const flex = angleBetween(sub(pos(l), pos(u)), sub(pos(e), pos(l)));
            expect(flex).toBeLessThanOrEqual(KNEE_MAX_FLEXION + 1e-4);
          }
          expect(player.pose.every(Number.isFinite)).toBe(true);
        }
      }
      expect(lowered).toBeGreaterThan(0);
    });
  });
}
