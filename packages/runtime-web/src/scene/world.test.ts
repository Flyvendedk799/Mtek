import { describe, expect, it } from "vitest";
import { checkManifest } from "../abi/validate.js";
import type { MtekManifest } from "../abi/manifest-types.js";
import type { MtekDiagnostic } from "../diagnostics/types.js";
import { fromRotationTranslationScale, multiply, normalMatrix } from "../math/mat4.js";
import { minimalManifestJson } from "../test-support/fake-host.js";
import { CODEGEN_FIXTURES, loadGoldenProgram } from "../test-support/program.js";
import { checkProgram } from "./program.js";
import { resolveStructure } from "./structure.js";
import { CONTEXT_MEMBERS, RuntimeInternalError, World, type CameraRecord, type EntityRecord } from "./world.js";

interface ParamWrite {
  readonly instance: number;
  readonly name: string;
  readonly value: unknown;
}

/** The setters as generated code calls them (the context is an opaque object to the runtime's types). */
interface Ctx {
  readonly e: readonly EntityRecord[];
  readonly cam: CameraRecord;
  readonly frame: { readonly time: number; readonly delta: number; readonly index: number };
  setTransform(e: unknown, field: string, value: unknown): void;
  setVisible(e: unknown, value: unknown): void;
  setParam(e: unknown, name: string, value: unknown): void;
  setCamera(field: string, value: unknown): void;
  warn(code: string, span: number): void;
}

function manifestFrom(json: Record<string, unknown>): MtekManifest {
  const result = checkManifest(json);
  if (!result.ok) throw new Error(JSON.stringify(result.failures));
  return result.manifest;
}

/** The minimal manifest plus `children` nested entities below the first one, each with the material. */
function nestedManifest(): MtekManifest {
  const json = minimalManifestJson();
  const scene = json["scene"] as { entities: Record<string, unknown>[]; materialInstances: Record<string, unknown>[] };
  const first = scene.entities[0];
  if (first === undefined) throw new Error("minimal manifest has no entity");
  scene.entities.push({ ...first, index: 1, name: "Child", symbol: "src/main.mtek::Demo.Cube.Child", parent: 0, material: { id: "std/materials.mtek::Unlit", instance: 1 } });
  scene.entities.push({ ...first, index: 2, name: "Grandchild", symbol: "src/main.mtek::Demo.Cube.Child.Grandchild", parent: 1, material: { id: "std/materials.mtek::Unlit", instance: 2 } });
  scene.entities.push({ ...first, index: 3, name: "Other", symbol: "src/main.mtek::Demo.Other", parent: null, material: { id: "std/materials.mtek::Unlit", instance: 3 } });
  const instance = scene.materialInstances[0];
  for (let i = 1; i <= 3; i += 1) scene.materialInstances.push({ ...instance, index: i, entity: i });
  return manifestFrom(json);
}

function makeWorld(manifest: MtekManifest = manifestFrom(minimalManifestJson())): {
  world: World;
  ctx: Ctx;
  writes: ParamWrite[];
  reported: MtekDiagnostic[];
} {
  const structure = resolveStructure(manifest);
  if (!structure.ok) throw new Error(JSON.stringify(structure.diagnostics));
  const writes: ParamWrite[] = [];
  const reported: MtekDiagnostic[] = [];
  const world = new World({
    manifest,
    structure: structure.structure,
    params: { writeParam: (instance, name, value) => writes.push({ instance, name, value }) },
    report: (d) => reported.push(d),
  });
  return { world, ctx: world.ctx as Ctx, writes, reported };
}

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

describe("World records before init", () => {
  it("creates one record per entity with the registry defaults and the camera with its defaults", () => {
    const { world, ctx } = makeWorld(nestedManifest());
    expect(world.entities).toHaveLength(4);
    for (const [index, record] of world.entities.entries()) {
      expect(record.position).toEqual({ x: 0, y: 0, z: 0 });
      expect(record.rotation).toEqual(IDENTITY);
      expect(record.scale).toEqual({ x: 1, y: 1, z: 1 });
      expect(record.visible).toBe(true);
      expect(record.state).toEqual({});
      expect(record.params).toEqual({});
      expect(record.ref).toEqual({ slot: index, gen: 0 });
      expect(record.mat?.p).toEqual({ color: { r: 0, g: 0, b: 0, a: 0 } });
    }
    expect(ctx.e).toBe(world.entities);
    expect(ctx.cam).toBe(world.camera);
    expect(world.camera).toEqual({
      position: { x: 0, y: 0, z: 5 },
      target: null,
      rotation: IDENTITY,
      projection: { kind: "perspective", fov_y: Math.fround(0.9), near: Math.fround(0.1), far: 1000 },
    });
    expect(ctx.frame).toEqual({ time: 0, delta: 0, index: 0 });
  });

  it("gives an orthographic camera the orthographic defaults", () => {
    const json = minimalManifestJson();
    const camera = (json["scene"] as { cameras: Record<string, unknown>[] }).cameras[0];
    if (camera !== undefined) {
      camera["projection"] = "orthographic";
      camera["hasTarget"] = false;
    }
    const { world } = makeWorld(manifestFrom(json));
    expect(world.camera.projection).toEqual({ kind: "orthographic", height: 10, near: Math.fround(0.1), far: 1000 });
  });
});

