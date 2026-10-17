import { describe, expect, it } from "vitest";
import { checkManifest } from "../abi/validate.js";
import type { MtekManifest } from "../abi/manifest-types.js";
import { makeRuntimeDiagnostic, type MtekDiagnostic } from "../diagnostics/types.js";
import type { MountedApp } from "../host/app.js";
import { mountMtekWith } from "../host/mount.js";
import type { MtekApp, MtekDebug, MtekMountOptions } from "../host/types.js";
import { lookAt, multiply, normalMatrix, perspective, translation } from "../math/mat4.js";
import { RuntimeInternalError } from "../scene/world.js";
import { FakeBuffer } from "../test-support/fake-gpu.js";
import {
  BASE_URL,
  FakeHost,
  MINIMAL_SCENE_COLOR,
  asDom,
  fakeProgram,
  minimalSceneInit,
  type FakeHostOptions,
  type FakeDrawRecord,
  type InitContext,
} from "../test-support/fake-host.js";
import { installProgram } from "../test-support/mount-fixture.js";
import { CODEGEN_FIXTURES, loadGoldenProgram } from "../test-support/program.js";
import { compareDraws, type DrawSortKey } from "./renderer.js";

type Json = Record<string, unknown>;

interface Mounted {
  readonly host: FakeHost;
  readonly app: MtekApp;
  readonly debug: MtekDebug;
  readonly manifest: MtekManifest;
  readonly reported: MtekDiagnostic[];
}

const TARGET = { width: 16, height: 8 } as const;

async function mountScene(
  setup: {
    edit?: (manifest: Json) => void;
    init?: (ctx: object) => void;
    host?: FakeHostOptions;
    options?: MtekMountOptions;
    files?: (host: FakeHost) => void;
  } = {},
): Promise<Mounted> {
  const host = new FakeHost(setup.host);
  const json = installProgram(host, setup.edit);
  setup.files?.(host);
  const parsed = checkManifest(json);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.failures));
  const reported: MtekDiagnostic[] = [];
  const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), fakeProgram(setup.init, parsed.manifest), {
    test: { manualClock: true, renderTarget: TARGET },
    onDiagnostic: (d) => reported.push(d),
    ...setup.options,
  });
  if (app.debug === undefined) throw new Error("no debug API");
  return { host, app, debug: app.debug, manifest: parsed.manifest, reported };
}

/** The live buffer with this label (arena buffers are labelled `mtek:uniform-arena:<layout id>`). */
function bufferLabelled(host: FakeHost, label: string): FakeBuffer {
  const found = host.device.buffers.filter((buffer) => buffer.label === label && !buffer.destroyed);
  if (found.length !== 1 || found[0] === undefined) throw new Error(`expected one live buffer '${label}', found ${String(found.length)}`);
  return found[0];
}

/** The byte offset of a top-level member, from the manifest's layout record (never hard-coded). */
function memberOffset(manifest: MtekManifest, layoutId: string, member: string): number {
  const node = manifest.layouts.find((layout) => layout.id === layoutId)?.root.members.find((m) => m.name === member)?.node;
  if (node === undefined) throw new Error(`no member ${member} in ${layoutId}`);
  return node.offset;
}

function floats(buffer: FakeBuffer, byteOffset: number, count: number): Float32Array {
  return new Float32Array(buffer.contents.buffer.slice(byteOffset, byteOffset + count * 4));
}

/** One `MtekLight` read back from the frame block, vectors as arrays. */
interface ReadLight {
  readonly color: number[];
  readonly kind: number;
  readonly position: number[];
  readonly range: number;
  readonly direction: number[];
}

const ZERO_LIGHT: ReadLight = { color: [0, 0, 0], kind: 0, position: [0, 0, 0], range: 0, direction: [0, 0, 0] };

/** `light_count` of the frame block. */
function frameLightCount(manifest: MtekManifest, frame: FakeBuffer): number {
  const at = memberOffset(manifest, "builtin:frame", "light_count");
  return new Uint32Array(frame.contents.buffer.slice(at, at + 4))[0] ?? -1;
}

/**
 * Every `MtekLight` of the frame block, from the offsets and stride of the manifest's layout record (the
 * test, like the runtime, never hard-codes them).
 */
function frameLights(manifest: MtekManifest, frame: FakeBuffer): ReadLight[] {
  const node = manifest.layouts.find((layout) => layout.id === "builtin:frame")?.root.members.find((m) => m.name === "lights")?.node;
  if (node?.kind !== "array" || node.element.kind !== "struct") throw new Error("the lights member is not an array of structs");
  const element = node.element;
  const at = (slot: number, member: string): number => {
    const found = element.members.find((m) => m.name === member);
    if (found === undefined) throw new Error(`no MtekLight member ${member}`);
    return node.offset + slot * node.stride + found.node.offset;
  };
  return Array.from({ length: node.length }, (_, slot) => ({
    color: Array.from(floats(frame, at(slot, "color"), 3)),
    kind: new Uint32Array(frame.contents.buffer.slice(at(slot, "kind"), at(slot, "kind") + 4))[0] ?? -1,
    position: Array.from(floats(frame, at(slot, "position"), 3)),
    range: floats(frame, at(slot, "range"), 1)[0] ?? Number.NaN,
    direction: Array.from(floats(frame, at(slot, "direction"), 3)),
  }));
}

