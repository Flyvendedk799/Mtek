/**
 * The compiler's `spawn` program (`tests/codegen/spawn`, decision 0064) end to end on the fake host: the real
 * generated code of prefab literals with params computed at run time, `entity_ref` state and comparison,
 * `alive`, `destroy`, prefab updates and handlers, and prefab bindings, against hand-derived values.
 *
 * Frames: the manual clock runs a tick when 1/60 s has accumulated. A first frame of 0.02 s has one tick; after
 * it 0.00333 s remain, so a frame of 0.01 s has none.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MtekManifest } from "../abi/manifest-types.js";
import type { MtekDiagnostic } from "../diagnostics/types.js";
import { FakeHost, asDom } from "../test-support/fake-host.js";
import { CODEGEN_DIR, loadGoldenProgram } from "../test-support/program.js";
import type { FakeBuffer } from "../test-support/fake-gpu.js";
import { mountMtekWith } from "./mount.js";
import type { MtekApp, MtekDebug } from "./types.js";

const f = Math.fround;
const TARGET = { width: 16, height: 8 } as const;
/** sRGB `#ff8800` in linear light, from the transfer function of the standard: the default `tint` of `Bullet`. */
const ORANGE = { r: 1, g: f(((0x88 / 255 + 0.055) / 1.055) ** 2.4), b: 0, a: 1 };

interface Run {
  readonly host: FakeHost;
  readonly app: MtekApp;
  readonly debug: MtekDebug;
  readonly manifest: MtekManifest;
  readonly reported: MtekDiagnostic[];
  /** The active time, accumulated like the scheduler's (binary64 sum of the clamped deltas). */
  time: number;
}

async function mountSpawn(): Promise<Run> {
  const golden = await loadGoldenProgram("spawn");
  const host = new FakeHost();
  for (const [url, text] of golden.files) host.files.set(url, text);
  const reported: MtekDiagnostic[] = [];
  const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), golden.program, {
    test: { manualClock: true, renderTarget: TARGET },
    onDiagnostic: (d) => reported.push(d),
  });
  if (app.debug === undefined) throw new Error("no debug API");
  return { host, app, debug: app.debug, manifest: golden.manifest, reported, time: 0 };
}

/** Presses `key`, runs one frame of `dt`, releases the key. */
function press(run: Run, key: string, dt: number): void {
  run.debug.pressKey(key);
  run.time += dt;
  run.debug.step(1, dt);
  run.debug.releaseKey(key);
}

function memberOffset(manifest: MtekManifest, layoutId: string, member: string): number {
  const node = manifest.layouts.find((layout) => layout.id === layoutId)?.root.members.find((m) => m.name === member)?.node;
  if (node === undefined) throw new Error(`no member ${member} in ${layoutId}`);
  return node.offset;
}

/** The model matrix in the object block of `slot` of the object arena (stride 256 on the fake device). */
function model(run: Run, objectSlot: number): Float32Array {
  const buffer: FakeBuffer | undefined = run.host.device.buffers.find((b) => b.label === "mtek:uniform-arena:builtin:object" && !b.destroyed);
  if (buffer === undefined) throw new Error("no object arena");
  const at = objectSlot * 256 + memberOffset(run.manifest, "builtin:object", "model");
  return new Float32Array(buffer.contents.buffer.slice(at, at + 64));
}

/** The 1-based line of the n-th line of the fixture that contains `text`. */
function lineOf(text: string, nth = 0): number {
  const lines = readFileSync(`${CODEGEN_DIR}/spawn/src/main.mtek`, "utf8").split("\n");
  const found = lines.flatMap((line, index) => (line.includes(text) ? [index + 1] : []));
  const line = found[nth];
  if (line === undefined) throw new Error(`the fixture has no line ${String(nth)} with ${text}`);
  return line;
}

