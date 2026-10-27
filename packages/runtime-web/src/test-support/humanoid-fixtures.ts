// Test support (not shipped): synthetic humanoid skins and procedural clips for decision 0221.
//
// One canonical skeleton (metres, +Y up, facing +Z, the character's left on +X) is expressed under several rig-naming
// conventions, proportion variants, rest poses (T, A, A with bent knees), mesh frames, bone-axis conventions and
// extra non-humanoid bones. Clips are authored as world-space limb directions with planted feet, so the same motion
// can be written for any rest pose and compared after retargeting.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MtekSkin } from "../abi/manifest-types.js";
import { add, len, mul, qarc, qconj, qmul, qnorm, qrot, sub, unit, type Quat, type V3 } from "../scene/humanoid-rig.js";
import { skinFromGlb } from "./glb-skin.js";

export type ConventionId = "mixamo" | "unreal" | "unity" | "vrm" | "rigify" | "plain" | "bip" | "snake" | "short" | "scrambled";
export type Rest = "T" | "A" | "Abent";
export type Frame = "yup" | "zup" | "back";

export interface HumanoidSpec {
  readonly convention: ConventionId;
  /** Multipliers on leg, arm and spine lengths (default 1) and an overall scale (default 1; 100 for centimetres). */
  readonly legs?: number;
  readonly arms?: number;
  readonly spine?: number;
  readonly scale?: number;
  readonly rest?: Rest;
  readonly frame?: Frame;
  /** "bone": every bone's local +Y axis points along the bone, as exported by many tools. */
  readonly axes?: "world" | "bone";
  readonly extras?: { readonly props?: boolean; readonly twists?: boolean; readonly tail?: boolean; readonly fingers?: boolean; readonly face?: boolean };
  /** Names are replaced by `bone_<n>` in a fixed shuffled order (structure-only mapping). */
  readonly scramble?: boolean;
}

interface Convention {
  readonly has: { readonly root?: boolean; readonly chest: boolean; readonly upperChest: boolean; readonly neck: boolean; readonly clavicle: boolean; readonly toes: boolean; readonly toeEnd: boolean; readonly neck2?: boolean; readonly onChain?: boolean };
  /** Name of a part; `side` is "L", "R" or "". */
  readonly name: (part: string, side: string) => string;
}

const word = (side: string, left: string, right: string): string => (side === "L" ? left : right);

