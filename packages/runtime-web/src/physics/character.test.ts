/**
 * Character movement in the runtime (decisions 0214 and 0217, `spec/physics.md` sections 2 to 4): the manifest's
 * capsule, `continuous` and `character` data reach the adapter, the `characterMove` command category, the sum of
 * several moves, their replacement of a kinematic target, the teleport that comes first, the pose the move is
 * written back as, the reads `grounded` and `ground_normal`, and the diagnostics `E8101`, `E8103`, `E8104` and
 * `E8105`. The recording fake backend does no physics; its `moveCharacter` answers what each test scripts.
 */
import { describe, expect, it } from "vitest";
import { MANIFEST_URL } from "../test-support/fake-host.js";
import { IDENTITY, ORIGIN, vec } from "../test-support/fake-physics.js";
import {
  BALL,
  CRATE,
  GHOST,
  MOVER,
  STEP,
  mountPhysics,
  physicsManifestJson,
  physicsProgram,
  type Ctx,
  type Hooks,
  type MountedPhysics,
} from "../test-support/physics-fixture.js";
import type { EntityRef } from "../scene/slots.js";
import type { CharacterMovement, PhysicsWorld, Quat, Vec3 } from "./types.js";

type Manifest = Record<string, unknown>;
interface ManifestEntity {
  body: unknown;
  collider: unknown;
}

const CAPSULE = { kind: "capsule", radius: 0.4, height: 1.8, sensor: false, friction: 0.1, restitution: 0 };
const SETTINGS = { maxSlope: 0.6, stepHeight: 0.3, stepMinWidth: 0.12, snapToGround: 0.25, skin: 0.02, carry: false };
const DEFAULT_OPTIONS = { offset: 0.01, maxSlope: 0.7853982, snapToGround: 0.2, stepHeight: 0.25, stepMinWidth: 0.1, carry: true };
const UP: Vec3 = { x: 0, y: 1, z: 0 };
const YAW_90: Quat = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };

/** Makes the Mover a capsule character, with `character` settings when given, and the Ghost a second kinematic body. */
function characters(settings?: Record<string, unknown>): (manifest: Manifest) => void {
  return (manifest) => {
    const entities = (manifest["scene"] as { entities: ManifestEntity[] }).entities;
    const mover = entities[MOVER];
    const ghost = entities[GHOST];
    if (mover === undefined || ghost === undefined) throw new Error("no entities");
    mover.body = settings === undefined ? { kind: "kinematic" } : { kind: "kinematic", character: settings };
    mover.collider = CAPSULE;
    ghost.body = { kind: "kinematic" };
    ghost.collider = { kind: "box", size: [1, 1, 1], sensor: false, friction: 0.5, restitution: 0 };
  };
}

const codes = (m: MountedPhysics): string[] => m.reported.map((d) => d.code);

/** Runs `frames` ticks of one fixed step and returns what the log gained. */
function tick(m: MountedPhysics, frames = 1): string[] {
  m.log.length = 0;
  m.debug.step(frames, STEP);
  return [...m.log];
}

/** Runs one tick in which `key` is down, so its handler's commands are applied in that tick. */
function press(m: MountedPhysics, key: string): string[] {
  m.log.length = 0;
  m.debug.pressKey(key);
  m.debug.step(1, STEP);
  m.debug.releaseKey(key);
  return [...m.log];
}

function mover(ctx: Ctx): object {
  const entity = ctx.e[MOVER];
  if (entity === undefined) throw new Error("no mover");
  return entity;
}

function resolved(displacement: Vec3, grounded: boolean, extra: Partial<CharacterMovement> = {}): CharacterMovement {
  return { displacement, grounded, contacts: [], carried: ORIGIN, carriedYaw: 0, rotation: IDENTITY, ...extra };
}

