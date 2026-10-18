/**
 * The params of the built-in materials written and read by name (decision 0087), on the compiler's `builtin_params`
 * program, the real runtime and the fake GPU:
 *
 *  - the update classes the compiler recorded reach the manifest like those of a user material's params;
 *  - a handler's write of `Badge.material.color` (an `Unlit`) reaches the instance's slot of the `Unlit` parameter block in
 *    the render phase of the frame of the key press, as one upload, and a frame without a write uploads nothing for it
 *    (the dirty tracking of `spec/gpu-layout.md` section 8.2); `update`'s `Ball.material.roughness += dt` (a `Pbr`) reaches
 *    the `Pbr` block every frame;
 *  - a handler and a binding read what was written, in the frame it was written;
 *  - `builtin_params_edited` (other literals, one other formula) reloads by update class (`spec/runtime-abi.md` section 11.3,
 *    decision 0067): an `imperative` param keeps its running value, an `initial` one takes the edited literal, a `bound` one
 *    runs the new formula on the kept state.
 *
 * Expected colours come from the sRGB transfer function of the standard applied to the literals of the source, not from
 * the compiler's output.
 */
import { describe, expect, it } from "vitest";
import type { MtekInstanceParam, MtekManifest } from "../abi/manifest-types.js";
import { checkManifest } from "../abi/validate.js";
import type { MtekDiagnostic } from "../diagnostics/types.js";
import { resolveStructure } from "../scene/structure.js";
import { World } from "../scene/world.js";
import type { FakeBuffer } from "../test-support/fake-gpu.js";
import { bufferLabelled, floats, memberOffset } from "../test-support/frame-block.js";
import { FakeHost, asDom, minimalManifestJson } from "../test-support/fake-host.js";
import { loadGoldenProgram, type GoldenProgram } from "../test-support/program.js";
import { mountMtekWith } from "./mount.js";
import { migrateWorld } from "./reload.js";
import type { MtekApp, MtekDebug } from "./types.js";

const f = Math.fround;

/** sRGB byte to linear light, from the transfer function of the standard. */
function linear(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** The linear RGBA of an opaque `#rrggbb` literal, as binary32. */
function hex(rgb: number): number[] {
  return [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff].map((byte) => f(linear(byte))).concat([1]);
}

const UNLIT = "material:std/materials.mtek::Unlit";
const PBR = "material:std/materials.mtek::Pbr";

interface Running {
  readonly host: FakeHost;
  readonly app: MtekApp;
  readonly debug: MtekDebug;
  readonly manifest: MtekManifest;
  readonly reported: MtekDiagnostic[];
  readonly edited: GoldenProgram;
}

async function mountBuiltinParams(): Promise<Running> {
  const original = await loadGoldenProgram("builtin_params");
  const edited = await loadGoldenProgram("builtin_params_edited");
  const host = new FakeHost();
  for (const golden of [original, edited]) for (const [url, text] of golden.files) host.files.set(url, text);
  const reported: MtekDiagnostic[] = [];
  const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), original.program, {
    test: { manualClock: true, renderTarget: { width: 16, height: 8 } },
    onDiagnostic: (d) => reported.push(d),
  });
  if (app.debug === undefined) throw new Error("no debug API");
  return { host, app, debug: app.debug, manifest: original.manifest, reported, edited };
}

/** The material instance of the entity `name`. */
function instanceOf(manifest: MtekManifest, name: string): number {
  const entity = manifest.scene.entities.find((candidate) => candidate.name === name);
  const instance = entity?.material?.instance;
  if (instance === undefined) throw new Error(`no material instance for ${name}`);
  return instance;
}

/**
 * The byte offset of the slot of `instance` in the arena of its layout: instances own a slot each in instance order (none of
 * those read here is `shareable`), and slots are `minUniformBufferOffsetAlignment` (256 on the fake) apart.
 */
function slotOffset(manifest: MtekManifest, instance: number): number {
  const material = manifest.scene.materialInstances[instance]?.material;
  const before = manifest.scene.materialInstances.filter((candidate) => candidate.index < instance && candidate.material === material).length;
  return before * 256;
}

