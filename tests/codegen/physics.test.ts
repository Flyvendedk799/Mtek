// Execution test of the physics shapes in the generated program module (spec/physics.md sections
// 2 and 3, spec/runtime-abi.md sections 4.2 and 5.2, task M5-03, decision 0065): the `physics`
// fixture's manifest data and its handlers run against a fake context, with no browser. The
// stepping, the body handle and the events are the runtime's (M5-05).
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createFakeContext } from "./support/fake-ctx.js";
import { loadProgram, record } from "./support/programs.js";

type Fn = (...args: unknown[]) => unknown;

interface Handler {
  readonly key?: string;
  readonly owner: unknown;
  readonly fn: Fn;
}

interface ManifestEntity {
  readonly index: number;
  readonly symbol: string;
  readonly body: Readonly<Record<string, unknown>> | null;
  readonly collider: Readonly<Record<string, unknown>> | null;
}

interface PhysicsManifest {
  readonly subsystems: { readonly physics: boolean };
  readonly scene: {
    readonly fields: { readonly gravity: readonly number[] };
    readonly entities: readonly ManifestEntity[];
  };
}

const CRATE = "src/main.mtek::Crate";

async function physics(): Promise<{
  scene: Readonly<Record<string, unknown>>;
  manifest: PhysicsManifest;
  prefab: Readonly<Record<string, unknown>>;
  files: readonly string[];
}> {
  const program = await loadProgram("physics");
  const scenes = record(program.module["scenes"], "scenes");
  const prefabs = record(program.module["prefabs"], "prefabs");
  return {
    scene: record(scenes["Playground"], "scene"),
    manifest: program.manifest as unknown as PhysicsManifest,
    prefab: record(prefabs[CRATE], "Crate"),
    files: readdirSync(program.dir, { recursive: true }).map(String),
  };
}

function handlers(owner: Readonly<Record<string, unknown>>, event: string): Handler[] {
  const events = record(owner["events"], "events") as Record<string, Handler[]>;
  return events[event] ?? [];
}

describe("the manifest of the physics program", () => {
  it("is a physics program: the flag, the module and the gravity", async () => {
    const { manifest, files } = await physics();
    expect(manifest.subsystems.physics).toBe(true);
    expect(files.filter((f) => f.replaceAll("\\", "/").startsWith("physics/"))).toHaveLength(1);
    expect(manifest.scene.fields.gravity).toEqual([0, -4.5, 0]);
  });

  it("carries the body and the collider of every entity, with the defaults written out", async () => {
    const { manifest } = await physics();
    expect(manifest.scene.entities.map((e) => [e.symbol.split("::")[1], e.body, e.collider])).toEqual([
      [
        "Playground.Floor",
        { kind: "static" },
        { kind: "box", size: [30, 1, 30], sensor: false, friction: 0.8, restitution: 0 },
      ],
      [
        "Playground.Ball",
        { kind: "dynamic", mass: 2, linearDamping: 0, angularDamping: 0.3 },
        { kind: "sphere", radius: 0.5, sensor: false, friction: 0.5, restitution: 0.7 },
      ],
      [
        "Playground.Mover",
        { kind: "kinematic" },
        { kind: "box", size: [2, 1, 2], sensor: true, friction: 0.5, restitution: 0 },
      ],
      [
        "Playground.A",
        { kind: "dynamic", mass: 1.5, linearDamping: 0.05, angularDamping: 0.05 },
        { kind: "box", size: [1, 1, 1], sensor: false, friction: 0.6, restitution: 0.2 },
      ],
      [
        "Playground.B",
        { kind: "dynamic", mass: 1.5, linearDamping: 0.05, angularDamping: 0.05 },
        { kind: "box", size: [1, 1, 1], sensor: false, friction: 0.6, restitution: 0.2 },
      ],
    ]);
  });
});

