// Automatic humanoid mapping (decision 0221, spec/animation.md section 2). A skin is mapped to the canonical
// humanoid bones of decision 0219 from joint names (compact tables, separator/case/prefix insensitive) and, where
// names fail, from the topology and bind geometry of the joints. Skeletons of the wrong shape are rejected.
import type { MtekSkin } from "../abi/manifest-types.js";
import {
  OPTIONAL_HUMANOID_BONES, REQUIRED_HUMANOID_BONES, add, analyse, cross, dot, len, mul, orth, parseName, qconj, qrot, sub, unit,
  type Family, type HumanoidBone, type HumanoidMap, type Parsed, type Rig, type Role, type V3,
} from "./humanoid-rig.js";

export { OPTIONAL_HUMANOID_BONES, REQUIRED_HUMANOID_BONES } from "./humanoid-rig.js";
export type { HumanoidBone, HumanoidMap } from "./humanoid-rig.js";

const ankleBend = Math.cos((50 * Math.PI) / 180);

/** The child that continues a limb: the deepest subtree, then the farthest joint. */
function continuation(g: Rig, from: number, kids: readonly number[]): number {
  const far = (k: number): number => len(sub(g.P[k]!, g.P[from]!));
  return [...kids].sort((a, b) => g.height[b]! - g.height[a]! || far(b) - far(a) || a - b)[0]!;
}

/** Joints from a limb root outwards; ends at a hand/toe name, a leaf or where the limb fans out (fingers, toes). */
function limbChain(g: Rig, start: number, names: readonly Parsed[]): number[] {
  const out = [start];
  for (let cur = start; ;) {
    const kids = g.kids[cur]!, role = names[cur]!.role;
    if (kids.length === 0 || role === "hand" || role === "toe" || kids.filter((k) => g.height[k]! >= 1).length >= 2) return out;
    cur = continuation(g, cur, kids);
    out.push(cur);
  }
}

const pathLength = (g: Rig, c: readonly number[], from: number, to: number): number => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += len(sub(g.P[c[i + 1]!]!, g.P[c[i]!]!));
  return sum;
};
/** Name hint cost: a matching role name is rewarded, a contradicting one penalised, no name is neutral. */
const hint = (names: readonly Parsed[], joint: number, role: Role): number => (names[joint]!.role === undefined ? 0 : names[joint]!.role === role ? -0.7 : 0.7);

interface Leg { readonly upper: number; readonly lower: number; readonly foot: number; readonly toes?: number }
interface Arm { readonly shoulder?: number; readonly upper: number; readonly lower: number; readonly hand: number }

/** Leg: ankle = a named foot, else where the chain turns away from the leg axis or ends in a short toe segment; the knee balances thigh and shin. */
function splitLeg(g: Rig, c: readonly number[], names: readonly Parsed[]): Leg | undefined {
  const n = c.length - 1;
  if (n < 2) return undefined;
  let a = c.findIndex((j, i) => i >= 2 && names[j]!.role === "foot");
  if (a < 0) {
    a = n;
    for (let i = 2; i < n; i++)
      if (dot(unit(sub(g.P[c[i + 1]!]!, g.P[c[i]!]!)), unit(sub(g.P[c[i]!]!, g.P[c[0]!]!))) < ankleBend) { a = i; break; }
    // A short last segment (well under the shin) is the toes, even when the foot is not bent against the leg.
    if (a === n && n >= 3 && pathLength(g, c, n - 1, n) < 0.5 * pathLength(g, c, n - 2, n - 1)) a = n - 1;
  }
  let k = -1, cost = Infinity;
  for (let i = 1; i < a; i++) {
    const upper = pathLength(g, c, 0, i), lower = pathLength(g, c, i, a);
    if (upper < 1e-9 || lower < 1e-9) continue;
    const here = Math.abs(Math.log(upper / lower)) + hint(names, c[i]!, "lower");
    if (here < cost) { cost = here; k = i; }
  }
  if (k < 0) return undefined;
  return a < n ? { upper: c[0]!, lower: c[k]!, foot: c[a]!, toes: c[a + 1]! } : { upper: c[0]!, lower: c[k]!, foot: c[a]! };
}

