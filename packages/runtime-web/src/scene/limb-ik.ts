import type { MtekSkin } from "../abi/manifest-types.js";
import type { Quat, Vec3 } from "../math/types.js";
import type { HumanoidMap, HumanoidBone } from "./humanoid-types.js";
import { numericallyUniformScale } from "./uniform-scale.js";

/**
 * Anatomical two-bone limb solving for a mapped humanoid (decision 0222).
 *
 * Every limb is an upper bone, a lower bone and an end joint (hip-knee-ankle, shoulder-elbow-wrist). The solve is
 * analytic (law of cosines), so a reachable target is met exactly, a target beyond reach approaches full extension
 * smoothly, the middle joint is a hinge that bends only in its anatomical direction within its anatomical range,
 * and the cost does not depend on an iteration budget. Foot placement lowers the hips by the least amount that lets
 * both feet reach their ground targets, then solves both legs.
 */
export type LimbName = "leftLeg" | "rightLeg" | "leftArm" | "rightArm";
export const LIMB_NAMES: readonly LimbName[] = ["leftLeg", "rightLeg", "leftArm", "rightArm"];

/** Default middle-joint flexion ranges in radians: knees 0..150 degrees, elbows 0..145 degrees. */
export const KNEE_MAX_FLEXION = (150 * Math.PI) / 180;
export const ELBOW_MAX_FLEXION = (145 * Math.PI) / 180;
/** Default width of the soft reach zone, as a fraction of the reachable distance range. */
export const DEFAULT_SOFTNESS = 0.05;
/** Largest accepted flexion limit; a fully folded limb (180 degrees) has no unique bend plane. */
export const MAX_FLEXION_LIMIT = (175 * Math.PI) / 180;

type Tuple3 = readonly [number, number, number];
type Tuple4 = readonly [number, number, number, number];

export interface LimbGoal {
  readonly limb: LimbName;
  /** Mesh-local target of the end joint (ankle or wrist), the space of `SkeletonPlayer.jointPosition`. */
  readonly target: Tuple3;
  /** Blend between the animated pose (0) and the solved pose (1). Default 1. */
  readonly weight?: number;
  /**
   * Mesh-local direction the middle joint bends toward (the component perpendicular to the limb axis is used).
   * Default: the bend plane carried from the bind pose by the animated upper bone (knees forward, elbows back).
   * An explicit pole nearly parallel to the limb axis falls back to the default.
   */
  readonly pole?: Tuple3;
  /** Mesh-local orientation of the end joint. Without it the end joint keeps its local rotation. */
  readonly rotation?: Tuple4;
  /** Multiplies `weight` for the end orientation. Default 1. */
  readonly rotationWeight?: number;
  /** Fraction in [0, 0.5] of the reachable distance range that is eased at each end. Default 0.05. */
  readonly softness?: number;
  /** Middle-joint flexion range in radians, 0 <= min < max <= 175 degrees. Default 0..150 (leg) or 0..145 (arm) degrees. */
  readonly flexion?: { readonly min: number; readonly max: number };
}

export interface FootGround {
  /**
   * Ground height under the foot along mesh-local up. The foot keeps its animated lift and plane position and
   * follows the ground by the difference from `groundLevel`; it never sinks below the ground plus the sole offset.
   */
  readonly height?: number;
  /** Mesh-local ground contact point. The foot joint is planted at `point + normal * soleOffset`. */
  readonly point?: Tuple3;
  /** Mesh-local ground normal; the foot's animated orientation is tilted by the shortest rotation from up to it. */
  readonly normal?: Tuple3;
  /** Contact weight in [0, 1], default 1: 0 leaves the foot (and the hips) to the animation. */
  readonly weight?: number;
}

export interface FootPlacement {
  readonly left: FootGround;
  readonly right: FootGround;
  /** Exponential response time of the hips drop in seconds. Default 0.1; 0 follows the target immediately. */
  readonly smoothing?: number;
  /** Distance from the foot joint to the sole in mesh-local units. Default: the lower bind foot joint's height above `groundLevel`. */
  readonly soleOffset?: number;
  /** Mesh-local ground height along up that the animation was authored on (the bind pose stands on it). Default 0. */
  readonly groundLevel?: number;
  /** Largest hips drop in mesh-local units. Default: half of the shorter bind leg reach. */
  readonly maxDrop?: number;
  /** Soft reach fraction of both legs (see `LimbGoal.softness`). */
  readonly softness?: number;
}

export interface LimbInspection {
  readonly id: string;
  readonly limb: LimbName;
  /** Node indices: upper, lower, end. */
  readonly nodes: readonly [number, number, number];
  readonly target: Vec3;
  readonly weight: number;
  readonly rotation?: Quat;
  readonly rotationWeight: number;
  readonly pole?: Vec3;
  readonly softness: number;
  readonly flexionRange: { readonly min: number; readonly max: number };
  /** Middle-joint flexion in radians at the last solve, or null before the first. */
  readonly flexion: number | null;
  /** Mesh-local distance between the target and the solved end position at the last solve, or null. */
  readonly residual: number | null;
}
export interface FootGroundInspection {
  readonly height?: number;
  readonly point?: Vec3;
  readonly normal?: Vec3;
  readonly weight: number;
  /** Knee flexion in radians at the last solve, or null before the first. */
  readonly flexion: number | null;
  /** Mesh-local distance between the foot target and the solved foot at the last solve, or null. */
  readonly residual: number | null;
}
export interface FootPlacementInspection {
  readonly left: FootGroundInspection;
  readonly right: FootGroundInspection;
  readonly smoothing: number;
  readonly soleOffset: number;
  readonly groundLevel: number;
  readonly maxDrop: number;
  readonly softness: number;
  /** Minimum hips drop (mesh-local units) for the last evaluated pose, before smoothing and the `maxDrop` limit. */
  readonly requiredDrop: number;
  /** Hips drop applied at the last evaluation. */
  readonly drop: number;
}
export interface LimbSolverInspection {
  readonly limbs: readonly LimbInspection[];
  readonly footPlacement: FootPlacementInspection | null;
}

