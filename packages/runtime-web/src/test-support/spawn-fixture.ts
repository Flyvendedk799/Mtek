/**
 * A synthetic program with a prefab, for the tests of spawn and destroy (decision 0064): the minimal manifest
 * plus a prefab `Spark` (mesh, `Unlit` material, one param `n`, state `age`), and a scene whose functions log
 * their calls so that the order of a frame is observable.
 */
import { checkManifest } from "../abi/validate.js";
import type { MtekProgramPrefab, MtekProgramScene } from "../abi/program.js";
import type { MtekDiagnostic } from "../diagnostics/types.js";
import { mountMtekWith } from "../host/mount.js";
import type { MtekApp, MtekDebug, MtekMountOptions } from "../host/types.js";
import type { EntityRef } from "../scene/slots.js";
import { FakeHost, asDom, fakeProgram } from "./fake-host.js";
import { installProgram } from "./mount-fixture.js";

export const SPARK = "src/main.mtek::Spark";
export const TARGET = { width: 16, height: 8 } as const;

export interface Ctx {
  spawn(prefab: string, params: Record<string, unknown>, span: number): EntityRef;
  destroy(ref: EntityRef, span: number): void;
  alive(ref: EntityRef): boolean;
  readonly e: readonly { readonly ref: EntityRef }[];
  setParam(entity: object, name: string, value: unknown): void;
  setTransform(entity: object, field: string, value: unknown): void;
}

export interface Self {
  readonly ref: EntityRef;
  readonly params: Readonly<{ n: number }>;
  readonly state: Record<string, unknown>;
  readonly position: { x: number; y: number; z: number };
}

/** What a test script can do inside the program's functions. */
export interface Script {
  readonly log: string[];
  readonly refs: EntityRef[];
  /** DOM key code -> scene handler. */
  readonly keys: Record<string, (ctx: Ctx) => void>;
  sceneUpdate?: (ctx: Ctx) => void;
  sceneFixed?: (ctx: Ctx) => void;
  sparkUpdate?: (ctx: Ctx, self: Self) => void;
}

export function script(partial: Partial<Script> = {}): Script {
  return { log: [], refs: [], keys: {}, ...partial };
}

export function manifestEdit(edit?: (manifest: Record<string, unknown>) => void): (manifest: Record<string, unknown>) => void {
  return (manifest) => {
    manifest["prefabs"] = [
      {
        symbol: SPARK,
        name: "Spark",
        params: [{ name: "n", type: "i32" }],
        mesh: "mesh:0",
        material: { id: "std/materials.mtek::Unlit", params: [{ name: "color", class: "initial" }], shareable: true },
        body: null,
        collider: null,
        state: [{ name: "age", type: "f32", symbol: `${SPARK}.age` }],
        update: true,
        fixedUpdate: true,
        bindings: [],
        span: 2,
      },
    ];
    (manifest["symbols"] as unknown[]).push({ id: SPARK, kind: "prefab", span: 2 });
    edit?.(manifest);
  };
}

export function programFor(s: Script, manifestJson: Record<string, unknown>): ReturnType<typeof fakeProgram> {
  const parsed = checkManifest(manifestJson);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.failures));
  const base = fakeProgram(undefined, parsed.manifest);
  const scene = (base.scenes as Record<string, MtekProgramScene>)[parsed.manifest.entryScene];
  if (scene === undefined) throw new Error("no entry scene");
  const spark: MtekProgramPrefab = {
    init: (ctx, self, params) => {
      s.log.push(`init:${String(params["n"])}`);
      const c = ctx as Ctx;
      c.setTransform(self, "position", { x: Math.fround(Number(params["n"]) / 4), y: 0, z: 0 });
      c.setParam(self, "color", { r: 0.5, g: 0.25, b: Number(params["n"]) % 3 === 0 ? 1 : 0, a: 1 });
      (self as Self).state["age"] = 0;
    },
    update: (ctx, self, dt) => {
      const me = self as Self;
      s.log.push(`update:${String(me.params.n)}`);
      me.state["age"] = Math.fround(Number(me.state["age"]) + dt);
      s.sparkUpdate?.(ctx as Ctx, me);
    },
    fixedUpdate: (_ctx, self) => {
      s.log.push(`fixed:${String((self as Self).params.n)}`);
    },
    events: {
      key_down: [{ key: "KeyK", owner: "self", fn: (_ctx, self) => s.log.push(`key:${String((self as Self).params.n)}`) }],
    },
    bindings: [],
  };
  const events = {
    key_down: Object.entries(s.keys).map(([key, run]) => ({
      key,
      owner: -1,
      fn: (ctx: unknown) => {
        s.log.push(`key:${key}`);
        run(ctx as Ctx);
      },
    })),
  };
  const next = {
    ...scene,
    update: (ctx: unknown) => {
      s.log.push("update:scene");
      s.sceneUpdate?.(ctx as Ctx);
    },
    fixedUpdate: (ctx: unknown) => {
      s.log.push("fixed:scene");
      s.sceneFixed?.(ctx as Ctx);
    },
    events,
  } as unknown as MtekProgramScene;
  return { ...base, scenes: { [parsed.manifest.entryScene]: next }, prefabs: { [SPARK]: spark } };
}

export interface Mounted {
  readonly host: FakeHost;
  readonly app: MtekApp;
  readonly debug: MtekDebug;
  readonly reported: MtekDiagnostic[];
}

export async function mountSpawn(s: Script, options: { edit?: (manifest: Record<string, unknown>) => void; mount?: MtekMountOptions } = {}): Promise<Mounted> {
  const host = new FakeHost();
  const json = installProgram(host, manifestEdit(options.edit));
  const reported: MtekDiagnostic[] = [];
  const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), programFor(s, json), {
    test: { manualClock: true, renderTarget: TARGET },
    onDiagnostic: (d) => reported.push(d),
    ...options.mount,
  });
  if (app.debug === undefined) throw new Error("no debug API");
  return { host, app, debug: app.debug, reported };
}

export function draws(host: FakeHost): number {
  return host.device.renderPasses.at(-1)?.draws.length ?? -1;
}

/** Runs `frames` of `dt` after clearing the log, and returns what was logged. */
export function frame(m: Mounted, s: Script, dt: number, frames = 1): string[] {
  s.log.length = 0;
  m.debug.step(frames, dt);
  return [...s.log];
}