describe("the M1 context subset", () => {
  it("has exactly the members of CONTEXT_MEMBERS", () => {
    const { ctx } = makeWorld();
    expect(Object.keys(ctx).sort()).toEqual([...CONTEXT_MEMBERS].sort());
  });

  it.each(["spawn", "destroy", "alive", "body", "setLight", "notAMember"])(
    "reading ctx.%s throws an internal error naming the member",
    (member) => {
      const { ctx } = makeWorld();
      const read = (): unknown => (ctx as unknown as Record<string, unknown>)[member];
      expect(read).toThrow(RuntimeInternalError);
      expect(read).toThrow(`ctx.${member}`);
    },
  );

  it("is read-only", () => {
    const { ctx } = makeWorld();
    expect(() => {
      (ctx as unknown as Record<string, unknown>)["e"] = [];
    }).toThrow(/assigned ctx\.e/);
    expect(() => {
      delete (ctx as unknown as Record<string, unknown>)["warn"];
    }).toThrow(/deleted ctx\.warn/);
  });

  it("rejects values the ABI does not allow with internal errors (generated code never passes them)", () => {
    const { ctx } = makeWorld();
    const e0 = ctx.e[0];
    expect(() => ctx.setTransform({}, "position", { x: 0, y: 0, z: 0 })).toThrow(/not an entity record/);
    expect(() => ctx.setTransform(e0, "colour", { x: 0, y: 0, z: 0 })).toThrow(/field "colour"/);
    expect(() => ctx.setTransform(e0, "position", { x: 0, y: 0 })).toThrow(/expects a vec3/);
    expect(() => ctx.setTransform(e0, "rotation", { x: 0, y: 0, z: 0 })).toThrow(/expects a quat/);
    expect(() => ctx.setVisible(e0, 1)).toThrow(/expected a bool/);
    expect(() => ctx.setParam(e0, "tint", { r: 1, g: 1, b: 1, a: 1 })).toThrow(/does not declare/);
    expect(() => ctx.setParam(e0, "color", { x: 1, y: 1, z: 1 })).toThrow(/expects a color/);
    expect(() => ctx.setCamera("zoom", 1)).toThrow(/field "zoom"/);
    expect(() => ctx.setCamera("projection.height", 1)).toThrow(/does not apply to a perspective camera/);
    expect(() => ctx.setCamera("projection.near", "1")).toThrow(/expects an f32/);
    expect(() => ctx.warn("E8090", 0)).toThrow(/not a runtime warning code/);
  });

  it("setCamera(target) on a camera without a target is an internal error", () => {
    const json = minimalManifestJson();
    const camera = (json["scene"] as { cameras: Record<string, unknown>[] }).cameras[0];
    if (camera !== undefined) camera["hasTarget"] = false;
    const { ctx } = makeWorld(manifestFrom(json));
    expect(() => ctx.setCamera("target", { x: 0, y: 0, z: 0 })).toThrow(/declares no target/);
  });
});

