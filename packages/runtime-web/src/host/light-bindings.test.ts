/**
 * Bindings that read light fields and hot reload of light colour and intensity (decision 0067).
 *
 *  - The compiler's `light_bindings` program runs on the real runtime and the fake GPU: its bindings read the
 *    fields of lights (a bound one and one a handler writes) and feed lights, and are evaluated in the order
 *    of their dependencies.
 *  - `light_bindings_edited` is the same scene with other literals and one other formula: reloading it keeps
 *    what the program changed at run time and applies what the source says (`spec/runtime-abi.md` section 11.3).
 *  - `migrateWorld` is checked against every combination of update classes on hand-made manifests.
 */
import { describe, expect, it } from "vitest";
import type { MtekLight, MtekLightClass, MtekManifest } from "../abi/manifest-types.js";
import { checkManifest } from "../abi/validate.js";
import type { MtekDiagnostic } from "../diagnostics/types.js";
import { World } from "../scene/world.js";
import { resolveStructure } from "../scene/structure.js";
import { bufferLabelled, frameLights } from "../test-support/frame-block.js";
import { FakeHost, asDom, minimalManifestJson } from "../test-support/fake-host.js";
import { loadGoldenProgram, type GoldenProgram } from "../test-support/program.js";
import { mountMtekWith } from "./mount.js";
import { migrateWorld } from "./reload.js";
import type { MtekApp, MtekDebug } from "./types.js";

const f = Math.fround;

/** sRGB byte to linear light, from the transfer function of the standard (not from the compiler's output). */
function linear(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

const SUN_ORIGINAL = [0xff, 0xe0, 0xb0].map(linear);
const SUN_EDITED = [0xb0, 0xe0, 0xff].map(linear);

interface Running {
  readonly host: FakeHost;
  readonly app: MtekApp;
  readonly debug: MtekDebug;
  readonly manifest: MtekManifest;
  readonly reported: MtekDiagnostic[];
}

/** The two golden programs of the same scene on one fake host. */
async function mountLightBindings(): Promise<Running & { readonly original: GoldenProgram; readonly edited: GoldenProgram }> {
  const original = await loadGoldenProgram("light_bindings");
  const edited = await loadGoldenProgram("light_bindings_edited");
  const host = new FakeHost();
  for (const golden of [original, edited]) for (const [url, text] of golden.files) host.files.set(url, text);
  const reported: MtekDiagnostic[] = [];
  const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), original.program, {
    test: { manualClock: true, renderTarget: { width: 16, height: 8 } },
    onDiagnostic: (d) => reported.push(d),
  });
  if (app.debug === undefined) throw new Error("no debug API");
  return { host, app, debug: app.debug, manifest: original.manifest, reported, original, edited };
}

/** What the scene computes from `warmth` and the intensity `update` gave Lamp, in binary32 like generated code. */
function expected(warmth: number, lamp: number, sunBase: number) {
  const sun = f(sunBase + f(warmth * 4));
  const fill = f(sun * 0.5);
  return { sun, fill, marker: [f(fill * 0.25), f(sun * 0.125), f(lamp * 0.0625)] };
}

/** Light `slot` of the frame block as colour (rgb times intensity) read back. */
function packedColor(running: Running, slot: number): number[] {
  const frame = bufferLabelled(running.host, "mtek:uniform-arena:builtin:frame");
  const light = frameLights(running.manifest, frame)[slot];
  if (light === undefined) throw new Error(`no light ${String(slot)}`);
  return light.color;
}

function expectPacked(actual: readonly number[], rgb: readonly number[], intensity: number): void {
  expect(actual).toHaveLength(3);
  actual.forEach((value, i) => expect(value).toBeCloseTo(f(rgb[i] ?? Number.NaN) * intensity, 5));
}

function markerOf(debug: MtekDebug): number[] {
  const position = debug.scene().entities[0]?.position as { x: number; y: number; z: number };
  return [position.x, position.y, position.z];
}

/** The light slots of `light_bindings`: Fill (entity 1), Sun (entity 2), Lamp (entity 3). */
const FILL = 0;
const SUN = 1;
const LAMP = 2;