describe("what the manifest gives the adapter", () => {
  it("maps a capsule collider to the full height and radius", async () => {
    const m = await mountPhysics({ manifest: characters() });
    expect(m.world.body(MOVER).collider).toEqual({ shape: { kind: "capsule", radius: 0.4, height: 1.8 }, sensor: false, friction: 0.1, restitution: 0 });
    expect(m.world.body(MOVER).desc).toEqual({ kind: "kinematic" });
    m.app.dispose();
  });

  it("a dynamic body asks for continuous collision when its manifest entry says so, or when the host option does", async () => {
    const own = await mountPhysics({
      manifest: (manifest) => {
        const entities = (manifest["scene"] as { entities: ManifestEntity[] }).entities;
        const ball = entities[BALL];
        if (ball === undefined) throw new Error("no ball");
        ball.body = { kind: "dynamic", mass: 2, linearDamping: 0, angularDamping: 0.3, continuous: true };
      },
    });
    expect(own.world.body(BALL).desc).toEqual({ kind: "dynamic", mass: 2, linearDamping: 0, angularDamping: 0.3, continuousCollision: true });
    own.app.dispose();

    const plain = await mountPhysics();
    expect(plain.world.body(BALL).desc).toEqual({ kind: "dynamic", mass: 2, linearDamping: 0, angularDamping: 0.3 });
    plain.app.dispose();

    const host = await mountPhysics({}, { mount: { physics: { continuousCollision: true } } });
    expect(host.world.body(BALL).desc).toEqual({ kind: "dynamic", mass: 2, linearDamping: 0, angularDamping: 0.3, continuousCollision: true });
    // The option is for dynamic bodies; a kinematic body has no such flag.
    expect(host.world.body(MOVER).desc).toEqual({ kind: "kinematic" });
    host.app.dispose();
  });

  it("passes the character settings of the manifest, or the documented defaults, with every move", async () => {
    const hooks: Hooks = { keys: { KeyM: (ctx) => ctx.body(mover(ctx), 0).moveCharacter(vec(1, 0, 0), IDENTITY) } };
    const set = await mountPhysics({ ...hooks, manifest: characters(SETTINGS) });
    press(set, "KeyM");
    const { skin, ...rest } = SETTINGS;
    expect(set.world.moves[0]?.options).toEqual({ ...rest, offset: skin, rotation: IDENTITY });
    set.app.dispose();

    const defaults = await mountPhysics({ ...hooks, manifest: characters() });
    press(defaults, "KeyM");
    expect(defaults.world.moves[0]?.options).toEqual({ ...DEFAULT_OPTIONS, rotation: IDENTITY });
    defaults.app.dispose();
  });
});

describe("the order of a tick with character moves (spec/physics.md section 4)", () => {
  it("applies a move after the kinematic targets and teleports and before impulses and forces", async () => {
    const m = await mountPhysics({
      manifest: characters(),
      keys: {
        KeyM: (ctx) => {
          const ball = ctx.e[BALL];
          const ghost = ctx.e[GHOST];
          if (ball === undefined || ghost === undefined) throw new Error("no entities");
          ctx.body(ball, 0).applyForce(vec(0, 0, 1));
          ctx.body(ball, 0).applyImpulse(vec(1, 0, 0));
          ctx.body(mover(ctx), 0).moveCharacter(vec(0, 0, 2), IDENTITY);
          ctx.body(ghost, 0).setKinematicTarget(vec(7, 0, 0), IDENTITY);
          ctx.body(ball, 0).setLinearVelocity(vec(0, 2, 0));
          ctx.body(ghost, 0).teleport(vec(4, 0, 0), IDENTITY, true);
        },
      },
    });
    expect(press(m, "KeyM")).toEqual([
      "teleport:3:4,0,0:keep",
      "linvel:1:0,2,0",
      "kinematic:3:7,0,0",
      // the move: the pose it starts from, the adapter's resolution, the pose the step reaches
      "readPose:2",
      "move:2:0,0,2",
      "kinematic:2:0,0,2",
      "impulse:1:1,0,0",
      "force:1:0,0,1",
      "step",
      "readPose:1",
      "readPose:2",
      "readPose:3",
      "drain",
    ]);
    expect(m.reported).toEqual([]);
    m.app.dispose();
  });

  it("applies each move once: the next tick starts with an empty queue", async () => {
    const m = await mountPhysics({ manifest: characters(), keys: { KeyM: (ctx) => ctx.body(mover(ctx), 0).moveCharacter(vec(1, 0, 0), IDENTITY) } });
    expect(press(m, "KeyM").filter((line) => line.startsWith("move"))).toEqual(["move:2:1,0,0"]);
    expect(tick(m, 3).filter((line) => line.startsWith("move"))).toEqual([]);
    m.app.dispose();
  });

  it("applies the moves of fixed_update in the next tick", async () => {
    const m = await mountPhysics({ manifest: characters(), entityFixed: { [MOVER]: (ctx, self) => ctx.body(self, 0).moveCharacter(vec(0, 0, 0.5), IDENTITY) } });
    expect(tick(m).filter((line) => line.startsWith("move"))).toEqual([]);
    expect(tick(m).filter((line) => line.startsWith("move"))).toEqual(["move:2:0,0,0.5"]);
    m.app.dispose();
  });
});

