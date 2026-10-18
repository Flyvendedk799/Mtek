// Execution test of dynamic entities in the generated program module (spec/scenes.md section 9,
// spec/runtime-abi.md sections 3 and 4.2, task M5-02, decision 0064): the `spawn` fixture's handlers, prefab
// code and `entity_ref` comparisons run against a fake context that records `spawn`, `destroy` and `alive`, with
// no browser. The runtime's own behaviour (queues, generations, flush points) is tested in packages/runtime-web.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { codegenDir } from "./support/fixtures.js";
import { loadProgram, record } from "./support/programs.js";

type Fn = (...args: unknown[]) => unknown;

interface Ref {
  readonly slot: number;
  readonly gen: number;
}

interface Call {
  readonly method: "spawn" | "destroy" | "alive";
  readonly args: readonly unknown[];
}

interface Handler {
  readonly key?: string;
  readonly owner: unknown;
  readonly fn: Fn;
}

const BULLET = "src/main.mtek::Bullet";
const PULSE = "src/main.mtek::Pulse";

/** A context whose `spawn` hands out references `{ slot: 10 + n, gen: 0 }` and whose `alive` answers from `liveRefs`. */
function context(liveRefs: ReadonlySet<number> = new Set()) {
  const calls: Call[] = [];
  const floor: { ref: Ref; state: Record<string, unknown> } = { ref: Object.freeze({ slot: 0, gen: 0 }), state: {} };
  let spawned = 0;
  const ctx = {
    s: {} as Record<string, unknown>,
    e: [floor],
    frame: { time: 0, delta: 0, index: 0 },
    spawn(...args: unknown[]): Ref {
      calls.push({ method: "spawn", args });
      return Object.freeze({ slot: 10 + spawned++, gen: 0 });
    },
    destroy(...args: unknown[]): void {
      calls.push({ method: "destroy", args });
    },
    alive(ref: Ref): boolean {
      calls.push({ method: "alive", args: [ref] });
      return liveRefs.has(ref.slot);
    },
  };
  return { ctx, calls, floor };
}

async function handlers(): Promise<Map<string, Handler>> {
  const { module } = await loadProgram("spawn");
  const scenes = record(module["scenes"], "scenes");
  const events = record(record(scenes["Demo"], "Demo")["events"], "events") as Record<string, Handler[]>;
  return new Map((events["key_down"] ?? []).map((handler) => [handler.key ?? "", handler]));
}

/** The source text of manifest span `id`. */
async function spanText(id: number): Promise<string> {
  const { manifest } = await loadProgram("spawn");
  const span = manifest.spans[id];
  if (span === undefined) throw new Error(`no span ${String(id)}`);
  return readFileSync(resolve(codegenDir, "spawn", "src", "main.mtek"), "utf8").slice(span.start, span.end);
}

