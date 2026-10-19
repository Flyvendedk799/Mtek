// The fixtures of the examples (`examples/<name>/tests/*.test.toml`, M6-09) are claimed to assert derived behaviour, not
// numbers read back from a run. This test recomputes what each fixture expects from the models the rest of the suite already
// trusts, without a browser and without the runtime: the CPU ray tracer and PBR oracle for the configurator
// (configurator-scene.ts), the closed-form motion and colour of the Pulse material for pulse-cube, and the seed, geometry and
// physics model of the playground (m5-playground.ts), and the sources and the CPU reference for the modular scene (m7-modular-scene.ts). A fixture whose number does not follow from its comments fails here, in CI
// without a GPU; the GPU run (`specs/m6/mtek-test.spec.ts`) then shows that the program agrees with the same numbers.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyHostValues,
  configuratorScene,
  expectedImage,
  UNSTABLE,
  type HostValues,
} from "../configurator-scene.ts";
import { REPO_ROOT } from "../environment.ts";
import { assertSeparated, fallDistance, fate, liftHeight, meterColumns, spawnPositions, STEP } from "../m5-playground.ts";
import { expectedColour, expectPixel } from "../m1-reference.ts";
import { beacon, REST, showroom, themeColour, themeNumber, type ShowroomState } from "../m7-modular-scene.ts";

type Table = Record<string, unknown>;
type Step = Table;

interface FixtureFile {
  file: string;
  name: string;
  seed: number;
  steps: Step[];
}

/** The strict TOML subset parser the benchmark tooling already uses (benchmarks/tools/toml-subset.mjs). */
async function loadParser(): Promise<(text: string) => Table> {
  const url = pathToFileURL(join(REPO_ROOT, "benchmarks", "tools", "toml-subset.mjs")).href;
  const module = (await import(url)) as { parseToml: (text: string) => Table };
  return module.parseToml;
}

async function fixturesOf(example: string): Promise<FixtureFile[]> {
  const parse = await loadParser();
  const dir = join(REPO_ROOT, "examples", example, "tests");
  return readdirSync(dir)
    .filter((file) => file.endsWith(".test.toml"))
    .sort()
    .map((file) => {
      const doc = parse(readFileSync(join(dir, file), "utf8"));
      return { file, name: String(doc["name"]), seed: Number(doc["seed"] ?? 0), steps: doc["steps"] as Step[] };
    });
}

function only(step: Step): [string, unknown] {
  const entries = Object.entries(step);
  expect(entries, "a step has one key").toHaveLength(entries[0]?.[0] === "step" ? 2 : 1);
  return entries[0] as [string, unknown];
}

function byName(fixtures: FixtureFile[], file: string): FixtureFile {
  const found = fixtures.find((fixture) => fixture.file === file);
  if (found === undefined) throw new Error(`no fixture ${file}`);
  return found;
}

const hexBytes = (hex: string): [number, number, number] => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as [number, number, number];

// ---- pulse-cube: closed-form motion and colour -------------------------------------------------------------------------

const decode = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const encode = (l: number): number => Math.round(255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055));

