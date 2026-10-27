/**
 * The character-movement corpus harness (decision 0215), shared by `movement-corpus.test.ts` and
 * `scripts/measure-movement-ranges.ts`. It drives the real Rapier adapter exactly like the runtime tick of
 * decision 0214: platform targets first, then `moveCharacter`, then the character's own kinematic target
 * (`pose + displacement`, the returned rotation), then `world.step()`. Nothing here is mocked and no GPU is involved.
 *
 * The file imports only `./backend.ts` (not `index.ts`), so Node's built-in type stripping can run it.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { rapierBackend } from "./backend.ts";
import type {
  BodyHandle,
  CharacterMoveOptions,
  CharacterMovement,
  ColliderDesc,
  PhysicsBackend,
  PhysicsWorld,
  Pose,
  Quat,
  Vec3,
} from "../../runtime-web/src/physics/types.js";

export type { BodyHandle, CharacterMoveOptions, CharacterMovement, PhysicsBackend, PhysicsWorld, Pose, Quat, Vec3 };

// ---------------------------------------------------------------------------------------------------------------------
// Vectors, rotations, rounding
// ---------------------------------------------------------------------------------------------------------------------

export const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, s: number): Vec3 => v3(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const deg = (radians: number): number => (radians * 180) / Math.PI;
export const rad = (degrees: number): number => (degrees * Math.PI) / 180;
/** Rounds to 4 decimals (0.1 mm): the precision of everything published. */
export const r4 = (x: number): number => Math.round(x * 1e4) / 1e4;
/** Rounds to 3 decimals. */
export const r3 = (x: number): number => Math.round(x * 1e3) / 1e3;
export const quatY = (angle: number): Quat => ({ x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) });
export const quatZ = (angle: number): Quat => ({ x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) });
export const mulQ = (a: Quat, b: Quat): Quat => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
export function rotate(q: Quat, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return v3(v.x + q.w * tx + (q.y * tz - q.z * ty), v.y + q.w * ty + (q.z * tx - q.x * tz), v.z + q.w * tz + (q.x * ty - q.y * tx));
}
export const conj = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
/** The yaw (rotation about +Y) of a quaternion that is a pure yaw. */
export const yawOfQuat = (q: Quat): number => {
  const s = q.w < 0 ? -1 : 1;
  return 2 * Math.atan2(s * q.y, s * q.w);
};
/** Smallest signed difference of two angles. */
export const angleDiff = (a: number, b: number): number => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
};

// ---------------------------------------------------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------------------------------------------------

export type ShapeName = "capsule" | "sphere" | "box";
export const SHAPES: readonly ShapeName[] = ["capsule", "sphere", "box"];

export interface CharacterSpec {
  readonly name: ShapeName;
  readonly collider: ColliderDesc;
  /** Centre to underside, metres. */
  readonly rest: number;
  /** Full height, metres. */
  readonly height: number;
  /** Full width along a horizontal axis (unrotated), metres. */
  readonly width: number;
  /** Extent of the shape from its centre along the unit direction `n` (the support function). */
  support(n: Vec3): number;
}

function colliderOf(shape: ColliderDesc["shape"]): ColliderDesc {
  return { shape, sensor: false, friction: 0.5, restitution: 0 };
}