describe("bindings that read light fields, on the compiler's light_bindings program", () => {
  it("declares the reads as dependencies and evaluates the bindings in their order: Sun, Fill, then Marker", async () => {
    const { manifest, app } = await mountLightBindings();
    const order = new Map(manifest.scene.bindings.map((binding) => [JSON.stringify(binding.target), binding.order]));
    const of = (entity: number, field: string): number => order.get(JSON.stringify({ kind: "light", entity, field })) ?? -1;
    const marker = order.get(JSON.stringify({ kind: "transform", entity: 0, field: "position" })) ?? -1;
    expect(of(2, "intensity")).toBeLessThan(of(1, "intensity"));
    expect(of(1, "intensity")).toBeLessThan(marker);
    // Marker is declared first, so declaration order alone would evaluate it before what it reads.
    expect(manifest.scene.bindings[0]?.target).toEqual({ kind: "transform", entity: 0, field: "position" });
    expect(manifest.scene.bindings[0]?.deps).toEqual([
      { kind: "light", entity: 1, field: "intensity" },
      { kind: "light", entity: 2, field: "intensity" },
      { kind: "light", entity: 3, field: "intensity" },
    ]);
    app.dispose();
  });

  it("evaluates every binding after init in dependency order, before the first frame", async () => {
    const { debug, app } = await mountLightBindings();
    // warmth 0.5: Sun 2 + 0.5 * 4 = 4, Fill 2, Lamp 4. Marker evaluated before Fill and Sun would read the defaults (1).
    expect(markerOf(debug)).toEqual(expected(0.5, 4, 2).marker);
    expect(markerOf(debug)).toEqual([0.5, 0.5, 0.25]);
    app.dispose();
  });

  it("reads a bound light field and a handler's write in the frame they happen, and feeds the lights", async () => {
    const running = await mountLightBindings();
    const { debug, app, reported } = running;
    let warmth = f(0.5);
    let lamp = f(4);
    for (let frame = 0; frame < 4; frame += 1) {
      debug.step(1, 0.1);
      warmth = f(warmth + f(0.1));
      lamp = f(lamp + f(0.1));
      const now = expected(warmth, lamp, 2);
      // Marker sees the intensities Sun and Fill were given by this frame's evaluation and the one Lamp's
      // handler wrote this frame, not those of the frame before.
      expect(markerOf(debug), `frame ${String(frame)}`).toEqual(now.marker);
      // The bound intensities reach the frame block next to the colours: Sun's own, Fill's bound to Sun's.
      expectPacked(packedColor(running, SUN), SUN_ORIGINAL, now.sun);
      expectPacked(packedColor(running, FILL), SUN_ORIGINAL, now.fill);
      expectPacked(packedColor(running, LAMP), [0.25, warmth, 0.75], lamp);
    }
    expect(reported).toEqual([]);
    app.dispose();
  });
});

describe("hot reload of light colour and intensity, from light_bindings to light_bindings_edited", () => {
  it("applies the edited literal, formula and bindings and keeps the value a handler wrote and the unrelated state", async () => {
    const running = await mountLightBindings();
    const { debug, app, reported, edited } = running;
    let warmth = f(0.5);
    let lamp = f(4);
    for (let frame = 0; frame < 3; frame += 1) {
      debug.step(1, 0.1);
      warmth = f(warmth + f(0.1));
      lamp = f(lamp + f(0.1));
    }
    expectPacked(packedColor(running, SUN), SUN_ORIGINAL, expected(warmth, lamp, 2).sun);

    expect(await app.replaceProgram?.(edited.program)).toEqual({ ok: true });
    // The swap happens at the start of the next frame; a frame of 0 seconds changes nothing the program does.
    debug.step(1, 0);

    // The unrelated state `warmth` is the running value, not the initial 0.5.
    expect(debug.scene().state["warmth"]).toBe(warmth);
    // Sun.color is `initial`: the edited literal applies. Sun.intensity is `bound`: the new formula (3 + ..) runs on the kept state.
    const now = expected(warmth, lamp, 3);
    expectPacked(packedColor(running, SUN), SUN_EDITED, now.sun);
    // Fill is bound to Sun in both programs and follows.
    expectPacked(packedColor(running, FILL), SUN_EDITED, now.fill);
    // Lamp is `imperative`: its intensity is the one `update` had reached, not the edited literal 9 and not the old 4.
    expectPacked(packedColor(running, LAMP), [0.25, warmth, 0.75], lamp);
    expect(lamp).not.toBe(9);
    expect(markerOf(debug)).toEqual(now.marker);
    // No restart: the structure did not change.
    expect(reported.map((d) => d.code)).toEqual([]);

    // The scene keeps running on the kept values.
    debug.step(1, 0.1);
    warmth = f(warmth + f(0.1));
    lamp = f(lamp + f(0.1));
    const later = expected(warmth, lamp, 3);
    expectPacked(packedColor(running, SUN), SUN_EDITED, later.sun);
    expectPacked(packedColor(running, LAMP), [0.25, warmth, 0.75], lamp);
    expect(markerOf(debug)).toEqual(later.marker);
    app.dispose();
  });

  it("applies the literal again when the edit is undone, and still keeps the handler's value", async () => {
    const running = await mountLightBindings();
    const { debug, app, reported, edited, original } = running;
    debug.step(2, 0.1);
    expect(await app.replaceProgram?.(edited.program)).toEqual({ ok: true });
    debug.step(1, 0.1);
    expect(await app.replaceProgram?.(original.program)).toEqual({ ok: true });
    debug.step(1, 0);
    const warmth = debug.scene().state["warmth"] as number;
    // Three frames of 0.1 have run in all; the last one had 0, and the scene is the original again.
    expect(warmth).toBe(f(f(f(0.5 + f(0.1)) + f(0.1)) + f(0.1)));
    expectPacked(packedColor(running, SUN), SUN_ORIGINAL, expected(warmth, f(f(f(4 + f(0.1)) + f(0.1)) + f(0.1)), 2).sun);
    expect(reported.map((d) => d.code)).toEqual([]);
    app.dispose();
  });
});

