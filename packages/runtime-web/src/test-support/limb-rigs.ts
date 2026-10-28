import type { MtekSkin } from "../abi/manifest-types.js";
import type { HumanoidBone, HumanoidMap } from "../scene/humanoid-types.js";

// Synthetic humanoid rigs for the limb solver (decision 0222): any proportions, bind bend, bone frames, up axis and scale.
// Canonical rig coordinates: x = character left, y = up, z = forward (the glTF convention).
type V = [number, number, number];
type Q = [number, number, number, number];

export const qmul = (a: Q, b: Q): Q => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
export const qconj = (q: Q): Q => [-q[0], -q[1], -q[2], q[3]];
export const qrot = (q: Q, v: V): V => {
  const t: V = [2 * (q[1] * v[2] - q[2] * v[1]), 2 * (q[2] * v[0] - q[0] * v[2]), 2 * (q[0] * v[1] - q[1] * v[0])];
  return [v[0] + q[3] * t[0] + (q[1] * t[2] - q[2] * t[1]), v[1] + q[3] * t[1] + (q[2] * t[0] - q[0] * t[2]), v[2] + q[3] * t[2] + (q[0] * t[1] - q[1] * t[0])];
};
export const qaxis = (axis: V, angle: number): Q => {
  const length = Math.hypot(...axis), s = Math.sin(angle / 2) / length;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
};
export const qfromto = (a: V, b: V): Q => {
  const la = Math.hypot(...a), lb = Math.hypot(...b), u: V = [a[0] / la, a[1] / la, a[2] / la], v: V = [b[0] / lb, b[1] / lb, b[2] / lb];
  const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  if (d < -1 + 1e-12) return Math.abs(u[0]) < 0.9 ? qaxis([0, u[2], -u[1]], Math.PI) : qaxis([-u[2], 0, u[0]], Math.PI);
  const q: Q = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0], 1 + d];
  const n = Math.hypot(...q);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
};
export const IDENTITY: Q = [0, 0, 0, 1];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (a: V): V => scale(a, 1 / Math.hypot(...a));

export interface RigOptions {
  /** Segment lengths, or [left, right]. Defaults 0.45 / 0.42 / 0.30 / 0.27. */
  readonly upperLeg?: number | readonly [number, number];
  readonly lowerLeg?: number | readonly [number, number];
  readonly upperArm?: number | readonly [number, number];
  readonly lowerArm?: number | readonly [number, number];
  /** Ankle height above the sole and foot length (toes joint ahead of the ankle). */
  readonly ankle?: number;
  readonly footLength?: number;
  /** Bind knee/elbow flexion in degrees (knees forward, elbows backward); 0 is a straight bind limb. */
  readonly kneeBind?: number | readonly [number, number];
  readonly elbowBind?: number;
  readonly armPose?: "t" | "a";
  /** Bone-aligned bind frames (local y along the bone, rolled) instead of identity world rotations. */
  readonly boneFrames?: boolean;
  /** Root transform of the skeleton and the mesh node's rotation relative to it (a Z-up mesh is a rotated mesh node). */
  readonly rigRotation?: Q;
  readonly rigScale?: number;
  readonly rigTranslation?: V;
  readonly meshRotation?: Q;
  readonly toes?: boolean;
}
export interface TestRig {
  readonly skin: MtekSkin;
  readonly map: HumanoidMap;
  readonly names: Readonly<Record<HumanoidBone, string>>;
  /** Straight chord lengths in rig units: [upper, lower] per limb. */
  readonly lengths: { readonly leftLeg: readonly [number, number]; readonly rightLeg: readonly [number, number]; readonly leftArm: readonly [number, number]; readonly rightArm: readonly [number, number] };
  readonly nodeIndex: (bone: string) => number;
  /** Mesh-local bind position of a bone (rig units, mesh frame). */
  readonly bindPosition: (bone: HumanoidBone) => V;
  /** Rig unit to mesh-local factor (the mesh node has no scale of its own, so 1) and the mesh-local up and forward. */
  readonly up: V;
  readonly forward: V;
}
const pair = (value: number | readonly [number, number] | undefined, fallback: number): [number, number] =>
  value === undefined ? [fallback, fallback] : typeof value === "number" ? [value, value] : [value[0], value[1]];