/** Arm: an optional first clavicle; elbow and wrist (the hand, before any fingers or carried props) balance the segment lengths. */
function splitArm(g: Rig, whole: readonly number[], names: readonly Parsed[]): Arm | undefined {
  // The arm ends where the chain turns sharply away from the arm axis (a carried prop, not a finger).
  let last = whole.length - 1;
  for (let i = 2; i < last; i++)
    if (dot(unit(sub(g.P[whole[i + 1]!]!, g.P[whole[i]!]!)), unit(sub(g.P[whole[i]!]!, g.P[whole[0]!]!))) < 0.5) { last = i; break; }
  const c = whole.slice(0, last + 1);
  let best: Arm | undefined, cost = Infinity;
  for (let u = 0; u <= 1; u++)
    for (let e = u + 1; e < last; e++)
      for (let n = e + 1; n <= last; n++) {
        const upper = pathLength(g, c, u, e), lower = pathLength(g, c, e, n);
        if (upper < 1e-9 || lower < 1e-9) continue;
        const here = Math.abs(Math.log(upper / lower)) + 0.1 * (n - e - 1) + hint(names, c[u]!, "upper") + hint(names, c[e]!, "lower") + hint(names, c[n]!, "hand")
          + (u === 1 ? hint(names, c[0]!, "shoulder") : names[c[0]!]!.role === "shoulder" ? 0.7 : 0);
        if (here < cost) { cost = here; best = u === 1 ? { shoulder: c[0]!, upper: c[1]!, lower: c[e]!, hand: c[n]! } : { upper: c[0]!, lower: c[e]!, hand: c[n]! }; }
      }
  return best;
}

/** Mean distance between mirrored chain prefixes about the plane (through the first joints' midpoint) with normal n. */
function mirrorError(g: Rig, a: readonly number[], b: readonly number[], n: readonly number[]): number {
  const m = Math.min(3, a.length, b.length), mid = mul(add(g.P[a[0]!]!, g.P[b[0]!]!), 0.5);
  const scale = len(sub(g.P[a[m - 1]!]!, g.P[a[0]!]!));
  if (scale < 1e-9) return Infinity;
  let sum = 0;
  for (let j = 0; j < m; j++) {
    const p = g.P[a[j]!]!, mirrored = sub(p, mul(n, 2 * dot(sub(p, mid), n)));
    sum += len(sub(mirrored, g.P[b[j]!]!));
  }
  return sum / m / scale;
}

interface Anchors { legs: [number, number]; arms: [number, number]; head: number }