function paramOf(running: Running, layout: string, entity: string, param: string, count: number): number[] {
  const buffer = bufferLabelled(running.host, `mtek:uniform-arena:${layout}`);
  return [...floats(buffer, slotOffset(running.manifest, instanceOf(running.manifest, entity)) + memberOffset(running.manifest, layout, param), count)];
}

/** The queue writes into `buffer` so far. */
function writesTo(host: FakeHost, buffer: FakeBuffer): Array<{ bufferOffset: number; size: number }> {
  return host.device.queue.writes.filter((write) => write.buffer === buffer).map(({ bufferOffset, size }) => ({ bufferOffset, size }));
}

function markerOf(debug: MtekDebug): number[] {
  const position = debug.scene().entities.find((entity) => entity.name === "Marker")?.position as { x: number; y: number; z: number };
  return [position.x, position.y, position.z];
}

function colorOf(value: unknown): number[] {
  const c = value as { r: number; g: number; b: number; a: number };
  return [c.r, c.g, c.b, c.a];
}

describe("the params of the built-in materials, on the compiler's builtin_params program", () => {
  it("records the update classes of the built-in params as for a user material's", async () => {
    const { manifest, app } = await mountBuiltinParams();
    const classes = (entity: string) =>
      Object.fromEntries((manifest.scene.materialInstances[instanceOf(manifest, entity)]?.params ?? []).map((param) => [param.name, param.class]));
    expect(classes("Badge")).toEqual({ color: "imperative" });
    expect(classes("Ball")).toEqual({ base_color: "initial", metallic: "bound", roughness: "imperative", base_color_texture: "resource", base_color_sampler: "resource" });
    // The default `Unlit {}` of a mesh: written by a handler of the scene, or never.
    expect(classes("Plain")).toEqual({ color: "imperative" });
    expect(classes("Marker")).toEqual({ color: "initial" });
    // Only the instance whose every param is `initial` may share its block (decision 0059).
    expect(manifest.scene.materialInstances.map((instance) => instance.shareable)).toEqual([false, false, false, true]);
    // A binding that reads built-in params depends on them.
    const ball = instanceOf(manifest, "Ball");
    expect(manifest.scene.bindings.find((binding) => binding.target.kind === "transform")?.deps).toEqual([
      { kind: "param", instance: ball, name: "roughness" },
      { kind: "param", instance: ball, name: "metallic" },
    ]);
    app.dispose();
  });

  it("uploads a handler's write of an Unlit colour in the frame of the key press, and nothing in frames without one", async () => {
    const running = await mountBuiltinParams();
    const { host, debug, app, reported } = running;
    debug.step(1, 0.1);
    expect(paramOf(running, UNLIT, "Badge", "color", 4)).toEqual(hex(0x22c55e));
    const unlit = bufferLabelled(host, `mtek:uniform-arena:${UNLIT}`);
    const before = writesTo(host, unlit).length;
    debug.step(3, 0.1);
    expect(writesTo(host, unlit).length, "no write, no upload").toBe(before);

    debug.pressKey("Space");
    debug.step(1, 0.1);
    expect(paramOf(running, UNLIT, "Badge", "color", 4)).toEqual(hex(0x3b82f6));
    const badge = slotOffset(running.manifest, instanceOf(running.manifest, "Badge"));
    expect(writesTo(host, unlit).slice(before)).toEqual([{ bufferOffset: badge, size: 16 }]);
    // The other Unlit instances keep their bytes: the default white of Plain and Marker.
    expect(paramOf(running, UNLIT, "Plain", "color", 4)).toEqual([1, 1, 1, 1]);
    expect(paramOf(running, UNLIT, "Marker", "color", 4)).toEqual([1, 1, 1, 1]);

    debug.releaseKey("Space");
    debug.step(2, 0.1);
    expect(writesTo(host, unlit).length, "the write is uploaded once").toBe(before + 1);
    expect(reported).toEqual([]);
    app.dispose();
  });

  it("writes Pbr params every frame `update` changes them, and the binding reads them in the same frame", async () => {
    const running = await mountBuiltinParams();
    const { debug, app, reported } = running;
    let roughness = f(0.25);
    for (let frame = 0; frame < 4; frame += 1) {
      debug.step(1, 0.1);
      roughness = f(roughness + f(0.1));
      expect(paramOf(running, PBR, "Ball", "roughness", 1), `frame ${String(frame)}`).toEqual([roughness]);
      // Marker's position is bound to (roughness, metallic, 0): this frame's roughness, metallic bound to `taps % 2` (0).
      expect(markerOf(debug), `frame ${String(frame)}`).toEqual([roughness, 0, 0]);
    }
    // The initial base colour, written once by `init`.
    expect(paramOf(running, PBR, "Ball", "base_color", 4)).toEqual(hex(0xc0c0c0));
    debug.pressKey("Space");
    debug.step(1, 0.1);
    roughness = f(roughness + f(0.1));
    // taps is 1: the bound metallic is 1, and Marker reads it after its binding was evaluated.
    expect(paramOf(running, PBR, "Ball", "metallic", 1)).toEqual([1]);
    expect(markerOf(debug)).toEqual([roughness, 1, 0]);
    expect(reported).toEqual([]);
    app.dispose();
  });

  it("a handler reads what was written: Enter copies Badge's colour into state and into Plain, and Ball's roughness into state", async () => {
    const running = await mountBuiltinParams();
    const { debug, app, reported } = running;
    debug.pressKey("Space");
    debug.step(1, 0.1);
    debug.pressKey("Enter");
    debug.step(1, 0.1);
    const state = debug.scene().state;
    expect(colorOf(state["seen"])).toEqual(hex(0x3b82f6));
    // Input handlers run before `update`: the roughness read is the one after the first frame's update.
    expect(state["rough"]).toBe(f(f(0.25) + f(0.1)));
    expect(paramOf(running, UNLIT, "Plain", "color", 4)).toEqual(hex(0x3b82f6));
    expect(reported).toEqual([]);
    app.dispose();
  });
});

