/**
 * The spawned entities' side of the scene (`spec/scenes.md` sections 9 and 10, decision 0064) without a GPU: the
 * order of a flush, what is created and released, the diagnostics of `destroy` and `spawn`, the bindings of
 * instances, device recovery and hot reload. The host, the renderer and the material store are recording
 * stand-ins; every expectation is derived by hand from the rules of the specification.
 */
import { describe, expect, it } from "vitest";
import type { MtekBinding } from "../abi/manifest-types.js";
import type { MtekProgramPrefab } from "../abi/program.js";
import type { MtekDiagnostic } from "../diagnostics/types.js";
import {
  DynamicEntities,
  buildPrefabRuntimes,
  type DynamicEntity,
  type DynamicHost,
  type DynamicMaterials,
  type DynamicRender,
  type PrefabRuntime,
} from "./dynamic.js";
import { RuntimeInternalError } from "./errors.js";
import type { ResolvedEntity, ResolvedInstance, ResolvedMaterial, ResolvedMesh, ResolvedPrefab } from "./structure.js";
import { DEAD_REF, makeRef } from "./slots.js";
import type { EntityRecord } from "./world.js";

const MATERIAL = { id: "m::Unlit", params: [{ name: "color", type: "color" }, { name: "map", type: "texture" }], resources: [{ name: "map", kind: "texture", binding: 1 }] } as unknown as ResolvedMaterial;
const MESH = { id: "mesh:0" } as unknown as ResolvedMesh;
const STATIC_COUNT = 2;
const FIRST_INSTANCE = 5;

function resolvedPrefab(name: string, extra: Partial<ResolvedPrefab> = {}): ResolvedPrefab {
  return {
    symbol: `src/main.mtek::${name}`,
    name,
    index: 0,
    params: [{ name: "n", type: "i32" }],
    mesh: MESH,
    material: { material: MATERIAL, params: [], shareable: true, resources: [] },
    body: null,
    collider: null,
    state: [{ name: "age", type: "f32", symbol: `src/main.mtek::${name}.age` }],
    update: false,
    fixedUpdate: false,
    bindings: [],
    span: 0,
    ...extra,
  };
}

interface Harness {
  readonly dynamic: DynamicEntities;
  readonly log: string[];
  readonly reports: MtekDiagnostic[];
  readonly ctxCalls: string[];
}

function harness(options: { maxEntities?: number; prefabs?: readonly ResolvedPrefab[]; code?: (symbol: string, log: string[]) => Partial<MtekProgramPrefab>; attach?: boolean } = {}): Harness {
  const log: string[] = [];
  const reports: MtekDiagnostic[] = [];
  const ctxCalls: string[] = [];
  const ctx = {
    setTransform: (entity: EntityRecord, field: string, value: unknown) => ctxCalls.push(`setTransform:${field}:${JSON.stringify(value)}:${String(entity.ref.slot)}`),
    setVisible: (entity: EntityRecord, value: boolean) => ctxCalls.push(`setVisible:${String(value)}:${String(entity.ref.slot)}`),
    setParam: (entity: EntityRecord, name: string, value: unknown) => ctxCalls.push(`setParam:${name}:${JSON.stringify(value)}:${String(entity.ref.slot)}`),
  };
  const host: DynamicHost = {
    ctx,
    phase: "runtime:update",
    makeRecord: (ref, resolved, prefab, params) =>
      ({
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
        visible: true,
        state: Object.fromEntries(prefab.resolved.state.map((s) => [s.name, 0])),
        params,
        mat: resolved.instance === null ? null : { p: { color: { r: 0, g: 0, b: 0, a: 0 } } },
        light: null,
        ref,
      }),
    register: (slot) => {
      log.push(`register:${String(slot)}`);
    },
    unregister: (slot) => {
      log.push(`unregister:${String(slot)}`);
    },
    source: (spanId) => ({ file: "src/main.mtek", startByte: spanId, endByte: spanId + 1, startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 }),
    report: (diagnostic) => {
      reports.push(diagnostic);
    },
  };
  const code = options.code ?? ((symbol, l) => ({ init: (_ctx: object, _self: object, params: Readonly<Record<string, unknown>>) => l.push(`init:${symbol}:${String(params["n"])}`) }));
  const prefabs = new Map<string, PrefabRuntime>();
  const resolved = options.prefabs ?? [resolvedPrefab("A"), resolvedPrefab("B")];
  const programs = new Map<string, MtekProgramPrefab>(
    resolved.map((p) => [p.symbol, { init: () => undefined, update: null, fixedUpdate: null, events: {}, bindings: [], ...code(p.symbol, log) }]),
  );
  for (const [symbol, runtime] of buildPrefabRuntimes(resolved, programs)) prefabs.set(symbol, runtime);
  const dynamic = new DynamicEntities({ prefabs, staticCount: STATIC_COUNT, maxEntities: options.maxEntities ?? 100, firstInstance: FIRST_INSTANCE, host });
  const render: DynamicRender = {
    addEntity: (entity: ResolvedEntity) => log.push(`addEntity:${String(entity.index)}`),
    removeEntity: (entity: ResolvedEntity) => log.push(`removeEntity:${String(entity.index)}`),
  };
  const materials: DynamicMaterials = {
    createInstance: (instance: ResolvedInstance) => log.push(`createInstance:${String(instance.index)}`),
    removeInstance: (index: number) => log.push(`removeInstance:${String(index)}`),
    shareInstance: (index: number) => log.push(`shareInstance:${String(index)}`),
    writeParam: (instance: number, name: string) => log.push(`writeParam:${String(instance)}:${name}`),
  };
  if (options.attach !== false) dynamic.attach(render, materials);
  return { dynamic, log, reports, ctxCalls };
}