/** The spine from the joint `s` upwards: finds the arm pair, then the head. */
function spinePath(g: Rig, s: number, up: readonly number[], lat: readonly number[], names: readonly Parsed[]): { arms: [number, number]; head: number } | undefined {
  const path = [s];
  let arms: [number, number] | undefined, top = -1;
  const pick = (cur: number, list: readonly number[]): number | undefined => {
    const onPlane = list.filter((k) => { const o = sub(g.P[k]!, g.P[cur]!); return Math.abs(dot(o, lat)) <= 0.35 * len(o); });
    return onPlane.sort((a, b) => g.height[b]! - g.height[a]! || dot(up, sub(g.P[b]!, g.P[a]!)))[0];
  };
  for (let cur = s; ;) {
    const kids = g.kids[cur]!;
    if (kids.length === 0) break;
    let rest = kids;
    if (arms === undefined) {
      const limbs = kids.filter((k) => g.height[k]! >= 2);
      for (let i = 0; i < limbs.length && arms === undefined; i++)
        for (let j = i + 1; j < limbs.length && arms === undefined; j++) {
          const p = limbs[i]!, q = limbs[j]!, sp = dot(sub(g.P[p]!, g.P[cur]!), lat), sq = dot(sub(g.P[q]!, g.P[cur]!), lat);
          if (sp * sq < 0 && Math.abs(sp + sq) <= 0.35 * Math.max(Math.abs(sp), Math.abs(sq))
            && mirrorError(g, limbChain(g, p, names), limbChain(g, q, names), lat) <= 0.35) { arms = [p, q]; top = cur; }
        }
      if (arms !== undefined) rest = kids.filter((k) => k !== arms![0] && k !== arms![1]);
    }
    const next = pick(cur, rest);
    if (next === undefined) break;
    path.push(next);
    cur = next;
  }
  if (arms === undefined) return undefined;
  const above = path.slice(path.indexOf(top) + 1), m = above.length;
  if (m === 0) return undefined;
  let head = above[m - 1]!;
  // A leaf among several children (jaw, eyes, a head-top bone) belongs to the head; a lone trailing leaf much longer
  // than the segment before it is a head-top end bone.
  if (m >= 2 && g.kids[above[m - 2]!]!.length >= 2) head = above[m - 2]!;
  else if (m >= 3 && g.kids[head]!.length === 0 && len(sub(g.P[head]!, g.P[above[m - 2]!]!)) > 1.5 * len(sub(g.P[above[m - 2]!]!, g.P[above[m - 3]!]!))) head = above[m - 2]!;
  return { arms, head };
}

/** Hips = a joint with two mirrored, parallel limb chains and a third, opposed chain that holds the arms and head. */
function structure(g: Rig, names: readonly Parsed[]): Anchors | undefined {
  let best: Anchors | undefined, bestKey = -1;
  for (let h = 0; h < g.count; h++) {
    if (!g.isJoint[h]) continue;
    const limbs = g.kids[h]!.filter((k) => g.height[k]! >= 2);
    if (limbs.length < 3) continue;
    for (let i = 0; i < limbs.length; i++)
      for (let j = i + 1; j < limbs.length; j++) {
        const a = limbs[i]!, b = limbs[j]!, A = limbChain(g, a, names), B = limbChain(g, b, names);
        if (A.length < 3 || B.length < 3) continue;
        const n = unit(sub(g.P[a]!, g.P[b]!));
        if (mirrorError(g, A, B, n) > 0.2) continue;
        const dA = unit(sub(g.P[A[2]!]!, g.P[a]!)), dB = unit(sub(g.P[B[2]!]!, g.P[b]!));
        if (dot(dA, dB) < 0.8) continue;
        const up = unit(mul(add(dA, dB), -1)), lat = unit(orth(n, up));
        for (const s of limbs) {
          if (s === a || s === b) continue;
          const sp = spinePath(g, s, up, lat, names);
          if (sp === undefined || dot(unit(sub(g.P[sp.head]!, g.P[h]!)), up) < 0.6) continue;
          const key = g.size[h]! * 1000 + g.size[s]!;
          if (key > bestKey) { bestKey = key; best = { legs: [a, b], arms: sp.arms, head: sp.head }; }
        }
      }
  }
  return best;
}

/** Anchors by name. Each part is present only when the names pick it out uniquely. */
function nameAnchors(g: Rig, names: readonly Parsed[]): { legs?: [number, number]; arms?: [number, number]; head?: number } {
  const joints = names.map((_, i) => i).filter((i) => g.isJoint[i]);
  const top = (family: Family, side: "l" | "r"): number | undefined => {
    const same = (i: number): boolean => names[i]!.family === family && names[i]!.side === side;
    const tops = joints.filter((i) => same(i) && !(g.jp[i]! >= 0 && same(g.jp[i]!)));
    return tops.length === 1 ? tops[0] : undefined;
  };
  const out: { legs?: [number, number]; arms?: [number, number]; head?: number } = {};
  const [ll, lr, al, ar] = [top("leg", "l"), top("leg", "r"), top("arm", "l"), top("arm", "r")];
  if (ll !== undefined && lr !== undefined) out.legs = [ll, lr];
  if (al !== undefined && ar !== undefined) out.arms = [al, ar];
  const heads = joints.filter((i) => names[i]!.family === "head");
  if (heads.length === 1) out.head = heads[0];
  else if (heads.length === 0) {
    // A chain of several neck joints (CesiumMan): the last one is the head.
    const necks = joints.filter((i) => names[i]!.family === "neck");
    const tips = necks.filter((i) => !necks.some((o) => g.jp[o] === i));
    if (necks.length >= 2 && tips.length === 1) out.head = tips[0];
  }
  return out;
}

