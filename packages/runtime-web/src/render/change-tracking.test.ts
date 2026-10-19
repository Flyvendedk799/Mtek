/**
 * Change tracking (decision 0120): a frame drawn by a renderer that skips what did not change must leave the GPU in
 * the state a full recompute leaves it in. Two applications run the same program through the same random script of
 * mutations on the fake host: the tracked one (the runtime as it is), and a reference one whose world and renderer are
 * told to forget their change tracking before every pass (`World.markAllTransformsDirty`, `Renderer.invalidate`), so
 * that it recomputes the transforms, the culling, the batching, the instance records and the object blocks as a first
 * frame would. After every frame the draw calls, the counters that describe them and the bytes of every live GPU buffer
 * of the two must be equal. A dirty flag that is missed shows up as a difference at the first frame it matters.
 *
 * The script covers what the tracking has to be right about: moved, rotated and scaled entities (also written with
 * the value they already have, and with an invalid scale), parents and children, visibility, the camera (so that the
 * culled set changes), bound-like param writes on shared and unshared parameter blocks (copy on write), spawn and
 * destroy with slot reuse, and frames in which nothing happens at all.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MtekProgramPrefab, MtekProgramScene } from "../abi/program.js";
import { checkManifest } from "../abi/validate.js";
import { mountMtekWith } from "../host/mount.js";
import type { MtekApp, MtekDebug } from "../host/types.js";
import { World } from "../scene/world.js";
import { FakeHost, asDom, fakeProgram, minimalSceneInit, type FakeDrawRecord, type InitContext } from "../test-support/fake-host.js";
import type { FakeBuffer } from "../test-support/fake-gpu.js";
import { installProgram } from "../test-support/mount-fixture.js";
import { SPARK, manifestEdit } from "../test-support/spawn-fixture.js";
import { Renderer } from "./renderer.js";

type Json = Record<string, unknown>;
const f = Math.fround;
const TARGET = { width: 16, height: 8 } as const;
const UNLIT = "std/materials.mtek::Unlit";

// ---- a small seeded generator (mulberry32) ----

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- the program: STATIC entities (some with parents, some on unshared blocks) and the Spark prefab ----

const STATIC = 14;
/** Parent of each static entity (entity 0 and 7 are roots; a parent always has a lower index). */
const PARENTS: readonly (number | null)[] = [null, 0, 1, 1, null, 4, 5, null, 7, 8, 0, null, 11, 12];
/** Entities 10 to 13 have an `imperative` colour param: a block of their own, drawn individually. */
const OWN_BLOCK = (index: number): boolean => index >= 10;

function edit(manifest: Json): void {
  manifestEdit()(manifest);
  const shader = (manifest["shaders"] as Json[])[0];
  if (shader === undefined) throw new Error("no shader");
  shader["instancedVertexEntry"] = "mtek_vs_instanced";
  (manifest["meshes"] as Json[]).push({ id: "mesh:1", kind: "box", size: [2, 1, 1] });
  const scene = manifest["scene"] as { entities: Json[]; materialInstances: Json[] };
  const template = scene.entities[0] ?? {};
  scene.entities = Array.from({ length: STATIC }, (_, index) => ({
    ...template,
    index,
    name: `E${String(index)}`,
    symbol: `src/main.mtek::Demo.E${String(index)}`,
    parent: PARENTS[index] ?? null,
    mesh: index % 3 === 2 ? "mesh:1" : "mesh:0",
    material: { id: UNLIT, instance: index },
  }));
  scene.materialInstances = Array.from({ length: STATIC }, (_, index) => ({
    index,
    material: UNLIT,
    entity: index,
    params: [{ name: "color", class: OWN_BLOCK(index) ? "imperative" : "initial" }],
    shareable: !OWN_BLOCK(index),
  }));
}

/** What a script can do in the scene's update and in a spark's update. */
interface Ctx extends InitContext {
  spawn(prefab: string, params: Record<string, unknown>, span: number): unknown;
  destroy(ref: unknown, span: number): void;
  alive(ref: unknown): boolean;
  setVisible(entity: object, value: boolean): void;
}

interface Op {
  readonly kind: string;
  readonly i: number;
  readonly a: readonly number[];
}

interface Rig {
  readonly host: FakeHost;
  readonly app: MtekApp;
  readonly debug: MtekDebug;
  /** The ops of the next frame, applied by the scene's update. */
  ops: Op[];
  readonly refs: unknown[];
  frame: number;
}