describe("setters", () => {
  it("setTransform and setVisible update the record; setParam writes through the sink and the mirror", () => {
    const { ctx, writes, reported } = makeWorld();
    const e0 = ctx.e[0];
    ctx.setTransform(e0, "position", { x: 1, y: 2, z: 3 });
    ctx.setTransform(e0, "rotation", { x: 0, y: 1, z: 0, w: 0 });
    ctx.setTransform(e0, "scale", { x: 2, y: 2, z: 2 });
    ctx.setVisible(e0, false);
    const color = { r: 0.5, g: 0.25, b: 0.125, a: 1 };
    ctx.setParam(e0, "color", color);
    expect(e0).toMatchObject({ position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 1, z: 0, w: 0 }, scale: { x: 2, y: 2, z: 2 }, visible: false });
    expect(e0?.mat?.p["color"]).toBe(color);
    expect(writes).toEqual([{ instance: 0, name: "color", value: color }]);
    expect(reported).toEqual([]);
  });

  it("an invalid scale is E8090 at the entity and the write is ignored", () => {
    const { ctx, reported } = makeWorld();
    const e0 = ctx.e[0];
    for (const scale of [{ x: 0, y: 1, z: 1 }, { x: 1, y: -1, z: 1 }, { x: 1, y: 1, z: Number.NaN }, { x: Number.POSITIVE_INFINITY, y: 1, z: 1 }]) {
      ctx.setTransform(e0, "scale", scale);
    }
    expect(e0?.scale).toEqual({ x: 1, y: 1, z: 1 });
    expect(reported.map((d) => d.code)).toEqual(["MTEK-E8090", "MTEK-E8090", "MTEK-E8090", "MTEK-E8090"]);
    expect(reported[0]?.message).toContain("'Cube'");
    expect(reported[0]?.source).toMatchObject({ file: "src/main.mtek", startByte: 40 });
  });

  it("a non-opaque colour is E8100 and the previous value stays", () => {
    const { ctx, writes, reported } = makeWorld();
    const e0 = ctx.e[0];
    ctx.setParam(e0, "color", { r: 1, g: 0, b: 0, a: 1 });
    ctx.setParam(e0, "color", { r: 0, g: 1, b: 0, a: 0.5 });
    expect(e0?.mat?.p["color"]).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(writes).toHaveLength(1);
    expect(reported.map((d) => d.code)).toEqual(["MTEK-E8100"]);
  });

  it("setCamera writes the camera record", () => {
    const { ctx, world, reported } = makeWorld();
    ctx.setCamera("position", { x: 0, y: 2, z: 6 });
    ctx.setCamera("target", { x: 0, y: 0.5, z: 0 });
    ctx.setCamera("rotation", { x: 0, y: 0, z: 0, w: 1 });
    ctx.setCamera("projection.fov_y", 1.2);
    ctx.setCamera("projection.near", 0.5);
    ctx.setCamera("projection.far", 50);
    expect(world.camera).toEqual({
      position: { x: 0, y: 2, z: 6 },
      target: { x: 0, y: 0.5, z: 0 },
      rotation: IDENTITY,
      projection: { kind: "perspective", fov_y: 1.2, near: 0.5, far: 50 },
    });
    expect(reported).toEqual([]);
  });

  it.each([
    ["projection.fov_y", 0],
    ["projection.fov_y", Math.PI],
    ["projection.near", 0],
    ["projection.near", 2000],
    ["projection.far", 0.05],
    ["projection.far", Number.POSITIVE_INFINITY],
    ["position", { x: Number.NaN, y: 0, z: 0 }],
    ["rotation", { x: 0, y: 0, z: 0, w: Number.NaN }],
  ] as const)("after init, setCamera(%s, %s) is E8011 and the write is ignored", (field, value) => {
    const { ctx, world, reported } = makeWorld();
    world.initialise((c) => {
      (c as Ctx).setCamera("target", { x: 0, y: 0, z: 0 });
    });
    const before = structuredClone(world.camera);
    ctx.setCamera(field, value);
    expect(world.camera).toEqual(before);
    expect(reported.map((d) => d.code)).toEqual(["MTEK-E8011"]);
    expect(reported[0]?.message).toContain("camera 'Main'");
    expect(reported[0]?.source).toMatchObject({ file: "src/main.mtek", startByte: 20 });
  });

  it("position equal to the target is E8011 after init", () => {
    const { ctx, world, reported } = makeWorld();
    world.initialise((c) => {
      (c as Ctx).setCamera("target", { x: 1, y: 1, z: 1 });
    });
    ctx.setCamera("position", { x: 1, y: 1, z: 1 });
    expect(world.camera.position).toEqual({ x: 0, y: 0, z: 5 });
    expect(reported.map((d) => d.code)).toEqual(["MTEK-E8011"]);
    expect(reported[0]?.message).toContain("view direction is undefined");
  });

  it("during init relations between camera fields are not checked write by write, only after init", () => {
    const { world, reported } = makeWorld();
    world.initialise((c) => {
      const ctx = c as Ctx;
      // near above the default far, then far: valid once both are written.
      ctx.setCamera("projection.near", 2000);
      ctx.setCamera("projection.far", 5000);
      // position equal to the default target position, then the target: valid at the end.
      ctx.setCamera("position", { x: 0, y: 0, z: 0 });
      ctx.setCamera("target", { x: 0, y: 0, z: 0 });
      ctx.setCamera("target", { x: 0, y: 0, z: -1 });
    });
    expect(reported).toEqual([]);
    expect(world.camera.projection).toMatchObject({ near: 2000, far: 5000 });

    const bad = makeWorld();
    bad.world.initialise((c) => {
      (c as Ctx).setCamera("projection.near", 2000);
    });
    expect(bad.reported.map((d) => d.code)).toEqual(["MTEK-E8011"]);
    expect(bad.reported[0]?.message).toContain("after initialisation far is not greater than near");
  });

  it("warn reports the runtime warning at the manifest span", () => {
    const { ctx, reported } = makeWorld();
    ctx.warn("W8030", 2);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({ code: "MTEK-W8030", severity: "warning", message: "Index clamped.", source: { startByte: 40, startLine: 2 } });
  });

  it("frame values are converted to f32/f32/u32", () => {
    const { world, ctx } = makeWorld();
    world.setFrame(0.1, 1 / 60, 7);
    expect(ctx.frame).toEqual({ time: Math.fround(0.1), delta: Math.fround(1 / 60), index: 7 });
  });
});