const CONVENTIONS: Record<Exclude<ConventionId, "scrambled">, Convention> = {
  mixamo: {
    has: { chest: true, upperChest: true, neck: true, clavicle: true, toes: true, toeEnd: true },
    name: (p, s) => "mixamorig:" + ({
      hips: "Hips", spine: "Spine", chest: "Spine1", upperChest: "Spine2", neck: "Neck", head: "Head", headTop: "HeadTop_End", jaw: "Jaw", eye: `${word(s, "Left", "Right")}Eye`,
      clavicle: `${word(s, "Left", "Right")}Shoulder`, upperArm: `${word(s, "Left", "Right")}Arm`, lowerArm: `${word(s, "Left", "Right")}ForeArm`, hand: `${word(s, "Left", "Right")}Hand`,
      finger: `${word(s, "Left", "Right")}HandIndex1`, upperLeg: `${word(s, "Left", "Right")}UpLeg`, lowerLeg: `${word(s, "Left", "Right")}Leg`, foot: `${word(s, "Left", "Right")}Foot`,
      toes: `${word(s, "Left", "Right")}ToeBase`, toeEnd: `${word(s, "Left", "Right")}Toe_End`, forearmTwist: `${word(s, "Left", "Right")}ForeArmTwist`, thighTwist: `${word(s, "Left", "Right")}UpLegTwist`,
      tail1: "Tail1", tail2: "Tail2", tail3: "Tail3", prop1: "Sword", prop2: "SwordTip",
    } as Record<string, string>)[p]!,
  },
  unreal: {
    has: { root: true, chest: true, upperChest: true, neck: true, clavicle: true, toes: true, toeEnd: false },
    name: (p, s) => ({
      root: "root", hips: "pelvis", spine: "spine_01", chest: "spine_02", upperChest: "spine_03", neck: "neck_01", head: "head", jaw: "jaw", eye: `eye_${s.toLowerCase()}`,
      clavicle: `clavicle_${s.toLowerCase()}`, upperArm: `upperarm_${s.toLowerCase()}`, lowerArm: `lowerarm_${s.toLowerCase()}`, hand: `hand_${s.toLowerCase()}`, finger: `index_01_${s.toLowerCase()}`,
      upperLeg: `thigh_${s.toLowerCase()}`, lowerLeg: `calf_${s.toLowerCase()}`, foot: `foot_${s.toLowerCase()}`, toes: `ball_${s.toLowerCase()}`,
      forearmTwist: `lowerarm_twist_01_${s.toLowerCase()}`, thighTwist: `thigh_twist_01_${s.toLowerCase()}`, tail1: "tail_01", tail2: "tail_02", tail3: "tail_03", prop1: "weapon_r", prop2: "weapon_tip",
    } as Record<string, string>)[p]!,
  },
  unity: {
    has: { chest: true, upperChest: true, neck: true, clavicle: true, toes: true, toeEnd: false },
    name: (p, s) => ({
      hips: "Hips", spine: "Spine", chest: "Chest", upperChest: "UpperChest", neck: "Neck", head: "Head", jaw: "Jaw", eye: `${word(s, "Left", "Right")}Eye`,
      clavicle: `${word(s, "Left", "Right")}Shoulder`, upperArm: `${word(s, "Left", "Right")}UpperArm`, lowerArm: `${word(s, "Left", "Right")}LowerArm`, hand: `${word(s, "Left", "Right")}Hand`,
      finger: `${word(s, "Left", "Right")}IndexProximal`, upperLeg: `${word(s, "Left", "Right")}UpperLeg`, lowerLeg: `${word(s, "Left", "Right")}LowerLeg`, foot: `${word(s, "Left", "Right")}Foot`,
      toes: `${word(s, "Left", "Right")}Toes`, forearmTwist: `${word(s, "Left", "Right")}LowerArmTwist`, thighTwist: `${word(s, "Left", "Right")}UpperLegTwist`,
      tail1: "Tail1", tail2: "Tail2", tail3: "Tail3", prop1: "Weapon", prop2: "WeaponTip",
    } as Record<string, string>)[p]!,
  },
  vrm: {
    has: { chest: true, upperChest: true, neck: true, clavicle: true, toes: true, toeEnd: false },
    name: (p, s) => ({
      hips: "J_Bip_C_Hips", spine: "J_Bip_C_Spine", chest: "J_Bip_C_Chest", upperChest: "J_Bip_C_UpperChest", neck: "J_Bip_C_Neck", head: "J_Bip_C_Head", jaw: "J_Adj_C_Jaw", eye: `J_Adj_${s}_FaceEye`,
      clavicle: `J_Bip_${s}_Shoulder`, upperArm: `J_Bip_${s}_UpperArm`, lowerArm: `J_Bip_${s}_LowerArm`, hand: `J_Bip_${s}_Hand`, finger: `J_Bip_${s}_Index1`,
      upperLeg: `J_Bip_${s}_UpperLeg`, lowerLeg: `J_Bip_${s}_LowerLeg`, foot: `J_Bip_${s}_Foot`, toes: `J_Bip_${s}_ToeBase`,
      forearmTwist: `J_Sec_${s}_ArmTwist`, thighTwist: `J_Sec_${s}_LegTwist`, tail1: "J_Sec_Tail1", tail2: "J_Sec_Tail2", tail3: "J_Sec_Tail3", prop1: "J_Opt_Sword", prop2: "J_Opt_SwordTip",
    } as Record<string, string>)[p]!,
  },
  rigify: {
    // Rigify DEF bones: the head is "DEF-spine.006" (no head word) and every limb segment is split by an on-chain twist bone.
    has: { chest: true, upperChest: true, neck: true, clavicle: true, toes: true, toeEnd: false, neck2: true, onChain: true },
    name: (p, s) => ({
      hips: "DEF-spine", spine: "DEF-spine.001", chest: "DEF-spine.002", upperChest: "DEF-spine.003", neck: "DEF-spine.004", neck2: "DEF-spine.005", head: "DEF-spine.006", jaw: "DEF-jaw", eye: `DEF-eye.${s}`,
      clavicle: `DEF-shoulder.${s}`, upperArm: `DEF-upper_arm.${s}`, upperArm2: `DEF-upper_arm.${s}.001`, lowerArm: `DEF-forearm.${s}`, lowerArm2: `DEF-forearm.${s}.001`, hand: `DEF-hand.${s}`, finger: `DEF-f_index.01.${s}`,
      upperLeg: `DEF-thigh.${s}`, upperLeg2: `DEF-thigh.${s}.001`, lowerLeg: `DEF-shin.${s}`, lowerLeg2: `DEF-shin.${s}.001`, foot: `DEF-foot.${s}`, toes: `DEF-toe.${s}`,
      forearmTwist: `DEF-forearm_tweak.${s}`, thighTwist: `DEF-thigh_tweak.${s}`, tail1: "DEF-tail.001", tail2: "DEF-tail.002", tail3: "DEF-tail.003", prop1: "prop_sword", prop2: "prop_sword_tip",
    } as Record<string, string>)[p]!,
  },
  plain: {
    // Plain "LeftUpLeg" style without upper chest, clavicles or toes.
    has: { chest: true, upperChest: false, neck: true, clavicle: false, toes: false, toeEnd: false },
    name: (p, s) => ({
      hips: "Hips", spine: "Spine", chest: "Chest", neck: "Neck", head: "Head", jaw: "Jaw", eye: `${word(s, "Left", "Right")}Eye`,
      upperArm: `${word(s, "Left", "Right")}Arm`, lowerArm: `${word(s, "Left", "Right")}ForeArm`, hand: `${word(s, "Left", "Right")}Hand`, finger: `${word(s, "Left", "Right")}Finger`,
      upperLeg: `${word(s, "Left", "Right")}UpLeg`, lowerLeg: `${word(s, "Left", "Right")}Leg`, foot: `${word(s, "Left", "Right")}Foot`,
      forearmTwist: `${word(s, "Left", "Right")}ForeArmRoll`, thighTwist: `${word(s, "Left", "Right")}UpLegRoll`, tail1: "Tail", tail2: "Tail_1", tail3: "Tail_2", prop1: "Sword", prop2: "SwordTip",
    } as Record<string, string>)[p]!,
  },
  bip: {
    has: { chest: true, upperChest: false, neck: true, clavicle: true, toes: true, toeEnd: false },
    name: (p, s) => ({
      hips: "Bip01_Pelvis", spine: "Bip01_Spine", chest: "Bip01_Spine1", neck: "Bip01_Neck", head: "Bip01_Head", jaw: "Bip01_Jaw", eye: `Bip01_${s}_Eye`,
      clavicle: `Bip01_${s}_Clavicle`, upperArm: `Bip01_${s}_UpperArm`, lowerArm: `Bip01_${s}_Forearm`, hand: `Bip01_${s}_Hand`, finger: `Bip01_${s}_Finger0`,
      upperLeg: `Bip01_${s}_Thigh`, lowerLeg: `Bip01_${s}_Calf`, foot: `Bip01_${s}_Foot`, toes: `Bip01_${s}_Toe0`,
      forearmTwist: `Bip01_${s}_ForeTwist`, thighTwist: `Bip01_${s}_ThighTwist`, tail1: "Bip01_Tail", tail2: "Bip01_Tail1", tail3: "Bip01_Tail2", prop1: "Bip01_Sword", prop2: "Bip01_SwordTip",
    } as Record<string, string>)[p]!,
  },
  snake: {
    has: { chest: true, upperChest: false, neck: true, clavicle: true, toes: true, toeEnd: false },
    name: (p, s) => ({
      hips: "hips", spine: "spine", chest: "chest", neck: "neck", head: "head", jaw: "jaw", eye: `${word(s, "left", "right")}_eye`,
      clavicle: `${word(s, "left", "right")}_shoulder`, upperArm: `${word(s, "left", "right")}_arm`, lowerArm: `${word(s, "left", "right")}_forearm`, hand: `${word(s, "left", "right")}_hand`,
      finger: `${word(s, "left", "right")}_index`, upperLeg: `${word(s, "left", "right")}_leg`, lowerLeg: `${word(s, "left", "right")}_shin`, foot: `${word(s, "left", "right")}_foot`,
      toes: `${word(s, "left", "right")}_toes`, forearmTwist: `${word(s, "left", "right")}_forearm_twist`, thighTwist: `${word(s, "left", "right")}_leg_twist`,
      tail1: "tail_1", tail2: "tail_2", tail3: "tail_3", prop1: "sword", prop2: "sword_tip",
    } as Record<string, string>)[p]!,
  },
  short: {
    has: { chest: true, upperChest: true, neck: true, clavicle: true, toes: true, toeEnd: false },
    name: (p, s) => ({
      hips: "Pelvis", spine: "Spine", chest: "Chest", upperChest: "Chest2", neck: "Neck", head: "Head", jaw: "Jaw", eye: `${s}_Eye`,
      clavicle: `${s}_Clavicle`, upperArm: `${s}_UpperArm`, lowerArm: `${s}_Forearm`, hand: `${s}_Hand`, finger: `${s}_Finger`,
      upperLeg: `${s}_Thigh`, lowerLeg: `${s}_Calf`, foot: `${s}_Foot`, toes: `${s}_Toe`, forearmTwist: `${s}_ForearmTwist`, thighTwist: `${s}_ThighTwist`,
      tail1: "Tail_A", tail2: "Tail_B", tail3: "Tail_C", prop1: "Sword", prop2: "SwordTip",
    } as Record<string, string>)[p]!,
  },
};
export const CONVENTION_IDS = [...Object.keys(CONVENTIONS), "scrambled"] as readonly ConventionId[];