async function mountRig(): Promise<Rig> {
  const host = new FakeHost();
  const json = installProgram(host, edit);
  const parsed = checkManifest(json);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.failures));
  const rig: Rig = { host, app: undefined as unknown as MtekApp, debug: undefined as unknown as MtekDebug, ops: [], refs: [], frame: 0 };
  const init = (context: object): void => {
    minimalSceneInit(context);
    const ctx = context as Ctx;
    ctx.setCamera("position", { x: 0, y: 0, z: 14 });
    ctx.setCamera("target", { x: 0, y: 0, z: 0 });
    ctx.e.forEach((entity, i) => {
      ctx.setTransform(entity, "position", { x: f(((i * 5) % 13) - 6), y: f(((i * 3) % 7) - 3), z: 0 });
      // A few share a colour (one block), the rest differ in one channel.
      ctx.setParam(entity, "color", { r: 0.5, g: 0.25, b: f((i % 3) / 2), a: 1 });
    });
  };
  const base = fakeProgram(init, parsed.manifest);
  const scene = (base.scenes as Record<string, MtekProgramScene>)[parsed.manifest.entryScene];
  if (scene === undefined) throw new Error("no entry scene");
  const apply = (ctx: Ctx, op: Op): void => {
    const entity = ctx.e[op.i];
    switch (op.kind) {
      case "pos":
        if (entity !== undefined) ctx.setTransform(entity, "position", { x: f(op.a[0] ?? 0), y: f(op.a[1] ?? 0), z: f(op.a[2] ?? 0) });
        break;
      case "rot": {
        const [x = 0, y = 0, z = 0] = op.a;
        const length = Math.hypot(x, y, z, 1);
        if (entity !== undefined) ctx.setTransform(entity, "rotation", { x: f(x / length), y: f(y / length), z: f(z / length), w: f(1 / length) });
        break;
      }
      case "scale":
        if (entity !== undefined) ctx.setTransform(entity, "scale", { x: f(op.a[0] ?? 1), y: f(op.a[1] ?? 1), z: f(op.a[2] ?? 1) });
        break;
      case "same":
        // The value the entity has: the world must see no change.
        if (entity !== undefined) {
          const record = entity as { position: object; rotation: object; scale: object };
          ctx.setTransform(entity, "position", record.position);
          ctx.setTransform(entity, "rotation", record.rotation);
          ctx.setTransform(entity, "scale", record.scale);
        }
        break;
      case "vis":
        if (entity !== undefined) ctx.setVisible(entity, (op.a[0] ?? 0) > 0);
        break;
      case "param":
        if (entity !== undefined) ctx.setParam(entity, "color", { r: f(op.a[0] ?? 0), g: f(op.a[1] ?? 0), b: f(op.a[2] ?? 0), a: 1 });
        break;
      case "cam":
        ctx.setCamera("position", { x: f(op.a[0] ?? 0), y: f(op.a[1] ?? 0), z: f(op.a[2] ?? 14) });
        ctx.setCamera("target", { x: f(op.a[3] ?? 0), y: f(op.a[4] ?? 0), z: 0 });
        break;
      case "fov":
        ctx.setCamera("projection.fov_y", f(op.a[0] ?? 0.9));
        break;
      case "spawn":
        rig.refs.push(ctx.spawn(SPARK, { n: op.i }, 1));
        break;
      case "destroy": {
        if (rig.refs.length === 0) break;
        const [ref] = rig.refs.splice(op.i % rig.refs.length, 1);
        ctx.destroy(ref, 1);
        break;
      }
      default:
        throw new Error(`unknown op ${op.kind}`);
    }
  };
  const spark: MtekProgramPrefab = {
    init: (ctx, self, params) => {
      const c = ctx as Ctx;
      const n = Number(params["n"]);
      c.setTransform(self as object, "position", { x: f((n % 9) - 4), y: f((n % 5) - 2), z: 1 });
      c.setParam(self as object, "color", { r: 0.5, g: 0.25, b: f((n % 3) / 2), a: 1 });
    },
    update: (ctx, self) => {
      // A spark moves every third frame (a function of its n and the frame only, the same in both applications).
      const record = self as { params: { n: number } };
      const n = record.params.n;
      if ((rig.frame + n) % 3 === 0) (ctx as Ctx).setTransform(self as object, "position", { x: f(((n + rig.frame) % 9) - 4), y: f((n % 5) - 2), z: 1 });
    },
    fixedUpdate: () => undefined,
    events: {},
    bindings: [],
  };
  const next = {
    ...scene,
    update: (ctx: unknown) => {
      for (const op of rig.ops) apply(ctx as Ctx, op);
      rig.ops = [];
    },
  } as unknown as MtekProgramScene;
  const program = { ...base, scenes: { [parsed.manifest.entryScene]: next }, prefabs: { [SPARK]: spark } };
  const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), program, { test: { manualClock: true, renderTarget: TARGET } });
  if (app.debug === undefined) throw new Error("no debug API");
  return Object.assign(rig, { app, debug: app.debug });
}

