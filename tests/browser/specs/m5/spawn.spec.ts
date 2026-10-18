// M5-02: spawned and destroyed prefab instances on the real GPU (spec/scenes.md sections 9 and 10, decision 0064).
// The `spawn_ring` fixture keeps eight blocks on screen: each press of Space destroys the block in the next slot of a
// ring (when there is one) and spawns a new one in its place. The picture is read back from the offscreen
// `rgba8unorm-srgb` target after the first eight presses and after 208, and the pixels are compared with positions and
// colours derived by hand from the program (support/m5-scenes.ts: orthographic camera, 16 pixels per unit):
//   block n sits in column n % 8 at x = 2 * column - 7, i.e. around pixel ((x + 10) * 16, 80), with palette[n % 3].
// The renderer counters must show a bounded population all the way: the same live buffers, bind groups, parameter
// blocks and entity slots after the 9th press and after the 208th, and all of it released after the ring is cleared.
import type { Page } from "@playwright/test";
import { expect, test } from "../../support/fixtures.ts";
import { expectedRgb8 } from "../../support/m1-reference.ts";
import { PALETTE, RING_CLEAR, RING_MARKER, RING_SIZE, RING_TARGET, blockCentre, blockColourIndex, ringColumn } from "../../support/m5-scenes.ts";
import { SPAWN_RING } from "../../support/m5-fixtures.ts";
import { rgbClose } from "../m1/support.ts";

interface DiagnosticLike {
  code: string;
  severity: string;
  message: string;
}

interface AppLike {
  state: string;
  debug: {
    pressKey(code: string): void;
    releaseKey(code: string): void;
    step(frames: number, dtSeconds: number): void;
    readPixels(): Promise<{ width: number; height: number; data: Uint8Array }>;
    counters(): Record<string, number>;
    scene(): { spawned: Array<{ prefab: string; slot: number; gen: number; alive: boolean }> };
  };
  dispose(): void;
}

interface Shot {
  /** Presses made before this shot. */
  presses: number;
  counters: Record<string, number>;
  /** RGBA, top row first. */
  pixels: Uint8Array;
  spawned: Array<{ prefab: string; slot: number; gen: number; alive: boolean }>;
}

/** What a run does between two shots: `count` presses of `key`, one frame each. */
interface Burst {
  key: "Space" | "KeyC";
  count: number;
  /** Take the counters after every press, not only at the end. */
  trace?: boolean;
}

interface Run {
  shots: Shot[];
  /** The counters after every press of a traced burst, in order. */
  trace: Array<Record<string, number>>;
  reported: DiagnosticLike[];
  state: string;
}

const STEP = 1 / 60;
/** The counters that count what is alive on the GPU or in the entity table; they must not grow with the number of presses. */
const STEADY = ["liveBuffers", "liveBindGroups", "liveTextures", "liveSamplers", "livePipelines", "ownedParamBlocks", "sharedParamBlocks", "liveEntities", "entitySlots", "drawCalls", "instancedDraws"] as const;

/** Mounts the fixture and runs the bursts; takes a shot (counters and pixels) before the first and after every burst. */
async function run(page: Page, bursts: readonly Burst[]): Promise<Run> {
  await page.goto(`/m5/${SPAWN_RING}/index.html`);
  const raw = await page.evaluate(
    async ({ target, plan, dt }) => {
      const w = window as unknown as { __mtekMount: (options: object) => Promise<AppLike> };
      const reported: DiagnosticLike[] = [];
      const app = await w.__mtekMount({
        test: { manualClock: true, renderTarget: target },
        onDiagnostic: (d: DiagnosticLike) => reported.push(d),
      });
      const toBase64 = (bytes: Uint8Array): string => {
        let text = "";
        for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(text);
      };
      let presses = 0;
      const shots: { presses: number; counters: Record<string, number>; pixels: string; spawned: Shot["spawned"] }[] = [];
      const trace: Record<string, number>[] = [];
      const shoot = async (): Promise<void> => {
        const frame = await app.debug.readPixels();
        shots.push({ presses, counters: { ...app.debug.counters() }, pixels: toBase64(frame.data), spawned: app.debug.scene().spawned.map((s) => ({ ...s })) });
      };
      app.debug.step(1, dt);
      await shoot();
      for (const burst of plan) {
        for (let i = 0; i < burst.count; i += 1) {
          app.debug.pressKey(burst.key);
          app.debug.step(1, dt);
          app.debug.releaseKey(burst.key);
          if (burst.key === "Space") presses += 1;
          if (burst.trace === true) trace.push({ ...app.debug.counters() });
        }
        await shoot();
      }
      const state = app.state;
      app.dispose();
      return { shots, trace, reported, state };
    },
    { target: RING_TARGET, plan: [...bursts], dt: STEP },
  );
  return {
    shots: raw.shots.map((shot) => ({ ...shot, pixels: new Uint8Array(Buffer.from(shot.pixels, "base64")) })),
    trace: raw.trace,
    reported: raw.reported,
    state: raw.state,
  };
}

