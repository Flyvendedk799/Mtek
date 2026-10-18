/**
 * The high-speed limitation of v0.1, measured on the Rapier adapter in Node (decision 0068; the browser spec
 * `tests/browser/specs/m5/physics-tunnelling.spec.ts` repeats the central measurement on the real GPU through the
 * runtime). The adapter enables no continuous collision detection and changes none of Rapier's parameters, so a body
 * that moves farther in one fixed step than a thin obstacle is deep can skip it.
 *
 * The model, derived before it was measured. The engine looks for contacts once per step, on the poses the previous
 * step left. A ball of radius `r` that flies along +x is therefore seen by a thin wall (thickness `t`, midplane at
 * `c`) at the samples `x_k = x_0 + k v dt`. A contact exists when the surface distance is below the prediction
 * distance `p` (0.02 m in Rapier 0.21, decision 0063 item 5). If the ball's centre is still before the midplane the
 * contact stops it, if it is past the midplane the contact pushes it on. So the ball is stopped exactly when a sample
 * lies in the window `[c - t/2 - r - p, c)`, whose length is `w = t/2 + r + p`; a step displacement `v dt <= w`
 * cannot skip it.
 *
 * What was measured, and is asserted below:
 *  - against a dynamic plate the model holds for every speed and every phase of the samples;
 *  - against a fixed (static) wall nothing passes, however fast (to 100 000 m/s, a displacement of 1 667 m per step),
 *    however thin the wall or small the ball: the engine does not let a dynamic body reach a fixed one without a
 *    contact. The limitation is the one between bodies that both move.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { BodyDesc, ColliderDesc, PhysicsBackend, PhysicsWorld, Quat, Vec3 } from "../../runtime-web/src/physics/types.js";
import loadPhysics from "./index.js";

/** The manifest's fixed step (a binary32 value, decision 0066 item 12). */
const DT = 0.016666668;
const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const WALL = 5;
const PREDICTION = 0.02;
const v3 = (x: number, y = 0, z = 0): Vec3 => ({ x, y, z });
const at = (x: number, y = 0, z = 0) => ({ position: v3(x, y, z), rotation: IDENTITY });

const STATIC: BodyDesc = { kind: "static" };
const heavy: BodyDesc = { kind: "dynamic", mass: 10000, linearDamping: 0, angularDamping: 0 };
const light: BodyDesc = { kind: "dynamic", mass: 1, linearDamping: 0, angularDamping: 0 };
const slab = (thickness: number): ColliderDesc => ({ shape: { kind: "box", size: v3(thickness, 4, 4) }, sensor: false, friction: 0.5, restitution: 0 });
const ball = (radius: number): ColliderDesc => ({ shape: { kind: "sphere", radius }, sensor: false, friction: 0.5, restitution: 0 });

let backend: PhysicsBackend;
const worlds: PhysicsWorld[] = [];

beforeAll(async () => {
  backend = await loadPhysics();
});

afterEach(() => {
  for (const world of worlds.splice(0)) world.dispose();
});

/** A world without gravity. */
function space(): PhysicsWorld {
  const world = backend.createWorld(v3(0), DT);
  worlds.push(world);
  return world;
}

/** Where a ball of `radius` thrown along +x at `speed` from `x0` is after `steps` steps, with a wall of `body` and `thickness` at x = 5. */
function flight(wall: BodyDesc, thickness: number, radius: number, speed: number, x0: number, steps = 90): number {
  const world = space();
  world.addBody(wall, slab(thickness), at(WALL), 1);
  const handle = world.addBody(light, ball(radius), at(x0), 2);
  world.setLinearVelocity(handle, v3(speed));
  for (let i = 0; i < steps; i += 1) world.step();
  const x = world.readPose(handle).position.x;
  world.dispose();
  worlds.pop();
  return x;
}

