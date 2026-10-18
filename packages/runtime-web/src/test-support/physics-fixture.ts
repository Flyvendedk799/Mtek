/**
 * A synthetic physics program for the runtime tests (decision 0066): the minimal manifest with a body-bearing scene
 *
 *   0 Floor   static, a box          1 Ball   dynamic, a sphere     2 Mover  kinematic, a box
 *   3 Ghost   no body at all         4 Sensor static sensor box
 *
 * and a spawnable prefab `Crate` (dynamic box, param `n`) that has a state `hits`, plus a recording fake backend. No
 * entity has a mesh, so the fake GPU has nothing to draw: the tests are about the order of the tick. A script's
 * handlers and the fake world write to the same `log`, so a whole tick reads as one list.
 */
import { checkManifest } from "../abi/validate.js";
import type { MtekEventName, MtekProgramPrefab, MtekProgramScene } from "../abi/program.js";
import type { MtekDiagnostic } from "../diagnostics/types.js";
import { mountMtekWith } from "../host/mount.js";
import type { MtekApp, MtekDebug, MtekMountOptions } from "../host/types.js";
import type { Vec3 } from "../physics/types.js";
import type { EntityRef } from "../scene/slots.js";
import { FakePhysicsBackend, type FakePhysicsWorld } from "./fake-physics.js";
import { BASE_URL, FakeHost, asDom, fakeProgram } from "./fake-host.js";
import { installProgram } from "./mount-fixture.js";

export const CRATE = "src/main.mtek::Crate";
export const PHYSICS_MODULE = "physics/0123456789abcdef.js";
export const PHYSICS_URL = new URL(PHYSICS_MODULE, BASE_URL).href;
/** `manifest.runtimeConfig.fixedStep`, exactly: one frame of this length is one tick. */
export const STEP = 0.016666668;

export const FLOOR = 0;
export const BALL = 1;
export const MOVER = 2;
export const GHOST = 3;
export const SENSOR = 4;
const NAMES = ["Floor", "Ball", "Mover", "Ghost", "Sensor"] as const;

const BOX = { kind: "box", size: [1, 1, 1], sensor: false, friction: 0.5, restitution: 0 } as const;

const BODIES: readonly (readonly [unknown, unknown])[] = [
  [{ kind: "static" }, { ...BOX, size: [30, 1, 30], friction: 0.8 }],
  [{ kind: "dynamic", mass: 2, linearDamping: 0, angularDamping: 0.3 }, { kind: "sphere", radius: 0.5, sensor: false, friction: 0.5, restitution: 0.7 }],
  [{ kind: "kinematic" }, { ...BOX, size: [2, 1, 2] }],
  [null, null],
  [{ kind: "static" }, { ...BOX, sensor: true }],
];

export interface Ctx {
  spawn(prefab: string, params: Record<string, unknown>, span: number): EntityRef;
  destroy(ref: EntityRef, span: number): void;
  alive(ref: EntityRef): boolean;
  body(target: object, span: number): Handle;
  readonly e: readonly (object & { readonly ref: EntityRef })[];
  setTransform(entity: object, field: string, value: unknown): void;
}

/** The body handle of `ctx.body(..)`, as generated code uses it. */
export interface Handle {
  applyImpulse(v: unknown): void;
  applyForce(v: unknown): void;
  setLinearVelocity(v: unknown): void;
  setKinematicTarget(position: unknown, rotation: unknown): void;
  teleport(position: unknown, rotation: unknown, keepVelocity: unknown): void;
  readonly linearVelocity: Vec3;
  readonly angularVelocity: Vec3;
}

export interface Self {
  readonly ref: EntityRef;
  readonly params: Readonly<{ n: number }>;
  readonly state: Record<string, unknown>;
}

type CollisionFn = (ctx: Ctx, self: object, other: EntityRef) => void;