export interface FixtureBone {
  readonly id: string;
  readonly part: string;
  readonly side: string;
  readonly name: string;
  readonly node: number;
  readonly parent: string | undefined;
  /** Bind position and rotation in the canonical frame (before the mesh frame is applied). */
  readonly pos: V3;
  readonly rot: Quat;
}

export interface FixtureRig {
  readonly skin: MtekSkin;
  readonly spec: HumanoidSpec;
  readonly bones: ReadonlyMap<string, FixtureBone>;
  /** Rotation from the canonical frame to the mesh-local frame. */
  readonly frame: Quat;
  readonly dims: { readonly thigh: number; readonly shin: number; readonly ankleY: number; readonly hipHalf: number; readonly hipDrop: number; readonly upperArm: number; readonly lowerArm: number; readonly scale: number };
  /** The bone realising each canonical humanoid bone, by `HumanoidBone` name. */
  readonly canonical: Readonly<Record<string, string>>;
}

const bid = (part: string, side: string): string => (side === "" ? part : `${part}.${side}`);
const SIDE_SIGN = { L: 1, R: -1 } as const;

interface Part { id: string; part: string; side: string; parent: string | undefined; pos: V3 }

function layout(spec: HumanoidSpec, conv: Convention): { parts: Part[]; dims: FixtureRig["dims"] } {
  const s = spec.scale ?? 1, pl = spec.legs ?? 1, pa = spec.arms ?? 1, ps = spec.spine ?? 1;
  const rest = spec.rest ?? "T", extras = spec.extras ?? {};
  const thigh = 0.43 * pl * s, shin = 0.44 * pl * s, ankleY = 0.08 * s, hipHalf = 0.09 * s, hipDrop = 0.05 * s, ua = 0.3 * pa * s, la = 0.27 * pa * s;
  const bend = rest === "Abent" ? 0.2 : 0;
  const hipY = ankleY + (thigh + shin) * Math.cos(bend);
  const hipsPos: V3 = [0, hipY + hipDrop, 0];
  const out: Part[] = [];
  const put = (part: string, side: string, parent: string | undefined, pos: V3): string => { const id = bid(part, side); out.push({ id, part, side, parent, pos }); return id; };
  let root: string | undefined;
  if (conv.has.root) root = put("root", "", undefined, [0, 0, 0]);
  const hips = put("hips", "", root, hipsPos);
  let top = put("spine", "", hips, add(hipsPos, [0, 0.1 * ps * s, 0]));
  let at = out[out.length - 1]!.pos;
  if (conv.has.chest) { at = add(at, [0, 0.15 * ps * s, 0]); top = put("chest", "", top, at); }
  if (conv.has.upperChest) { at = add(at, [0, 0.15 * ps * s, 0]); top = put("upperChest", "", top, at); }
  const torsoTop = at, torsoId = top;
  let head: string = torsoId;
  let up = torsoTop;
  if (conv.has.neck) { up = add(up, [0, 0.12 * ps * s, 0]); head = put("neck", "", torsoId, up); }
  if (conv.has.neck2) { up = add(up, [0, 0.04 * ps * s, 0]); head = put("neck2", "", head, up); }
  const headPos = add(up, [0, 0.1 * ps * s, 0]);
  head = put("head", "", head, headPos);
  if (conv.has.toeEnd) put("headTop", "", head, add(headPos, [0, 0.2 * s, 0]));
  if (extras.face !== false) {
    put("jaw", "", head, add(headPos, [0, -0.04 * s, 0.05 * s]));
    for (const side of ["L", "R"] as const) put("eye", side, head, add(headPos, [SIDE_SIGN[side] * 0.03 * s, 0.08 * s, 0.08 * s]));
  }
  const dir = rest === "T" ? (x: number): V3 => [x, 0, 0] : (x: number): V3 => [x * Math.SQRT1_2, -Math.SQRT1_2, 0];
  for (const side of ["L", "R"] as const) {
    const x = SIDE_SIGN[side], d = dir(x), shoulder = add(torsoTop, [x * 0.15 * s, 0.05 * s, 0]);
    let parent = torsoId;
    if (conv.has.clavicle) parent = put("clavicle", side, torsoId, add(torsoTop, [x * 0.03 * s, 0.05 * s, 0]));
    const upper = put("upperArm", side, parent, shoulder), elbow = add(shoulder, mul(d, ua)), wrist = add(elbow, mul(d, la));
    let chain = upper;
    if (conv.has.onChain) chain = put("upperArm2", side, upper, add(shoulder, mul(d, ua / 2)));
    const lower = put("lowerArm", side, chain, elbow);
    chain = lower;
    if (conv.has.onChain) chain = put("lowerArm2", side, lower, add(elbow, mul(d, la / 2)));
    const hand = put("hand", side, chain, wrist);
    if (extras.fingers !== false) put("finger", side, hand, add(wrist, mul(d, 0.08 * pa * s)));
    if (extras.twists === true) put("forearmTwist", side, lower, add(elbow, mul(d, la / 2)));
    if (extras.props === true && side === "R") { const p1 = put("prop1", "", hand, add(wrist, mul(d, 0.05 * s))); put("prop2", "", p1, add(add(wrist, mul(d, 0.05 * s)), [0, 0.6 * s, 0])); }
  }
  for (const side of ["L", "R"] as const) {
    const x = SIDE_SIGN[side], hipJoint = add(hipsPos, [x * hipHalf, -hipDrop, 0]);
    const knee = add(hipJoint, [0, -thigh * Math.cos(bend), thigh * Math.sin(bend)]), ankle = add(knee, [0, -shin * Math.cos(bend), -shin * Math.sin(bend)]);
    const upper = put("upperLeg", side, hips, hipJoint);
    let chain = upper;
    if (conv.has.onChain) chain = put("upperLeg2", side, upper, mul(add(hipJoint, knee), 0.5));
    const lower = put("lowerLeg", side, chain, knee);
    chain = lower;
    if (conv.has.onChain) chain = put("lowerLeg2", side, lower, mul(add(knee, ankle), 0.5));
    const foot = put("foot", side, chain, ankle);
    if (conv.has.toes) {
      const ball = put("toes", side, foot, add(ankle, [0, -0.06 * s, 0.13 * s]));
      if (conv.has.toeEnd) put("toeEnd", side, ball, add(ankle, [0, -0.08 * s, 0.2 * s]));
    }
    if (extras.twists === true) put("thighTwist", side, upper, mul(add(hipJoint, knee), 0.5));
  }
  if (extras.tail === true) {
    let parent = hips, p = hipsPos;
    for (const [k, part] of ["tail1", "tail2", "tail3"].entries()) { p = add(p, [0, -0.05 * s, -0.2 * s * (k + 1) / 2]); parent = put(part, "", parent, p); }
  }
  return { parts: out, dims: { thigh, shin, ankleY, hipHalf, hipDrop, upperArm: ua, lowerArm: la, scale: s } };
}