const A = "src/main.mtek::A";
const B = "src/main.mtek::B";

describe("a flush", () => {
  it("removes first, then creates in spawn order; creation: record, instance, object block, init, sharing", () => {
    const { dynamic, log } = harness();
    const first = dynamic.spawn(A, { n: 1 }, 0);
    dynamic.flush();
    log.length = 0;

    // Frame 2: destroy the first, spawn two (B then A).
    dynamic.destroy(first, 0);
    const second = dynamic.spawn(B, { n: 2 }, 0);
    const third = dynamic.spawn(A, { n: 3 }, 0);
    // Nothing has changed before the flush.
    expect(log).toEqual([]);
    expect(dynamic.alive(first)).toBe(false);
    expect(dynamic.alive(second)).toBe(false);
    expect(dynamic.live.map((e) => e.ref)).toEqual([first]);

    dynamic.flush();
    expect(log).toEqual([
      // The removal of slot 2 (first): the object block and the instance (index 5), then the record.
      "removeEntity:2",
      "removeInstance:5",
      "unregister:2",
      // Slot 3, instance 6 (5 was freed by the removal above: the creations reuse it first), then slot 4.
      "register:3",
      "createInstance:5",
      "addEntity:3",
      `init:${B}:2`,
      "shareInstance:5",
      "register:4",
      "createInstance:6",
      "addEntity:4",
      `init:${A}:3`,
      "shareInstance:6",
    ]);
    expect(dynamic.live.map((e) => [e.ref.slot, e.prefab.resolved.name, e.order])).toEqual([
      [3, "B", 1],
      [4, "A", 2],
    ]);
    expect(dynamic.alive(first)).toBe(false);
    expect(dynamic.alive(second)).toBe(true);
    expect(dynamic.alive(third)).toBe(true);
  });

  it("keeps the stable instance order: spawned entities in spawn order, whatever slots they reuse", () => {
    const { dynamic } = harness();
    const refs = [A, A, A, A].map((symbol, n) => dynamic.spawn(symbol, { n }, 0));
    dynamic.flush();
    // Destroy the second and the third, then spawn two more: they reuse the freed slots (last freed first).
    dynamic.destroy(refs[1], 0);
    dynamic.destroy(refs[2], 0);
    dynamic.flush();
    const e = dynamic.spawn(A, { n: 4 }, 0);
    const f = dynamic.spawn(A, { n: 5 }, 0);
    dynamic.flush();
    // Slots 3 and 4 were freed in that order, so the stack returns 4 first, then 3.
    expect([e.slot, f.slot]).toEqual([4, 3]);
    // The order is by spawn, not by slot: slot 2, slot 5, then e (slot 4) and f (slot 3).
    expect(dynamic.live.map((entity) => entity.ref.slot)).toEqual([2, 5, 4, 3]);
    expect(dynamic.live.map((entity) => entity.order)).toEqual([0, 3, 4, 5]);
  });

  it("gives the entity record the very params object init received, frozen", () => {
    const seen: unknown[] = [];
    const { dynamic } = harness({
      code: () => ({
        init: (_ctx: object, self: object, params: Readonly<Record<string, unknown>>) => {
          seen.push(params, (self as EntityRecord).params);
        },
      }),
    });
    const input = { n: 7 };
    dynamic.spawn(A, input, 0);
    dynamic.flush();
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).toEqual({ n: 7 });
    expect(Object.isFrozen(seen[0])).toBe(true);
    // The object the generated code built is not the one kept: changing it later changes nothing.
    input.n = 8;
    expect(dynamic.live[0]?.record.params["n"]).toBe(7);
  });

  it("does nothing, and bumps no version, when nothing is queued", () => {
    const { dynamic, log } = harness();
    const version = dynamic.version;
    dynamic.flush();
    expect(log).toEqual([]);
    expect(dynamic.version).toBe(version);
  });

  it("never creates a spawn that was destroyed before the flush (spawn then destroy in one handler)", () => {
    const { dynamic, log } = harness();
    const ref = dynamic.spawn(A, { n: 1 }, 0);
    dynamic.destroy(ref, 0);
    expect(dynamic.alive(ref)).toBe(false);
    dynamic.flush();
    expect(log).toEqual([]);
    expect(dynamic.live).toEqual([]);
    expect(dynamic.spawned).toBe(0);
    expect(dynamic.destroyed).toBe(0);
    // The slot is free again under a new generation.
    expect(dynamic.spawn(A, { n: 2 }, 0)).toEqual({ slot: 2, gen: 1 });
  });

  it("releases the instance index of a removed entity and reuses it", () => {
    const { dynamic } = harness();
    dynamic.spawn(A, { n: 1 }, 0);
    dynamic.spawn(A, { n: 2 }, 0);
    dynamic.flush();
    expect(dynamic.live.map((e) => e.resolved.instance?.index)).toEqual([5, 6]);
    dynamic.destroy(dynamic.live[0]?.ref ?? DEAD_REF, 0);
    dynamic.flush();
    dynamic.spawn(B, { n: 3 }, 0);
    dynamic.flush();
    expect(dynamic.live.map((e) => e.resolved.instance?.index)).toEqual([6, 5]);
  });

  it("a prefab without a mesh and material has no instance and still gets its entity record", () => {
    const { dynamic, log } = harness({ prefabs: [resolvedPrefab("A", { mesh: null, material: null })] });
    dynamic.spawn(A, { n: 1 }, 0);
    dynamic.flush();
    expect(log).toEqual(["register:2", "addEntity:2", `init:${A}:1`]);
    expect(dynamic.live[0]?.resolved.instance).toBeNull();
  });

  it("counts what was created and removed", () => {
    const { dynamic } = harness();
    for (let i = 0; i < 5; i += 1) dynamic.spawn(A, { n: i }, 0);
    dynamic.flush();
    dynamic.destroy(dynamic.live[1]?.ref ?? DEAD_REF, 0);
    dynamic.destroy(dynamic.live[3]?.ref ?? DEAD_REF, 0);
    expect(dynamic.aliveCount).toBe(STATIC_COUNT + 3);
    expect(dynamic.pendingRemovals).toBe(2);
    dynamic.flush();
    expect([dynamic.spawned, dynamic.destroyed, dynamic.aliveCount, dynamic.pendingRemovals]).toEqual([5, 2, STATIC_COUNT + 3, 0]);
  });
});

