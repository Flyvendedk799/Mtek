// Measurements of the anatomical limb solver (decision 0222). Used by limb-ik.test.ts (which asserts the bounds) and by
// scripts/measure-limb-solving.mjs (which writes evidence/animation/limb-solving.json and the table of spec/animation.md
// section 3). Everything is deterministic: fixed rigs, Fibonacci-sphere sweeps, no random numbers and no clocks. The
// checks are independent of the solver's internals: positions and rotations come from SkeletonPlayer's public queries,
// and the "analytic" foot-placement drop is found by scanning and bisection, not by the closed form the solver uses.
import { humanoidRig, qaxis, qconj, qmul, qrot, type TestRig } from "../test-support/limb-rigs.js";
import type { HumanoidBone } from "./humanoid-types.js";
import { SkeletonPlayer } from "./skeleton.js";
import { DEFAULT_SOFTNESS, ELBOW_MAX_FLEXION, KNEE_MAX_FLEXION, type LimbName } from "./limb-ik.js";

type V = [number, number, number];
type Q = [number, number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V): V => mul(a, 1 / norm(a));
const angleBetween = (a: V, b: V): number => Math.atan2(norm(cross(a, b)), dot(a, b));
/** Rotation angle between two (not necessarily exactly normalized) quaternions. */
export const quatAngle = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  const x = a[3]! * b[0]! - a[0]! * b[3]! - a[1]! * b[2]! + a[2]! * b[1]!, y = a[3]! * b[1]! + a[0]! * b[2]! - a[1]! * b[3]! - a[2]! * b[0]!;
  const z = a[3]! * b[2]! - a[0]! * b[1]! + a[1]! * b[0]! - a[2]! * b[3]!, w = a[3]! * b[3]! + a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  return 2 * Math.atan2(Math.hypot(x, y, z), Math.abs(w));
};

export const LIMBS: readonly LimbName[] = ["leftLeg", "rightLeg", "leftArm", "rightArm"];
const BONES: Record<LimbName, readonly [HumanoidBone, HumanoidBone, HumanoidBone]> = {
  leftLeg: ["leftUpperLeg", "leftLowerLeg", "leftFoot"], rightLeg: ["rightUpperLeg", "rightLowerLeg", "rightFoot"],
  leftArm: ["leftUpperArm", "leftLowerArm", "leftHand"], rightArm: ["rightUpperArm", "rightLowerArm", "rightHand"],
};
const isLeg = (limb: LimbName): boolean => limb.endsWith("Leg");
/** `x` rounded up to the next power of ten: quantises floating-point noise so a published bound is stable across platforms. */
export function decade(x: number): number { return x <= 0 ? 0 : Number(`1e${Math.ceil(Math.log10(x) - 1e-12)}`); }
const significant = (x: number, digits = 3): number => Number(x.toPrecision(digits));

/** Fibonacci-sphere direction `i` of `n`, deterministic and nearly uniform. */
export function sphere(i: number, n: number): V {
  const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), phi = i * Math.PI * (3 - Math.sqrt(5));
  return [r * Math.cos(phi), y, r * Math.sin(phi)];
}

export interface LimbCase { readonly id: string; readonly description: string; readonly rig: TestRig }
export function evidenceRigs(): LimbCase[] {
  const zUp = qconj(qaxis([1, 0, 0], Math.PI / 2));
  return [
    { id: "upright", description: "straight identity-frame bind, y up, unit scale", rig: humanoidRig() },
    { id: "bent-bind", description: "knees 14/20 deg and elbows 18 deg bent in bind, A pose, bone-aligned frames", rig: humanoidRig({ kneeBind: [14, 20], elbowBind: 18, armPose: "a", boneFrames: true }) },
    { id: "z-up-scaled", description: "Z-up mesh node, rig yawed 0.7 rad and scaled 2.5, unequal left/right bone lengths, bone-aligned frames",
      rig: humanoidRig({ upperLeg: [0.5, 0.46], lowerLeg: [0.44, 0.4], upperArm: [0.33, 0.31], lowerArm: [0.29, 0.28], boneFrames: true, rigScale: 2.5,
        rigRotation: qaxis([0, 1, 0], 0.7), meshRotation: zUp, kneeBind: 6 }) },
    { id: "short-shin", description: "non-uniform bone lengths (long thigh, short shin, short upper arm, long forearm), A pose, bone-aligned frames",
      rig: humanoidRig({ upperLeg: 0.55, lowerLeg: 0.28, upperArm: 0.22, lowerArm: 0.38, armPose: "a", boneFrames: true }) },
  ];
}