function lastDraws(host: FakeHost): readonly FakeDrawRecord[] {
  const pass = host.device.renderPasses.at(-1);
  if (pass === undefined) throw new Error("no render pass");
  return pass.draws;
}

describe("compareDraws (the draw-list order of spec/runtime-abi.md section 8.4)", () => {
  const key = (pipelineKey: string, instance: number, mesh: number, entity: number): DrawSortKey => ({ pipelineKey, instance, mesh, entity });

  it("orders by pipeline key, then material instance, then mesh, then instance order", () => {
    const items = [
      key("b", 0, 0, 0),
      key("a", 2, 0, 1),
      key("a", 1, 1, 2),
      key("a", 1, 0, 5),
      key("a", 1, 0, 3),
      key("c", 0, 0, 4),
    ];
    expect(items.sort(compareDraws).map((item) => item.entity)).toEqual([3, 5, 2, 1, 0, 4]);
  });

  it("compares pipeline keys by code unit, not by locale", () => {
    expect(compareDraws(key("Z", 0, 0, 0), key("a", 0, 0, 1))).toBeLessThan(0);
    expect(compareDraws(key("a", 0, 0, 0), key("a", 0, 0, 0))).toBe(0);
  });

  it("is a total order: sorting any permutation gives the same list", () => {
    const items = [key("x", 1, 0, 0), key("x", 0, 1, 1), key("y", 0, 0, 2), key("x", 0, 0, 3)];
    const expected = [...items].sort(compareDraws).map((item) => item.entity);
    for (let rotation = 0; rotation < items.length; rotation += 1) {
      const rotated = [...items.slice(rotation), ...items.slice(0, rotation)].reverse();
      expect(rotated.sort(compareDraws).map((item) => item.entity)).toEqual(expected);
    }
  });
});

describe("startup (spec/runtime-abi.md section 6.1)", () => {
  it("creates every startup pipeline, uploads the meshes and runs init before mountMtek resolves", async () => {
    const { host, debug, app } = await mountScene();
    const counters = debug.counters();
    expect(counters).toMatchObject({ pipelinesCreated: 1, livePipelines: 1, shaderModulesCreated: 1 });
    // The box: three vertex buffers and an index buffer, uploaded once; nothing submitted yet.
    expect(counters["uploads"]).toBe(4);
    expect(host.device.queue.submits).toBe(0);
    expect(debug.scene().entities[0]?.position).toEqual({ x: 0, y: 0.5, z: 0 });
    app.dispose();
  });

  it("delivers run-time diagnostics of init after mounting (not fatal)", async () => {
    const { app, reported } = await mountScene({
      init: (context) => {
        minimalSceneInit(context);
        const ctx = context as InitContext;
        ctx.setTransform(ctx.e[0], "scale", { x: 0, y: 1, z: 1 });
      },
    });
    expect(app.state).toBe("running");
    expect(reported.map((d) => [d.code, d.phase])).toEqual([["MTEK-E8090", "runtime:mount"]]);
    app.dispose();
  });

  it("an internal error in init rejects mountMtek with it and releases everything", async () => {
    const host = new FakeHost();
    installProgram(host);
    const program = fakeProgram((context) => {
      void (context as Record<string, unknown>)["spawn"];
    });
    await expect(mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), program)).rejects.toThrow(RuntimeInternalError);
    expect(host.device.destroyed).toBe(true);
    expect(host.device.buffers.every((buffer) => buffer.destroyed)).toBe(true);
    expect(host.pendingFrames).toBe(0);
  });
});