const BONES: Readonly<Record<LimbName, readonly [HumanoidBone, HumanoidBone, HumanoidBone]>> = {
  leftLeg: ["leftUpperLeg", "leftLowerLeg", "leftFoot"],
  rightLeg: ["rightUpperLeg", "rightLowerLeg", "rightFoot"],
  leftArm: ["leftUpperArm", "leftLowerArm", "leftHand"],
  rightArm: ["rightUpperArm", "rightLowerArm", "rightHand"],
};
const isLeg = (limb: LimbName): boolean => limb === "leftLeg" || limb === "rightLeg";
const finite = (values: ArrayLike<number>): boolean => Array.from(values).every(Number.isFinite);
const EPS = 1e-9;

/** Reach interval of a two-bone limb with the given segment lengths and flexion range. */
export function reachLimits(a: number, b: number, minFlexion: number, maxFlexion: number, softness: number): { min: number; max: number; softMin: number; softMax: number } {
  const min = Math.sqrt(Math.max(0, a * a + b * b + 2 * a * b * Math.cos(maxFlexion)));
  const max = Math.sqrt(Math.max(0, a * a + b * b + 2 * a * b * Math.cos(minFlexion)));
  const width = softness * (max - min);
  return { min, max, softMin: min + width, softMax: max - width };
}

/**
 * Softness function. Within `[softMin, softMax]` the distance is unchanged; beyond `softMax` it approaches `max`
 * as `softMax + w (1 - exp(-(d - softMax) / w))` with `w = max - softMax` and symmetrically below `softMin`. The map
 * is strictly increasing, has slope 1 at the joins (C1), and never reaches `max` or `min`, so a limb never snaps to a
 * fully straight (or fully folded) singular pose. `softness = 0` is the hard clamp.
 */
export function softReach(distance: number, limits: { min: number; max: number; softMin: number; softMax: number }): number {
  if (distance > limits.softMax) {
    const width = limits.max - limits.softMax;
    return width > 0 ? limits.softMax + width * (1 - Math.exp(-(distance - limits.softMax) / width)) : limits.max;
  }
  if (distance < limits.softMin) {
    const width = limits.softMin - limits.min;
    return width > 0 ? limits.softMin - width * (1 - Math.exp(-(limits.softMin - distance) / width)) : limits.min;
  }
  return distance;
}

/**
 * Smallest hips drop along the unit direction `up` that brings a point at offset `toTarget` (target minus upper-joint
 * position) within `reach` of the upper joint, never negative. `Infinity` is never returned: when no drop can reach,
 * the drop that minimises the distance is used.
 */
export function minimumDrop(toTarget: Tuple3, up: Tuple3, reach: number): number {
  const p = toTarget[0] * up[0] + toTarget[1] * up[1] + toTarget[2] * up[2];
  const q = toTarget[0] ** 2 + toTarget[1] ** 2 + toTarget[2] ** 2 - reach * reach;
  if (q <= 0) return 0;
  const discriminant = p * p - q;
  if (discriminant < 0) return Math.max(0, -p);
  const root = Math.sqrt(discriminant);
  return -p + root < 0 ? 0 : Math.max(0, -p - root);
}

interface Rig {
  readonly limb: LimbName;
  readonly u: number; readonly l: number; readonly e: number;
  /** Hinge axis (flexion axis) in the upper node's local frame. */
  readonly hinge: Float64Array;
  /** Bind chord lengths in mesh-local units. */
  readonly reach: number;
  readonly maxFlexion: number;
}
interface StoredGoal {
  readonly id: string;
  readonly limb: LimbName;
  readonly target: Tuple3;
  readonly weight: number;
  readonly pole: Tuple3 | undefined;
  readonly rotation: Tuple4 | undefined;
  readonly rotationWeight: number;
  readonly softness: number;
  readonly min: number;
  readonly max: number;
}
interface StoredGround { height: number | undefined; point: Tuple3 | undefined; normal: Tuple3 | undefined; weight: number }
interface StoredPlacement {
  left: StoredGround; right: StoredGround; smoothing: number; soleOffset: number; groundLevel: number; maxDrop: number; softness: number;
}
/** Per-solve scratch request; world (skeleton-root) space. */
interface Request {
  rig: Rig; weight: number; softness: number; min: number; max: number;
  target: Float64Array; pole: Float64Array; hasPole: boolean; rotation: Float64Array; hasRotation: boolean; rotationWeight: number;
}
interface SolveState { flexion: number; residual: number }