describe("the handlers of the physics program", () => {
  it("lists the collision handlers by event, with the entity that owns each", async () => {
    const { scene, prefab } = await physics();
    expect(handlers(scene, "collision_enter").map((h) => h.owner)).toEqual([1, 3, 4]);
    expect(handlers(scene, "collision_exit").map((h) => h.owner)).toEqual([1]);
    expect(handlers(prefab, "collision_enter").map((h) => h.owner)).toEqual(["self"]);
    expect(handlers(prefab, "key_down").map((h) => [h.key, h.owner])).toEqual([["Space", "self"]]);
  });

  it("issues commands to the body of `self`, a named entity and an entity_ref", async () => {
    const { scene } = await physics();
    const made = createFakeContext(5);
    const ctx = { ...made.ctx, frame: { time: 0 } };
    const ref = Object.freeze({ slot: 7, gen: 2 });
    // `who.body.apply_force(..)` goes through the reference it was given.
    handlers(scene, "collision_enter")[0]?.fn(ctx, ctx.e[1], ref);
    // `self.body.set_linear_velocity(..)` is the record of the entity.
    handlers(scene, "collision_exit")[0]?.fn(ctx, ctx.e[1], ref);
    // `Ball.body.teleport(..)` and `A.body.teleport(..)` from the scene's handler name the entities.
    handlers(scene, "key_down")[0]?.fn(ctx, null);
    expect(made.bodyCalls).toEqual([
      { target: ref, method: "applyForce", args: [{ x: 0, y: 0, z: -1 }] },
      { target: 1, method: "setLinearVelocity", args: [{ x: 0, y: 0, z: 0 }] },
      {
        target: 1,
        method: "teleport",
        args: [{ x: -3, y: 4, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, false],
      },
      {
        target: 3,
        method: "teleport",
        args: [{ x: 0, y: 1.5, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, true],
      },
    ]);
  });

  it("a kinematic mover sets its target every fixed tick", async () => {
    const { scene } = await physics();
    const made = createFakeContext(5);
    const ctx = { ...made.ctx, frame: { time: 0 } };
    const fixed = scene["entityFixedUpdate"] as (Fn | null)[];
    expect(fixed.map((fn) => fn !== null)).toEqual([false, true, true, false, false]);
    fixed[2]?.(ctx, ctx.e[2], 1 / 60);
    expect(made.bodyCalls).toEqual([
      {
        target: 2,
        method: "setKinematicTarget",
        args: [{ x: 3, y: 0.5, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }],
      },
    ]);
  });

  it("reads the velocity of the body: the fastest speed seen is kept in the scene state", async () => {
    const { scene } = await physics();
    const made = createFakeContext(5);
    const ctx = { ...made.ctx, frame: { time: 0 } };
    ctx.s["fastest"] = 0;
    const fixed = scene["entityFixedUpdate"] as (Fn | null)[];
    made.velocities.set(1, { linear: { x: 3, y: 4, z: 0 }, angular: { x: 0, y: 0, z: 0 } });
    fixed[1]?.(ctx, ctx.e[1], 1 / 60);
    expect(ctx.s["fastest"]).toBe(5);
    made.velocities.set(1, { linear: { x: 1, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } });
    fixed[1]?.(ctx, ctx.e[1], 1 / 60);
    expect(ctx.s["fastest"]).toBe(5);
  });

  it("the Crate prefab's handlers use the record they are given and count their own bounces", async () => {
    const { prefab } = await physics();
    const made = createFakeContext(2);
    const ctx = { ...made.ctx, frame: { time: 0 } };
    const other = Object.freeze({ slot: 1, gen: 0 });
    const enter = handlers(prefab, "collision_enter")[0];
    Object.assign(ctx.e[1]?.state ?? {}, { bounces: 0 });
    enter?.fn(ctx, ctx.e[1], other);
    enter?.fn(ctx, ctx.e[1], other);
    expect(ctx.e[1]?.state["bounces"]).toBe(2);
    handlers(prefab, "key_down")[0]?.fn(ctx, ctx.e[1]);
    expect(made.bodyCalls.map((c) => [c.target, c.method, c.args])).toEqual([
      [other, "applyImpulse", [{ x: 0, y: 0.5, z: 0 }]],
      [other, "applyImpulse", [{ x: 0, y: 0.5, z: 0 }]],
      [1, "applyImpulse", [{ x: 0, y: 5, z: 0 }]],
    ]);
  });
});