type Color = { r: number; g: number; b: number; a: number };

const RED: Color = { r: 1, g: 0, b: 0, a: 1 };
const BLUE: Color = { r: 0, g: 0, b: 1, a: 1 };

/** The minimal manifest with `light` (or none) on its only entity. */
function manifestWith(light: { kind: "directional" | "point"; color: MtekLightClass; intensity: MtekLightClass } | null): MtekManifest {
  const json = minimalManifestJson();
  const scene = json["scene"] as { entities: Record<string, unknown>[]; lights: MtekLight[] };
  const entity = scene.entities[0];
  if (entity === undefined) throw new Error("minimal manifest has no entity");
  if (light === null) {
    entity["light"] = null;
    scene.lights = [];
  } else {
    entity["light"] = 0;
    const classes = { color: light.color, intensity: light.intensity };
    scene.lights = [light.kind === "point" ? { index: 0, entity: 0, kind: "point", range: 5, classes } : { index: 0, entity: 0, kind: "directional", classes }];
  }
  const parsed = checkManifest(json);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.failures));
  return parsed.manifest;
}

interface Ctx {
  setLight(entity: unknown, field: string, value: unknown): void;
}

/** A world of `manifest` whose light holds `color` and `intensity` (what `init` or a handler left in it). */
function worldHolding(manifest: MtekManifest, color: Color, intensity: number): World {
  const structure = resolveStructure(manifest);
  if (!structure.ok) throw new Error(JSON.stringify(structure.diagnostics));
  const world = new World({ manifest, structure: structure.structure, params: { writeParam: () => undefined }, report: () => undefined });
  const entity = world.entities[0];
  if (entity?.light !== null && entity !== undefined) {
    (world.ctx as Ctx).setLight(entity, "color", color);
    (world.ctx as Ctx).setLight(entity, "intensity", intensity);
  }
  return world;
}

describe("migrateWorld and the update classes of light fields", () => {
  type Spec = { kind: "directional" | "point"; color: MtekLightClass; intensity: MtekLightClass };
  const bothImperative: Spec = { kind: "point", color: "imperative", intensity: "imperative" };

  /** The running world had the light RED at 2; the new program's `init` made it BLUE at 7. Returns what the swap leaves. */
  function migrate(before: Spec | null, after: Spec | null): { color: Color; intensity: number } | null {
    const previousManifest = manifestWith(before);
    const nextManifest = manifestWith(after);
    const previous = worldHolding(previousManifest, RED, 2);
    const next = worldHolding(nextManifest, BLUE, 7);
    migrateWorld(previous, previousManifest, next, nextManifest);
    const light = next.entities[0]?.light;
    return light === null || light === undefined ? null : { color: light.color, intensity: light.intensity };
  }

  it("keeps the running colour and intensity of a field that is imperative in both programs", () => {
    expect(migrate(bothImperative, bothImperative)).toEqual({ color: RED, intensity: 2 });
  });

  it("decides per field: an imperative colour is kept, an initial intensity takes the edited literal", () => {
    const after: Spec = { ...bothImperative, intensity: "initial" };
    expect(migrate(bothImperative, after)).toEqual({ color: RED, intensity: 7 });
    expect(migrate(bothImperative, { ...bothImperative, color: "initial" })).toEqual({ color: BLUE, intensity: 2 });
  });

  it("applies what the new init set when the field was not imperative before or is not imperative now", () => {
    for (const other of ["initial", "bound"] as const) {
      expect(migrate({ ...bothImperative, color: other, intensity: other }, bothImperative)).toEqual({ color: BLUE, intensity: 7 });
      expect(migrate(bothImperative, { ...bothImperative, color: other, intensity: other })).toEqual({ color: BLUE, intensity: 7 });
    }
  });

  it("keeps nothing of a light whose kind changed, and nothing happens for a light that was added or removed", () => {
    expect(migrate(bothImperative, { ...bothImperative, kind: "directional" })).toEqual({ color: BLUE, intensity: 7 });
    expect(migrate(null, bothImperative)).toEqual({ color: BLUE, intensity: 7 });
    expect(migrate(bothImperative, null)).toBeNull();
  });

  it("copies the colour: the new light does not share the old record's object", () => {
    const previousManifest = manifestWith(bothImperative);
    const previous = worldHolding(previousManifest, RED, 2);
    const next = worldHolding(previousManifest, BLUE, 7);
    migrateWorld(previous, previousManifest, next, previousManifest);
    expect(next.entities[0]?.light?.color).toEqual(RED);
    expect(next.entities[0]?.light?.color).not.toBe(previous.entities[0]?.light?.color);
  });
});