export const CHARACTERS: Readonly<Record<ShapeName, CharacterSpec>> = {
  // Capsule: radius 0.3, full height 1.8 (cylinder half-segment 0.6).
  capsule: {
    name: "capsule",
    collider: colliderOf({ kind: "capsule", radius: 0.3, height: 1.8 }),
    rest: 0.9,
    height: 1.8,
    width: 0.6,
    support: (n) => 0.3 + 0.6 * Math.abs(n.y),
  },
  // Sphere: radius 0.5.
  sphere: {
    name: "sphere",
    collider: colliderOf({ kind: "sphere", radius: 0.5 }),
    rest: 0.5,
    height: 1,
    width: 1,
    support: () => 0.5,
  },
  // Box: 0.6 x 1.8 x 0.6.
  box: {
    name: "box",
    collider: colliderOf({ kind: "box", size: v3(0.6, 1.8, 0.6) }),
    rest: 0.9,
    height: 1.8,
    width: 0.6,
    support: (n) => 0.3 * Math.abs(n.x) + 0.9 * Math.abs(n.y) + 0.3 * Math.abs(n.z),
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// Backend and rig
// ---------------------------------------------------------------------------------------------------------------------

let loading: Promise<PhysicsBackend> | undefined;
/** Initialises Rapier's WebAssembly once and returns the adapter. */
export function loadBackend(): Promise<PhysicsBackend> {
  loading ??= RAPIER.init().then(() => rapierBackend);
  return loading;
}

/** The contract defaults of decision 0214 (language surface), as the runtime applies them. */
export const CONTRACT_OPTIONS: CharacterMoveOptions = {
  offset: 0.01,
  maxSlope: 0.7853982,
  snapToGround: 0.2,
  stepHeight: 0.25,
  stepMinWidth: 0.1,
  carry: true,
};

export const DT = 1 / 60;
export const SKIN = 0.01;
export const STEPS_DT: readonly number[] = [1 / 30, 1 / 60, 1 / 120, 1 / 144];

export interface Rig {
  readonly world: PhysicsWorld;
  readonly dt: number;
  readonly body: BodyHandle;
  readonly spec: CharacterSpec;
  options: CharacterMoveOptions;
  ticks: number;
  last: CharacterMovement | undefined;
  nextId: number;
}

export interface RigOptions {
  readonly dt?: number;
  readonly options?: CharacterMoveOptions;
}

/** A world without gravity (movement is explicit) and a kinematic character whose centre is at `position`. */
export function createRig(backend: PhysicsBackend, shape: ShapeName, position: Vec3, rig: RigOptions = {}): Rig {
  const dt = rig.dt ?? DT;
  const world = backend.createWorld(v3(), dt);
  const spec = CHARACTERS[shape];
  const body = world.addBody({ kind: "kinematic" }, spec.collider, { position, rotation: IDENTITY }, 1);
  return { world, dt, body, spec, options: { ...CONTRACT_OPTIONS, ...rig.options }, ticks: 0, last: undefined, nextId: 100 };
}

/** The standing height of the character's centre on a surface at `top`: `rest + skin`. */
export const standY = (spec: CharacterSpec, top: number, skin = SKIN): number => top + spec.rest + skin;

const boxCollider = (size: Vec3): ColliderDesc => colliderOf({ kind: "box", size });

/** A static axis-aligned block from `min` to `max`. */
export function solid(rig: Rig, min: Vec3, max: Vec3): BodyHandle {
  const size = sub(max, min);
  const centre = scale(add(min, max), 0.5);
  return rig.world.addBody({ kind: "static" }, boxCollider(size), { position: centre, rotation: IDENTITY }, rig.nextId++);
}

/** A static box with any rotation. */
export function solidBox(rig: Rig, size: Vec3, centre: Vec3, rotation: Quat): BodyHandle {
  return rig.world.addBody({ kind: "static" }, boxCollider(size), { position: centre, rotation }, rig.nextId++);
}

/** A kinematic platform (a box) the caller drives with `tick`'s `targets`. */
export function platform(rig: Rig, size: Vec3, centre: Vec3): BodyHandle {
  return rig.world.addBody({ kind: "kinematic" }, boxCollider(size), { position: centre, rotation: IDENTITY }, rig.nextId++);
}

export const poseOf = (rig: Rig): Pose => rig.world.readPose(rig.body);

export interface TickOptions {
  /** Kinematic targets of other bodies, set before the move (the runtime's "kinematic targets" category). */
  readonly targets?: ReadonlyArray<readonly [BodyHandle, Pose]>;
  /** The requested rotation (default: the current one). */
  readonly rotation?: Quat;
  /** Overrides rig.options for this tick. */
  readonly options?: CharacterMoveOptions;
}

/** One runtime tick of a character: targets, `moveCharacter`, the character's target, `step`. */
export function tick(rig: Rig, displacement: Vec3, opts: TickOptions = {}): CharacterMovement {
  for (const [handle, target] of opts.targets ?? []) rig.world.setKinematicTarget(handle, target);
  const pose = poseOf(rig);
  const move = rig.world.moveCharacter!(rig.body, displacement, { ...rig.options, ...opts.options, rotation: opts.rotation ?? pose.rotation });
  rig.world.setKinematicTarget(rig.body, { position: add(pose.position, move.displacement), rotation: move.rotation });
  rig.world.step();
  rig.ticks++;
  rig.last = move;
  return move;
}

export function dispose(rig: Rig): void {
  rig.world.dispose();
}

/** Runs `body(rig)` and always disposes the world. */
export function withRig<T>(backend: PhysicsBackend, shape: ShapeName, position: Vec3, rigOptions: RigOptions, body: (rig: Rig) => T): T {
  const rig = createRig(backend, shape, position, rigOptions);
  try {
    return body(rig);
  } finally {
    dispose(rig);
  }
}

/** Number of fixed steps that cover `seconds` at `dt` (rounded, so 3 s is exact at every published rate). */
export const ticksFor = (seconds: number, dt: number): number => Math.round(seconds / dt);

// ---------------------------------------------------------------------------------------------------------------------
// Scenario: stairs
// ---------------------------------------------------------------------------------------------------------------------

export interface StairsParams {
  readonly riser: number;
  readonly tread: number;
  readonly stepHeight: number;
  readonly stepMinWidth?: number;
  readonly steps?: number;
  readonly speed?: number;
  readonly dt?: number;
  readonly snapToGround?: number;
}

/** Builds a flight of `steps` steps starting at x = 0 and a landing; returns the top height and the x of the top edge. */
function buildStairs(rig: Rig, riser: number, tread: number, steps: number): { top: number; end: number } {
  solid(rig, v3(-8, -1, -3), v3(0, 0, 3));
  for (let i = 1; i <= steps; i++) solid(rig, v3((i - 1) * tread, -1, -3), v3(i * tread, i * riser, 3));
  const end = steps * tread;
  solid(rig, v3(end, -1, -3), v3(end + 6, steps * riser, 3));
  return { top: steps * riser, end };
}

export interface StairsResult {
  readonly climbed: boolean;
  readonly x: number;
  readonly y: number;
  readonly top: number;
  /** Ticks to reach the landing divided by the ticks of an unobstructed walk of the same length. */
  readonly timeRatio: number;
}

/** Walks up a flight of stairs at `speed` m/s on the horizontal and reports whether the character stands on the landing. */
export function stairsUp(backend: PhysicsBackend, shape: ShapeName, p: StairsParams): StairsResult {
  const steps = p.steps ?? 6;
  const speed = p.speed ?? 2;
  const dt = p.dt ?? DT;
  const options: CharacterMoveOptions = { stepHeight: p.stepHeight, stepMinWidth: p.stepMinWidth ?? 0.1 };
  if (p.snapToGround !== undefined) (options as { snapToGround?: number }).snapToGround = p.snapToGround;
  const spec = CHARACTERS[shape];
  return withRig(backend, shape, v3(-1.5, standY(spec, 0), 0), { dt, options }, (rig) => {
    const { top, end } = buildStairs(rig, p.riser, p.tread, steps);
    const nominal = ticksFor((1.5 + end + 1) / speed, dt);
    const n = nominal * 4 + ticksFor(2, dt);
    let reached = n;
    for (let i = 0; i < n; i++) {
      tick(rig, v3(speed * dt));
      if (poseOf(rig).position.x > end + 1) {
        reached = i + 1;
        break;
      }
    }
    const position = poseOf(rig).position;
    const climbed = position.x > end + 0.5 && Math.abs(position.y - standY(spec, top)) < 0.05;
    return { climbed, x: r4(position.x), y: r4(position.y), top, timeRatio: r3(reached / nominal) };
  });
}

export interface StairsDownResult {
  readonly groundedAll: boolean;
  readonly airborneTicks: number;
  readonly x: number;
  readonly y: number;
}

/** Walks down a flight of stairs; with snap-to-ground the character must stay grounded on every tick when riser <= snap. */
export function stairsDown(backend: PhysicsBackend, shape: ShapeName, p: StairsParams): StairsDownResult {
  const steps = p.steps ?? 6;
  const speed = p.speed ?? 2;
  const dt = p.dt ?? DT;
  const options: CharacterMoveOptions = { stepHeight: p.stepHeight, stepMinWidth: p.stepMinWidth ?? 0.1 };
  if (p.snapToGround !== undefined) (options as { snapToGround?: number }).snapToGround = p.snapToGround;
  const spec = CHARACTERS[shape];
  const probe = createRig(backend, shape, v3(0, 0, 0), { dt });
  const top = steps * p.riser, end = steps * p.tread;
  dispose(probe);
  return withRig(backend, shape, v3(end + 1.5, standY(spec, top), 0), { dt, options }, (rig) => {
    buildStairs(rig, p.riser, p.tread, steps);
    let airborne = 0;
    const n = ticksFor((end + 1.5 + 1) / speed, dt);
    for (let i = 0; i < n; i++) {
      const move = tick(rig, v3(-speed * dt));
      if (i > 0 && !move.grounded) airborne++;
    }
    const position = poseOf(rig).position;
    return { groundedAll: airborne === 0, airborneTicks: airborne, x: r4(position.x), y: r4(position.y) };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Scenario: slopes
// ---------------------------------------------------------------------------------------------------------------------

/** A ramp rising along +x at `angle` from the origin, on a flat floor that ends under it; returns its surface frame. */
function buildRamp(rig: Rig, angle: number): { dir: Vec3; normal: Vec3 } {
  const length = 14, thickness = 1;
  const dir = v3(Math.cos(angle), Math.sin(angle), 0);
  const normal = v3(-Math.sin(angle), Math.cos(angle), 0);
  solid(rig, v3(-12, -1, -4), v3(4, 0, 4));
  const centre = sub(scale(dir, length / 2), scale(normal, thickness / 2));
  solidBox(rig, v3(length, thickness, 8), centre, quatZ(angle));
  return { dir, normal };
}

export interface SlopeClimbResult {
  readonly gain: number;
  readonly expected: number;
  readonly ratio: number;
  readonly climbed: boolean;
  readonly x: number;
}

/** Walks at the ramp at 2 m/s (horizontal) for 3.5 s. `climbed` means at least half the expected height was gained. */
export function slopeClimb(backend: PhysicsBackend, shape: ShapeName, angleDeg: number, maxSlopeDeg: number, dt = DT): SlopeClimbResult {
  const spec = CHARACTERS[shape];
  const options: CharacterMoveOptions = { maxSlope: rad(maxSlopeDeg), stepHeight: 0 };
  return withRig(backend, shape, v3(-1.5, standY(spec, 0), 0), { dt, options }, (rig) => {
    buildRamp(rig, rad(angleDeg));
    const speed = 2, seconds = 3.5;
    for (let i = 0; i < ticksFor(seconds, dt); i++) tick(rig, v3(speed * dt));
    const position = poseOf(rig).position;
    const gain = Math.max(0, position.y - standY(spec, 0));
    // The requested horizontal travel past the ramp's foot, turned into height by the slope.
    const expected = Math.max(0, speed * seconds - 1.5) * Math.tan(rad(angleDeg));
    return { gain: r4(gain), expected: r4(expected), ratio: expected > 0 ? r4(gain / expected) : 0, climbed: gain >= 0.5 * expected && gain > 0.05, x: r4(position.x) };
  });
}

/** The height a character of this shape stands at on a surface with normal `n` through the point `p`. */
function onSurface(spec: CharacterSpec, p: Vec3, n: Vec3, skin = SKIN): Vec3 {
  return add(p, scale(n, spec.support(n) + skin));
}

export interface SlopeSlideResult {
  /** Distance moved downhill along the slope in 1 s of a constant downward push of 3 m/s, metres. */
  readonly downhill: number;
  readonly slides: boolean;
}

/** Stands on the ramp (7 m up it) with a downward push of 3 m/s for 1 s and reports how far it slides downhill. */
export function slopeSlide(backend: PhysicsBackend, shape: ShapeName, angleDeg: number, maxSlopeDeg: number): SlopeSlideResult {
  const spec = CHARACTERS[shape];
  const angle = rad(angleDeg);
  const dir = v3(Math.cos(angle), Math.sin(angle), 0);
  const normal = v3(-Math.sin(angle), Math.cos(angle), 0);
  const start = onSurface(spec, scale(dir, 7), normal);
  const options: CharacterMoveOptions = { maxSlope: rad(maxSlopeDeg), stepHeight: 0, snapToGround: 0 };
  return withRig(backend, shape, start, { options }, (rig) => {
    buildRamp(rig, angle);
    for (let i = 0; i < 60; i++) tick(rig, v3(0, -3 * DT));
    const moved = sub(poseOf(rig).position, start);
    const downhill = -dot(moved, dir);
    return { downhill: r4(downhill), slides: downhill > 0.5 };
  });
}

export interface SlopeDescentResult {
  readonly groundedAll: boolean;
  readonly airborneTicks: number;
  /** Largest angle between the reported ground normal and the slope normal, radians, over the ticks with a ground. */
  readonly normalError: number;
  readonly groundTicks: number;
  readonly ticks: number;
}

/** Walks down a walkable slope at `speed` m/s on the horizontal and checks grounding and the reported ground normal. */
export function slopeDescent(backend: PhysicsBackend, shape: ShapeName, angleDeg: number, snapToGround: number, speed = 2, dt = DT): SlopeDescentResult {
  const spec = CHARACTERS[shape];
  const angle = rad(angleDeg);
  const dir = v3(Math.cos(angle), Math.sin(angle), 0);
  const normal = v3(-Math.sin(angle), Math.cos(angle), 0);
  const start = onSurface(spec, scale(dir, 10), normal);
  const options: CharacterMoveOptions = { maxSlope: rad(Math.min(89, angleDeg + 5)), stepHeight: 0, snapToGround };
  return withRig(backend, shape, start, { dt, options }, (rig) => {
    buildRamp(rig, angle);
    const n = ticksFor(1.5, dt);
    let airborne = 0, groundTicks = 0, worst = 0;
    for (let i = 0; i < n; i++) {
      const move = tick(rig, v3(-speed * dt));
      if (i > 0 && !move.grounded) airborne++;
      if (move.ground !== undefined) {
        groundTicks++;
        worst = Math.max(worst, Math.acos(Math.min(1, dot(move.ground.normal, normal))));
      }
    }
    return { groundedAll: airborne === 0, airborneTicks: airborne, normalError: r4(worst), groundTicks, ticks: n };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Scenario: obstacles
// ---------------------------------------------------------------------------------------------------------------------

/** A tall static wall segment whose front face passes through `from` and runs along `along` for `lengthM`, facing `normal`. */
function wallSegment(rig: Rig, from: Vec3, along: Vec3, normal: Vec3, lengthM: number, thickness = 0.5): void {
  const yaw = Math.atan2(normal.z, -normal.x); // box-local x (the thickness axis) points along -normal
  const centre = v3(from.x + along.x * (lengthM / 2) - normal.x * (thickness / 2), 2, from.z + along.z * (lengthM / 2) - normal.z * (thickness / 2));
  solidBox(rig, v3(thickness, 4, lengthM), centre, quatY(yaw));
}

export interface WallResult {
  /** Most the character's shape ever penetrated the wall plane, metres (0 when it never did). */
  readonly penetration: number;
  /** Distance between the wall and the shape at the end, metres. */
  readonly gap: number;
  /** Distance travelled along the wall, metres. */
  readonly slid: number;
  /** slid / (distance a perfect slide would cover). */
  readonly slideRatio: number;
}

/** Walks at 3 m/s along +x for 3 s towards a wall whose normal is `incidenceDeg` away from -x. */
export function wall(backend: PhysicsBackend, shape: ShapeName, incidenceDeg: number, dt = DT): WallResult {
  const spec = CHARACTERS[shape];
  const phi = rad(incidenceDeg);
  const normal = v3(-Math.cos(phi), 0, Math.sin(phi));
  const along = v3(Math.sin(phi), 0, Math.cos(phi));
  return withRig(backend, shape, v3(0, standY(spec, 0), 0), { dt, options: { stepHeight: 0 } }, (rig) => {
    solid(rig, v3(-6, -1, -40), v3(40, 0, 40));
    const point = v3(3, 0, 0);
    wallSegment(rig, add(point, scale(along, -20)), along, normal, 40);
    let minGap = Infinity;
    const speed = 3;
    for (let i = 0; i < ticksFor(3, dt); i++) {
      tick(rig, v3(speed * dt));
      minGap = Math.min(minGap, dot(sub(poseOf(rig).position, point), normal) - spec.support(normal));
    }
    const end = poseOf(rig).position;
    const gap = dot(sub(end, point), normal) - spec.support(normal);
    const slid = dot(sub(end, v3(0, standY(spec, 0), 0)), along);
    const ideal = speed * 3 * Math.abs(along.x);
    return { penetration: r4(Math.max(0, -minGap)), gap: r4(gap), slid: r4(slid), slideRatio: ideal > 0.01 ? r4(Math.abs(slid) / ideal) : 0 };
  });
}


