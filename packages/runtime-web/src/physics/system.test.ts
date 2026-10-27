/**
 * The physics subsystem against a recording fake backend (decision 0066, `spec/physics.md` sections 3, 4 and 6): the
 * order of a tick, the command categories, pose write-back, velocities, the order and safety of collision
 * delivery, spawned bodies, and the run-time diagnostics `E8101` (kind), `E8103` (solver pose) and `E8104`
 * (non-finite value). The real engine is not involved here; `tests/browser/specs/m5/physics.spec.ts` runs it.
 */
import { describe, expect, it } from "vitest";
import { MtekMountError } from "../diagnostics/types.js";
import { FakePhysicsBackend, IDENTITY, ORIGIN, vec } from "../test-support/fake-physics.js";
import {
  BALL,
  CRATE,
  FLOOR,
  GHOST,
  MOVER,
  PHYSICS_URL,
  SENSOR,
  STEP,
  mountPhysics,
  physicsManifestJson,
  ticks,
  type Ctx,
  type Hooks,
  type MountedPhysics,
  type Self,
} from "../test-support/physics-fixture.js";
import type { EntityRef } from "../scene/slots.js";
import type { ExtensionContext } from "../host/extensions.js";
import type { PhysicsWorld } from "./types.js";

const codes = (m: MountedPhysics): string[] => m.reported.map((d) => d.code);

/** Presses `code` for one frame of one tick. */
function press(m: MountedPhysics, code: string): string[] {
  m.log.length = 0;
  m.debug.pressKey(code);
  m.debug.step(1, STEP);
  m.debug.releaseKey(code);
  return [...m.log];
}

function position(m: MountedPhysics, name: string): unknown {
  return m.debug.scene().entities.find((entity) => entity.name === name)?.position;
}

describe("mounting", () => {
  it("inspects actual collider poses and optional contacts through copied opaque IDs", async () => {
    let context: ExtensionContext | undefined;
    const m = await mountPhysics({}, {mount:{extensions:[{id:"inspect-physics",apiVersion:1,setup(c){context=c;}}]}});
    const entities = context!.readTransforms(), ballId = entities.find(e=>e.name==="Ball")!.id, moverId = entities.find(e=>e.name==="Mover")!.id;
    context!.writeTransforms([{id:ballId,scale:vec(9,9,9)}]); m.debug.step(1,0);
    expect(context!.inspectScene!()!.bodies.find(b=>b.entityId===ballId)!.contacts).toBeUndefined();
    const contact = {userId:2,point:vec(1,2,3),normal:vec(0,1,0),distance:-.02};
    (m.world as PhysicsWorld).contacts = () => [contact];
    m.world.body(BALL).pose = {position:vec(4,5,6),rotation:IDENTITY};
    const before = m.debug.counters()["physicsSteps"], info = context!.inspectScene!()!, ball = info.bodies.find(b=>b.entityId===ballId)!;
    expect(ball.collider.shape).toEqual({kind:"sphere",radius:.5}); expect(ball.position).toEqual(vec(4,5,6));
    expect(ball.contacts![0]!.otherId).toBe(moverId); expect(m.debug.counters()["physicsSteps"]).toBe(before);
    Object.assign(ball.position,{x:99}); Object.assign(ball.contacts![0]!.point,{x:99});
    expect(m.world.body(BALL).pose.position.x).toBe(4); expect(contact.point.x).toBe(1);
    m.app.dispose(); expect(() => context!.inspectScene!()).toThrow(/disposed/);
  });
  it("imports the physics module exactly once, from the URL the manifest names", async () => {
    const m = await mountPhysics();
    expect(m.host.imported).toEqual([PHYSICS_URL]);
    m.app.dispose();
  });

  it("a program without bodies never requests the module (spec/physics.md section 1)", async () => {
    const m = await mountPhysics({}, { physics: false });
    expect(m.host.imported).toEqual([]);
    expect(m.host.fetched.filter((url) => url.includes("physics/"))).toEqual([]);
    expect(m.backend.worlds).toEqual([]);
    expect(m.debug.counters()).toMatchObject({ physicsBodies: 0, physicsColliders: 0, physicsSteps: 0 });
    m.debug.step(3, STEP);
    expect(m.debug.counters()["physicsSteps"]).toBe(0);
    m.app.dispose();
  });

  it("creates the world with the scene's gravity and the manifest's fixed step, then the bodies in entity order after init", async () => {
    const m = await mountPhysics({ positions: { [BALL]: vec(0, 4, 0), [MOVER]: vec(3, 0.5, 0) } });
    expect(m.log).toEqual([
      "createWorld:0,-9.81,0:0.016666668",
      "addBody:0:static:0,0,0",
      "addBody:1:dynamic:0,4,0",
      "addBody:2:kinematic:3,0.5,0",
      "addBody:4:static:0,0,0",
    ]);
    expect(m.debug.counters()).toMatchObject({ physicsBodies: 4, physicsColliders: 4, physicsSteps: 0 });
    m.app.dispose();
  });

  it("passes the manifest's descriptors on: masses, damping, full-extent boxes, sensors, friction and restitution", async () => {
    const m = await mountPhysics();
    const { world } = m;
    expect(world.body(BALL).desc).toEqual({ kind: "dynamic", mass: 2, linearDamping: 0, angularDamping: 0.3 });
    expect(world.body(BALL).collider).toEqual({ shape: { kind: "sphere", radius: 0.5 }, sensor: false, friction: 0.5, restitution: 0.7 });
    expect(world.body(FLOOR).collider).toEqual({ shape: { kind: "box", size: vec(30, 1, 30) }, sensor: false, friction: 0.8, restitution: 0 });
    expect(world.body(SENSOR).collider.sensor).toBe(true);
    expect(world.body(MOVER).desc).toEqual({ kind: "kinematic" });
    expect(world.has(GHOST)).toBe(false);
    m.app.dispose();
  });
});

