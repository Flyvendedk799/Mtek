// Test support (not shipped): measurements of a humanoid retarget (decision 0221). All quantities are computed in double
// precision from the clips of the skins (not through the float32 palette), in the mesh-local frame of each skin and
// compared in the shared (left, up, forward) frame of the two characters.
import type { MtekSkin } from "../abi/manifest-types.js";
import { sampleChannelInto } from "../scene/clips.js";
import type { HumanoidBone, HumanoidMap } from "../scene/humanoid.js";
import { analyse, cross, len, nodeOrder, qconj, qmul, qnorm, qrot, sub, unit, worldSimilarity, type Quat, type V3 } from "../scene/humanoid-rig.js";

export interface PoseSamples { readonly pos: V3[]; readonly rot: Quat[] }

/** Mesh-local positions and rotations of every node of `skin` at `time` of `clip` (bind pose when the clip is unknown). */
export function posesOf(skin: MtekSkin, clip: string | undefined): (time: number) => PoseSamples {
  const order = nodeOrder(skin), found = skin.clips.find((c) => c.name === clip);
  const channels = new Map<string, NonNullable<typeof found>["channels"][number]>();
  for (const c of found?.channels ?? []) channels.set(`${c.node}:${c.path}`, c);
  const scratch = new Float64Array(4);
  return (time) => {
    const world = worldSimilarity(skin, order, (i) => {
      const n = skin.nodes[i]!;
      let r: readonly number[] = n.rotation, t: readonly number[] = n.translation;
      const rc = channels.get(`${i}:rotation`), tc = channels.get(`${i}:translation`);
      if (rc !== undefined) { sampleChannelInto(rc, time, scratch); r = [scratch[0]!, scratch[1]!, scratch[2]!, scratch[3]!]; }
      if (tc !== undefined) { sampleChannelInto(tc, time, scratch); t = [scratch[0]!, scratch[1]!, scratch[2]!]; }
      return { t, r, s: n.scale[0]! };
    });
    const m = skin.meshNode, inverse = qconj(world.rot[m]!), pos: V3[] = [], rot: Quat[] = [];
    for (const i of order) {
      const p = qrot(inverse, sub(world.pos[i]!, world.pos[m]!));
      pos[i] = [p[0] / world.scale[m]!, p[1] / world.scale[m]!, p[2] / world.scale[m]!];
      rot[i] = qnorm(qmul(inverse, world.rot[i]!));
    }
    return { pos, rot };
  };
}

export interface Frame3 { readonly left: V3; readonly up: V3; readonly forward: V3 }
export const frameOf = (map: HumanoidMap): Frame3 => ({ left: cross(map.up, map.forward), up: unit(map.up), forward: unit(map.forward) });
const components = (v: V3, f: Frame3): V3 => [v[0] * f.left[0] + v[1] * f.left[1] + v[2] * f.left[2], v[0] * f.up[0] + v[1] * f.up[1] + v[2] * f.up[2], v[0] * f.forward[0] + v[1] * f.forward[1] + v[2] * f.forward[2]];
const angle = (a: V3, b: V3): number => (Math.acos(Math.max(-1, Math.min(1, unit(a)[0] * unit(b)[0] + unit(a)[1] * unit(b)[1] + unit(a)[2] * unit(b)[2]))) * 180) / Math.PI;

export const LIMB_SEGMENTS: readonly (readonly [HumanoidBone, HumanoidBone])[] = [
  ["leftUpperArm", "leftLowerArm"], ["leftLowerArm", "leftHand"], ["rightUpperArm", "rightLowerArm"], ["rightLowerArm", "rightHand"],
  ["leftUpperLeg", "leftLowerLeg"], ["leftLowerLeg", "leftFoot"], ["rightUpperLeg", "rightLowerLeg"], ["rightLowerLeg", "rightFoot"],
];

export interface RetargetMetrics {
  /** Largest and mean angle (degrees) between corresponding limb segments, over all frames and the eight segments. */
  readonly maxLimbErrorDeg: number;
  readonly meanLimbErrorDeg: number;
  /** Mean over frames of (target hip-joint height above its lower ankle) / (source hip-joint height above its lower ankle). */
  readonly hipsHeightRatio: number;
  /** Ratio of the leg lengths (target / source) the hips scale follows. */
  readonly legRatio: number;
  readonly stanceFrames: number;
  /** Foot speed in the target (leg lengths per second) beyond the source's speed scaled by the leg ratio, in stance frames. */
  /** Largest deviation (leg lengths) of the target ankle height above its bind ankle plane from the source's scaled by the leg ratio, in stance frames. */
  readonly maxStanceHeightError: number;
  readonly maxStanceSlide: number;
  readonly meanStanceSlide: number;
}