const ancestors = (g: Rig, i: number): number[] => { const out: number[] = []; for (let c = i; c >= 0; c = g.jp[c]!) out.push(c); return out; };
function lca(g: Rig, of: readonly number[]): number {
  let common = ancestors(g, of[0]!);
  for (const i of of) { const up = new Set(ancestors(g, i)); common = common.filter((c) => up.has(c)); }
  return common[0] ?? -1;
}

interface Built {
  readonly bones: Partial<Record<HumanoidBone, number>>;
  readonly up: V3;
  readonly forward: V3;
  readonly factor: number;
}

const COSINE_UPRIGHT = 0.75;

/** `sided`: whether the pair is ordered [left, right] (it came from side-bearing names). */
function build(g: Rig, names: readonly Parsed[], an: Anchors, sided: { legs: boolean; arms: boolean }): Built | string {
  const hips = lca(g, [an.legs[0], an.legs[1], an.head]);
  if (hips < 0 || [an.legs[0], an.legs[1], an.head].includes(hips)) return "the legs and the head do not meet at a hips joint";
  const legs = an.legs.map((s) => splitLeg(g, limbChain(g, s, names), names));
  const arms = an.arms.map((s) => splitArm(g, limbChain(g, s, names), names));
  if (legs[0] === undefined || legs[1] === undefined) return "a leg chain has fewer than hip, knee and ankle joints";
  if (arms[0] === undefined || arms[1] === undefined) return "an arm chain has fewer than shoulder, elbow and wrist joints";
  const above0 = ancestors(g, an.head), path = above0.slice(0, above0.indexOf(hips) + 1).reverse();
  let top = lca(g, [g.jp[an.arms[0]]!, g.jp[an.arms[1]]!]);
  while (top >= 0 && !path.includes(top)) top = g.jp[top]!;
  const ti = path.indexOf(top);
  if (ti < 1 || ti >= path.length - 1) return "the arms do not attach to a spine between the hips and the head";
  const torso = path.slice(1, ti + 1), above = path.slice(ti + 1, path.length - 1);
  const up = unit(sub(g.P[an.head]!, g.P[hips]!));
  const axis = (l: Leg): V3 => unit(sub(g.P[l.foot]!, g.P[l.upper]!));
  const upright = -dot(up, unit(add(axis(legs[0]), axis(legs[1]))));
  if (upright < COSINE_UPRIGHT) return "the spine is not opposed to the legs (not an upright biped)";
  if ([legs[0], legs[1]].some((l) => dot(sub(g.P[l.foot]!, g.P[hips]!), up) >= 0) || dot(sub(g.P[an.head]!, g.P[top]!), up) <= 0)
    return "the feet are not below the hips or the head is not above the arms";
  // Which way the character faces: toes, then the bend of the knees, then the glTF convention (+Z of the scene).
  const vote = (f: V3): { sign: number; source: number } => {
    const scale = (pathLength(g, [legs[0]!.upper, legs[0]!.lower, legs[0]!.foot], 0, 2) + pathLength(g, [legs[1]!.upper, legs[1]!.lower, legs[1]!.foot], 0, 2)) / 2;
    let toes = 0, knees = 0;
    for (const l of [legs[0], legs[1]]) {
      if (l.toes !== undefined) toes += dot(orth(sub(g.P[l.toes]!, g.P[l.foot]!), up), f);
      const u = g.P[l.upper]!, w = g.P[l.foot]!, k = g.P[l.lower]!, t = len(sub(k, u)) / (len(sub(k, u)) + len(sub(w, k)));
      knees += dot(sub(k, add(u, mul(sub(w, u), t))), f);
    }
    if (Math.abs(toes) > 0.1 * scale) return { sign: Math.sign(toes), source: 1 };
    if (Math.abs(knees) > 0.02 * scale) return { sign: Math.sign(knees), source: 0.95 };
    return { sign: dot(qrot(qconj(g.meshRot), [0, 0, 1]), f) >= 0 ? 1 : -1, source: 0.85 };
  };
  let left: V3, factor: number;
  if (sided.legs || sided.arms) {
    const pair = sided.legs ? an.legs : an.arms;
    left = unit(orth(sub(g.P[pair[0]]!, g.P[pair[1]]!), up));
    // Legs and arms must agree on which side is left, and toes must not contradict the names.
    factor = sided.legs && sided.arms && dot(left, unit(orth(sub(g.P[an.arms[0]]!, g.P[an.arms[1]]!), up))) <= 0 ? 0.5 : 1;
    const v = vote(unit(cross(left, up)));
    if (v.source === 1 && v.sign < 0) factor *= 0.5;
  } else {
    const provisional = unit(orth(sub(g.P[an.legs[0]]!, g.P[an.legs[1]]!), up)), v = vote(unit(cross(provisional, up)));
    left = v.sign < 0 ? mul(provisional, -1) : provisional;
    factor = v.source;
  }
  const forward = unit(cross(left, up));
  const order = (pair: readonly [number, number], about: number, named: boolean): [number, number] =>
    named || dot(sub(g.P[pair[0]]!, g.P[about]!), left) >= dot(sub(g.P[pair[1]]!, g.P[about]!), left) ? [0, 1] : [1, 0];
  const [ll, rl] = order(an.legs, hips, sided.legs), [la, ra] = order(an.arms, top, sided.arms);
  const [LL, RL, LA, RA] = [legs[ll]!, legs[rl]!, arms[la]!, arms[ra]!];
  const bones: Partial<Record<HumanoidBone, number>> = {
    hips, spine: torso[0]!, head: an.head,
    leftUpperLeg: LL.upper, leftLowerLeg: LL.lower, leftFoot: LL.foot, rightUpperLeg: RL.upper, rightLowerLeg: RL.lower, rightFoot: RL.foot,
    leftUpperArm: LA.upper, leftLowerArm: LA.lower, leftHand: LA.hand, rightUpperArm: RA.upper, rightLowerArm: RA.lower, rightHand: RA.hand,
  };
  const optional: [HumanoidBone, number | undefined][] = [
    ["chest", torso[1]], ["upperChest", torso.length >= 3 ? torso[torso.length - 1] : undefined],
    ["neck", above.find((j) => names[j]!.family === "neck") ?? above[0]],
    ["leftShoulder", LA.shoulder], ["rightShoulder", RA.shoulder], ["leftToes", LL.toes], ["rightToes", RL.toes],
  ];
  for (const [bone, joint] of optional) if (joint !== undefined) bones[bone] = joint;
  const tilt = upright >= 0.95 ? 1 : 0.6 + (0.4 * (upright - COSINE_UPRIGHT)) / (0.95 - COSINE_UPRIGHT);
  return { bones, up, forward, factor: factor * tilt };
}