describe("the order of a tick (spec/physics.md section 4)", () => {
  it("applies the commands by category, then in issue order, before fixed_update and the step", async () => {
    const log: string[] = [];
    const m = await mountPhysics(
      {
        keys: {
          KeyQ: (ctx) => {
            const ball = ctx.e[BALL];
            const mover = ctx.e[MOVER];
            if (ball === undefined || mover === undefined) throw new Error("no entities");
            ctx.body(ball, 0).applyForce(vec(0, 0, 1));
            ctx.body(ball, 0).applyImpulse(vec(1, 0, 0));
            ctx.body(mover, 0).setKinematicTarget(vec(5, 0, 0), IDENTITY);
            ctx.body(ball, 0).setLinearVelocity(vec(0, 2, 0));
            ctx.body(ball, 0).teleport(vec(0, 9, 0), IDENTITY, false);
            ctx.body(ball, 0).applyImpulse(vec(2, 0, 0));
            ctx.body(mover, 0).teleport(vec(4, 0, 0), IDENTITY, true);
            ctx.body(ball, 0).applyForce(vec(0, 0, 2));
          },
        },
        fixedUpdate: () => log.push("fixed_update"),
      },
      { log },
    );
    expect(press(m, "KeyQ")).toEqual([
      // teleports, in issue order
      "teleport:1:0,9,0:reset",
      "teleport:2:4,0,0:keep",
      // linear velocities, kinematic targets, impulses, forces
      "linvel:1:0,2,0",
      "kinematic:2:5,0,0",
      "impulse:1:1,0,0",
      "impulse:1:2,0,0",
      "force:1:0,0,1",
      "force:1:0,0,2",
      "fixed_update",
      "step",
      // the poses of the dynamic and the kinematic body, nothing for the static ones
      "readPose:1",
      "readPose:2",
      "drain",
    ]);
    expect(m.reported).toEqual([]);
    m.app.dispose();
  });

  it("applies each command once: the next tick starts with an empty queue", async () => {
    const m = await mountPhysics({
      keys: { KeyQ: (ctx) => ctx.body(ctx.e[BALL] ?? {}, 0).applyImpulse(vec(1, 0, 0)) },
    });
    expect(press(m, "KeyQ").filter((line) => line.startsWith("impulse"))).toEqual(["impulse:1:1,0,0"]);
    expect(ticks(m, 3).filter((line) => line.startsWith("impulse"))).toEqual([]);
    m.app.dispose();
  });

  it("applies the commands of fixed_update and of collision handlers in the next tick", async () => {
    const log: string[] = [];
    let first = true;
    const m = await mountPhysics(
      {
        fixedUpdate: (ctx) => {
          log.push("fixed_update");
          ctx.body(ctx.e[BALL] ?? {}, 0).applyImpulse(vec(1, 0, 0));
        },
        enter: { [BALL]: (ctx, self) => ctx.body(self, 0).applyForce(vec(0, 7, 0)) },
      },
      { log },
    );
    m.world.onStep = (world) => {
      if (first) world.collisions.push([BALL, SENSOR, true]);
      first = false;
    };
    // Tick 1: nothing waits; fixed_update queues an impulse, the handler (after the step) a force.
    expect(ticks(m)).toEqual(["fixed_update", "step", "readPose:1", "readPose:2", "drain"]);
    // Tick 2: both are applied first (impulse category before force category), then fixed_update queues again.
    expect(ticks(m)).toEqual(["impulse:1:1,0,0", "force:1:0,7,0", "fixed_update", "step", "readPose:1", "readPose:2", "drain"]);
    m.app.dispose();
  });

  it("runs the commands of phase 1 and of update in the next tick too, however many frames come first", async () => {
    const m = await mountPhysics({
      update: (ctx) => ctx.body(ctx.e[BALL] ?? {}, 0).applyForce(vec(0, 1, 0)),
    });
    // No tick happens in a frame shorter than the step; `update` still runs and queues its force each frame.
    m.log.length = 0;
    m.debug.step(2, STEP / 4);
    expect(m.log).toEqual([]);
    expect(m.debug.counters()["physicsSteps"]).toBe(0);
    // The first tick applies both forces (each command is applied once, so they add up: documented, decision 0066).
    expect(ticks(m).filter((line) => line.startsWith("force"))).toEqual(["force:1:0,1,0", "force:1:0,1,0"]);
    m.app.dispose();
  });
});

