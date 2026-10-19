/**
 * Compatible instancing (`spec/runtime-abi.md` section 8.4, decision 0059): the pure grouping function, the
 * candidate scan, and the renderer through a mounted application on the fake host (which validates every
 * draw like WebGPU does: pipeline layout, vertex buffer slots, instance ranges).
 *
 * Expectations are worked out by hand from the scene descriptions, not by running the code under test. The
 * camera looks along -Z from (0, 0, 10) with `fov_y = 0.9` on a 16 x 8 target, as in `culling.test.ts`: on the
 * z = 0 plane the view spans |x| < 9.66, and a unit box (radius 0.866) is culled when its centre is
 * (9.66 - x) * 0.719 < -0.866 beyond the right plane, i.e. x > 10.86 (mirrored on the left).
 */
import { describe, expect, it } from "vitest";
import { checkManifest } from "../abi/validate.js";
import { mountMtekWith } from "../host/mount.js";
import type { MtekApp, MtekDebug, MtekTestOptions } from "../host/types.js";
import { FakeHost, asDom, fakeProgram, minimalSceneInit, type FakeDrawRecord, type InitContext } from "../test-support/fake-host.js";
import { installProgram } from "../test-support/mount-fixture.js";
import type { FakeBuffer } from "../test-support/fake-gpu.js";
import { batchDraws, instancingCandidates, type Batch } from "./instancing.js";
import { INSTANCE_FLOATS, INSTANCE_STRIDE, instanceBufferLayout, materialPipelineKey } from "./pipelines.js";
import { resolveStructure } from "../scene/structure.js";

type Json = Record<string, unknown>;

/** A draw as `batchDraws` sees it. */
interface Key {
  readonly pipelineKey: string;
  readonly instance: number;
  readonly mesh: number;
}

const key = (pipelineKey: string, instance: number, mesh: number): Key => ({ pipelineKey, instance, mesh });
const can = (): boolean => true;

describe("batchDraws", () => {
  it("makes a run of two or more compatible draws one instanced draw, and a single draw individual", () => {
    // Sorted draw list: three of (a, block 0, mesh 0), one of (a, 0, mesh 1), two of (a, block 3, mesh 0), one of (b, 0, 0).
    const draws = [key("a", 0, 0), key("a", 0, 0), key("a", 0, 0), key("a", 0, 1), key("a", 3, 0), key("a", 3, 0), key("b", 0, 0)];
    const out: Batch[] = [];
    expect(batchDraws(draws, can, out)).toBe(2);
    expect(out).toEqual([
      { start: 0, count: 3, firstInstance: 0 },
      { start: 3, count: 1, firstInstance: -1 },
      { start: 4, count: 2, firstInstance: 3 },
      { start: 6, count: 1, firstInstance: -1 },
    ]);
  });

  it("never groups draws that differ in the pipeline key, the parameter block or the mesh", () => {
    const draws = [key("a", 0, 0), key("b", 0, 0), key("b", 1, 0), key("b", 1, 1)];
    const out: Batch[] = [];
    expect(batchDraws(draws, can, out)).toBe(0);
    expect(out.map((b) => [b.start, b.count, b.firstInstance])).toEqual([
      [0, 1, -1],
      [1, 1, -1],
      [2, 1, -1],
      [3, 1, -1],
    ]);
  });

  it("draws everything individually when a draw cannot be instanced", () => {
    const draws = [key("a", 0, 0), key("a", 0, 0), key("a", 0, 0)];
    const out: Batch[] = [];
    expect(batchDraws(draws, () => false, out)).toBe(0);
    expect(out).toHaveLength(3);
    expect(out.every((b) => b.count === 1 && b.firstInstance === -1)).toBe(true);
  });

  it("numbers the instance records consecutively across groups, and clears the output", () => {
    const out: Batch[] = [{ start: 99, count: 99, firstInstance: 99 }];
    const draws = [key("a", 0, 0), key("a", 0, 0), key("a", 1, 0), key("a", 1, 0), key("a", 1, 0)];
    batchDraws(draws, can, out);
    expect(out).toEqual([
      { start: 0, count: 2, firstInstance: 0 },
      { start: 2, count: 3, firstInstance: 2 },
    ]);
    expect(batchDraws([], can, out)).toBe(0);
    expect(out).toEqual([]);
  });
});