function pixel(shot: Shot, x: number, y: number): [number, number, number] {
  const i = (y * RING_TARGET.width + x) * 4;
  return [shot.pixels[i] ?? -1, shot.pixels[i + 1] ?? -1, shot.pixels[i + 2] ?? -1];
}

function pick(counters: Record<string, number>): Record<string, number> {
  return Object.fromEntries(STEADY.map((name) => [name, counters[name] ?? Number.NaN]));
}

/**
 * Asserts the picture after `presses` presses of Space: the marker, the clear colour between the blocks and, in each
 * column, the block of the last press that went there (the colour of press n is palette[n % 3]).
 */
function expectRing(shot: Shot, presses: number, label: string, since = 0): void {
  const marker = pixel(shot, RING_MARKER.x, RING_MARKER.y);
  expect(rgbClose(marker, expectedRgb8("#ffffff")), `${label}: marker ${marker.join(",")}`).toBe(true);
  const between = pixel(shot, 160, 20);
  expect(rgbClose(between, expectedRgb8(RING_CLEAR)), `${label}: clear colour ${between.join(",")}`).toBe(true);
  for (let column = 0; column < RING_SIZE; column += 1) {
    const centre = blockCentre(column);
    const got = pixel(shot, centre.x, centre.y);
    const latest = ringColumn(presses, column, since);
    const want = latest === undefined ? expectedRgb8(RING_CLEAR) : expectedRgb8(PALETTE[blockColourIndex(latest)] ?? "#000000");
    expect(rgbClose(got, want), `${label}: column ${String(column)} (press ${String(latest)}) at (${String(centre.x)}, ${String(centre.y)}): ${got.join(",")} vs ${want.join(",")}`).toBe(true);
    // The pixels just outside the 16 x 16 block are not block colours: the footprint is the block and nothing else.
    const outside = pixel(shot, centre.x, centre.y + 12);
    expect(rgbClose(outside, expectedRgb8(RING_CLEAR)), `${label}: below column ${String(column)}: ${outside.join(",")}`).toBe(true);
  }
}