describe("a rendered frame", () => {
  it("draws the box once with the fixed binding plan and the mesh's position buffer", async () => {
    const { host, debug, app } = await mountScene();
    debug.step(1, 0.016);
    const draws = lastDraws(host);
    expect(draws).toHaveLength(1);
    const draw = draws[0];
    expect(draw?.indexCount).toBe(36);
    expect(draw?.indexFormat).toBe("uint16");
    expect(draw?.vertexBuffers.map((b) => b.label)).toEqual(["mtek mesh box:1,1,1 position"]);
    expect(draw?.bindGroups.map((g) => g.descriptor.label)).toEqual([
      "builtin:frame#0",
      "material:std/materials.mtek::Unlit#0",
      "builtin:object:dynamic",
    ]);
    expect(draw?.dynamicOffsets).toEqual([[], [], [0]]);
    expect(host.device.renderPasses.at(-1)?.viewFormat).toBe("rgba8unorm-srgb");
    expect(debug.counters()["drawCalls"]).toBe(1);
    app.dispose();
  });

  it("writes MtekFrame through the builtin:frame writers: view_proj, camera position, no lights, ambient", async () => {
    const { host, debug, app, manifest } = await mountScene({
      edit: (json) => {
        const fields = (json["scene"] as { fields: Json }).fields;
        fields["ambientColor"] = [0.2, 0.4, 0.6, 1];
        fields["ambientIntensity"] = 0.5;
      },
    });
    debug.step(1, 0.016);
    const frame = bufferLabelled(host, "mtek:uniform-arena:builtin:frame");
    const offset = (name: string): number => memberOffset(manifest, "builtin:frame", name);
    const expected = multiply(
      perspective(Math.fround(0.9), TARGET.width / TARGET.height, Math.fround(0.1), 1000),
      lookAt({ x: 0, y: 2, z: 6 }, { x: 0, y: 0.5, z: 0 }),
    );
    expect(floats(frame, offset("view_proj"), 16)).toEqual(expected);
    expect(Array.from(floats(frame, offset("camera_position"), 3))).toEqual([0, 2, 6]);
    expect(new Uint32Array(frame.contents.buffer.slice(offset("light_count"), offset("light_count") + 4))[0]).toBe(0);
    expect(floats(frame, offset("ambient"), 3)).toEqual(new Float32Array([0.1, 0.2, 0.3]));
    app.dispose();
  });

  it("writes no lights when the scene has none: light_count 0 and an all-zero lights array", async () => {
    const { host, debug, app, manifest } = await mountScene();
    debug.step(1, 0.016);
    const frame = bufferLabelled(host, "mtek:uniform-arena:builtin:frame");
    expect(frameLights(manifest, frame)).toEqual(Array.from({ length: 4 }, () => ZERO_LIGHT));
    app.dispose();
  });

  it("writes MtekObject (model, normal matrix) through the builtin:object writers at the object's slot", async () => {
    const { host, debug, app, manifest } = await mountScene({
      init: (context) => {
        minimalSceneInit(context);
        const ctx = context as InitContext;
        ctx.setTransform(ctx.e[0], "scale", { x: 2, y: 1, z: 0.5 });
      },
    });
    debug.step(1, 0.016);
    const object = bufferLabelled(host, "mtek:uniform-arena:builtin:object");
    const model = multiply(translation({ x: 0, y: 0.5, z: 0 }), new Float32Array([2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1]));
    expect(floats(object, memberOffset(manifest, "builtin:object", "model"), 16)).toEqual(model);
    expect(floats(object, memberOffset(manifest, "builtin:object", "normal_matrix"), 16)).toEqual(normalMatrix(model));
    app.dispose();
  });

  it("writes material params through the material layout's writer into the instance's slot", async () => {
    const { host, debug, app, manifest } = await mountScene();
    debug.step(1, 0.016);
    const params = bufferLabelled(host, "mtek:uniform-arena:material:std/materials.mtek::Unlit");
    const color = floats(params, memberOffset(manifest, "material:std/materials.mtek::Unlit", "color"), 4);
    const c = MINIMAL_SCENE_COLOR;
    expect(color).toEqual(new Float32Array([c.r, c.g, c.b, c.a]));
    expect(debug.counters()).toMatchObject({ ownedParamBlocks: 1, sharedParamBlocks: 0 });
    app.dispose();
  });

  it("caches pipelines and uploads nothing more for a static scene after its first frame", async () => {
    const { debug, app } = await mountScene();
    debug.step(1, 0.016);
    const first = debug.counters();
    // Frame block, object block and material block, once each.
    expect(first["uploads"]).toBe(4 + 3);
    debug.step(10, 0.016);
    const later = debug.counters();
    for (const name of ["pipelinesCreated", "livePipelines", "uploads", "uploadBytes", "bindGroupsCreated", "buffersAllocated", "shaderModulesCreated"]) {
      expect(later[name], name).toBe(first[name]);
    }
    expect(later["pipelinesCreated"]).toBe(1);
    expect(later["drawCalls"]).toBe(1);
    expect(later["framesRendered"]).toBe(11);
    app.dispose();
  });

  it("renders into the canvas through the preferred format's -srgb view with matching pipelines", async () => {
    for (const preferred of ["bgra8unorm", "rgba8unorm"]) {
      const { host, debug, app } = await mountScene({ host: { gpu: { preferredFormat: preferred } }, options: { test: { manualClock: true } } });
      debug.step(1, 0.016);
      expect(host.device.renderPasses.at(-1)?.viewFormat).toBe(`${preferred}-srgb`);
      expect(lastDraws(host)).toHaveLength(1);
      app.dispose();
    }
  });

  it("a zero-sized canvas skips the frame: nothing is uploaded or drawn", async () => {
    const host: FakeHostOptions = {};
    const mounted = await mountScene({ host, options: { test: { manualClock: true } }, files: (h) => {
      h.canvas.clientWidth = 0;
    } });
    const before = mounted.debug.counters();
    mounted.debug.step(2, 0.016);
    const after = mounted.debug.counters();
    expect(after["framesSkipped"]).toBe(2);
    expect(after["uploads"]).toBe(before["uploads"]);
    expect(after["drawCalls"]).toBe(0);
    expect(mounted.host.device.queue.submits).toBe(0);
    mounted.app.dispose();
  });

  it("clears with the scene clear colour's RGB and alpha 1", async () => {
    const { host, debug, app } = await mountScene({
      edit: (json) => {
        (json["scene"] as { fields: Json }).fields["clearColor"] = [0.5, 0.25, 0.125, 1];
      },
    });
    debug.step(1, 0.016);
    expect(host.device.renderPasses.at(-1)?.clearValue).toEqual({ r: 0.5, g: 0.25, b: 0.125, a: 1 });
    app.dispose();
  });
});