const ALL: readonly HumanoidBone[] = ["hips", "spine", "chest", "upperChest", "neck", "head", "leftShoulder", "rightShoulder", "leftUpperArm", "leftLowerArm", "leftHand",
  "rightUpperArm", "rightLowerArm", "rightHand", "leftUpperLeg", "leftLowerLeg", "leftFoot", "leftToes", "rightUpperLeg", "rightLowerLeg", "rightFoot", "rightToes"];

export function humanoidRig(options: RigOptions = {}): TestRig {
  const [ulL, ulR] = pair(options.upperLeg, 0.45), [llL, llR] = pair(options.lowerLeg, 0.42);
  const [uaL, uaR] = pair(options.upperArm, 0.30), [laL, laR] = pair(options.lowerArm, 0.27);
  const [kneeL, kneeR] = pair(options.kneeBind, 0);
  const ankle = options.ankle ?? 0.08, footLength = options.footLength ?? 0.22, elbow = options.elbowBind ?? 0;
  const rad = (d: number): number => (d * Math.PI) / 180;
  // World positions (canonical rig frame).
  const position = new Map<HumanoidBone, V>();
  const extent = (upper: number, lower: number, bend: number): number => (upper + lower) * Math.cos(rad(bend) / 2);
  const extentL = extent(ulL, llL, kneeL), extentR = extent(ulR, llR, kneeR);
  const hipHeight = Math.max(extentL, extentR) + ankle, hipWidth = 0.09;
  position.set("hips", [0, hipHeight, 0]);
  const legs = (side: 1 | -1, upper: number, lower: number, bend: number, prefix: "left" | "right"): void => {
    const hip: V = [side * hipWidth, hipHeight - 0.04, 0];
    const t: V = [0, -Math.cos(rad(bend) / 2), Math.sin(rad(bend) / 2)], s: V = [0, -Math.cos(rad(bend) / 2), -Math.sin(rad(bend) / 2)];
    const knee = add(hip, scale(t, upper)), foot = add(knee, scale(s, lower));
    position.set(`${prefix}UpperLeg`, hip); position.set(`${prefix}LowerLeg`, knee); position.set(`${prefix}Foot`, foot);
    position.set(`${prefix}Toes`, add(foot, [0, -ankle * 0.6, footLength]));
  };
  legs(1, ulL, llL, kneeL, "left"); legs(-1, ulR, llR, kneeR, "right");
  const spine: V = [0, hipHeight + 0.12, 0], chest: V = [0, hipHeight + 0.30, 0], upper: V = [0, hipHeight + 0.45, 0], neck: V = [0, hipHeight + 0.55, 0], head: V = [0, hipHeight + 0.68, 0];
  position.set("spine", spine); position.set("chest", chest); position.set("upperChest", upper); position.set("neck", neck); position.set("head", head);
  const arms = (side: 1 | -1, ua: number, la: number, prefix: "left" | "right"): void => {
    position.set(`${prefix}Shoulder`, [side * 0.03, upper[1], 0]);
    const root: V = [side * 0.17, upper[1], 0];
    // T pose: along +-x; A pose: 40 degrees down. Bend is toward -z (elbow back) for the upper arm, +z for the forearm.
    const drop = options.armPose === "a" ? rad(40) : 0, half = rad(elbow) / 2;
    const dirU: V = unit([side * Math.cos(drop) * Math.cos(half), -Math.sin(drop) * Math.cos(half), -Math.sin(half)]);
    const dirL: V = unit([side * Math.cos(drop) * Math.cos(half), -Math.sin(drop) * Math.cos(half), Math.sin(half)]);
    const e = add(root, scale(dirU, ua)), h = add(e, scale(dirL, la));
    position.set(`${prefix}UpperArm`, root); position.set(`${prefix}LowerArm`, e); position.set(`${prefix}Hand`, h);
  };
  arms(1, uaL, laL, "left"); arms(-1, uaR, laR, "right");

  const parentBone: Partial<Record<HumanoidBone, HumanoidBone>> = {
    spine: "hips", chest: "spine", upperChest: "chest", neck: "upperChest", head: "neck",
    leftShoulder: "upperChest", rightShoulder: "upperChest", leftUpperArm: "leftShoulder", rightUpperArm: "rightShoulder",
    leftLowerArm: "leftUpperArm", rightLowerArm: "rightUpperArm", leftHand: "leftLowerArm", rightHand: "rightLowerArm",
    leftUpperLeg: "hips", rightUpperLeg: "hips", leftLowerLeg: "leftUpperLeg", rightLowerLeg: "rightUpperLeg", leftFoot: "leftLowerLeg", rightFoot: "rightLowerLeg",
    leftToes: "leftFoot", rightToes: "rightFoot",
  };
  const names = Object.fromEntries(ALL.map(bone => [bone, `${bone}_bone`])) as Record<HumanoidBone, string>;
  const included = ALL.filter(bone => options.toes !== false || !bone.endsWith("Toes"));
  // Node 0: rig root, node 1: mesh node (own rotation), then skeleton in `included` order (parents precede children).
  const worldRotation = new Map<HumanoidBone, Q>();
  const firstChild = (bone: HumanoidBone): HumanoidBone | undefined => included.find(c => parentBone[c] === bone && !c.endsWith("Shoulder"));
  included.forEach((bone, i) => {
    if (options.boneFrames !== true) { worldRotation.set(bone, IDENTITY); return; }
    const child = bone === "hips" ? "spine" : bone.endsWith("Foot") ? (bone === "leftFoot" ? "leftToes" : "rightToes") as HumanoidBone : firstChild(bone);
    const from = position.get(bone)!, direction = child !== undefined && position.has(child) ? sub(position.get(child)!, from) : sub(from, position.get(parentBone[bone]!)!);
    const align = qfromto([0, 1, 0], direction);
    worldRotation.set(bone, qmul(qaxis(unit(direction), 0.3 + 0.17 * i), align));
  });
  const rigRotation = options.rigRotation ?? IDENTITY, rigScale = options.rigScale ?? 1, rigTranslation = options.rigTranslation ?? [0, 0, 0], meshRotation = options.meshRotation ?? IDENTITY;
  const nodes: MtekSkin["nodes"][number][] = [
    { name: "rig_root", parent: -1, translation: rigTranslation, rotation: rigRotation, scale: [rigScale, rigScale, rigScale] },
    { name: "mesh", parent: 0, translation: [0, 0, 0], rotation: meshRotation, scale: [1, 1, 1] },
  ];
  const index = new Map<HumanoidBone, number>();
  for (const bone of included) {
    const parent = parentBone[bone];
    const parentIndex = parent === undefined ? 0 : index.get(parent)!;
    const parentPosition = parent === undefined ? ([0, 0, 0] as V) : position.get(parent)!, parentRotation = parent === undefined ? IDENTITY : worldRotation.get(parent)!;
    const inverse = qconj(parentRotation);
    const local = qrot(inverse, sub(position.get(bone)!, parentPosition));
    const rotation = qmul(inverse, worldRotation.get(bone)!);
    index.set(bone, nodes.length);
    nodes.push({ name: names[bone], parent: parentIndex, translation: local, rotation, scale: [1, 1, 1] });
  }
  const joints = included.map(bone => index.get(bone)!);
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const skin: MtekSkin = { meshNode: 1, nodes, joints, inverseBind: joints.map(() => identity), indices: [], weights: [], clips: [] };
  // Mesh-local up/forward: canonical y and z seen from the mesh node.
  const inverseMesh = qconj(meshRotation);
  const up = qrot(inverseMesh, [0, 1, 0]), forward = qrot(inverseMesh, [0, 0, 1]);
  const map: HumanoidMap = {
    bones: Object.fromEntries(included.map(bone => [bone, names[bone]])), evidence: Object.fromEntries(included.map(bone => [bone, "name" as const])),
    confidence: 1, unmapped: ALL.filter(bone => !included.includes(bone)), up, forward,
  };
  return {
    skin, map, names, up, forward,
    lengths: { leftLeg: [ulL, llL], rightLeg: [ulR, llR], leftArm: [uaL, laL], rightArm: [uaR, laR] },
    nodeIndex: bone => (index.get(bone as HumanoidBone) ?? skin.nodes.findIndex(n => n.name === bone)),
    // Mesh-local position in rig units: the mesh node is the rig root's child with its rotation only.
    bindPosition: bone => qrot(inverseMesh, position.get(bone)!),
  };
}