/** What a test can make the program do. */
export interface Hooks {
  /** Initial `position` of the named entities by index (default: the origin). */
  readonly positions?: Readonly<Record<number, Vec3>>;
  /** The initial position of a spawned Crate, by its param `n` (default: `(n, 0, 0)`). */
  readonly cratePosition?: (n: number) => Vec3;
  /** DOM key code -> scene handler (phase 1). */
  readonly keys?: Readonly<Record<string, (ctx: Ctx, self: object | null) => void>>;
  readonly fixedUpdate?: (ctx: Ctx) => void;
  readonly update?: (ctx: Ctx) => void;
  /** `fixed_update` of the named entity `owner`. */
  readonly entityFixed?: Readonly<Record<number, (ctx: Ctx, self: object) => void>>;
  /** The collision handlers of the named entity `owner`, by event. */
  readonly enter?: Readonly<Record<number, CollisionFn>>;
  readonly exit?: Readonly<Record<number, CollisionFn>>;
  /** The collision handlers of the Crate prefab. */
  readonly crateEnter?: CollisionFn;
  readonly crateExit?: CollisionFn;
  readonly crateFixed?: (ctx: Ctx, self: Self) => void;
  /** Edits the manifest before it is validated. */
  readonly manifest?: (manifest: Record<string, unknown>) => void;
}

/** The manifest of the fixture: the minimal one with five entities and the Crate prefab. */
export function physicsManifestJson(hooks: Hooks = {}, physics = true): Record<string, unknown> {
  return installPhysicsManifest(new FakeHost(), hooks, physics);
}

function installPhysicsManifest(host: FakeHost, hooks: Hooks, physics: boolean): Record<string, unknown> {
  return installProgram(host, (manifest) => {
    manifest["subsystems"] = physics ? { physics: true, physicsModule: PHYSICS_MODULE } : { physics: false };
    const scene = manifest["scene"] as Record<string, unknown>;
    scene["entities"] = NAMES.map((name, index) => ({
      index,
      name,
      symbol: `src/main.mtek::Demo.${name}`,
      parent: null,
      mesh: null,
      material: null,
      light: null,
      body: physics ? (BODIES[index]?.[0] ?? null) : null,
      collider: physics ? (BODIES[index]?.[1] ?? null) : null,
      state: [],
      update: false,
      fixedUpdate: hooks.entityFixed?.[index] !== undefined,
    }));
    scene["materialInstances"] = [];
    const symbols = manifest["symbols"] as { id: string; kind: string; span: number }[];
    manifest["symbols"] = [
      ...symbols.filter((symbol) => symbol.id !== "src/main.mtek::Demo.Cube"),
      ...NAMES.map((name) => ({ id: `src/main.mtek::Demo.${name}`, kind: "entity", span: 2 })),
      { id: CRATE, kind: "prefab", span: 2 },
    ];
    manifest["prefabs"] = [
      {
        symbol: CRATE,
        name: "Crate",
        params: [{ name: "n", type: "i32" }],
        mesh: null,
        material: null,
        body: physics ? { kind: "dynamic", mass: 1, linearDamping: 0, angularDamping: 0 } : null,
        collider: physics ? BOX : null,
        state: [{ name: "hits", type: "i32", symbol: `${CRATE}.hits` }],
        update: false,
        fixedUpdate: hooks.crateFixed !== undefined,
        bindings: [],
        span: 2,
      },
    ];
    hooks.manifest?.(manifest);
  });
}

