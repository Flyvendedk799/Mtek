// M7-01: the modular scene (`examples/modular-scene`, decision 0002, third release demonstration) on the real GPU, driven with the
// manual clock. The example is five files: a theme (constants and a function), one material, two prefabs and the scene that only
// places things. Its expectations are derived from the sources and the CPU reference (support/m7-modular-scene.ts, itself unit
// tested), never read back from the runtime:
//   modules     the manifest lists the five sources; the material that three of them import is one material and one shader;
//               both prefabs are symbols of the files that declare them, and the spawned one is in the run-time prefab table
//   instances   Left, Middle, Right (one prefab, three param sets) and Lantern, Lamp (the other prefab, two) are named entities at
//               the places their params give; the clock moves the beacons by 0.25 sin(rate t) and dims them by 0.75 + 0.25 sin(rate t)
//   state       Space makes both beacons count a flash, and the gauge in the scene file, which reads `Lantern.flashes + Lamp.flashes`
//               from the prefab's file, is half a metre longer for each of them
//   spawn       P spawns a Pillar of the other file with run-time params, four at most; each one is where the theme's constants and
//               its number put it
//   instancing  entities of one mesh and one parameter block are one draw (spec/runtime-abi.md section 8.4)
//   pixels      a grid over the whole picture agrees with the CPU reference at every sample whose neighbourhood sees one surface
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../../support/fixtures.ts";
import { expectPixel, expectedColour } from "../../support/m1-reference.ts";
import { encodePng, writeResult } from "../../support/m5-playground.ts";
import {
  MODULAR_MODULES,
  MODULAR_OUT,
  MODULAR_URL,
  REST,
  beacon,
  drawStats,
  gaugeLength,
  placedPillar,
  showroom,
  themeNumber,
  type ShowroomState,
} from "../../support/m7-modular-scene.ts";
import { rgbClose } from "../m1/support.ts";

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

interface Shot {
  width: number;
  height: number;
  pixels: string;
  counters: Record<string, number>;
  scene: SceneLike;
}

interface Run {
  reported: DiagnosticLike[];
  state: string;
  shots: Shot[];
}

const TARGET = { width: 480, height: 270 } as const;
const GRID_STRIDE = 4;
/** The clock after the last frame of the second picture: 20 frames of 0.05 s. */
const FRAMES = 20;
const FRAME = 0.05;
const TIME = FRAMES * FRAME;

/**
 * Mounts the example and takes three pictures: at rest (one frame of 0 s), after two presses of Space and five presses of P
 * (the fifth finds the row full) with the clock still at 0, and after the clock has run to `TIME`.
 */
async function runShowroom(page: Page): Promise<Run> {
  await page.goto(MODULAR_URL);
  return page.evaluate(
    async ({ target, frames, frame }) => {
      const w = window as unknown as { __mtekMount: (options: object) => Promise<AppLike> };
      const reported: DiagnosticLike[] = [];
      const app = await w.__mtekMount({ test: { manualClock: true, renderTarget: target }, onDiagnostic: (d: DiagnosticLike) => reported.push({ code: d.code, severity: d.severity, message: d.message }) });
      const toBase64 = (bytes: Uint8Array): string => {
        let text = "";
        for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(text);
      };
      const shot = async (): Promise<Shot> => {
        const picture = await app.debug.readPixels();
        return { width: picture.width, height: picture.height, pixels: toBase64(picture.data), counters: { ...app.debug.counters() }, scene: JSON.parse(JSON.stringify(app.debug.scene())) as SceneLike };
      };
      const tap = (code: string): void => {
        app.debug.pressKey(code);
        app.debug.step(1, 0);
        app.debug.releaseKey(code);
      };
      const shots: Shot[] = [];
      app.debug.step(1, 0);
      shots.push(await shot());
      tap("Space");
      tap("Space");
      for (let press = 0; press < 5; press += 1) tap("KeyP");
      shots.push(await shot());
      app.debug.step(frames, frame);
      shots.push(await shot());
      const state = app.state;
      app.dispose();
      return { reported, state, shots };
    },
    { target: TARGET, frames: FRAMES, frame: FRAME },
  );
}