describe("the rotation a move asks for", () => {
  /** A mover whose fixed_update asks for `asked`; after the first step a platform has turned the body by 90 degrees. */
  async function turnedAfterIssue(asked: Quat): Promise<MountedPhysics> {
    const m = await mountPhysics({ manifest: characters(), entityFixed: { [MOVER]: (ctx, self) => ctx.body(self, 0).moveCharacter(vec(0, 0, 0.5), asked) } });
    m.world.onStep = (world) => {
      world.body(MOVER).pose = { position: vec(0, 0, 0), rotation: YAW_90 };
    };
    return m;
  }

  it("keeps the rotation the body has when the move is resolved if it is the one the body had when the move was issued", async () => {
    // fixed_update of tick 1 asks for the pose it read (the identity); the step then turns the body (the carried yaw of
    // a platform); tick 2 resolves the move. Asking for the stale rotation would undo the turn: the character would
    // turn at half the platform's rate.
    const m = await turnedAfterIssue(IDENTITY);
    tick(m);
    tick(m);
    expect(m.world.moves[0]?.options?.rotation).toEqual(YAW_90);
    m.app.dispose();
  });

  it("is the rotation asked for when it differs from the one the body had", async () => {
    const m = await turnedAfterIssue({ x: 0, y: 1, z: 0, w: 0 });
    tick(m);
    tick(m);
    expect(m.world.moves[0]?.options?.rotation).toEqual({ x: 0, y: 1, z: 0, w: 0 });
    m.app.dispose();
  });

  it("the last of several moves decides", async () => {
    const m = await mountPhysics({
      manifest: characters(),
      keys: {
        KeyM: (ctx) => {
          const body = ctx.body(mover(ctx), 0);
          body.moveCharacter(vec(1, 0, 0), IDENTITY);
          body.moveCharacter(vec(0, 0, 1), YAW_90);
        },
      },
    });
    press(m, "KeyM");
    expect(m.world.moves[0]?.options?.rotation).toEqual(YAW_90);
    m.app.dispose();
  });
});

