// Shared by the humanoid mapper and retargeter (decision 0221): the bone vocabulary, vector/quaternion helpers,
// bind-pose analysis of a skin in the frame of its mesh node and joint-name parsing.
import type { MtekSkin } from "../abi/manifest-types.js";
import { numericallyUniformScale } from "./uniform-scale.js";

export type HumanoidBone =
  | "hips" | "spine" | "chest" | "upperChest" | "neck" | "head"
  | "leftShoulder" | "leftUpperArm" | "leftLowerArm" | "leftHand"
  | "rightShoulder" | "rightUpperArm" | "rightLowerArm" | "rightHand"
  | "leftUpperLeg" | "leftLowerLeg" | "leftFoot" | "leftToes"
  | "rightUpperLeg" | "rightLowerLeg" | "rightFoot" | "rightToes";

export interface HumanoidMap {
  readonly bones: Readonly<Partial<Record<HumanoidBone, string>>>;
  readonly evidence: Readonly<Partial<Record<HumanoidBone, "name" | "structure">>>;
  readonly confidence: number;
  readonly unmapped: readonly HumanoidBone[];
  readonly up: readonly [number, number, number];
  readonly forward: readonly [number, number, number];
}

export const REQUIRED_HUMANOID_BONES: readonly HumanoidBone[] = [
  "hips", "spine", "head", "leftUpperLeg", "leftLowerLeg", "leftFoot", "rightUpperLeg", "rightLowerLeg", "rightFoot",
  "leftUpperArm", "leftLowerArm", "leftHand", "rightUpperArm", "rightLowerArm", "rightHand",
];
export const OPTIONAL_HUMANOID_BONES: readonly HumanoidBone[] = [
  "chest", "upperChest", "neck", "leftShoulder", "rightShoulder", "leftToes", "rightToes",
];

// ---- small vector and quaternion helpers (also used by the retargeter) ---------------------------------------

export type V3 = [number, number, number];
export type Quat = [number, number, number, number];
export const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
export const add = (a: readonly number[], b: readonly number[]): V3 => [a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!];
export const mul = (a: readonly number[], s: number): V3 => [a[0]! * s, a[1]! * s, a[2]! * s];
export const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
export const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
export const len = (a: readonly number[]): number => Math.hypot(a[0]!, a[1]!, a[2]!);
export const unit = (a: readonly number[]): V3 => { const l = len(a); return l < 1e-12 ? [0, 0, 0] : [a[0]! / l, a[1]! / l, a[2]! / l]; };
/** `a` with its component along the unit vector `n` removed. */
export const orth = (a: readonly number[], n: readonly number[]): V3 => sub(a, mul(n, dot(a, n)));
export const qmul = (a: readonly number[], b: readonly number[]): Quat => [
  a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!,
  a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!,
  a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!,
  a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!,
];
export const qconj = (q: readonly number[]): Quat => [-q[0]!, -q[1]!, -q[2]!, q[3]!];
export const qnorm = (q: readonly number[]): Quat => { const l = Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!); return [q[0]! / l, q[1]! / l, q[2]! / l, q[3]! / l]; };
export const qrot = (q: readonly number[], v: readonly number[]): V3 => {
  const t = mul(cross(q, v), 2);
  return add(add(v, mul(t, q[3]!)), cross(q, t));
};
/** Shortest-arc rotation taking unit vector `a` to unit vector `b`. */
export function qarc(a: readonly number[], b: readonly number[]): Quat {
  const d = dot(a, b);
  if (d < -1 + 1e-9) {
    const axis = unit(len(cross(a, [1, 0, 0])) > 1e-3 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]));
    return [axis[0], axis[1], axis[2], 0];
  }
  const c = cross(a, b);
  return qnorm([c[0], c[1], c[2], 1 + d]);
}
/** Rotation whose columns are the images of x, y and z. */
export function qbasis(x: readonly number[], y: readonly number[], z: readonly number[]): Quat {
  const [m00, m10, m20] = [x[0]!, x[1]!, x[2]!], [m01, m11, m21] = [y[0]!, y[1]!, y[2]!], [m02, m12, m22] = [z[0]!, z[1]!, z[2]!];
  const t = m00 + m11 + m22;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; return qnorm([(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4]); }
  if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; return qnorm([s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]); }
  if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; return qnorm([(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s]); }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return qnorm([(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s]);
}

// ---- bind analysis --------------------------------------------------------------------------------------------

/** World similarity transforms (rotation, uniform scale, position) of a pose given local TRS per node. */
export interface Similarity { readonly rot: Quat[]; readonly scale: number[]; readonly pos: V3[] }

export function worldSimilarity(skin: MtekSkin, order: readonly number[], local: (i: number) => { t: readonly number[]; r: readonly number[]; s: number }): Similarity {
  const rot: Quat[] = [], scale: number[] = [], pos: V3[] = [];
  for (const i of order) {
    const { t, r, s } = local(i), p = skin.nodes[i]!.parent;
    if (p < 0) { rot[i] = qnorm(r); scale[i] = s; pos[i] = [t[0]!, t[1]!, t[2]!]; }
    else { rot[i] = qnorm(qmul(rot[p]!, r)); scale[i] = scale[p]! * s; pos[i] = add(pos[p]!, mul(qrot(rot[p]!, t), scale[p]!)); }
  }
  return { rot, scale, pos };
}

/** Parents-first node order. */
export function nodeOrder(skin: MtekSkin): number[] {
  const seen = new Set<number>(), out: number[] = [];
  const visit = (i: number): void => { if (seen.has(i)) return; const p = skin.nodes[i]!.parent; if (p >= 0) visit(p); seen.add(i); out.push(i); };
  skin.nodes.forEach((_, i) => visit(i));
  return out;
}