const CANONICAL_PARTS: Readonly<Record<string, [string, string]>> = {
  hips: ["hips", ""], spine: ["spine", ""], chest: ["chest", ""], upperChest: ["upperChest", ""], neck: ["neck", ""], head: ["head", ""],
};

const FRAMES: Record<Frame, Quat> = { yup: [0, 0, 0, 1], zup: [Math.SQRT1_2, 0, 0, Math.SQRT1_2], back: [0, 1, 0, 0] };
const SHUFFLE_ORDER = (n: number): number[] => {
  // A fixed pseudo-random permutation (linear congruential), so scrambled fixtures are reproducible.
  const order = Array.from({ length: n }, (_, i) => i);
  let state = 12345;
  for (let i = n - 1; i > 0; i--) { state = (state * 1103515245 + 12345) & 0x7fffffff; const j = state % (i + 1); [order[i], order[j]] = [order[j]!, order[i]!]; }
  return order;
};

export function buildHumanoid(spec: HumanoidSpec): FixtureRig {
  const convention = CONVENTIONS[(spec.convention === "scrambled" ? "mixamo" : spec.convention)];
  const conv: Convention = spec.convention === "scrambled" ? { ...convention, has: { ...convention.has, root: true } } : convention;
  const { parts, dims } = layout(spec, conv);
  const frame = FRAMES[spec.frame ?? "yup"], boneAxes = spec.axes === "bone";
  // Bind rotation: world-aligned, or +Y along the first child (the parent's rotation for leaves).
  const children = new Map<string, Part[]>();
  for (const p of parts) if (p.parent !== undefined) children.set(p.parent, [...(children.get(p.parent) ?? []), p]);
  const byId = new Map(parts.map((p) => [p.id, p]));
  const rots = new Map<string, Quat>();
  const rotOf = (p: Part): Quat => {
    const cached = rots.get(p.id);
    if (cached !== undefined) return cached;
    let r: Quat = [0, 0, 0, 1];
    if (boneAxes) {
      const kid = (children.get(p.id) ?? [])[0];
      r = kid !== undefined ? qarc([0, 1, 0], unit(sub(kid.pos, p.pos))) : p.parent !== undefined ? rotOf(byId.get(p.parent)!) : r;
    }
    rots.set(p.id, r);
    return r;
  };
  const baseNames = parts.map((p) => conv.name(p.part, p.side));
  const scrambled = spec.convention === "scrambled" || spec.scramble === true;
  const order = SHUFFLE_ORDER(parts.length);
  const nameOf = (i: number): string => (scrambled ? `bone_${String(order[i]).padStart(3, "0")}` : baseNames[i]!);
  const nodes: MtekSkin["nodes"][number][] = [];
  const addNode = (name: string, parent: number, translation: number[], rotation: number[]): number => { nodes.push({ name, parent, translation, rotation, scale: [1, 1, 1] }); return nodes.length - 1; };
  let armature = -1;
  if (spec.frame === "zup") armature = addNode("Z_UP", -1, [0, 0, 0], [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
  armature = addNode("Armature", armature, [0, 0, 0], [0, 0, 0, 1]);
  const meshNode = addNode("Body", armature, [0, 0, 0], [0, 0, 0, 1]);
  const bones = new Map<string, FixtureBone>(), nodeOf = new Map<string, number>();
  for (const [i, p] of parts.entries()) {
    const W = rotOf(p), parent = p.parent === undefined ? undefined : byId.get(p.parent)!;
    const local = parent === undefined ? { t: qrot(frame, p.pos), r: qnorm(qmul(frame, W)) } : { t: qrot(qconj(rotOf(parent)), sub(p.pos, parent.pos)), r: qnorm(qmul(qconj(rotOf(parent)), W)) };
    const node = addNode(nameOf(i), parent === undefined ? armature : nodeOf.get(parent.id)!, local.t, local.r);
    nodeOf.set(p.id, node);
    bones.set(p.id, { id: p.id, part: p.part, side: p.side, name: nameOf(i), node, parent: p.parent, pos: p.pos, rot: W });
  }
  const joints = parts.map((p) => nodeOf.get(p.id)!);
  const inverseBind = parts.map((p) => { const m = qrot(frame, p.pos); return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -m[0], -m[1], -m[2], 1]; });
  const canonical: Record<string, string> = {};
  for (const [bone, [part, side]] of Object.entries(CANONICAL_PARTS)) if (bones.has(bid(part, side))) canonical[bone] = bid(part, side);
  for (const [bone, part] of Object.entries({ UpperArm: "upperArm", LowerArm: "lowerArm", Hand: "hand", Shoulder: "clavicle", UpperLeg: "upperLeg", LowerLeg: "lowerLeg", Foot: "foot", Toes: "toes" }))
    for (const [prefix, side] of [["left", "L"], ["right", "R"]] as const) if (bones.has(bid(part, side))) canonical[prefix + bone] = bid(part, side);
  const skin: MtekSkin = { meshNode, nodes, joints, inverseBind, indices: [], weights: [], clips: [] };
  return { skin, spec, bones, frame, dims, canonical };
}

/** Expected `HumanoidMap.bones` (node names) of a fixture. */
export function expectedBones(rig: FixtureRig): Record<string, string> {
  return Object.fromEntries(Object.entries(rig.canonical).map(([bone, id]) => [bone, rig.bones.get(id)!.name]));
}

// ---- clips ---------------------------------------------------------------------------------------------------------

const smooth = (x: number): number => x * x * (3 - 2 * x);
const yawRot = (a: number): Quat => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
const pitchRot = (a: number): Quat => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];