describe("world-matrix propagation", () => {
  it("computes W = W_parent * T * R * S, parents before children, for every entity at init", () => {
    const { world, ctx } = makeWorld(nestedManifest());
    const transforms = [
      { position: { x: 1, y: 0, z: 0 }, rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }, scale: { x: 2, y: 2, z: 2 } },
      { position: { x: 0, y: 1, z: 0 }, rotation: IDENTITY, scale: { x: 1, y: 0.5, z: 1 } },
      { position: { x: 0, y: 0, z: 3 }, rotation: IDENTITY, scale: { x: 1, y: 1, z: 1 } },
      { position: { x: -4, y: 0, z: 0 }, rotation: IDENTITY, scale: { x: 1, y: 1, z: 1 } },
    ];
    world.initialise((c) => {
      const context = c as Ctx;
      transforms.forEach((t, i) => {
        context.setTransform(context.e[i], "position", t.position);
        context.setTransform(context.e[i], "rotation", t.rotation);
        context.setTransform(context.e[i], "scale", t.scale);
      });
    });
    const local = transforms.map((t) => fromRotationTranslationScale(t.rotation, t.position, t.scale));
    const [l0, l1, l2, l3] = local as [Float32Array, Float32Array, Float32Array, Float32Array];
    expect(world.worldMatrix(0)).toEqual(l0);
    expect(world.worldMatrix(1)).toEqual(multiply(l0, l1));
    expect(world.worldMatrix(2)).toEqual(multiply(multiply(l0, l1), l2));
    expect(world.worldMatrix(3)).toEqual(l3);
    // The grandchild's origin: parent chain applied to (0, 0, 3).
    const w2 = world.worldMatrix(2);
    expect([w2[12], w2[13], w2[14]].map((v) => Math.round((v ?? 0) * 1e5) / 1e5 + 0)).toEqual([1 + 6, 2, 0]);
    expect(world.takeWorldChanges()).toEqual([0, 1, 2, 3]);
    expect(ctx.e).toHaveLength(4);
  });

  it("recomputes only entities whose transform changed and their descendants", () => {
    const { world, ctx } = makeWorld(nestedManifest());
    world.initialise(() => undefined);
    world.takeWorldChanges();
    expect(world.propagate()).toBe(0);
    expect(world.takeWorldChanges()).toEqual([]);

    ctx.setTransform(ctx.e[1], "position", { x: 0, y: 5, z: 0 });
    expect(world.propagate()).toBe(2);
    expect(world.takeWorldChanges()).toEqual([1, 2]);

    ctx.setTransform(ctx.e[3], "scale", { x: 3, y: 3, z: 3 });
    ctx.setTransform(ctx.e[3], "scale", { x: 0, y: 3, z: 3 }); // ignored (E8090), still dirty from the first write
    expect(world.propagate()).toBe(1);
    expect(world.takeWorldChanges()).toEqual([3]);
    expect(world.worldMatrix(3)[0]).toBe(3);
  });

  it("a child of a non-uniformly scaled, rotated parent has the inverse-transpose normal matrix of its world matrix", () => {
    const { world, ctx } = makeWorld(nestedManifest());
    const quarterTurn = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
    world.initialise((c) => {
      const context = c as Ctx;
      context.setTransform(context.e[0], "rotation", quarterTurn);
      context.setTransform(context.e[0], "scale", { x: 2, y: 1, z: 4 });
    });
    const m = world.worldMatrix(1);
    // Independent 3x3 inverse-transpose by cofactors (column-major: m[col * 4 + row]).
    const a = [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]] as number[][];
    const cof = (r: number, c: number): number => {
      const rows = [0, 1, 2].filter((i) => i !== r);
      const cols = [0, 1, 2].filter((i) => i !== c);
      const [r0, r1] = rows as [number, number];
      const [c0, c1] = cols as [number, number];
      const minor = (a[r0]?.[c0] ?? 0) * (a[r1]?.[c1] ?? 0) - (a[r0]?.[c1] ?? 0) * (a[r1]?.[c0] ?? 0);
      return (r + c) % 2 === 0 ? minor : -minor;
    };
    const det = (a[0]?.[0] ?? 0) * cof(0, 0) + (a[0]?.[1] ?? 0) * cof(0, 1) + (a[0]?.[2] ?? 0) * cof(0, 2);
    const normal = normalMatrix(m);
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 3; c += 1) expect(normal[c * 4 + r] ?? Number.NaN).toBeCloseTo(cof(r, c) / det, 5);
    }
    expect(ctx.e).toHaveLength(4);
  });

  it("visibility changes bump the visibility version only when the value changes", () => {
    const { world, ctx } = makeWorld();
    const before = world.visibilityVersion;
    ctx.setVisible(ctx.e[0], true);
    expect(world.visibilityVersion).toBe(before);
    ctx.setVisible(ctx.e[0], false);
    expect(world.visibilityVersion).toBe(before + 1);
  });
});