describe("several moves of one body in one tick", () => {
  it("sum their displacements and the last rotation wins", async () => {
    const m = await mountPhysics({
      manifest: characters(),
      keys: {
        KeyM: (ctx) => {
          const body = ctx.body(mover(ctx), 0);
          body.moveCharacter(vec(1, 0, 0), IDENTITY);
          body.moveCharacter(vec(0, -0.5, 2), YAW_90);
          body.moveCharacter(vec(0.5, 0, 0), IDENTITY);
        },
      },
    });
    press(m, "KeyM");
    expect(m.world.moves).toHaveLength(1);
    expect(m.world.moves[0]?.displacement).toEqual(vec(1.5, -0.5, 2));
    expect(m.world.moves[0]?.options?.rotation).toEqual(IDENTITY);
    m.app.dispose();
  });

  it("are one move per body: two bodies are resolved separately, in the order of their first command", async () => {
    const m = await mountPhysics({
      manifest: characters(),
      keys: {
        KeyM: (ctx) => {
          const ghost = ctx.e[GHOST];
          if (ghost === undefined) throw new Error("no ghost");
          ctx.body(ghost, 0).moveCharacter(vec(0, 0, 1), IDENTITY);
          ctx.body(mover(ctx), 0).moveCharacter(vec(1, 0, 0), IDENTITY);
          ctx.body(ghost, 0).moveCharacter(vec(0, 0, 1), IDENTITY);
        },
      },
    });
    expect(press(m, "KeyM").filter((line) => line.startsWith("move"))).toEqual(["move:3:0,0,2", "move:2:1,0,0"]);
    m.app.dispose();
  });

  it("replace a set_kinematic_target of the same body in the same tick, whichever was issued first", async () => {
    const m = await mountPhysics({
      manifest: characters(),
      keys: {
        KeyA: (ctx) => {
          ctx.body(mover(ctx), 0).setKinematicTarget(vec(9, 9, 9), IDENTITY);
          ctx.body(mover(ctx), 0).moveCharacter(vec(1, 0, 0), IDENTITY);
        },
        KeyB: (ctx) => {
          ctx.body(mover(ctx), 0).moveCharacter(vec(2, 0, 0), IDENTITY);
          ctx.body(mover(ctx), 0).setKinematicTarget(vec(8, 8, 8), IDENTITY);
        },
        KeyC: (ctx) => ctx.body(mover(ctx), 0).setKinematicTarget(vec(5, 5, 5), IDENTITY),
      },
    });
    expect(press(m, "KeyA").filter((line) => line.startsWith("kinematic"))).toEqual(["kinematic:2:1,0,0"]);
    expect(press(m, "KeyB").filter((line) => line.startsWith("kinematic"))).toEqual(["kinematic:2:2,0,0"]);
    // Without a move the target is applied as before.
    expect(press(m, "KeyC").filter((line) => line.startsWith("kinematic"))).toEqual(["kinematic:2:5,5,5"]);
    m.app.dispose();
  });

  it("start from the pose a teleport of the same tick gave, which is applied first", async () => {
    const m = await mountPhysics({
      manifest: characters(),
      positions: { [MOVER]: vec(0, 1, 0) },
      keys: {
        KeyM: (ctx) => {
          ctx.body(mover(ctx), 0).moveCharacter(vec(1, 0, 0), IDENTITY);
          ctx.body(mover(ctx), 0).teleport(vec(10, 2, 0), IDENTITY, false);
        },
      },
    });
    const run = press(m, "KeyM").filter((line) => /^(teleport|move|kinematic):2/.test(line));
    expect(run).toEqual(["teleport:2:10,2,0:reset", "move:2:1,0,0", "kinematic:2:11,2,0"]);
    expect(m.world.moves[0]?.from.position).toEqual(vec(10, 2, 0));
    m.app.dispose();
  });
});