describe("hot reload of built-in params, from builtin_params to builtin_params_edited", () => {
  it("keeps the imperative params, applies the edited initial literal and runs the new bound formula", async () => {
    const running = await mountBuiltinParams();
    const { debug, app, reported, edited } = running;
    let roughness = f(0.25);
    debug.pressKey("Space");
    debug.step(1, 0.1);
    roughness = f(roughness + f(0.1));
    debug.releaseKey("Space");
    debug.pressKey("Enter");
    debug.step(1, 0.1);
    roughness = f(roughness + f(0.1));
    expect(paramOf(running, PBR, "Ball", "metallic", 1)).toEqual([1]);

    expect(await app.replaceProgram?.(edited.program)).toEqual({ ok: true });
    // The swap happens at the start of the next frame; a frame of 0 seconds changes nothing the program does.
    debug.step(1, 0);

    // Badge.color is imperative in both programs: the handler's colour stays, not the edited literal #f59e0b.
    expect(paramOf(running, UNLIT, "Badge", "color", 4)).toEqual(hex(0x3b82f6));
    // Plain.color is imperative in both: the colour Enter copied stays.
    expect(paramOf(running, UNLIT, "Plain", "color", 4)).toEqual(hex(0x3b82f6));
    // Ball.roughness is imperative in both: the running value, not the edited literal 0.75.
    expect(paramOf(running, PBR, "Ball", "roughness", 1)).toEqual([roughness]);
    // Ball.base_color is initial: the edited literal applies.
    expect(paramOf(running, PBR, "Ball", "base_color", 4)).toEqual(hex(0x808080));
    // Ball.metallic is bound: the new formula `f32(taps % 2) * 0.5` on the kept state (taps 1).
    expect(paramOf(running, PBR, "Ball", "metallic", 1)).toEqual([0.5]);
    expect(debug.scene().state["taps"]).toBe(1);
    expect(markerOf(debug)).toEqual([roughness, 0.5, 0]);
    expect(reported.map((d) => d.code)).toEqual([]);

    // The scene keeps running on the kept values.
    debug.step(1, 0.1);
    roughness = f(roughness + f(0.1));
    expect(paramOf(running, PBR, "Ball", "roughness", 1)).toEqual([roughness]);
    app.dispose();
  });
});

type Class = MtekInstanceParam["class"];
type Color = { r: number; g: number; b: number; a: number };

