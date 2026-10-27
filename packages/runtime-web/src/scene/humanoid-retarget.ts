// Humanoid retargeting (decision 0221, spec/animation.md section 2): clips of one humanoid drive another with
// different names, proportions and rest pose, through the automatic bone maps.
//
// Every mapped bone has a rest-corrected world orientation: its bind orientation turned by the shortest arc
// until the bone points along the canonical direction of its limb (T-pose: arms along the side, legs down, feet
// forward). Animation is carried as the world rotation of each bone relative to that corrected rest, expressed in the
// shared (left, up, forward) frame of the two characters, so a T-pose source drives an A-pose target and the reverse.
import type { MtekSkin } from "../abi/manifest-types.js";
import { sampleChannelInto } from "./clips.js";
import { OPTIONAL_HUMANOID_BONES, REQUIRED_HUMANOID_BONES, mapHumanoid, type HumanoidBone, type HumanoidMap } from "./humanoid.js";
import { analyse, cross, len, qarc, qbasis, qconj, qmul, qnorm, qrot, sub, uniformScales, unit, worldSimilarity, type Quat, type Rig, type V3 } from "./humanoid-rig.js";
import { skinProblem } from "./skeleton.js";

export interface HumanoidRetargetOptions {
  /** Multiplier for the hips translation. Default: the ratio of the two skeletons' leg lengths. */
  readonly translationScale?: number;
  /** false: carry bind-relative world rotations without correcting the rest poses (the naive transfer). Default true. */
  readonly restCorrection?: boolean;
  /** Maps from `mapHumanoid`, to avoid mapping again. */
  readonly sourceMap?: HumanoidMap;
  readonly targetMap?: HumanoidMap;
  /** Longest gap, in seconds, between the keys of a retargeted clip. Default 1/30. */
  readonly maxKeyInterval?: number;
}

const ALL_BONES = [...REQUIRED_HUMANOID_BONES, ...OPTIONAL_HUMANOID_BONES];
const CHAINS: readonly (readonly HumanoidBone[])[] = [
  ["hips", "spine", "chest", "upperChest", "neck", "head"],
  ["leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand"],
  ["rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand"],
  ["leftUpperLeg", "leftLowerLeg", "leftFoot", "leftToes"],
  ["rightUpperLeg", "rightLowerLeg", "rightFoot", "rightToes"],
];
/** Canonical direction (left, up, forward) of the segment that starts at a bone; bones without one follow the previous bone. */
const CANONICAL: Readonly<Partial<Record<HumanoidBone, V3>>> = {
  hips: [0, 1, 0], spine: [0, 1, 0], chest: [0, 1, 0], upperChest: [0, 1, 0], neck: [0, 1, 0],
  leftShoulder: [1, 0, 0], leftUpperArm: [1, 0, 0], leftLowerArm: [1, 0, 0],
  rightShoulder: [-1, 0, 0], rightUpperArm: [-1, 0, 0], rightLowerArm: [-1, 0, 0],
  leftUpperLeg: [0, -1, 0], leftLowerLeg: [0, -1, 0], rightUpperLeg: [0, -1, 0], rightLowerLeg: [0, -1, 0],
  leftFoot: [0, 0, 1], rightFoot: [0, 0, 1],
};

interface Side {
  readonly skin: MtekSkin;
  readonly rig: Rig;
  readonly map: HumanoidMap;
  /** Rotation from the (left, up, forward) frame to the mesh-local frame. */
  readonly basis: Quat;
  readonly left: V3;
  readonly up: V3;
  readonly forward: V3;
  readonly node: (bone: HumanoidBone) => number;
}

function side(skin: MtekSkin, map: HumanoidMap, what: string): Side {
  const problem = skinProblem(skin, skin.indices.length);
  if (problem !== undefined) throw new RangeError(`${what}: ${problem}`);
  if (!uniformScales(skin)) throw new RangeError(`${what}: humanoid retargeting requires uniform bind scales`);
  const index = new Map<string, number>();
  skin.nodes.forEach((n, i) => index.set(n.name, i));
  const up = unit(map.up), forward = unit(map.forward), left = cross(up, forward);
  return {
    skin, rig: analyse(skin), map, basis: qbasis(left, up, forward), left, up, forward,
    node: (bone) => index.get(map.bones[bone]!)!,
  };
}

function mapOf(skin: MtekSkin, given: HumanoidMap | undefined, what: string): HumanoidMap {
  const map = given ?? mapHumanoid(skin);
  if ("error" in map) throw new RangeError(`Humanoid mapping failed for the ${what}: ${map.error}`);
  return map;
}

