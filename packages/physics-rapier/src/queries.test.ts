import { afterEach, beforeAll, describe, expect, it } from "vitest";
import loadPhysics from "./index.js";
import type {
  PhysicsBackend,
  PhysicsWorld,
  ColliderDesc,
  BodyDesc,
} from "../../runtime-web/src/physics/types.js";
const v = (x = 0, y = 0, z = 0) => ({ x, y, z }),
  pose = (x = 0, y = 0, z = 0) => ({
    position: v(x, y, z),
    rotation: { x: 0, y: 0, z: 0, w: 1 },
  });
const ball = (radius: number): ColliderDesc => ({
  shape: { kind: "sphere", radius },
  sensor: false,
  friction: 0.5,
  restitution: 0,
});
const box = (x: number, y: number, z: number): ColliderDesc => ({
  shape: { kind: "box", size: v(x, y, z) },
  sensor: false,
  friction: 0.5,
  restitution: 0,
});
let backend: PhysicsBackend;
const worlds: PhysicsWorld[] = [];
beforeAll(async () => {
  backend = await loadPhysics();
});
afterEach(() => {
  for (const world of worlds.splice(0)) world.dispose();
});
function space() {
  const world = backend.createWorld(v(), 1 / 60);
  worlds.push(world);
  return world;
}
describe("optional spatial query and continuous collision capabilities", () => {
  it("sweeps a sphere across a thin obstacle with filtering and contact details", () => {
    const world = space(),
      wall = world.addBody({ kind: "static" }, box(0.1, 4, 4), pose(5), 42);
    world.step();
    const hit = world.castShape!(ball(0.2).shape, pose(), v(10));
    expect(hit?.userId).toBe(42);
    expect(hit?.fraction).toBeCloseTo(0.475, 3);
    expect(hit?.normal.x).toBeCloseTo(-1);
    expect(
      world.castShape!(ball(0.2).shape, pose(), v(10), { exclude: wall }),
    ).toBeUndefined();
    world.setCollisionGroups!(wall, 2, 2);
    world.step();
    expect(
      world.castShape!(ball(0.2).shape, pose(), v(10), { groups: 0x00010001 }),
    ).toBeUndefined();
    expect(
      world.castShape!(ball(0.2).shape, pose(), v(10), { groups: 0x00020002 })
        ?.userId,
    ).toBe(42);
  });
  it("computes grounded character movement that stops at a wall", () => {
    const world = space();
    world.addBody({ kind: "static" }, box(20, 1, 20), pose(0, -0.5), 1);
    world.addBody({ kind: "static" }, box(0.1, 3, 10), pose(2, 1.5), 2);
    const actor = world.addBody(
      { kind: "kinematic" },
      ball(0.5),
      pose(0, 0.52),
      3,
    );
    world.step();
    const moved = world.moveCharacter!(actor, v(10, -0.2), {
      offset: 0.01,
      snapToGround: 0.2,
    });
    expect(moved.displacement.x).toBeGreaterThan(1);
    expect(moved.displacement.x).toBeLessThan(1.46);
    expect(moved.grounded).toBe(true);
    expect(moved.contacts.some((c) => c.userId === 2)).toBe(true);
    expect(world.readPose(actor).position.x).toBe(0); // Query only: caller owns movement.
    expect(() =>
      world.moveCharacter!(actor, v(), { maxSlope: Infinity }),
    ).toThrow(/slope/);
  });
  it("offers explicit CCD for the documented moving-body tunnelling case", () => {
    const run = (continuousCollision: boolean): number => {
      const world = space(),
        heavy: BodyDesc = {
          kind: "dynamic",
          mass: 10000,
          linearDamping: 0,
          angularDamping: 0,
        };
      world.addBody(heavy, box(0.1, 4, 4), pose(5), 1);
      const shot = world.addBody(
        {
          kind: "dynamic",
          mass: 1,
          linearDamping: 0,
          angularDamping: 0,
          continuousCollision,
        },
        ball(0.05),
        pose(0.37),
        2,
      );
      world.setLinearVelocity(shot, v(240));
      for (let i = 0; i < 90; i++) world.step();
      return world.readPose(shot).position.x;
    };
    expect(run(false)).toBeGreaterThan(100);
    expect(run(true)).toBeLessThan(6);
  });
});
