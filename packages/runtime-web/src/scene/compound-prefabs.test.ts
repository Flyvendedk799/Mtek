import { describe, expect, it } from "vitest";
import type { MtekDiagnostic } from "../diagnostics/types.js";
import { mountMtekWith } from "../host/mount.js";
import { FakeHost, asDom } from "../test-support/fake-host.js";
import { loadGoldenProgram } from "../test-support/program.js";
import { Bindings } from "./bindings.js";
import { checkProgram } from "./program.js";
import { resolveStructure } from "./structure.js";
import { World } from "./world.js";

async function assembly() {
  const golden = await loadGoldenProgram("compound_prefabs");
  const checked = checkProgram(golden.program, golden.manifest);
  const structure = resolveStructure(golden.manifest);
  if (!checked.ok || !structure.ok) throw new Error("invalid assembly program");
  const reported: MtekDiagnostic[] = [];
  const writes: { instance: number; name: string; value: unknown }[] = [];
  const world = new World({
    manifest: golden.manifest,
    structure: structure.structure,
    params: { writeParam: (instance, name, value) => writes.push({ instance, name, value }) },
    report: (d) => reported.push(d),
  });
  const scene = checked.program.scene;
  const bindings = new Bindings(golden.manifest, scene.bindings, world);
  world.initialise(scene.init, () => bindings.evaluate());
  const update = (dt: number): void => {
    scene.update?.(world.ctx, dt);
    scene.entityUpdate.forEach((fn, index) => {
      const record = world.entities[index];
      if (record !== undefined) fn?.(world.ctx, record, dt);
    });
    bindings.evaluate();
    world.propagate();
  };
  return { golden, world, bindings, scene, writes, reported, update };
}

const GREEN = { r: 0, g: 1, b: 0, a: 1 };
const RED = { r: 1, g: 0, b: 0, a: 1 };

describe("compiled static prefab assemblies", () => {
  it("initializes two independent roots and descendants, with parent-relative geometry", async () => {
    const { golden, world, reported } = await assembly();
    expect(golden.program.prefabs).toEqual({});
    expect(golden.manifest.prefabs).toBeUndefined();
    expect(golden.manifest.scene.entities.map((e) => [e.name, e.parent])).toEqual([
      ["Left", null], ["Left.Seat", 0], ["Left.Seat.Badge", 1], ["Left.Back", 0],
      ["Marker", null], ["Right", null], ["Right.Seat", 5], ["Right.Seat.Badge", 6], ["Right.Back", 5],
    ]);
    const translation = (index: number): number[] => Array.from(world.worldMatrix(index).slice(12, 15));
    expect(translation(1)).toEqual([-3, 1, 0]);
    expect(translation(2)).toEqual([-3, 1, 0]);
    expect(translation(3)).toEqual([-3, 2, -1]);
    expect(translation(6)).toEqual([3, 1, 0]);
    expect(translation(8)).toEqual([3, 2, -1]);
    expect(translation(4)).toEqual([3, 0, 0]);
    expect(world.entities[0]?.state).not.toBe(world.entities[5]?.state);
    expect(world.entities[1]?.state).toEqual({ ticks: 0, captured: world.entities[0]?.state["seat_color"] });
    expect(world.entities[6]?.state).toEqual({ ticks: 0, captured: world.entities[5]?.state["seat_color"] });
    expect(world.entities[1]?.mat?.p["base_color"]).not.toEqual(world.entities[6]?.mat?.p["base_color"]);
    expect(reported).toEqual([]);
  });

  it("remaps root state, child self, sibling reads and material bindings per instance", async () => {
    const { golden, world, bindings, update, writes, reported } = await assembly();
    const left = world.entities[0];
    if (left === undefined) throw new Error("missing root");
    left.state["seat_color"] = GREEN;
    bindings.evaluate();
    expect(world.entities[1]?.mat?.p["base_color"]).toEqual(GREEN);
    expect(world.entities[3]?.mat?.p["base_color"]).toEqual(GREEN);
    expect(world.entities[6]?.mat?.p["base_color"]).not.toEqual(GREEN);
    writes.length = 0;
    update(Math.fround(0.25));
    expect(world.entities[0]?.state["angle"]).toBe(0.25);
    expect(world.entities[5]?.state["angle"]).toBe(0.25);
    expect(world.entities[1]?.state["ticks"]).toBe(1);
    expect(world.entities[6]?.state["ticks"]).toBe(1);
    expect(world.entities[6]?.mat?.p["base_color"]).toEqual(RED);
    expect(world.entities[8]?.mat?.p["base_color"]).toEqual(RED);
    const parts = golden.manifest.scene.materialInstances.filter((i) => [1, 3, 6, 8].includes(i.entity));
    expect(writes.filter((w) => w.name === "base_color").map((w) => [w.instance, w.value])).toEqual([
      [parts[0]?.index, GREEN], [parts[1]?.index, GREEN], [parts[2]?.index, RED], [parts[3]?.index, RED],
    ]);
    // Badge local x = Seat.ticks. The seat scales x by 2, then the root rotates the whole hierarchy.
    expect(world.worldMatrix(2)[12]).toBeCloseTo(-3 + 2 * Math.cos(0.25), 5);
    expect(world.worldMatrix(2)[14]).toBeCloseTo(-2 * Math.sin(0.25), 5);
    expect(world.worldMatrix(7)[12]).toBeCloseTo(3 + 2 * Math.cos(0.25), 5);
    expect(reported).toEqual([]);
  });

  it("dispatches per-part events and keeps hidden named parts alive and updating", async () => {
    const { world, scene, update, reported } = await assembly();
    for (const handler of scene.events.key_down ?? []) {
      if (handler.key === "Space") handler.fn(world.ctx, world.entities[handler.owner] ?? null, undefined);
    }
    expect(world.entities[1]?.visible).toBe(false);
    expect(world.entities[6]?.visible).toBe(false);
    expect(world.entities[2]?.visible).toBe(true);
    update(0.02);
    expect(world.entities[1]?.state["ticks"]).toBe(1);
    expect(world.entities[6]?.state["ticks"]).toBe(1);
    expect(reported).toEqual([]);
  });

  it("mounts through the real renderer and releases all assembly GPU resources on disposal", async () => {
    const golden = await loadGoldenProgram("compound_prefabs");
    const host = new FakeHost();
    for (const [url, text] of golden.files) host.files.set(url, text);
    const reported: MtekDiagnostic[] = [];
    const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), golden.program, {
      test: { manualClock: true, renderTarget: { width: 16, height: 8 } },
      onDiagnostic: (d) => reported.push(d),
    });
    if (app.debug === undefined) throw new Error("missing debug API");
    app.debug.step(4, 0.02);
    expect(app.debug.scene().entities).toHaveLength(9);
    expect(app.debug.counters()).toMatchObject({ liveEntities: 9, entitiesSpawned: 0 });
    expect(reported).toEqual([]);
    app.dispose();
    expect(app.debug.counters()).toMatchObject({ liveBuffers: 0, liveBindGroups: 0, livePipelines: 0 });
  });
});