export interface Rig {
  readonly skin: MtekSkin;
  readonly count: number;
  readonly order: readonly number[];
  readonly isJoint: readonly boolean[];
  /** Bind position, rotation and uniform scale of every node in the frame of the mesh node. */
  readonly P: readonly V3[];
  readonly Q: readonly Quat[];
  readonly S: readonly number[];
  /** Bind world rotation of the mesh node (to express the world's +Z in mesh-local axes). */
  readonly meshRot: Quat;
  /** The world origin in mesh-local position and scale (the frame of a root node without parent). */
  readonly origin: { readonly pos: V3; readonly scale: number };
  /** Nearest joint ancestor (-1 for none). */
  readonly jp: readonly number[];
  readonly kids: readonly (readonly number[])[];
  readonly height: readonly number[];
  readonly size: readonly number[];
}

export function analyse(skin: MtekSkin): Rig {
  const n = skin.nodes.length, order = nodeOrder(skin);
  const bind = worldSimilarity(skin, order, (i) => { const node = skin.nodes[i]!; return { t: node.translation, r: node.rotation, s: node.scale[0]! }; });
  const m = skin.meshNode, inv = qconj(bind.rot[m]!);
  const P = bind.pos.map((p) => mul(qrot(inv, sub(p, bind.pos[m]!)), 1 / bind.scale[m]!));
  const Q = bind.rot.map((r) => qnorm(qmul(inv, r)));
  const S = bind.scale.map((s) => s / bind.scale[m]!);
  const isJoint = skin.nodes.map((_, i) => skin.joints.includes(i));
  const jp = skin.nodes.map((_, i) => { let p = skin.nodes[i]!.parent; while (p >= 0 && !isJoint[p]) p = skin.nodes[p]!.parent; return p; });
  const kids: number[][] = skin.nodes.map(() => []);
  for (let i = 0; i < n; i++) if (isJoint[i] && jp[i]! >= 0) kids[jp[i]!]!.push(i);
  const height = new Array<number>(n).fill(0), size = new Array<number>(n).fill(1);
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k]!;
    if (!isJoint[i] || jp[i]! < 0) continue;
    height[jp[i]!] = Math.max(height[jp[i]!]!, height[i]! + 1);
    size[jp[i]!] = size[jp[i]!]! + size[i]!;
  }
  return { skin, count: n, order, isJoint, P, Q, S, meshRot: bind.rot[m]!, origin: { pos: mul(qrot(inv, mul(bind.pos[m]!, -1)), 1 / bind.scale[m]!), scale: 1 / bind.scale[m]! }, jp, kids, height, size };
}

/** Whether every node scale is uniform within the float32 round-off band of decision 0209. */
export const uniformScales = (skin: MtekSkin): boolean => skin.nodes.every((n) => numericallyUniformScale(n.scale[0]!, n.scale[1]!, n.scale[2]!));

// ---- names -----------------------------------------------------------------------------------------------------

export type Family = "hips" | "torso" | "neck" | "head" | "leg" | "arm";
export type Role = "upper" | "lower" | "foot" | "toe" | "shoulder" | "hand";
export interface Parsed { readonly family?: Family; readonly role?: Role; readonly side: "" | "l" | "r" }

// Stems (the words of a name joined, without side words, digits and rig-prefix words) per family and limb role.
export const NAME_TABLE_SPEC =
  "hips:hips hip pelvis waist cog;torso:spine chest upperchest uppchest torso abdomen back ribcage;neck:neck;head:head;" +
  "leg.upper:thigh upleg upperleg uleg femur;leg.lower:calf shin lowerleg lowleg knee tibia;leg.foot:ankle foot;leg.toe:toe toes toebase ball;leg:leg;" +
  "arm.shoulder:shoulder clavicle collar collarbone clav;arm.upper:upperarm uparm humerus;arm.lower:forearm lowerarm lowarm elbow ulna;arm.hand:hand wrist;arm:arm";
const NAME_TABLE = new Map<string, { family: Family; role?: Role }>();
for (const row of NAME_TABLE_SPEC.split(";")) {
  const [key, words] = row.split(":") as [string, string], [family, role] = key.split(".") as [Family, Role | undefined];
  for (const word of words.split(" ")) NAME_TABLE.set(word, role === undefined ? { family } : { family, role });
}
export const NOISE_WORDS = "mixamorig mixamo def org mch j b bip valvebiped cc base bone joint skeleton armature rig c";
const NOISE = new Set(NOISE_WORDS.split(" "));

/** Family, limb role and side of a joint name; empty when the name is not a humanoid bone name. */
export function parseName(name: string): Parsed {
  const words = name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(/[^A-Za-z]+/)
    .filter((w) => w !== "").map((w) => w.toLowerCase());
  let side: "" | "l" | "r" = "";
  const stem: string[] = [];
  for (const w of words) {
    if (NOISE.has(w)) continue;
    if (w === "left" || w === "l") side = "l";
    else if (w === "right" || w === "r") side = "r";
    else stem.push(w);
  }
  const key = stem.join("");
  // A plain "hip" is the pelvis; with a side it is the upper leg (SMPL-style rigs).
  const found = key === "hip" ? (side === "" ? { family: "hips" as const } : { family: "leg" as const, role: "upper" as const }) : NAME_TABLE.get(key);
  // Limb bones need a side; centre bones must not have one.
  if (found === undefined || (found.family === "leg" || found.family === "arm") !== (side !== "")) return { side };
  return found.role === undefined ? { family: found.family, side } : { family: found.family, role: found.role, side };
}