describe("pose write-back and velocities", () => {
  it("writes the poses of dynamic and kinematic bodies into their entities and never reads a static body", async () => {
    const m = await mountPhysics({ positions: { [BALL]: vec(0, 4, 0), [FLOOR]: vec(0, -1, 0) } });
    m.world.onStep = (world) => {
      world.body(BALL).pose = { position: vec(0, 3.5, 0), rotation: { x: 0, y: 0.5, z: 0, w: 0.5 } };
      world.body(MOVER).pose = { position: vec(1, 0, 0), rotation: IDENTITY };
      // A static body's pose is fixed at creation: whatever the engine says is not read back.
      world.body(FLOOR).pose = { position: vec(9, 9, 9), rotation: IDENTITY };
    };
    expect(ticks(m)).not.toContain("readPose:0");
    expect(position(m, "Ball")).toEqual(vec(0, 3.5, 0));
    expect(position(m, "Mover")).toEqual(vec(1, 0, 0));
    expect(position(m, "Floor")).toEqual(vec(0, -1, 0));
    expect(m.debug.scene().entities.find((entity) => entity.name === "Ball")?.rotation).toEqual({ x: 0, y: 0.5, z: 0, w: 0.5 });
    expect(m.reported).toEqual([]);
    m.app.dispose();
  });

  it("reads velocities as of the last completed tick: zero before the first tick, never the ones a command is about to change", async () => {
    const reads: string[] = [];
    const m = await mountPhysics({
      fixedUpdate: (ctx) => {
        const h = ctx.body(ctx.e[BALL] ?? {}, 0);
        reads.push(`${String(h.linearVelocity.y)}/${String(h.angularVelocity.x)}`);
      },
      keys: { KeyQ: (ctx) => ctx.body(ctx.e[BALL] ?? {}, 0).setLinearVelocity(vec(0, 100, 0)) },
    });
    let tick = 0;
    m.world.onStep = (world) => {
      tick += 1;
      world.body(BALL).linear = vec(0, -tick, 0);
      world.body(BALL).angular = vec(tick, 0, 0);
    };
    ticks(m); // tick 1: reads zero, then the solver says -1
    ticks(m); // tick 2: reads -1 (not the 100 the next command will set), then -2
    press(m, "KeyQ"); // tick 3: the command applies first, fixed_update still reads the value of tick 2
    ticks(m);
    expect(reads).toEqual(["0/0", "-1/1", "-2/2", "-3/3"]);
    m.app.dispose();
  });

  it("gives frozen vectors (values are never mutated, spec/runtime-abi.md section 4.1)", async () => {
    const seen: unknown[] = [];
    const m = await mountPhysics({ fixedUpdate: (ctx) => seen.push(ctx.body(ctx.e[BALL] ?? {}, 0).linearVelocity) });
    m.world.onStep = (world) => {
      world.body(BALL).linear = vec(1, 2, 3);
    };
    ticks(m, 2);
    expect(seen).toEqual([vec(0, 0, 0), vec(1, 2, 3)]);
    expect(seen.every((value) => Object.isFrozen(value))).toBe(true);
    m.app.dispose();
  });
});