describe("pending removal (spec/scenes.md section 9)", () => {
  it("marks the entity at once: not alive, flagged, still in the list until the flush", () => {
    const { dynamic } = harness();
    const ref = dynamic.spawn(A, { n: 1 }, 0);
    dynamic.flush();
    dynamic.destroy(ref, 0);
    expect(dynamic.alive(ref)).toBe(false);
    expect(dynamic.status(ref)).toBe("pending-removal");
    expect(dynamic.live.map((e) => e.removing)).toEqual([true]);
    dynamic.flush();
    expect(dynamic.live).toEqual([]);
  });

  it("drops commands for it with W8031 (a pending, not yet created or dead entity), not for live or named entities", () => {
    const { dynamic, reports } = harness();
    const live = dynamic.spawn(A, { n: 1 }, 0);
    const doomed = dynamic.spawn(A, { n: 2 }, 0);
    dynamic.flush();
    const waiting = dynamic.spawn(A, { n: 3 }, 0);
    dynamic.destroy(doomed, 0);

    expect(dynamic.commandTarget(live, 7, "apply_impulse")?.ref).toEqual(live);
    expect(dynamic.commandTarget(makeRef(0, 0), 7, "apply_impulse")).toBeUndefined();
    expect(reports).toEqual([]);

    expect(dynamic.commandTarget(doomed, 7, "apply_impulse")).toBeUndefined();
    expect(dynamic.commandTarget(waiting, 8, "apply_impulse")).toBeUndefined();
    expect(dynamic.commandTarget(DEAD_REF, 9, "apply_impulse")).toBeUndefined();
    expect(reports.map((d) => [d.code, d.message])).toEqual([
      ["MTEK-W8031", "The command apply_impulse was dropped: its entity is pending removal."],
      ["MTEK-W8031", "The command apply_impulse was dropped: its entity is not created yet."],
      ["MTEK-W8031", "The command apply_impulse was dropped: its entity is destroyed or dead."],
    ]);
    expect(reports.map((d) => d.source?.startByte)).toEqual([7, 8, 9]);
    expect(reports.every((d) => d.severity === "warning")).toBe(true);
  });

  it("reports W8032 for destroying a dead or pending entity and E8030 for a named one, each at its span", () => {
    const { dynamic, reports } = harness();
    const ref = dynamic.spawn(A, { n: 1 }, 0);
    dynamic.flush();
    dynamic.destroy(ref, 10);
    dynamic.destroy(ref, 11); // pending
    dynamic.flush();
    dynamic.destroy(ref, 12); // dead
    dynamic.destroy(DEAD_REF, 13); // dead
    dynamic.destroy(makeRef(1, 0), 14); // named
    expect(reports.map((d) => [d.code, d.severity, d.source?.startByte])).toEqual([
      ["MTEK-W8032", "warning", 11],
      ["MTEK-W8032", "warning", 12],
      ["MTEK-W8032", "warning", 13],
      ["MTEK-E8030", "error", 14],
    ]);
    // Nothing was queued by any of them.
    expect(dynamic.pendingRemovals).toBe(0);
  });
});