interface Pose { readonly hips: V3; readonly yaw: Record<string, number>; readonly dirs: Record<string, V3>; readonly footPitch: Record<string, number> }

/** Two-bone IK in the canonical frame: bend towards +Z. Returns the thigh and shin directions. */
function legIK(hip: V3, ankle: V3, thigh: number, shin: number): [V3, V3] {
  let axis = sub(ankle, hip), d = len(axis);
  const reach = (thigh + shin) * 0.9995;
  if (d > reach) { axis = mul(axis, reach / d); d = reach; }
  const e = unit(axis), a = (thigh * thigh - shin * shin + d * d) / (2 * d), h = Math.sqrt(Math.max(thigh * thigh - a * a, 0));
  const n = unit(sub([0, 0, 1], mul(e, e[2])));
  const knee = add(add(hip, mul(e, a)), mul(n, h));
  return [unit(sub(knee, hip)), unit(sub(add(hip, axis), knee))];
}

/** A walk cycle with planted stance feet (duty 0.6) in which the hips travel; period 1 s. */
function walkPose(rig: FixtureRig, t: number): Pose {
  const { thigh, shin, ankleY, hipHalf, hipDrop, scale } = rig.dims, total = thigh + shin;
  const T = 1, duty = 0.6, stride = 0.5 * total, phi = (2 * Math.PI * t) / T;
  const baseY = ankleY + total * 0.965 + hipDrop;
  const hips: V3 = [0.01 * scale * Math.sin(phi), baseY + 0.012 * total * Math.cos(2 * phi), (stride / T) * t];
  const yaw = { hips: 0.1 * Math.sin(phi), spine: -0.05 * Math.sin(phi), chest: -0.07 * Math.sin(phi), upperChest: -0.02 * Math.sin(phi) };
  const dirs: Record<string, V3> = {}, footPitch: Record<string, number> = {};
  for (const side of ["L", "R"] as const) {
    const x = SIDE_SIGN[side], shift = side === "L" ? 0 : 0.5, cycle = t / T + shift, k = Math.floor(cycle), u = cycle - k;
    const planted = stride * (k + duty / 2 - shift);
    let z = planted, y = ankleY, pitch = 0;
    if (u >= duty) { const s = (u - duty) / (1 - duty); z = planted + stride * smooth(s); y = ankleY + 0.12 * total * Math.sin(Math.PI * s); pitch = 0.5 * Math.sin(Math.PI * s); }
    const hipJoint = add(hips, qrot(yawRot(yaw.hips), [x * hipHalf, -hipDrop, 0]));
    const [thighDir, shinDir] = legIK(hipJoint, [x * hipHalf, y, z], thigh, shin);
    dirs[bid("upperLeg", side)] = thighDir; dirs[bid("lowerLeg", side)] = shinDir; footPitch[bid("foot", side)] = pitch;
    const swing = 0.45 * Math.sin(phi + (side === "L" ? Math.PI : 0));
    dirs[bid("upperArm", side)] = unit([x * 0.12, -Math.cos(swing), Math.sin(swing)]);
    const elbow = swing + 0.35 + 0.25 * Math.sin(phi + (side === "L" ? Math.PI : 0) + 1);
    dirs[bid("lowerArm", side)] = unit([x * 0.08, -Math.cos(elbow), Math.sin(elbow)]);
  }
  return { hips, yaw, dirs, footPitch };
}