describe("collision events (spec/physics.md section 6)", () => {
  function recording(log: string[]): Hooks {
    const handler =
      (kind: string, name: string) =>
      (_ctx: Ctx, _self: object, other: EntityRef): void => {
        log.push(`${kind}:${name}:${String(other.slot)}`);
      };
    return {
      enter: { [FLOOR]: handler("enter", "0"), [BALL]: handler("enter", "1"), [MOVER]: handler("enter", "2"), [SENSOR]: handler("enter", "4") },
      exit: { [FLOOR]: handler("exit", "0"), [BALL]: handler("exit", "1"), [MOVER]: handler("exit", "2"), [SENSOR]: handler("exit", "4") },
    };
  }

  it("delivers enter events before exit events, each sorted by (lower slot, higher slot), the lower slot's handler first", async () => {
    const log: string[] = [];
    const m = await mountPhysics(recording(log), { log });
    m.world.onStep = (world) => {
      // The engine's own order is scrambled on purpose, with the slots both ways round.
      world.collisions.push([4, BALL, false], [MOVER, SENSOR, true], [SENSOR, BALL, true], [BALL, FLOOR, true], [FLOOR, MOVER, false]);
    };
    const events = ticks(m).filter((line) => /^(enter|exit):/.test(line));
    expect(events).toEqual([
      "enter:0:1", "enter:1:0", // pair (0, 1)
      "enter:1:4", "enter:4:1", // pair (1, 4)
      "enter:2:4", "enter:4:2", // pair (2, 4)
      "exit:0:2", "exit:2:0", // exits come last: pair (0, 2)
      "exit:1:4", "exit:4:1", // pair (1, 4)
    ]);
    m.app.dispose();
  });

  it("delivers an event only to an entity that declares a handler, with the other entity's reference", async () => {
    const seen: EntityRef[] = [];
    const m = await mountPhysics({ enter: { [BALL]: (_ctx, _self, other) => seen.push(other) } });
    m.world.onStep = (world) => {
      world.collisions.push([BALL, FLOOR, true]);
    };
    ticks(m);
    expect(seen).toEqual([{ slot: FLOOR, gen: 0 }]);
    m.app.dispose();
  });

  it("delivers after the step and the write-back, so a handler sees the new pose", async () => {
    const log: string[] = [];
    const m = await mountPhysics(
      {
        enter: {
          [BALL]: (ctx) => {
            const ball = ctx.e[BALL] as unknown as { position: { y: number } };
            log.push(`handler sees y=${String(ball.position.y)}`);
          },
        },
      },
      { log },
    );
    m.world.onStep = (world) => {
      world.body(BALL).pose = { position: vec(0, 1.25, 0), rotation: IDENTITY };
      world.collisions.push([BALL, FLOOR, true]);
    };
    expect(ticks(m)).toEqual(["step", "readPose:1", "readPose:2", "drain", "handler sees y=1.25"]);
    m.app.dispose();
  });

  it("an event is delivered once: the next tick's drain starts empty", async () => {
    const log: string[] = [];
    const m = await mountPhysics(recording(log), { log });
    m.world.collisions.push([BALL, FLOOR, true]);
    ticks(m);
    expect(ticks(m, 3).filter((line) => line.startsWith("enter"))).toEqual([]);
    m.app.dispose();
  });
});