/** One rig on a SkeletonPlayer with its humanoid map, plus mesh-local measurement helpers. */
export class LimbHarness {
  readonly player: SkeletonPlayer;
  constructor(readonly rig: TestRig) {
    this.player = new SkeletonPlayer(rig.skin);
    this.player.setHumanoid(rig.map);
  }
  name(bone: HumanoidBone): string { return this.rig.names[bone]; }
  pos(bone: HumanoidBone): V { const p = this.player.jointPosition(this.name(bone)); return [p.x, p.y, p.z]; }
  rot(bone: HumanoidBone): Q { const q = this.player.jointRotation(this.name(bone)); return [q.x, q.y, q.z, q.w]; }
  local(bone: HumanoidBone): Float64Array { const at = this.rig.nodeIndex(bone) * 10 + 3; return this.player.pose.subarray(at, at + 4); }
  /** Segment lengths of a limb in mesh-local units. */
  lengths(limb: LimbName): [number, number] { return [...this.rig.lengths[limb]]; }
  reach(limb: LimbName): number { const [a, b] = this.lengths(limb); return a + b; }
  maxFlexion(limb: LimbName): number { return isLeg(limb) ? KNEE_MAX_FLEXION : ELBOW_MAX_FLEXION; }
  set(limb: LimbName, target: V, options: object = {}): void {
    this.player.ik.setLimb(limb, { limb, target, ...options });
    this.player.evaluate();
  }
  /** Bind frame of a limb: axis (hip to ankle), the side the knee/elbow points to, and the flexion hinge, all mesh-local. */
  bindFrame(limb: LimbName): { hip: V; axis: V; side: V; hinge: V; across: V } {
    const [u, , e] = BONES[limb], hip = this.rig.bindPosition(u), axis = unit(sub(this.rig.bindPosition(e), hip));
    const forward = this.rig.forward, anatomical = mul(forward, isLeg(limb) ? 1 : -1);
    const side = unit(sub(anatomical, mul(axis, dot(anatomical, axis))));
    // Hinge h = side x axis: a positive rotation about it bends the limb toward `side`.
    const hinge = unit(cross(side, axis));
    return { hip, axis, side, hinge, across: unit(cross(axis, side)) };
  }
  /** Signed flexion of the middle joint about the hinge carried by the final upper-bone rotation (positive = anatomical bend). */
  signedFlexion(limb: LimbName): { flexion: number; knee: V; end: V; hip: V } {
    const [u, l, e] = BONES[limb], frame = this.bindFrame(limb);
    const hip = this.pos(u), knee = this.pos(l), end = this.pos(e);
    const bindRotation = this.bindRotation(u), final = this.rot(u);
    const carried = qrot(qmul(final, qconj(bindRotation)), frame.hinge);
    const upper = unit(sub(knee, hip)), lower = unit(sub(end, knee));
    return { flexion: Math.atan2(dot(carried, cross(upper, lower)), dot(upper, lower)), knee, end, hip };
  }
  /** Bind mesh-local rotation of a bone, from the skin's bind transforms. */
  bindRotation(bone: HumanoidBone): Q {
    const skin = this.rig.skin;
    const chain: number[] = [];
    for (let i = this.rig.nodeIndex(bone); i >= 0; i = skin.nodes[i]!.parent) chain.unshift(i);
    let q: Q = [0, 0, 0, 1], mesh: Q = [0, 0, 0, 1];
    for (const i of chain) q = qmul(q, skin.nodes[i]!.rotation as unknown as Q);
    const meshChain: number[] = [];
    for (let i = skin.meshNode; i >= 0; i = skin.nodes[i]!.parent) meshChain.unshift(i);
    for (const i of meshChain) mesh = qmul(mesh, skin.nodes[i]!.rotation as unknown as Q);
    return qmul(qconj(mesh), q);
  }
}

// ---------------------------------------------------------------------------------------------------------------- reach

export interface ReachResult { targets: number; maxRelativeError: number }
/** Reachable targets (inside the exactly-solved shell) in every direction: the end joint must land on the target. */
export function measureReach(c: LimbCase, limb: LimbName, directions = 400): ReachResult {
  const h = new LimbHarness(c.rig), frame = h.bindFrame(limb), [a, b] = h.lengths(limb), R = a + b;
  const min = Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(h.maxFlexion(limb))), width = DEFAULT_SOFTNESS * (R - min);
  let worst = 0, count = 0;
  for (let i = 0; i < directions; i++) for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    const distance = (min + width) * (1 - fraction) + (R - width) * fraction, d = unit(sphere(i, directions));
    const target = add(frame.hip, mul(d, distance * (fraction === 0 ? 1.0000001 : fraction === 1 ? 0.9999999 : 1)));
    h.set(limb, target);
    worst = Math.max(worst, norm(sub(h.pos(BONES[limb][2]), target)) / R); count++;
  }
  return { targets: count, maxRelativeError: worst };
}