// ---- the reference: the same frame with the change tracking forgotten ----

let reference = false;
const realPropagate = World.prototype.propagate;
const realFrame = Renderer.prototype.frame;

beforeAll(() => {
  World.prototype.propagate = function (this: World): number {
    if (reference) this.markAllTransformsDirty();
    return realPropagate.call(this);
  };
  Renderer.prototype.frame = function (this: Renderer): boolean {
    if (reference) this.invalidate();
    return realFrame.call(this);
  };
});

afterAll(() => {
  World.prototype.propagate = realPropagate;
  Renderer.prototype.frame = realFrame;
});

function stepOnce(rig: Rig, asReference: boolean): void {
  reference = asReference;
  try {
    rig.debug.step(1, 0.016);
  } finally {
    reference = false;
  }
  rig.frame += 1;
}

// ---- what is compared ----

function describeDraw(draw: FakeDrawRecord): unknown {
  return {
    pipeline: (draw.pipeline.descriptor as { label?: string; vertex: { entryPoint?: string } }).vertex.entryPoint,
    groups: draw.bindGroups.map((g) => g.descriptor.label),
    offsets: draw.dynamicOffsets,
    vertexBuffers: draw.vertexBuffers.map((b) => b.label),
    index: [draw.indexBuffer.label, draw.indexCount],
    instances: [draw.instanceCount, draw.firstInstance],
  };
}

function liveBuffers(host: FakeHost): FakeBuffer[] {
  return host.device.buffers.filter((buffer) => !buffer.destroyed);
}

function compare(tracked: Rig, full: Rig, label: string): void {
  const counters = (rig: Rig): Record<string, number> => {
    const all = rig.debug.counters();
    const pick: Record<string, number> = {};
    for (const key of ["drawCalls", "instancedDraws", "culledObjects", "liveEntities", "ownedParamBlocks", "sharedParamBlocks", "drawCallsTotal", "instancedDrawsTotal", "culledObjectsTotal"]) {
      pick[key] = all[key] ?? Number.NaN;
    }
    return pick;
  };
  expect(counters(tracked), `${label}: counters`).toEqual(counters(full));
  const passes = (rig: Rig): unknown[] => (rig.host.device.renderPasses.at(-1)?.draws ?? []).map(describeDraw);
  expect(passes(tracked), `${label}: draw calls`).toEqual(passes(full));
  const a = liveBuffers(tracked.host);
  const b = liveBuffers(full.host);
  expect(a.map((buffer) => buffer.label), `${label}: live buffers`).toEqual(b.map((buffer) => buffer.label));
  a.forEach((buffer, index) => {
    const other = b[index] as FakeBuffer;
    if (buffer.contents.length !== other.contents.length) throw new Error(`${label}: ${buffer.label} has another size`);
    // Compare as words: a difference is reported with the word, not a megabyte of bytes.
    const x = new Uint32Array(buffer.contents.buffer, buffer.contents.byteOffset, buffer.contents.length >>> 2);
    const y = new Uint32Array(other.contents.buffer, other.contents.byteOffset, other.contents.length >>> 2);
    for (let w = 0; w < x.length; w++) {
      if (x[w] !== y[w]) {
        throw new Error(`${label}: buffer '${buffer.label}' differs at word ${String(w)} (byte ${String(w * 4)}): tracked 0x${(x[w] as number).toString(16)}, full 0x${(y[w] as number).toString(16)}`);
      }
    }
  });
}

// ---- the script ----

function randomOps(random: () => number, spawned: number): Op[] {
  const ops: Op[] = [];
  const r = (lo: number, hi: number): number => lo + random() * (hi - lo);
  const pick = (n: number): number => Math.floor(random() * n);
  // About one frame in six does nothing at all.
  if (random() < 1 / 6) return ops;
  const count = 1 + pick(5);
  for (let k = 0; k < count; k++) {
    const roll = random();
    const i = pick(STATIC);
    if (roll < 0.22) ops.push({ kind: "pos", i, a: [r(-9, 9), r(-5, 5), r(-2, 2)] });
    else if (roll < 0.32) ops.push({ kind: "rot", i, a: [r(-1, 1), r(-1, 1), r(-1, 1)] });
    else if (roll < 0.4) ops.push({ kind: "scale", i, a: random() < 0.15 ? [0, 1, 1] : [r(0.3, 2.2), r(0.3, 2.2), r(0.3, 2.2)] });
    else if (roll < 0.48) ops.push({ kind: "same", i, a: [] });
    else if (roll < 0.58) ops.push({ kind: "vis", i, a: [random() < 0.6 ? 1 : 0] });
    else if (roll < 0.66) ops.push({ kind: "param", i, a: [r(0, 1), r(0, 1), random() < 0.5 ? 0 : 0.5] });
    else if (roll < 0.78) ops.push({ kind: "cam", i: 0, a: [r(-9, 9), r(-4, 4), r(8, 16), r(-9, 9), r(-4, 4)] });
    else if (roll < 0.82) ops.push({ kind: "fov", i: 0, a: [r(0.3, 1.5)] });
    else if (roll < 0.91) ops.push({ kind: "spawn", i: pick(30), a: [] });
    else if (spawned > 0) ops.push({ kind: "destroy", i: pick(8), a: [] });
  }
  return ops;
}