describe("examples/pulse-cube fixtures follow from the program", () => {
  /** Replays a fixture on a model of `Demo`: speed 0.7 turned by update(dt), Space negating it, tint host input, pulse(t). */
  function replay(fixture: FixtureFile): number {
    let time = 0;
    let angle = 0;
    let speed = 0.7;
    let tint = "#6b5cff";
    let pendingTint: string | null = null;
    let pendingPress = false;
    let checks = 0;
    const near = (actual: number, expected: unknown, tolerance: number, what: string): void => {
      expect(Math.abs(actual - Number(expected)), `${fixture.file}: ${what}`).toBeLessThanOrEqual(tolerance);
      checks += 1;
    };
    for (const step of fixture.steps) {
      const [kind, value] = only(step);
      if (kind === "step") {
        const dt = Number(step["dt"]);
        for (let frame = 0; frame < Number(value); frame += 1) {
          // Phase 1: queued input first, then update(dt) with the new speed; frame.time advances by dt.
          if (pendingPress) speed = -speed;
          pendingPress = false;
          if (pendingTint !== null) tint = pendingTint;
          pendingTint = null;
          angle += speed * dt;
          time += dt;
        }
      } else if (kind === "press") {
        pendingPress = true;
      } else if (kind === "set_input") {
        pendingTint = String((value as Table)["tint"]);
      } else if (kind === "expect_pixel") {
        const pixel = value as Table;
        const expected = Number(pixel["x"]) === 64 && Number(pixel["y"]) === 64 ? hexBytes(tint).map((c) => encode(decode(c) * (0.65 + 0.35 * Math.sin(time)))) : [0, 0, 0];
        const wanted = hexBytes(String(pixel["color"]));
        wanted.forEach((channel, i) => near(channel, expected[i], 1, `pixel ${String(pixel["x"])},${String(pixel["y"])} channel ${String(i)}`));
      } else if (kind === "expect_state") {
        for (const [key, entry] of Object.entries(value as Table)) {
          const wrapped = typeof entry === "object" && entry !== null && !Array.isArray(entry) ? (entry as Table) : null;
          const expected = wrapped === null ? entry : wrapped["value"];
          const tolerance = wrapped === null ? 1e-5 : Number(wrapped["tolerance"] ?? 1e-5);
          if (key === "speed") near(speed, expected, tolerance, "speed");
          else if (key === "tint") expect(expected, `${fixture.file}: tint`).toBe(tint);
          else if (key === "Cube.material.tint") expect(expected).toBe(tint);
          else if (key === "Cube.material.phase") near(time, expected, tolerance, "phase");
          else if (key === "Cube.position") (expected as number[]).forEach((c, i) => near([0, 0.5, 0][i] ?? NaN, c, tolerance, "position"));
          else if (key === "Cube.rotation") {
            const q = [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
            const sign = (expected as number[]).every((c, i) => Math.abs(c - (q[i] ?? NaN)) <= Math.max(tolerance, 1e-6)) ? 1 : -1;
            (expected as number[]).forEach((c, i) => near(sign * (q[i] ?? NaN), c, Math.max(tolerance, 1e-6), `rotation[${String(i)}]`));
          } else throw new Error(`${fixture.file}: no model for ${key}`);
        }
      }
    }
    return checks;
  }

  it("every expectation is the closed form of the program's behaviour", async () => {
    const fixtures = await fixturesOf("pulse-cube");
    expect(fixtures.map((f) => f.file)).toEqual(["host-tint.test.toml", "rotation-and-pulse.test.toml", "space-reverses.test.toml"]);
    for (const fixture of fixtures) expect(replay(fixture), `${fixture.file}: expectations replayed`).toBeGreaterThanOrEqual(5);
  });

  it("the pulse factor is 1.0 at t = pi/2 and the colours quoted in the comments are the encodings", () => {
    const shade = (tint: string, t: number): string => `#${hexBytes(tint).map((c) => encode(decode(c) * (0.65 + 0.35 * Math.sin(t))).toString(16).padStart(2, "0")).join("")}`;
    expect(shade("#6b5cff", Math.PI / 2)).toBe("#6b5cff");
    expect(shade("#6b5cff", 0)).toBe("#574bd3");
    expect(shade("#6b5cff", 1.5 * Math.PI)).toBe("#3b3295");
    expect(shade("#f04f72", 1.5 * Math.PI)).toBe("#8c2a3f");
  });
});

// ---- material-configurator: the CPU oracle ------------------------------------------------------------------------------

describe("examples/material-configurator fixtures follow from the CPU oracle", () => {
  const HOST_NAMES = ["seat_color", "seat_metallic", "seat_roughness", "frame_color", "frame_metallic", "frame_roughness", "stripe_a", "stripe_b", "back_roughness", "sun_intensity"];

  it("every expect_pixel is the oracle's colour for the inputs set so far, at a pixel whose footprint is one surface", async () => {
    const fixtures = await fixturesOf("material-configurator");
    expect(fixtures.map((f) => f.file)).toEqual(["chair-defaults.test.toml", "host-inputs.test.toml"]);
    const images = new Map<string, ReturnType<typeof expectedImage>>();
    let checked = 0;
    for (const fixture of fixtures) {
      let values: HostValues = {};
      for (const step of fixture.steps) {
        const [kind, value] = only(step);
        if (kind === "set_input") {
          const [name, input] = Object.entries(value as Table)[0] ?? [];
          expect(HOST_NAMES, `${fixture.file}: ${String(name)} is a host input of mtek.toml`).toContain(name);
          values = { ...values, [String(name)]: input };
        } else if (kind === "expect_pixel") {
          const pixel = value as Table;
          const key = JSON.stringify(values);
          let image = images.get(key);
          if (image === undefined) {
            image = expectedImage(configuratorScene(applyHostValues(values)), 128, 128);
            images.set(key, image);
          }
          const index = Number(pixel["y"]) * 128 + Number(pixel["x"]);
          expect(image.entity[index], `${fixture.file}: pixel ${String(pixel["x"])},${String(pixel["y"])} is not at an edge`).not.toBe(UNSTABLE);
          const oracle = [0, 1, 2].map((c) => image.rgb[index * 3 + c] ?? -1);
          expect(hexBytes(String(pixel["color"])), `${fixture.file}: pixel ${String(pixel["x"])},${String(pixel["y"])}`).toEqual(oracle);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(25);
  });

  it("the pixels changed by an input are those of the entity it drives, and only those", () => {
    // The fixture asserts that the rails keep their colour while the seat changes; the oracle must agree that they are different
    // pictures where the fixture says they change.
    const before = expectedImage(configuratorScene(applyHostValues({})), 128, 128);
    const seat = expectedImage(configuratorScene(applyHostValues({ seat_color: "#2e7d32", seat_metallic: 0, seat_roughness: 0.5 })), 128, 128);
    const at = (x: number, y: number): number => y * 128 + x;
    expect(seat.rgb.slice(at(64, 64) * 3, at(64, 64) * 3 + 3)).not.toEqual(before.rgb.slice(at(64, 64) * 3, at(64, 64) * 3 + 3));
    for (const [x, y] of [[69, 84], [62, 48], [79, 77], [63, 98]] as const) {
      expect(seat.rgb.slice(at(x, y) * 3, at(x, y) * 3 + 3), `pixel ${String(x)},${String(y)} keeps its colour`).toEqual(before.rgb.slice(at(x, y) * 3, at(x, y) * 3 + 3));
    }
  });
});

// ---- physics-playground: seed, geometry and the physics model -----------------------------------------------------------

describe("examples/physics-playground fixtures follow from the seed, the geometry and the physics model", () => {
  it("the crates fixture lists the fates and the counts the seed derives", async () => {
    const fixtures = await fixturesOf("physics-playground");
    expect(fixtures.map((f) => f.file)).toEqual(["crates-and-sensor.test.toml", "space-lifts-first.test.toml"]);
    const crates = byName(fixtures, "crates-and-sensor.test.toml");
    expect(crates.seed).toBe(166);

    const spawns = spawnPositions(166, 6);
    assertSeparated(spawns);
    const fates = spawns.map(fate);
    expect(fates).toEqual(["zone", "off", "off", "floor", "zone", "floor"]);
    const entered = fates.filter((f) => f === "zone").length;
    const destroyed = fates.filter((f) => f === "off").length;
    const alive = 6 - destroyed;
    const NAMED = 6;

    // The last expectations of the fixture are the totals.
    const counters = crates.steps.filter((s) => "expect_counter" in s).map((s) => s["expect_counter"] as Table);
    const last = counters.at(-1) ?? {};
    expect(last).toMatchObject({
      entitiesSpawned: 6,
      entitiesDestroyed: destroyed,
      physicsBodies: 3 + alive,
      physicsColliders: 3 + alive,
      liveEntities: NAMED + alive,
      physicsSteps: 60 + 6 * 150,
    });
    const states = crates.steps.filter((s) => "expect_state" in s).map((s) => s["expect_state"] as Table);
    expect(states.at(-1)).toMatchObject({ entered, inside: entered, spawned: 6 });

    // Per crate: the fixture's expectation after each 150-tick cycle follows the running totals of the fates.
    let spawned = 0;
    let enteredSoFar = 0;
    let destroyedSoFar = 0;
    let bodies = 3;
    const cycles = crates.steps.flatMap((step, index) => ("press" in step ? [index] : []));
    expect(cycles).toHaveLength(6);
    cycles.forEach((start, crate) => {
      spawned += 1;
      if (fates[crate] === "zone") enteredSoFar += 1;
      if (fates[crate] === "off") destroyedSoFar += 1;
      else bodies += 1;
      const next = cycles[crate + 1] ?? crates.steps.length;
      const after = crates.steps.slice(start, next);
      const finalCounter = after.filter((s) => "expect_counter" in s).map((s) => s["expect_counter"] as Table).at(-1);
      const finalState = after.filter((s) => "expect_state" in s).map((s) => s["expect_state"] as Table).at(-1);
      expect(finalCounter, `crate ${String(crate)} counters`).toMatchObject({ entitiesDestroyed: destroyedSoFar, physicsBodies: bodies });
      expect(finalState, `crate ${String(crate)} state`).toMatchObject({ entered: enteredSoFar, spawned });
      if (crate >= 2) {
        expect(finalCounter, `crate ${String(crate)} counters`).toMatchObject({ entitiesSpawned: spawned });
      }
    });

    // The sensor and destroy times of the comments: 47 ticks to fall 3 m, 109 to fall 16 m (the fixture waits 46 + 4 and 109 + 4).
    const deltaTicks = (kind: string): number[] => {
      const ticks: number[] = [];
      let at = 0;
      for (const step of crates.steps) {
        if ("step" in step) at += Number(step["step"]);
        if (kind in step) ticks.push(at);
      }
      return ticks;
    };
    expect(deltaTicks("expect_state").slice(2, 4)).toEqual([60 + 1 + 45, 60 + 1 + 45 + 4]);
    expect(fallDistance(46)).toBeLessThan(3);
    expect(fallDistance(47)).toBeGreaterThanOrEqual(3);
    expect(fallDistance(109)).toBeGreaterThanOrEqual(16);
    expect(fallDistance(108)).toBeLessThan(16);
  });

  it("the meter's pixels are inside the bar for the entries counted and outside for the ones that are not", () => {
    // Row 22 of the 128 x 128 target; columns of the bar's silhouette for n entries (CPU projection of its eight corners).
    const columns = (n: number): { left: number; right: number } => meterColumns(n, 128, 128);
    expect(columns(0).left).toBeLessThan(3);
    expect(columns(0).right).toBeGreaterThan(3.5);
    expect(columns(0).right).toBeLessThan(6.5);
    expect(columns(1).right).toBeGreaterThan(5.5);
    expect(columns(1).right).toBeLessThan(10.5);
    expect(columns(2).right).toBeGreaterThan(11.5);
    expect(columns(2).right).toBeLessThan(13.5);
  });

  it("the lift fixture's height is the engine model's after 31 ticks, 2.5 cm from the continuous apex", async () => {
    const fixtures = await fixturesOf("physics-playground");
    const lift = byName(fixtures, "space-lifts-first.test.toml");
    const rise = liftHeight(10, 2);
    const n = 31;
    const y = 0.5 + 5 * n * STEP - fallDistance(n);
    const expectation = lift.steps
      .filter((s) => "expect_state" in s)
      .map((s) => (s["expect_state"] as Table)["First.position"] as Table)
      .find((entry) => typeof entry === "object" && Array.isArray(entry["value"]) && (entry["value"] as number[])[1] !== 0.5);
    expect(expectation).toBeDefined();
    const wanted = (expectation?.["value"] as number[])[1] ?? NaN;
    expect(Math.abs(wanted - y)).toBeLessThan(1e-3);
    expect(Math.abs(0.5 + rise - y)).toBeLessThan(0.025);
    expect(Number(expectation?.["tolerance"])).toBeGreaterThanOrEqual(0.025);
    // 60 settle + 1 + 30 + 119 ticks.
    const total = lift.steps.reduce((sum, step) => sum + ("step" in step ? Number(step["step"]) : 0), 0);
    expect(total).toBe(210);
    const counters = lift.steps.filter((s) => "expect_counter" in s).map((s) => s["expect_counter"] as Table).at(-1);
    expect(counters).toMatchObject({ physicsSteps: total });
  });
});

// ---- modular-scene: the sources and the CPU reference ---------------------------------------------------------------------

describe("examples/modular-scene fixtures follow from the sources and the CPU reference", () => {
  const TARGET = { width: 128, height: 128 };
  const KEY_P = "KeyP";

  /** What each named instance's material says, from the params of its instance (src/main.mtek) and the defaults of its prefab. */
  const tintOf = (name: string): string => {
    const tints: Record<string, string> = {
      Left: themeColour("STONE"),
      Middle: themeColour("GOLD"),
      Right: themeColour("TEAL"),
      Lantern: themeColour("GOLD"),
      Lamp: themeColour("ROSE"),
    };
    const tint = tints[name];
    if (tint === undefined) throw new Error(`no model for the material of ${name}`);
    return tint;
  };

  interface Replay {
    checks: { pixels: number; states: number; counters: number };
    end: ShowroomState;
    spawned: number;
  }

  /** Replays a fixture on the model: a press is applied at the start of the next frame, P places a pillar until MAX_PLACED. */
  function replay(fixture: FixtureFile): Replay {
    let state: ShowroomState = REST;
    let spawned = 0;
    let pendingSpace = false;
    let pendingP = false;
    const checks = { pixels: 0, states: 0, counters: 0 };
    const near = (actual: number, expected: unknown, tolerance: number, what: string): void => {
      expect(Math.abs(actual - Number(expected)), `${fixture.file}: ${what}`).toBeLessThanOrEqual(tolerance);
      checks.states += 1;
    };
    for (const step of fixture.steps) {
      const [kind, value] = only(step);
      if (kind === "step") {
        const dt = Number(step["dt"]);
        for (let frame = 0; frame < Number(value); frame += 1) {
          if (pendingSpace) state = { ...state, presses: state.presses + 1 };
          if (pendingP && state.placed < themeNumber("MAX_PLACED")) {
            state = { ...state, placed: state.placed + 1 };
            spawned += 1;
          }
          pendingSpace = false;
          pendingP = false;
          state = { ...state, time: state.time + dt };
        }
      } else if (kind === "press") {
        if (value === "Space") pendingSpace = true;
        else if (value === KEY_P) pendingP = true;
        else throw new Error(`${fixture.file}: no model for the key ${String(value)}`);
      } else if (kind === "release") {
        // A release changes nothing in this program.
      } else if (kind === "expect_pixel") {
        const pixel = value as Table;
        const scene = showroom(state, TARGET);
        const expectation = expectPixel(scene, Number(pixel["x"]), Number(pixel["y"]));
        const where = `${fixture.file}: pixel ${String(pixel["x"])},${String(pixel["y"])}`;
        expect(expectation.kind, `${where} is not at an edge`).not.toBe("ambiguous");
        expect(hexBytes(String(pixel["color"])), where).toEqual(expectedColour(scene, expectation));
        checks.pixels += 1;
      } else if (kind === "expect_state") {
        const scene = showroom(state, TARGET);
        for (const [key, entry] of Object.entries(value as Table)) {
          const wrapped = typeof entry === "object" && entry !== null && !Array.isArray(entry) ? (entry as Table) : null;
          const expected = wrapped === null ? entry : wrapped["value"];
          const tolerance = wrapped === null ? 1e-5 : Number(wrapped["tolerance"] ?? 1e-5);
          const [entity, member, param] = key.split(".");
          if (key === "placed") near(state.placed, expected, 0, "placed");
          else if (member === "position" && entity !== undefined) {
            const position = scene.entities.find((e) => e.name === entity)?.position;
            expect(position, `${fixture.file}: the model has ${entity}`).toBeDefined();
            (expected as number[]).forEach((c, i) => near(position?.[i] ?? NaN, c, Math.max(tolerance, 1e-5), `${key}[${String(i)}]`));
          } else if (member === "material" && param === "tint" && entity !== undefined) {
            expect(expected, `${fixture.file}: ${key}`).toBe(tintOf(entity));
            checks.states += 1;
          } else if (member === "material" && param === "dim" && entity === "Lantern") {
            near(beacon([-3.6, 3.4, 0], 1, state.time).dim, expected, Math.max(tolerance, 1e-5), key);
          } else if (member === "material" && param === "dim" && entity === "Lamp") {
            near(beacon([3.6, 3.0, 0], 2, state.time).dim, expected, Math.max(tolerance, 1e-5), key);
          } else throw new Error(`${fixture.file}: no model for ${key}`);
        }
      } else if (kind === "expect_counter") {
        for (const [name, expected] of Object.entries(value as Table)) {
          if (name === "liveEntities") expect(expected, `${fixture.file}: liveEntities`).toBe(7 + state.placed);
          else if (name === "entitiesSpawned") expect(expected, `${fixture.file}: entitiesSpawned`).toBe(spawned);
          else throw new Error(`${fixture.file}: no model for the counter ${name}`);
          checks.counters += 1;
        }
      } else throw new Error(`${fixture.file}: no model for the step ${kind}`);
    }
    return { checks, end: state, spawned };
  }

  it("every expectation is what the sources and the reference derive, at pixels that see one surface", async () => {
    const fixtures = await fixturesOf("modular-scene");
    expect(fixtures.map((f) => f.file)).toEqual([
      "beacons-bob-and-pulse.test.toml",
      "instances-and-defaults.test.toml",
      "p-places-pillars.test.toml",
      "space-grows-gauge.test.toml",
    ]);
    const results = new Map(fixtures.map((fixture) => [fixture.file, replay(fixture)]));
    for (const [file, result] of results) {
      expect(result.checks.pixels, `${file}: pixels checked`).toBeGreaterThanOrEqual(5);
      expect(result.checks.states + result.checks.counters, `${file}: states and counters checked`).toBeGreaterThanOrEqual(4);
    }
    // The ends of the runs the comments describe: four pillars placed by five presses of P, three presses of Space.
    expect(results.get("p-places-pillars.test.toml")).toMatchObject({ end: { placed: 4 }, spawned: 4 });
    expect(results.get("space-grows-gauge.test.toml")?.end.presses).toBe(3);
    expect(results.get("beacons-bob-and-pulse.test.toml")?.end.time).toBeCloseTo((3 * Math.PI) / 2, 5);
  });

  it("no fixture of this program sets a seed: it has no random()", async () => {
    const fixtures = await fixturesOf("modular-scene");
    for (const fixture of fixtures) expect(fixture.seed, `${fixture.file}: no random() in this program`).toBe(0);
  });
});