test.describe("spawn and destroy on the real GPU (M5-02)", () => {
  test("a ring of spawned blocks: right pixels, a bounded population and nothing left behind", async ({ page, gpu }, testInfo) => {
    void gpu;
    const result = await run(page, [
      { key: "Space", count: 8, trace: true },
      { key: "Space", count: 200, trace: true },
      { key: "KeyC", count: 1 },
    ]);
    const [empty, eight, many, cleared] = result.shots;
    if (empty === undefined || eight === undefined || many === undefined || cleared === undefined) throw new Error("missing shots");
    expect(result.state).toBe("running");
    expect(result.reported.map((d) => d.code), "no runtime diagnostics").toEqual([]);

    // Before the first press only the named marker is there.
    expect(empty.spawned).toEqual([]);
    expect(empty.counters).toMatchObject({ liveEntities: 1, drawCalls: 1, entitySlots: 1, ownedParamBlocks: 1, sharedParamBlocks: 0 });
    expectRing(empty, 0, "empty");

    // After eight presses: eight blocks of three colours in columns 0..7, grouped by colour into three instanced draws
    // (colour n % 3: press 0, 3, 6 / 1, 4, 7 / 2, 5), and the marker alone: four draws.
    expectRing(eight, 8, "after 8 presses");
    expect(eight.spawned.map((s) => [s.prefab, s.slot, s.gen])).toEqual(Array.from({ length: RING_SIZE }, (_, n) => ["Block", n + 1, 0]));
    expect(eight.counters).toMatchObject({ liveEntities: 9, entitiesSpawned: 8, entitiesDestroyed: 0, drawCalls: 4, instancedDraws: 3, sharedParamBlocks: 3, ownedParamBlocks: 1, entitySlots: 9 });

    // After 208 presses: the same ring, 200 blocks later. Block n went into column n % 8, so the live blocks are presses 200..207.
    expectRing(many, 208, "after 208 presses");
    expect(many.spawned).toHaveLength(RING_SIZE);
    expect(many.counters).toMatchObject({ liveEntities: 9, entitiesSpawned: 208, entitiesDestroyed: 200, drawCalls: 4, instancedDraws: 3, sharedParamBlocks: 3, ownedParamBlocks: 1 });

    // The population is bounded at every press from the 9th on (each press replaces one block): the slots, the live
    // buffers, bind groups and parameter blocks never exceed what the 9th press had.
    expect(result.trace).toHaveLength(208);
    const steadyFrom = result.trace.slice(8);
    const reference = pick(steadyFrom[0] ?? {});
    expect(reference).toMatchObject({ liveEntities: 9, entitySlots: 10 });
    const drifted = steadyFrom.map((counters, i) => ({ press: i + 9, counters: pick(counters) })).filter((entry) => JSON.stringify(entry.counters) !== JSON.stringify(reference));
    expect(drifted, "counters that differ from the 9th press").toEqual([]);
    // No pipeline, texture or sampler was created by the churn, and the buffers allocated cumulatively did not grow with it.
    expect(many.counters["pipelinesCreated"]).toBe(eight.counters["pipelinesCreated"]);
    expect((many.counters["buffersAllocated"] ?? 0) - (eight.counters["buffersAllocated"] ?? 0)).toBeLessThanOrEqual(2);

    // Clearing the ring destroys every block: the picture is the marker alone and everything the blocks owned is released.
    expectRing(cleared, 0, "cleared");
    expect(cleared.spawned).toEqual([]);
    expect(cleared.counters).toMatchObject({ liveEntities: 1, entitiesSpawned: 208, entitiesDestroyed: 208, drawCalls: 1, instancedDraws: 0, sharedParamBlocks: 0, ownedParamBlocks: 1, pendingRemovals: 0 });
    expect(cleared.counters["liveBindGroups"]).toBe(empty.counters["liveBindGroups"]);
    expect(cleared.counters["liveBuffers"], "the arenas and the instance buffer keep their capacity").toBe(eight.counters["liveBuffers"]);

    testInfo.annotations.push({
      type: "m5-spawn",
      description: `0 presses: ${JSON.stringify(pick(empty.counters))}; 8: ${JSON.stringify(pick(eight.counters))}; 208: ${JSON.stringify(pick(many.counters))}; cleared: ${JSON.stringify(pick(cleared.counters))}; buffersAllocated ${String(eight.counters["buffersAllocated"])} -> ${String(many.counters["buffersAllocated"])}, bindGroupsCreated ${String(eight.counters["bindGroupsCreated"])} -> ${String(many.counters["bindGroupsCreated"])}`,
    });
  });

  test("spawning again after the ring was cleared reuses the slots under new generations", async ({ page, gpu }) => {
    void gpu;
    const result = await run(page, [
      { key: "Space", count: 8 },
      { key: "KeyC", count: 1 },
      { key: "Space", count: 3 },
    ]);
    const [, , cleared, again] = result.shots;
    if (cleared === undefined || again === undefined) throw new Error("missing shots");
    expect(result.reported.map((d) => d.code)).toEqual([]);
    expect(cleared.spawned).toEqual([]);
    // Presses 8, 9 and 10 go into columns 0, 1, 2 with colours 8 % 3, 9 % 3, 10 % 3 = 2, 0, 1; the other columns are empty.
    // The ring was cleared in the order of its columns, so slot 8 was freed last and is the first to be reused.
    expect(again.spawned.map((s) => [s.prefab, s.slot, s.gen])).toEqual([
      ["Block", 8, 1],
      ["Block", 7, 1],
      ["Block", 6, 1],
    ]);
    expect(again.counters).toMatchObject({ liveEntities: 4, entitiesSpawned: 11, entitiesDestroyed: 8, entitySlots: 9 });
    expectRing(again, 11, "after the clear and 3 presses", 8);
  });
});
