/**
 * The host's physics API (decision 0217): `app.physics` and `ExtensionContext.physics`. Ray and shape casts,
 * contacts and collision groups take and return entity IDs (the opaque IDs of `inspectScene` and `readTransforms`),
 * never adapter handles; inputs are validated; a method the adapter lacks throws `MtekPhysicsUnsupportedError`;
 * queries read the world as of the last completed tick and never step or move anything.
 */
import { describe, expect, it } from "vitest";
import { MANIFEST_URL } from "../test-support/fake-host.js";
import { IDENTITY, vec } from "../test-support/fake-physics.js";
import {
  BALL,
  CRATE,
  FLOOR,
  MOVER,
  STEP,
  mountPhysics,
  physicsManifestJson,
  physicsProgram,
  type MountedPhysics,
} from "../test-support/physics-fixture.js";
import type { EntityRef } from "../scene/slots.js";
import type { ExtensionContext } from "./extensions.js";
import { MtekPhysicsUnsupportedError, type MtekPhysics } from "./physics-api.js";
import type { PhysicsContact, PhysicsQueryFilter, PhysicsWorld, RayHit, ShapeHit } from "../physics/types.js";

interface Mounted extends MountedPhysics {
  readonly context: ExtensionContext;
  readonly physics: MtekPhysics;
  /** The ID of a named entity as `readTransforms` reports it. */
  id(name: string): string;
}

async function mount(options: Parameters<typeof mountPhysics>[0] = {}): Promise<Mounted> {
  let context: ExtensionContext | undefined;
  const m = await mountPhysics(options, { mount: { extensions: [{ id: "physics-host", apiVersion: 1, setup: (c) => { context = c; } }] } });
  if (context === undefined) throw new Error("the extension was not set up");
  const ctx = context;
  const physics = m.app.physics;
  if (physics === undefined) throw new Error("no physics");
  return Object.assign(m, {
    context: ctx,
    physics,
    id: (name: string) => {
      const found = ctx.readTransforms().find((entity) => entity.name === name);
      if (found === undefined) throw new Error(`no entity ${name}`);
      return found.id;
    },
  });
}

const world = (m: MountedPhysics): PhysicsWorld => m.world;

describe("availability", () => {
  it("is undefined for a program without physics, in the app and in the extension context", async () => {
    let context: ExtensionContext | undefined;
    const m = await mountPhysics({}, { physics: false, mount: { extensions: [{ id: "x", apiVersion: 1, setup: (c) => { context = c; } }] } });
    expect(m.app.physics).toBeUndefined();
    expect(context?.physics).toBeUndefined();
    m.app.dispose();
  });

  it("is one object with the four methods, the same for the app and for extensions", async () => {
    const m = await mount();
    expect(m.context.physics).toBe(m.app.physics);
    expect(Object.keys(m.physics).sort()).toEqual(["castRay", "castShape", "contacts", "setCollisionGroups"]);
    m.app.dispose();
  });

  it("stops working with the app", async () => {
    const m = await mount();
    const physics = m.physics;
    m.app.dispose();
    expect(() => physics.castRay(vec(0, 0, 0), vec(0, -1, 0), 10)).toThrow(/disposed/);
  });
});