/**
 * Three entities: `Cube` (the box of the minimal manifest) carries a directional light, `Rig` has no mesh,
 * no material and no light, and its child `Lamp` carries a point light.
 */
function lightsEdit(json: Json): void {
  const scene = json["scene"] as { entities: Json[]; lights: Json[] };
  const template = scene.entities[0] ?? {};
  const bare = { ...template, mesh: null, material: null, light: null };
  scene.entities = [
    { ...template, light: 0 },
    { ...bare, index: 1, name: "Rig", symbol: "src/main.mtek::Demo.Rig" },
    { ...bare, index: 2, name: "Lamp", symbol: "src/main.mtek::Demo.Rig.Lamp", parent: 1, light: 1 },
  ];
  scene.lights = [
    { index: 0, entity: 0, kind: "directional" },
    { index: 1, entity: 2, kind: "point", range: 6.5 },
  ];
}

/** `init` for {@link lightsEdit}: the rig is turned about +Y by PHI and scaled non-uniformly. */
const THETA = 0.9;
const PHI = 1.2;
function lightsInit(context: object): void {
  const ctx = context as InitContext;
  ctx.setCamera("position", { x: 0, y: 2, z: 6 });
  ctx.setCamera("target", { x: 0, y: 0.5, z: 0 });
  ctx.setCamera("projection.fov_y", Math.fround(0.9));
  ctx.setCamera("projection.near", Math.fround(0.1));
  ctx.setCamera("projection.far", 1000);
  const [cube, rig, lamp] = ctx.e;
  const about = (angle: number): object => ({ x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) });
  ctx.setTransform(cube, "position", { x: 0, y: 0, z: 0 });
  ctx.setTransform(cube, "rotation", about(THETA));
  ctx.setTransform(cube, "scale", { x: 1, y: 1, z: 1 });
  ctx.setVisible(cube, true);
  ctx.setParam(cube, "color", MINIMAL_SCENE_COLOR);
  ctx.setLight(cube, "color", { r: 1, g: 0.5, b: 0.25, a: 0.1 });
  ctx.setLight(cube, "intensity", 3);
  ctx.setTransform(rig, "position", { x: 4, y: 0, z: 0 });
  ctx.setTransform(rig, "rotation", about(PHI));
  ctx.setTransform(rig, "scale", { x: 2, y: 3, z: 0.5 });
  ctx.setVisible(rig, true);
  ctx.setTransform(lamp, "position", { x: 1, y: 0.5, z: 0 });
  ctx.setTransform(lamp, "rotation", { x: 0, y: 0, z: 0, w: 1 });
  ctx.setTransform(lamp, "scale", { x: 1, y: 1, z: 1 });
  ctx.setVisible(lamp, true);
  ctx.setLight(lamp, "color", { r: 0.5, g: 0.25, b: 1, a: 1 });
  ctx.setLight(lamp, "intensity", 8);
}

describe("lights in the frame block (decision 0053)", () => {
  // The expected values are derived by hand, not with the runtime's matrix code. A rotation about +Y by
  // angle t maps (x, y, z) to (x cos t + z sin t, y, -x sin t + z cos t); an entity's -Z axis (0, 0, -1)
  // therefore becomes (-sin t, 0, -cos t). The lamp's world position is the rig's position plus the
  // rotated, scaled local position.
  it("packs count, premultiplied colour, kind, world position, range and world -Z direction", async () => {
    const { host, debug, app, manifest } = await mountScene({ edit: lightsEdit, init: lightsInit });
    debug.step(1, 0.016);
    const frame = bufferLabelled(host, "mtek:uniform-arena:builtin:frame");
    expect(frameLightCount(manifest, frame)).toBe(2);
    const [sun, lamp, ...unused] = frameLights(manifest, frame);
    expect(unused).toEqual([ZERO_LIGHT, ZERO_LIGHT]);

    // The directional light: colour (1, 0.5, 0.25) x 3, alpha 0.1 ignored; aimed down the rotated -Z.
    expect(sun?.color).toEqual([3, 1.5, 0.75]);
    expect(sun?.kind).toBe(0);
    expect(sun?.range).toBe(0);
    expect(sun?.direction[0]).toBeCloseTo(-Math.sin(THETA), 6);
    expect(sun?.direction[1]).toBeCloseTo(0, 6);
    expect(sun?.direction[2]).toBeCloseTo(-Math.cos(THETA), 6);

    // The point light under the rotated, scaled rig: local (1, 0.5, 0) scaled by (2, 3, 0.5) is (2, 1.5, 0),
    // turned about +Y by PHI and moved by (4, 0, 0).
    expect(lamp?.color).toEqual([4, 2, 8]);
    expect(lamp?.kind).toBe(1);
    expect(lamp?.range).toBe(6.5);
    expect(lamp?.position[0]).toBeCloseTo(4 + 2 * Math.cos(PHI), 5);
    expect(lamp?.position[1]).toBeCloseTo(1.5, 5);
    expect(lamp?.position[2]).toBeCloseTo(-2 * Math.sin(PHI), 5);
    // The non-uniform scale of the parent does not change the direction: the unit -Z of the rig.
    expect(lamp?.direction[0]).toBeCloseTo(-Math.sin(PHI), 6);
    expect(lamp?.direction[1]).toBeCloseTo(0, 6);
    expect(lamp?.direction[2]).toBeCloseTo(-Math.cos(PHI), 6);
    app.dispose();
  });

  it("uploads nothing more for static lights after the first frame", async () => {
    const { debug, app } = await mountScene({ edit: lightsEdit, init: lightsInit });
    debug.step(1, 0.016);
    const uploads = debug.counters()["uploads"];
    debug.step(3, 0.016);
    expect(debug.counters()["uploads"]).toBe(uploads);
    app.dispose();
  });

  it("puts the ambient colour times its intensity in the frame block next to the lights", async () => {
    const { host, debug, app, manifest } = await mountScene({
      edit: (json) => {
        lightsEdit(json);
        const fields = (json["scene"] as { fields: Json }).fields;
        fields["ambientColor"] = [0.2, 0.4, 0.6, 1];
        fields["ambientIntensity"] = 0.5;
      },
      init: lightsInit,
    });
    debug.step(1, 0.016);
    const frame = bufferLabelled(host, "mtek:uniform-arena:builtin:frame");
    expect(floats(frame, memberOffset(manifest, "builtin:frame", "ambient"), 3)).toEqual(new Float32Array([0.1, 0.2, 0.3]));
    expect(frameLightCount(manifest, frame)).toBe(2);
    app.dispose();
  });
});