describe("the entity limit (E8033)", () => {
  it("returns a dead reference, creates nothing and reports at the call", () => {
    const { dynamic, reports, log } = harness({ maxEntities: STATIC_COUNT + 2 });
    const a = dynamic.spawn(A, { n: 1 }, 20);
    const b = dynamic.spawn(A, { n: 2 }, 20);
    const refused = dynamic.spawn(A, { n: 3 }, 21);
    expect(refused).toBe(DEAD_REF);
    expect(reports.map((d) => [d.code, d.severity, d.source?.startByte])).toEqual([["MTEK-E8033", "error", 21]]);
    expect(reports[0]?.message).toContain("limit of 4");
    dynamic.flush();
    expect(dynamic.live.map((e) => e.ref)).toEqual([a, b]);
    expect(log.filter((line) => line.startsWith("init:"))).toHaveLength(2);
    expect(dynamic.alive(refused)).toBe(false);
    // Destroying the dead reference is a no-op with W8032.
    dynamic.destroy(refused, 22);
    expect(reports.at(-1)?.code).toBe("MTEK-W8032");
  });
});

describe("misuse by generated code is an internal error", () => {
  it("rejects an unknown prefab, a missing param and a non-reference", () => {
    const { dynamic } = harness();
    expect(() => dynamic.spawn("src/main.mtek::Nope", { n: 1 }, 0)).toThrow(RuntimeInternalError);
    expect(() => dynamic.spawn(A, {}, 0)).toThrow(/gives no value for the param 'n'/);
    expect(() => dynamic.spawn(A, 3, 0)).toThrow(RuntimeInternalError);
    expect(() => dynamic.destroy("x", 0)).toThrow(RuntimeInternalError);
    expect(() => dynamic.alive(null)).toThrow(RuntimeInternalError);
  });

  it("a spawn applied before the scene's stores exist is an internal error", () => {
    const { dynamic } = harness({ attach: false });
    dynamic.spawn(A, { n: 1 }, 0);
    expect(() => {
      dynamic.flush();
    }).toThrow(/before the scene's renderer and materials existed/);
  });
});

describe("lifecycle listeners (the physics hook)", () => {
  it("hears each creation, in spawn order, after init and the whole flush's list is consistent, and each removal before the release", () => {
    const { dynamic, log } = harness();
    const heard: string[] = [];
    dynamic.addListener({
      created: (entity: DynamicEntity) => {
        heard.push(`created:${String(entity.ref.slot)}:${String(dynamic.live.includes(entity))}`);
        entity.attachments.set("body", { slot: entity.ref.slot });
      },
      removed: (entity: DynamicEntity) => {
        heard.push(`removed:${String(entity.ref.slot)}:${JSON.stringify(entity.attachments.get("body"))}`);
        log.push("listener-removed");
      },
    });
    const a = dynamic.spawn(A, { n: 1 }, 0);
    dynamic.spawn(A, { n: 2 }, 0);
    dynamic.flush();
    dynamic.destroy(a, 0);
    log.length = 0;
    dynamic.flush();
    expect(heard).toEqual(["created:2:true", "created:3:true", 'removed:2:{"slot":2}']);
    // The listener runs before the entity's resources are released.
    expect(log.slice(0, 2)).toEqual(["listener-removed", "removeEntity:2"]);
  });

  it("a listener can be removed", () => {
    const { dynamic } = harness();
    const heard: number[] = [];
    const off = dynamic.addListener({ created: (entity) => heard.push(entity.ref.slot) });
    dynamic.spawn(A, { n: 1 }, 0);
    dynamic.flush();
    off();
    dynamic.spawn(A, { n: 2 }, 0);
    dynamic.flush();
    expect(heard).toEqual([2]);
  });
});

describe("bindings of instances", () => {
  const BINDINGS: readonly MtekBinding[] = [
    { id: 0, target: { kind: "param", instance: 0, name: "color" }, deps: [], order: 1, span: 0 },
    { id: 1, target: { kind: "transform", entity: 0, field: "position" }, deps: [], order: 0, span: 0 },
    { id: 2, target: { kind: "visible", entity: 0 }, deps: [], order: 2, span: 0 },
  ];

  function bound() {
    return harness({
      prefabs: [resolvedPrefab("A", { bindings: BINDINGS })],
      code: (symbol, log) => ({
        init: () => log.push("init"),
        bindings: [
          (_ctx: object, self: object) => {
            log.push(`bind0:${String((self as EntityRecord).ref.slot)}`);
            return "color-value";
          },
          () => "position-value",
          () => true,
        ],
      }),
    });
  }

  it("are evaluated once at creation, in `order`, then every flush-independent evaluation", () => {
    const { dynamic, ctxCalls, log } = bound();
    dynamic.spawn(A, { n: 1 }, 0);
    dynamic.flush();
    // order 0 (id 1) transform, order 1 (id 0) param, order 2 (id 2) visible.
    expect(ctxCalls).toEqual(['setTransform:position:"position-value":2', 'setParam:color:"color-value":2', "setVisible:true:2"]);
    expect(log.indexOf("init")).toBeLessThan(log.indexOf("bind0:2"));
    ctxCalls.length = 0;
    dynamic.evaluateBindings();
    expect(ctxCalls).toHaveLength(3);
  });

  it("skip an entity that is pending removal", () => {
    const { dynamic, ctxCalls } = bound();
    const a = dynamic.spawn(A, { n: 1 }, 0);
    dynamic.spawn(A, { n: 2 }, 0);
    dynamic.flush();
    ctxCalls.length = 0;
    dynamic.destroy(a, 0);
    dynamic.evaluateBindings();
    expect(ctxCalls.every((call) => call.endsWith(":3"))).toBe(true);
    expect(ctxCalls).toHaveLength(3);
  });
});

describe("device recovery (rebuild)", () => {
  it("creates each existing entity's instance and object block again under the same index, rewrites its mirrored params and keeps the entities", () => {
    const { dynamic, log } = harness();
    const a = dynamic.spawn(A, { n: 1 }, 0);
    const b = dynamic.spawn(B, { n: 2 }, 0);
    dynamic.flush();
    log.length = 0;
    const rebuilt: string[] = [];
    dynamic.rebuild(
      { addEntity: (entity) => rebuilt.push(`addEntity:${String(entity.index)}`), removeEntity: () => undefined },
      {
        createInstance: (instance) => rebuilt.push(`createInstance:${String(instance.index)}`),
        removeInstance: () => undefined,
        shareInstance: (index) => rebuilt.push(`shareInstance:${String(index)}`),
        writeParam: (instance, name) => rebuilt.push(`writeParam:${String(instance)}:${name}`),
      },
    );
    expect(rebuilt).toEqual([
      // `map` is a texture: a binding of the group, not a field of the block, so only `color` is written.
      "createInstance:5",
      "writeParam:5:color",
      "shareInstance:5",
      "addEntity:2",
      "createInstance:6",
      "writeParam:6:color",
      "shareInstance:6",
      "addEntity:3",
    ]);
    // init did not run again; the entities and references are the same.
    expect(log).toEqual([]);
    expect(dynamic.live.map((e) => e.ref)).toEqual([a, b]);
    expect(dynamic.alive(a)).toBe(true);
  });

  it("creates later spawns through the rebuilt stores", () => {
    const { dynamic } = harness();
    dynamic.spawn(A, { n: 1 }, 0);
    dynamic.flush();
    const rebuilt: string[] = [];
    dynamic.rebuild(
      { addEntity: (entity) => rebuilt.push(`addEntity:${String(entity.index)}`), removeEntity: () => undefined },
      { createInstance: () => undefined, removeInstance: () => undefined, shareInstance: () => undefined, writeParam: () => undefined },
    );
    rebuilt.length = 0;
    dynamic.spawn(A, { n: 2 }, 0);
    dynamic.flush();
    expect(rebuilt).toEqual(["addEntity:3"]);
  });
});

describe("hot reload (restoreFrom)", () => {
  it("creates the entities that exist again under the same slot, generation and params, in the same order, and carries state over", () => {
    const old = harness();
    const a = old.dynamic.spawn(A, { n: 1 }, 0);
    const b = old.dynamic.spawn(B, { n: 2 }, 0);
    const c = old.dynamic.spawn(A, { n: 3 }, 0);
    old.dynamic.flush();
    old.dynamic.destroy(b, 0);
    old.dynamic.flush();
    const stale = b;
    // The old world's entities: A(1) at slot 2, A(3) at slot 4; slot 3 was freed (generation 1).
    (old.dynamic.live[0]?.record.state as Record<string, unknown>)["age"] = 4.5;

    const next = harness();
    const carried: string[] = [];
    next.dynamic.restoreFrom(old.dynamic, (before, after) => {
      carried.push(`${String(before.ref.slot)}->${String(after.ref.slot)}`);
      after.record.state["age"] = before.record.state["age"];
    });
    expect(carried).toEqual(["2->2", "4->4"]);
    expect(next.dynamic.live.map((e) => [e.ref, e.record.params["n"], e.record.state["age"]])).toEqual([
      [a, 1, 4.5],
      [c, 3, 0],
    ]);
    // init of the new program ran with the retained params.
    expect(next.log.filter((line) => line.startsWith("init:"))).toEqual([`init:${A}:1`, `init:${A}:3`]);
    // References: the live ones are alive, the stale one stays dead, and slot 3 is reused under generation 1.
    expect(next.dynamic.alive(a)).toBe(true);
    expect(next.dynamic.alive(c)).toBe(true);
    expect(next.dynamic.alive(stale)).toBe(false);
    expect(next.dynamic.spawn(A, { n: 9 }, 0)).toEqual({ slot: 3, gen: 1 });
    expect([next.dynamic.spawned, next.dynamic.destroyed]).toEqual([3, 1]);
  });

  it("drops the entities of a prefab the new program no longer spawns; their references stay dead", () => {
    const old = harness();
    const a = old.dynamic.spawn(A, { n: 1 }, 0);
    const b = old.dynamic.spawn(B, { n: 2 }, 0);
    old.dynamic.flush();
    const next = harness({ prefabs: [resolvedPrefab("A")] });
    next.dynamic.restoreFrom(old.dynamic, () => undefined);
    expect(next.dynamic.live.map((e) => e.ref)).toEqual([a]);
    expect(next.dynamic.alive(b)).toBe(false);
  });

  it("forgets what was pending removal in the old world", () => {
    const old = harness();
    const a = old.dynamic.spawn(A, { n: 1 }, 0);
    old.dynamic.flush();
    old.dynamic.destroy(a, 0);
    const next = harness();
    next.dynamic.restoreFrom(old.dynamic, () => undefined);
    expect(next.dynamic.live).toEqual([]);
    expect(next.dynamic.alive(a)).toBe(false);
  });

  it("refuses a table that already holds entities", () => {
    const old = harness();
    const next = harness();
    next.dynamic.spawn(A, { n: 1 }, 0);
    next.dynamic.flush();
    expect(() => {
      next.dynamic.restoreFrom(old.dynamic, () => undefined);
    }).toThrow(RuntimeInternalError);
  });
});