describe("castRay", () => {
  it("returns the entity ID of the nearest hit, copies, and no adapter handle or slot", async () => {
    const m = await mount();
    const seen: unknown[][] = [];
    const hit: RayHit = { userId: BALL, distance: 2.5, point: vec(0, 1.5, 0), normal: vec(0, 1, 0) };
    world(m).castRay = (...args) => { seen.push(args); return hit; };
    const result = m.physics.castRay(vec(0, 4, 0), vec(0, -2, 0), 10);
    expect(result).toEqual({ entityId: m.id("Ball"), distance: 2.5, point: vec(0, 1.5, 0), normal: vec(0, 1, 0) });
    expect(Object.keys(result ?? {}).sort()).toEqual(["distance", "entityId", "normal", "point"]);
    expect(seen).toEqual([[vec(0, 4, 0), vec(0, -2, 0), 10, {}]]);
    // Fresh copies: changing the answer does not change the adapter's.
    Object.assign(result?.point ?? {}, { x: 99 });
    expect(hit.point.x).toBe(0);
    m.app.dispose();
  });

  it("returns undefined for a miss", async () => {
    const m = await mount();
    world(m).castRay = () => undefined;
    expect(m.physics.castRay(vec(0, 4, 0), vec(0, -1, 0), 10)).toBeUndefined();
    m.app.dispose();
  });

  it("translates the options: packed groups, sensors, and an excluded entity to its body", async () => {
    const m = await mount();
    const filters: (PhysicsQueryFilter | undefined)[] = [];
    world(m).castRay = (_o, _d, _max, filter) => { filters.push(filter); return undefined; };
    m.physics.castRay(vec(0, 0, 0), vec(1, 0, 0), 5, { groups: { memberships: 0x0002, filter: 0xff01 }, includeSensors: true, exclude: m.id("Ball") });
    expect(filters[0]).toEqual({ groups: ((0x0002 << 16) | 0xff01) >>> 0, includeSensors: true, exclude: m.world.body(BALL).handle });
    m.physics.castRay(vec(0, 0, 0), vec(1, 0, 0), 5, { groups: { memberships: 0xffff, filter: 0xffff } });
    expect(filters[1]).toEqual({ groups: 0xffffffff });
    m.app.dispose();
  });

  it("rejects a bad origin, direction, distance or option before asking the adapter", async () => {
    const m = await mount();
    let calls = 0;
    world(m).castRay = () => { calls += 1; return undefined; };
    const ray = (...args: Parameters<MtekPhysics["castRay"]>): unknown => () => m.physics.castRay(...args);
    expect(ray(vec(Number.NaN, 0, 0), vec(0, -1, 0), 1)).toThrow(RangeError);
    expect(ray(vec(0, 0, 0), vec(0, 0, 0), 1)).toThrow(RangeError);
    expect(ray(vec(0, 0, 0), vec(0, -1, Number.POSITIVE_INFINITY), 1)).toThrow(RangeError);
    expect(ray(vec(0, 0, 0), vec(0, -1, 0), 0)).toThrow(RangeError);
    expect(ray(vec(0, 0, 0), vec(0, -1, 0), Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(ray(vec(0, 0, 0), vec(0, -1, 0), -2)).toThrow(RangeError);
    expect(ray({ x: 0, y: 0 } as never, vec(0, -1, 0), 1)).toThrow(TypeError);
    expect(ray(vec(0, 0, 0), vec(0, -1, 0), "1" as never)).toThrow(TypeError);
    expect(ray(vec(0, 0, 0), vec(0, -1, 0), 1, { groups: { memberships: 0x10000, filter: 1 } })).toThrow(RangeError);
    expect(ray(vec(0, 0, 0), vec(0, -1, 0), 1, { groups: { memberships: 1, filter: 1.5 } })).toThrow(RangeError);
    expect(ray(vec(0, 0, 0), vec(0, -1, 0), 1, { includeSensors: 1 as never })).toThrow(TypeError);
    expect(ray(vec(0, 0, 0), vec(0, -1, 0), 1, { exclude: "scene:1:nobody" })).toThrow(RangeError);
    expect(ray(vec(0, 0, 0), vec(0, -1, 0), 1, { exclude: m.id("Ghost") })).toThrow(/no active physics body/);
    expect(calls).toBe(0);
    m.app.dispose();
  });
});

describe("castShape", () => {
  it("sweeps each kind of shape, with the identity rotation by default, and returns the entity ID", async () => {
    const m = await mount();
    const seen: unknown[][] = [];
    const hit: ShapeHit = { userId: MOVER, fraction: 0.25, normal: vec(-1, 0, 0), point: vec(2, 0, 0) };
    world(m).castShape = (...args) => { seen.push(args); return hit; };
    const sphere = m.physics.castShape({ kind: "sphere", radius: 0.5 }, { position: vec(0, 1, 0) }, vec(4, 0, 0));
    expect(sphere).toEqual({ entityId: m.id("Mover"), fraction: 0.25, point: vec(2, 0, 0), normal: vec(-1, 0, 0) });
    const rotated = { x: 0, y: 2, z: 0, w: 0 };
    m.physics.castShape({ kind: "box", size: vec(1, 2, 3) }, { position: vec(0, 1, 0), rotation: rotated }, vec(0, 0, 4), { includeSensors: true });
    m.physics.castShape({ kind: "capsule", radius: 0.4, height: 1.8 }, { position: vec(0, 1, 0) }, vec(0, -1, 0));
    expect(seen[0]).toEqual([{ kind: "sphere", radius: 0.5 }, { position: vec(0, 1, 0), rotation: IDENTITY }, vec(4, 0, 0), {}]);
    // A rotation is normalised on the way in.
    expect(seen[1]).toEqual([{ kind: "box", size: vec(1, 2, 3) }, { position: vec(0, 1, 0), rotation: { x: 0, y: 1, z: 0, w: 0 } }, vec(0, 0, 4), { includeSensors: true }]);
    expect(seen[2]).toEqual([{ kind: "capsule", radius: 0.4, height: 1.8 }, { position: vec(0, 1, 0), rotation: IDENTITY }, vec(0, -1, 0), {}]);
    m.app.dispose();
  });

  it("rejects bad shapes, poses and displacements", async () => {
    const m = await mount();
    let calls = 0;
    world(m).castShape = () => { calls += 1; return undefined; };
    const pose = { position: vec(0, 0, 0) };
    const cast = (shape: unknown, p: unknown = pose, d: unknown = vec(1, 0, 0)): unknown => () => m.physics.castShape(shape as never, p as never, d as never);
    expect(cast({ kind: "sphere", radius: 0 })).toThrow(RangeError);
    expect(cast({ kind: "sphere", radius: Number.NaN })).toThrow(RangeError);
    expect(cast({ kind: "sphere" })).toThrow(TypeError);
    expect(cast({ kind: "box", size: vec(1, 0, 1) })).toThrow(RangeError);
    expect(cast({ kind: "box", size: 1 })).toThrow(TypeError);
    expect(cast({ kind: "capsule", radius: 0.5, height: 1 })).toThrow(/twice/);
    expect(cast({ kind: "capsule", radius: 0.5, height: 0.9 })).toThrow(RangeError);
    expect(cast({ kind: "cone" })).toThrow(TypeError);
    expect(cast(null)).toThrow(TypeError);
    expect(cast({ kind: "sphere", radius: 1 }, { position: vec(Number.NaN, 0, 0) })).toThrow(RangeError);
    expect(cast({ kind: "sphere", radius: 1 }, {})).toThrow(TypeError);
    expect(cast({ kind: "sphere", radius: 1 }, { position: vec(0, 0, 0), rotation: { x: 0, y: 0, z: 0, w: 0 } })).toThrow(RangeError);
    expect(cast({ kind: "sphere", radius: 1 }, pose, vec(0, Number.POSITIVE_INFINITY, 0))).toThrow(RangeError);
    expect(calls).toBe(0);
    m.app.dispose();
  });
});

describe("contacts", () => {
  it("reports the contacts of an entity's body with the other entity's ID, or null for one that is gone", async () => {
    const m = await mount();
    const contacts: PhysicsContact[] = [
      { userId: FLOOR, point: vec(0, 0, 0), normal: vec(0, 1, 0), distance: -0.01 },
      { userId: 77, point: vec(1, 0, 0), normal: vec(1, 0, 0), distance: 0 },
    ];
    world(m).contacts = (handle) => (handle === m.world.body(BALL).handle ? contacts : []);
    const result = m.physics.contacts(m.id("Ball"));
    expect(result).toEqual([
      { entityId: m.id("Floor"), point: vec(0, 0, 0), normal: vec(0, 1, 0), distance: -0.01 },
      { entityId: null, point: vec(1, 0, 0), normal: vec(1, 0, 0), distance: 0 },
    ]);
    Object.assign(result[0]?.point ?? {}, { x: 5 });
    expect(contacts[0]?.point.x).toBe(0);
    expect(m.physics.contacts(m.id("Mover"))).toEqual([]);
    m.app.dispose();
  });

  it("works for spawned entities with the ID inspection gives them", async () => {
    const m = await mount({ keys: { KeyQ: (ctx) => void ctx.spawn(CRATE, { n: 1 }, 0) } });
    m.debug.pressKey("KeyQ");
    m.debug.step(1, STEP);
    m.debug.releaseKey("KeyQ");
    const spawned = m.context.readTransforms().find((entity) => entity.id.includes(":spawn:"));
    expect(spawned).toBeDefined();
    world(m).contacts = () => [{ userId: BALL, point: vec(0, 0, 0), normal: vec(0, 1, 0), distance: 0 }];
    expect(m.physics.contacts(spawned?.id ?? "")[0]?.entityId).toBe(m.id("Ball"));
    // The body is the spawned one's, and the ID of a spawned hit is the same ID.
    world(m).castRay = () => ({ userId: m.world.body(5).userId, distance: 1, point: vec(0, 0, 0), normal: vec(0, 1, 0) });
    expect(m.physics.castRay(vec(0, 5, 0), vec(0, -1, 0), 9)?.entityId).toBe(spawned?.id);
    m.app.dispose();
  });

  it("rejects an unknown or stale ID and an entity without a body", async () => {
    const m = await mount();
    world(m).contacts = () => [];
    expect(() => m.physics.contacts("scene:1:nobody")).toThrow(RangeError);
    expect(() => m.physics.contacts(7 as never)).toThrow(TypeError);
    expect(() => m.physics.contacts(m.id("Ghost"))).toThrow(/no active physics body/);
    m.app.dispose();
  });
});

describe("setCollisionGroups", () => {
  it("sets the groups of the entity's body, immediately, with the masks as given", async () => {
    const m = await mount();
    const calls: unknown[][] = [];
    world(m).setCollisionGroups = (...args) => { calls.push(args); };
    m.physics.setCollisionGroups(m.id("Ball"), 0x0001, 0xfffe);
    expect(calls).toEqual([[m.world.body(BALL).handle, 0x0001, 0xfffe]]);
    expect(m.debug.counters()["physicsSteps"]).toBe(0);
    m.app.dispose();
  });

  it("rejects masks outside 0 to 65535, fractions, unknown IDs and bodiless entities", async () => {
    const m = await mount();
    let calls = 0;
    world(m).setCollisionGroups = () => { calls += 1; };
    const ball = m.id("Ball");
    expect(() => m.physics.setCollisionGroups(ball, -1, 1)).toThrow(RangeError);
    expect(() => m.physics.setCollisionGroups(ball, 1, 65536)).toThrow(RangeError);
    expect(() => m.physics.setCollisionGroups(ball, 0.5, 1)).toThrow(RangeError);
    expect(() => m.physics.setCollisionGroups(ball, Number.NaN, 1)).toThrow(RangeError);
    expect(() => m.physics.setCollisionGroups(ball, "1" as never, 1)).toThrow(TypeError);
    expect(() => m.physics.setCollisionGroups("scene:1:nobody", 1, 1)).toThrow(RangeError);
    expect(() => m.physics.setCollisionGroups(m.id("Ghost"), 1, 1)).toThrow(RangeError);
    expect(calls).toBe(0);
    m.app.dispose();
  });
});

describe("an adapter without the method", () => {
  it("throws MtekPhysicsUnsupportedError naming the method and the adapter, for each of the four", async () => {
    const m = await mount();
    const ball = m.id("Ball");
    // The fake world has none of the queries until a test installs one.
    const calls: [string, () => unknown][] = [
      ["castRay", () => m.physics.castRay(vec(0, 0, 0), vec(0, -1, 0), 1)],
      ["castShape", () => m.physics.castShape({ kind: "sphere", radius: 1 }, { position: vec(0, 0, 0) }, vec(1, 0, 0))],
      ["contacts", () => m.physics.contacts(ball)],
      ["setCollisionGroups", () => { m.physics.setCollisionGroups(ball, 1, 1); }],
    ];
    for (const [method, call] of calls) {
      let caught: unknown;
      try { call(); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(MtekPhysicsUnsupportedError);
      expect(caught).toMatchObject({ method, adapter: "fake-physics@0" });
      expect((caught as Error).message).toBe(`The physics adapter 'fake-physics@0' does not support ${method}.`);
    }
    m.app.dispose();
  });
});

let spawnedId = "";

describe("what a query sees", () => {
  it("is the adapter's world as of the last completed tick: a query never steps or queues anything", async () => {
    const m = await mount();
    world(m).castRay = () => undefined;
    m.debug.step(2, STEP);
    const before = m.debug.counters()["physicsSteps"];
    const log = m.log.length;
    m.physics.castRay(vec(0, 0, 0), vec(0, -1, 0), 3);
    m.physics.castRay(vec(0, 0, 0), vec(0, -1, 0), 3);
    expect(m.debug.counters()["physicsSteps"]).toBe(before);
    expect(m.log.length).toBe(log);
    expect(m.app.state).toBe("running");
    m.app.dispose();
  });

  it("follows a hot reload: the same object answers from the new world", async () => {
    const m = await mount();
    const physics = m.physics;
    const oldBall = m.id("Ball");
    expect(oldBall.startsWith("scene:1:")).toBe(true);
    const hooks = {};
    const json = physicsManifestJson(hooks);
    m.host.files.set(MANIFEST_URL, JSON.stringify(json));
    expect(await m.app.replaceProgram?.(physicsProgram(hooks, json))).toEqual({ ok: true });
    m.debug.step(1, STEP / 4);
    expect(m.backend.worlds).toHaveLength(2);
    world(m).castRay = () => ({ userId: MOVER, distance: 1, point: vec(0, 0, 0), normal: vec(0, 1, 0) });
    expect(m.app.physics).toBe(physics);
    const ids = m.context.readTransforms();
    expect(physics.castRay(vec(0, 5, 0), vec(0, -1, 0), 9)?.entityId).toBe(ids.find((entity) => entity.name === "Mover")?.id);
    // The IDs of the new scene differ from the old one's.
    expect(ids.every((entity) => entity.id.startsWith("scene:2:"))).toBe(true);
    world(m).contacts = () => [];
    expect(() => physics.contacts(oldBall)).toThrow(RangeError);
    m.app.dispose();
  });

  it("an entity pending removal can still be hit and has an ID, but cannot be named as an argument", async () => {
    let ref: EntityRef | undefined;
    let during: { hit: string | undefined; named: unknown } | undefined;
    let host: Mounted | undefined;
    const m = await mount({
      keys: {
        KeyQ: (ctx) => { ref = ctx.spawn(CRATE, { n: 1 }, 0); },
        KeyW: (ctx) => {
          if (ref === undefined || host === undefined) throw new Error("not ready");
          ctx.destroy(ref, 0);
          const slot = ref.slot;
          world(host).castRay = () => ({ userId: slot, distance: 1, point: vec(0, 0, 0), normal: vec(0, 1, 0) });
          world(host).contacts = () => [];
          let named: unknown = "not thrown";
          try { host.physics.contacts(spawnedId); } catch (error) { named = error; }
          during = { hit: host.physics.castRay(vec(0, 5, 0), vec(0, -1, 0), 9)?.entityId, named };
        },
      },
    });
    host = m;
    m.debug.pressKey("KeyQ");
    m.debug.step(1, STEP);
    m.debug.releaseKey("KeyQ");
    const spawned = m.context.readTransforms().find((entity) => entity.id.includes(":spawn:"));
    if (spawned === undefined) throw new Error("no crate");
    spawnedId = spawned.id;
    m.debug.pressKey("KeyW");
    m.debug.step(1, STEP);
    m.debug.releaseKey("KeyW");
    expect(during?.hit).toBe(spawned.id);
    expect(during?.named).toBeInstanceOf(RangeError);
    m.app.dispose();
  });
});