/** The minimal manifest's material with a texture at binding 1 and a sampler at binding 2 (decision 0054). */
function texturedEdit(json: Json): void {
  const material = (json["materials"] as Json[])[0] ?? {};
  material["resources"] = [
    { name: "map", kind: "texture", binding: 1 },
    { name: "filter", kind: "sampler", binding: 2 },
  ];
  (material["params"] as Json[]).push({ name: "map", type: "texture", span: 3 }, { name: "filter", type: "sampler", span: 3 });
  const instance = ((json["scene"] as { materialInstances: Json[] }).materialInstances[0] ?? {}) as { params: Json[] };
  instance.params.push(
    { name: "map", class: "resource", value: { kind: "builtin", name: "texture.white" } },
    { name: "filter", class: "resource", value: { kind: "builtin", name: "sampler.linear_repeat" } },
  );
}

describe("textures and samplers (decision 0054)", () => {
  it("binds the built-in texture view and sampler next to the block, in the layout the pipeline was made with", async () => {
    const { host, debug, app } = await mountScene({ edit: texturedEdit, init: minimalSceneInit });
    debug.step(1, 0.016);
    const draw = lastDraws(host)[0];
    const group = draw?.bindGroups[1];
    expect(group?.descriptor.entries.map((entry) => entry.binding)).toEqual([0, 1, 2]);
    // Textures and samplers take part in the layout identity checks of the fake draw (the same layout object).
    expect(debug.counters()).toMatchObject({ liveSamplers: 1, drawCalls: 1 });
    // Besides the render target and the depth texture: one 1x1 opaque white sRGB texel.
    const builtin = host.device.textures.filter((texture) => texture.width === 1 && texture.height === 1 && texture.format === "rgba8unorm-srgb");
    expect(builtin.map((texture) => [...texture.pixels])).toEqual([[255, 255, 255, 255]]);
    // Frames after the first create no resources.
    const before = { ...debug.counters() };
    debug.step(3, 0.016);
    const after = debug.counters();
    for (const name of ["texturesAllocated", "bindGroupsCreated", "liveSamplers", "pipelinesCreated"]) expect(after[name], name).toBe(before[name]);
    app.dispose();
    expect(host.device.textures.every((texture) => texture.destroyed)).toBe(true);
  });

  it("replaces the pixels of the built-in texture with a test texture", async () => {
    const data = Uint8Array.from([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255]);
    const { host, app } = await mountScene({
      edit: texturedEdit,
      init: minimalSceneInit,
      options: { test: { manualClock: true, renderTarget: TARGET, textures: { "texture.white": { width: 2, height: 2, data } } } },
    });
    const texture = host.device.textures.find((candidate) => candidate.format === "rgba8unorm-srgb" && candidate.width === 2);
    expect(texture).toBeDefined();
    expect([...(texture?.pixels ?? [])]).toEqual([...data]);
    app.dispose();
  });
});

const OTHER_HASH = "f".repeat(64);
const OTHER_MATERIAL = "src/main.mtek::Other";

