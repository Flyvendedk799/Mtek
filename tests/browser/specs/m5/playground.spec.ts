// M5-07: the physics playground (`examples/physics-playground`, decision 0069) on the real engine and the real GPU, driven
// with the manual clock, one fixed tick per frame (frames of exactly `manifest.runtimeConfig.fixedStep`).
//
// Every expected number is derived from the program's source and the geometry it declares (support/m5-playground.ts,
// itself unit-tested), never read back from the runtime:
//   rest         floor top y = 0, crate half-extent 0.5: centres rest at y = 0.5 (within 10 mm, spec/physics.md section 7)
//   Space        10 N*s on 2 kg is 5 m/s; the apex is v^2 / (2 g) = 1.2742 m above the rest height, 5 / g = 0.51 s (31 ticks) later
//   C            positions from xoshiro128** seeded with 166, re-derived independently; the fate of a crate follows from its x
//   sensor       a crate enters the zone [2, 6] x [-3, 3] when its footprint overlaps it, while it falls: it reaches
//                y = 3 (its bottom meets the zone's top, y = 2.5) after fallTicks(3) = 47 ticks and the event is delivered
//                within two ticks of that; `entered` counts it exactly once
//   destroy      a crate that misses the floor falls 16 m to y = -10 in fallTicks(16) = 109 ticks; its fixed_update sees it
//                one tick later and the flush that removes it is the tick after: the counters drop after tick 111
import type { Page } from "@playwright/test";
import { expect, test } from "../../support/fixtures.ts";
import {
  CRATE_MASS,
  FIRST,
  GRAVITY,
  PLAYGROUND_URL,
  REST_Y,
  STEP,
  assertSeparated,
  colourExtent,
  encodePng,
  exampleConstant,
  fallDistance,
  fallTicks,
  fate,
  liftHeight,
  liftTime,
  meterColumns,
  spawnPositions,
  writeResult,
  type Fate,
} from "../../support/m5-playground.ts";

interface DiagnosticLike {
  code: string;
  severity: string;
  message: string;
}

interface Vec {
  x: number;
  y: number;
  z: number;
}

interface SceneLike {
  state: Record<string, number>;
  entities: Array<{ name: string; position: Vec }>;
  spawned: Array<{ prefab: string; slot: number; gen: number; alive: boolean; position: Vec }>;
}

interface AppLike {
  state: string;
  debug: {
    pressKey(code: string): void;
    releaseKey(code: string): void;
    step(frames: number, dtSeconds: number): void;
    readPixels(): Promise<{ width: number; height: number; data: Uint8Array }>;
    counters(): Record<string, number>;
    scene(): SceneLike;
  };
  dispose(): void;
}

type Counters = Record<string, number>;

const SEED = 166;
/** Ticks the simulation runs after each spawn: longer than the 109-tick fall past the floor plus the removal, shorter than a minute of patience. */
const TICKS = 150;
const SPAWNS = 6;
const TARGET = { width: 960, height: 480 } as const;
/** `Unlit { color: #ffd040 }` of the meter, as bytes: the target is rgba8unorm-srgb, so the hex value reads back as itself. */
const METER_RGB = [0xff, 0xd0, 0x40] as const;

const JUMP_IMPULSE = exampleConstant("JUMP_IMPULSE");
const SPAWN_HEIGHT = exampleConstant("SPAWN_HEIGHT");
const KILL_HEIGHT = exampleConstant("KILL_HEIGHT");

interface ImpulseRun {
  reported: DiagnosticLike[];
  state: string;
  rest: Vec;
  /** The height of First after each of the TICKS ticks that follow the press (index 0 is the tick that applies the impulse). */
  heights: number[];
  after: { counters: Counters; first: Vec };
}

/** Space once, on a program that has settled for a second: First's height after every tick. */
async function runImpulse(page: Page): Promise<ImpulseRun> {
  await page.goto(PLAYGROUND_URL);
  return page.evaluate(
    async ({ seed, target, dt, ticks }) => {
      const w = window as unknown as { __mtekMount: (options: object) => Promise<AppLike> };
      const reported: DiagnosticLike[] = [];
      const app = await w.__mtekMount({ seed, test: { manualClock: true, renderTarget: target }, onDiagnostic: (d: DiagnosticLike) => reported.push({ code: d.code, severity: d.severity, message: d.message }) });
      const firstOf = (): Vec => app.debug.scene().entities.find((entity) => entity.name === "First")?.position ?? { x: Number.NaN, y: Number.NaN, z: Number.NaN };
      app.debug.step(60, dt);
      const rest = { ...firstOf() };
      app.debug.pressKey("Space");
      app.debug.step(1, dt);
      app.debug.releaseKey("Space");
      const heights = [firstOf().y];
      for (let i = 1; i < ticks; i += 1) {
        app.debug.step(1, dt);
        heights.push(firstOf().y);
      }
      const after = { counters: { ...app.debug.counters() }, first: { ...firstOf() } };
      const state = app.state;
      app.dispose();
      return { reported, state, rest, heights, after };
    },
    { seed: SEED, target: { width: 160, height: 80 }, dt: STEP, ticks: TICKS },
  );
}