/** 2: the name is this bone's name; 1: the name is of the bone's family (the limb position came from the chain); 0: no. */
function nameMatch(g: Rig, names: readonly Parsed[], bone: HumanoidBone, joint: number): number {
  const p = names[joint]!, side = bone.startsWith("left") ? "l" : bone.startsWith("right") ? "r" : "";
  const rest = side === "" ? bone : bone.slice(side === "l" ? 4 : 5);
  const part = rest[0]!.toLowerCase() + rest.slice(1);
  if (p.family === undefined || p.side !== side) return 0;
  switch (part) {
    case "hips": return p.family === "hips" ? 2 : p.family === "torso" && !(g.jp[joint]! >= 0 && names[g.jp[joint]!]!.family === "torso") ? 1 : 0;
    case "spine": case "chest": case "upperChest": return p.family === "torso" ? 2 : 0;
    case "neck": return p.family === "neck" ? 2 : 0;
    case "head": return p.family === "head" ? 2 : p.family === "neck" ? 1 : 0;
    default: {
      const [family, role] = ({ upperArm: ["arm", "upper"], lowerArm: ["arm", "lower"], hand: ["arm", "hand"], shoulder: ["arm", "shoulder"],
        upperLeg: ["leg", "upper"], lowerLeg: ["leg", "lower"], foot: ["leg", "foot"], toes: ["leg", "toe"] } as const)[part as "hand"];
      return p.family !== family ? 0 : p.role === role ? 2 : p.role === undefined ? 1 : 0;
    }
  }
}

