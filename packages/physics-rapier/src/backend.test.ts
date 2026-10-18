/**
 * The Rapier adapter against `spec/physics.md` section 5 and the mapping rows of 5.1, in Node (Rapier's
 * `-compat` build embeds its WebAssembly). Every expectation is derived from the stated model, not copied
 * from a run. The model: with a fixed step `dt`, constant acceleration `a` and `n` steps from rest, velocity
 * is exactly `v_n = a n dt`. Rapier 0.21's solver splits each step into `s = numSolverIterations` substeps
 * (default 4), each integrating semi-implicitly (velocity first, then the position with the new velocity),
 * so with `h = dt / s` and `N = s n` substeps the position is `x_0 + a h^2 N (N + 1) / 2`, which is
 *
 *     x_n = x_0 + a dt^2 (n^2 / 2 + n / (2 s))
 *
 * `dt = 1/60` unless a test says otherwise. Where a result carries a numerical error, the comment names its
 * source and bounds it.
 *
 * Collision detection of step `i` (counting from 0) runs on the poses the previous step left, so the events
 * drained after step `i` describe the poses after step `i - 1` (for a kinematic body: its target of step
 * `i - 1`). The event tests derive their expected step numbers from that rule.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import RAPIER from "@dimforge/rapier3d-compat";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type {
  BodyDesc,
  BodyHandle,
  ColliderDesc,
  PhysicsBackend,
  PhysicsWorld,
  Pose,
  Quat,
  Vec3,
} from "../../runtime-web/src/physics/types.js";
import loadPhysics, { BACKEND_NAME } from "./index.js";

const DT = 1 / 60;
const G = 9.81;
const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const at = (x: number, y: number, z: number, rotation: Quat = IDENTITY): Pose => ({ position: v3(x, y, z), rotation });

const STATIC: BodyDesc = { kind: "static" };
const KINEMATIC: BodyDesc = { kind: "kinematic" };
const dynamic = (mass: number, linearDamping = 0, angularDamping = 0): BodyDesc => ({
  kind: "dynamic",
  mass,
  linearDamping,
  angularDamping,
});
const box = (x: number, y: number, z: number, friction = 0.5, restitution = 0, sensor = false): ColliderDesc => ({
  shape: { kind: "box", size: v3(x, y, z) },
  sensor,
  friction,
  restitution,
});
const ball = (radius: number, friction = 0.5, restitution = 0, sensor = false): ColliderDesc => ({
  shape: { kind: "sphere", radius },
  sensor,
  friction,
  restitution,
});

let backend: PhysicsBackend;
const worlds: PhysicsWorld[] = [];

beforeAll(async () => {
  backend = await loadPhysics();
});

afterEach(() => {
  for (const world of worlds.splice(0)) world.dispose();
});

function newWorld(gravity: Vec3, fixedStep = DT): PhysicsWorld {
  const world = backend.createWorld(gravity, fixedStep);
  worlds.push(world);
  return world;
}

/**
 * The engine's default solver parameters, read from a probe world (the engine must be initialised first, so
 * not at module level). The adapter changes none of them.
 */
function engineDefaults(): { allowedLinearError: number; predictionDistance: number; solverIterations: number } {
  const probe = new RAPIER.World(v3(0, 0, 0));
  const p = probe.integrationParameters;
  const out = {
    allowedLinearError: p.normalizedAllowedLinearError * p.lengthUnit,
    predictionDistance: p.normalizedPredictionDistance * p.lengthUnit,
    solverIterations: probe.numSolverIterations,
  };
  probe.free();
  return out;
}

/**
 * How far from the ideal height a resting body may be. Rapier's contact solver does not correct a penetration
 * smaller than `normalizedAllowedLinearError * lengthUnit` (the "contact skin", 0.005 m in 0.21.0), so a resting
 * body may sit that far inside the surface. The tolerance is that skin, which is inside the 0.01 m of
 * `spec/physics.md` section 7.
 */
const restTolerance = (): number => engineDefaults().allowedLinearError;

/** A 40 x 1 x 40 static slab centred on the origin: its top face is the plane y = 0.5. */
const FLOOR_TOP = 0.5;
function addFloor(world: PhysicsWorld, friction = 0.5, restitution = 0, userId = 1): BodyHandle {
  return world.addBody(STATIC, box(40, 1, 40, friction, restitution), at(0, 0, 0), userId);
}

function stepN(world: PhysicsWorld, n: number): void {
  for (let i = 0; i < n; i++) world.step();
}

interface Collision {
  readonly a: number;
  readonly b: number;
  readonly started: boolean;
}

function drain(world: PhysicsWorld): Collision[] {
  const out: Collision[] = [];
  world.drainCollisions((a, b, started) => out.push({ a, b, started }));
  return out;
}

/** Which two user ids a collision is between, smallest first (the adapter does not order a and b). */
const pairKey = (c: Collision): string => `${Math.min(c.a, c.b)}|${Math.max(c.a, c.b)}`;

