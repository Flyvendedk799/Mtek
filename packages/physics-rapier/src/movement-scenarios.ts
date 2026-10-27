/**
 * Obstacle, platform and variable-step scenarios of the character-movement corpus (decision 0215); the core harness
 * and the stair, slope and wall scenarios are in `movement-harness.ts`.
 */
import {
  CHARACTERS,
  DT,
  IDENTITY,
  add,
  angleDiff,
  buildRamp,
  buildStairs,
  conj,
  dot,
  length,
  platform,
  poseOf,
  quatY,
  r4,
  rad,
  rotate,
  solid,
  standY,
  sub,
  tick,
  ticksFor,
  v3,
  wallSegment,
  withRig,
  yawOfQuat,
} from "./movement-harness.ts";
import type { PhysicsBackend, Pose, ShapeName, Vec3 } from "./movement-harness.ts";

export interface CornerResult {
  /** Most the shape penetrated either wall plane, metres. */
  readonly penetration: number;
  /** Largest range of the position over the last 2 s of pushing into the corner (jitter), metres. */
  readonly jitter: number;
  /** How far from the vertex (along the bisector) the character ended. */
  readonly depth: number;
}

/** Pushes into an inside corner of `wedgeDeg` between two walls, along the bisector (`offAxisDeg` 0) or turned off it, for 8 s. */
export function corner(backend: PhysicsBackend, shape: ShapeName, wedgeDeg: number, offAxisDeg = 0, dt = DT): CornerResult {
  const spec = CHARACTERS[shape];
  const half = rad(wedgeDeg) / 2;
  const c = Math.cos(half), s = Math.sin(half);
  const vertex = v3(6, 0, 0);
  const alongA = v3(-c, 0, s), normalA = v3(-s, 0, -c);
  const alongB = v3(-c, 0, -s), normalB = v3(-s, 0, c);
  return withRig(backend, shape, v3(0, standY(spec, 0), 0), { dt, options: { stepHeight: 0 } }, (rig) => {
    solid(rig, v3(-6, -1, -40), v3(40, 0, 40));
    wallSegment(rig, vertex, alongA, normalA, 30);
    wallSegment(rig, vertex, alongB, normalB, 30);
    rig.world.step();
    const push = rad(offAxisDeg);
    const step = v3(Math.cos(push) * 3 * dt, 0, Math.sin(push) * 3 * dt);
    const n = ticksFor(8, dt);
    const tail: Vec3[] = [];
    let penetration = 0;
    for (let i = 0; i < n; i++) {
      tick(rig, step);
      const position = poseOf(rig).position;
      for (const nrm of [normalA, normalB]) penetration = Math.max(penetration, -(dot(sub(position, vertex), nrm) - spec.support(nrm)));
      if (i >= n - ticksFor(2, dt)) tail.push(position);
    }
    const range = (f: (p: Vec3) => number): number => Math.max(...tail.map(f)) - Math.min(...tail.map(f));
    const end = poseOf(rig).position;
    return { penetration: r4(Math.max(0, penetration)), jitter: r4(Math.max(range((p) => p.x), range((p) => p.z), range((p) => p.y))), depth: r4(vertex.x - end.x) };
  });
}

export interface PassResult {
  readonly passed: boolean;
  readonly x: number;
}

/** A ceiling slab over x in [3, 6] with its underside at `clearance`; the character walks through at 3 m/s. */
export function ceiling(backend: PhysicsBackend, shape: ShapeName, clearance: number): PassResult {
  const spec = CHARACTERS[shape];
  return withRig(backend, shape, v3(0, standY(spec, 0), 0), { options: { stepHeight: 0 } }, (rig) => {
    solid(rig, v3(-6, -1, -3), v3(20, 0, 3));
    solid(rig, v3(3, clearance, -3), v3(6, clearance + 0.5, 3));
    rig.world.step();
    for (let i = 0; i < ticksFor(3, DT); i++) tick(rig, v3(3 * DT));
    const x = poseOf(rig).position.x;
    return { passed: x > 7, x: r4(x) };
  });
}

/** Two pillars at x in [3, 4] leaving a gap of `width` centred on z = 0; the character walks through at 3 m/s. */
export function gap(backend: PhysicsBackend, shape: ShapeName, width: number): PassResult {
  const spec = CHARACTERS[shape];
  return withRig(backend, shape, v3(0, standY(spec, 0), 0), { options: { stepHeight: 0 } }, (rig) => {
    solid(rig, v3(-6, -1, -6), v3(20, 0, 6));
    solid(rig, v3(3, 0, width / 2), v3(4, 3, 6));
    solid(rig, v3(3, 0, -6), v3(4, 3, -width / 2));
    rig.world.step();
    for (let i = 0; i < ticksFor(3, DT); i++) tick(rig, v3(3 * DT));
    const x = poseOf(rig).position.x;
    return { passed: x > 5, x: r4(x) };
  });
}