/**
 * Maps a skin to the canonical humanoid bones, or explains why it is not a humanoid. Names decide where they
 * identify the legs, arms and head; the topology and bind geometry decide the rest (and everything when names fail).
 */
export function mapHumanoid(skin: MtekSkin): HumanoidMap | { readonly error: string } {
  try {
    if (skin.joints.length < REQUIRED_HUMANOID_BONES.length) return { error: `a humanoid needs at least ${REQUIRED_HUMANOID_BONES.length} joints, the skin has ${skin.joints.length}` };
    const g = analyse(skin), names = skin.nodes.map((n) => parseName(n.name));
    const byName = nameAnchors(g, names), byShape = structure(g, names);
    const attempts: [Anchors, { legs: boolean; arms: boolean }][] = [];
    const legs = byName.legs ?? byShape?.legs, arms = byName.arms ?? byShape?.arms, head = byName.head ?? byShape?.head;
    // Names give the sides of whatever they pick out; structural anchors are ordered by the facing found below.
    if (legs !== undefined && arms !== undefined && head !== undefined) attempts.push([{ legs, arms, head }, { legs: byName.legs !== undefined, arms: byName.arms !== undefined }]);
    if (byShape !== undefined && (attempts.length === 0 || attempts[0]![0].legs !== byShape.legs || attempts[0]![0].arms !== byShape.arms)) attempts.push([byShape, { legs: false, arms: false }]);
    let failure = "no leg pair, arm pair and head found by name or by structure";
    for (const [anchors, sided] of attempts) {
      const built = build(g, names, anchors, sided);
      if (typeof built === "string") { if (anchors === attempts[0]![0]) failure = built; continue; }
      const bones: Partial<Record<HumanoidBone, string>> = {}, evidence: Partial<Record<HumanoidBone, "name" | "structure">> = {};
      let sum = 0;
      for (const [bone, joint] of Object.entries(built.bones) as [HumanoidBone, number][]) {
        const name = skin.nodes[joint]!.name;
        if (skin.nodes.filter((n) => n.name === name).length !== 1) return { error: `the bone name ${JSON.stringify(name)} is not unique` };
        const match = nameMatch(g, names, bone, joint);
        bones[bone] = name;
        evidence[bone] = match > 0 ? "name" : "structure";
        if (REQUIRED_HUMANOID_BONES.includes(bone)) sum += match === 2 ? 1 : match === 1 ? 0.9 : 0.75;
      }
      return {
        bones, evidence, confidence: Math.round(Math.min(1, (sum / REQUIRED_HUMANOID_BONES.length) * built.factor) * 1000) / 1000,
        unmapped: OPTIONAL_HUMANOID_BONES.filter((b) => bones[b] === undefined), up: built.up, forward: built.forward,
      };
    }
    return { error: failure };
  } catch (e) {
    return { error: `the skin could not be analysed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