describe("the instance buffer layout", () => {
  it("has eight float32x4 columns at locations 3 to 10, stride 128, step mode instance", () => {
    const layout = instanceBufferLayout();
    expect(layout.stepMode).toBe("instance");
    expect(layout.arrayStride).toBe(128);
    expect(INSTANCE_STRIDE).toBe(128);
    expect(INSTANCE_FLOATS).toBe(32);
    expect([...layout.attributes].map((a) => [a.shaderLocation, a.offset, a.format])).toEqual([
      [3, 0, "float32x4"],
      [4, 16, "float32x4"],
      [5, 32, "float32x4"],
      [6, 48, "float32x4"],
      [7, 64, "float32x4"],
      [8, 80, "float32x4"],
      [9, 96, "float32x4"],
      [10, 112, "float32x4"],
    ]);
  });
});

// ---- the renderer ----

const TARGET = { width: 16, height: 8 } as const;
const COLOR_X = { r: 0.25, g: 0.5, b: 0.75, a: 1 };
const COLOR_Y = { r: 1, g: 0, b: 0, a: 1 };
const UNLIT = "std/materials.mtek::Unlit";
const INSTANCE_BUFFER = "mtek instance matrices";

interface Item {
  readonly x: number;
  /** 0: the 1x1x1 box of the minimal manifest, 1: a 2x1x1 box. */
  readonly mesh?: 0 | 1;
  readonly color?: typeof COLOR_X;
  readonly parent?: number;
}

interface Options {
  readonly hidden?: readonly number[];
  readonly test?: MtekTestOptions;
  readonly camera?: readonly [number, number, number];
  /** Class of the colour param of every instance; `imperative` instances never share. */
  readonly paramClass?: "initial" | "imperative";
}

interface Mounted {
  readonly host: FakeHost;
  readonly app: MtekApp;
  readonly debug: MtekDebug;
  readonly ctx: InitContext;
}

async function mount(items: readonly Item[], options: Options = {}): Promise<Mounted> {
  const host = new FakeHost();
  const json = installProgram(host, (manifest: Json) => {
    const shader = (manifest["shaders"] as Json[])[0];
    if (shader === undefined) throw new Error("no shader");
    shader["instancedVertexEntry"] = "mtek_vs_instanced";
    (manifest["meshes"] as Json[]).push({ id: "mesh:1", kind: "box", size: [2, 1, 1] });
    const scene = manifest["scene"] as { entities: Json[]; materialInstances: Json[] };
    const template = scene.entities[0] ?? {};
    scene.entities = items.map((item, index) => ({
      ...template,
      index,
      name: `E${String(index)}`,
      symbol: `src/main.mtek::Demo.E${String(index)}`,
      parent: item.parent ?? null,
      mesh: item.mesh === 1 ? "mesh:1" : "mesh:0",
      material: { id: UNLIT, instance: index },
    }));
    scene.materialInstances = items.map((_, index) => ({
      index,
      material: UNLIT,
      entity: index,
      params: [{ name: "color", class: options.paramClass ?? "initial" }],
      shareable: (options.paramClass ?? "initial") === "initial",
    }));
  });
  const parsed = checkManifest(json);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.failures));
  let saved: InitContext | undefined;
  const [cx, cy, cz] = options.camera ?? [0, 0, 10];
  const init = (context: object): void => {
    minimalSceneInit(context);
    const ctx = context as InitContext;
    ctx.setCamera("position", { x: cx, y: cy, z: cz });
    ctx.setCamera("target", { x: cx, y: cy, z: 0 });
    items.forEach((item, i) => {
      ctx.setTransform(ctx.e[i], "position", { x: item.x, y: 0, z: 0 });
      ctx.setParam(ctx.e[i], "color", item.color ?? COLOR_X);
    });
    for (const i of options.hidden ?? []) ctx.setVisible(ctx.e[i], false);
    saved = ctx;
  };
  const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), fakeProgram(init, parsed.manifest), {
    test: options.test ?? { manualClock: true, renderTarget: TARGET },
  });
  if (app.debug === undefined || saved === undefined) throw new Error("no debug API");
  return { host, app, debug: app.debug, ctx: saved };
}

function lastDraws(host: FakeHost): readonly FakeDrawRecord[] {
  const pass = host.device.renderPasses.at(-1);
  if (pass === undefined) throw new Error("no render pass");
  return pass.draws;
}

function liveBuffer(host: FakeHost, label: string): FakeBuffer | undefined {
  return host.device.buffers.find((buffer) => buffer.label === label && !buffer.destroyed);
}

