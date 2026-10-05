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
  const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), fakeProgram(setup.init), {
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
      void (context as Record<string, unknown>)["s"];
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