describe("change tracking: a tracked frame equals a full recompute", () => {
  it.each([1, 2, 3, 4, 5, 6])("random script, seed %i: draw calls and every GPU buffer agree after every frame", async (seed) => {
    const tracked = await mountRig();
    const full = await mountRig();
    const random = rng(seed * 7919);
    const seen = { instanced: 0, individual: 0, culled: 0, spawned: 0, destroyed: 0, quiet: 0, maxEntities: 0 };
    // Frame 0 draws the mounted scene.
    stepOnce(tracked, false);
    stepOnce(full, true);
    compare(tracked, full, `seed ${String(seed)} frame 0`);
    for (let frame = 1; frame <= 90; frame++) {
      const ops = randomOps(random, tracked.refs.length);
      tracked.ops = [...ops];
      full.ops = [...ops];
      stepOnce(tracked, false);
      stepOnce(full, true);
      compare(tracked, full, `seed ${String(seed)} frame ${String(frame)}`);
      const counters = tracked.debug.counters();
      seen.instanced += counters["instancedDraws"] ?? 0;
      seen.individual += (counters["drawCalls"] ?? 0) - (counters["instancedDraws"] ?? 0);
      seen.culled += counters["culledObjects"] ?? 0;
      seen.maxEntities = Math.max(seen.maxEntities, counters["liveEntities"] ?? 0);
      seen.spawned += ops.filter((op) => op.kind === "spawn").length;
      seen.destroyed += ops.filter((op) => op.kind === "destroy").length;
      if (ops.length === 0) seen.quiet += 1;
    }
    // The script reached what it is meant to reach: instanced and individual draws, culling, spawn and destroy, quiet frames.
    expect(seen.instanced).toBeGreaterThan(0);
    expect(seen.individual).toBeGreaterThan(0);
    expect(seen.culled).toBeGreaterThan(0);
    expect(seen.spawned).toBeGreaterThan(2);
    expect(seen.destroyed).toBeGreaterThan(0);
    expect(seen.maxEntities).toBeGreaterThan(STATIC);
    expect(seen.quiet).toBeGreaterThan(3);
    // Both ended in the same state of the spawn bookkeeping.
    expect(tracked.refs.length).toBe(full.refs.length);
    tracked.app.dispose();
    full.app.dispose();
  });

  it("a frame in which nothing changed uploads nothing and draws the same", async () => {
    const rig = await mountRig();
    rig.debug.step(2, 0.016);
    const before = rig.debug.counters();
    const draws = (rig.host.device.renderPasses.at(-1)?.draws ?? []).map(describeDraw);
    rig.debug.step(5, 0.016);
    const after = rig.debug.counters();
    expect(after["uploads"]).toBe(before["uploads"]);
    expect(after["uploadBytes"]).toBe(before["uploadBytes"]);
    expect((rig.host.device.renderPasses.at(-1)?.draws ?? []).map(describeDraw)).toEqual(draws);
    rig.app.dispose();
  });

  it("the reference is not trivially the same: forgetting the tracking changes nothing the GPU can see, but does the work", async () => {
    // The tracked rig recomputes nothing on a quiet frame; the reference rig recomputes every world matrix.
    const tracked = await mountRig();
    const full = await mountRig();
    stepOnce(tracked, false);
    stepOnce(full, true);
    const propagated: number[] = [];
    const spy = World.prototype.propagate;
    World.prototype.propagate = function (this: World): number {
      const n = spy.call(this);
      propagated.push(n);
      return n;
    };
    try {
      stepOnce(tracked, false);
      stepOnce(full, true);
    } finally {
      World.prototype.propagate = spy;
    }
    expect(propagated[0]).toBe(0);
    expect(propagated[1]).toBeGreaterThanOrEqual(STATIC);
    tracked.app.dispose();
    full.app.dispose();
  });
});