/** The model matrix translations (x) of the first `count` instance records. */
function recordXs(host: FakeHost, count: number): number[] {
  const buffer = liveBuffer(host, INSTANCE_BUFFER);
  if (buffer === undefined) throw new Error("no instance buffer");
  const all = new Float32Array(buffer.contents.buffer.slice(0, count * INSTANCE_STRIDE));
  return Array.from({ length: count }, (_, k) => all[k * INSTANCE_FLOATS + 12] ?? Number.NaN);
}

function entryPoint(draw: FakeDrawRecord): string | undefined {
  return (draw.pipeline.descriptor as { vertex: { entryPoint?: string } }).vertex.entryPoint;
}

/** (instanceCount, firstInstance) per draw call. */
function shape(host: FakeHost): [number, number][] {
  return lastDraws(host).map((d) => [d.instanceCount, d.firstInstance]);
}

const ROW5: readonly Item[] = [-4, -2, 0, 2, 4].map((x) => ({ x }));

describe("candidates", () => {
  it("are the groups of two or more with the same mesh, pipeline and parameter block", () => {
    const host = new FakeHost();
    const json = installProgram(host, (manifest: Json) => {
      const shader = (manifest["shaders"] as Json[])[0];
      if (shader !== undefined) shader["instancedVertexEntry"] = "mtek_vs_instanced";
      const scene = manifest["scene"] as { entities: Json[]; materialInstances: Json[] };
      const template = scene.entities[0] ?? {};
      scene.entities = [0, 1, 2].map((index) => ({ ...template, index, name: `E${String(index)}`, symbol: `s::E${String(index)}`, material: { id: UNLIT, instance: index } }));
      scene.materialInstances = [0, 1, 2].map((index) => ({ index, material: UNLIT, entity: index, params: [{ name: "color", class: "initial" }], shareable: true }));
    });
    const parsed = checkManifest(json);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.failures));
    const resolved = resolveStructure(parsed.manifest);
    if (!resolved.ok) throw new Error("structure");
    const keyOf = (m: Parameters<typeof materialPipelineKey>[0]): string => materialPipelineKey(m, "rgba8unorm-srgb");
    // Three entities, three blocks of their own: nothing to instance.
    expect(instancingCandidates(resolved.structure, (i) => i, keyOf)).toEqual({ materials: new Set(), capacity: 0 });
    // Entities 0 and 1 share a block (named 0): one group of two, capacity 2.
    expect(instancingCandidates(resolved.structure, (i) => (i === 1 ? 0 : i), keyOf)).toEqual({ materials: new Set([UNLIT]), capacity: 2 });
    // All three share: capacity 3.
    expect(instancingCandidates(resolved.structure, () => 0, keyOf).capacity).toBe(3);
  });
});