/** Standing in place, the right arm raised and waving; the left arm hangs. Period 2 s. */
function wavePose(rig: FixtureRig, t: number): Pose {
  const { thigh, shin, ankleY, hipHalf, hipDrop } = rig.dims;
  const phi = (2 * Math.PI * t) / 2, hips: V3 = [0, ankleY + (thigh + shin) * 0.999 + hipDrop, 0];
  const dirs: Record<string, V3> = {}, footPitch: Record<string, number> = {};
  for (const side of ["L", "R"] as const) {
    const x = SIDE_SIGN[side];
    const [a, b] = legIK(add(hips, [x * hipHalf, -hipDrop, 0]), [x * hipHalf, ankleY, 0], thigh, shin);
    dirs[bid("upperLeg", side)] = a; dirs[bid("lowerLeg", side)] = b; footPitch[bid("foot", side)] = 0;
  }
  dirs[bid("upperArm", "L")] = unit([0.18, -1, 0.05]); dirs[bid("lowerArm", "L")] = unit([0.12, -1, 0.15]);
  dirs[bid("upperArm", "R")] = unit([-0.75, 0.55, 0.1]);
  dirs[bid("lowerArm", "R")] = unit([-0.25 - 0.6 * Math.sin(3 * phi), 0.9, 0.05 + 0.2 * Math.cos(3 * phi)]);
  return { hips, yaw: { spine: 0.05 * Math.sin(phi), chest: 0.04 * Math.sin(phi), head: 0.2 * Math.sin(2 * phi) }, dirs, footPitch };
}