describe("spawned bodies and callback safety", () => {
  const spawn = (ctx: Ctx, n: number): EntityRef => ctx.spawn(CRATE, { n }, 0);

  it("creates the body at the flush that creates the entity, from its pose after init, in time for that tick's step", async () => {
    const m = await mountPhysics({ keys: { KeyQ: (ctx) => void spawn(ctx, 3) }, cratePosition: (n) => vec(n, 2, 0) });
    expect(press(m, "KeyQ")).toEqual(["addBody:5:dynamic:3,2,0", "step", "readPose:1", "readPose:2", "readPose:5", "drain"]);
    expect(m.world.body(5).desc).toEqual({ kind: "dynamic", mass: 1, linearDamping: 0, angularDamping: 0 });
    expect(m.debug.counters()["physicsBodies"]).toBe(5);
    m.app.dispose();
  });

  it("a spawn from update is created at the end of that frame and first steps in the next one", async () => {
    let done = false;
    const m = await mountPhysics({
      update: (ctx) => {
        if (!done) spawn(ctx, 1);
        done = true;
      },
    });
    expect(ticks(m)).toEqual(["step", "readPose:1", "readPose:2", "drain", "addBody:5:dynamic:1,0,0"]);
    expect(ticks(m)).toEqual(["step", "readPose:1", "readPose:2", "readPose:5", "drain"]);
    m.app.dispose();
  });

  it("removes the body at the flush that removes the entity, after the handlers that destroyed it ran", async () => {
    const log: string[] = [];
    const m = await mountPhysics(
      {
        keys: {
          KeyQ: (ctx) => {
            spawn(ctx, 1);
            spawn(ctx, 2);
          },
        },
        // The Ball destroys whoever it touches, inside its own collision handler.
        enter: {
          [BALL]: (ctx, _self, other) => {
            log.push(`ball:enter:${String(other.slot)}`);
            ctx.destroy(other, 0);
          },
        },
        crateEnter: (_ctx, self) => log.push(`crate:enter:${String((self as Self).ref.slot)}`),
      },
      { log },
    );
    press(m, "KeyQ"); // crates 5 and 6 exist
    m.world.onStep = (world) => {
      world.collisions.push([5, 6, true], [BALL, 6, true], [BALL, 5, true]);
      world.onStep = undefined;
    };
    const run = ticks(m);
    // Sorted: (1, 5), (1, 6), (5, 6). The Ball's handler runs first in each pair and destroys the crate, so the
    // crate's own handler is skipped, and the pair of the two crates (both pending removal) is not delivered at all.
    expect(run.filter((line) => /^(ball|crate):/.test(line))).toEqual(["ball:enter:5", "ball:enter:6"]);
    // Nothing was removed while the events were being delivered: the bodies go at the flush after `update`.
    const lastHandler = run.lastIndexOf("ball:enter:6");
    expect(run.indexOf("removeBody:5")).toBeGreaterThan(lastHandler);
    expect(run.indexOf("removeBody:6")).toBeGreaterThan(run.indexOf("removeBody:5"));
    expect(m.world.has(5)).toBe(false);
    expect(m.debug.counters()).toMatchObject({ physicsBodies: 4, liveEntities: 5, pendingRemovals: 0 });
    expect(m.reported).toEqual([]);
    m.app.dispose();
  });

  it("an entity destroyed in the first handler receives nothing more, and neither does its partner", async () => {
    const log: string[] = [];
    const m = await mountPhysics(
      {
        keys: { KeyQ: (ctx) => void spawn(ctx, 1) },
        // The Floor (slot 0) is first in the pair (0, 5) and destroys itself... a named entity cannot be destroyed,
        // so it destroys the crate through `other`; the crate must then not be told about the contact.
        enter: { [FLOOR]: (ctx, _self, other) => { log.push("floor"); ctx.destroy(other, 0); } },
        crateEnter: () => log.push("crate"),
      },
      { log },
    );
    press(m, "KeyQ");
    m.world.collisions.push([5, FLOOR, true]);
    ticks(m);
    expect(log.filter((line) => line === "floor" || line === "crate")).toEqual(["floor"]);
    expect(codes(m)).toEqual([]);
    m.app.dispose();
  });

  it("drops the commands of an entity that was destroyed after issuing them, silently (they were valid when issued)", async () => {
    let ref: EntityRef | undefined;
    const m = await mountPhysics({
      keys: {
        KeyQ: (ctx) => {
          ref = spawn(ctx, 1);
        },
        KeyW: (ctx) => {
          if (ref === undefined) throw new Error("no crate");
          ctx.body(ref, 0).applyImpulse(vec(0, 1, 0));
          ctx.destroy(ref, 0);
        },
      },
    });
    press(m, "KeyQ");
    const run = press(m, "KeyW");
    expect(run).toContain("removeBody:5");
    expect(run.some((line) => line.startsWith("impulse"))).toBe(false);
    expect(m.reported).toEqual([]);
    m.app.dispose();
  });

  it("drops a command that is aimed at an entity once it is pending removal, with W8031", async () => {
    let ref: EntityRef | undefined;
    const m = await mountPhysics({
      keys: {
        KeyQ: (ctx) => {
          ref = spawn(ctx, 1);
        },
        KeyW: (ctx) => {
          if (ref === undefined) throw new Error("no crate");
          ctx.destroy(ref, 0);
          ctx.body(ref, 3).applyImpulse(vec(0, 1, 0));
        },
        KeyE: (ctx) => {
          // Not created yet: spawned in this handler.
          ctx.body(spawn(ctx, 9), 2).applyImpulse(vec(0, 1, 0));
          // Never valid: the reference `spawn` returns over the limit.
          ctx.body({ slot: -1, gen: 0 }, 1).applyForce(vec(0, 1, 0));
        },
      },
    });
    press(m, "KeyQ");
    expect(press(m, "KeyW").some((line) => line.startsWith("impulse"))).toBe(false);
    expect(codes(m)).toEqual(["MTEK-W8031"]);
    expect(m.reported[0]?.message).toContain("pending removal");
    expect(m.reported[0]?.source).toMatchObject({ file: "src/main.mtek" });
    m.reported.length = 0;
    press(m, "KeyE");
    expect(m.reported.map((d) => d.message)).toEqual([
      expect.stringContaining("not created yet"),
      expect.stringContaining("destroyed or dead"),
    ]);
    m.app.dispose();
  });

  it("a command issued for an entity whose slot was reused never reaches the new entity (generations)", async () => {
    let old: EntityRef | undefined;
    const m = await mountPhysics({
      keys: {
        KeyQ: (ctx) => {
          old = spawn(ctx, 1);
        },
        // Frame B: queue a command and destroy; no tick runs in this short frame, the flush after `update` removes it.
        KeyW: (ctx) => {
          if (old === undefined) throw new Error("no crate");
          ctx.body(old, 0).applyImpulse(vec(0, 1, 0));
          ctx.destroy(old, 0);
        },
        // Frame C: the freed slot (5) is reused with a new generation.
        KeyE: (ctx) => {
          spawn(ctx, 2);
        },
      },
    });
    press(m, "KeyQ");
    m.log.length = 0;
    m.debug.pressKey("KeyW");
    m.debug.step(1, STEP / 2);
    m.debug.releaseKey("KeyW");
    expect(m.log).toEqual(["removeBody:5"]);
    m.debug.pressKey("KeyE");
    m.debug.step(1, STEP / 2);
    m.debug.releaseKey("KeyE");
    expect(m.log).toEqual(["removeBody:5", "addBody:5:dynamic:2,0,0", "step", "readPose:1", "readPose:2", "readPose:5", "drain"]);
    expect(m.log.some((line) => line.startsWith("impulse"))).toBe(false);
    m.app.dispose();
  });
});