describe("spawn, destroy and alive in the generated scene", () => {
  it("a prefab literal becomes ctx.spawn(symbol, params, span): every param, computed values and defaults included", async () => {
    const space = (await handlers()).get("Space");
    const { ctx, calls, floor } = context();
    ctx.s["shots"] = 2;
    ctx.s["last"] = floor.ref;
    space?.fn(ctx, null);
    const [spawn, alive] = calls;
    expect(calls.map((call) => call.method)).toEqual(["spawn", "alive"]);
    const [prefab, params, span] = spawn?.args ?? [];
    expect(prefab).toBe(BULLET);
    // origin = vec3(f32(shots), 0, 0) and speed = f32(shots + 1) are computed from the scene state; tint and life are the defaults.
    expect(params).toMatchObject({ origin: { x: 2, y: 0, z: 0 }, speed: 3, life: 1, tint: { r: 1, b: 0, a: 1 } });
    expect(Object.keys(params as object)).toEqual(["origin", "speed", "tint", "life"]);
    // The span names the call in the source.
    expect(await spanText(span as number)).toMatch(/^spawn\(Bullet \{/);
    // The result is stored, `shots` counts, and a reference is not alive until the flush: here the stub says no.
    expect(ctx.s["last"]).toEqual({ slot: 10, gen: 0 });
    expect(ctx.s["shots"]).toBe(3);
    expect(ctx.s["same"]).toBe(false);
    expect(ctx.s["live"]).toBe(false);
    expect(alive?.args).toEqual([{ slot: 10, gen: 0 }]);
  });

  it("== on references is rt.refEq: slot and generation must both be equal", async () => {
    const { dir, runtimeFile, appText } = await loadProgram("spawn");
    // The generated code compares with the runtime helper, never with ===.
    expect(appText).toContain("rt.refEq(ctx.s.last, ctx.e[0].ref)");
    const rt = (await import(/* @vite-ignore */ pathToFileURL(resolve(dir, runtimeFile)).href)) as { refEq(a: Ref, b: Ref): boolean };
    expect(rt.refEq({ slot: 0, gen: 0 }, { slot: 0, gen: 0 })).toBe(true);
    expect(rt.refEq({ slot: 0, gen: 0 }, { slot: 0, gen: 1 })).toBe(false);
    expect(rt.refEq({ slot: 3, gen: 2 }, { slot: 4, gen: 2 })).toBe(false);
    // And the scene state holds the named Floor as the reference {0, 0}: `same` is false after a spawn, true before one.
    const space = (await handlers()).get("Space");
    const { ctx, floor } = context();
    ctx.s["shots"] = 0;
    ctx.s["last"] = floor.ref;
    space?.fn(ctx, null);
    expect(ctx.s["same"]).toBe(false);
  });

  it("spawn and destroy in one handler pass the reference through and ask alive afterwards", async () => {
    const handler = (await handlers()).get("KeyB");
    const { ctx, calls } = context();
    handler?.fn(ctx, null);
    expect(calls.map((call) => call.method)).toEqual(["spawn", "destroy", "alive"]);
    const made = { slot: 10, gen: 0 };
    expect(calls[1]?.args.slice(0, 1)).toEqual([made]);
    expect(calls[2]?.args).toEqual([made]);
    expect(ctx.s["last"]).toEqual(made);
    // Different spans for the spawn and the destroy.
    expect(await spanText(calls[0]?.args[2] as number)).toMatch(/^spawn\(Bullet \{/);
    expect(await spanText(calls[1]?.args[1] as number)).toBe("destroy(made)");
  });

  it("destroying a stored reference (the named Floor in `anchor`) is an ordinary ctx.destroy call", async () => {
    const handler = (await handlers()).get("KeyF");
    const { ctx, calls, floor } = context();
    ctx.s["anchor"] = floor.ref;
    handler?.fn(ctx, null);
    expect(calls).toEqual([{ method: "destroy", args: [floor.ref, calls[0]?.args[1]] }]);
    expect(await spanText(calls[0]?.args[1] as number)).toBe("destroy(anchor)");
  });
});

describe("the prefabs table of the spawn program", () => {
  async function prefabs(): Promise<Record<string, Record<string, unknown>>> {
    const { module } = await loadProgram("spawn");
    const table = record(module["prefabs"], "prefabs");
    return Object.fromEntries(Object.entries(table).map(([symbol, entry]) => [symbol, record(entry, symbol) as Record<string, unknown>]));
  }

  it("lists both prefabs, with update, handlers and bindings where they are declared", async () => {
    const table = await prefabs();
    expect(Object.keys(table)).toEqual([BULLET, PULSE]);
    expect(typeof table[BULLET]?.["update"]).toBe("function");
    expect(table[PULSE]?.["update"]).toBeNull();
    expect(table[BULLET]?.["bindings"]).toEqual([]);
    expect(table[PULSE]?.["bindings"]).toHaveLength(2);
  });

  it("a prefab destroys itself with destroy(self.ref, span) once it has lived long enough", async () => {
    const update = (await prefabs())[BULLET]?.["update"] as Fn;
    const { ctx, calls } = context();
    const self = { ref: Object.freeze({ slot: 5, gen: 3 }), state: { age: 0.9 }, position: { x: 0, y: 0, z: 0 }, params: { speed: 2, life: 1 } };
    // Setters are not part of this fake: update moves the entity through ctx.setTransform.
    const moves: unknown[] = [];
    const full = { ...ctx, setTransform: (_entity: unknown, field: string, value: unknown) => moves.push([field, value]) };
    update(full, self, 0.05);
    expect(calls).toEqual([]);
    expect(self.state.age).toBe(Math.fround(0.9 + Math.fround(0.05)));
    update(full, self, 0.2);
    expect(calls.map((call) => call.method)).toEqual(["destroy"]);
    expect(calls[0]?.args[0]).toBe(self.ref);
    expect(await spanText(calls[0]?.args[1] as number)).toBe("destroy(self)");
    expect(moves).toHaveLength(2);
  });

  it("the bindings of a prefab read self.params and the frame, as (ctx, self) => value", async () => {
    const bindings = (await prefabs())[PULSE]?.["bindings"] as Fn[];
    const self = { params: { base: 0.5 }, state: {} };
    const { ctx } = context();
    const withTime = { ...ctx, frame: { time: 0.25, delta: 0, index: 0 } };
    expect(bindings[0]?.(withTime, self)).toEqual({ x: 0.75, y: 0.75, z: 0.75 });
    expect(bindings[1]?.(withTime, self)).toBe(0.75);
  });
});