function decode(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

/** Every grid sample whose neighbourhood sees one surface, against the CPU reference; the entities the samples fall on are counted. */
function compareGrid(shot: Shot, state: ShowroomState): { mismatches: string[]; counts: Map<string, number> } {
  const scene = showroom(state, TARGET);
  const data = decode(shot.pixels);
  const mismatches: string[] = [];
  const counts = new Map<string, number>();
  for (let y = GRID_STRIDE / 2; y < TARGET.height; y += GRID_STRIDE) {
    for (let x = GRID_STRIDE / 2; x < TARGET.width; x += GRID_STRIDE) {
      const expectation = expectPixel(scene, x, y);
      if (expectation.kind === "ambiguous") continue;
      const key = expectation.kind === "clear" ? "clear" : (scene.entities[expectation.index]?.name ?? "?");
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const expected = expectedColour(scene, expectation);
      const at = (y * shot.width + x) * 4;
      const actual = [data[at] ?? -1, data[at + 1] ?? -1, data[at + 2] ?? -1];
      if (!rgbClose(actual, expected)) mismatches.push(`(${String(x)}, ${String(y)}) ${key}: ${actual.join(",")} vs ${expected.join(",")}`);
    }
  }
  return { mismatches, counts };
}

const near = (actual: number, expected: number, digits = 4): void => expect(actual).toBeCloseTo(expected, digits);

interface Manifest {
  sources: Array<{ id: number; path: string }>;
  shaders: Array<{ material: string }>;
  materials: Array<{ id: string; params: Array<{ name: string; type: string }> }>;
  symbols: Array<{ id: string; kind: string }>;
  prefabs: Array<{ symbol: string; name: string; params: Array<{ name: string }>; material: { id: string } | null }>;
  scene: { entities: Array<{ name: string }> };
}

test.describe("the modular scene on the real GPU (M7-01)", () => {
  test.beforeEach(({ gpu }) => {
    void gpu;
  });

  test("the program is five modules, one material and two prefabs", () => {
    const manifest = JSON.parse(readFileSync(join(MODULAR_OUT, "program.manifest.json"), "utf8")) as Manifest;
    // The compiler follows imports depth first from the entry, in source order: main, theme, materials, pillar, beacon.
    expect(manifest.sources.map((source) => source.path)).toEqual([...MODULAR_MODULES]);
    // The material three modules import is one declaration in one file and compiles to one shader.
    expect(manifest.materials.map((material) => material.id)).toEqual(["src/materials.mtek::Matte"]);
    expect(manifest.shaders.map((shader) => shader.material)).toEqual(["src/materials.mtek::Matte"]);
    // Both prefabs are symbols of the files that declare them. Only Pillar is in the run-time prefab table: it is the one the
    // scene spawns (Beacon is only ever instantiated by name, so nothing creates it at run time), with the params its file gives it.
    const symbols = manifest.symbols.filter((symbol) => symbol.kind === "prefab").map((symbol) => symbol.id);
    expect(symbols).toEqual(["src/props/pillar.mtek::Pillar", "src/props/beacon.mtek::Beacon"]);
    expect(manifest.symbols.filter((symbol) => symbol.kind === "param").map((symbol) => symbol.id)).toEqual(
      expect.arrayContaining(["src/props/pillar.mtek::Pillar.height", "src/props/beacon.mtek::Beacon.rate", "src/materials.mtek::Matte.dim"]),
    );
    expect(manifest.prefabs.map((prefab) => prefab.symbol)).toEqual(["src/props/pillar.mtek::Pillar"]);
    const pillar = manifest.prefabs[0];
    expect(pillar?.params.map((param) => param.name)).toEqual(["origin", "height", "width", "tint"]);
    expect(pillar?.material?.id).toBe("src/materials.mtek::Matte");
    // The state a prefab declares exists once in the prefab and once per instance (the scene reads it as Lamp.flashes).
    expect(manifest.symbols.filter((symbol) => symbol.id.endsWith(".flashes")).map((symbol) => symbol.id)).toEqual([
      "src/main.mtek::Showroom.Lantern.flashes",
      "src/main.mtek::Showroom.Lamp.flashes",
      "src/props/beacon.mtek::Beacon.flashes",
    ]);
    // The scene's named entities: its own, and the five instances of the prefabs of the other files.
    expect(manifest.scene.entities.map((entity) => entity.name)).toEqual(["Floor", "Left", "Middle", "Right", "Lantern", "Lamp", "Gauge"]);
  });

  test("at rest, after Space and P, and after the clock has run, the picture, the state and the counters are what the sources derive", async ({ page }, testInfo) => {
    const run = await runShowroom(page);
    const [rest, pressed, running] = run.shots;
    if (rest === undefined || pressed === undefined || running === undefined) throw new Error("three pictures were taken");
    writeResult("m7-modular-scene-rest.png", encodePng(rest.width, rest.height, decode(rest.pixels)));
    writeResult("m7-modular-scene-final.png", encodePng(running.width, running.height, decode(running.pixels)));
    expect(run.reported, "no runtime diagnostics").toEqual([]);
    expect(run.state).toBe("running");
    expect([rest.width, rest.height]).toEqual([TARGET.width, TARGET.height]);

    const max = themeNumber("MAX_PLACED");
    const states: Array<[string, Shot, ShowroomState]> = [
      ["at rest", rest, REST],
      ["after Space twice and P five times", pressed, { time: 0, presses: 2, placed: max }],
      ["after 1 s of the clock", running, { time: TIME, presses: 2, placed: max }],
    ];

    for (const [label, shot, state] of states) {
      // The picture: every sample the reference is sure of agrees with it, and every entity shows up in it.
      const { mismatches, counts } = compareGrid(shot, state);
      testInfo.annotations.push({ type: "m7-pixel", description: `${label}: grid samples ${[...counts].map(([key, count]) => `${key} ${String(count)}`).join(", ")}` });
      expect(mismatches, `${label}: grid samples that differ from the CPU reference`).toEqual([]);
      const scene = showroom(state, TARGET);
      for (const entity of scene.entities) {
        expect(counts.get(entity.name) ?? 0, `${label}: ${entity.name} has samples in the picture`).toBeGreaterThanOrEqual(entity.name === "Gauge" && state.presses === 0 ? 0 : 3);
      }

      // The counters: the named entities and the spawned ones, the spawn count, and the draws that sharing a parameter block makes.
      const stats = drawStats(state);
      expect(shot.counters, label).toMatchObject({ liveEntities: 7 + state.placed, entitiesSpawned: state.placed, drawCalls: stats.drawCalls, instancedDraws: stats.instancedDraws });

      // The state: `placed` counts the pillars, and the named entities are where the model puts them.
      expect(shot.scene.state["placed"], label).toBe(state.placed);
      const position = (name: string): Vec => shot.scene.entities.find((entity) => entity.name === name)?.position ?? { x: NaN, y: NaN, z: NaN };
      const at = (name: string, expected: readonly number[]): void => {
        const actual = position(name);
        near(actual.x, expected[0] ?? NaN);
        near(actual.y, expected[1] ?? NaN);
        near(actual.z, expected[2] ?? NaN);
      };
      at("Left", [-3.6, 1, 0]);
      at("Middle", [-1.2, 1.5, 0]);
      at("Right", [1.2, 0.6, 0]);
      at("Lantern", beacon([-3.6, 3.4, 0], 1, state.time).position);
      at("Lamp", beacon([3.6, 3, 0], 2, state.time).position);
      at("Gauge", [5.4, gaugeLength(state.presses) / 2, 1.5]);
    }

    // The spawned pillars are the prefab of the other file, at the place the theme's constants and their number give: four of the
    // five presses of P placed one, the fifth found the row full.
    const spawned = running.scene.spawned.filter((entry) => entry.alive);
    expect(spawned).toHaveLength(max);
    spawned.forEach((entry, n) => {
      const want = placedPillar(n);
      expect(entry.prefab, `pillar ${String(n)}`).toBe("Pillar");
      near(entry.position.x, want.origin[0]);
      near(entry.position.y, want.height / 2);
      near(entry.position.z, want.origin[2]);
    });
  });
});