export interface ThinWallResult {
  /** Runs (of `runs`) in which the character's centre ended beyond the wall plane. */
  readonly passes: number;
  readonly runs: number;
}

/**
 * A 0.01 m static wall at x = 5; the character is asked for `perTick` metres per tick towards it, head-on and at 45
 * degrees, from four different phases. Counts the runs in which it ended up on the far side.
 */
export function thinWall(backend: PhysicsBackend, shape: ShapeName, perTick: number): ThinWallResult {
  const spec = CHARACTERS[shape];
  let passes = 0, runs = 0;
  for (const diagonal of [false, true]) {
    for (const phase of [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]) {
      const start = 5 - 1.2 - phase * perTick;
      // The wall is long enough that a slide never reaches its end.
      const ticks = diagonal ? Math.min(30, Math.max(3, Math.floor(40 / (perTick * Math.SQRT1_2)))) : 12;
      const half = 20 + 1.2 * ticks * perTick * Math.SQRT1_2;
      withRig(backend, shape, v3(start, standY(spec, 0), 0), { options: { stepHeight: 0 } }, (rig) => {
        solid(rig, v3(-120, -1, -half - 40), v3(520, 0, half + 40));
        solid(rig, v3(4.995, 0, -half), v3(5.005, 4, half));
        rig.world.step();
        const d = diagonal ? v3(perTick * Math.SQRT1_2, 0, perTick * Math.SQRT1_2) : v3(perTick);
        let beyond = false;
        for (let i = 0; i < ticks; i++) {
          tick(rig, d);
          if (poseOf(rig).position.x > 5) beyond = true;
        }
        runs++;
        if (beyond) passes++;
      });
    }
  }
  return { passes, runs };
}

export interface BumpResult {
  readonly passed: boolean;
  readonly x: number;
  readonly y: number;
}