describe("compatible instancing in the renderer", () => {
  it("draws identical entities with one instanced draw and counts it", async () => {
    const { host, debug, app } = await mount(ROW5);
    debug.step(1, 0.016);
    const draws = lastDraws(host);
    expect(draws).toHaveLength(1);
    expect(shape(host)).toEqual([[5, 0]]);
    expect(entryPoint(draws[0] as FakeDrawRecord)).toBe("mtek_vs_instanced");
    // One mesh buffer (position) plus the instance buffer in the next slot.
    expect(draws[0]?.vertexBuffers.map((b) => b.label)).toEqual([expect.stringContaining("position"), INSTANCE_BUFFER]);
    // Records are in draw order (ties by instance order): the world matrices of E0..E4.
    expect(recordXs(host, 5)).toEqual([-4, -2, 0, 2, 4]);
    expect(debug.counters()).toMatchObject({ drawCalls: 1, instancedDraws: 1, culledObjects: 0, sharedParamBlocks: 1, ownedParamBlocks: 0 });
    // Five unculled entities, one draw: the counters tell the difference between drawing and instancing.
    expect(debug.counters()["instancedDrawsTotal"]).toBe(1);
    app.dispose();
  });

  it("writes the normal matrix after the model matrix in each record", async () => {
    const { host, debug, app } = await mount(ROW5.slice(0, 2));
    debug.step(1, 0.016);
    const buffer = liveBuffer(host, INSTANCE_BUFFER);
    if (buffer === undefined) throw new Error("no instance buffer");
    const record = new Float32Array(buffer.contents.buffer.slice(0, INSTANCE_STRIDE));
    // Unit scale, no rotation: the normal matrix is the identity (columns 0..3 at floats 16..31), the model's last column is (-4, 0, 0, 1).
    expect(Array.from(record.slice(16, 32))).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect(Array.from(record.slice(12, 16))).toEqual([-4, 0, 0, 1]);
    app.dispose();
  });

  it("with test.disableInstancing draws one call per entity, creates no instanced pipeline or buffer, and counts none", async () => {
    const instanced = await mount(ROW5);
    const plain = await mount(ROW5, { test: { manualClock: true, renderTarget: TARGET, disableInstancing: true } });
    plain.debug.step(1, 0.016);
    expect(shape(plain.host)).toEqual([[1, 0], [1, 0], [1, 0], [1, 0], [1, 0]]);
    expect(lastDraws(plain.host).map((d) => entryPoint(d))).toEqual(Array(5).fill("mtek_vs"));
    expect(liveBuffer(plain.host, INSTANCE_BUFFER)).toBeUndefined();
    expect(plain.debug.counters()).toMatchObject({ drawCalls: 5, instancedDraws: 0, sharedParamBlocks: 1 });
    // The instanced scene created one pipeline more (the instanced variant) and one buffer more.
    expect((instanced.debug.counters()["pipelinesCreated"] ?? 0) - (plain.debug.counters()["pipelinesCreated"] ?? 0)).toBe(1);
    expect((instanced.debug.counters()["buffersAllocated"] ?? 0) - (plain.debug.counters()["buffersAllocated"] ?? 0)).toBe(1);
    instanced.app.dispose();
    plain.app.dispose();
  });

  it("groups only compatible draws: another mesh or other parameters make separate draws", async () => {
    // E0, E1, E4: mesh 0, colour X. E2: mesh 1, colour X. E3: mesh 0, colour Y.
    // Blocks: {0, 1, 2, 4} share the colour-X block (named 0), E3 owns block 3.
    // Sorted by (pipeline, block, mesh, entity): (0, mesh0: E0 E1 E4) (0, mesh1: E2) (3, mesh0: E3).
    const { host, debug, app } = await mount([{ x: -4 }, { x: -2 }, { x: 0, mesh: 1 }, { x: 2, color: COLOR_Y }, { x: 4 }]);
    debug.step(1, 0.016);
    expect(shape(host)).toEqual([[3, 0], [1, 0], [1, 0]]);
    const draws = lastDraws(host);
    expect(draws.map((d) => entryPoint(d))).toEqual(["mtek_vs_instanced", "mtek_vs", "mtek_vs"]);
    // The individual draws name their entities by object slot (256 bytes apart): E2 then E3.
    expect(draws.slice(1).map((d) => (d.dynamicOffsets[2]?.[0] ?? -1) / 256)).toEqual([2, 3]);
    expect(recordXs(host, 3)).toEqual([-4, -2, 4]);
    expect(debug.counters()).toMatchObject({ drawCalls: 3, instancedDraws: 1, sharedParamBlocks: 1, ownedParamBlocks: 1 });
    app.dispose();
  });

  it("does not share or instance entities whose params are mutable", async () => {
    const { host, debug, app } = await mount(ROW5, { paramClass: "imperative" });
    debug.step(1, 0.016);
    expect(shape(host)).toEqual([[1, 0], [1, 0], [1, 0], [1, 0], [1, 0]]);
    expect(debug.counters()).toMatchObject({ drawCalls: 5, instancedDraws: 0, sharedParamBlocks: 0, ownedParamBlocks: 5 });
    expect(liveBuffer(host, INSTANCE_BUFFER)).toBeUndefined();
    app.dispose();
  });

  it("instances after culling: culled entities leave the group, a single survivor is drawn individually", async () => {
    // Camera at x = 12: the left edge of the view on z = 0 is 12 - 9.66 = 2.34. E3 (x = 2) is (2 - 2.34) * 0.719 = -0.24 outside,
    // within the radius 0.866: kept. E2 (x = 0) is -1.68 outside: culled, and so are E1 and E0. E4 (x = 4) is inside.
    const { host, debug, app, ctx } = await mount(ROW5, { camera: [12, 0, 10] });
    debug.step(1, 0.016);
    expect(shape(host)).toEqual([[2, 0]]);
    expect(recordXs(host, 2)).toEqual([2, 4]);
    expect(debug.counters()).toMatchObject({ drawCalls: 1, instancedDraws: 1, culledObjects: 3 });

    // Camera at x = 14: the left edge is 4.34; E3 is 1.68 outside (culled), E4 is 0.34 outside (kept): one survivor, drawn alone.
    ctx.setCamera("position", { x: 14, y: 0, z: 10 });
    ctx.setCamera("target", { x: 14, y: 0, z: 0 });
    debug.step(1, 0.016);
    expect(shape(host)).toEqual([[1, 0]]);
    expect(entryPoint(lastDraws(host)[0] as FakeDrawRecord)).toBe("mtek_vs");
    expect(debug.counters()).toMatchObject({ drawCalls: 1, instancedDraws: 0, culledObjects: 4 });

    // Back at x = 12 the pair is instanced again; the total counts both instanced frames.
    ctx.setCamera("position", { x: 12, y: 0, z: 10 });
    ctx.setCamera("target", { x: 12, y: 0, z: 0 });
    debug.step(1, 0.016);
    expect(shape(host)).toEqual([[2, 0]]);
    expect(debug.counters()["instancedDrawsTotal"]).toBe(2);
    app.dispose();
  });

  it("leaves a hidden entity out of the group", async () => {
    const { host, debug, app } = await mount(ROW5, { hidden: [2] });
    debug.step(1, 0.016);
    expect(shape(host)).toEqual([[4, 0]]);
    expect(recordXs(host, 4)).toEqual([-4, -2, 2, 4]);
    expect(debug.counters()).toMatchObject({ drawCalls: 1, instancedDraws: 1 });
    app.dispose();
  });

  it("follows a hidden entity that is shown again, and a hidden group that is shown", async () => {
    const { host, debug, app, ctx } = await mount(ROW5, { hidden: [2] });
    debug.step(1, 0.016);
    ctx.setVisible(ctx.e[2], true);
    debug.step(1, 0.016);
    expect(shape(host)).toEqual([[5, 0]]);
    expect(recordXs(host, 5)).toEqual([-4, -2, 0, 2, 4]);
    for (const i of [0, 1, 2, 3]) ctx.setVisible(ctx.e[i], false);
    debug.step(1, 0.016);
    expect(shape(host)).toEqual([[1, 0]]);
    expect(debug.counters()).toMatchObject({ drawCalls: 1, instancedDraws: 0 });
    app.dispose();
  });

  it("a parameter that differs after mount takes its entity out of the group (copy on write)", async () => {
    const { host, debug, app } = await mount(ROW5);
    debug.step(1, 0.016);
    expect(shape(host)).toEqual([[5, 0]]);
    expect(debug.counters()).toMatchObject({ sharedParamBlocks: 1, ownedParamBlocks: 0 });

    // Writing the value the block already holds changes nothing.
    debug.setParam("E2", "color", COLOR_X);
    debug.step(1, 0.016);
    expect(shape(host)).toEqual([[5, 0]]);

    // E2 gets colour Y: it owns a block (named 2) now; E0, E1, E3, E4 keep block 0.
    // Order by block: (0: E0 E1 E3 E4), (2: E2).
    debug.setParam("E2", "color", COLOR_Y);
    debug.step(1, 0.016);
    expect(shape(host)).toEqual([[4, 0], [1, 0]]);
    expect(recordXs(host, 4)).toEqual([-4, -2, 2, 4]);
    expect(debug.counters()).toMatchObject({ drawCalls: 2, instancedDraws: 1, sharedParamBlocks: 1, ownedParamBlocks: 1 });

    // The lowest-indexed user of a block names it: when E0 leaves, E1 names the block of E1, E3, E4.
    // Order by block: (0: E0) (1: E1 E3 E4) (2: E2).
    debug.setParam("E0", "color", { r: 0, g: 1, b: 0, a: 1 });
    debug.step(1, 0.016);
    expect(shape(host)).toEqual([[1, 0], [3, 0], [1, 0]]);
    expect(recordXs(host, 3)).toEqual([-2, 2, 4]);
    expect(debug.counters()).toMatchObject({ drawCalls: 3, instancedDraws: 1, sharedParamBlocks: 1, ownedParamBlocks: 2 });
    app.dispose();
  });

  it("moving a parent moves the instance record of its child", async () => {
    // E1 is a child of E0: world x = parent x + local x.
    const { host, debug, app, ctx } = await mount([{ x: -4 }, { x: 1, parent: 0 }, { x: 3 }]);
    debug.step(1, 0.016);
    expect(shape(host)).toEqual([[3, 0]]);
    expect(recordXs(host, 3)).toEqual([-4, -3, 3]);
    ctx.setTransform(ctx.e[0], "position", { x: -2, y: 0, z: 0 });
    debug.step(1, 0.016);
    expect(recordXs(host, 3)).toEqual([-2, -1, 3]);
    app.dispose();
  });

  it("uploads nothing for a static scene, and only the changed record when one instance moves", async () => {
    const { host, debug, app, ctx } = await mount(ROW5);
    debug.step(2, 0.016);
    const before = debug.counters();
    debug.step(3, 0.016);
    expect(debug.counters()["uploads"]).toBe(before["uploads"]);
    expect(debug.counters()["uploadBytes"]).toBe(before["uploadBytes"]);

    // E2 moves along x: of its instance record only the one float that changed uploads (model column 3, x: 4 bytes,
    // the range from the first to the last changed word). Its object block is not read by an instanced draw, so it
    // is not written (decision 0120).
    const buffer = liveBuffer(host, INSTANCE_BUFFER);
    if (buffer === undefined) throw new Error("no instance buffer");
    const bytesBefore = Uint8Array.from(buffer.contents);
    ctx.setTransform(ctx.e[2], "position", { x: 1, y: 0, z: 0 });
    debug.step(1, 0.016);
    const after = debug.counters();
    expect((after["uploads"] ?? 0) - (before["uploads"] ?? 0)).toBe(1);
    expect((after["uploadBytes"] ?? 0) - (before["uploadBytes"] ?? 0)).toBe(4);
    const changed = Array.from(buffer.contents).flatMap((byte, i) => (byte === bytesBefore[i] ? [] : [Math.floor(i / INSTANCE_STRIDE)]));
    expect([...new Set(changed)]).toEqual([2]);
    expect(recordXs(host, 5)).toEqual([-4, -2, 1, 2, 4]);
    expect(shape(host)).toEqual([[5, 0]]);
    app.dispose();
  });

  it("creates no GPU object while drawing (the pipelines and the buffer exist after mount)", async () => {
    const { debug, app, ctx } = await mount(ROW5);
    debug.step(1, 0.016);
    const before = debug.counters();
    ctx.setTransform(ctx.e[1], "position", { x: -1, y: 0, z: 0 });
    debug.step(3, 0.016);
    const after = debug.counters();
    for (const name of ["pipelinesCreated", "shaderModulesCreated", "bindGroupsCreated", "buffersAllocated", "liveBuffers", "livePipelines", "liveBindGroups"]) {
      expect(after[name], name).toBe(before[name]);
    }
    app.dispose();
  });

  it("releases the instance buffer with the app", async () => {
    const { host, app } = await mount(ROW5);
    expect(liveBuffer(host, INSTANCE_BUFFER)).toBeDefined();
    app.dispose();
    expect(liveBuffer(host, INSTANCE_BUFFER)).toBeUndefined();
  });

  it("creates no instance buffer when nothing can be instanced", async () => {
    const { host, debug, app } = await mount([{ x: -2 }, { x: 0, color: COLOR_Y }, { x: 2, mesh: 1 }]);
    debug.step(1, 0.016);
    expect(liveBuffer(host, INSTANCE_BUFFER)).toBeUndefined();
    expect(shape(host)).toEqual([[1, 0], [1, 0], [1, 0]]);
    expect(debug.counters()).toMatchObject({ drawCalls: 3, instancedDraws: 0, pipelinesCreated: 1 });
    app.dispose();
  });

  it("an instanced frame and a frame with instancing disabled bind the same state apart from the instancing itself", async () => {
    const a = await mount(ROW5);
    const b = await mount(ROW5, { test: { manualClock: true, renderTarget: TARGET, disableInstancing: true } });
    a.debug.step(1, 0.016);
    b.debug.step(1, 0.016);
    // Both draw the five entities' box index range; the instanced draw replaces five equal ones.
    const indexCounts = (m: Mounted): number[] => lastDraws(m.host).map((d) => d.indexCount);
    expect(indexCounts(a)).toEqual([36]);
    expect(indexCounts(b)).toEqual([36, 36, 36, 36, 36]);
    a.app.dispose();
    b.app.dispose();
  });
});