describe("E8101: a command or read the target's body kind does not support", () => {
  const spanSource = (m: MountedPhysics, index: number): unknown => m.reported[index]?.source;

  it("is reported at the span of the command and drops it: wrong kind, or no body", async () => {
    const m = await mountPhysics({
      keys: {
        KeyQ: (ctx) => {
          const floor = ctx.e[FLOOR]?.ref;
          const ball = ctx.e[BALL]?.ref;
          const ghost = ctx.e[GHOST]?.ref;
          if (floor === undefined || ball === undefined || ghost === undefined) throw new Error("no entities");
          ctx.body(floor, 3).applyImpulse(vec(0, 1, 0)); // a static body
          ctx.body(ball, 2).setKinematicTarget(vec(0, 0, 0), IDENTITY); // set_kinematic_target is for kinematic bodies
          ctx.body(ghost, 1).teleport(vec(0, 0, 0), IDENTITY, false); // no body at all
          ctx.body(ball, 0).applyImpulse(vec(0, 1, 0)); // fine
        },
      },
    });
    const run = press(m, "KeyQ");
    expect(codes(m)).toEqual(["MTEK-E8101", "MTEK-E8101", "MTEK-E8101"]);
    expect(m.reported.map((d) => d.message)).toEqual([
      expect.stringContaining("apply_impulse was dropped: 'Floor' has a static body"),
      expect.stringContaining("set_kinematic_target was dropped: 'Ball' has a dynamic body"),
      expect.stringContaining("teleport was dropped: 'Ghost' has no body"),
    ]);
    // Each points at the span the program passed: the manifest's span 3, 2 and 1.
    const spans = physicsManifestJson()["spans"] as { start: number }[];
    expect(m.reported.map((d) => d.source?.startByte)).toEqual([spans[3]?.start, spans[2]?.start, spans[1]?.start]);
    expect(spanSource(m, 0)).toMatchObject({ file: "src/main.mtek" });
    // Only the valid command reached the engine.
    expect(run.filter((line) => /^(impulse|kinematic|teleport)/.test(line))).toEqual(["impulse:1:0,1,0"]);
    m.app.dispose();
  });

  it("a read of a velocity the kind does not have gives zero and reports once per site", async () => {
    const seen: unknown[] = [];
    const m = await mountPhysics({
      fixedUpdate: (ctx) => {
        const floor = ctx.e[FLOOR]?.ref;
        const ghost = ctx.e[GHOST]?.ref;
        if (floor === undefined || ghost === undefined) throw new Error("no entities");
        seen.push(ctx.body(floor, 2).linearVelocity, ctx.body(ghost, 1).angularVelocity);
      },
    });
    ticks(m, 3);
    expect(seen).toHaveLength(6);
    expect(seen.every((v) => JSON.stringify(v) === JSON.stringify(ORIGIN))).toBe(true);
    expect(codes(m)).toEqual(["MTEK-E8101", "MTEK-E8101"]);
    m.app.dispose();
  });

  it("a record of a named entity with a supported command passes without any diagnostic", async () => {
    const m = await mountPhysics({
      keys: {
        KeyQ: (ctx) => {
          ctx.body(ctx.e[MOVER] ?? {}, 0).setKinematicTarget(vec(1, 0, 0), IDENTITY);
          ctx.body(ctx.e[MOVER] ?? {}, 0).teleport(vec(1, 0, 0), IDENTITY, true);
          ctx.body(ctx.e[BALL] ?? {}, 0).teleport(vec(1, 0, 0), IDENTITY, false);
        },
      },
    });
    press(m, "KeyQ");
    expect(m.reported).toEqual([]);
    m.app.dispose();
  });
});