/** A low block 0.3 m deep and `height` tall on the floor; walk over it at 2 m/s with program-side gravity. */
export function bump(backend: PhysicsBackend, shape: ShapeName, height: number, stepHeight = 0.25): BumpResult {
  const spec = CHARACTERS[shape];
  return withRig(backend, shape, v3(0, standY(spec, 0), 0), { options: { stepHeight } }, (rig) => {
    solid(rig, v3(-6, -1, -3), v3(20, 0, 3));
    solid(rig, v3(2, 0, -2), v3(2.3, height, 2));
    rig.world.step();
    let vy = 0;
    for (let i = 0; i < ticksFor(3, DT); i++) {
      const move = tick(rig, v3(2 * DT, vy * DT, 0));
      vy = move.grounded ? 0 : vy - 9.81 * DT;
    }
    const p = poseOf(rig).position;
    return { passed: p.x > 3.5 && Math.abs(p.y - standY(spec, 0)) < 0.05, x: r4(p.x), y: r4(p.y) };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Moving platforms
// ---------------------------------------------------------------------------------------------------------------------

export type PlatformMotion = "horizontal" | "vertical" | "yaw";

export interface PlatformParams {
  readonly motion: PlatformMotion;
  /** m/s for horizontal and vertical (negative: down / -x), rad/s for yaw. */
  readonly speed: number;
  /** Distance of the character from the platform's centre, metres. */
  readonly radius?: number;
  readonly dt?: number;
  readonly carry?: boolean;
  /** The character also walks at this speed along the platform's +x (m/s, in the platform frame). */
  readonly walk?: number;
  /** Seconds the platform moves for, then rests until the end. Default 1.5 (so both a start and a stop are measured). */
  readonly moveFor?: number;
  readonly duration?: number;
  /** Whether the program applies gravity (a character that is not grounded accelerates down). */
  readonly gravity?: boolean;
}

export interface PlatformResult {
  /** Largest distance of the character from where it should stand on the platform, in the platform frame, metres. */
  readonly drift: number;
  /** The same at the end of the run. */
  readonly endDrift: number;
  /** Largest deviation of the character's yaw from the platform's yaw, radians. */
  readonly yawDrift: number;
  /** Where the character ended in the world, relative to where it started. */
  readonly worldMove: Vec3;
  /** Ticks on which the move reported not grounded. */
  readonly airborneTicks: number;
}

/** A character standing (or walking) on a kinematic platform driven by `motion`. All values are measured after `world.step()`. */
export function platformRun(backend: PhysicsBackend, shape: ShapeName, p: PlatformParams): PlatformResult {
  const spec = CHARACTERS[shape];
  const dt = p.dt ?? DT;
  const radius = p.radius ?? 0;
  const moveFor = p.moveFor ?? 1.5;
  const duration = p.duration ?? 3;
  const startPos = v3(radius, standY(spec, 0), 0);
  return withRig(backend, shape, startPos, { dt, options: { carry: p.carry ?? true, stepHeight: 0.25 } }, (rig) => {
    const base = v3(0, -0.25, 0);
    const deck = platform(rig, v3(12, 0.5, 12), base);
    rig.world.step();
    const platformAt = (t: number): Pose => {
      const moving = Math.min(t, moveFor);
      switch (p.motion) {
        case "horizontal": return { position: add(base, v3(p.speed * moving, 0, 0)), rotation: IDENTITY };
        case "vertical": return { position: add(base, v3(0, p.speed * moving, 0)), rotation: IDENTITY };
        case "yaw": return { position: base, rotation: quatY(p.speed * moving) };
      }
    };
    const relative = (): { rel: Vec3; yaw: number } => {
      const pl = rig.world.readPose(deck);
      const ch = poseOf(rig);
      return { rel: rotate(conj(pl.rotation), sub(ch.position, pl.position)), yaw: angleDiff(yawOfQuat(ch.rotation), yawOfQuat(pl.rotation)) };
    };
    const first = relative();
    let drift = 0, yawDrift = 0, airborne = 0, vy = 0;
    const n = ticksFor(duration, dt);
    for (let i = 0; i < n; i++) {
      const t = (i + 1) * dt;
      // The walk is in the platform frame: turn it into the world with the platform's yaw at the start of the tick.
      const frame = rig.world.readPose(deck).rotation;
      const walk = p.walk === undefined ? v3() : rotate(frame, v3(p.walk * dt));
      const move = tick(rig, v3(walk.x, (p.gravity === true ? vy * dt : 0) + walk.y, walk.z), { targets: [[deck, platformAt(t)]] });
      if (!move.grounded) airborne++;
      vy = p.gravity === true ? (move.grounded ? 0 : vy - 9.81 * dt) : 0;
      const now = relative();
      const expected = add(first.rel, v3((p.walk ?? 0) * t, 0, 0));
      drift = Math.max(drift, length(sub(now.rel, expected)));
      yawDrift = Math.max(yawDrift, Math.abs(angleDiff(now.yaw, first.yaw)));
    }
    const end = relative();
    const endDrift = length(sub(end.rel, add(first.rel, v3((p.walk ?? 0) * n * dt, 0, 0))));
    const at = poseOf(rig).position;
    return { drift: r4(drift), endDrift: r4(endDrift), yawDrift: r4(yawDrift), worldMove: v3(r4(at.x - startPos.x), r4(at.y - startPos.y), r4(at.z - startPos.z)), airborneTicks: airborne };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Variable fixed step
// ---------------------------------------------------------------------------------------------------------------------

export type StepCourse = "flat" | "stairs" | "slope" | "platform";
export const STEP_COURSES: readonly StepCourse[] = ["flat", "stairs", "slope", "platform"];

/** Where a character is after 3 s of the same velocity-driven course at fixed step `dt` (displacement = velocity * dt). */
export function courseEnd(backend: PhysicsBackend, shape: ShapeName, course: StepCourse, dt: number): Vec3 {
  const spec = CHARACTERS[shape];
  const n = ticksFor(3, dt);
  switch (course) {
    case "flat":
      return withRig(backend, shape, v3(0, standY(spec, 0), 0), { dt }, (rig) => {
        solid(rig, v3(-6, -1, -3), v3(30, 0, 3));
        rig.world.step();
        for (let i = 0; i < n; i++) tick(rig, v3(4 * dt));
        return poseOf(rig).position;
      });
    case "stairs":
      return withRig(backend, shape, v3(-1.5, standY(spec, 0), 0), { dt }, (rig) => {
        buildStairs(rig, 0.15, 0.3, 6);
        rig.world.step();
        for (let i = 0; i < n; i++) tick(rig, v3(2 * dt));
        return poseOf(rig).position;
      });
    case "slope":
      return withRig(backend, shape, v3(-1.5, standY(spec, 0), 0), { dt, options: { stepHeight: 0 } }, (rig) => {
        buildRamp(rig, rad(25));
        rig.world.step();
        for (let i = 0; i < n; i++) tick(rig, v3(2 * dt));
        return poseOf(rig).position;
      });
    case "platform":
      // A platform moving 2 m/s along +x for 3 s, carrying a character that walks 1 m/s along it.
      return withRig(backend, shape, v3(-3, standY(spec, 0), 0), { dt, options: { carry: true } }, (rig) => {
        const deck = platform(rig, v3(14, 0.5, 8), v3(0, -0.25, 0));
        rig.world.step();
        for (let i = 0; i < n; i++) tick(rig, v3(1 * dt), { targets: [[deck, { position: v3(2 * (i + 1) * dt, -0.25, 0), rotation: IDENTITY }]] });
        return poseOf(rig).position;
      });
  }
}