interface Cycle {
  /** Where the crate was one tick after the press (the tick that created it). */
  spawn: Vec;
  /** The scene state, the live counters and the crate's own height after each of the TICKS ticks, index 0 being the tick that created it. */
  entered: number[];
  inside: number[];
  bodies: number[];
  destroyed: number[];
  liveEntities: number[];
  /** The crate's position after the last tick and ten ticks earlier, or null once it is gone. */
  last: Vec | null;
  earlier: Vec | null;
}

interface Shot {
  width: number;
  height: number;
  pixels: string;
  counters: Counters;
  state: Record<string, number>;
}

interface SpawnRun {
  reported: DiagnosticLike[];
  state: string;
  start: { counters: Counters; scene: SceneLike };
  shots: { before: Shot; after: Shot };
  cycles: Cycle[];
  first: { before: Vec; after: Vec };
  end: { counters: Counters; scene: SceneLike };
}

function decode(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

/** Presses C `count` times, TICKS ticks apart, on a program that has settled for a second, with a picture before and after. */
async function runSpawns(page: Page, count: number): Promise<SpawnRun> {
  await page.goto(PLAYGROUND_URL);
  return page.evaluate(
    async ({ seed, target, dt, ticks, presses }) => {
      const w = window as unknown as { __mtekMount: (options: object) => Promise<AppLike> };
      const reported: DiagnosticLike[] = [];
      const app = await w.__mtekMount({ seed, test: { manualClock: true, renderTarget: target }, onDiagnostic: (d: DiagnosticLike) => reported.push({ code: d.code, severity: d.severity, message: d.message }) });
      const toBase64 = (bytes: Uint8Array): string => {
        let text = "";
        for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(text);
      };
      const shot = async (): Promise<Shot> => {
        const frame = await app.debug.readPixels();
        return { width: frame.width, height: frame.height, pixels: toBase64(frame.data), counters: { ...app.debug.counters() }, state: { ...app.debug.scene().state } };
      };
      const firstOf = (): Vec => ({ ...(app.debug.scene().entities.find((entity) => entity.name === "First")?.position ?? { x: Number.NaN, y: Number.NaN, z: Number.NaN }) });

      app.debug.step(60, dt);
      const start = { counters: { ...app.debug.counters() }, scene: app.debug.scene() };
      const firstBefore = firstOf();
      const before = await shot();

      const cycles: Cycle[] = [];
      for (let press = 0; press < presses; press += 1) {
        app.debug.pressKey("KeyC");
        app.debug.step(1, dt);
        app.debug.releaseKey("KeyC");
        const created = app.debug.scene().spawned.at(-1);
        const cycle: Cycle = { spawn: { ...(created?.position ?? { x: Number.NaN, y: Number.NaN, z: Number.NaN }) }, entered: [], inside: [], bodies: [], destroyed: [], liveEntities: [], last: null, earlier: null };
        const find = (scene: SceneLike): Vec | null => {
          const crate = scene.spawned.find((entry) => entry.slot === created?.slot && entry.gen === created?.gen && entry.alive);
          return crate === undefined ? null : { ...crate.position };
        };
        for (let tick = 0; tick < ticks; tick += 1) {
          if (tick > 0) app.debug.step(1, dt);
          const scene = app.debug.scene();
          const counters = app.debug.counters();
          cycle.entered.push(scene.state["entered"] ?? Number.NaN);
          cycle.inside.push(scene.state["inside"] ?? Number.NaN);
          cycle.bodies.push(counters["physicsBodies"] ?? Number.NaN);
          cycle.destroyed.push(counters["entitiesDestroyed"] ?? Number.NaN);
          cycle.liveEntities.push(counters["liveEntities"] ?? Number.NaN);
          if (tick === ticks - 11) cycle.earlier = find(scene);
          if (tick === ticks - 1) cycle.last = find(scene);
        }
        cycles.push(cycle);
      }
      const firstAfter = firstOf();
      const after = await shot();
      const end = { counters: { ...app.debug.counters() }, scene: app.debug.scene() };
      const state = app.state;
      app.dispose();
      return { reported, state, start, shots: { before, after }, cycles, first: { before: firstBefore, after: firstAfter }, end };
    },
    { seed: SEED, target: TARGET, dt: STEP, ticks: TICKS, presses: count },
  );
}

/** The first index at which a series grew beyond its first value, or -1. */
const firstChange = (series: readonly number[]): number => series.findIndex((value) => value !== series[0]);

test.describe("the physics playground on the real engine (M5-07)", () => {
  test.beforeEach(({ gpu }) => {
    void gpu;
  });

  test("Space lifts First by the height its impulse derives and it comes back to rest", async ({ page }) => {
    const run = await runImpulse(page);
    expect(run.reported, "no runtime diagnostics").toEqual([]);
    expect(run.state).toBe("running");

    // After a second of simulated time First rests on the floor where the program put it.
    expect(run.rest.x).toBeCloseTo(FIRST.x, 3);
    expect(run.rest.z).toBeCloseTo(FIRST.z, 3);
    expect(Math.abs(run.rest.y - REST_Y)).toBeLessThan(0.01);

    // 10 N*s on 2 kg: v = 5 m/s, so the apex is 1.2742 m above the rest height. The engine integrates the step in four
    // substeps of semi-implicit Euler, which lowers the peak by about v dt / 2 = 10 mm: 2.5 cm is the tolerance.
    const expectedRise = liftHeight(JUMP_IMPULSE, CRATE_MASS);
    expect(expectedRise).toBeCloseTo(1.2742, 4);
    const peak = Math.max(...run.heights);
    expect(Math.abs(peak - run.rest.y - expectedRise)).toBeLessThan(0.025);

    // The apex comes 5 / g = 0.51 s = 30.6 ticks after the impulse was applied (tick index 0 applied it).
    const apexTick = run.heights.indexOf(peak);
    const expectedApexTick = liftTime(JUMP_IMPULSE, CRATE_MASS) / STEP;
    expect(Math.abs(apexTick - expectedApexTick)).toBeLessThanOrEqual(2);

    // It goes up first, comes down, and rests again at the same height with the same x and z (a vertical impulse through the centre of mass).
    expect(run.heights[10] ?? Number.NaN).toBeGreaterThan(run.rest.y + 0.5);
    expect(Math.abs((run.heights.at(-1) ?? Number.NaN) - REST_Y)).toBeLessThan(0.01);
    expect(Math.abs(run.after.first.x - FIRST.x)).toBeLessThan(0.01);
    expect(Math.abs(run.after.first.z - FIRST.z)).toBeLessThan(0.01);
    expect(run.after.counters).toMatchObject({ physicsBodies: 3, physicsColliders: 3, physicsFrozenBodies: 0, physicsSteps: 60 + TICKS });
  });

  test("C spawns crates at seeded positions: they come to rest, the sensor counts them exactly and the ones that miss the floor are destroyed", async ({ page }) => {
    const spawns = spawnPositions(SEED, SPAWNS);
    const fates: Fate[] = spawns.map(fate);
    // Preconditions of the derivation, not of the program: no crate lands on another or on First, none is borderline.
    assertSeparated(spawns);
    const inZone = fates.filter((f) => f === "zone").length;
    const off = fates.filter((f) => f === "off").length;
    const onFloor = SPAWNS - off;
    expect(inZone, "the seed must put at least two crates in the zone").toBeGreaterThanOrEqual(2);
    expect(off, "and at least one past the floor").toBeGreaterThanOrEqual(1);
    expect(fates.filter((f) => f === "floor").length, "and at least one on the floor outside the zone").toBeGreaterThanOrEqual(1);

    const run = await runSpawns(page, SPAWNS);
    writeResult("m5-playground-before.png", encodePng(run.shots.before.width, run.shots.before.height, decode(run.shots.before.pixels)));
    writeResult("m5-playground-final.png", encodePng(run.shots.after.width, run.shots.after.height, decode(run.shots.after.pixels)));
    expect(run.reported, "no runtime diagnostics").toEqual([]);
    expect(run.state).toBe("running");

    // Before any press: three bodies (Floor, First, Zone), nothing spawned, the meter at its minimum.
    expect(run.start.counters).toMatchObject({ physicsBodies: 3, physicsColliders: 3, entitiesSpawned: 0 });
    expect(run.start.scene.state).toEqual({ entered: 0, inside: 0, spawned: 0 });
    const namedEntities = run.start.counters["liveEntities"] ?? Number.NaN;

    // The positions are the seeded ones: every crate appears at the derived x and z and at the spawn height.
    run.cycles.forEach((cycle, index) => {
      const want = spawns[index];
      expect(cycle.spawn.x, `x of crate ${String(index)}`).toBeCloseTo(want?.x ?? Number.NaN, 4);
      expect(cycle.spawn.z, `z of crate ${String(index)}`).toBeCloseTo(want?.z ?? Number.NaN, 4);
      // Created at the flush of the tick that follows the press and stepped by that very tick: it has fallen fallDistance(1) = 1.7 mm.
      expect(cycle.spawn.y, `y of crate ${String(index)}`).toBeCloseTo(SPAWN_HEIGHT - fallDistance(1), 4);
    });

    let enteredBefore = 0;
    let destroyedBefore = 0;
    run.cycles.forEach((cycle, index) => {
      const fateOf = fates[index];
      const label = `crate ${String(index)} (${String(fateOf)})`;
      const ticks = cycle.entered.length;
      expect(ticks).toBe(TICKS);

      // The sensor: unchanged until the crate reaches the zone, then +1 once, within two ticks of the derived time.
      const enterAt = firstChange(cycle.entered) + 1;
      if (fateOf === "zone") {
        const expectedTick = fallTicks(SPAWN_HEIGHT - 3);
        expect(expectedTick).toBe(47);
        expect(enterAt, `${label}: tick at which the sensor counted it`).toBeGreaterThanOrEqual(expectedTick);
        expect(enterAt, `${label}: tick at which the sensor counted it`).toBeLessThanOrEqual(expectedTick + 2);
        expect(new Set(cycle.entered.slice(0, enterAt - 1))).toEqual(new Set([enteredBefore]));
        expect(new Set(cycle.entered.slice(enterAt - 1))).toEqual(new Set([enteredBefore + 1]));
        enteredBefore += 1;
        // It stays inside: no exit event for a crate that rests in the zone.
        expect(cycle.inside.at(-1), label).toBe(enteredBefore);
      } else {
        expect(new Set(cycle.entered), `${label}: the sensor never counts it`).toEqual(new Set([enteredBefore]));
      }
      expect(cycle.inside.at(-1), `${label}: crates inside the zone after the cycle`).toBe(enteredBefore);

      if (fateOf === "off") {
        // It falls from y = 6 to y = -10 (109 ticks), its fixed_update sees that one tick later, and the flush that removes it is the tick after.
        const fall = fallTicks(SPAWN_HEIGHT - KILL_HEIGHT);
        expect(fall).toBe(109);
        const goneAt = firstChange(cycle.destroyed) + 1;
        expect(goneAt, `${label}: tick at which it was destroyed`).toBeGreaterThanOrEqual(fall + 1);
        expect(goneAt, `${label}: tick at which it was destroyed`).toBeLessThanOrEqual(fall + 3);
        // The tick it is removed, the physics body and the live entity go with it; the tick before, both were still there.
        const bodiesBefore = cycle.bodies[goneAt - 2] ?? Number.NaN;
        expect(cycle.bodies[goneAt - 1], `${label}: bodies at the tick it is removed`).toBe(bodiesBefore - 1);
        expect(cycle.liveEntities[goneAt - 1], `${label}: live entities at the tick it is removed`).toBe((cycle.liveEntities[goneAt - 2] ?? Number.NaN) - 1);
        expect(cycle.destroyed.at(-1), label).toBe(destroyedBefore + 1);
        expect(cycle.last, `${label}: no spawned entity of its generation is left`).toBeNull();
        destroyedBefore += 1;
      } else {
        // It came to rest on the floor: at 0.5 within 10 mm, and not moving over the last ten ticks.
        expect(cycle.destroyed.at(-1), `${label}: nothing is destroyed`).toBe(destroyedBefore);
        expect(cycle.last, label).not.toBeNull();
        const last = cycle.last ?? { x: Number.NaN, y: Number.NaN, z: Number.NaN };
        const earlier = cycle.earlier ?? { x: Number.NaN, y: Number.NaN, z: Number.NaN };
        expect(Math.abs(last.y - REST_Y), `${label}: rest height`).toBeLessThan(0.01);
        expect(Math.hypot(last.x - earlier.x, last.y - earlier.y, last.z - earlier.z), `${label}: movement over ten ticks`).toBeLessThan(0.002);
        // It landed where it was dropped: a straight fall moves it sideways only by the solver's slide at the impact
        // (about 1.5 cm for a 10.8 m/s landing, the same for every crate), so 3 cm is the tolerance.
        expect(Math.abs(last.x - (spawns[index]?.x ?? Number.NaN)), `${label}: x`).toBeLessThan(0.03);
        expect(Math.abs(last.z - (spawns[index]?.z ?? Number.NaN)), `${label}: z`).toBeLessThan(0.03);
      }
    });

    // The totals: six presses, `inZone` entries, `off` destruction; the surviving crates and the bodies are what the arithmetic says.
    expect(run.end.scene.state).toEqual({ entered: inZone, inside: inZone, spawned: SPAWNS });
    expect(run.end.counters).toMatchObject({
      entitiesSpawned: SPAWNS,
      entitiesDestroyed: off,
      liveEntities: namedEntities + onFloor,
      physicsBodies: 3 + onFloor,
      physicsColliders: 3 + onFloor,
      physicsFrozenBodies: 0,
      pendingSpawns: 0,
      pendingRemovals: 0,
      physicsSteps: 60 + SPAWNS * TICKS,
    });
    expect(run.end.scene.spawned.filter((entry) => entry.alive)).toHaveLength(onFloor);
    // First was neither touched nor disturbed by any of it.
    expect(Math.abs(run.first.after.y - run.first.before.y)).toBeLessThan(0.005);
    expect(Math.abs(run.first.after.x - run.first.before.x)).toBeLessThan(0.005);

    // The meter is the count made visible: a box 0.4 + 0.5 n units long with its left end fixed. The columns its silhouette covers are
    // those of its eight corners projected through the camera (a pinhole, support/m5-playground.ts); the picture agrees within 2 px.
    const before = run.shots.before;
    const after = run.shots.after;
    const barBefore = colourExtent(decode(before.pixels), before.width, before.height, METER_RGB, 3);
    const barAfter = colourExtent(decode(after.pixels), after.width, after.height, METER_RGB, 3);
    expect(barBefore, "the meter is on screen before anything entered").not.toBeNull();
    expect(barAfter, "and after").not.toBeNull();
    for (const [label, bar, entries] of [
      ["before", barBefore, 0],
      ["after", barAfter, inZone],
    ] as const) {
      const want = meterColumns(entries, TARGET.width, TARGET.height);
      expect(bar?.left, `meter left edge ${label} (${String(entries)} entries): want ${want.left.toFixed(1)}`).toBeGreaterThanOrEqual(want.left - 2);
      expect(bar?.left, `meter left edge ${label}`).toBeLessThanOrEqual(want.left + 2);
      expect(bar?.right, `meter right edge ${label} (${String(entries)} entries): want ${want.right.toFixed(1)}`).toBeGreaterThanOrEqual(want.right - 2);
      expect(bar?.right, `meter right edge ${label}`).toBeLessThanOrEqual(want.right + 2);
    }

    writeResult(
      "m5-playground-counters.json",
      `${JSON.stringify(
        {
          seed: SEED,
          spawns: spawns.map((spawn, index) => ({ x: spawn.x, z: spawn.z, fate: fates[index], enterTick: firstChange(run.cycles[index]?.entered ?? []) + 1, destroyTick: firstChange(run.cycles[index]?.destroyed ?? []) + 1, rest: run.cycles[index]?.last })),
          meterPixels: { before: barBefore, after: barAfter },
          counters: { start: run.start.counters, end: run.end.counters },
          state: run.end.scene.state,
          gravity: GRAVITY,
        },
        null,
        2,
      )}\n`,
    );
  });

  test("the same seed gives the same crates and another seed gives others", async ({ page }) => {
    await page.goto(PLAYGROUND_URL);
    const positions = await page.evaluate(
      async ({ seeds, target, dt }) => {
        const w = window as unknown as { __mtekMount: (options: object) => Promise<AppLike> };
        const out: Array<Array<{ x: number; z: number }>> = [];
        for (const seed of seeds) {
          const app = await w.__mtekMount({ seed, test: { manualClock: true, renderTarget: target } });
          const row: Array<{ x: number; z: number }> = [];
          for (let press = 0; press < 3; press += 1) {
            app.debug.pressKey("KeyC");
            app.debug.step(1, dt);
            app.debug.releaseKey("KeyC");
            const created = app.debug.scene().spawned.at(-1);
            row.push({ x: created?.position.x ?? Number.NaN, z: created?.position.z ?? Number.NaN });
          }
          app.dispose();
          out.push(row);
        }
        return out;
      },
      { seeds: [SEED, SEED, SEED + 1], target: { width: 160, height: 80 }, dt: STEP },
    );
    const [first, again, other] = positions;
    expect(again, "the same seed").toEqual(first);
    expect(other, "another seed").not.toEqual(first);
    expect(first?.map((p) => [p.x, p.z])).toEqual(spawnPositions(SEED, 3).map((p) => [p.x, p.z]));
  });
});