export const PROCEDURAL_CLIPS = { walk: { duration: 1, pose: walkPose }, wave: { duration: 2, pose: wavePose } } as const;
export type ProceduralClip = keyof typeof PROCEDURAL_CLIPS;

const CHILD_OF: Record<string, string> = { upperArm: "lowerArm", lowerArm: "hand", upperLeg: "lowerLeg", lowerLeg: "foot" };

/** The rig with the named procedural clips (rotations of the humanoid bones plus the hips translation, 30 keys per second). */
export function withClips(rig: FixtureRig, names: readonly ProceduralClip[]): FixtureRig {
  const clips = names.map((name) => {
    const { duration, pose } = PROCEDURAL_CLIPS[name], steps = Math.round(duration * 30), times = Array.from({ length: steps + 1 }, (_, i) => i / 30);
    const driven = [...rig.bones.values()].filter((b) => ["hips", "spine", "chest", "upperChest", "neck", "head", "upperArm", "lowerArm", "upperLeg", "lowerLeg", "foot"].includes(b.part));
    const values = new Map<string, number[]>(), hipsValues: number[] = [];
    const worlds = (t: number): Map<string, Quat> => {
      const p = pose(rig, t), out = new Map<string, Quat>();
      const world = (b: FixtureBone): Quat => {
        const cached = out.get(b.id);
        if (cached !== undefined) return cached;
        let w: Quat;
        const dir = p.dirs[b.id], yaw = p.yaw[b.part], pitch = p.footPitch[b.id];
        if (dir !== undefined) {
          const child = rig.bones.get(bid(CHILD_OF[b.part]!, b.side))!;
          w = qnorm(qmul(qarc(unit(sub(child.pos, b.pos)), dir), b.rot));
        } else if (pitch !== undefined) w = qnorm(qmul(pitchRot(pitch), b.rot));
        else if (yaw !== undefined) w = qnorm(qmul(yawRot(yaw), b.rot));
        else if (b.parent === undefined) w = b.rot;
        else { const parent = rig.bones.get(b.parent)!; w = qnorm(qmul(world(parent), qmul(qconj(parent.rot), b.rot))); }
        out.set(b.id, w);
        return w;
      };
      for (const b of rig.bones.values()) world(b);
      return out;
    };
    for (const b of driven) values.set(b.id, []);
    for (const t of times) {
      const w = worlds(t), p = pose(rig, t);
      for (const b of driven) {
        const local = b.parent === undefined ? qmul(rig.frame, w.get(b.id)!) : qmul(qconj(w.get(b.parent)!), w.get(b.id)!);
        const list = values.get(b.id)!, prev = list.length >= 4 ? list.slice(-4) : undefined;
        const flip = prev !== undefined && prev[0]! * local[0] + prev[1]! * local[1] + prev[2]! * local[2] + prev[3]! * local[3] < 0 ? -1 : 1;
        list.push(...local.map((v) => v * flip));
      }
      const hipsBone = rig.bones.get("hips")!, parent = hipsBone.parent === undefined ? undefined : rig.bones.get(hipsBone.parent)!;
      hipsValues.push(...(parent === undefined ? qrot(rig.frame, p.hips) : qrot(qconj(parent.rot), sub(p.hips, parent.pos))));
    }
    const channels = [
      ...driven.map((b) => ({ node: b.node, path: "rotation" as const, interpolation: "linear" as const, times, values: values.get(b.id)! })),
      { node: rig.bones.get("hips")!.node, path: "translation" as const, interpolation: "linear" as const, times, values: hipsValues },
    ];
    return { name, duration, channels };
  });
  return { ...rig, skin: { ...rig.skin, clips } };
}