describe("E8103: the solver produced a pose that is not finite", () => {
  it("freezes that body, reports once, and the loop and the other bodies go on", async () => {
    const m = await mountPhysics({ positions: { [BALL]: vec(0, 4, 0) } });
    let tick = 0;
    m.world.onStep = (world) => {
      tick += 1;
      world.body(MOVER).pose = { position: vec(tick, 0, 0), rotation: IDENTITY };
      // The engine no longer has the frozen body after tick 2.
      if (!world.has(BALL)) return;
      world.body(BALL).pose = { position: vec(tick >= 2 ? Number.NaN : 0, tick >= 2 ? 0 : 3, 0), rotation: IDENTITY };
    };
    ticks(m);
    expect(position(m, "Ball")).toEqual(vec(0, 3, 0));
    const second = ticks(m);
    // Taken out of the simulation at once; the mover is still read after it.
    expect(second).toEqual(["step", "readPose:1", "removeBody:1", "readPose:2", "drain"]);
    expect(codes(m)).toEqual(["MTEK-E8103"]);
    expect(m.reported[0]?.message).toContain("'Ball'");
    expect(m.reported[0]?.source).toMatchObject({ file: "src/main.mtek" });
    // The entity keeps its last finite pose; the mover moved on.
    expect(position(m, "Ball")).toEqual(vec(0, 3, 0));
    expect(position(m, "Mover")).toEqual(vec(2, 0, 0));
    expect(m.debug.counters()).toMatchObject({ physicsFrozenBodies: 1, physicsBodies: 3 });
    expect(ticks(m, 5).filter((line) => line.includes(":1"))).toEqual([]);
    expect(codes(m)).toEqual(["MTEK-E8103"]);
    expect(m.app.state).toBe("running");
    m.app.dispose();
  });

  it("drops the commands of a frozen body and reads zero velocities, without further diagnostics", async () => {
    const reads: number[] = [];
    const m = await mountPhysics({
      keys: { KeyQ: (ctx) => ctx.body(ctx.e[BALL] ?? {}, 0).applyImpulse(vec(0, 1, 0)) },
      fixedUpdate: (ctx) => reads.push(ctx.body(ctx.e[BALL] ?? {}, 0).linearVelocity.y),
    });
    m.world.onStep = (world) => {
      if (!world.has(BALL)) return;
      world.body(BALL).linear = vec(0, -3, 0);
      if (world.steps === 2) world.body(BALL).pose = { position: vec(0, Number.POSITIVE_INFINITY, 0), rotation: IDENTITY };
    };
    ticks(m, 2);
    const run = press(m, "KeyQ");
    expect(run.some((line) => line.startsWith("impulse"))).toBe(false);
    expect(reads).toEqual([0, -3, 0]);
    expect(codes(m)).toEqual(["MTEK-E8103"]);
    m.app.dispose();
  });

  it("a non-finite rotation freezes as well", async () => {
    const m = await mountPhysics();
    m.world.onStep = (world) => {
      world.body(MOVER).pose = { position: ORIGIN, rotation: { x: 0, y: 0, z: 0, w: Number.NaN } };
    };
    ticks(m);
    expect(codes(m)).toEqual(["MTEK-E8103"]);
    expect(m.world.has(MOVER)).toBe(false);
    m.app.dispose();
  });
});

describe("E8104: a value that is not finite is given to a body", () => {
  it("drops a command with a non-finite vector or a rotation of zero length", async () => {
    const m = await mountPhysics({
      keys: {
        KeyQ: (ctx) => {
          const ball = ctx.e[BALL];
          const mover = ctx.e[MOVER];
          if (ball === undefined || mover === undefined) throw new Error("no entities");
          ctx.body(ball, 0).applyImpulse(vec(Number.NaN, 0, 0));
          ctx.body(ball, 1).setLinearVelocity(vec(0, Number.POSITIVE_INFINITY, 0));
          ctx.body(mover, 2).setKinematicTarget(vec(0, 0, 0), { x: 0, y: 0, z: 0, w: 0 });
          ctx.body(ball, 3).teleport(vec(0, 1, 0), IDENTITY, false); // fine
        },
      },
    });
    const run = press(m, "KeyQ");
    expect(codes(m)).toEqual(["MTEK-E8104", "MTEK-E8104", "MTEK-E8104"]);
    expect(run.filter((line) => /^(impulse|linvel|kinematic|teleport)/.test(line))).toEqual(["teleport:1:0,1,0:reset"]);
    expect(m.app.state).toBe("running");
    m.app.dispose();
  });

  it("does not create a body whose initial pose is not finite, and its commands are dropped without a word", async () => {
    const m = await mountPhysics({
      positions: { [BALL]: vec(Number.NaN, 0, 0) },
      keys: { KeyQ: (ctx) => ctx.body(ctx.e[BALL] ?? {}, 0).applyImpulse(vec(0, 1, 0)) },
    });
    expect(m.world.has(BALL)).toBe(false);
    expect(m.world.has(FLOOR)).toBe(true);
    expect(codes(m)).toEqual(["MTEK-E8104"]);
    expect(m.reported[0]?.message).toContain("'Ball'");
    press(m, "KeyQ");
    ticks(m, 2);
    expect(codes(m)).toEqual(["MTEK-E8104"]);
    m.app.dispose();
  });
});

