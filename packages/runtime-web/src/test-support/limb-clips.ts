import type { MtekSkin } from "../abi/manifest-types.js";
import type { HumanoidBone } from "../scene/humanoid-types.js";
import { qaxis, type TestRig } from "./limb-rigs.js";

/**
 * Adds a one-second looping "walk" clip to an identity-frame rig: the thighs swing 25 degrees about the left axis in
 * opposite phase, the knees flex between 18 and 62 degrees, and the hips bob 2 cm.
 */
export function withWalkClip(rig: TestRig, name = "walk"): TestRig {
  const keys = 9, times = Array.from({ length: keys }, (_, k) => k / (keys - 1));
  const channel = (bone: HumanoidBone, angle: (t: number) => number): MtekSkin["clips"][number]["channels"][number] => ({
    node: rig.nodeIndex(bone), path: "rotation", interpolation: "linear", times, values: times.flatMap(t => qaxis([1, 0, 0], angle(t))),
  });
  const rad = (d: number): number => (d * Math.PI) / 180;
  const swing = (phase: number) => (t: number): number => -rad(25) * Math.sin(2 * Math.PI * (t + phase));
  const knee = (phase: number) => (t: number): number => rad(40) + rad(22) * Math.sin(2 * Math.PI * (t + phase) + 1);
  const hips = rig.skin.nodes[rig.nodeIndex("hips")]!.translation;
  const clip = {
    name, duration: 1, channels: [
      channel("leftUpperLeg", swing(0)), channel("rightUpperLeg", swing(0.5)), channel("leftLowerLeg", knee(0)), channel("rightLowerLeg", knee(0.5)),
      { node: rig.nodeIndex("hips"), path: "translation" as const, interpolation: "linear" as const, times, values: times.flatMap(t => [hips[0]!, hips[1]! - 0.02 + 0.02 * Math.cos(4 * Math.PI * t), hips[2]!]) },
    ],
  };
  return { ...rig, skin: { ...rig.skin, clips: [clip] } };
}