describe("the backend", () => {
  it("is named after the exact Rapier version that is installed", () => {
    const entry = createRequire(import.meta.url).resolve("@dimforge/rapier3d-compat");
    // .../dist/rapier.cjs -> the package root two levels up
    const installed = JSON.parse(readFileSync(join(dirname(dirname(entry)), "package.json"), "utf8")) as { name: string; version: string };
    expect(installed.name).toBe("@dimforge/rapier3d-compat");
    expect(backend.name).toBe(`rapier3d-compat@${installed.version}`);
    expect(BACKEND_NAME).toBe(backend.name);
    // Pinned exactly in this package's manifest: no range operator, same version as installed.
    const own = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { dependencies: Record<string, string> };
    expect(own.dependencies["@dimforge/rapier3d-compat"]).toBe(installed.version);
    expect(installed.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("loads once: every call resolves to the same backend", async () => {
    expect(await loadPhysics()).toBe(backend);
  });

  it("creates independent worlds", () => {
    const one = newWorld(v3(0, 0, 0));
    const two = newWorld(v3(0, 0, 0));
    one.addBody(STATIC, box(1, 1, 1), at(0, 0, 0), 1);
    expect(one.counts()).toEqual({ bodies: 1, colliders: 1 });
    expect(two.counts()).toEqual({ bodies: 0, colliders: 0 });
  });
});

describe("gravity and the fixed step", () => {
  it("integrates v = g n dt and y = y0 - g dt^2 (n^2 / 2 + n / (2 s)) for a free-falling body", () => {
    // Step 1/120 (not the engine default 1/60) so that a world which ignored `fixedStep` fails: the same 120
    // steps at 1/60 are two simulated seconds and would give v = -19.6 instead of -9.81.
    const dt = 1 / 120;
    const n = 120; // one simulated second
    const s = engineDefaults().solverIterations;
    expect(s).toBe(4); // the substep count the model above assumes
    const world = newWorld(v3(0, -G, 0), dt);
    const h = world.addBody(dynamic(1), ball(0.5), at(0, 100, 0), 1);
    stepN(world, n);
    const vy = world.readVelocities(h).linear.y;
    const y = world.readPose(h).position.y;
    expect(vy).toBeCloseTo(-G * n * dt, 3); // -9.81 m/s; f32 state, error ~1e-6
    // f32 holds y = 95 to ~8e-6 per operation; 1e-3 is generous and still far from the 0.03 m that a wrong
    // substep model (or n (n + 1) / 2 without substeps) would give.
    expect(Math.abs(y - (100 - G * dt * dt * (n * n / 2 + n / (2 * s))))).toBeLessThan(1e-3);
    expect(world.readVelocities(h).linear.x).toBe(0);
  });

  it("uses the gravity vector it was given, in any direction", () => {
    const world = newWorld(v3(2, 0, -4));
    const h = world.addBody(dynamic(3), ball(0.5), at(0, 0, 0), 1);
    stepN(world, 60);
    const v = world.readVelocities(h).linear;
    expect(v.x).toBeCloseTo(2, 3);
    expect(v.y).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(-4, 3);
  });
});

describe("Static, and BoxCollider (full extents become half-extents)", () => {
  it("a static body keeps the pose it was created with", () => {
    const world = newWorld(v3(0, -G, 0));
    // 90 degrees about y: (0, sin 45, 0, cos 45)
    const q: Quat = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
    const h = world.addBody(STATIC, box(1, 1, 1), at(3, 4, 5, q), 1);
    stepN(world, 30);
    const p = world.readPose(h);
    expect(p.position).toEqual(v3(3, 4, 5));
    expect(p.rotation.y).toBeCloseTo(Math.SQRT1_2, 6);
    expect(p.rotation.w).toBeCloseTo(Math.SQRT1_2, 6);
    expect(p.rotation.x).toBeCloseTo(0, 6);
    expect(world.readVelocities(h)).toEqual({ linear: v3(0, 0, 0), angular: v3(0, 0, 0) });
  });

  it("the assumption behind the rest tolerance holds: the contact skin is 5 mm, inside the spec's 10 mm", () => {
    expect(restTolerance()).toBeCloseTo(0.005, 9);
    expect(restTolerance()).toBeLessThanOrEqual(0.01);
  });

  it("a unit box dropped on the floor rests at floor top + half its extent after 3 s", () => {
    // Floor top = 0.5 (a 1 m thick slab centred on y = 0). A box of full height 1 has half extent 0.5, so its
    // centre rests at 0.5 + 0.5 = 1.0. Had the full size been used as the half-extent, the floor top would be
    // at 1.0 and the box centre at 2.0.
    const world = newWorld(v3(0, -G, 0));
    addFloor(world);
    const h = world.addBody(dynamic(1, 0, 0.05), box(1, 1, 1), at(0, 3, 0), 2);
    stepN(world, 180); // 3 s
    expect(world.readPose(h).position.y).toBeCloseTo(FLOOR_TOP + 0.5, 0); // coarse guard against the wrong half-extent
    expect(Math.abs(world.readPose(h).position.y - (FLOOR_TOP + 0.5))).toBeLessThan(restTolerance());
    const v = world.readVelocities(h);
    expect(Math.hypot(v.linear.x, v.linear.y, v.linear.z)).toBeLessThan(1e-3);
  });

  it("applies each half-extent to its own axis: a 1 x 2 x 3 box rests at floor top + 1.0", () => {
    // Full height 2 -> half extent 1.0 along y. The other axes (0.5 and 1.5) do not matter for a flat landing.
    const world = newWorld(v3(0, -G, 0));
    addFloor(world);
    const h = world.addBody(dynamic(1), box(1, 2, 3), at(0, 4, 0), 2);
    stepN(world, 180);
    expect(Math.abs(world.readPose(h).position.y - (FLOOR_TOP + 1.0))).toBeLessThan(restTolerance());
  });

  it("a box rotated a quarter turn about z rests on its other face: floor top + 1.5 for a 2 x 3 x 1 box", () => {
    // Size (2, 3, 1) rotated 90 degrees about z swaps the x and y extents: the vertical full extent is 2 (from
    // size.x), half extent 1.0... a 90 degree turn maps the local x axis onto world y, so the height is size.x.
    // Rest centre = 0.5 + 2/2 = 1.5.
    const world = newWorld(v3(0, -G, 0));
    addFloor(world);
    const q: Quat = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
    const h = world.addBody(dynamic(1), box(2, 3, 1), at(0, 4, 0, q), 2);
    stepN(world, 180);
    expect(Math.abs(world.readPose(h).position.y - (FLOOR_TOP + 1.0))).toBeLessThan(restTolerance());
  });
});

describe("SphereCollider", () => {
  it("a ball of radius 0.25 rests at floor top + 0.25", () => {
    // A radius (not a diameter): the centre of a resting ball is one radius above the surface.
    const world = newWorld(v3(0, -G, 0));
    addFloor(world);
    const h = world.addBody(dynamic(1), ball(0.25), at(0, 3, 0), 2);
    stepN(world, 180);
    expect(Math.abs(world.readPose(h).position.y - (FLOOR_TOP + 0.25))).toBeLessThan(restTolerance());
  });
});

describe("Dynamic: mass on the collider, impulses and damping", () => {
  it("an impulse changes the velocity by impulse / mass (spec bound 1 %; f32 arithmetic is far tighter)", () => {
    for (const mass of [0.5, 2, 10]) {
      const world = newWorld(v3(0, 0, 0));
      const h = world.addBody(dynamic(mass), box(1, 1, 1), at(0, 0, 0), 1);
      world.applyImpulse(h, v3(4, -2, 6));
      // dv = I / m, component-wise, immediately (the impulse acts on the velocity, not through a step)
      const v = world.readVelocities(h).linear;
      expect(v.x).toBeCloseTo(4 / mass, 5);
      expect(v.y).toBeCloseTo(-2 / mass, 5);
      expect(v.z).toBeCloseTo(6 / mass, 5);
      // ... and with no forces acting, the velocity is unchanged by a step.
      world.step();
      expect(world.readVelocities(h).linear.x).toBeCloseTo(4 / mass, 5);
    }
  });

  it("adds the impulse to the velocity the body already had", () => {
    const world = newWorld(v3(0, 0, 0));
    const h = world.addBody(dynamic(2), ball(0.5), at(0, 0, 0), 1);
    world.setLinearVelocity(h, v3(1, 1, 1));
    world.applyImpulse(h, v3(2, 0, 0)); // + 2 / 2 = +1 on x
    expect(world.readVelocities(h).linear).toEqual(v3(2, 1, 1));
  });

  it("the collider mass is the mass: it does not depend on the shape's volume", () => {
    // Rapier's default density would make a 2 m cube 8 times heavier than a 1 m cube. With setMass(3) on both,
    // the same impulse (6, 0, 0) must give dv = 6 / 3 = 2 on both.
    for (const size of [0.5, 1, 2]) {
      const world = newWorld(v3(0, 0, 0));
      const h = world.addBody(dynamic(3), box(size, size, size), at(0, 0, 0), 1);
      world.applyImpulse(h, v3(6, 0, 0));
      expect(world.readVelocities(h).linear.x).toBeCloseTo(2, 5);
    }
    const world = newWorld(v3(0, 0, 0));
    const sphere = world.addBody(dynamic(3), ball(2), at(0, 0, 0), 2);
    world.applyImpulse(sphere, v3(6, 0, 0));
    expect(world.readVelocities(sphere).linear.x).toBeCloseTo(2, 5);
  });

  it("a sensor collider carries the mass too", () => {
    const world = newWorld(v3(0, 0, 0));
    const h = world.addBody(dynamic(2), ball(0.5, 0.5, 0, true), at(0, 0, 0), 1);
    world.applyImpulse(h, v3(4, 0, 0));
    expect(world.readVelocities(h).linear.x).toBeCloseTo(2, 5);
  });

  it("an impulse wakes a body that has gone to sleep", () => {
    // After 5 s at rest the body sleeps; the impulse (0, 3, 0) on mass 1 gives vy = 3, so the centre rises by
    // vy^2 / (2 g) = 9 / 19.62 = 0.4587 m. Semi-implicit Euler peaks within vy * dt / 2 = 0.025 m of that.
    const world = newWorld(v3(0, -G, 0));
    addFloor(world);
    const h = world.addBody(dynamic(1), box(1, 1, 1), at(0, 3, 0), 2);
    stepN(world, 300);
    const rest = world.readPose(h).position.y;
    world.applyImpulse(h, v3(0, 3, 0));
    let peak = rest;
    for (let i = 0; i < 60; i++) {
      world.step();
      peak = Math.max(peak, world.readPose(h).position.y);
    }
    expect(Math.abs(peak - rest - 9 / (2 * G))).toBeLessThan(0.03);
  });

  it("linear damping multiplies the velocity by 1 / (1 + c dt) each step, about e^(-c t)", () => {
    // Rapier applies damping implicitly. c = 2, v0 = 10, 60 steps: v = 10 / (1 + 2/60)^60 = 1.398, close to
    // the continuous 10 e^-2 = 1.353 (the difference is the implicit discretisation, 3 %).
    const world = newWorld(v3(0, 0, 0));
    const h = world.addBody(dynamic(1, 2, 0), ball(0.5), at(0, 0, 0), 1);
    world.setLinearVelocity(h, v3(10, 0, 0));
    world.step();
    expect(world.readVelocities(h).linear.x).toBeCloseTo(10 / (1 + 2 * DT), 4);
    stepN(world, 59);
    const v = world.readVelocities(h).linear.x;
    expect(v).toBeCloseTo(10 / Math.pow(1 + 2 * DT, 60), 4);
    expect(Math.abs(v - 10 * Math.exp(-2)) / (10 * Math.exp(-2))).toBeLessThan(0.05);
  });

  it("no damping keeps the velocity", () => {
    const world = newWorld(v3(0, 0, 0));
    const h = world.addBody(dynamic(1, 0, 0), ball(0.5), at(0, 0, 0), 1);
    world.setLinearVelocity(h, v3(10, 0, 0));
    stepN(world, 120);
    expect(world.readVelocities(h).linear.x).toBeCloseTo(10, 4);
    expect(world.readPose(h).position.x).toBeCloseTo(10 * 2, 2); // v t = 20 m
  });

  it("setLinearVelocity sets the velocity (and wakes a sleeping body)", () => {
    const world = newWorld(v3(0, -G, 0));
    addFloor(world);
    const h = world.addBody(dynamic(1), box(1, 1, 1), at(0, 3, 0), 2);
    stepN(world, 300); // asleep
    world.setLinearVelocity(h, v3(0, 3, 0));
    expect(world.readVelocities(h).linear).toEqual(v3(0, 3, 0));
    stepN(world, 10);
    expect(world.readPose(h).position.y).toBeGreaterThan(FLOOR_TOP + 0.5 + 0.1);
  });

  it("angular damping slows the spin: a rolling ball loses speed as e^(-(2/7) c t)", () => {
    // A solid sphere (Rapier: I = 2/5 m r^2) set sliding at v0 = 3 on a floor with mu = 0.5 (both colliders 0.5,
    // averaged) rolls without slipping after t_s = (2/7) v0 / (mu g) = 0.175 s, at v = (5/7) v0 = 2.143, omega = v / r.
    // Rolling with angular damping c is torque-driven: (I / r + m r) dv/dt = -c I v / r, so dv/dt = -(2/7) c v.
    // With c = 1 and t = 2 s: v = 2.143 e^(-(2/7)(2 - 0.175)) = 1.272 m/s. The sliding phase also loses a little
    // spin to damping (c t_s = 17 % of a 0.175 s phase) and the damping is implicit: 5 % covers both.
    const run = (angularDamping: number): { v: number; omega: number } => {
      const world = newWorld(v3(0, -G, 0));
      addFloor(world, 0.5);
      const h = world.addBody(dynamic(1, 0, angularDamping), ball(0.5, 0.5), at(0, 1, 0), 2);
      world.setLinearVelocity(h, v3(3, 0, 0));
      stepN(world, 120);
      const vel = world.readVelocities(h);
      return { v: vel.linear.x, omega: vel.angular.z };
    };
    const free = run(0);
    expect(free.v).toBeCloseTo((5 / 7) * 3, 1); // 2.143, within 0.05 (2 %)
    expect(free.omega).toBeCloseTo(-free.v / 0.5, 1); // rolling toward +x spins about -z
    const damped = run(1);
    const expected = (5 / 7) * 3 * Math.exp(-(2 / 7) * 1 * (2 - 0.175));
    expect(Math.abs(damped.v - expected) / expected).toBeLessThan(0.05);
  });

  it("applies the force for the next step only", () => {
    // m = 2, F = (6, 0, 0): a = 3 m/s^2, one step: v = a dt = 0.05. The next step has no force: v stays.
    const world = newWorld(v3(0, 0, 0));
    const h = world.addBody(dynamic(2), box(1, 1, 1), at(0, 0, 0), 1);
    world.addForceForNextStep(h, v3(6, 0, 0));
    expect(world.readVelocities(h).linear.x).toBe(0); // nothing happens before the step
    world.step();
    expect(world.readVelocities(h).linear.x).toBeCloseTo(3 * DT, 6);
    stepN(world, 5);
    expect(world.readVelocities(h).linear.x).toBeCloseTo(3 * DT, 6);
    // Again: a second force lasts one step again, so the velocity is twice 0.05.
    world.addForceForNextStep(h, v3(6, 0, 0));
    world.step();
    stepN(world, 3);
    expect(world.readVelocities(h).linear.x).toBeCloseTo(2 * 3 * DT, 6);
  });

  it("adds up forces issued before the same step", () => {
    // (6, 0, 0) + (0, 4, 0) + (2, 0, 0) on m = 2: a = (4, 2, 0); one step: v = (4, 2, 0) / 60.
    const world = newWorld(v3(0, 0, 0));
    const h = world.addBody(dynamic(2), box(1, 1, 1), at(0, 0, 0), 1);
    world.addForceForNextStep(h, v3(6, 0, 0));
    world.addForceForNextStep(h, v3(0, 4, 0));
    world.addForceForNextStep(h, v3(2, 0, 0));
    stepN(world, 4);
    const v = world.readVelocities(h).linear;
    expect(v.x).toBeCloseTo(4 * DT, 6);
    expect(v.y).toBeCloseTo(2 * DT, 6);
  });

  it("a force on one body does not leak into another or into a body added later", () => {
    const world = newWorld(v3(0, 0, 0));
    const a = world.addBody(dynamic(1), ball(0.5), at(0, 0, 0), 1);
    const b = world.addBody(dynamic(1), ball(0.5), at(10, 0, 0), 2);
    world.addForceForNextStep(a, v3(60, 0, 0));
    world.step();
    world.removeBody(a);
    const c = world.addBody(dynamic(1), ball(0.5), at(20, 0, 0), 3);
    stepN(world, 3);
    expect(world.readVelocities(b).linear.x).toBe(0);
    expect(world.readVelocities(c).linear.x).toBe(0);
  });
});

describe("Kinematic", () => {
  it("is not affected by gravity and reaches the target pose in one step, with the velocity the move implies", () => {
    const world = newWorld(v3(0, -G, 0));
    const h = world.addBody(KINEMATIC, box(1, 1, 1), at(0, 5, 0), 1);
    stepN(world, 30);
    expect(world.readPose(h).position).toEqual(v3(0, 5, 0));
    // Target 0.3 m along +x and a quarter turn about y within one step: velocity = displacement / dt = 18 m/s.
    const q: Quat = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
    world.setKinematicTarget(h, at(0.3, 5, 0, q));
    world.step();
    const p = world.readPose(h);
    expect(p.position.x).toBeCloseTo(0.3, 6);
    expect(p.position.y).toBeCloseTo(5, 6);
    expect(p.rotation.y).toBeCloseTo(Math.SQRT1_2, 6);
    expect(p.rotation.w).toBeCloseTo(Math.SQRT1_2, 6);
    expect(world.readVelocities(h).linear.x).toBeCloseTo(0.3 / DT, 3);
    // No new target: it stays, and its velocity is zero again.
    world.step();
    expect(world.readPose(h).position.x).toBeCloseTo(0.3, 6);
    expect(world.readVelocities(h).linear.x).toBeCloseTo(0, 4); // f32: ~2e-6 of derived-velocity noise
  });

  it("pushes a dynamic body that is in its way", () => {
    // A kinematic wall (1 x 2 x 4 at x = 0) moves in +x at 2 m/s; a ball of radius 0.5 sits 0.1 m in front of it
    // (centre x = 1.1, its surface at 0.6 against the wall face at 0.5) in zero gravity. After 2 s the wall face
    // is at 0.5 + 4 = 4.5 and the pushed ball cannot be behind it: its centre is at least 4.5 + 0.5 - skin.
    const world = newWorld(v3(0, 0, 0));
    const wall = world.addBody(KINEMATIC, box(1, 2, 4), at(0, 0, 0), 1);
    const b = world.addBody(dynamic(1), ball(0.5), at(1.1, 0, 0), 2);
    for (let i = 1; i <= 120; i++) {
      world.setKinematicTarget(wall, at(2 * i * DT, 0, 0));
      world.step();
    }
    expect(world.readPose(wall).position.x).toBeCloseTo(4, 4);
    expect(world.readPose(b).position.x).toBeGreaterThan(4.5 + 0.5 - 0.01);
  });
});

describe("teleport", () => {
  it("sets the pose now and, without keep_velocity, zeroes both velocities", () => {
    const world = newWorld(v3(0, -G, 0));
    const h = world.addBody(dynamic(1), box(1, 1, 1), at(0, 50, 0), 1);
    world.setLinearVelocity(h, v3(3, 0, 0));
    stepN(world, 30);
    expect(world.readVelocities(h).linear.y).toBeLessThan(-4); // -g * 0.5 s = -4.9
    const q: Quat = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
    world.teleport(h, at(7, 8, 9, q), false);
    const p = world.readPose(h);
    expect(p.position).toEqual(v3(7, 8, 9));
    expect(p.rotation.y).toBeCloseTo(Math.SQRT1_2, 6);
    expect(world.readVelocities(h)).toEqual({ linear: v3(0, 0, 0), angular: v3(0, 0, 0) });
    // From rest at the new pose: one step of gravity only.
    world.step();
    expect(world.readVelocities(h).linear.x).toBe(0);
    expect(world.readVelocities(h).linear.y).toBeCloseTo(-G * DT, 5);
    expect(world.readPose(h).position.x).toBe(7);
  });

  it("keeps the velocity with keep_velocity, and the body then continues from the new pose", () => {
    const world = newWorld(v3(0, 0, 0));
    const h = world.addBody(dynamic(1), ball(0.5), at(0, 0, 0), 1);
    world.setLinearVelocity(h, v3(3, 0, 0));
    world.teleport(h, at(100, 0, 0), true);
    expect(world.readVelocities(h).linear).toEqual(v3(3, 0, 0));
    stepN(world, 60);
    expect(world.readPose(h).position.x).toBeCloseTo(103, 2); // 100 + v t; f32 near 100 has a 7.6e-6 ulp, 60 additions
  });

  it("zeroes the angular velocity of a rolling ball too", () => {
    const world = newWorld(v3(0, -G, 0));
    addFloor(world);
    const h = world.addBody(dynamic(1), ball(0.5), at(0, 1, 0), 2);
    world.setLinearVelocity(h, v3(3, 0, 0));
    stepN(world, 60);
    expect(Math.abs(world.readVelocities(h).angular.z)).toBeGreaterThan(1);
    world.teleport(h, at(0, 1, 5), false);
    expect(world.readVelocities(h).angular).toEqual(v3(0, 0, 0));
  });

  it("moves a kinematic body without sweeping: it stays where it was put", () => {
    // A kinematic velocity is derived from the pose change, so right after the teleport a stale value from the
    // previous move may still be reported; after one step it is zero because nothing moved.
    const world = newWorld(v3(0, 0, 0));
    const h = world.addBody(KINEMATIC, box(1, 1, 1), at(0, 0, 0), 1);
    world.setKinematicTarget(h, at(1, 0, 0));
    world.step();
    world.teleport(h, at(10, 0, 0), false);
    expect(world.readPose(h).position).toEqual(v3(10, 0, 0));
    world.step();
    expect(world.readPose(h).position.x).toBe(10);
    expect(world.readVelocities(h).linear.x).toBe(0);
  });

  it("a teleported sleeping body wakes up and falls", () => {
    const world = newWorld(v3(0, -G, 0));
    addFloor(world);
    const h = world.addBody(dynamic(1), box(1, 1, 1), at(0, 3, 0), 2);
    stepN(world, 300);
    world.teleport(h, at(0, 10, 0), false);
    stepN(world, 30);
    expect(world.readVelocities(h).linear.y).toBeCloseTo(-G * 0.5, 2);
  });
});

describe("collider material: sensor, friction, restitution", () => {
  it("a sensor does not push: a ball falls through a sensor box at full gravity", () => {
    const world = newWorld(v3(0, -G, 0));
    world.addBody(STATIC, box(4, 2, 4, 0.5, 0, true), at(0, 5, 0), 100);
    const h = world.addBody(dynamic(1), ball(0.5), at(0, 8, 0), 200);
    stepN(world, 120); // 2 s: far through and below the sensor
    expect(world.readVelocities(h).linear.y).toBeCloseTo(-G * 2, 2);
  });

  it("restitution: a ball dropped from 2 m rebounds to about e^2 of the drop", () => {
    // Colliders are combined with the default `Average` rule, so ball 0.8 + floor 0.8 gives e = 0.8. The
    // rebound speed is e times the impact speed, the rebound height e^2 times the drop: 0.64 * 2 m. The
    // centre starts at 3 (ball resting at 1.0), so the fall is 2 m. Semi-implicit Euler samples the impact
    // speed within g dt = 0.1635 m/s of the exact sqrt(2 g h) = 6.26 m/s (2.6 %), which moves the rebound ratio
    // by about 2 * 2.6 % * 0.64 = 0.034; the bound used is 0.04.
    const world = newWorld(v3(0, -G, 0));
    addFloor(world, 0.5, 0.8);
    const h = world.addBody(dynamic(1), ball(0.5, 0.5, 0.8), at(0, 3, 0), 2);
    const restY = FLOOR_TOP + 0.5;
    let peak = 0;
    let bounced = false;
    for (let i = 0; i < 200; i++) {
      world.step();
      const vy = world.readVelocities(h).linear.y;
      const y = world.readPose(h).position.y;
      if (!bounced && vy > 0) bounced = true;
      if (bounced) {
        peak = Math.max(peak, y);
        if (vy < 0) break; // past the top of the first rebound
      }
    }
    expect(bounced).toBe(true);
    const ratio = (peak - restY) / (3 - restY);
    expect(Math.abs(ratio - 0.64)).toBeLessThan(0.04);
  });

  it("restitution 0 does not bounce at all", () => {
    const world = newWorld(v3(0, -G, 0));
    addFloor(world, 0.5, 0);
    const h = world.addBody(dynamic(1), ball(0.5, 0.5, 0), at(0, 3, 0), 2);
    let landed = false;
    let upward = 0;
    for (let i = 0; i < 200; i++) {
      world.step();
      if (world.readPose(h).position.y < 1.01) landed = true;
      if (landed) upward = Math.max(upward, world.readVelocities(h).linear.y);
    }
    expect(landed).toBe(true);
    expect(upward).toBeLessThan(0.01);
  });

  it("friction: a box sliding at 4 m/s stops after v^2 / (2 mu g) = 1.63 m, and does not slow down at mu = 0", () => {
    // mu = 0.5 on both colliders (averaged) -> deceleration mu g = 4.905 m/s^2. The box is settled on the
    // floor first, then given the velocity. The discrete solver brakes within one step of the ideal: the stop
    // is at most v0 dt = 0.067 m away; the bound used is 0.1 m.
    const slide = (boxFriction: number, floorFriction: number): { distance: number; speed: number } => {
      const world = newWorld(v3(0, -G, 0));
      addFloor(world, floorFriction);
      const h = world.addBody(dynamic(1, 0, 0.05), box(1, 1, 1, boxFriction), at(0, 1, 0), 2);
      stepN(world, 30);
      const x0 = world.readPose(h).position.x;
      world.setLinearVelocity(h, v3(4, 0, 0));
      stepN(world, 300);
      return { distance: world.readPose(h).position.x - x0, speed: world.readVelocities(h).linear.x };
    };
    const expected = 16 / (2 * 0.5 * G);
    const rough = slide(0.5, 0.5);
    expect(Math.abs(rough.distance - expected)).toBeLessThan(0.1);
    expect(rough.speed).toBeCloseTo(0, 3);
    // Frictionless: 5 s at 4 m/s = 20 m, speed unchanged.
    const smooth = slide(0, 0);
    expect(smooth.speed).toBeCloseTo(4, 3);
    expect(smooth.distance).toBeCloseTo(20, 1);
    // The two colliders' coefficients are averaged: (1 + 0) / 2 behaves like 0.5 / 0.5, and (0.5 + 0) / 2 = 0.25
    // takes twice the distance (v^2 / (2 * 0.25 g)).
    expect(Math.abs(slide(1, 0).distance - expected)).toBeLessThan(0.1);
    expect(Math.abs(slide(0.5, 0).distance - 2 * expected)).toBeLessThan(0.2);
  });
});

describe("collision events", () => {
  it("reports the user ids, not the engine's collider handles, when a body lands", () => {
    // Ids chosen far from any engine handle (small integers with generation bits).
    const world = newWorld(v3(0, -G, 0));
    addFloor(world, 0.5, 0, 90210);
    const h = world.addBody(dynamic(1), box(1, 1, 1), at(0, 2, 0), 4_000_000);
    const events: Collision[] = [];
    for (let i = 0; i < 120; i++) {
      world.step();
      events.push(...drain(world));
    }
    expect(events.length).toBeGreaterThanOrEqual(1);
    const first = events[0];
    expect(first?.started).toBe(true);
    expect(new Set([first?.a, first?.b])).toEqual(new Set([90210, 4_000_000]));
    for (const e of events) expect(pairKey(e)).toBe("90210|4000000");
    expect(typeof h).toBe("number");
  });

  it("draining empties the queue", () => {
    const world = newWorld(v3(0, -G, 0));
    addFloor(world);
    world.addBody(dynamic(1), box(1, 1, 1), at(0, 1.05, 0), 2);
    let delivered = 0;
    for (let i = 0; i < 20; i++) {
      world.step();
      const events = drain(world);
      delivered += events.length;
      // Whatever was delivered is gone: a second drain of the same step is empty.
      expect(drain(world)).toEqual([]);
    }
    expect(delivered).toBeGreaterThan(0);
  });

  it("events are per step: one not drained before the next step is discarded, so the queue cannot grow", () => {
    // The queue is created with autoDrain (spec/physics.md section 5.1, `EventQueue(true)`): the runtime drains
    // after every step (section 4, item 6), and a missed drain loses events instead of accumulating them.
    const world = newWorld(v3(0, 0, 0));
    world.addBody(STATIC, box(4, 4, 4, 0.5, 0, true), at(0, 0, 0), 1);
    world.addBody(dynamic(1), ball(0.5), at(0, 0, 0), 2); // starts inside the sensor
    world.step(); // the `started` event of this step is not drained
    world.step();
    expect(drain(world)).toEqual([]);
  });

  it("events of one step are only the changes of that step", () => {
    const world = newWorld(v3(0, -G, 0));
    addFloor(world);
    world.addBody(dynamic(1), box(1, 1, 1), at(0, 1.0, 0), 2);
    stepN(world, 5);
    drain(world);
    stepN(world, 30); // resting contact: nothing starts or stops
    expect(drain(world)).toEqual([]);
  });

  it("reports pairs between dynamic bodies, each with its own user ids", () => {
    // B rests on the floor, A is dropped on B: the pairs are floor-B and B-A (never floor-A).
    const world = newWorld(v3(0, -G, 0));
    addFloor(world, 0.5, 0, 1);
    world.addBody(dynamic(1), box(1, 1, 1), at(0, 1.0, 0), 42);
    world.addBody(dynamic(1), box(1, 1, 1), at(0, 4, 0), 7);
    const started = new Set<string>();
    for (let i = 0; i < 180; i++) {
      world.step();
      for (const e of drain(world)) if (e.started) started.add(pairKey(e));
    }
    expect([...started].sort()).toEqual(["1|42", "7|42"]);
  });


  it("sensor enter and exit: a ball falling through a sensor box produces one of each, in order", () => {
    // Sensor box 2 m tall centred y = 5: spans [4, 6]. A ball of radius 0.5 starts at y = 8 and falls through.
    // A dynamic body's collision detection runs at the start of a step on the poses the previous step left, so
    // the event of step i (counting from 0) is for the pose after i steps, y_i = 8 - g dt^2 (i^2 / 2 + i / 8)
    // (4 substeps, see the header). Enter: the first i whose ball overlaps the box (bottom y - 0.5 below 6,
    // top y + 0.5 above 4); exit: the first later i that does not. The poses are nowhere near a tie (the ball
    // moves ~0.1 m per step, and the first overlapping pose is 13 mm inside).
    const y = (i: number): number => 8 - G * DT * DT * (i * i / 2 + i / 8);
    const overlaps = (i: number): boolean => y(i) - 0.5 < 6 && y(i) + 0.5 > 4;
    const steps = 150;
    let enter = -1;
    let exit = -1;
    for (let i = 0; i < steps; i++) {
      if (enter < 0 && overlaps(i)) enter = i;
      if (enter >= 0 && exit < 0 && !overlaps(i)) exit = i;
    }
    expect(enter).toBeGreaterThan(0);
    expect(exit).toBeGreaterThan(enter);

    const world = newWorld(v3(0, -G, 0));
    world.addBody(STATIC, box(2, 2, 2, 0.5, 0, true), at(0, 5, 0), 100);
    world.addBody(dynamic(1), ball(0.5), at(0, 8, 0), 200);
    const seen: { step: number; started: boolean }[] = [];
    for (let i = 0; i < steps; i++) {
      world.step();
      for (const e of drain(world)) {
        expect(pairKey(e)).toBe("100|200");
        seen.push({ step: i, started: e.started });
      }
    }
    expect(seen).toEqual([
      { step: enter, started: true },
      { step: exit, started: false },
    ]);
  });

  describe("active collision types (every collider gets ALL)", () => {
    // A kinematic ball is moved along -x through a fixed 2 m sensor cube centred on the origin, 0.04 m per step
    // (so there is no tie with a face): the target of step i is x_i = 5 - 0.04 i. The ball (radius 0.25)
    // overlaps the cube while x - 0.25 < 1 and x + 0.25 > -1, that is 1.25 > x > -1.25: targets 94 (x = 1.24)
    // to 156 (x = -1.24); target 157 (x = -1.28) is out. Collision detection of step i runs on the poses the
    // previous step left, so the transition of target j is reported by step j + 1: enter at step 95, exit at 158.
    const x = (i: number): number => 5 - 0.04 * i;
    const overlapsAt = (i: number): boolean => x(i) - 0.25 < 1 && x(i) + 0.25 > -1;
    const STEPS = 200;
    const expected = ((): { step: number; started: boolean }[] => {
      const out: { step: number; started: boolean }[] = [];
      for (let j = 0; j < STEPS; j++) {
        if (overlapsAt(j) !== overlapsAt(j - 1)) out.push({ step: j + 1, started: overlapsAt(j) });
      }
      return out;
    })();

    it("the derivation: enter at step 95, exit at step 158", () => {
      expect(expected).toEqual([
        { step: 95, started: true },
        { step: 158, started: false },
      ]);
    });

    it("a kinematic body entering and leaving a fixed sensor produces enter and exit events", () => {
      const world = newWorld(v3(0, 0, 0));
      world.addBody(STATIC, box(2, 2, 2, 0.5, 0, true), at(0, 0, 0), 10);
      const k = world.addBody(KINEMATIC, ball(0.25), at(5, 0, 0), 11);
      const seen: { step: number; started: boolean }[] = [];
      for (let i = 0; i < STEPS; i++) {
        world.setKinematicTarget(k, at(x(i), 0, 0));
        world.step();
        for (const e of drain(world)) {
          expect(pairKey(e)).toBe("10|11");
          seen.push({ step: i, started: e.started });
        }
      }
      expect(seen).toEqual(expected);
    });

    // The control experiment behind the "events" row of the mapping table, on Rapier itself: the same motion
    // with the engine's default collision types raises nothing, and with ALL raises the two events. This is why
    // the adapter must set ALL on every collider.
    const rawEvents = (types: RAPIER.ActiveCollisionTypes | undefined): { step: number; started: boolean }[] => {
      const world = new RAPIER.World(v3(0, 0, 0));
      world.timestep = DT;
      const queue = new RAPIER.EventQueue(true);
      const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      const sensor = RAPIER.ColliderDesc.cuboid(1, 1, 1).setSensor(true).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      const moving = RAPIER.ColliderDesc.ball(0.25).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      if (types !== undefined) {
        sensor.setActiveCollisionTypes(types);
        moving.setActiveCollisionTypes(types);
      }
      world.createCollider(sensor, fixed);
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(5, 0, 0));
      world.createCollider(moving, body);
      const out: { step: number; started: boolean }[] = [];
      for (let i = 0; i < STEPS; i++) {
        body.setNextKinematicTranslation(v3(x(i), 0, 0));
        world.step(queue);
        queue.drainCollisionEvents((_a, _b, started) => out.push({ step: i, started }));
      }
      queue.free();
      world.free();
      return out;
    };

    it("control: Rapier's default collision types produce no event for kinematic-vs-fixed sensor pairs", () => {
      expect(rawEvents(undefined)).toEqual([]);
    });

    it("control: with ActiveCollisionTypes.ALL Rapier produces the two events", () => {
      expect(rawEvents(RAPIER.ActiveCollisionTypes.ALL)).toEqual(expected);
    });

    it("a kinematic body touching a fixed solid wall produces a started event", () => {
      // Wall: static box 1 x 4 x 4 at x = 0, face at x = -0.5. A kinematic box 1 x 1 x 1 approaches along +x
      // by 0.037 m per step from x = -5: its +x face is at x_i + 0.5, the gap g_i = -0.5 - (x_i + 0.5) =
      // 4 - 0.037 i. A contact exists once the gap is within the prediction distance (0.02 m in 0.21.0): the
      // target of step 107 has g = 0.041, that of step 108 has g = 0.004. The contact is found by the next
      // step's collision detection (see the header), so the `started` event is that of step 109.
      const prediction = engineDefaults().predictionDistance;
      expect(prediction).toBeCloseTo(0.02, 9);
      let firstTarget = -1;
      for (let i = 0; i < 200 && firstTarget < 0; i++) if (4 - 0.037 * i <= prediction) firstTarget = i;
      expect(firstTarget).toBe(108);
      const first = firstTarget + 1;

      const world = newWorld(v3(0, 0, 0));
      world.addBody(STATIC, box(1, 4, 4), at(0, 0, 0), 20);
      const k = world.addBody(KINEMATIC, box(1, 1, 1), at(-5, 0, 0), 21);
      const started: number[] = [];
      for (let i = 0; i < 200; i++) {
        world.setKinematicTarget(k, at(-5 + 0.037 * i, 0, 0));
        world.step();
        for (const e of drain(world)) {
          expect(pairKey(e)).toBe("20|21");
          if (e.started) started.push(i);
        }
      }
      expect(started).toEqual([first]);
    });
  });

  it("drops events of a body that was removed before they were drained", () => {
    // The ball starts inside the sensor, so the first step raises a `started` event; removing the ball before
    // the drain removes its user id, and `spec/physics.md` section 6 says events of removed entities are not
    // delivered.
    const world = newWorld(v3(0, 0, 0));
    world.addBody(STATIC, box(4, 4, 4, 0.5, 0, true), at(0, 0, 0), 1);
    const h = world.addBody(dynamic(1), ball(0.5), at(0, 0, 0), 2);
    world.step();
    world.removeBody(h);
    expect(drain(world)).toEqual([]);
  });

  it("removing a body in contact is clean: no event for it afterwards, and the world keeps running", () => {
    const world = newWorld(v3(0, -G, 0));
    addFloor(world);
    const h = world.addBody(dynamic(1), box(1, 1, 1), at(0, 1.2, 0), 2);
    let started = false;
    for (let i = 0; i < 20; i++) {
      world.step();
      if (drain(world).some((e) => e.started)) started = true;
    }
    expect(started).toBe(true);
    world.removeBody(h);
    for (let i = 0; i < 3; i++) {
      world.step();
      expect(drain(world)).toEqual([]);
    }
    expect(world.counts()).toEqual({ bodies: 1, colliders: 1 });
  });

  it("a user id belongs to its collider only: a recycled engine slot reports the new id", () => {
    const world = newWorld(v3(0, -G, 0));
    addFloor(world, 0.5, 0, 1);
    const old = world.addBody(dynamic(1), box(1, 1, 1), at(5, 5, 0), 555);
    world.removeBody(old);
    world.addBody(dynamic(1), box(1, 1, 1), at(0, 1.2, 0), 666);
    const events: Collision[] = [];
    for (let i = 0; i < 20; i++) {
      world.step();
      events.push(...drain(world));
    }
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(pairKey(e)).toBe("1|666");
  });
});

describe("counts, removal and dispose", () => {
  it("counts bodies and colliders, and returns to zero after removals", () => {
    const world = newWorld(v3(0, 0, 0));
    expect(world.counts()).toEqual({ bodies: 0, colliders: 0 });
    const a = world.addBody(STATIC, box(1, 1, 1), at(0, 0, 0), 1);
    const b = world.addBody(dynamic(1), ball(0.5), at(3, 0, 0), 2);
    const c = world.addBody(KINEMATIC, box(1, 1, 1), at(6, 0, 0), 3);
    expect(world.counts()).toEqual({ bodies: 3, colliders: 3 });
    world.removeBody(b);
    expect(world.counts()).toEqual({ bodies: 2, colliders: 2 });
    world.removeBody(a);
    world.removeBody(c);
    expect(world.counts()).toEqual({ bodies: 0, colliders: 0 });
    // Still usable.
    world.step();
    world.addBody(STATIC, box(1, 1, 1), at(0, 0, 0), 4);
    expect(world.counts()).toEqual({ bodies: 1, colliders: 1 });
  });

  it("a removed handle is unknown from then on", () => {
    const world = newWorld(v3(0, 0, 0));
    const h = world.addBody(dynamic(1), ball(0.5), at(0, 0, 0), 1);
    world.removeBody(h);
    expect(() => world.removeBody(h)).toThrow(/unknown body handle/);
    expect(() => world.readPose(h)).toThrow(/unknown body handle/);
    expect(() => world.applyImpulse(h, v3(1, 0, 0))).toThrow(/unknown body handle/);
    expect(() => world.teleport(h, at(0, 0, 0), false)).toThrow(/unknown body handle/);
  });

  it("dispose frees everything: counts are zero and the world is unusable", () => {
    const world = newWorld(v3(0, -G, 0));
    addFloor(world);
    const h = world.addBody(dynamic(1), box(1, 1, 1), at(0, 3, 0), 2);
    stepN(world, 10);
    world.dispose();
    expect(world.counts()).toEqual({ bodies: 0, colliders: 0 });
    expect(() => world.step()).toThrow(/disposed/);
    expect(() => world.readPose(h)).toThrow(/disposed/);
    expect(() => world.addBody(STATIC, box(1, 1, 1), at(0, 0, 0), 9)).toThrow(/disposed/);
    expect(() => world.drainCollisions(() => undefined)).toThrow(/disposed/);
    world.dispose(); // idempotent
    expect(world.counts()).toEqual({ bodies: 0, colliders: 0 });
  });

  it("20 create-populate-dispose cycles each end at zero", () => {
    for (let cycle = 0; cycle < 20; cycle++) {
      const world = newWorld(v3(0, -G, 0));
      addFloor(world);
      for (let i = 0; i < 10; i++) world.addBody(dynamic(1), box(1, 1, 1), at(i * 2 - 9, 2, 0), 10 + i);
      stepN(world, 5);
      expect(world.counts()).toEqual({ bodies: 11, colliders: 11 });
      world.dispose();
      expect(world.counts()).toEqual({ bodies: 0, colliders: 0 });
    }
  });
});

describe("what the adapter reads back", () => {
  it("returns plain objects that are not views into the engine", () => {
    const world = newWorld(v3(0, 0, 0));
    const h = world.addBody(dynamic(1), ball(0.5), at(1, 2, 3), 1);
    const a = world.readPose(h);
    const b = world.readPose(h);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
    expect(Object.getPrototypeOf(a.position)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(a.rotation)).toBe(Object.prototype);
    const v = world.readVelocities(h);
    expect(Object.getPrototypeOf(v.linear)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(v.angular)).toBe(Object.prototype);
  });

  it("the pose keeps the creation rotation exactly for a unit quaternion", () => {
    const world = newWorld(v3(0, 0, 0));
    const q: Quat = { x: 0.5, y: 0.5, z: 0.5, w: 0.5 }; // 120 degrees about (1, 1, 1)
    const h = world.addBody(KINEMATIC, box(1, 1, 1), at(0, 0, 0, q), 1);
    const r = world.readPose(h).rotation;
    expect(r.x).toBeCloseTo(0.5, 6);
    expect(r.y).toBeCloseTo(0.5, 6);
    expect(r.z).toBeCloseTo(0.5, 6);
    expect(r.w).toBeCloseTo(0.5, 6);
  });
});

describe("input the engine could not survive is rejected before it reaches the engine", () => {
  // A WebAssembly panic cannot be recovered from, so the adapter refuses what the engine would panic on
  // or turn into NaN. The compiler already guarantees these ranges (`spec/stdlib.md` section 3.7).
  it("rejects a non-positive or non-finite mass, size, radius and step", () => {
    const world = newWorld(v3(0, 0, 0));
    expect(() => world.addBody(dynamic(0), ball(0.5), at(0, 0, 0), 1)).toThrow(RangeError);
    expect(() => world.addBody(dynamic(-1), ball(0.5), at(0, 0, 0), 1)).toThrow(RangeError);
    expect(() => world.addBody(dynamic(Number.NaN), ball(0.5), at(0, 0, 0), 1)).toThrow(RangeError);
    expect(() => world.addBody(STATIC, box(1, 0, 1), at(0, 0, 0), 1)).toThrow(RangeError);
    expect(() => world.addBody(STATIC, ball(Number.POSITIVE_INFINITY), at(0, 0, 0), 1)).toThrow(RangeError);
    expect(() => backend.createWorld(v3(0, 0, 0), 0)).toThrow(RangeError);
    expect(() => backend.createWorld(v3(0, Number.NaN, 0), DT)).toThrow(RangeError);
    expect(world.counts()).toEqual({ bodies: 0, colliders: 0 });
  });

  it("rejects negative damping, friction and restitution", () => {
    const world = newWorld(v3(0, 0, 0));
    expect(() => world.addBody(dynamic(1, -0.1, 0), ball(0.5), at(0, 0, 0), 1)).toThrow(RangeError);
    expect(() => world.addBody(dynamic(1, 0, -0.1), ball(0.5), at(0, 0, 0), 1)).toThrow(RangeError);
    expect(() => world.addBody(STATIC, box(1, 1, 1, -0.5), at(0, 0, 0), 1)).toThrow(RangeError);
    expect(() => world.addBody(STATIC, box(1, 1, 1, 0.5, -0.5), at(0, 0, 0), 1)).toThrow(RangeError);
    expect(world.counts()).toEqual({ bodies: 0, colliders: 0 });
  });

  it("rejects non-finite poses, impulses, forces, velocities and targets", () => {
    const world = newWorld(v3(0, 0, 0));
    expect(() => world.addBody(STATIC, box(1, 1, 1), at(Number.NaN, 0, 0), 1)).toThrow(RangeError);
    const h = world.addBody(dynamic(1), ball(0.5), at(0, 0, 0), 1);
    const bad = v3(0, Number.POSITIVE_INFINITY, 0);
    expect(() => world.applyImpulse(h, bad)).toThrow(RangeError);
    expect(() => world.addForceForNextStep(h, bad)).toThrow(RangeError);
    expect(() => world.setLinearVelocity(h, bad)).toThrow(RangeError);
    expect(() => world.setKinematicTarget(h, at(0, 0, Number.NaN))).toThrow(RangeError);
    expect(() => world.teleport(h, { position: v3(0, 0, 0), rotation: { x: 0, y: 0, z: 0, w: Number.NaN } }, false)).toThrow(RangeError);
    // Nothing was applied.
    expect(world.readVelocities(h).linear).toEqual(v3(0, 0, 0));
  });
});