export function legLengthOf(skin: MtekSkin, map: HumanoidMap): number {
  const rig = analyse(skin), at = (bone: HumanoidBone): V3 => rig.P[skin.nodes.findIndex((n) => n.name === map.bones[bone])]!;
  let sum = 0;
  for (const side of ["left", "right"] as const) sum += len(sub(at(`${side}LowerLeg`), at(`${side}UpperLeg`))) + len(sub(at(`${side}Foot`), at(`${side}LowerLeg`)));
  return sum / 2;
}

/** Compares the animation `clip` of `source` with the same clip on the retargeted `target`. */
export function measureRetarget(source: MtekSkin, sourceMap: HumanoidMap, target: MtekSkin, targetMap: HumanoidMap, clip: string, fps = 60): RetargetMetrics {
  const poseS = posesOf(source, clip), poseT = posesOf(target, clip), fs = frameOf(sourceMap), ft = frameOf(targetMap);
  const nodeS = (b: HumanoidBone): number => source.nodes.findIndex((n) => n.name === sourceMap.bones[b]);
  const nodeT = (b: HumanoidBone): number => target.nodes.findIndex((n) => n.name === targetMap.bones[b]);
  const duration = source.clips.find((c) => c.name === clip)!.duration, frames = Math.max(1, Math.round(duration * fps));
  const legS = legLengthOf(source, sourceMap), legT = legLengthOf(target, targetMap), ratio = legT / legS;
  let max = 0, sum = 0, count = 0, heights = 0;
  const ankles = (["leftFoot", "rightFoot"] as const).map((b) => [nodeS(b), nodeT(b)] as const);
  const footS: V3[][] = [[], []], footT: V3[][] = [[], []];
  for (let k = 0; k <= frames; k++) {
    const time = (k * duration) / frames, s = poseS(time), t = poseT(time);
    for (const [a, b] of LIMB_SEGMENTS) {
      const ds = components(sub(s.pos[nodeS(b)]!, s.pos[nodeS(a)]!), fs), dt = components(sub(t.pos[nodeT(b)]!, t.pos[nodeT(a)]!), ft);
      const e = angle(ds, dt);
      max = Math.max(max, e); sum += e; count++;
    }
    const lowS = Math.min(...ankles.map(([a]) => components(s.pos[a]!, fs)[1])), lowT = Math.min(...ankles.map(([, b]) => components(t.pos[b]!, ft)[1]));
    const hipJoints = (p: PoseSamples, node: (b: HumanoidBone) => number, f: Frame3): number => (components(p.pos[node("leftUpperLeg")]!, f)[1] + components(p.pos[node("rightUpperLeg")]!, f)[1]) / 2;
    heights += (hipJoints(t, nodeT, ft) - lowT) / (hipJoints(s, nodeS, fs) - lowS);
    ankles.forEach(([a, b], i) => { footS[i]!.push(components(s.pos[a]!, fs)); footT[i]!.push(components(t.pos[b]!, ft)); });
  }
  // Stance: the source ankle is at the lowest height it reaches and not moving vertically. Slide: the target's foot
  // velocity minus the source's scaled by the leg ratio (zero when a planted foot stays planted).
  const floor = Math.min(...footS.flatMap((f) => f.map((p) => p[1]))), dt = duration / frames;
  const bindHeight = (skin: MtekSkin, map: HumanoidMap, f: Frame3): number => {
    const rig = analyse(skin), at = (bone: HumanoidBone): number => components(rig.P[skin.nodes.findIndex((n) => n.name === map.bones[bone])]!, f)[1];
    return (at("leftFoot") + at("rightFoot")) / 2;
  };
  const planeS = bindHeight(source, sourceMap, fs), planeT = bindHeight(target, targetMap, ft);
  let stance = 0, slideMax = 0, slideSum = 0, heightMax = 0;
  for (let i = 0; i < 2; i++)
    for (let k = 1; k < frames; k++) {
      const a = footS[i]!, b = footT[i]!, v = (p: V3[]): V3 => [(p[k + 1]![0] - p[k - 1]![0]) / (2 * dt), (p[k + 1]![1] - p[k - 1]![1]) / (2 * dt), (p[k + 1]![2] - p[k - 1]![2]) / (2 * dt)];
      const vs = v(a), vt = v(b);
      if (a[k]![1] - floor > 0.05 * legS || Math.abs(vs[1]) > 0.1 * legS) continue;
      const slide = len([vt[0] - ratio * vs[0], vt[1] - ratio * vs[1], vt[2] - ratio * vs[2]]) / legT;
      heightMax = Math.max(heightMax, Math.abs(b[k]![1] - planeT - ratio * (a[k]![1] - planeS)) / legT);
      stance++; slideMax = Math.max(slideMax, slide); slideSum += slide;
    }
  return { maxLimbErrorDeg: max, meanLimbErrorDeg: sum / count, hipsHeightRatio: heights / (frames + 1), legRatio: ratio, stanceFrames: stance, maxStanceHeightError: heightMax, maxStanceSlide: slideMax, meanStanceSlide: stance === 0 ? 0 : slideSum / stance };
}