describe("the golden programs' init against the real world", () => {
  it.each(CODEGEN_FIXTURES)("%s: init sets every value without a diagnostic, through the material writers", async (name) => {
    const golden = await loadGoldenProgram(name);
    const checked = checkProgram(golden.program, golden.manifest);
    if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));
    const { world, writes, reported } = makeWorld(golden.manifest);
    world.initialise(checked.program.scene.init);
    expect(reported).toEqual([]);
    // Every material param of every instance is written exactly once, opaque.
    const expected = golden.manifest.scene.materialInstances.flatMap((instance) => instance.params.filter((p) => p.class !== "bound").map((p) => `${String(instance.index)}:${p.name}`));
    expect(writes.map((w) => `${String(w.instance)}:${w.name}`)).toEqual(expected);
    for (const record of world.entities) {
      expect(record.scale.x * record.scale.y * record.scale.z).toBeGreaterThan(0);
      const color = record.mat?.p["color"];
      // A bound param is written by the runtime's first binding evaluation, not by init.
      const bound = golden.manifest.scene.materialInstances.some((i) => i.entity === record.ref.slot && i.params.some((p) => p.class === "bound"));
      if (color !== undefined && !bound) expect(color).toMatchObject({ a: 1 });
    }
    expect(world.takeWorldChanges()).toEqual(world.entities.map((_, i) => i));
  });

  it("scene A: the target camera and the box", async () => {
    const golden = await loadGoldenProgram("scene_a_target_camera_box");
    const checked = checkProgram(golden.program, golden.manifest);
    if (!checked.ok) throw new Error("unchecked");
    const { world } = makeWorld(golden.manifest);
    world.initialise(checked.program.scene.init);
    expect(world.camera).toEqual({
      position: { x: 0, y: 2, z: 6 },
      target: { x: 0, y: 0.5, z: 0 },
      rotation: IDENTITY,
      projection: { kind: "perspective", fov_y: Math.fround(0.9), near: Math.fround(0.1), far: 1000 },
    });
    expect(world.entities[0]?.position).toEqual({ x: 0, y: 0.5, z: 0 });
    expect(world.worldMatrix(0)[13]).toBe(0.5);
  });

  it("scene B: the orthographic camera and the nested, scaled sphere", async () => {
    const golden = await loadGoldenProgram("scene_b_orthographic_nested");
    const checked = checkProgram(golden.program, golden.manifest);
    if (!checked.ok) throw new Error("unchecked");
    const { world } = makeWorld(golden.manifest);
    world.initialise(checked.program.scene.init);
    expect(world.camera.projection).toEqual({ kind: "orthographic", height: 20, near: 0.5, far: 40 });
    expect(world.camera.target).toBeNull();
    // The fountain (child of the ground at the origin) sits at y = 1 with scale (2, 0.5, 2).
    const fountain = world.worldMatrix(1);
    expect([fountain[0], fountain[5], fountain[10], fountain[13]]).toEqual([2, 0.5, 2, 1]);
  });
});