describe("a dynamic ball against a thin static wall: nothing passes", () => {
  const speeds = [3, 12, 60, 240, 1000, 10_000, 100_000];
  const thicknesses = [0.1, 0.01, 0.001];
  const radii = [0.05, 0.005];
  const starts = [3, 4.123];

  for (const thickness of thicknesses) {
    for (const radius of radii) {
      it(`wall ${String(thickness)} m, ball radius ${String(radius)} m, ${String(speeds.length)} speeds from ${String(starts.length)} starts`, () => {
        for (const speed of speeds) {
          for (const x0 of starts) {
            const x = flight(STATIC, thickness, radius, speed, x0);
            // Stopped at the face (the contact skin of 5 mm is the most it can sink in), never on the far side.
            expect(Math.abs(x - (WALL - thickness / 2 - radius)), `${String(speed)} m/s from ${String(x0)}: x = ${String(x)}`).toBeLessThan(0.01);
          }
        }
      });
    }
  }
});

describe("a dynamic ball against a dynamic plate: the window model", () => {
  const thickness = 0.1;
  const radius = 0.05;
  const windowStart = WALL - thickness / 2 - radius - PREDICTION;

  /** The model: stopped exactly when a sample x0 + k v dt lies in [windowStart, WALL). */
  function stopped(speed: number, x0: number): boolean {
    for (let k = 0; x0 + k * speed * DT < WALL + 1; k += 1) {
      const x = x0 + k * speed * DT;
      if (x >= windowStart && x < WALL) return true;
    }
    return false;
  }

  /** Distance of the decisive sample from the nearest edge of the window. */
  function margin(speed: number, x0: number): number {
    const samples: number[] = [];
    for (let k = 0; x0 + k * speed * DT < WALL + 1; k += 1) samples.push(x0 + k * speed * DT);
    const inside = samples.filter((x) => x >= windowStart && x < WALL);
    if (inside.length > 0) return Math.max(...inside.map((x) => Math.min(x - windowStart, WALL - x)));
    const before = samples.filter((x) => x < windowStart).at(-1) ?? Number.NEGATIVE_INFINITY;
    const after = samples.find((x) => x >= WALL) ?? Number.POSITIVE_INFINITY;
    return Math.min(windowStart - before, after - WALL);
  }

  it("the window is 0.12 m, so 7.2 m/s is the speed above which a ball can skip the plate", () => {
    expect(WALL - windowStart).toBeCloseTo(0.12, 12);
    expect(0.12 / DT).toBeCloseTo(7.2, 3);
  });

  for (const speed of [3, 6, 7.2, 8, 9, 12, 15, 30, 60, 240]) {
    it(`${String(speed)} m/s (${(speed * DT).toFixed(4)} m per step): stopped or passed as the window says, in every phase`, () => {
      const phases = 40;
      const step = speed * DT;
      let skippedPhases = 0;
      let passes = 0;
      let stops = 0;
      for (let i = 0; i < phases; i += 1) {
        // The first sample falls at a different place of the window's period each time; start at least 1 m before the wall.
        const x0 = windowStart - Math.ceil(1 / step + 1) * step + ((i + 0.5) / phases) * step;
        // Phases whose decisive sample is within 4 mm of an edge are not asserted (binary32 rounding of the step and the
        // engine's own 5 mm skin make the edge itself ambiguous); every other phase must agree with the model.
        if (margin(speed, x0) < 0.004) {
          skippedPhases += 1;
          continue;
        }
        const world = space();
        world.addBody(heavy, slab(thickness), at(WALL), 1);
        const handle = world.addBody(light, ball(radius), at(x0), 2);
        world.setLinearVelocity(handle, v3(speed));
        for (let s = 0; s < 90; s += 1) world.step();
        const x = world.readPose(handle).position.x;
        world.dispose();
        worlds.pop();
        const wasStopped = x < WALL + thickness / 2;
        expect(wasStopped, `x0 = ${String(x0)}: the model says ${stopped(speed, x0) ? "stopped" : "passes"}, the engine ended at x = ${String(x)}`).toBe(stopped(speed, x0));
        if (wasStopped) stops += 1;
        else passes += 1;
      }
      expect(skippedPhases, "phases skipped for being on an edge").toBeLessThanOrEqual(Math.ceil(phases * (0.02 / step)) + 1);
      if (speed <= 7.2) {
        expect(passes, "at or below 7.2 m/s no phase gets past the window").toBe(0);
      } else {
        // Above it the share of stopped phases is the share of the step the window covers: 0.12 / step.
        expect(passes, "phases that passed").toBeGreaterThan(0);
        expect(Math.abs(stops / (stops + passes) - 0.12 / step)).toBeLessThan(0.08);
      }
    });
  }
});