export interface BeyondResult {
  directions: number; samples: number;
  /** Largest end-joint distance from the upper joint, as a fraction of full reach, over every target (must stay below 1). */
  maxReachFraction: number;
  /** Number of target pairs on one ray where a farther target gave a nearer end joint. */
  monotoneViolations: number;
  /** Largest angle between the upper-to-end and upper-to-target directions, radians. */
  maxDirectionError: number;
  /** End distance / full reach at target distances 0.95, 1.0, 1.1 and 2.0 times full reach (first direction of the first limb). */
  profile: { target: number; end: number }[];
}
export function measureBeyondReach(c: LimbCase, limb: LimbName, directions = 60): BeyondResult {
  const h = new LimbHarness(c.rig), frame = h.bindFrame(limb), R = h.reach(limb), end = BONES[limb][2];
  let maxFraction = 0, violations = 0, maxDirection = 0, samples = 0;
  const multipliers = Array.from({ length: 81 }, (_, k) => 0.9 + (k * 2.1) / 80);
  for (let i = 0; i < directions; i++) {
    const d = unit(sphere(i, directions));
    let previous = -Infinity;
    for (const m of multipliers) {
      const target = add(frame.hip, mul(d, m * R));
      h.set(limb, target);
      const e = sub(h.pos(end), frame.hip), distance = norm(e);
      maxFraction = Math.max(maxFraction, distance / R);
      if (m > 1 && distance < previous - 1e-6 * R) violations++;
      if (m >= 1) maxDirection = Math.max(maxDirection, angleBetween(e, d));
      previous = distance; samples++;
    }
  }
  const profile = [0.95, 1, 1.1, 2].map(m => {
    h.set(limb, add(frame.hip, mul(unit(sphere(0, directions)), m * R)));
    return { target: m, end: norm(sub(h.pos(end), frame.hip)) / R };
  });
  return { directions, samples, maxReachFraction: maxFraction, monotoneViolations: violations, maxDirectionError: maxDirection, profile };
}

// ---------------------------------------------------------------------------------------------------------------- range

export interface RangeResult {
  targets: number;
  /** Middle-joint flexion outside [0, max] (counted with a 1e-4 rad float32 tolerance). */
  rangeViolations: number;
  /** Signed flexion below -1e-4 rad about the bind-derived hinge: the limb bent backwards. */
  reverseBends: number;
  /** Leg targets in the lower hemisphere whose knee ends behind the hip-ankle line relative to the facing direction. */
  kneeBackViolations: number;
  minFlexion: number; maxFlexion: number;
  nonFinite: number;
}
export function measureRange(c: LimbCase, limb: LimbName, directions = 1200): RangeResult {
  const h = new LimbHarness(c.rig), frame = h.bindFrame(limb), R = h.reach(limb), max = h.maxFlexion(limb), forward = h.rig.forward;
  let range = 0, reverse = 0, back = 0, minF = Infinity, maxF = -Infinity, nonFinite = 0, count = 0;
  for (let i = 0; i < directions; i++) for (const m of [0.12, 0.3, 0.5, 0.7, 0.9, 0.97, 1, 1.25]) {
    const d = unit(sphere(i, directions)), target = add(frame.hip, mul(d, m * R));
    h.set(limb, target);
    const s = h.signedFlexion(limb); count++;
    if (!Number.isFinite(s.flexion) || !h.player.pose.every(Number.isFinite)) { nonFinite++; continue; }
    minF = Math.min(minF, s.flexion); maxF = Math.max(maxF, s.flexion);
    if (s.flexion < -1e-4) reverse++;
    if (s.flexion > max + 1e-4) range++;
    // Independent anatomical check for legs: with the target in the lower hemisphere the knee must lie in front of the hip-ankle line.
    if (isLeg(limb) && dot(d, frame.axis) > 0.5 && m >= 0.5) {
      const axis = unit(sub(s.end, s.hip)), offset = sub(sub(s.knee, s.hip), mul(axis, dot(sub(s.knee, s.hip), axis)));
      if (s.flexion > 1e-3 && dot(offset, forward) < -1e-4) back++;
    }
  }
  return { targets: count, rangeViolations: range, reverseBends: reverse, kneeBackViolations: back, minFlexion: minF, maxFlexion: maxF, nonFinite };
}

// ---------------------------------------------------------------------------------------------------------------- continuity