const RED: Color = { r: 1, g: 0, b: 0, a: 1 };
const BLUE: Color = { r: 0, g: 0, b: 1, a: 1 };

/** The minimal manifest (one entity with the built-in `Unlit`) with the given class of its `color` param. */
function manifestWith(colorClass: Class): MtekManifest {
  const json = minimalManifestJson();
  const scene = json["scene"] as { materialInstances: Array<{ params: Array<{ name: string; class: string; binding?: number }>; shareable: boolean }> };
  const instance = scene.materialInstances[0];
  if (instance === undefined) throw new Error("minimal manifest has no material instance");
  instance.params = [colorClass === "bound" ? { name: "color", class: "bound", binding: 0 } : { name: "color", class: colorClass }];
  instance.shareable = colorClass === "initial";
  if (colorClass === "bound") {
    (json["scene"] as Record<string, unknown>)["bindings"] = [
      { id: 0, target: { kind: "param", instance: 0, name: "color" }, deps: [{ kind: "frame", name: "time" }], order: 0, span: 0 },
    ];
  }
  const parsed = checkManifest(json);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.failures));
  return parsed.manifest;
}

/** `manifest` with its material renamed: another material with a `color` param of the same type. */
function withOtherMaterial(manifest: MtekManifest): MtekManifest {
  const id = "src/main.mtek::Tint";
  const renamed = (value: string): string => (value === "std/materials.mtek::Unlit" ? id : value);
  return {
    ...manifest,
    materials: manifest.materials.map((material) => ({ ...material, id: renamed(material.id) })),
    scene: {
      ...manifest.scene,
      entities: manifest.scene.entities.map((entity) => (entity.material === null ? entity : { ...entity, material: { ...entity.material, id: renamed(entity.material.id) } })),
      materialInstances: manifest.scene.materialInstances.map((instance) => ({ ...instance, material: renamed(instance.material) })),
    },
  };
}

interface Ctx {
  setParam(entity: unknown, name: string, value: unknown): void;
}

/** A world of `manifest` whose entity's `color` holds `color` (what `init` or a handler left in it). */
function worldHolding(manifest: MtekManifest, color: Color): World {
  const structure = resolveStructure(manifest);
  if (!structure.ok) throw new Error(JSON.stringify(structure.diagnostics));
  const world = new World({ manifest, structure: structure.structure, params: { writeParam: () => undefined }, report: () => undefined });
  (world.ctx as Ctx).setParam(world.entities[0], "color", color);
  return world;
}

describe("migrateWorld and the update classes of material params (decision 0087, the rule of decision 0067)", () => {
  /** The running world had RED; the new program's `init` made it BLUE. Returns what the swap leaves. */
  function migrate(before: MtekManifest, after: MtekManifest): unknown {
    const previous = worldHolding(before, RED);
    const next = worldHolding(after, BLUE);
    migrateWorld(previous, before, next, after);
    return next.entities[0]?.mat?.p["color"];
  }

  it("keeps the running value of a param that is imperative in both programs, as a copy", () => {
    const manifest = manifestWith("imperative");
    const previous = worldHolding(manifest, RED);
    const next = worldHolding(manifest, BLUE);
    migrateWorld(previous, manifest, next, manifest);
    expect(next.entities[0]?.mat?.p["color"]).toEqual(RED);
    expect(next.entities[0]?.mat?.p["color"]).not.toBe(previous.entities[0]?.mat?.p["color"]);
  });

  it("applies what the new init set when the param was not imperative before or is not imperative now", () => {
    for (const other of ["initial", "bound"] as const) {
      expect(migrate(manifestWith(other), manifestWith("imperative")), `${other} -> imperative`).toEqual(BLUE);
      expect(migrate(manifestWith("imperative"), manifestWith(other)), `imperative -> ${other}`).toEqual(BLUE);
    }
  });

  it("keeps nothing when the entity's material is another one, even with a param of the same name and type", () => {
    const before = manifestWith("imperative");
    const after = withOtherMaterial(before);
    const previous = worldHolding(before, RED);
    const next = worldHolding(after, BLUE);
    migrateWorld(previous, before, next, after);
    expect(next.entities[0]?.mat?.p["color"]).toEqual(BLUE);
  });
});