describe("the pose a move leaves", () => {
  it("is the pose it started from plus the resolved displacement, with the resolved rotation", async () => {
    const m = await mountPhysics({ manifest: characters(), positions: { [MOVER]: vec(1, 1, 1) }, keys: { KeyM: (ctx) => ctx.body(mover(ctx), 0).moveCharacter(vec(3, 0, 0), YAW_90) } });
    m.world.onMove = () => resolved(vec(0.5, -0.25, 0), true, { rotation: { x: 0, y: 1, z: 0, w: 0 }, carried: vec(0.25, 0, 0), carriedYaw: 0.1 });
    press(m, "KeyM");
    const target = m.log.find((line) => line.startsWith("kinematic:2"));
    expect(target).toBe("kinematic:2:1.5,0.75,1");
    expect(m.world.moves[0]?.options?.rotation).toEqual(YAW_90);
    // The step reaches the target; write-back moves the entity there.
    m.world.onStep = (world) => {
      world.body(MOVER).pose = { position: vec(1.5, 0.75, 1), rotation: { x: 0, y: 1, z: 0, w: 0 } };
    };
    m.debug.step(1, STEP);
    expect(m.debug.scene().entities.find((entity) => entity.name === "Mover")?.position).toEqual(vec(1.5, 0.75, 1));
    m.app.dispose();
  });

  it("records the adapter's grounded and ground normal for the reads, before and after, move by move", async () => {
    const reads: [boolean, Vec3][] = [];
    const moves: ((ctx: Ctx) => void)[] = [];
    const m = await mountPhysics({
      manifest: characters(),
      entityFixed: { [MOVER]: (ctx, self) => { const body = ctx.body(self, 0); reads.push([body.grounded, body.groundNormal]); } },
      keys: { KeyM: (ctx) => { moves.shift()?.(ctx); } },
    });
    const queue = (displacement: Vec3): void => {
      moves.push((ctx) => { ctx.body(mover(ctx), 0).moveCharacter(displacement, IDENTITY); });
    };
    // Before the first move: false and zero.
    tick(m);
    expect(reads.splice(0)).toEqual([[false, ORIGIN]]);

    const slope = vec(0, 0.75, 0.5);
    m.world.onMove = (_body, displacement) => resolved(displacement, displacement.y <= 0, displacement.y <= 0 ? { ground: { userId: 0, normal: slope } } : {});
    queue(vec(1, -0.1, 0));
    press(m, "KeyM");
    // The fixed_update after the move reads its result.
    expect(reads.splice(0)).toEqual([[true, slope]]);
    // No new move: the values stay those of the last completed move.
    tick(m);
    expect(reads.splice(0)).toEqual([[true, slope]]);
    // A move into the air: not grounded, normal zero (the ground the adapter named is not reported when not grounded).
    m.world.onMove = (_body, displacement) => resolved(displacement, false, { ground: { userId: 0, normal: UP } });
    queue(vec(1, 0.5, 0));
    press(m, "KeyM");
    expect(reads.splice(0)).toEqual([[false, ORIGIN]]);
    // Grounded without a named ground: the normal is zero, never invented.
    m.world.onMove = (_body, displacement) => resolved(displacement, true);
    queue(vec(1, 0, 0));
    press(m, "KeyM");
    expect(reads.splice(0)).toEqual([[true, ORIGIN]]);
    m.app.dispose();
  });

  it("the reads are false and zero for a kinematic body never moved this way, and E8101 for other kinds", async () => {
    const seen: unknown[] = [];
    const m = await mountPhysics({
      manifest: characters(),
      keys: {
        KeyR: (ctx) => {
          const ghost = ctx.e[GHOST];
          const ball = ctx.e[BALL];
          if (ghost === undefined || ball === undefined) throw new Error("no entities");
          seen.push(ctx.body(ghost, 0).grounded, ctx.body(ghost, 0).groundNormal);
          seen.push(ctx.body(ball, 1).grounded, ctx.body(ball, 2).groundNormal);
        },
      },
    });
    press(m, "KeyR");
    expect(seen).toEqual([false, ORIGIN, false, ORIGIN]);
    expect(codes(m)).toEqual(["MTEK-E8101", "MTEK-E8101"]);
    expect(m.reported[0]?.message).toContain("dynamic body");
    m.app.dispose();
  });
});

describe("E8101: move_character through an entity_ref", () => {
  it("is dropped with E8101 for a body that is not kinematic, and for an entity without a body", async () => {
    const m = await mountPhysics({
      manifest: characters(),
      keys: {
        KeyM: (ctx) => {
          const ball = ctx.e[BALL]?.ref;
          const floor = ctx.e[0]?.ref;
          const sensor = ctx.e[4]?.ref;
          if (ball === undefined || floor === undefined || sensor === undefined) throw new Error("no entities");
          ctx.body(ball, 1).moveCharacter(vec(1, 0, 0), IDENTITY);
          ctx.body(floor, 2).moveCharacter(vec(1, 0, 0), IDENTITY);
          ctx.body(sensor, 3).moveCharacter(vec(1, 0, 0), IDENTITY);
        },
      },
    });
    const run = press(m, "KeyM");
    expect(codes(m)).toEqual(["MTEK-E8101", "MTEK-E8101", "MTEK-E8101"]);
    expect(m.reported[0]?.message).toContain("dynamic body");
    expect(run.some((line) => line.startsWith("move") || line.startsWith("kinematic"))).toBe(false);
    m.app.dispose();
  });
});