// Small allocation-free vector and quaternion helpers; vectors are Float64Array(3), quaternions Float64Array(4) (x, y, z, w).
const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
function cross(o: Float64Array, a: ArrayLike<number>, b: ArrayLike<number>): void {
  const x = a[1]! * b[2]! - a[2]! * b[1]!, y = a[2]! * b[0]! - a[0]! * b[2]!, z = a[0]! * b[1]! - a[1]! * b[0]!;
  o[0] = x; o[1] = y; o[2] = z;
}
function length3(a: ArrayLike<number>): number { return Math.hypot(a[0]!, a[1]!, a[2]!); }
/** Normalizes in place and returns the previous length; a (near) zero vector is left unchanged. */
function normalize3(a: Float64Array): number {
  const length = length3(a);
  if (length > EPS) { a[0] = a[0]! / length; a[1] = a[1]! / length; a[2] = a[2]! / length; }
  return length;
}
function perpendicular(o: Float64Array, a: ArrayLike<number>): void {
  const ax = Math.abs(a[0]!), ay = Math.abs(a[1]!), az = Math.abs(a[2]!);
  if (ax <= ay && ax <= az) { o[0] = 0; o[1] = -a[2]!; o[2] = a[1]!; }
  else if (ay <= az) { o[0] = a[2]!; o[1] = 0; o[2] = -a[0]!; }
  else { o[0] = -a[1]!; o[1] = a[0]!; o[2] = 0; }
  normalize3(o);
}
function qmul(o: Float64Array, a: ArrayLike<number>, b: ArrayLike<number>): void {
  const ax = a[0]!, ay = a[1]!, az = a[2]!, aw = a[3]!, bx = b[0]!, by = b[1]!, bz = b[2]!, bw = b[3]!;
  o[0] = aw * bx + ax * bw + ay * bz - az * by;
  o[1] = aw * by - ax * bz + ay * bw + az * bx;
  o[2] = aw * bz + ax * by - ay * bx + az * bw;
  o[3] = aw * bw - ax * bx - ay * by - az * bz;
}
function qconj(o: Float64Array, a: ArrayLike<number>): void { o[0] = -a[0]!; o[1] = -a[1]!; o[2] = -a[2]!; o[3] = a[3]!; }
function qnormalize(o: Float64Array): void {
  const length = Math.hypot(o[0]!, o[1]!, o[2]!, o[3]!);
  if (length > EPS) { o[0] = o[0]! / length; o[1] = o[1]! / length; o[2] = o[2]! / length; o[3] = o[3]! / length; }
  else { o[0] = 0; o[1] = 0; o[2] = 0; o[3] = 1; }
}
/** Rotates (x, y, z) by the quaternion stored at `q[at..at+3]`. */
function qrotate(o: Float64Array, q: ArrayLike<number>, at: number, x: number, y: number, z: number): void {
  const qx = q[at]!, qy = q[at + 1]!, qz = q[at + 2]!, qw = q[at + 3]!;
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  o[0] = x + qw * tx + (qy * tz - qz * ty);
  o[1] = y + qw * ty + (qz * tx - qx * tz);
  o[2] = z + qw * tz + (qx * ty - qy * tx);
}
function qaxis(o: Float64Array, axis: ArrayLike<number>, angle: number): void {
  const s = Math.sin(angle / 2);
  o[0] = axis[0]! * s; o[1] = axis[1]! * s; o[2] = axis[2]! * s; o[3] = Math.cos(angle / 2);
}
/** Shortest rotation taking unit `from` to unit `to`; the half-turn of an exactly opposite pair uses the axis `prefer` when it is usable. */
function qfromto(o: Float64Array, from: ArrayLike<number>, to: ArrayLike<number>, prefer: ArrayLike<number> | undefined, scratch: Float64Array): void {
  const d = dot(from, to);
  if (d < -1 + 1e-12) {
    if (prefer !== undefined) {
      const along = dot(prefer, from);
      scratch[0] = prefer[0]! - along * from[0]!; scratch[1] = prefer[1]! - along * from[1]!; scratch[2] = prefer[2]! - along * from[2]!;
    } else scratch.fill(0);
    if (normalize3(scratch) < 1e-6) perpendicular(scratch, from);
    o[0] = scratch[0]!; o[1] = scratch[1]!; o[2] = scratch[2]!; o[3] = 0;
    return;
  }
  cross(o, from, to);
  o[3] = 1 + d;
  qnormalize(o);
}
/** Shortest-path spherical interpolation a -> b by t; the result may alias `a` or `b`. */
function qslerp(o: Float64Array, a: ArrayLike<number>, b: ArrayLike<number>, t: number): void {
  let cosine = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!;
  const sign = cosine < 0 ? -1 : 1;
  cosine = Math.min(1, Math.abs(cosine));
  const angle = Math.acos(cosine), sine = Math.sin(angle);
  const wa = sine > 1e-6 ? Math.sin((1 - t) * angle) / sine : 1 - t, wb = (sine > 1e-6 ? Math.sin(t * angle) / sine : t) * sign;
  const x = a[0]! * wa + b[0]! * wb, y = a[1]! * wa + b[1]! * wb, z = a[2]! * wa + b[2]! * wb, w = a[3]! * wa + b[3]! * wb;
  o[0] = x; o[1] = y; o[2] = z; o[3] = w;
  qnormalize(o);
}
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export class LimbIK {
  revision = 0;
  private readonly n: number;
  private readonly parentOf: Int32Array;
  private readonly order: number[] = [];
  private readonly bind: Float64Array;
  /** Similarity transform of every node (decision 0209 uniform scale): position, rotation, scale. */
  private readonly gp: Float64Array;
  private readonly gq: Float64Array;
  private readonly gs: Float64Array;
  private relevant = new Uint8Array(0);
  private map: HumanoidMap | undefined;
  private rigs = new Map<LimbName, Rig>();
  private hips = -1;
  private up = new Float64Array([0, 0, 1]);
  private soleDefault = 0;
  private groundDefault = 0;
  private maxDropDefault = 0;
  private readonly goals = new Map<string, StoredGoal>();
  private readonly byLimb = new Map<LimbName, string>();
  private placement: StoredPlacement | undefined;
  private pendingDt = 0;
  private drop = 0;
  private dropReady = false;
  private required = 0;
  private converging = false;
  private readonly states = new Map<LimbName, SolveState>();
  // scratch
  private readonly requests: Request[] = [];
  private readonly s = Array.from({ length: 16 }, () => new Float64Array(3));
  private readonly r = Array.from({ length: 13 }, () => new Float64Array(4));
  private readonly spare = new Float64Array(3);
  private readonly local = new Float64Array(3);

  constructor(private readonly skin: MtekSkin) {
    this.n = skin.nodes.length;
    this.parentOf = Int32Array.from(skin.nodes.map(node => node.parent));
    this.bind = new Float64Array(this.n * 10);
    skin.nodes.forEach((node, i) => {
      this.bind.set(node.translation, i * 10);
      const length = Math.hypot(...node.rotation);
      this.bind.set(node.rotation.map(v => v / length), i * 10 + 3);
      this.bind.set(node.scale, i * 10 + 7);
    });
    this.gp = new Float64Array(this.n * 3); this.gq = new Float64Array(this.n * 4); this.gs = new Float64Array(this.n);
    const seen = new Set<number>();
    const visit = (i: number): void => {
      if (seen.has(i)) return;
      const parent = this.parentOf[i]!;
      if (parent >= 0) visit(parent);
      seen.add(i); this.order.push(i);
    };
    for (let i = 0; i < this.n; i++) visit(i);
    for (let i = 0; i < LIMB_NAMES.length; i++) this.requests.push({ rig: undefined as unknown as Rig, weight: 1, softness: 0, min: 0, max: 0, target: new Float64Array(3), pole: new Float64Array(3), hasPole: false, rotation: new Float64Array(4), hasRotation: false, rotationWeight: 1 });
  }

  get humanoid(): HumanoidMap | undefined { return this.map; }
  /** True while the smoothed hips drop is still converging; the owner must keep evaluating. */
  get animating(): boolean { return this.converging; }
  get active(): boolean { return this.goals.size > 0 || this.placement !== undefined; }

  /** Accumulates elapsed time for hips smoothing; consumed by the next evaluation. */
  advance(dt: number): void { if (this.placement !== undefined) this.pendingDt += dt; }

  // ------------------------------------------------------------------ configuration

  /** Resolves a map to skin nodes and derives each limb's hinge from the bind pose. `undefined` removes every goal. */
  setHumanoid(map: HumanoidMap | undefined): void {
    if (map === undefined) {
      this.map = undefined; this.rigs = new Map(); this.goals.clear(); this.byLimb.clear(); this.placement = undefined;
      this.resetState(); this.revision++; return;
    }
    const index = (bone: HumanoidBone): number => {
      const name = map.bones[bone];
      const found = name === undefined ? -1 : this.skin.nodes.findIndex(node => node.name === name);
      if (found < 0) throw new RangeError(`Humanoid map needs ${bone} to name a skin node`);
      return found;
    };
    const descends = (node: number, ancestor: number): boolean => {
      for (let i = this.parentOf[node]!; i >= 0; i = this.parentOf[i]!) if (i === ancestor) return true;
      return false;
    };
    const up = Float64Array.from(map.up), forward = Float64Array.from(map.forward);
    if (!finite(map.up) || !finite(map.forward) || map.up.length !== 3 || map.forward.length !== 3 || normalize3(up) < 1e-8 || normalize3(forward) < 1e-8)
      throw new RangeError("Humanoid map needs finite non-zero up and forward vectors");
    const hips = index("hips");
    const nodes = new Map<LimbName, [number, number, number]>();
    for (const limb of LIMB_NAMES) {
      const [u, l, e] = BONES[limb].map(index) as [number, number, number];
      if (!descends(l, u) || !descends(e, l)) throw new RangeError(`Humanoid map: ${limb} bones must descend upper, lower, end`);
      nodes.set(limb, [u, l, e]);
    }
    // Bind frame: mesh rotation and hinge axes.
    this.compute(this.bind, false);
    const meshQ = this.skin.meshNode * 4, meshP = this.skin.meshNode * 3, meshS = this.gs[this.skin.meshNode]!;
    const forwardG = new Float64Array(3), upG = new Float64Array(3);
    qrotate(forwardG, this.gq, meshQ, forward[0]!, forward[1]!, forward[2]!); normalize3(forwardG);
    qrotate(upG, this.gq, meshQ, up[0]!, up[1]!, up[2]!); normalize3(upG);
    const rigs = new Map<LimbName, Rig>();
    const heights: Record<string, number> = {};
    for (const limb of LIMB_NAMES) {
      const [u, l, e] = nodes.get(limb)!;
      const pu = this.gp.subarray(u * 3, u * 3 + 3), pl = this.gp.subarray(l * 3, l * 3 + 3), pe = this.gp.subarray(e * 3, e * 3 + 3);
      const axis = new Float64Array([pe[0]! - pu[0]!, pe[1]! - pu[1]!, pe[2]! - pu[2]!]);
      const upper = new Float64Array([pl[0]! - pu[0]!, pl[1]! - pu[1]!, pl[2]! - pu[2]!]);
      const total = length3(upper) + Math.hypot(pe[0]! - pl[0]!, pe[1]! - pl[1]!, pe[2]! - pl[2]!);
      if (normalize3(axis) < EPS) axis.set(upper);
      normalize3(axis);
      // Bind knee/elbow offset from the hip-ankle line, and the anatomical bend side projected onto the plane across the limb axis.
      const along = dot(upper, axis);
      const offset = new Float64Array([upper[0]! - along * axis[0]!, upper[1]! - along * axis[1]!, upper[2]! - along * axis[2]!]);
      const sign = isLeg(limb) ? 1 : -1;
      const anatomical = new Float64Array([sign * forwardG[0]!, sign * forwardG[1]!, sign * forwardG[2]!]);
      const side = dot(anatomical, axis);
      for (let c = 0; c < 3; c++) anatomical[c] = anatomical[c]! - side * axis[c]!;
      const anatomicalLength = normalize3(anatomical), offsetLength = normalize3(offset);
      const bend = new Float64Array(3);
      if (offsetLength > 0.003 * total) {
        bend.set(offset);
        // The bind plane decides the hinge; anatomy decides its sign unless the bind bend is sideways to it.
        if (anatomicalLength > 1e-3 && dot(bend, anatomical) < -0.25) for (let c = 0; c < 3; c++) bend[c] = -bend[c]!;
      } else if (anatomicalLength > 1e-3) bend.set(anatomical);
      else {
        // Limb axis along the facing direction: fall back to the up axis, then to any perpendicular.
        const rise = dot(upG, axis);
        for (let c = 0; c < 3; c++) bend[c] = upG[c]! - rise * axis[c]!;
        if (normalize3(bend) < 1e-3) perpendicular(bend, axis);
      }
      const hingeWorld = new Float64Array(3);
      cross(hingeWorld, bend, axis);
      normalize3(hingeWorld);
      // Into the upper node's local frame: conj(R_u) * h.
      const conj = new Float64Array(4);
      qconj(conj, this.gq.subarray(u * 4, u * 4 + 4));
      const hinge = new Float64Array(3);
      qrotate(hinge, conj, 0, hingeWorld[0]!, hingeWorld[1]!, hingeWorld[2]!);
      rigs.set(limb, { limb, u, l, e, hinge, reach: total / meshS, maxFlexion: isLeg(limb) ? KNEE_MAX_FLEXION : ELBOW_MAX_FLEXION });
    }
    const height = (node: number): number => {
      const dx = this.gp[node * 3]! - this.gp[meshP]!, dy = this.gp[node * 3 + 1]! - this.gp[meshP + 1]!, dz = this.gp[node * 3 + 2]! - this.gp[meshP + 2]!;
      return (dx * upG[0]! + dy * upG[1]! + dz * upG[2]!) / meshS;
    };
    heights.left = height(nodes.get("leftLeg")![2]); heights.right = height(nodes.get("rightLeg")![2]);
    // The bind pose stands on the mesh-local ground level 0 along up: the lower foot joint's height is the sole offset.
    this.groundDefault = 0;
    this.soleDefault = Math.max(0, Math.min(heights.left!, heights.right!));
    this.maxDropDefault = 0.5 * Math.min(rigs.get("leftLeg")!.reach, rigs.get("rightLeg")!.reach);
    // Ancestry that must be numerically uniform at run time.
    const relevant = new Uint8Array(this.n);
    const mark = (node: number): void => { for (let i = node; i >= 0 && relevant[i] === 0; i = this.parentOf[i]!) relevant[i] = 1; };
    mark(this.skin.meshNode); mark(hips);
    for (const [u, l, e] of nodes.values()) { mark(u); mark(l); mark(e); }
    this.relevant = relevant;
    this.map = map; this.rigs = rigs; this.hips = hips; this.up = up;
    this.resetState();
    this.revision++;
  }

  private resetState(): void { this.drop = 0; this.dropReady = false; this.required = 0; this.converging = false; this.pendingDt = 0; this.states.clear(); }

  /** Sets (or replaces) the goal `id`. At most one goal drives each limb, and foot placement owns both legs while it is set. */
  set(id: string, goal: LimbGoal): void {
    if (this.map === undefined) throw new RangeError("Limb IK needs a humanoid map: call setHumanoid first");
    if (id === "" || !LIMB_NAMES.includes(goal.limb)) throw new RangeError("A limb goal needs an ID and a limb name");
    if (this.placement !== undefined && isLeg(goal.limb)) throw new RangeError("Foot placement owns both legs; clear it before setting a leg goal");
    const holder = this.byLimb.get(goal.limb);
    if (holder !== undefined && holder !== id) throw new RangeError(`Limb ${goal.limb} is already driven by goal ${holder}`);
    const weight = goal.weight ?? 1, rotationWeight = goal.rotationWeight ?? 1, softness = goal.softness ?? DEFAULT_SOFTNESS;
    const min = goal.flexion?.min ?? 0, max = goal.flexion?.max ?? (isLeg(goal.limb) ? KNEE_MAX_FLEXION : ELBOW_MAX_FLEXION);
    if (goal.target.length !== 3 || !finite(goal.target) || !Number.isFinite(weight) || weight < 0 || weight > 1
      || !Number.isFinite(rotationWeight) || rotationWeight < 0 || rotationWeight > 1 || !Number.isFinite(softness) || softness < 0 || softness > 0.5)
      throw new RangeError("Invalid limb target, weight, rotation weight or softness");
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || min >= max || max > MAX_FLEXION_LIMIT)
      throw new RangeError("Invalid limb flexion range: need 0 <= min < max <= 175 degrees");
    let pole: Tuple3 | undefined;
    if (goal.pole !== undefined) {
      const length = Math.hypot(...goal.pole);
      if (goal.pole.length !== 3 || !finite(goal.pole) || !Number.isFinite(length) || length < 1e-8) throw new RangeError("Invalid limb pole direction");
      pole = goal.pole.map(v => v / length) as unknown as Tuple3;
    }
    let rotation: Tuple4 | undefined;
    if (goal.rotation !== undefined) {
      const length = Math.hypot(...goal.rotation);
      if (goal.rotation.length !== 4 || !finite(goal.rotation) || !Number.isFinite(length) || length < 1e-8) throw new RangeError("Invalid limb orientation quaternion");
      rotation = goal.rotation.map(v => v / length) as unknown as Tuple4;
      const end = this.rigs.get(goal.limb)!.e;
      for (let node = this.skin.meshNode; node >= 0; node = this.parentOf[node]!)
        if (node === end) throw new RangeError("Limb orientation mesh frame cannot descend from the end effector");
    }
    if (holder === undefined) this.byLimb.set(goal.limb, id);
    this.goals.set(id, { id, limb: goal.limb, target: [...goal.target], weight, pole, rotation, rotationWeight, softness, min, max });
    this.revision++;
  }

  /** Sets or (with `undefined`) clears foot placement. State such as the smoothed drop survives replacement. */
  setFootPlacement(placement: FootPlacement | undefined): void {
    if (placement === undefined) {
      if (this.placement !== undefined) { this.placement = undefined; this.resetState(); this.revision++; }
      return;
    }
    if (this.map === undefined) throw new RangeError("Foot placement needs a humanoid map: call setHumanoid first");
    if (this.byLimb.has("leftLeg") || this.byLimb.has("rightLeg")) throw new RangeError("Foot placement owns both legs; remove leg goals first");
    const smoothing = placement.smoothing ?? 0.1, softness = placement.softness ?? DEFAULT_SOFTNESS;
    const soleOffset = placement.soleOffset ?? this.soleDefault, groundLevel = placement.groundLevel ?? this.groundDefault, maxDrop = placement.maxDrop ?? this.maxDropDefault;
    if (!Number.isFinite(smoothing) || smoothing < 0 || !Number.isFinite(softness) || softness < 0 || softness > 0.5
      || !Number.isFinite(soleOffset) || soleOffset < 0 || !Number.isFinite(groundLevel) || !Number.isFinite(maxDrop) || maxDrop < 0)
      throw new RangeError("Invalid foot placement smoothing, softness, sole offset, ground level or maximum drop");
    const ground = (side: string, g: FootGround): StoredGround => {
      const weight = g.weight ?? 1;
      if ((g.height === undefined) === (g.point === undefined)) throw new RangeError(`Foot placement ${side} needs exactly one of height or point`);
      if (g.height !== undefined && !Number.isFinite(g.height)) throw new RangeError(`Foot placement ${side} height must be finite`);
      if (g.point !== undefined && (g.point.length !== 3 || !finite(g.point))) throw new RangeError(`Foot placement ${side} point must be three finite numbers`);
      if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new RangeError(`Foot placement ${side} weight must be in [0, 1]`);
      let normal: Tuple3 | undefined;
      if (g.normal !== undefined) {
        const length = Math.hypot(...g.normal);
        if (g.normal.length !== 3 || !finite(g.normal) || !Number.isFinite(length) || length < 1e-8) throw new RangeError(`Foot placement ${side} normal must be a finite non-zero vector`);
        normal = g.normal.map(v => v / length) as unknown as Tuple3;
      }
      return { height: g.height, point: g.point === undefined ? undefined : [...g.point], normal, weight };
    };
    const left = ground("left", placement.left), right = ground("right", placement.right);
    this.placement = { left, right, smoothing, soleOffset, groundLevel, maxDrop, softness };
    this.revision++;
  }

  remove(id: string): boolean {
    const goal = this.goals.get(id);
    if (goal === undefined) return false;
    this.goals.delete(id); this.byLimb.delete(goal.limb); this.states.delete(goal.limb); this.revision++;
    return true;
  }
  has(id: string): boolean { return this.goals.has(id); }
  /** Removes every goal and foot placement; the humanoid map stays. */
  clear(): void {
    if (this.goals.size === 0 && this.placement === undefined) return;
    this.goals.clear(); this.byLimb.clear(); this.placement = undefined; this.resetState(); this.revision++;
  }

  inspect(): LimbSolverInspection {
    const vec = (v: Tuple3): Vec3 => ({ x: v[0], y: v[1], z: v[2] });
    const limbs = [...this.goals.values()].map((goal): LimbInspection => {
      const rig = this.rigs.get(goal.limb)!, state = this.states.get(goal.limb);
      return { id: goal.id, limb: goal.limb, nodes: [rig.u, rig.l, rig.e], target: vec(goal.target), weight: goal.weight,
        ...(goal.rotation === undefined ? {} : { rotation: { x: goal.rotation[0], y: goal.rotation[1], z: goal.rotation[2], w: goal.rotation[3] } }),
        rotationWeight: goal.rotationWeight, ...(goal.pole === undefined ? {} : { pole: vec(goal.pole) }), softness: goal.softness,
        flexionRange: { min: goal.min, max: goal.max }, flexion: state?.flexion ?? null, residual: state?.residual ?? null };
    });
    const ground = (g: StoredGround, limb: LimbName): FootGroundInspection => ({ ...(g.height === undefined ? {} : { height: g.height }),
      ...(g.point === undefined ? {} : { point: vec(g.point) }), ...(g.normal === undefined ? {} : { normal: vec(g.normal) }), weight: g.weight,
      flexion: this.states.get(limb)?.flexion ?? null, residual: this.states.get(limb)?.residual ?? null });
    const p = this.placement;
    return { limbs, footPlacement: p === undefined ? null : { left: ground(p.left, "leftLeg"), right: ground(p.right, "rightLeg"), smoothing: p.smoothing, soleOffset: p.soleOffset,
      groundLevel: p.groundLevel, maxDrop: p.maxDrop, softness: p.softness, requiredDrop: this.required, drop: this.drop } };
  }

  // ------------------------------------------------------------------ evaluation

  /** Global similarity transforms (position, rotation, uniform scale) of the pose, in double precision. */
  private compute(pose: Float64Array, check: boolean): void {
    for (const i of this.order) {
      const at = i * 10, parent = this.parentOf[i]!, sx = pose[at + 7]!;
      if (check && this.relevant[i] === 1 && !numericallyUniformScale(sx, pose[at + 8]!, pose[at + 9]!))
        throw new RangeError("Limb IK requires uniform ancestor scales");
      if (parent < 0) {
        this.gp[i * 3] = pose[at]!; this.gp[i * 3 + 1] = pose[at + 1]!; this.gp[i * 3 + 2] = pose[at + 2]!;
        for (let c = 0; c < 4; c++) this.gq[i * 4 + c] = pose[at + 3 + c]!;
        this.gs[i] = sx;
      } else {
        const scale = this.gs[parent]!;
        qrotate(this.spare, this.gq, parent * 4, pose[at]!, pose[at + 1]!, pose[at + 2]!);
        this.gp[i * 3] = this.gp[parent * 3]! + scale * this.spare[0]!;
        this.gp[i * 3 + 1] = this.gp[parent * 3 + 1]! + scale * this.spare[1]!;
        this.gp[i * 3 + 2] = this.gp[parent * 3 + 2]! + scale * this.spare[2]!;
        const q = this.r[9]!;
        q[0] = pose[at + 3]!; q[1] = pose[at + 4]!; q[2] = pose[at + 5]!; q[3] = pose[at + 6]!;
        qmul(q, this.gq.subarray(parent * 4, parent * 4 + 4), q);
        for (let c = 0; c < 4; c++) this.gq[i * 4 + c] = q[c]!;
        this.gs[i] = scale * sx;
      }
    }
  }

  apply(pose: Float64Array): void {
    const rigs = this.rigs;
    if (this.map === undefined || (this.goals.size === 0 && this.placement === undefined)) { this.converging = false; return; }
    this.compute(pose, true);
    const mesh = this.skin.meshNode, requests: Request[] = [];
    const used: Request[] = this.requests;
    let slot = 0;
    const prepare = (rig: Rig): Request => { const r = used[slot++]!; r.rig = rig; return r; };
    if (this.placement !== undefined) {
      const left = prepare(rigs.get("leftLeg")!), right = prepare(rigs.get("rightLeg")!);
      this.placeFeet(pose, left, right);
      if (left.weight > 0) requests.push(left);
      if (right.weight > 0) requests.push(right);
    }
    for (const limb of LIMB_NAMES) {
      const id = this.byLimb.get(limb);
      if (id === undefined) continue;
      const goal = this.goals.get(id)!;
      if (goal.weight === 0) continue;
      const r = prepare(rigs.get(limb)!);
      r.weight = goal.weight; r.softness = goal.softness; r.min = goal.min; r.max = goal.max; r.rotationWeight = goal.rotationWeight;
      qrotate(r.target, this.gq, mesh * 4, goal.target[0], goal.target[1], goal.target[2]);
      for (let c = 0; c < 3; c++) r.target[c] = this.gp[mesh * 3 + c]! + this.gs[mesh]! * r.target[c]!;
      r.hasPole = goal.pole !== undefined;
      if (goal.pole !== undefined) { qrotate(r.pole, this.gq, mesh * 4, goal.pole[0], goal.pole[1], goal.pole[2]); normalize3(r.pole); }
      r.hasRotation = goal.rotation !== undefined;
      if (goal.rotation !== undefined) qmul(r.rotation, this.gq.subarray(mesh * 4, mesh * 4 + 4), goal.rotation);
      requests.push(r);
    }
    // All requests were prepared against the pose before any limb is written; limbs do not share descendants.
    for (const request of requests) this.solve(pose, request);
  }

  /** Foot targets, minimum hips drop, hips shift and (re)computed transforms; fills the two leg requests. */
  private placeFeet(pose: Float64Array, left: Request, right: Request): void {
    const placement = this.placement!, mesh = this.skin.meshNode, meshQ = mesh * 4;
    const sMesh = this.gs[mesh]!, upG = this.s[0]!;
    qrotate(upG, this.gq, meshQ, this.up[0]!, this.up[1]!, this.up[2]!); normalize3(upG);
    let required = 0;
    const toTarget = this.s[1]!, normalG = this.s[2]!, targetG = this.s[3]!;
    for (const [request, ground] of [[left, placement.left], [right, placement.right]] as const) {
      const rig = request.rig, u = rig.u, e = rig.e;
      request.weight = ground.weight; request.softness = placement.softness; request.min = 0; request.max = KNEE_MAX_FLEXION; request.rotationWeight = 1;
      request.hasPole = false; request.hasRotation = true;
      // Ground normal (world) and tilt of the animated foot orientation.
      let hasNormal = false;
      if (ground.normal !== undefined) { qrotate(normalG, this.gq, meshQ, ground.normal[0], ground.normal[1], ground.normal[2]); normalize3(normalG); hasNormal = true; }
      const pe = e * 3;
      if (ground.point !== undefined) {
        const clearance = placement.soleOffset;
        const n: ArrayLike<number> = hasNormal ? ground.normal! : this.up;
        qrotate(targetG, this.gq, meshQ, ground.point[0] + n[0]! * clearance, ground.point[1] + n[1]! * clearance, ground.point[2] + n[2]! * clearance);
        for (let c = 0; c < 3; c++) targetG[c] = this.gp[mesh * 3 + c]! + sMesh * targetG[c]!;
      } else {
        const height = ground.height!;
        const animated = ((this.gp[pe]! - this.gp[mesh * 3]!) * upG[0]! + (this.gp[pe + 1]! - this.gp[mesh * 3 + 1]!) * upG[1]! + (this.gp[pe + 2]! - this.gp[mesh * 3 + 2]!) * upG[2]!) / sMesh;
        const slope = hasNormal ? Math.max(0.5, dot(normalG, upG)) : 1;
        const lifted = animated + (height - placement.groundLevel), floor = height + placement.soleOffset / slope;
        const wanted = Math.max(lifted, floor);
        for (let c = 0; c < 3; c++) targetG[c] = this.gp[pe + c]! + upG[c]! * sMesh * (wanted - animated);
      }
      for (let c = 0; c < 3; c++) request.target[c] = targetG[c]!;
      // Orientation: the animated global foot rotation, tilted from up to the ground normal.
      const qe = this.r[0]!, tilt = this.r[1]!;
      for (let c = 0; c < 4; c++) qe[c] = this.gq[e * 4 + c]!;
      if (hasNormal) { qfromto(tilt, upG, normalG, undefined, this.spare); qmul(request.rotation, tilt, qe); }
      else request.rotation.set(qe);
      // Minimum drop for this leg, against its exact-reach limit.
      const a = Math.hypot(this.gp[rig.l * 3]! - this.gp[u * 3]!, this.gp[rig.l * 3 + 1]! - this.gp[u * 3 + 1]!, this.gp[rig.l * 3 + 2]! - this.gp[u * 3 + 2]!);
      const b = Math.hypot(this.gp[pe]! - this.gp[rig.l * 3]!, this.gp[pe + 1]! - this.gp[rig.l * 3 + 1]!, this.gp[pe + 2]! - this.gp[rig.l * 3 + 2]!);
      const limits = reachLimits(a, b, 0, KNEE_MAX_FLEXION, placement.softness);
      for (let c = 0; c < 3; c++) toTarget[c] = targetG[c]! - this.gp[u * 3 + c]!;
      required = Math.max(required, ground.weight * minimumDrop(toTarget as unknown as Tuple3, upG as unknown as Tuple3, limits.softMax) / sMesh);
    }
    this.required = required;
    const wanted = Math.min(required, placement.maxDrop);
    if (!this.dropReady || placement.smoothing === 0) { this.drop = wanted; this.dropReady = true; }
    else this.drop += (wanted - this.drop) * (1 - Math.exp(-this.pendingDt / placement.smoothing));
    this.pendingDt = 0;
    this.converging = Math.abs(this.drop - wanted) > 1e-9;
    if (!this.converging) this.drop = wanted;
    if (this.drop > 0 && this.hips >= 0) {
      // Move the hips down along mesh up by `drop`, expressed in the hips' parent frame.
      const displacement = this.drop * sMesh, parent = this.parentOf[this.hips]!;
      const delta = this.local;
      delta[0] = -upG[0]! * displacement; delta[1] = -upG[1]! * displacement; delta[2] = -upG[2]! * displacement;
      if (parent >= 0) {
        const conj = this.r[2]!;
        qconj(conj, this.gq.subarray(parent * 4, parent * 4 + 4));
        qrotate(delta, conj, 0, delta[0]!, delta[1]!, delta[2]!);
        const scale = this.gs[parent]!;
        for (let c = 0; c < 3; c++) delta[c] = delta[c]! / scale;
      }
      for (let c = 0; c < 3; c++) pose[this.hips * 10 + c] = pose[this.hips * 10 + c]! + delta[c]!;
      this.compute(pose, false);
    }
  }

  /** Solves one limb in skeleton-root space and writes the blended local rotations of upper, lower and (optionally) end. */
  private solve(pose: Float64Array, request: Request): void {
    const { rig } = request, { u, l, e } = rig, gp = this.gp, gq = this.gq;
    const [du, dl, ehat, hc, hs, q, uDir, lDir, tmp] = [this.s[4]!, this.s[5]!, this.s[6]!, this.s[7]!, this.s[8]!, this.s[9]!, this.s[10]!, this.s[11]!, this.s[12]!];
    for (let c = 0; c < 3; c++) { du[c] = gp[l * 3 + c]! - gp[u * 3 + c]!; dl[c] = gp[e * 3 + c]! - gp[l * 3 + c]!; }
    const a = normalize3(du), b = normalize3(dl);
    if (!(a > EPS && b > EPS)) return;
    for (let c = 0; c < 3; c++) ehat[c] = request.target[c]! - gp[u * 3 + c]!;
    const distance = normalize3(ehat);
    if (distance <= EPS) {
      for (let c = 0; c < 3; c++) ehat[c] = gp[e * 3 + c]! - gp[u * 3 + c]!;
      if (normalize3(ehat) <= EPS) ehat.set(du);
    }
    // Reach with the soft clamp, then the two triangle angles.
    const limits = reachLimits(a, b, request.min, request.max, request.softness);
    const effective = Math.max(softReach(distance, limits), 1e-12);
    const flexion = Math.acos(clamp((effective * effective - a * a - b * b) / (2 * a * b), -1, 1));
    const hipAngle = Math.acos(clamp((a * a + effective * effective - b * b) / (2 * a * effective), -1, 1));
    // Hinge axis: carried from the animated upper bone's bind hinge, or taken from an explicit pole.
    qrotate(hc, gq, u * 4, rig.hinge[0]!, rig.hinge[1]!, rig.hinge[2]!);
    let explicit = false;
    if (request.hasPole) {
      const along = dot(request.pole, ehat);
      for (let c = 0; c < 3; c++) q[c] = request.pole[c]! - along * ehat[c]!;
      if (normalize3(q) > 1e-3) { cross(hs, q, ehat); explicit = true; }
    }
    const swing = this.r[3]!, turn = this.r[4]!, upper = this.r[5]!, lower = this.r[6]!, work = this.r[7]!, work2 = this.r[8]!;
    if (!explicit) {
      qfromto(swing, du, ehat, hc, tmp);
      qrotate(hs, swing, 0, hc[0]!, hc[1]!, hc[2]!);
      const along = dot(hs, ehat);
      for (let c = 0; c < 3; c++) hs[c] = hs[c]! - along * ehat[c]!;
      if (normalize3(hs) < 1e-6) perpendicular(hs, ehat);
    }
    cross(q, ehat, hs);
    const sine = Math.sin(hipAngle), cosine = Math.cos(hipAngle);
    for (let c = 0; c < 3; c++) uDir[c] = cosine * ehat[c]! + sine * q[c]!;
    // End position and the lower bone's direction.
    for (let c = 0; c < 3; c++) lDir[c] = (gp[u * 3 + c]! + effective * ehat[c]!) - (gp[u * 3 + c]! + a * uDir[c]!);
    if (normalize3(lDir) < EPS) lDir.set(ehat);
    // Upper bone: swing the animated chord onto the knee direction, then twist so its hinge lies across the bend plane.
    qfromto(swing, du, uDir, hs, tmp);
    qrotate(tmp, swing, 0, hc[0]!, hc[1]!, hc[2]!);
    cross(q, tmp, hs);
    const twist = Math.atan2(dot(uDir, q), dot(tmp, hs));
    qaxis(turn, uDir, twist);
    qmul(upper, turn, swing); // net rotation applied to everything below the upper joint
    // Lower bone: swing the carried shin direction onto the solved one.
    qrotate(tmp, upper, 0, dl[0]!, dl[1]!, dl[2]!);
    qfromto(lower, tmp, lDir, hs, this.spare);
    // Local rotations: parent' = upper * parent (lower), parent'' = lower * upper * parent (end).
    const w = request.weight;
    const parentU = this.parentOf[u]!, parentL = this.parentOf[l]!, parentE = this.parentOf[e]!;
    const animatedParent = this.r[0]!, solved = this.r[1]!;
    const write = (node: number, rotation: Float64Array, weight: number): void => {
      const at = node * 10 + 3;
      for (let c = 0; c < 4; c++) animatedParent[c] = pose[at + c]!;
      qslerp(solved, animatedParent, rotation, weight);
      for (let c = 0; c < 4; c++) pose[at + c] = solved[c]!;
    };
    // upper local = conj(parent) * upper * R_u
    if (parentU >= 0) qconj(work, gq.subarray(parentU * 4, parentU * 4 + 4)); else { work[0] = 0; work[1] = 0; work[2] = 0; work[3] = 1; }
    qmul(work2, upper, gq.subarray(u * 4, u * 4 + 4));
    const lowerCarry = this.r[2]!, endCarry = this.r[9]!;
    qmul(work2, work, work2);
    qnormalize(work2);
    // The output rotations are computed before any write, because the writes reuse scratch quaternions.
    const upperLocal = this.r[10]!;
    upperLocal.set(work2);
    qmul(lowerCarry, lower, upper);
    qnormalize(lowerCarry);
    // lower local = conj(upper * R_parentL) * lower * upper * R_l
    qmul(work, upper, gq.subarray(parentL * 4, parentL * 4 + 4)); qconj(work, work);
    qmul(work2, lowerCarry, gq.subarray(l * 4, l * 4 + 4));
    qmul(work2, work, work2); qnormalize(work2);
    const lowerLocal = this.r[11]!;
    lowerLocal.set(work2);
    const endLocal = this.r[12]!;
    if (request.hasRotation) {
      qmul(endCarry, lowerCarry, gq.subarray(parentE * 4, parentE * 4 + 4)); qconj(endCarry, endCarry);
      qmul(endLocal, endCarry, request.rotation); qnormalize(endLocal);
    }
    write(u, upperLocal, w); write(l, lowerLocal, w);
    if (request.hasRotation) write(e, endLocal, w * request.rotationWeight);
    // Report the solved geometry.
    let reachError = 0;
    for (let c = 0; c < 3; c++) reachError += (request.target[c]! - (gp[u * 3 + c]! + effective * ehat[c]!)) ** 2;
    this.states.set(rig.limb, { flexion, residual: Math.sqrt(reachError) / this.gs[this.skin.meshNode]! });
  }
}