/** Rest-corrected mesh-local orientation of every shared bone (see the file comment). */
function restOrientations(s: Side, shared: readonly HumanoidBone[], correct: boolean): Map<HumanoidBone, Quat> {
  const out = new Map<HumanoidBone, Quat>(), turn = new Map<HumanoidBone, Quat>();
  for (const chain of CHAINS) {
    const members = chain.filter((b) => shared.includes(b));
    members.forEach((bone, i) => {
      const next = members[i + 1], canonical = CANONICAL[bone];
      let rotation: Quat = [0, 0, 0, 1];
      if (correct && next !== undefined && canonical !== undefined) {
        const bind = sub(s.rig.P[s.node(next)]!, s.rig.P[s.node(bone)]!);
        if (len(bind) > 1e-9) rotation = qarc(unit(bind), qrot(s.basis, canonical));
      } else if (correct && i > 0) rotation = turn.get(members[i - 1]!)!;
      turn.set(bone, rotation);
      out.set(bone, qnorm(qmul(rotation, s.rig.Q[s.node(bone)]!)));
    });
  }
  return out;
}

const legLength = (s: Side): number => {
  let sum = 0;
  for (const prefix of ["left", "right"] as const) {
    const [u, l, f] = (["UpperLeg", "LowerLeg", "Foot"] as const).map((p) => s.rig.P[s.node(`${prefix}${p}` as HumanoidBone)]!);
    sum += len(sub(l!, u!)) + len(sub(f!, l!));
  }
  return sum / 2;
};
const dotv = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/**
 * Plays the clips of `source` on the skeleton of `target`: the result is `target` with the source clips, rewritten as
 * rotations of the target's mapped bones plus the hips translation (scaled by the leg-length ratio). Unmapped and extra
 * bones of the target keep their bind pose; animation of unmapped source bones affects the target only through the
 * mapped bones they carry. Throws RangeError when a skin is invalid or either skeleton does not map as a humanoid.
 */