/** The program module for `manifestJson` with the hooks wired in as generated code would be. */
export function physicsProgram(hooks: Hooks, manifestJson: Record<string, unknown>): ReturnType<typeof fakeProgram> {
  const parsed = checkManifest(manifestJson);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.failures));
  const init = (context: object): void => {
    const ctx = context as Ctx;
    for (const [index, position] of Object.entries(hooks.positions ?? {})) {
      const entity = ctx.e[Number(index)];
      if (entity !== undefined) ctx.setTransform(entity, "position", position);
    }
  };
  const base = fakeProgram(init, parsed.manifest);
  const scene = (base.scenes as Record<string, MtekProgramScene>)[parsed.manifest.entryScene];
  if (scene === undefined) throw new Error("no entry scene");

  const handlers = (event: MtekEventName, table: Readonly<Record<number, CollisionFn>> | undefined): { owner: number; fn: (ctx: object, self: object | null, arg: unknown) => void }[] =>
    Object.entries(table ?? {}).map(([owner, fn]) => ({ owner: Number(owner), fn: (ctx, self, arg) => { fn(ctx as Ctx, self as object, arg as EntityRef); } }));
  const keys = Object.entries(hooks.keys ?? {}).map(([key, run]) => ({
    key,
    owner: -1,
    fn: (ctx: object, self: object | null) => {
      run(ctx as Ctx, self);
    },
  }));
  const events = {
    ...(keys.length > 0 ? { key_down: keys } : {}),
    ...(hooks.enter === undefined ? {} : { collision_enter: handlers("collision_enter", hooks.enter) }),
    ...(hooks.exit === undefined ? {} : { collision_exit: handlers("collision_exit", hooks.exit) }),
  };
  const entityFixed = NAMES.map((_, index) => {
    const fn = hooks.entityFixed?.[index];
    return fn === undefined ? null : (ctx: object, self: object) => { fn(ctx as Ctx, self); };
  });
  const next = {
    ...scene,
    fixedUpdate: hooks.fixedUpdate === undefined ? null : (ctx: object) => { hooks.fixedUpdate?.(ctx as Ctx); },
    update: hooks.update === undefined ? null : (ctx: object) => { hooks.update?.(ctx as Ctx); },
    entityFixedUpdate: entityFixed,
    events,
  } as unknown as MtekProgramScene;

  const crate: MtekProgramPrefab = {
    init: (ctx, self, params) => {
      const n = Number(params["n"]);
      (ctx as Ctx).setTransform(self, "position", hooks.cratePosition?.(n) ?? { x: n, y: 0, z: 0 });
      (self as Self).state["hits"] = 0;
    },
    update: null,
    fixedUpdate: hooks.crateFixed === undefined ? null : (ctx, self) => { hooks.crateFixed?.(ctx as Ctx, self as Self); },
    events: {
      ...(hooks.crateEnter === undefined ? {} : { collision_enter: [{ owner: "self" as const, fn: (ctx: object, self: object, arg: unknown) => { hooks.crateEnter?.(ctx as Ctx, self, arg as EntityRef); } }] }),
      ...(hooks.crateExit === undefined ? {} : { collision_exit: [{ owner: "self" as const, fn: (ctx: object, self: object, arg: unknown) => { hooks.crateExit?.(ctx as Ctx, self, arg as EntityRef); } }] }),
    },
    bindings: [],
  };
  return { ...base, scenes: { [parsed.manifest.entryScene]: next }, prefabs: { [CRATE]: crate } };
}

export interface MountedPhysics {
  readonly host: FakeHost;
  readonly app: MtekApp;
  readonly debug: MtekDebug;
  readonly reported: MtekDiagnostic[];
  readonly backend: FakePhysicsBackend;
  /** The one chronological log of the fake world and of whatever the test's handlers pushed. */
  readonly log: string[];
  readonly world: FakePhysicsWorld;
}

export interface MountOptions {
  readonly mount?: MtekMountOptions;
  /** The backend the module resolves to (default: a new one, with `log` as its log). */
  readonly backend?: FakePhysicsBackend;
  /** The log the backend appends to; hooks that want to write into it use the same array. */
  readonly log?: string[];
  /** Serve the physics module at its URL (default true); `false` makes the import fail like a missing file. */
  readonly serveModule?: boolean;
  /** A program without bodies (no physics subsystem). */
  readonly physics?: boolean;
}

/** Mounts the fixture on a fake host with the recording backend as the physics module. */
export async function mountPhysics(hooks: Hooks = {}, options: MountOptions = {}): Promise<MountedPhysics> {
  const host = new FakeHost();
  const backend = options.backend ?? new FakePhysicsBackend(options.log);
  const physics = options.physics ?? true;
  const json = installPhysicsManifest(host, hooks, physics);
  if (physics && options.serveModule !== false) host.modules.set(PHYSICS_URL, backend.module);
  const reported: MtekDiagnostic[] = [];
  const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), physicsProgram(hooks, json), {
    test: { manualClock: true, renderTarget: { width: 16, height: 8 } },
    onDiagnostic: (d) => reported.push(d),
    ...options.mount,
  });
  if (app.debug === undefined) throw new Error("no debug API");
  return {
    host,
    app,
    debug: app.debug,
    reported,
    backend,
    log: backend.log,
    get world() {
      return backend.world;
    },
  };
}

/** Runs `frames` frames of one fixed step each (one tick per frame) after clearing the log; returns what was logged. */
export function ticks(m: MountedPhysics, frames = 1): string[] {
  m.log.length = 0;
  m.debug.step(frames, STEP);
  return [...m.log];
}