// ---- real skins ----------------------------------------------------------------------------------------------------

export interface RealSkins {
  readonly cesiumMan: MtekSkin;
  readonly fox: MtekSkin;
  /** CesiumMan with the leg and arm proportions of the character-composition example (legs x1.2, arms x0.9, pelvis +0.108). */
  readonly cesiumLongLegs: MtekSkin;
  /** The prepared example models (git-ignored), when `scene/models` exists. */
  readonly composition?: { readonly source: MtekSkin; readonly longLegs: MtekSkin };
}

export function loadRealSkins(repoRoot: string): RealSkins {
  const read = (path: string): MtekSkin => skinFromGlb(readFileSync(join(repoRoot, path)));
  const cesiumMan = read("benchmarks/runtime/animation/assets/CesiumMan/CesiumMan.glb"), fox = read("benchmarks/runtime/animation/assets/Fox/Fox.glb");
  const nodes = cesiumMan.nodes.map((n) => {
    const leg = /^leg_joint_[LR]_[235]$/.test(n.name), arm = /^Skeleton_arm_joint_[LR]__/.test(n.name), scale = leg ? 1.2 : arm ? 0.9 : 1;
    const translation = n.translation.map((v) => v * scale);
    if (n.name === "Skeleton_torso_joint_1") translation[2] = translation[2]! + 0.108;
    return { ...n, translation };
  });
  const models = "examples/character-composition/scene/models";
  const composition = existsSync(join(repoRoot, models, "Source.glb")) && existsSync(join(repoRoot, models, "LongLegs.glb"))
    ? { source: read(`${models}/Source.glb`), longLegs: read(`${models}/LongLegs.glb`) } : undefined;
  return { cesiumMan, fox, cesiumLongLegs: { ...cesiumMan, nodes, clips: [] }, ...(composition === undefined ? {} : { composition }) };
}