export function retargetHumanoid(source: MtekSkin, target: MtekSkin, options: HumanoidRetargetOptions = {}): MtekSkin {
  const { translationScale, restCorrection = true, maxKeyInterval = 1 / 30 } = options;
  if (translationScale !== undefined && !(Number.isFinite(translationScale) && translationScale > 0)) throw new RangeError("Retarget translation scale must be positive");
  if (!(Number.isFinite(maxKeyInterval) && maxKeyInterval > 0)) throw new RangeError("The retarget key interval must be positive");
  const S = side(source, mapOf(source, options.sourceMap, "source"), "source"), T = side(target, mapOf(target, options.targetMap, "target"), "target");
  const shared = ALL_BONES.filter((b) => S.map.bones[b] !== undefined && T.map.bones[b] !== undefined);
  const restS = restOrientations(S, shared, restCorrection), restT = restOrientations(T, shared, restCorrection);
  // The target's mesh frame in terms of the source's: both characters stand and face the same way.
  const B = qmul(T.basis, qconj(S.basis));
  const sourceOf = new Map<number, HumanoidBone>(), targetOf = new Map<number, HumanoidBone>();
  for (const b of shared) { sourceOf.set(S.node(b), b); targetOf.set(T.node(b), b); }
  const ratio = translationScale ?? legLength(T) / legLength(S);
  const hipsS = S.node("hips"), hipsT = T.node("hips");
  const ground = (x: Side): number => (["leftFoot", "rightFoot"] as const).reduce((sum, b) => sum + dotv(x.rig.P[x.node(b)]!, x.up), 0) / 2;
  const reference = (x: Side, bone: number): V3 => [dotv(x.rig.P[bone]!, x.left), dotv(x.rig.P[bone]!, x.up), dotv(x.rig.P[bone]!, x.forward)];
  const bindS = reference(S, hipsS), bindT = reference(T, hipsT), groundS = ground(S), groundT = ground(T);
  // The pelvis sits a fixed distance above the hip joints; only the height of the hip joints above the ankles follows the leg ratio.
  const pelvis = (x: Side): number => dotv(x.rig.P[x.node("hips")]!, x.up) - (dotv(x.rig.P[x.node("leftUpperLeg")]!, x.up) + dotv(x.rig.P[x.node("rightUpperLeg")]!, x.up)) / 2;
  const pelvisS = pelvis(S), pelvisT = pelvis(T);  const orderS = S.rig.order, orderT = T.rig.order;
  const tNode = (i: number) => T.skin.nodes[i]!;
  const hipsParent = tNode(hipsT).parent;
  const hipsParentScale = hipsParent < 0 ? T.rig.origin.scale : T.rig.S[hipsParent]!;

  const clips = S.skin.clips.map((clip) => {
    const rotation = new Map<number, (typeof clip.channels)[number]>(), translation = new Map<number, (typeof clip.channels)[number]>();
    for (const c of clip.channels) (c.path === "rotation" ? rotation : c.path === "translation" ? translation : new Map()).set(c.node, c);
    const stamps = new Set<number>([0, clip.duration]);
    for (const c of clip.channels) for (const t of c.times) stamps.add(t);
    let times = [...stamps].filter((t) => t >= 0 && t <= clip.duration).sort((a, b) => a - b);
    const dense: number[] = [];
    times.forEach((t, i) => {
      dense.push(t);
      const gap = times[i + 1] === undefined ? 0 : times[i + 1]! - t, steps = Math.ceil(gap / maxKeyInterval - 1e-9);
      for (let k = 1; k < steps; k++) dense.push(t + (gap * k) / steps);
    });
    times = dense;
    const scratch = new Float64Array(4);
    const sample = (map: Map<number, (typeof clip.channels)[number]>, node: number, t: number, bind: readonly number[]): ArrayLike<number> => {
      const c = map.get(node);
      if (c === undefined) return bind;
      sampleChannelInto(c, t, scratch);
      return scratch;
    };
    const rotations = new Map<number, number[]>(), hips: number[] = [];
    for (const b of shared) rotations.set(T.node(b), []);
    const animatedHips = [...translation.keys()].some((n) => { for (let c = hipsS; c >= 0; c = S.skin.nodes[c]!.parent) if (c === n) return true; return false; });
    const Qs: Quat[] = [], Qt: Quat[] = [];
    const meshInverseT = qconj(T.rig.meshRot);
    for (const t of times) {
      const world = worldSimilarity(S.skin, orderS, (i) => {
        const n = S.skin.nodes[i]!;
        const r = sample(rotation, i, t, n.rotation), q: Quat = [r[0]!, r[1]!, r[2]!, r[3]!], p = sample(translation, i, t, n.translation);
        return { t: [p[0]!, p[1]!, p[2]!], r: q, s: n.scale[0]! };
      });
      const inverseMesh = qconj(world.rot[S.skin.meshNode]!);
      for (const i of orderS) Qs[i] = qnorm(qmul(inverseMesh, world.rot[i]!));
      for (const i of orderT) {
        const parent = tNode(i).parent, base = parent < 0 ? meshInverseT : Qt[parent]!, bone = targetOf.get(i);
        if (bone === undefined) { Qt[i] = qnorm(qmul(base, tNode(i).rotation)); continue; }
        const a = S.node(bone);
        const delta = qmul(Qs[a]!, qconj(restS.get(bone)!));
        Qt[i] = qnorm(qmul(qmul(qmul(B, delta), qconj(B)), restT.get(bone)!));
        const local = qnorm(qmul(qconj(base), Qt[i])), list = rotations.get(i)!, at = list.length - 4;
        const flip = at >= 0 && list[at]! * local[0] + list[at + 1]! * local[1] + list[at + 2]! * local[2] + list[at + 3]! * local[3] < 0 ? -1 : 1;
        list.push(local[0] * flip, local[1] * flip, local[2] * flip, local[3] * flip);
      }
      if (animatedHips) {
        const meshPos = world.pos[S.skin.meshNode]!, p = mul3(qrot(inverseMesh, sub(world.pos[hipsS]!, meshPos)), 1 / world.scale[S.skin.meshNode]!);
        const c: V3 = [dotv(p, S.left), dotv(p, S.up), dotv(p, S.forward)];
        const l = bindT[0] + ratio * (c[0] - bindS[0]), u = groundT + pelvisT + ratio * (c[1] - pelvisS - groundS), f = bindT[2] + ratio * (c[2] - bindS[2]);
        const mine: V3 = [T.left[0] * l + T.up[0] * u + T.forward[0] * f, T.left[1] * l + T.up[1] * u + T.forward[1] * f, T.left[2] * l + T.up[2] * u + T.forward[2] * f];
        const parentPos: V3 = hipsParent < 0 ? T.rig.origin.pos : T.rig.P[hipsParent]!;
        const parentRot = hipsParent < 0 ? meshInverseT : Qt[hipsParent]!;
        const local = mul3(qrot(qconj(parentRot), sub(mine, parentPos)), 1 / hipsParentScale);
        hips.push(local[0], local[1], local[2]);
      }
    }
    const channels: { node: number; path: "rotation" | "translation"; interpolation: "linear"; times: number[]; values: number[] }[] =
      [...rotations].map(([node, values]) => ({ node, path: "rotation", interpolation: "linear", times, values }));
    if (animatedHips) channels.push({ node: hipsT, path: "translation", interpolation: "linear", times, values: hips });
    return { name: clip.name, duration: clip.duration, channels };
  });
  const result = { ...target, clips }, problem = skinProblem(result, result.indices.length);
  if (problem !== undefined) throw new RangeError(`Humanoid retargeting produced an invalid skin: ${problem}`);
  return result;
}

const mul3 = (a: readonly number[], s: number): V3 => [a[0]! * s, a[1]! * s, a[2]! * s];
