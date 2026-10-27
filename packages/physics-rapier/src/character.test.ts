/**
 * The adapter features of decision 0215 on the real Rapier engine: `castRay`, capsules, and the resolution of one character move
 * (decision 0214: support, carry, the controller sweep) as they appear in `CharacterMovement`. The sweeps of the movement corpus
 * (stairs, slopes, obstacles, platforms, variable step) are in `movement-corpus.test.ts`.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import loadPhysics from "./index.js";
import type { BodyDesc, ColliderDesc, PhysicsBackend, PhysicsWorld, Quat } from "../../runtime-web/src/physics/types.js";

const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const pose = (x = 0, y = 0, z = 0, rotation: Quat = IDENTITY) => ({ position: v(x, y, z), rotation });
const yaw = (angle: number): Quat => ({ x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) });
const collider = (shape: ColliderDesc["shape"], sensor = false): ColliderDesc => ({ shape, sensor, friction: 0.5, restitution: 0 });
const box = (x: number, y: number, z: number, sensor = false): ColliderDesc => collider({ kind: "box", size: v(x, y, z) }, sensor);
const ball = (radius: number): ColliderDesc => collider({ kind: "sphere", radius });
const capsule = (radius: number, height: number): ColliderDesc => collider({ kind: "capsule", radius, height });
const STATIC: BodyDesc = { kind: "static" };
const KINEMATIC: BodyDesc = { kind: "kinematic" };

let backend: PhysicsBackend;
const worlds: PhysicsWorld[] = [];
beforeAll(async () => {
  backend = await loadPhysics();
});
afterEach(() => {
  for (const world of worlds.splice(0)) world.dispose();
});
function space(gravity = v()): PhysicsWorld {
  const world = backend.createWorld(gravity, 1 / 60);
  worlds.push(world);
  return world;
}

describe("castRay", () => {
  it("returns the user id, distance along the unit direction, normal and point of the first hit", () => {
    const world = space();
    world.addBody(STATIC, box(0.2, 4, 4), pose(5), 7);
    world.addBody(STATIC, box(0.2, 4, 4), pose(8), 8);
    world.step();
    const hit = world.castRay!(v(0, 0.5, 0.25), v(2, 0, 0), 20);
    expect(hit?.userId).toBe(7);
    expect(hit?.distance).toBeCloseTo(4.9, 4); // the near face of a 0.2 m wall at x = 5
    expect(hit?.normal.x).toBeCloseTo(-1, 5);
    expect(hit?.point.x).toBeCloseTo(4.9, 4);
    expect(hit?.point.y).toBeCloseTo(0.5, 5);
    expect(hit?.point.z).toBeCloseTo(0.25, 5);
  });
  it("is limited by maxDistance and finds nothing past the last collider", () => {
    const world = space();
    world.addBody(STATIC, box(0.2, 4, 4), pose(5), 7);
    world.step();
    expect(world.castRay!(v(), v(1), 4.8)).toBeUndefined();
    expect(world.castRay!(v(), v(1), 4.95)?.userId).toBe(7);
    expect(world.castRay!(v(), v(-1), 100)).toBeUndefined();
    expect(world.castRay!(v(0, 9, 0), v(1), 100)).toBeUndefined();
  });
  it("reports distance 0 from inside a collider and an oblique normal for a tilted direction", () => {
    const world = space();
    world.addBody(STATIC, box(4, 4, 4), pose(), 3);
    world.addBody(STATIC, box(20, 1, 20), pose(0, -5), 4);
    world.step();
    expect(world.castRay!(v(), v(1), 10)?.distance).toBe(0);
    const down = world.castRay!(v(30, 0, 0), v(0, -3, 0), 100);
    expect(down?.userId).toBe(undefined); // outside the floor
    const onFloor = world.castRay!(v(5, 0, 0), v(0, -3, 0), 100);
    expect(onFloor?.userId).toBe(4);
    expect(onFloor?.distance).toBeCloseTo(4.5, 4);
    expect(onFloor?.normal.y).toBeCloseTo(1, 5);
  });
  it("applies exclude, groups and the sensor flag like castShape", () => {
    const world = space();
    const wall = world.addBody(STATIC, box(0.2, 4, 4), pose(5), 42);
    const zone = world.addBody(STATIC, box(0.2, 4, 4, true), pose(3), 43);
    world.step();
    expect(world.castRay!(v(), v(1), 20)?.userId).toBe(42); // the sensor is skipped
    expect(world.castRay!(v(), v(1), 20, { includeSensors: true })?.userId).toBe(43);
    expect(world.castRay!(v(), v(1), 20, { includeSensors: true, exclude: zone })?.userId).toBe(42);
    expect(world.castRay!(v(), v(1), 20, { exclude: wall })).toBeUndefined();
    world.setCollisionGroups!(wall, 2, 2);
    world.step();
    expect(world.castRay!(v(), v(1), 20, { groups: 0x00010001 })).toBeUndefined();
    expect(world.castRay!(v(), v(1), 20, { groups: 0x00020002 })?.userId).toBe(42);
  });
  it("rejects a zero-length or non-finite direction, a negative distance and a stale exclude handle", () => {
    const world = space();
    const body = world.addBody(STATIC, box(1, 1, 1), pose(5), 1);
    expect(() => world.castRay!(v(), v(), 1)).toThrow(RangeError);
    expect(() => world.castRay!(v(), v(NaN), 1)).toThrow(RangeError);
    expect(() => world.castRay!(v(), v(Infinity), 1)).toThrow(RangeError);
    expect(() => world.castRay!(v(NaN), v(1), 1)).toThrow(RangeError);
    expect(() => world.castRay!(v(), v(1), -1)).toThrow(RangeError);
    expect(() => world.castRay!(v(), v(1), NaN)).toThrow(RangeError);
    expect(() => world.castRay!(v(), v(1), 1, { groups: -1 })).toThrow(RangeError);
    world.removeBody(body);
    expect(() => world.castRay!(v(), v(1), 1, { exclude: body })).toThrow(/unknown body handle/);
  });
});

describe("capsules", () => {
  it("rejects a capsule that is not taller than its caps", () => {
    const world = space();
    expect(() => world.addBody(KINEMATIC, capsule(0.3, 0.6), pose(), 1)).toThrow(RangeError);
    expect(() => world.addBody(KINEMATIC, capsule(0.3, 0.5), pose(), 1)).toThrow(RangeError);
    expect(() => world.addBody(KINEMATIC, capsule(0, 1), pose(), 1)).toThrow(RangeError);
    expect(() => world.addBody(KINEMATIC, capsule(0.3, NaN), pose(), 1)).toThrow(RangeError);
    expect(world.counts()).toEqual({ bodies: 0, colliders: 0 });
  });
  it("is as tall as `height` (both caps included) and as wide as twice `radius`", () => {
    const world = space(v(0, -9.81, 0));
    world.addBody(STATIC, box(20, 1, 20), pose(0, -0.5), 1);
    const body = world.addBody({ kind: "dynamic", mass: 1, linearDamping: 0, angularDamping: 0 }, capsule(0.3, 1.8), pose(0, 3), 2);
    // Keep it upright: a capsule that is not disturbed stays on its axis.
    for (let i = 0; i < 240; i++) world.step();
    const rest = world.readPose(body).position;
    expect(rest.y).toBeGreaterThan(0.9 - 0.01);
    expect(rest.y).toBeLessThan(0.9 + 0.03);
  });
  it("is hit by shape casts as a capsule: caps first, then the cylinder", () => {
    const world = space();
    world.addBody(STATIC, box(0.2, 6, 6), pose(5, 2), 9);
    world.step();
    const cap = { kind: "capsule", radius: 0.3, height: 1.8 } as const;
    const hit = world.castShape!(cap, pose(0, 1), v(10));
    expect(hit?.userId).toBe(9);
    expect(hit?.fraction).toBeCloseTo((4.9 - 0.3) / 10, 3); // the wall face at 4.9 m minus the radius
    expect(hit?.normal.x).toBeCloseTo(-1, 3);
    // A capsule lying on its side (turned about Z) is 1.8 m wide along x: it reaches the wall earlier.
    const lying = world.castShape!(cap, pose(0, 1, 0, { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }), v(10));
    expect(lying?.fraction).toBeCloseTo((4.9 - 0.9) / 10, 3);
    expect(() => world.castShape!({ kind: "capsule", radius: 0.3, height: 0.6 }, pose(), v(1))).toThrow(RangeError);
  });
  it("moves as a character: it stops at a wall and reports the floor as ground", () => {
    const world = space();
    world.addBody(STATIC, box(40, 1, 40), pose(0, -0.5), 1);
    world.addBody(STATIC, box(0.2, 4, 10), pose(3, 2), 2);
    const actor = world.addBody(KINEMATIC, capsule(0.3, 1.8), pose(0, 0.91), 3);
    world.step();
    const moved = world.moveCharacter!(actor, v(10, 0, 0), { offset: 0.01, snapToGround: 0.2 });
    expect(moved.displacement.x).toBeCloseTo(2.9 - 0.3 - 0.01, 2);
    expect(moved.grounded).toBe(true);
    expect(moved.ground?.userId).toBe(1);
    expect(moved.ground?.normal.y).toBeCloseTo(1, 5);
    expect(moved.contacts.some((c) => c.userId === 2)).toBe(true);
  });
});

describe("moveCharacter, resolution of one move (decision 0214)", () => {
  function arena() {
    const world = space();
    world.addBody(STATIC, box(40, 1, 40), pose(0, -0.5), 1);
    const actor = world.addBody(KINEMATIC, ball(0.5), pose(0, 0.51), 2);
    world.step();
    return { world, actor };
  }
  it("finds the support with a downward cast of the character's own shape and reports its normal", () => {
    const { world, actor } = arena();
    const m = world.moveCharacter!(actor, v(1, 0, 0), { offset: 0.01, snapToGround: 0.2 });
    expect(m.ground).toEqual({ userId: 1, normal: expect.objectContaining({ y: expect.closeTo(1, 6) }) });
    expect(m.carried).toEqual(v());
    expect(m.carriedYaw).toBe(0);
  });
  it("has no ground in the air, farther below than skin + max(snap, 0.05), or on a slope steeper than maxSlope", () => {
    const world = space();
    world.addBody(STATIC, box(40, 1, 40), pose(0, -0.5), 1);
    const actor = world.addBody(KINEMATIC, ball(0.5), pose(0, 1.0), 2);
    world.step();
    // 0.5 m above the floor: farther than 0.01 + 0.2.
    expect(world.moveCharacter!(actor, v(), { offset: 0.01, snapToGround: 0.2 }).ground).toBeUndefined();
    world.teleport(actor, pose(0, 0.7), false);
    world.step();
    // 0.2 m above: within 0.01 + 0.2 = 0.21 with snap 0.2, outside 0.01 + 0.05 with snap 0.
    expect(world.moveCharacter!(actor, v(), { offset: 0.01, snapToGround: 0.2 }).ground?.userId).toBe(1);
    expect(world.moveCharacter!(actor, v(), { offset: 0.01, snapToGround: 0 }).ground).toBeUndefined();
    // A 50 degree ramp is steeper than the 45 degree default and than a 40 degree limit, not than 60.
    const tilt = Math.PI * (50 / 180);
    world.addBody(STATIC, box(20, 1, 20), pose(100, 0, 0, { x: 0, y: 0, z: Math.sin(tilt / 2), w: Math.cos(tilt / 2) }), 3);
    const normal = { x: -Math.sin(tilt), y: Math.cos(tilt) };
    const climber = world.addBody(KINEMATIC, ball(0.5), pose(100 + normal.x * 1.01, normal.y * 1.01), 4);
    world.step();
    expect(world.moveCharacter!(climber, v(), { maxSlope: Math.PI / 4, snapToGround: 0.2 }).ground).toBeUndefined();
    const walkable = world.moveCharacter!(climber, v(), { maxSlope: Math.PI / 3, snapToGround: 0.2 }).ground;
    expect(walkable?.userId).toBe(3);
    expect(walkable?.normal.y).toBeCloseTo(Math.cos(tilt), 4);
  });
  it("never uses a sensor as the support", () => {
    const world = space();
    world.addBody(STATIC, box(40, 1, 40, true), pose(0, -0.5), 1);
    const actor = world.addBody(KINEMATIC, ball(0.5), pose(0, 0.51), 2);
    world.step();
    expect(world.moveCharacter!(actor, v(), { snapToGround: 0.2, includeSensors: true }).ground).toBeUndefined();
  });
  it("does not carry by a static support, nor by a kinematic one unless `carry` is set", () => {
    const world = space();
    const deck = world.addBody(KINEMATIC, box(10, 0.5, 10), pose(0, -0.25), 1);
    const actor = world.addBody(KINEMATIC, ball(0.5), pose(0, 0.51), 2);
    world.step();
    world.setKinematicTarget(deck, pose(0.5, -0.25));
    const off = world.moveCharacter!(actor, v(0.1), { snapToGround: 0.2 });
    expect(off.carried).toEqual(v());
    expect(off.displacement.x).toBeCloseTo(0.1, 4);
    const on = world.moveCharacter!(actor, v(0.1), { snapToGround: 0.2, carry: true });
    expect(on.carried.x).toBeCloseTo(0.5, 5);
    expect(on.carried.y).toBeCloseTo(0, 5);
    expect(on.displacement.x).toBeCloseTo(0.6, 4); // the returned displacement includes the carry
    expect(on.ground?.userId).toBe(1);
  });
  it("carries by the pending pose change, so the same platform target is not applied twice", () => {
    const world = space();
    const deck = world.addBody(KINEMATIC, box(10, 0.5, 10), pose(0, -0.25), 1);
    const actor = world.addBody(KINEMATIC, ball(0.5), pose(0, 0.51), 2);
    world.step();
    for (let i = 1; i <= 30; i++) {
      world.setKinematicTarget(deck, pose(0.1 * i, -0.25));
      const m = world.moveCharacter!(actor, v(), { snapToGround: 0.2, carry: true });
      expect(m.carried.x).toBeCloseTo(0.1, 4);
      const at = world.readPose(actor);
      world.setKinematicTarget(actor, { position: { x: at.position.x + m.displacement.x, y: at.position.y + m.displacement.y, z: at.position.z + m.displacement.z }, rotation: m.rotation });
      world.step();
    }
    expect(world.readPose(actor).position.x).toBeCloseTo(3, 3);
    expect(world.readPose(deck).position.x).toBeCloseTo(3, 3);
  });
  it("turns a character about +Y with the yaw of the support and swings it round the support's centre", () => {
    const world = space();
    const deck = world.addBody(KINEMATIC, box(12, 0.5, 12), pose(0, -0.25), 1);
    const actor = world.addBody(KINEMATIC, ball(0.5), pose(2, 0.51), 2);
    world.step();
    const angle = 0.1;
    world.setKinematicTarget(deck, pose(0, -0.25, 0, yaw(angle)));
    const m = world.moveCharacter!(actor, v(), { snapToGround: 0.2, carry: true });
    expect(m.carriedYaw).toBeCloseTo(angle, 5);
    expect(m.carried.x).toBeCloseTo(2 * Math.cos(angle) - 2, 5);
    expect(m.carried.z).toBeCloseTo(-2 * Math.sin(angle), 5);
    expect(m.rotation.y).toBeCloseTo(Math.sin(angle / 2), 5);
    expect(m.rotation.w).toBeCloseTo(Math.cos(angle / 2), 5);
    // The carried yaw is applied to the requested rotation, not to the current one.
    const requested = yaw(1);
    const turned = world.moveCharacter!(actor, v(), { snapToGround: 0.2, carry: true, rotation: requested });
    expect(turned.rotation.y).toBeCloseTo(Math.sin((1 + angle) / 2), 5);
    // Without a carry the requested rotation passes through, and by default it is the current one.
    expect(world.moveCharacter!(actor, v(), { snapToGround: 0.2, rotation: requested }).rotation).toEqual(requested);
    expect(world.moveCharacter!(actor, v(), { snapToGround: 0.2 }).rotation).toEqual(IDENTITY);
  });
  it("takes only the twist about +Y from a support that also tilts", () => {
    const world = space();
    const deck = world.addBody(KINEMATIC, box(12, 0.5, 12), pose(0, -0.25), 1);
    const actor = world.addBody(KINEMATIC, ball(0.5), pose(0, 0.51), 2);
    world.step();
    const roll = 0.05;
    world.setKinematicTarget(deck, pose(0, -0.25, 0, { x: Math.sin(roll / 2), y: 0, z: 0, w: Math.cos(roll / 2) }));
    expect(world.moveCharacter!(actor, v(), { snapToGround: 0.2, carry: true }).carriedYaw).toBeCloseTo(0, 6);
  });
  it("keeps the character grounded on a platform that rises fast and follows one that descends", () => {
    const world = space();
    const deck = world.addBody(KINEMATIC, box(10, 0.5, 10), pose(0, -0.25), 1);
    const actor = world.addBody(KINEMATIC, ball(0.5), pose(0, 0.51), 2);
    world.step();
    const tick = (dy: number): { grounded: boolean; y: number; deckY: number } => {
      world.setKinematicTarget(deck, pose(0, world.readPose(deck).position.y + dy));
      const m = world.moveCharacter!(actor, v(), { snapToGround: 0.2, carry: true });
      const at = world.readPose(actor);
      world.setKinematicTarget(actor, { position: { x: at.position.x, y: at.position.y + m.displacement.y, z: at.position.z }, rotation: m.rotation });
      world.step();
      return { grounded: m.grounded, y: world.readPose(actor).position.y, deckY: world.readPose(deck).position.y };
    };
    for (let i = 0; i < 60; i++) expect(tick(0.1).grounded).toBe(true); // 6 m/s up
    for (let i = 0; i < 60; i++) expect(tick(-0.1).grounded).toBe(true); // 6 m/s down
    const end = tick(0);
    // Standing height: the deck's top (centre + 0.25), the ball's radius, the skin.
    expect(Math.abs(end.y - (end.deckY + 0.25 + 0.5 + 0.01))).toBeLessThan(0.002);
  });
  it("lets the character walk on and off a kinematic support, and jump from it", () => {
    const world = space();
    const deck = world.addBody(KINEMATIC, box(4, 0.5, 4), pose(0, -0.25), 1);
    const actor = world.addBody(KINEMATIC, ball(0.5), pose(0, 0.51), 2);
    world.step();
    const move = (d: { x: number; y: number; z: number }) => {
      const m = world.moveCharacter!(actor, d, { snapToGround: 0.2, carry: true });
      const at = world.readPose(actor);
      world.setKinematicTarget(actor, { position: { x: at.position.x + m.displacement.x, y: at.position.y + m.displacement.y, z: at.position.z + m.displacement.z }, rotation: m.rotation });
      world.step();
      return m;
    };
    for (let i = 0; i < 30; i++) expect(move(v(0.05)).grounded).toBe(true); // along the deck
    expect(world.readPose(actor).position.x).toBeCloseTo(1.5, 3);
    expect(move(v(0, 0.3)).grounded).toBe(false); // a jump: asked to rise
    let airborne = 0;
    for (let i = 0; i < 40; i++) if (!move(v(0.05, -0.05)).grounded) airborne++; // walks off the +x edge and drops
    expect(airborne).toBeGreaterThan(0);
    expect(world.readPose(actor).position.x).toBeGreaterThan(2.5);
  });
  it("rests exactly offset above a kinematic support and slides on it (no stuck character)", () => {
    const world = space();
    world.addBody(KINEMATIC, box(12, 0.5, 12), pose(0, -0.25), 1);
    const actor = world.addBody(KINEMATIC, capsule(0.3, 1.8), pose(0, 0.9), 2); // 0.1 mm closer than the skin
    world.step();
    for (const d of [v(0.03), v(-0.03), v(0, 0, 0.03), v(0, 0, -0.03)]) {
      const m = world.moveCharacter!(actor, d, { snapToGround: 0.2, carry: true });
      expect(Math.hypot(m.displacement.x, m.displacement.z)).toBeGreaterThan(0.029);
    }
  });
  it("leaves the world untouched and its counts exact, and frees the cached controller with the world", () => {
    const { world, actor } = arena();
    const before = world.counts();
    const pose0 = world.readPose(actor);
    for (let i = 0; i < 200; i++) world.moveCharacter!(actor, v(0.01, -0.01, 0.01), { snapToGround: 0.2, stepHeight: 0.25 });
    expect(world.counts()).toEqual(before);
    expect(world.readPose(actor)).toEqual(pose0);
    world.removeBody(actor);
    expect(world.counts()).toEqual({ bodies: 1, colliders: 1 });
    world.dispose();
    expect(world.counts()).toEqual({ bodies: 0, colliders: 0 });
    expect(() => world.moveCharacter!(actor, v(), {})).toThrow(/disposed/);
  });
  it("validates its inputs", () => {
    const { world, actor } = arena();
    const dynamic = world.addBody({ kind: "dynamic", mass: 1, linearDamping: 0, angularDamping: 0 }, ball(0.3), pose(5, 5), 5);
    expect(() => world.moveCharacter!(dynamic, v(1), {})).toThrow(/kinematic/);
    expect(() => world.moveCharacter!(actor, v(NaN), {})).toThrow(RangeError);
    expect(() => world.moveCharacter!(actor, v(), { offset: 0 })).toThrow(RangeError);
    expect(() => world.moveCharacter!(actor, v(), { snapToGround: -1 })).toThrow(RangeError);
    expect(() => world.moveCharacter!(actor, v(), { stepHeight: -1 })).toThrow(RangeError);
    expect(() => world.moveCharacter!(actor, v(), { stepMinWidth: 0 })).toThrow(RangeError);
    expect(() => world.moveCharacter!(actor, v(), { maxSlope: -0.1 })).toThrow(/slope/);
    expect(() => world.moveCharacter!(actor, v(), { rotation: { x: 0, y: 0, z: 0, w: 0 } })).toThrow(RangeError);
    expect(() => world.moveCharacter!(actor, v(), { rotation: { x: NaN, y: 0, z: 0, w: 1 } })).toThrow(RangeError);
    expect(() => world.moveCharacter!(actor, v(), { exclude: 9999 as never })).toThrow(/unknown body handle/);
  });
  it("climbs a step by itself when the controller cannot (stair assist), but not one above stepHeight", () => {
    const world = space();
    world.addBody(STATIC, box(40, 1, 40), pose(0, -0.5), 1);
    world.addBody(STATIC, box(4, 0.3, 40), pose(4, 0.15), 2); // a 0.3 m step at x = 2 (a block from 2 to 6)
    const actor = world.addBody(KINEMATIC, capsule(0.3, 1.8), pose(1.69, 0.91), 3); // against the face, 0.01 m away
    world.step();
    const up = world.moveCharacter!(actor, v(0.03), { snapToGround: 0.2, stepHeight: 0.35, stepMinWidth: 0.1 });
    expect(up.displacement.y).toBeCloseTo(0.3, 2);
    expect(up.displacement.x).toBeGreaterThan(0.2); // the centre ends over the step
    expect(up.grounded).toBe(true);
    const blocked = world.moveCharacter!(actor, v(0.03), { snapToGround: 0.2, stepHeight: 0.25 });
    expect(blocked.displacement.y).toBeLessThan(0.1); // at most it rolls up the corner a little: no 0.3 m step
    expect(blocked.displacement.x).toBeLessThan(0.03);
    const off = world.moveCharacter!(actor, v(0.03), { snapToGround: 0.2, stepHeight: 0 });
    expect(off.displacement.y).toBeLessThan(0.1);
    expect(off.displacement.x).toBeLessThan(0.03);
  });
});
