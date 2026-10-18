// Execution test of prefabs in the generated program module (spec/scenes.md section 5,
// spec/runtime-abi.md sections 3 and 5, task M5-01, decision 0062): the `prefabs` fixture's
// `prefabs` table and the static instances in its scene run against a fake context, with no
// browser.
import { describe, expect, it } from "vitest";
import { type SetterCall, createFakeContext } from "./support/fake-ctx.js";
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
  readonly state: readonly { readonly name: string; readonly symbol: string }[];
  readonly update: boolean;
}

interface ManifestBinding {
  readonly id: number;
  readonly target: { readonly kind: string; readonly entity?: number; readonly instance?: number };
  readonly order: number;
}

const CRATE = "src/main.mtek::Crate";
const LAMP = "src/props.mtek::Lamp";

async function prefabs(): Promise<Readonly<Record<string, Readonly<Record<string, unknown>>>>> {
  const { module } = await loadProgram("prefabs");
  const table = record(module["prefabs"], "prefabs");
  return Object.fromEntries(Object.entries(table).map(([symbol, entry]) => [symbol, record(entry, symbol)]));
}

const summary = (calls: readonly SetterCall[]): unknown[] =>
  calls.map((call) => [call.method, call.entity, call.field, call.value]);

describe("the prefabs table of the prefabs program", () => {
  it("has one entry per prefab, keyed by symbol, with the shape of the ABI", async () => {
    const table = await prefabs();
    expect(Object.keys(table)).toEqual([CRATE, LAMP]);
    for (const entry of Object.values(table)) {
      expect(Object.keys(entry)).toEqual(["init", "update", "fixedUpdate", "events", "bindings"]);
      expect(typeof entry["init"]).toBe("function");
      expect(Array.isArray(entry["bindings"])).toBe(true);
    }
    expect(table[CRATE]?.["update"]).toBeNull();
    expect(typeof table[LAMP]?.["update"]).toBe("function");
    expect(table[LAMP]?.["fixedUpdate"]).toBeNull();
    expect(table[CRATE]?.["bindings"]).toEqual([]);
    expect(table[LAMP]?.["bindings"]).toHaveLength(2);
  });

  it("lists the handlers by event with the owner `self`", async () => {
    const table = await prefabs();
    const crate = record(table[CRATE]?.["events"], "events") as Record<string, Handler[]>;
    expect(Object.keys(crate)).toEqual(["key_down"]);
    expect(crate["key_down"]?.map((h) => [h.key, h.owner])).toEqual([["Enter", "self"]]);
    const lamp = record(table[LAMP]?.["events"], "events") as Record<string, Handler[]>;
    expect(lamp["key_down"]?.map((h) => [h.key, h.owner])).toEqual([["Space", "self"]]);
  });

  it("init(ctx, self, params) sets the state, then the fields from the params", async () => {
    const table = await prefabs();
    const { ctx, calls } = createFakeContext(1);
    const self = ctx.e[0];
    const params = { origin: { x: 1, y: 2, z: 3 }, tint: { r: 0.5, g: 0.25, b: 0.125, a: 1 } };
    (table[CRATE]?.["init"] as Fn)(ctx, self, params);
    expect(self?.state).toEqual({ bounces: 0 });
    expect(summary(calls)).toEqual([
      ["setTransform", 0, "rotation", { x: 0, y: 0, z: 0, w: 1 }],
      ["setTransform", 0, "scale", { x: 1, y: 1, z: 1 }],
      ["setVisible", 0, "visible", true],
      ["setTransform", 0, "position", params.origin],
      ["setParam", 0, "color", params.tint],
    ]);
  });

  it("init computes state and fields over the params, and leaves bound values to the runtime", async () => {
    const table = await prefabs();
    const { ctx, calls } = createFakeContext(1);
    const self = ctx.e[0];
    const params = { origin: { x: 0, y: 0, z: 0 }, tint: { r: 1, g: 0, b: 0, a: 1 }, spin: 3 };
    (table[LAMP]?.["init"] as Fn)(ctx, self, params);
    expect(self?.state).toEqual({ hits: 0, phase: 6 });
    // `position` and the material's `level` are bound: no setter call for them.
    expect(calls.map((c) => [c.method, c.field])).toEqual([
      ["setTransform", "rotation"],
      ["setVisible", "visible"],
      ["setTransform", "scale"],
      ["setParam", "tint"],
    ]);
    expect(calls.find((c) => c.field === "scale")?.value).toEqual({ x: 3, y: 3, z: 3 });
  });

  it("handlers and the update read self.params and write self.state", async () => {
    const table = await prefabs();
    const params = { origin: { x: 0, y: 0, z: 0 }, tint: { r: 1, g: 0, b: 0, a: 1 }, spin: 2 };
    const made = createFakeContext(1, [params]);
    const ctx = { ...made.ctx, frame: { time: 0.5 } };
    const self = made.ctx.e[0];
    if (self === undefined) throw new Error("no record");
    Object.assign(self.state, { hits: 1, phase: 0.25 });
    const lamp = record(table[LAMP]?.["events"], "events") as Record<string, Handler[]>;
    lamp["key_down"]?.[0]?.fn(ctx, self);
    expect(self.state["hits"]).toBe(2);
    expect(summary(made.calls)).toEqual([["setParam", 0, "tint", { r: 0, g: 1, b: 0, a: 1 }]]);
    made.calls.length = 0;
    (table[LAMP]?.["update"] as Fn)(ctx, self, 0.016);
    // frame.time * spin + phase, in binary32: 0.5 * 2 + 0.25.
    expect(made.calls).toHaveLength(1);
    expect(made.calls[0]?.field).toBe("rotation");
  });

  it("a binding is (ctx, self) => value over self.params and the frame", async () => {
    const table = await prefabs();
    const params = { origin: { x: 1, y: 2, z: 3 }, tint: { r: 1, g: 0, b: 0, a: 1 }, spin: 1 };
    const made = createFakeContext(1, [params]);
    const ctx = { ...made.ctx, frame: { time: 0 } };
    const [position, level] = table[LAMP]?.["bindings"] as Fn[];
    // sin(0) = 0: LIFT (0.5) above the origin; the material level is 1.
    expect(position?.(ctx, made.ctx.e[0])).toEqual({ x: 1, y: 2.5, z: 3 });
    expect(level?.(ctx, made.ctx.e[0])).toBe(1);
  });
});