describe("the spawn program", () => {
  it("mounts with the named Floor only; the prefabs are in the manifest and cost no entity", async () => {
    const run = await mountSpawn();
    expect(run.manifest.prefabs?.map((prefab) => [prefab.name, prefab.mesh, prefab.material?.id])).toEqual([
      ["Bullet", "mesh:1", "std/materials.mtek::Unlit"],
      ["Pulse", "mesh:2", "src/main.mtek::Glow"],
    ]);
    expect(run.debug.scene().spawned).toEqual([]);
    expect(run.debug.counters()).toMatchObject({ liveEntities: 1, entitySlots: 1 });
    expect(run.debug.scene().state).toMatchObject({ last: { slot: 0, gen: 0 }, anchor: { slot: 0, gen: 0 }, shots: 0 });
    run.app.dispose();
  });

  it("runs the scenario of the specification: spawn, alive, update, destroy, spawn+destroy, stale references, named entities", async () => {
    const run = await mountSpawn();

    // Frame 1 (one tick): Space spawns a Bullet whose origin and speed are computed from `shots` (0): origin
    // (0, 0, 0), speed 1. The reference is not alive when `alive` is asked in the handler. The flush before the tick
    // creates the entity, so its update runs in this frame: age = dt, x = 0 + speed * dt, with dt = f32(0.02).
    press(run, "Space", 0.02);
    const dt1 = f(0.02);
    expect(run.debug.scene().state).toMatchObject({ last: { slot: 1, gen: 0 }, shots: 1, same: false, live: false });
    expect(run.debug.scene().spawned).toMatchObject([
      {
        prefab: "Bullet",
        slot: 1,
        gen: 0,
        alive: true,
        position: { x: dt1, y: 0, z: 0 },
        scale: { x: 0.5, y: 0.5, z: 0.5 },
        visible: true,
        state: { age: dt1 },
        mat: { p: { color: ORANGE } },
      },
    ]);
    // Its object block holds the model matrix of its pose: translation (dt, 0, 0), scale 0.5 on the diagonal.
    const matrix = model(run, 1);
    expect([matrix[0], matrix[5], matrix[10], matrix[12], matrix[13], matrix[14]]).toEqual([0.5, 0.5, 0.5, dt1, 0, 0]);

    // Frame 2 (no tick): L asks `alive(last)` again: now true. The update adds dt = f32(0.01).
    press(run, "KeyL", 0.01);
    expect(run.debug.scene().state).toMatchObject({ live: true });
    const dt2 = f(0.01);
    expect(run.debug.scene().spawned[0]).toMatchObject({ position: { x: f(dt1 + dt2) }, state: { age: f(dt1 + dt2) } });

    // Frame 3 (a tick): the second Space spawns with shots = 1: origin (1, 0, 0), speed 2; slot 2.
    press(run, "Space", 0.02);
    expect(run.debug.scene().state).toMatchObject({ last: { slot: 2, gen: 0 }, shots: 2, same: false });
    const second = run.debug.scene().spawned[1];
    // x = 1 + f32(2 * dt1); the Floor is slot 0 and the two Bullets differ in speed, so their blocks differ.
    expect(second).toMatchObject({ prefab: "Bullet", slot: 2, position: { x: f(1 + f(2 * dt1)) } });
    expect(run.debug.counters()).toMatchObject({ liveEntities: 3, entitySlots: 3 });

    // Frame 4 (no tick): Enter destroys `last` (slot 2). `alive` is false at once; the flush after update removes it.
    press(run, "Enter", 0.01);
    expect(run.debug.scene().state).toMatchObject({ live: false });
    expect(run.debug.scene().spawned.map((entity) => entity.slot)).toEqual([1]);
    expect(run.debug.counters()).toMatchObject({ liveEntities: 2, entitiesSpawned: 2, entitiesDestroyed: 1 });

    // Frame 5: B spawns and destroys in one handler. The slot 2 is free (generation 1): the reference is {2, 1}, dead,
    // and nothing is created.
    press(run, "KeyB", 0.01);
    expect(run.debug.scene().state).toMatchObject({ last: { slot: 2, gen: 1 }, live: false });
    expect(run.debug.scene().spawned.map((entity) => entity.slot)).toEqual([1]);
    expect(run.debug.counters()).toMatchObject({ entitiesSpawned: 2, pendingSpawns: 0 });
    expect(run.reported).toEqual([]);

    // Frame 6: D destroys `last` twice. It is dead (cancelled spawn, generation 2 now): W8032 at each call.
    press(run, "KeyD", 0.01);
    const destroyLines = [lineOf("destroy(last);", 1), lineOf("destroy(last);", 2)];
    expect(run.reported.map((d) => [d.code, d.severity, d.source?.startLine])).toEqual([
      ["MTEK-W8032", "warning", destroyLines[0]],
      ["MTEK-W8032", "warning", destroyLines[1]],
    ]);

    // Frame 7: F destroys the named Floor through the reference in `anchor`: E8030, and the Floor stays.
    press(run, "KeyF", 0.01);
    expect(run.reported.at(-1)).toMatchObject({ code: "MTEK-E8030", severity: "error", source: { startLine: lineOf("destroy(anchor);") } });
    expect(run.debug.scene().entities.map((entity) => entity.name)).toEqual(["Floor"]);
    expect(run.debug.counters()).toMatchObject({ liveEntities: 2 });

    // Frame 8: P spawns a Pulse (base 0.5). Its scale and its material level are bound to base + frame.time, evaluated at
    // creation and in phase 5 of the same frame; frame.time is f32 of the active time.
    press(run, "KeyP", 0.02);
    const t8 = f(run.time);
    const pulse = run.debug.scene().spawned.find((entity) => entity.prefab === "Pulse");
    expect(pulse).toMatchObject({ slot: 2, gen: 2, scale: { x: f(0.5 + t8), y: f(0.5 + t8), z: f(0.5 + t8) } });
    expect(pulse?.mat?.p).toMatchObject({ tint: { r: 0, g: 1, b: 0, a: 1 }, level: f(0.5 + t8) });
    // The Pulse took the object block of the Bullet that was removed (slot 2 of the arena is free again).
    const pulseMatrix = model(run, 2);
    expect([pulseMatrix[0], pulseMatrix[5], pulseMatrix[10]]).toEqual([f(0.5 + t8), f(0.5 + t8), f(0.5 + t8)]);

    // Frame 9: the bindings are evaluated every frame.
    press(run, "KeyH", 0.02);
    const t9 = f(run.time);
    expect(run.debug.scene().spawned.find((entity) => entity.prefab === "Pulse")).toMatchObject({
      scale: { x: f(0.5 + t9) },
      state: { hits: 1 },
      mat: { p: { level: f(0.5 + t9) } },
    });
    expect(model(run, 2)[0]).toBe(f(0.5 + t9));

    // Frame 10 (no tick): X is the Bullet's own handler: age = life; its update then destroys it (`destroy(self)`), and
    // the flush after update removes it in the same frame. The Pulse has no handler for X.
    press(run, "KeyX", 0.01);
    expect(run.debug.scene().spawned.map((entity) => entity.prefab)).toEqual(["Pulse"]);
    expect(run.debug.counters()).toMatchObject({ liveEntities: 2, entitiesDestroyed: 2 });
    run.app.dispose();
    expect(run.debug.counters()).toMatchObject({ liveBuffers: 0, liveBindGroups: 0, livePipelines: 0 });
  });
});