/** Five entities with two materials (two shaders, so two pipelines): B A B A A, entity 3 hidden by init. */
function twoMaterialEdit(json: Json): void {
  (json["shaders"] as Json[]).push({
    hash: OTHER_HASH,
    url: `shaders/${OTHER_HASH.slice(0, 16)}.wgsl`,
    map: `shaders/${OTHER_HASH.slice(0, 16)}.mtek-map.json`,
    material: OTHER_MATERIAL,
    vertexEntry: "mtek_vs",
    fragmentEntry: "mtek_fs",
    vertexAttributes: ["position", "normal"],
    surfaceInputs: ["world_normal"],
  });
  (json["materials"] as Json[]).push({
    id: OTHER_MATERIAL,
    layout: "material:std/materials.mtek::Unlit",
    shader: OTHER_HASH,
    resources: [],
    params: [{ name: "color", type: "color", span: 3 }],
  });
  const scene = json["scene"] as { entities: Json[]; materialInstances: Json[] };
  const template = scene.entities[0] ?? {};
  const unlit = "std/materials.mtek::Unlit";
  const materials = [OTHER_MATERIAL, unlit, OTHER_MATERIAL, unlit, unlit];
  scene.entities = materials.map((material, index) => ({
    ...template,
    index,
    name: `E${String(index)}`,
    symbol: `src/main.mtek::Demo.E${String(index)}`,
    material: { id: material, instance: index },
  }));
  scene.materialInstances = materials.map((material, index) => ({
    index,
    material,
    entity: index,
    params: [{ name: "color", class: "initial" }],
    shareable: true,
  }));
}

describe("the draw list", () => {
  it("is sorted by pipeline key, then material instance, then instance order, without hidden entities", async () => {
    const { host, debug, app } = await mountScene({
      edit: twoMaterialEdit,
      files: (h) => {
        h.files.set(`${BASE_URL}shaders/${OTHER_HASH.slice(0, 16)}.wgsl`, "// other material\n");
        h.files.set(`${BASE_URL}shaders/${OTHER_HASH.slice(0, 16)}.mtek-map.json`, JSON.stringify({ shader: OTHER_HASH, entries: [] }));
      },
      init: (context) => {
        minimalSceneInit(context);
        const ctx = context as InitContext;
        ctx.setVisible(ctx.e[3], false);
      },
    });
    expect(debug.counters()["pipelinesCreated"]).toBe(2);
    debug.step(1, 0.016);
    const draws = lastDraws(host);
    // Object slots follow instance order (slot i = entity i), so the dynamic offset names the entity.
    expect(draws.map((d) => (d.dynamicOffsets[2]?.[0] ?? -1) / 256)).toEqual([1, 4, 0, 2]);
    // The Unlit pipeline's key ("0051...") sorts before the other one ("ffff..."); each binds its attributes.
    expect(draws.map((d) => d.vertexBuffers.length)).toEqual([1, 1, 2, 2]);
    expect(draws[0]?.pipeline).toBe(draws[1]?.pipeline);
    expect(draws[2]?.pipeline).toBe(draws[3]?.pipeline);
    expect(draws[0]?.pipeline).not.toBe(draws[2]?.pipeline);
    expect(draws.map((d) => d.bindGroups[1]?.descriptor.label)).toEqual([1, 4, 0, 2].map((i) => `material:std/materials.mtek::Unlit#${String(i)}`));
    expect(debug.counters()).toMatchObject({ drawCalls: 4, ownedParamBlocks: 5, liveEntities: 5 });
    app.dispose();
  });
});

const UNLIT_ARENA = "mtek:uniform-arena:material:std/materials.mtek::Unlit";

async function mountTwoMaterials(init?: (ctx: object) => void): Promise<Mounted> {
  return mountScene({
    edit: twoMaterialEdit,
    files: (h) => {
      h.files.set(`${BASE_URL}shaders/${OTHER_HASH.slice(0, 16)}.wgsl`, "// other material\n");
      h.files.set(`${BASE_URL}shaders/${OTHER_HASH.slice(0, 16)}.mtek-map.json`, JSON.stringify({ shader: OTHER_HASH, entries: [] }));
    },
    ...(init === undefined ? {} : { init }),
  });
}