describe("the fixed-step accumulator and time", () => {
  it("steps once per fixed step of simulated time, whatever the frame length", async () => {
    const m = await mountPhysics();
    m.debug.step(1, STEP / 2);
    expect(m.debug.counters()["physicsSteps"]).toBe(0);
    m.debug.step(1, STEP / 2);
    expect(m.debug.counters()["physicsSteps"]).toBe(1);
    m.debug.step(1, 2 * STEP);
    expect(m.debug.counters()["physicsSteps"]).toBe(3);
    m.app.dispose();
  });

  it("steps at most maxCatchUpSteps per frame and counts the discarded backlog", async () => {
    const m = await mountPhysics();
    m.debug.step(1, 0.1); // 0.1 s is 5.99 steps: four are taken, one is dropped
    expect(m.debug.counters()).toMatchObject({ physicsSteps: 4, discardedSteps: 1 });
    m.app.dispose();
  });

  it("does not step while paused and does not simulate the paused interval after resume (manual clock)", async () => {
    const m = await mountPhysics();
    m.debug.step(2, STEP);
    expect(m.debug.counters()["physicsSteps"]).toBe(2);
    m.app.pause();
    m.debug.step(100, STEP);
    expect(m.debug.counters()["physicsSteps"]).toBe(2);
    m.app.resume();
    ticks(m);
    expect(m.debug.counters()["physicsSteps"]).toBe(3);
    m.app.dispose();
  });

  it("with the animation-frame clock, the hours spent paused are never stepped: the first frame after resume has delta 0", async () => {
    const m = await mountPhysics({}, { mount: { test: { renderTarget: { width: 16, height: 8 } } } });
    const steps = (): number | undefined => m.debug.counters()["physicsSteps"];
    for (const t of [0, 20, 40, 60]) m.host.tickFrames(t); // 60 ms of frames: three fixed steps
    expect(steps()).toBe(3);
    m.app.pause();
    m.host.tickFrames(3_600_000); // no frame is pending while paused
    expect(steps()).toBe(3);
    m.app.resume();
    m.host.tickFrames(3_600_020); // the first frame after resume: delta 0, nothing to step
    expect(steps()).toBe(3);
    m.host.tickFrames(3_600_040); // from here on time runs again: 20 ms, one step
    expect(steps()).toBe(4);
    m.app.dispose();
  });
});

describe("failure and lifetime", () => {
  it("a module that cannot be imported rejects the mount with physics-failed (E8102) and leaves nothing behind", async () => {
    const reported: string[] = [];
    const error = await mountPhysics({}, { serveModule: false, mount: { onDiagnostic: (d) => reported.push(d.code) } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MtekMountError);
    expect((error as MtekMountError).kind).toBe("physics-failed");
    expect((error as MtekMountError).diagnostics.map((d) => d.code)).toEqual(["MTEK-E8102"]);
    expect(reported).toEqual(["MTEK-E8102"]);
  });

  it("an engine that cannot start a world rejects the mount with physics-failed as well, and releases the GPU", async () => {
    const backend = new FakePhysicsBackend();
    backend.failCreateWorld = new Error("out of memory in the engine");
    const error = await mountPhysics({}, { backend }).catch((e: unknown) => e);
    expect((error as MtekMountError).kind).toBe("physics-failed");
    expect((error as MtekMountError).diagnostics[0]?.message).toContain("out of memory in the engine");
  });

  it("dispose frees the world and every body, and a second dispose is a no-op", async () => {
    const m = await mountPhysics();
    m.debug.step(2, STEP);
    expect(m.debug.counters()).toMatchObject({ physicsBodies: 4, physicsColliders: 4 });
    m.app.dispose();
    expect(m.world.disposed).toBe(true);
    expect(m.world.counts()).toEqual({ bodies: 0, colliders: 0 });
    expect(m.debug.counters()).toMatchObject({ physicsBodies: 0, physicsColliders: 0 });
    m.app.dispose();
    expect(m.log.filter((line) => line === "dispose")).toEqual(["dispose"]);
  });

  it("twenty mount and dispose cycles leave no world alive (spec/physics.md section 7)", async () => {
    const backend = new FakePhysicsBackend();
    for (let cycle = 0; cycle < 20; cycle += 1) {
      const m = await mountPhysics({ keys: { KeyQ: (ctx) => void ctx.spawn(CRATE, { n: 1 }, 0) } }, { backend });
      press(m, "KeyQ");
      m.app.dispose();
    }
    expect(backend.worlds).toHaveLength(20);
    expect(backend.worlds.every((world) => world.disposed && world.counts().bodies === 0)).toBe(true);
  });

  it("each mount makes its own world", async () => {
    const backend = new FakePhysicsBackend();
    const first = await mountPhysics({}, { backend });
    first.app.dispose();
    const second = await mountPhysics({}, { backend });
    expect(backend.worlds).toHaveLength(2);
    expect(backend.worlds[0]?.disposed).toBe(true);
    expect(backend.worlds[1]?.disposed).toBe(false);
    second.app.dispose();
  });
});