export interface PathResult { path: string; steps: number; maxStepRatio: number; maxFlexionRatio: number }
/** Largest change of upper/lower local rotation and flexion per unit of target travel relative to full reach (rad per R). */
function followPath(h: LimbHarness, limb: LimbName, name: string, points: V[], options: object): PathResult {
  const [u, l] = BONES[limb], R = h.reach(limb);
  let worst = 0, worstFlexion = 0, previous: { u: Float64Array; l: Float64Array; f: number; t: V } | undefined;
  for (const target of points) {
    h.set(limb, target, options);
    const state = { u: Float64Array.from(h.local(u)), l: Float64Array.from(h.local(l)), f: h.signedFlexion(limb).flexion, t: target };
    if (previous !== undefined) {
      const travel = norm(sub(target, previous.t)) / R;
      worst = Math.max(worst, Math.max(quatAngle(state.u, previous.u), quatAngle(state.l, previous.l)) / travel);
      worstFlexion = Math.max(worstFlexion, Math.abs(state.f - previous.f) / travel);
    }
    previous = state;
  }
  return { path: name, steps: points.length - 1, maxStepRatio: worst, maxFlexionRatio: worstFlexion };
}
export function measureContinuity(c: LimbCase, limb: LimbName, options: object = {}): PathResult[] {
  const h = new LimbHarness(c.rig), frame = h.bindFrame(limb), R = h.reach(limb), hip = frame.hip;
  const e0 = frame.axis, f = frame.side, l = frame.across;
  const along = (direction: V, distance: number): V => add(hip, mul(unit(direction), distance));
  const arc = (from: V, towards: V, degrees: number, steps: number, distance: number): V[] =>
    Array.from({ length: steps + 1 }, (_, k) => { const psi = (degrees * Math.PI / 180) * (k / steps); return along(add(mul(from, Math.cos(psi)), mul(towards, Math.sin(psi))), distance); });
  const tilted = add(mul(e0, Math.cos(0.35)), mul(f, Math.sin(0.35)));
  const radial = Array.from({ length: 1051 }, (_, k) => along(tilted, (0.35 + (1.05 * k) / 1050) * R));
  const nearStraight = Array.from({ length: 401 }, (_, k) => along(e0, (0.93 + (0.12 * k) / 400) * R));
  const circle = Array.from({ length: 1801 }, (_, k) => { const t = (2 * Math.PI * k) / 1800; return along(add(mul(e0, Math.cos(0.61)), mul(add(mul(f, Math.cos(t)), mul(l, Math.sin(t))), Math.sin(0.61))), 0.85 * R); });
  const overhead = unit(sub(unit(h.rig.up), mul(e0, dot(unit(h.rig.up), e0))));
  const paths = [
    followPath(h, limb, "radial in/out through full extension", radial, options),
    followPath(h, limb, "radial near full extension (0.93R to 1.05R)", nearStraight, options),
    followPath(h, limb, "circle around the limb axis (35 deg)", circle, options),
    followPath(h, limb, "great circle through the bend side (0 to 160 deg)", arc(e0, f, 160, 800, 0.8 * R), options),
    followPath(h, limb, "great circle through the opposite side (0 to 160 deg)", arc(e0, mul(f, -1), 160, 800, 0.8 * R), options),
    followPath(h, limb, "great circle across the bend plane (0 to 160 deg)", arc(e0, l, 160, 800, 0.8 * R), options),
  ];
  // Arms hang down in most clips, so the sweep over the head (target passing straight up) is the case that matters for them.
  if (!isLeg(limb)) paths.push(followPath(h, limb, "great circle over the head (0 to 175 deg)", arc(e0, overhead, 175, 875, 0.8 * R), options));
  return paths;
}

// ---------------------------------------------------------------------------------------------------------------- degenerate

export interface DegenerateResult { cases: number; nonFinite: number }
/** Targets at the upper joint, along and against the limb axis, exactly at full reach, on the pole axis, and with a parallel explicit pole. */
export function measureDegenerate(c: LimbCase, limb: LimbName): DegenerateResult {
  const h = new LimbHarness(c.rig), frame = h.bindFrame(limb), R = h.reach(limb);
  const along = (direction: V, distance: number): V => add(frame.hip, mul(direction, distance));
  const targets: V[] = [frame.hip, along(frame.axis, R), along(frame.axis, 1e-9), along(frame.axis, 5 * R), along(mul(frame.axis, -1), 0.5 * R), along(mul(frame.axis, -1), R),
    along(frame.side, 0.7 * R), along(mul(frame.side, -1), 0.7 * R), along(frame.hinge, 0.7 * R), add(frame.hip, [1e-12, 0, 0]), along(frame.axis, 0.1 * R)];
  let nonFinite = 0, cases = 0;
  for (const target of targets) for (const options of [{}, { pole: frame.axis }, { pole: frame.side }, { weight: 0.5, rotation: [0, 0, 0, 1], rotationWeight: 0.5 }]) {
    h.set(limb, target, options); cases++;
    if (!h.player.pose.every(Number.isFinite) || !h.player.palette.every(Number.isFinite)) nonFinite++;
  }
  return { cases, nonFinite };
}