describe("debug.setParam (the M2 gate hook, spec/runtime-abi.md section 10.2)", () => {
  it("writes one instance through the generated writer, uploads it next frame and creates nothing", async () => {
    const { host, debug, app, manifest } = await mountTwoMaterials();
    debug.step(1, 0.016);
    const before = debug.counters();
    const arena = bufferLabelled(host, UNLIT_ARENA);
    const color = memberOffset(manifest, "material:std/materials.mtek::Unlit", "color");
    // Entities 0 and 2 use the other material, which shares the Unlit layout: one arena, five slots.
    expect(floats(arena, 1 * 256 + color, 4)).toEqual(new Float32Array([0.25, 0.5, 0.75, 1]));

    debug.setParam("E1", "color", { r: 1, g: 0.5, b: 0.25, a: 1 });
    // Written to the mirror, not to the GPU: nothing uploads before the render phase.
    expect(debug.counters()["uploads"]).toBe(before["uploads"]);
    debug.step(1, 0.016);

    expect(floats(arena, 1 * 256 + color, 4)).toEqual(new Float32Array([1, 0.5, 0.25, 1]));
    for (const other of [0, 2, 3, 4]) expect(floats(arena, other * 256 + color, 4), `instance ${String(other)}`).toEqual(new Float32Array([0.25, 0.5, 0.75, 1]));
    const after = debug.counters();
    expect(after["uploads"]).toBe((before["uploads"] ?? 0) + 1);
    for (const name of ["pipelinesCreated", "shaderModulesCreated", "bindGroupsCreated", "buffersAllocated", "livePipelines", "liveBindGroups"]) {
      expect(after[name], name).toBe(before[name]);
    }
    app.dispose();
  });

  it("an unchanged value uploads nothing", async () => {
    const { debug, app } = await mountTwoMaterials();
    debug.step(1, 0.016);
    const before = debug.counters()["uploads"];
    debug.setParam("E1", "color", { r: 0.25, g: 0.5, b: 0.75, a: 1 });
    debug.step(1, 0.016);
    expect(debug.counters()["uploads"]).toBe(before);
    app.dispose();
  });

  it("a non-opaque colour is E8100 and the previous value stays", async () => {
    const { host, debug, app, reported, manifest } = await mountTwoMaterials();
    debug.step(1, 0.016);
    debug.setParam("E3", "color", { r: 0, g: 1, b: 0, a: 0.5 });
    debug.step(1, 0.016);
    expect(reported.map((d) => d.code)).toEqual(["MTEK-E8100"]);
    expect(reported[0]?.message).toContain("E3");
    const color = memberOffset(manifest, "material:std/materials.mtek::Unlit", "color");
    expect(floats(bufferLabelled(host, UNLIT_ARENA), 3 * 256 + color, 4)).toEqual(new Float32Array([0.25, 0.5, 0.75, 1]));
    app.dispose();
  });

  it("names what exists when the entity, the param or the value is wrong", async () => {
    const { debug, app } = await mountTwoMaterials();
    const ok = { r: 1, g: 1, b: 1, a: 1 };
    expect(() => debug.setParam("Nope", "color", ok)).toThrow("no entity named 'Nope' (entities: E0, E1, E2, E3, E4)");
    expect(() => debug.setParam("E0", "tint", ok)).toThrow("declares no param 'tint' (params: color)");
    expect(() => debug.setParam("E0", "color", { x: 1, y: 1, z: 1 })).toThrow("is a color; got");
    expect(() => debug.setParam("E0", "color", { r: 1, g: Number.NaN, b: 1, a: 1 })).toThrow(TypeError);
    app.dispose();
  });

  it("refuses to run on a disposed application", async () => {
    const { debug, app } = await mountTwoMaterials();
    app.dispose();
    expect(() => debug.setParam("E0", "color", { r: 1, g: 1, b: 1, a: 1 })).toThrow(/disposed/);
  });
});

describe("a material that fails after mount", () => {
  const failure = (): MtekDiagnostic =>
    makeRuntimeDiagnostic("E8051", {
      phase: "runtime:reload",
      message: `Shader for material ${OTHER_MATERIAL} failed to compile: unexpected token`,
    });

  it("is reported once and its entities are no longer drawn; the rest of the scene keeps running", async () => {
    const { host, debug, app, reported } = await mountTwoMaterials();
    debug.step(1, 0.016);
    expect(lastDraws(host)).toHaveLength(5);

    (app as MountedApp).handleMaterialFailure(OTHER_MATERIAL, failure());
    (app as MountedApp).handleMaterialFailure(OTHER_MATERIAL, failure());
    debug.step(1, 0.016);

    // Entities 0 and 2 used the failed material; 1, 3 and 4 (Unlit) are still drawn, in the same order.
    expect(lastDraws(host).map((d) => (d.dynamicOffsets[2]?.[0] ?? -1) / 256)).toEqual([1, 3, 4]);
    expect(reported.map((d) => d.code)).toEqual(["MTEK-E8051"]);
    expect(debug.counters()).toMatchObject({ failedMaterials: 1, drawCalls: 3, liveEntities: 5 });
    expect(app.state).toBe("running");

    // Params of a failed material stay writable (the entity still exists); nothing throws.
    debug.setParam("E0", "color", { r: 0, g: 0, b: 1, a: 1 });
    debug.step(1, 0.016);
    expect(lastDraws(host)).toHaveLength(3);
    app.dispose();
  });
});

describe("the golden programs end to end on the fake GPU", () => {
  it.each(CODEGEN_FIXTURES)("%s mounts, renders every entity once and caches its pipeline", async (name) => {
    const golden = await loadGoldenProgram(name);
    const host = new FakeHost();
    for (const [url, text] of golden.files) host.files.set(url, text);
    const reported: MtekDiagnostic[] = [];
    const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), golden.program, {
      test: { manualClock: true, renderTarget: TARGET },
      onDiagnostic: (d) => reported.push(d),
    });
    const debug = app.debug;
    if (debug === undefined) throw new Error("no debug API");
    debug.step(3, 0.016);
    const drawn = golden.manifest.scene.entities.filter((entity) => entity.mesh !== null).length;
    expect(lastDraws(host)).toHaveLength(drawn);
    expect(debug.counters()).toMatchObject({
      drawCalls: drawn,
      pipelinesCreated: golden.manifest.materials.length,
      ownedParamBlocks: golden.manifest.scene.materialInstances.length,
      liveEntities: golden.manifest.scene.entities.length,
    });
    // Every object block holds its entity's world translation (read at the layout's offset).
    const object = bufferLabelled(host, "mtek:uniform-arena:builtin:object");
    const modelOffset = memberOffset(golden.manifest, "builtin:object", "model");
    const positions = debug.scene().entities.map((entity) => entity.position as { x: number; y: number; z: number });
    golden.manifest.scene.entities.forEach((entity, index) => {
      const model = floats(object, index * 256 + modelOffset, 16);
      let expected = positions[index] ?? { x: 0, y: 0, z: 0 };
      if (entity.parent !== null) {
        const parent = positions[entity.parent] ?? { x: 0, y: 0, z: 0 };
        expected = { x: parent.x + expected.x, y: parent.y + expected.y, z: parent.z + expected.z };
      }
      expect([model[12], model[13], model[14]], entity.name).toEqual([expected.x, expected.y, expected.z].map(Math.fround));
    });
    expect(reported).toEqual([]);
    app.dispose();
    expect(debug.counters()).toMatchObject({ liveBuffers: 0, livePipelines: 0, liveBindGroups: 0 });
  });
});