describe("E8104: a move with a value that is not finite", () => {
  it("is dropped, whichever argument it is, and the other moves go on", async () => {
    const m = await mountPhysics({
      manifest: characters(),
      keys: {
        KeyM: (ctx) => {
          const entity = mover(ctx);
          ctx.body(entity, 0).moveCharacter(vec(Number.NaN, 0, 0), IDENTITY);
          ctx.body(entity, 1).moveCharacter(vec(0, Number.POSITIVE_INFINITY, 0), IDENTITY);
          ctx.body(entity, 2).moveCharacter(vec(1, 0, 0), { x: 0, y: 0, z: 0, w: 0 });
          ctx.body(entity, 3).moveCharacter(vec(1, 0, 0), { x: Number.NaN, y: 0, z: 0, w: 1 });
          ctx.body(entity, 4).moveCharacter(vec(0, 0, 3), IDENTITY);
        },
      },
    });
    press(m, "KeyM");
    expect(codes(m)).toEqual(["MTEK-E8104", "MTEK-E8104", "MTEK-E8104", "MTEK-E8104"]);
    expect(m.reported[0]?.source).toMatchObject({ file: "src/main.mtek" });
    expect(m.world.moves.map((move) => move.displacement)).toEqual([vec(0, 0, 3)]);
    m.app.dispose();
  });

  it("a move whose result is not finite freezes the body with E8103 and keeps its last pose", async () => {
    const m = await mountPhysics({ manifest: characters(), keys: { KeyM: (ctx) => ctx.body(mover(ctx), 0).moveCharacter(vec(1, 0, 0), IDENTITY) } });
    m.world.onMove = () => resolved(vec(Number.NaN, 0, 0), true);
    press(m, "KeyM");
    expect(codes(m)).toEqual(["MTEK-E8103"]);
    expect(m.world.has(MOVER)).toBe(false);
    expect(m.debug.counters()["physicsFrozenBodies"]).toBe(1);
    m.app.dispose();
  });
});

describe("E8105: an adapter that cannot move characters", () => {
  it("drops the move, reports once per body, and keeps the kinematic target of the tick", async () => {
    const m = await mountPhysics({
      manifest: characters(),
      keys: {
        KeyM: (ctx) => {
          const ghost = ctx.e[GHOST];
          if (ghost === undefined) throw new Error("no ghost");
          ctx.body(mover(ctx), 4).moveCharacter(vec(1, 0, 0), IDENTITY);
          ctx.body(mover(ctx), 5).setKinematicTarget(vec(6, 0, 0), IDENTITY);
          ctx.body(mover(ctx), 6).moveCharacter(vec(2, 0, 0), IDENTITY);
          ctx.body(ghost, 7).moveCharacter(vec(1, 0, 0), IDENTITY);
        },
      },
    });
    (m.world as { moveCharacter?: PhysicsWorld["moveCharacter"] }).moveCharacter = undefined;
    const run = press(m, "KeyM");
    expect(codes(m)).toEqual(["MTEK-E8105", "MTEK-E8105"]);
    expect(m.reported[0]?.message).toContain("'Mover'");
    expect(m.reported[0]?.message).toContain("fake-physics@0");
    expect(m.reported[1]?.message).toContain("'Ghost'");
    expect(m.reported[0]?.severity).toBe("error");
    expect(run.some((line) => line.startsWith("move:"))).toBe(false);
    expect(run.filter((line) => line.startsWith("kinematic"))).toEqual(["kinematic:2:6,0,0"]);
    // Once per body: later moves are dropped without another report.
    m.reported.length = 0;
    press(m, "KeyM");
    expect(m.reported).toEqual([]);
    m.app.dispose();
  });
});