// ---------------------------------------------------------------------------------------------------------------- foot placement

export interface PlacementResult {
  id: string; cases: number;
  /** Largest |measured hips drop - independently computed minimum|, mesh-local units. */
  maxDropError: number;
  /** Largest distance from a foot joint to its target (targets within reach), mesh-local units. */
  maxFootError: number;
  /** Cases where the hips ended higher than the animated pose, or the drop was negative. */
  raised: number;
  /** Largest angle between the final foot orientation and animated orientation tilted onto the ground normal, radians. */
  maxNormalError: number;
  /** Largest drop measured over all cases, mesh-local units. */
  maxDrop: number;
}
export function referenceDrop(upper: V[], targets: V[], up: V, reaches: number[]): number {
  const ok = (drop: number): boolean => targets.every((t, i) => norm(sub(t, sub(upper[i]!, mul(up, drop)))) <= reaches[i]! + 1e-12);
  if (ok(0)) return 0;
  let low = 0, high = 0;
  for (let drop = 1e-3; drop < 2; drop += 1e-3) { if (ok(drop)) { high = drop; break; } low = drop; }
  for (let i = 0; i < 60; i++) { const mid = (low + high) / 2; if (ok(mid)) high = mid; else low = mid; }
  return high;
}
/** Steps of 0..0.3 and slopes of 0..30 degrees under a knees-bent stance, against the independently computed minimum drop. */
export function measurePlacement(c: LimbCase): PlacementResult {
  const h = new LimbHarness(c.rig), up = unit(c.rig.up), animatedHips = h.pos("hips");
  const ankles: V[] = [h.pos("leftFoot"), h.pos("rightFoot")], uppers: V[] = [h.pos("leftUpperLeg"), h.pos("rightUpperLeg")];
  const sole = Math.min(dot(ankles[0]!, up), dot(ankles[1]!, up));
  const reaches = (["leftLeg", "rightLeg"] as const).map(limb => {
    const [a, b] = h.lengths(limb), R = a + b, min = Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(KNEE_MAX_FLEXION));
    return R - DEFAULT_SOFTNESS * (R - min);
  });
  const baseline = new LimbHarness(c.rig);
  const animatedFoot = [baseline.rot("leftFoot"), baseline.rot("rightFoot")];
  let cases = 0, worstDrop = 0, worstFoot = 0, raised = 0, worstNormal = 0, largest = 0;
  const check = (expectedTargets: V[], expectedRotations: Q[]): void => {
    const info = h.player.inspect().footPlacement!, drop = info.drop;
    const expected = referenceDrop(uppers, expectedTargets, up, reaches);
    const hips = h.pos("hips"), measuredDrop = dot(sub(animatedHips, hips), up);
    worstDrop = Math.max(worstDrop, Math.abs(measuredDrop - expected), Math.abs(drop - expected));
    largest = Math.max(largest, measuredDrop);
    if (measuredDrop < -1e-6 || drop < 0) raised++;
    expectedTargets.forEach((t, i) => {
      const foot = h.pos(i === 0 ? "leftFoot" : "rightFoot");
      worstFoot = Math.max(worstFoot, norm(sub(foot, t)));
      worstNormal = Math.max(worstNormal, quatAngle(h.rot(i === 0 ? "leftFoot" : "rightFoot"), expectedRotations[i]!));
    });
    cases++;
  };
  const place = (left: object, right: object, extra: object = {}): void => {
    h.player.ik.setFootPlacement({ left, right, smoothing: 0, ...extra });
    h.player.evaluate();
  };
  // Steps up and down of 0 to 0.3 under either or both feet (height mode keeps the animated plane position and lift).
  for (let k = -6; k <= 6; k++) for (const [left, right] of [[0.05 * k, 0], [0, 0.05 * k], [0.05 * k, 0.05 * k]] as const) {
    place({ height: left }, { height: right });
    const targets = [0, 1].map(i => { const wanted = [left, right][i]!, a = ankles[i]!; return add(a, mul(up, Math.max(wanted, wanted + sole - dot(a, up)))); });
    check(targets, animatedFoot);
  }
  // Slopes with a stride: planted points on y = tan(theta) z, feet 0.12 ahead and behind, tilted onto the normal.
  const forward = unit(c.rig.forward), side = unit(cross(up, forward));
  for (const degrees of [0, 10, 20, 30]) {
    const theta = (degrees * Math.PI) / 180, normal = unit(add(mul(up, Math.cos(theta)), mul(forward, -Math.sin(theta))));
    const tilt = qFromTo(up, normal);
    const points = [0.12, -0.12].map((z, i) => add(add(add(mul(forward, z), mul(up, Math.tan(theta) * z)), mul(side, dot(ankles[i]!, side))), mul(up, 0)));
    place({ point: points[0], normal }, { point: points[1], normal });
    const targets = points.map(p => add(p, mul(normal, sole)));
    check(targets, animatedFoot.map(q => qmul(tilt, q)));
  }
  return { id: c.id, cases, maxDropError: worstDrop, maxFootError: worstFoot, raised, maxNormalError: worstNormal, maxDrop: largest };
}
function qFromTo(a: V, b: V): Q {
  const d = dot(a, b), x = cross(a, b), q: Q = [x[0], x[1], x[2], 1 + d], n = Math.hypot(...q);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

export interface IdentityResult { maxPoseDifference: number; drop: number }
/** Targets equal to the animated feet (flat ground in reach): the pose must be untouched. */
export function measureIdentity(c: LimbCase): IdentityResult {
  const h = new LimbHarness(c.rig), reference = h.player.pose.slice();
  h.player.ik.setFootPlacement({ left: { height: 0 }, right: { height: 0 }, smoothing: 0 });
  h.player.evaluate();
  let worst = 0;
  h.player.pose.forEach((v, i) => { worst = Math.max(worst, Math.abs(v - reference[i]!)); });
  return { maxPoseDifference: worst, drop: h.player.inspect().footPlacement!.drop };
}

export interface SmoothingResult { frames: number; maxDeviation: number; monotone: boolean }
/** Response of the hips drop to a step in the ground, against drop(t) = D (1 - exp(-t / tau)). */
export function measureSmoothing(c: LimbCase, tau = 0.1, dt = 1 / 60, frames = 90): SmoothingResult {
  const h = new LimbHarness(c.rig);
  h.player.ik.setFootPlacement({ left: { height: 0 }, right: { height: 0 }, smoothing: tau });
  h.player.evaluate();
  h.player.ik.setFootPlacement({ left: { height: -0.2 }, right: { height: -0.2 }, smoothing: tau });
  h.player.evaluate();
  const target = h.player.inspect().footPlacement!.requiredDrop;
  let worst = 0, monotone = true, previous = h.player.inspect().footPlacement!.drop;
  for (let k = 1; k <= frames; k++) {
    h.player.advance(dt);
    const drop = h.player.inspect().footPlacement!.drop;
    worst = Math.max(worst, Math.abs(drop - target * (1 - Math.exp(-(k * dt) / tau)) - 0));
    if (drop < previous - 1e-12) monotone = false;
    previous = drop;
  }
  return { frames, maxDeviation: worst, monotone };
}

// ---------------------------------------------------------------------------------------------------------------- evidence

export const BOUNDS = {
  reachRelativeError: 1e-5,
  directionError: 1e-5,
  /** End-joint distance / full reach never exceeds 1 (plus float32 round-off in the measurement). */
  maxReachFraction: 1.000001,
  rangeViolations: 0,
  reverseBends: 0,
  kneeBackViolations: 0,
  nonFinite: 0,
  /** Radians of joint rotation per unit of target travel relative to full reach, soft reach (0.05) on every path. */
  maxStepRatio: 12,
  dropError: 1e-5,
  footError: 1e-5,
  normalError: 1e-5,
  identityDifference: 1e-9,
  smoothingDeviation: 1e-9,
} as const;

export interface LimbEvidence {
  format: "mtek-limb-solving/1";
  decision: "0222";
  softness: number;
  bounds: typeof BOUNDS;
  rigs: { id: string; description: string }[];
  reach: { rig: string; limb: LimbName; targets: number; maxRelativeError: number }[];
  beyond: { rig: string; limb: LimbName; samples: number; maxReachFraction: number; monotoneViolations: number; maxDirectionError: number; profile: { target: number; end: number }[] }[];
  range: { rig: string; limb: LimbName; targets: number; rangeViolations: number; reverseBends: number; kneeBackViolations: number; minFlexionDegrees: number; maxFlexionDegrees: number; nonFinite: number }[];
  continuity: { rig: string; limb: LimbName; softness: number; paths: { path: string; steps: number; maxStepRatio: number; maxFlexionRatio: number }[] }[];
  degenerate: { rig: string; limb: LimbName; cases: number; nonFinite: number }[];
  placement: { rig: string; cases: number; maxDropError: number; maxFootError: number; raised: number; maxNormalErrorRad: number; maxDrop: number }[];
  identity: { rig: string; maxPoseDifference: number; drop: number }[];
  smoothing: { rig: string; frames: number; maxDeviation: number; monotone: boolean };
}

/** Rigs whose bind stance has the knees bent enough to stay inside the exact-reach shell on flat ground. */
function placementRigs(): LimbCase[] {
  const zUp = qconj(qaxis([1, 0, 0], Math.PI / 2));
  return [
    { id: "stance-upright", description: "knees bent 34 deg, identity frames", rig: humanoidRig({ kneeBind: 34 }) },
    { id: "stance-framed", description: "knees bent 34/38 deg, bone-aligned frames, Z-up mesh, yawed and scaled by 2.5", rig: humanoidRig({ kneeBind: [34, 38], boneFrames: true, rigScale: 2.5, rigRotation: qaxis([0, 1, 0], 0.7), meshRotation: zUp }) },
  ];
}

export function buildEvidence(): LimbEvidence {
  const rigs = evidenceRigs(), stance = placementRigs();
  const evidence: LimbEvidence = { format: "mtek-limb-solving/1", decision: "0222", softness: DEFAULT_SOFTNESS, bounds: BOUNDS,
    rigs: [...rigs, ...stance].map(r => ({ id: r.id, description: r.description })), reach: [], beyond: [], range: [], continuity: [], degenerate: [], placement: [], identity: [],
    smoothing: { rig: stance[0]!.id, frames: 0, maxDeviation: 0, monotone: true } };
  for (const c of rigs) for (const limb of LIMBS) {
    const reach = measureReach(c, limb);
    evidence.reach.push({ rig: c.id, limb, targets: reach.targets, maxRelativeError: decade(reach.maxRelativeError) });
    const beyond = measureBeyondReach(c, limb);
    evidence.beyond.push({ rig: c.id, limb, samples: beyond.samples, maxReachFraction: significant(beyond.maxReachFraction, 6), monotoneViolations: beyond.monotoneViolations,
      maxDirectionError: decade(beyond.maxDirectionError), profile: beyond.profile.map(p => ({ target: p.target, end: significant(p.end, 4) })) });
    const range = measureRange(c, limb);
    evidence.range.push({ rig: c.id, limb, targets: range.targets, rangeViolations: range.rangeViolations, reverseBends: range.reverseBends, kneeBackViolations: range.kneeBackViolations,
      minFlexionDegrees: significant((range.minFlexion * 180) / Math.PI, 3), maxFlexionDegrees: significant((range.maxFlexion * 180) / Math.PI, 4), nonFinite: range.nonFinite });
    for (const softness of [DEFAULT_SOFTNESS, 0]) {
      const paths = measureContinuity(c, limb, { softness });
      evidence.continuity.push({ rig: c.id, limb, softness, paths: paths.map(p => ({ path: p.path, steps: p.steps, maxStepRatio: significant(p.maxStepRatio, 3), maxFlexionRatio: significant(p.maxFlexionRatio, 3) })) });
    }
    const degenerate = measureDegenerate(c, limb);
    evidence.degenerate.push({ rig: c.id, limb, cases: degenerate.cases, nonFinite: degenerate.nonFinite });
  }
  for (const c of stance) {
    const placement = measurePlacement(c);
    evidence.placement.push({ rig: c.id, cases: placement.cases, maxDropError: decade(placement.maxDropError), maxFootError: decade(placement.maxFootError), raised: placement.raised,
      maxNormalErrorRad: decade(placement.maxNormalError), maxDrop: significant(placement.maxDrop, 3) });
    const identity = measureIdentity(c);
    evidence.identity.push({ rig: c.id, maxPoseDifference: decade(identity.maxPoseDifference), drop: identity.drop });
  }
  const smoothing = measureSmoothing(stance[0]!);
  evidence.smoothing = { rig: stance[0]!.id, frames: smoothing.frames, maxDeviation: decade(smoothing.maxDeviation), monotone: smoothing.monotone };
  return evidence;
}

export function formatEvidence(evidence: LimbEvidence): string { return `${JSON.stringify(evidence, null, 2)}\n`; }

const sci = (x: number): string => (x === 0 ? "0" : x.toExponential(0).replace("e-", "e-").replace("e+", "e"));
const maxOf = <T>(rows: readonly T[], pick: (row: T) => number): number => rows.reduce((m, row) => Math.max(m, pick(row)), 0);
const sumOf = <T>(rows: readonly T[], pick: (row: T) => number): number => rows.reduce((m, row) => m + pick(row), 0);

/** The table written between the limb-solving markers of spec/animation.md. */
export function renderTable(e: LimbEvidence): string {
  const soft = e.continuity.filter(row => row.softness === e.softness), hard = e.continuity.filter(row => row.softness === 0);
  const ratio = (rows: typeof soft, pick: (p: { maxStepRatio: number; maxFlexionRatio: number }) => number): number => maxOf(rows, row => maxOf(row.paths, pick));
  const profile = e.beyond[0]!.profile;
  const lines: string[] = [];
  lines.push("| Measurement | Result | Bound |", "|---|---|---|");
  const row = (name: string, result: string, bound: string): void => { lines.push(`| ${name} | ${result} | ${bound} |`); };
  row("Reach error, reachable targets (relative to full reach)", `${sumOf(e.reach, r => r.targets)} targets, 4 rigs x 4 limbs: at most ${sci(maxOf(e.reach, r => r.maxRelativeError))}`, `${sci(e.bounds.reachRelativeError)}`);
  row("Beyond reach: end-joint distance / full reach", `${sumOf(e.beyond, r => r.samples)} targets: at most ${maxOf(e.beyond, r => r.maxReachFraction)}`, `<= ${e.bounds.maxReachFraction}`);
  row("Beyond reach: monotone in target distance", `${sumOf(e.beyond, r => r.monotoneViolations)} violations`, "0");
  row("Beyond reach: direction error", `at most ${sci(maxOf(e.beyond, r => r.maxDirectionError))} rad`, `${sci(e.bounds.directionError)} rad`);
  row("Soft reach profile, upright left leg (end / reach at target 0.95, 1.0, 1.1, 2.0 x reach)", profile.map(p => p.end).join(", "), "monotone, <= 1");
  row("Middle joint outside its range", `${sumOf(e.range, r => r.rangeViolations)} of ${sumOf(e.range, r => r.targets)} targets; flexion seen ${Math.min(...e.range.map(r => r.minFlexionDegrees))} to ${Math.max(...e.range.map(r => r.maxFlexionDegrees))} deg`, "0 (knee 0-150, elbow 0-145 deg)");
  row("Reverse bends (negative flexion about the bind hinge)", `${sumOf(e.range, r => r.reverseBends)}`, "0");
  row("Knees behind the hip-ankle line (legs, lower hemisphere)", `${sumOf(e.range, r => r.kneeBackViolations)}`, "0");
  row("Non-finite poses (sweeps and degenerate targets)", `${sumOf(e.range, r => r.nonFinite) + sumOf(e.degenerate, r => r.nonFinite)} of ${sumOf(e.range, r => r.targets) + sumOf(e.degenerate, r => r.cases)}`, "0");
  row("Continuity: largest joint rotation per unit of target travel / reach (soft 0.05)", `${ratio(soft, p => p.maxStepRatio)} rad`, `${e.bounds.maxStepRatio} rad`);
  row("Continuity: same paths with a hard clamp (softness 0)", `${ratio(hard, p => p.maxStepRatio)} rad`, "reference only");
  row("Foot placement: hips drop vs independent minimum", `${sumOf(e.placement, r => r.cases)} steps/slopes, 2 rigs: at most ${sci(maxOf(e.placement, r => r.maxDropError))}`, `${sci(e.bounds.dropError)}`);
  row("Foot placement: foot joint to target", `at most ${sci(maxOf(e.placement, r => r.maxFootError))}`, `${sci(e.bounds.footError)}`);
  row("Foot placement: hips raised above the animated pose", `${sumOf(e.placement, r => r.raised)} cases (largest drop ${Math.max(...e.placement.map(r => r.maxDrop))} units)`, "0");
  row("Foot placement: foot orientation vs tilted animation", `at most ${sci(maxOf(e.placement, r => r.maxNormalErrorRad))} rad`, `${sci(e.bounds.normalError)} rad`);
  row("Foot placement: flat ground in reach leaves the pose unchanged", `pose difference at most ${sci(maxOf(e.identity, r => r.maxPoseDifference))}, drop ${maxOf(e.identity, r => r.drop)}`, `${sci(e.bounds.identityDifference)}`);
  row("Foot placement: smoothing follows D (1 - exp(-t / tau))", `${e.smoothing.frames} frames: deviation at most ${sci(e.smoothing.maxDeviation)}${e.smoothing.monotone ? ", monotone" : ", NOT monotone"}`, `${sci(e.bounds.smoothingDeviation)}`);
  return lines.join("\n");
}