describe("the compiler's lights program, end to end (decision 0053)", () => {
  const f = Math.fround;
  /** sRGB byte to linear light, from the transfer function of the standard (not from the compiler's output). */
  const linear = (byte: number): number => {
    const c = byte / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const SUN_LINEAR = [linear(0xff), linear(0xe0), linear(0xb0)].map(f);
  const LAMP_COLOUR = [0.25, 0.5, 0.75];

  async function mountLights(): Promise<{ host: FakeHost; debug: MtekDebug; app: MtekApp; manifest: MtekManifest; reported: MtekDiagnostic[] }> {
    const golden = await loadGoldenProgram("lights");
    const host = new FakeHost();
    for (const [url, text] of golden.files) host.files.set(url, text);
    const reported: MtekDiagnostic[] = [];
    const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), golden.program, {
      test: { manualClock: true, renderTarget: TARGET },
      onDiagnostic: (d) => reported.push(d),
    });
    if (app.debug === undefined) throw new Error("no debug API");
    return { host, debug: app.debug, app, manifest: golden.manifest, reported };
  }

  function expectColor(actual: readonly number[] | undefined, linearColor: readonly number[], intensity: number): void {
    expect(actual).toHaveLength(3);
    actual?.forEach((value, i) => expect(value).toBeCloseTo(f(linearColor[i] ?? Number.NaN) * intensity, 5));
  }

  it("declares the lights in the manifest, in instance order, with the ambient fields", async () => {
    const { manifest, app } = await mountLights();
    expect(manifest.scene.lights).toEqual([
      { index: 0, entity: 0, kind: "directional" },
      { index: 1, entity: 2, kind: "point", range: 6.5 },
    ]);
    expect(manifest.scene.entities.map((entity) => entity.light)).toEqual([0, null, 1]);
    expect(manifest.scene.bindings.map((binding) => binding.target)).toEqual([{ kind: "light", entity: 0, field: "intensity" }]);
    expect(manifest.scene.fields.ambientIntensity).toBe(0.25);
    app.dispose();
  });

  it("evaluates the bound intensity before the first frame and packs init's values", async () => {
    const { host, debug, app, manifest, reported } = await mountLights();
    debug.step(1, 0);
    const frame = bufferLabelled(host, "mtek:uniform-arena:builtin:frame");
    expect(frameLightCount(manifest, frame)).toBe(2);
    const [sun, lamp] = frameLights(manifest, frame);
    // Sun: #ffe0b0 times the bound intensity level * 1.5 = 3 (the first frame has delta 0: level is still 2).
    expectColor(sun?.color, SUN_LINEAR, 3);
    expect(sun?.kind).toBe(0);
    expect(sun?.direction[0]).toBeCloseTo(-Math.sin(0.9), 6);
    expect(sun?.direction[1]).toBeCloseTo(0, 6);
    expect(sun?.direction[2]).toBeCloseTo(-Math.cos(0.9), 6);
    // Lamp: the update of the first frame ran with dt 0 (intensity 4, colour (0.25, warmth, 0.75)); the
    // rig is at (4, 0, 0), the lamp 1 right and 0.5 up of it, nothing is rotated.
    expect(lamp?.kind).toBe(1);
    expect(lamp?.range).toBe(6.5);
    expect(lamp?.position).toEqual([5, 0.5, 0]);
    expect(lamp?.direction[0]).toBeCloseTo(0, 6);
    expect(lamp?.direction[1]).toBeCloseTo(0, 6);
    expect(lamp?.direction[2]).toBeCloseTo(-1, 6);
    expectColor(lamp?.color, LAMP_COLOUR, 4);
    expect(reported).toEqual([]);
    app.dispose();
  });

  it("follows the bound intensity and the handler's writes frame by frame", async () => {
    const { host, debug, app, manifest } = await mountLights();
    const frame = bufferLabelled(host, "mtek:uniform-arena:builtin:frame");
    // Per frame, in phase order: the scene's update (level += dt), the lamp's update (intensity += dt,
    // colour), then the binding (intensity = level * 1.5).
    let level = 2;
    let lampIntensity = 4;
    for (let frameNumber = 0; frameNumber < 3; frameNumber += 1) {
      debug.step(1, 0.1);
      level = f(level + f(0.1));
      lampIntensity = f(lampIntensity + f(0.1));
      const [sun, lamp] = frameLights(manifest, frame);
      expectColor(sun?.color, SUN_LINEAR, f(level * 1.5));
      expectColor(lamp?.color, LAMP_COLOUR, lampIntensity);
    }
    app.dispose();
  });
});