describe("the static instances of the prefabs program", () => {
  async function scene(): Promise<{
    scene: Readonly<Record<string, unknown>>;
    entities: readonly ManifestEntity[];
    bindings: readonly ManifestBinding[];
  }> {
    const program = await loadProgram("prefabs");
    const scenes = record(program.module["scenes"], "scenes");
    const manifestScene = program.manifest.scene as unknown as {
      entities: readonly ManifestEntity[];
      bindings: readonly ManifestBinding[];
    };
    return {
      scene: record(scenes["Demo"], "scene"),
      entities: manifestScene.entities,
      bindings: manifestScene.bindings,
    };
  }

  it("init sets an instance like an entity, with the prefab's fields over the instance's params", async () => {
    const { scene: demo, entities } = await scene();
    const { ctx, calls } = createFakeContext(entities.length);
    (demo["init"] as Fn)(ctx);
    expect(ctx.e[0]?.state).toEqual({ bounces: 0 });
    expect(ctx.e[2]?.state).toEqual({ hits: 0, phase: 2 });
    expect(ctx.e[3]?.state).toEqual({ hits: 0, phase: 4 });
    const of = (entity: number): SetterCall[] => calls.filter((c) => c.entity === entity);
    // First: its own origin; Second: the default origin and its own tint.
    expect(of(0).find((c) => c.field === "position")?.value).toEqual({ x: 0, y: 3, z: 0 });
    expect(of(1).find((c) => c.field === "position")?.value).toEqual({ x: 0, y: 2, z: 0 });
    expect(of(1).find((c) => c.field === "color")?.value).toMatchObject({ r: 1, a: 1 });
    // The Lamps bind their positions: no setter call for them, `scale` follows `spin` (a constant
    // for the instance, set in registry order like any entity's).
    expect(of(2).map((c) => c.field)).toEqual(["rotation", "scale", "visible", "tint"]);
    expect(of(3).find((c) => c.field === "scale")?.value).toEqual({ x: 2, y: 2, z: 2 });
  });

  it("the entities, handlers and updates of the instances are indexed like those of entities", async () => {
    const { scene: demo, entities } = await scene();
    expect(entities.map((e) => [e.index, e.symbol.split("::")[1], e.update])).toEqual([
      [0, "Demo.First", false],
      [1, "Demo.Second", false],
      [2, "Demo.Left", true],
      [3, "Demo.Right", true],
      [4, "Demo.Marker", false],
    ]);
    expect(entities[2]?.state.map((s) => [s.name, s.symbol])).toEqual([
      ["hits", "src/main.mtek::Demo.Left.hits"],
      ["phase", "src/main.mtek::Demo.Left.phase"],
    ]);
    const update = demo["entityUpdate"] as (Fn | null)[];
    expect(update.map((fn) => fn !== null)).toEqual([false, false, true, true, false]);
    const events = record(demo["events"], "events") as Record<string, Handler[]>;
    expect(events["key_down"]?.map((h) => [h.key, h.owner])).toEqual([
      ["KeyH", -1],
      ["Enter", 0],
      ["Enter", 1],
      ["Space", 2],
      ["Space", 3],
    ]);
  });

  it("an instance's handler runs on its own record with the params substituted", async () => {
    const { scene: demo, entities } = await scene();
    const made = createFakeContext(entities.length);
    const ctx = { ...made.ctx, frame: { time: 1 } };
    (demo["init"] as Fn)(ctx);
    made.calls.length = 0;
    const events = record(demo["events"], "events") as Record<string, Handler[]>;
    const [h, enterFirst, , spaceLeft] = events["key_down"] ?? [];
    enterFirst?.fn(ctx, ctx.e[0]);
    enterFirst?.fn(ctx, ctx.e[0]);
    expect(ctx.e[0]?.state["bounces"]).toBe(2);
    spaceLeft?.fn(ctx, ctx.e[2]);
    expect(ctx.e[2]?.state["hits"]).toBe(1);
    // The scene's own handler writes the state and a material param of two instances.
    h?.fn(ctx, null);
    expect(ctx.e[3]?.state["hits"]).toBe(0);
    expect(made.calls.at(-1)).toMatchObject({ method: "setParam", entity: 2, field: "tint" });
    // Each Lamp spins at its own rate: rotation = frame.time * spin + phase, in binary32.
    const update = demo["entityUpdate"] as Fn[];
    made.calls.length = 0;
    update[2]?.(ctx, ctx.e[2], 0.016);
    update[3]?.(ctx, ctx.e[3], 0.016);
    expect(made.calls.map((c) => [c.entity, c.field])).toEqual([
      [2, "rotation"],
      [3, "rotation"],
    ]);
    expect(made.calls[0]?.value).not.toEqual(made.calls[1]?.value);
  });

  it("the bindings of the instances come first in the evaluation order, numbered after the scene's", async () => {
    const { scene: demo, bindings } = await scene();
    const functions = demo["bindings"] as Fn[];
    expect(functions).toHaveLength(bindings.length);
    expect(bindings.map((b) => b.id)).toEqual([0, 1, 2, 3, 4]);
    // The Marker's binding (the scene's, id 0) reads state of instances: it is evaluated last.
    expect(bindings[0]?.target).toEqual({ kind: "transform", entity: 4, field: "position" });
    expect(bindings[0]?.order).toBe(4);
    expect(bindings.slice(1).map((b) => [b.target.kind, b.target.entity ?? b.target.instance, b.order])).toEqual([
      ["transform", 2, 0],
      ["param", 2, 1],
      ["transform", 3, 2],
      ["param", 3, 3],
    ]);
    // The instance's binding is `(ctx) => value` with the instance's origin and index in it.
    const made = createFakeContext(5);
    const ctx = { ...made.ctx, frame: { time: 0 } };
    expect(functions[1]?.(ctx)).toEqual({ x: -2, y: 0.5, z: 0 });
    expect(functions[3]?.(ctx)).toEqual({ x: 2, y: 0.5, z: 0 });
    Object.assign(made.ctx.e[2]?.state ?? {}, { hits: 3 });
    Object.assign(made.ctx.e[0]?.state ?? {}, { bounces: 4 });
    expect(functions[0]?.(ctx)).toEqual({ x: 0, y: 0, z: 7 });
  });

  it("the manifest names the prefabs, their params and their state as symbols", async () => {
    const { manifest } = await loadProgram("prefabs");
    const ids = (kind: string): string[] =>
      manifest.symbols.filter((s) => s.kind === kind).map((s) => s.id);
    expect(ids("prefab")).toEqual([CRATE, LAMP]);
    for (const symbol of [
      `${CRATE}.origin`,
      `${CRATE}.tint`,
      `${CRATE}.bounces`,
      `${LAMP}.origin`,
      `${LAMP}.spin`,
      `${LAMP}.hits`,
      `${LAMP}.phase`,
    ]) {
      expect(manifest.symbols.map((s) => s.id)).toContain(symbol);
    }
  });
});