describe("bodies that are gone", () => {
  /** A prefab whose bodies are kinematic, so spawned entities can be moved. */
  const kinematicCrates = (manifest: Manifest): void => {
    const prefabs = manifest["prefabs"] as { body: unknown }[];
    if (prefabs[0] === undefined) throw new Error("no prefab");
    prefabs[0].body = { kind: "kinematic" };
  };

  it("a move for an entity destroyed after it was issued is dropped silently, and a reused slot never receives it", async () => {
    let old: EntityRef | undefined;
    const m = await mountPhysics({
      manifest: kinematicCrates,
      keys: {
        KeyQ: (ctx) => { old = ctx.spawn(CRATE, { n: 1 }, 0); },
        KeyW: (ctx) => {
          if (old === undefined) throw new Error("no crate");
          ctx.body(old, 1).moveCharacter(vec(1, 0, 0), IDENTITY);
          ctx.destroy(old, 0);
        },
        KeyE: (ctx) => { ctx.spawn(CRATE, { n: 2 }, 0); },
      },
    });
    press(m, "KeyQ");
    m.log.length = 0;
    m.debug.pressKey("KeyW");
    m.debug.step(1, STEP / 2); // no tick: the flush after update removes the body
    m.debug.releaseKey("KeyW");
    m.debug.pressKey("KeyE");
    m.debug.step(1, STEP / 2);
    m.debug.releaseKey("KeyE");
    tick(m);
    expect(m.log.some((line) => line.startsWith("move:"))).toBe(false);
    expect(m.reported).toEqual([]);
    m.app.dispose();
  });

  it("a frozen body (E8103) ignores moves and reads false and zero", async () => {
    const seen: unknown[] = [];
    const m = await mountPhysics({
      manifest: characters(),
      keys: {
        KeyM: (ctx) => ctx.body(mover(ctx), 0).moveCharacter(vec(1, 0, 0), IDENTITY),
        KeyR: (ctx) => { seen.push(ctx.body(mover(ctx), 0).grounded, ctx.body(mover(ctx), 0).groundNormal); },
      },
    });
    m.world.onMove = (_body, displacement) => resolved(displacement, true, { ground: { userId: 0, normal: UP } });
    press(m, "KeyM");
    press(m, "KeyR");
    expect(seen.splice(0)).toEqual([true, UP]);
    m.world.onStep = (world) => {
      world.body(MOVER).pose = { position: vec(Number.NaN, 0, 0), rotation: IDENTITY };
    };
    tick(m);
    expect(codes(m)).toEqual(["MTEK-E8103"]);
    m.world.onStep = undefined;
    m.world.moves.length = 0;
    press(m, "KeyM");
    press(m, "KeyR");
    expect(m.world.moves).toEqual([]);
    expect(seen).toEqual([false, ORIGIN]);
    expect(codes(m)).toEqual(["MTEK-E8103"]);
    m.app.dispose();
  });
});

describe("a hot reload", () => {
  function candidate(m: MountedPhysics, hooks: Hooks): ReturnType<typeof physicsProgram> {
    const json = physicsManifestJson(hooks);
    m.host.files.set(MANIFEST_URL, JSON.stringify(json));
    return physicsProgram(hooks, json);
  }

  it("starts the new world at rest: the reads are false and zero, queued moves are gone, new settings apply", async () => {
    const reads: [boolean, Vec3][] = [];
    const hooks: Hooks = {
      manifest: characters(SETTINGS),
      entityFixed: { [MOVER]: (ctx, self) => { const body = ctx.body(self, 0); reads.push([body.grounded, body.groundNormal]); } },
      keys: { KeyM: (ctx) => ctx.body(mover(ctx), 0).moveCharacter(vec(1, 0, 0), IDENTITY) },
    };
    const m = await mountPhysics(hooks);
    m.world.onMove = (_body, displacement) => resolved(displacement, true, { ground: { userId: 0, normal: UP } });
    press(m, "KeyM");
    expect(reads.at(-1)).toEqual([true, UP]);
    m.debug.pressKey("KeyM"); // queued, never applied: the swap comes first
    m.debug.step(1, STEP / 4);
    m.debug.releaseKey("KeyM");

    const swapped = candidate(m, { ...hooks, manifest: characters({ ...SETTINGS, stepHeight: 0.5, carry: true }) });
    expect(await m.app.replaceProgram?.(swapped)).toEqual({ ok: true });
    reads.length = 0;
    tick(m);
    expect(reads).toEqual([[false, ORIGIN]]);
    expect(m.world.moves).toEqual([]);
    press(m, "KeyM");
    expect(m.world.moves[0]?.options).toMatchObject({ stepHeight: 0.5, carry: true, offset: 0.02 });
    m.app.dispose();
  });

  it("makes the capsule again in the new world", async () => {
    const hooks: Hooks = { manifest: characters(SETTINGS) };
    const m = await mountPhysics(hooks);
    const before = m.world;
    expect(await m.app.replaceProgram?.(candidate(m, hooks))).toEqual({ ok: true });
    m.debug.step(1, STEP / 4);
    expect(before.disposed).toBe(true);
    expect(m.world.body(MOVER).collider.shape).toEqual({ kind: "capsule", radius: 0.4, height: 1.8 });
    m.app.dispose();
  });
});
