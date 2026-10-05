// Execution test of the lifecycle functions and handlers of the generated program module
// (spec/runtime-abi.md sections 3 and 4.2, spec/scenes.md sections 9 to 12, tasks M3-01 and
// M3-02): the `state_and_handlers` fixture's functions run against a fake context, with no
// browser. State lives in `ctx.s` and `ctx.e[i].state`; writes go through the setters.
import { describe, expect, it } from "vitest";
import { type SetterCall, createFakeContext } from "./support/fake-ctx.js";
import { loadProgram, record } from "./support/programs.js";

type Fn = (...args: unknown[]) => void;

interface Handler {
  readonly key?: string;
  readonly owner: number;
  readonly fn: Fn;
}

async function demo(): Promise<{
  scene: Readonly<Record<string, unknown>>;
  ctx: ReturnType<typeof createFakeContext>["ctx"] & { cam?: unknown };
  calls: SetterCall[];
}> {
  const program = await loadProgram("state_and_handlers");
  const scenes = record(program.module["scenes"], "scenes");
  const scene = record(scenes["Demo"], "scene");
  const made = createFakeContext(program.manifest.scene.entities.length);
  (scene["init"] as Fn)(made.ctx);
  made.calls.length = 0;
  return { scene, ctx: made.ctx, calls: made.calls };
}

describe("lifecycle functions and handlers of the state_and_handlers program", () => {
  it("init assigns the state in declaration order, with calls into CPU functions", async () => {
    const { ctx } = await demo();
    expect(ctx.s).toEqual({ speed: 0.5, angle: 0, ticks: 0 });
    expect(ctx.e[0]?.state).toEqual({ hits: 1 });
  });

  it("update advances state in binary32 and writes through the setters", async () => {
    const { scene, ctx, calls } = await demo();
    (scene["update"] as Fn)(ctx, 0.25);
    expect(ctx.s["angle"]).toBe(Math.fround(0.5 * 0.25));
    expect(ctx.s["ticks"]).toBe(1);
    expect(calls.map((c) => [c.method, c.entity, c.field])).toEqual([
      ["setTransform", 0, "position"],
      ["setParam", 0, "phase"],
      ["setCamera", -1, "position"],
    ]);
    expect(calls[0]?.value).toEqual({ x: 0, y: 0.5, z: 0 });
    expect(calls[1]?.value).toBe(ctx.s["angle"]);
    expect(calls[2]?.value).toEqual({ x: 0, y: 1, z: 6 });
  });

  it("fixed_update and the entity's update reach the same state", async () => {
    const { scene, ctx } = await demo();
    (scene["fixedUpdate"] as Fn)(ctx, 0.125);
    expect(ctx.s["speed"]).toBe(0.375);
    const entityUpdate = scene["entityUpdate"] as (Fn | null)[];
    expect(entityUpdate).toHaveLength(1);
    (entityUpdate[0] as Fn)(ctx, ctx.e[0], 0.016);
    expect(ctx.e[0]?.state["hits"]).toBe(2);
  });

  it("the events table lists handlers per event with DOM key codes and owner indexes", async () => {
    const { scene } = await demo();
    const events = record(scene["events"], "events") as Record<string, Handler[]>;
    expect(Object.keys(events)).toEqual(["key_down", "pointer_down"]);
    expect(events["key_down"]?.map((h) => [h.key, h.owner])).toEqual([
      ["Space", -1],
      ["Enter", 0],
    ]);
    expect(events["pointer_down"]?.map((h) => [h.key, h.owner])).toEqual([[undefined, -1]]);
  });

  it("handlers run against state: Space negates the speed and resets hits, Enter counts", async () => {
    const { scene, ctx } = await demo();
    const events = record(scene["events"], "events") as Record<string, Handler[]>;
    const [space, enter] = events["key_down"] ?? [];
    space?.fn(ctx, null);
    expect(ctx.s["speed"]).toBe(-0.5);
    expect(ctx.e[0]?.state["hits"]).toBe(0);
    enter?.fn(ctx, ctx.e[0]);
    enter?.fn(ctx, ctx.e[0]);
    expect(ctx.e[0]?.state["hits"]).toBe(2);
    events["pointer_down"]?.[0]?.fn(ctx, null, { position: { x: 0.75, y: 0 } });
    expect(ctx.s["angle"]).toBe(0.75);
  });
});
