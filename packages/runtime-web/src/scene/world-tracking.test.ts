/**
 * The change tracking of the world (decision 0120): `propagate` recomputes only what was written, in place, and
 * `takeWorldChanges` lists what was recomputed. Checked against a recompute of every world matrix from the records
 * after every pass, over random writes; and the resolved setters the bindings use against the context's own.
 */
import { describe, expect, it } from "vitest";
import { checkManifest } from "../abi/validate.js";
import type { MtekManifest } from "../abi/manifest-types.js";
import type { MtekDiagnostic } from "../diagnostics/types.js";
import { fromRotationTranslationScale, multiply, type Mat4 } from "../math/mat4.js";
import { minimalManifestJson } from "../test-support/fake-host.js";
import { resolveStructure } from "./structure.js";
import { World, type EntityRecord } from "./world.js";

const f = Math.fround;

interface Ctx {
  readonly e: readonly EntityRecord[];
  setTransform(e: unknown, field: string, value: unknown): void;
  setParam(e: unknown, name: string, value: unknown): void;
}

/** Parent of each entity: a forest with chains, siblings and roots; a parent always has a lower index. */
const PARENTS: readonly (number | null)[] = [null, 0, 1, 1, null, 4, 5, null, 7, 8, 8, 0, null, 12];

function manifest(): MtekManifest {
  const json = minimalManifestJson();
  const scene = json["scene"] as { entities: Record<string, unknown>[]; materialInstances: Record<string, unknown>[] };
  const first = scene.entities[0];
  const instance = scene.materialInstances[0];
  if (first === undefined || instance === undefined) throw new Error("minimal manifest has no entity");
  scene.entities = PARENTS.map((parent, index) => ({
    ...first,
    index,
    name: `E${String(index)}`,
    symbol: `src/main.mtek::Demo.E${String(index)}`,
    parent,
    material: { id: "std/materials.mtek::Unlit", instance: index },
  }));
  scene.materialInstances = PARENTS.map((_, index) => ({ ...instance, index, entity: index }));
  const parsed = checkManifest(json);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.failures));
  return parsed.manifest;
}

function makeWorld(): { world: World; ctx: Ctx; reported: MtekDiagnostic[]; writes: string[] } {
  const m = manifest();
  const structure = resolveStructure(m);
  if (!structure.ok) throw new Error(JSON.stringify(structure.diagnostics));
  const reported: MtekDiagnostic[] = [];
  const writes: string[] = [];
  const world = new World({
    manifest: m,
    structure: structure.structure,
    params: { writeParam: (instance, name, value) => writes.push(`${String(instance)}.${name}=${JSON.stringify(value)}`) },
    report: (d) => reported.push(d),
  });
  return { world, ctx: world.ctx as Ctx, reported, writes };
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every world matrix from the records alone, parents first, with the allocating functions. */
function recompute(world: World): Mat4[] {
  const out: Mat4[] = [];
  PARENTS.forEach((parent, i) => {
    const record = world.entities[i] as EntityRecord;
    const local = fromRotationTranslationScale(record.rotation, record.position, record.scale);
    out[i] = parent === null ? local : multiply(out[parent] as Mat4, local);
  });
  return out;
}

const bits = (m: ArrayLike<number>): string => Array.from(m, (v) => (Object.is(v, -0) ? "-0" : String(v))).join(",");

describe("propagate and takeWorldChanges against a recompute of every world matrix", () => {
  it.each([1, 2, 3, 4])("random writes, seed %i: every matrix is what the records give, and every change is listed", (seed) => {
    const { world, ctx } = makeWorld();
    const random = rng(seed * 104729);
    const r = (lo: number, hi: number): number => lo + random() * (hi - lo);
    world.initialise(() => undefined);
    world.takeWorldChanges();
    let before = recompute(world).map(bits);
    let quiet = 0;
    let listedTotal = 0;
    for (let pass = 0; pass < 200; pass++) {
      const writes = random() < 0.2 ? 0 : 1 + Math.floor(random() * 4);
      for (let k = 0; k < writes; k++) {
        const entity = ctx.e[Math.floor(random() * ctx.e.length)];
        const roll = random();
        if (roll < 0.35) ctx.setTransform(entity, "position", { x: f(r(-5, 5)), y: f(r(-5, 5)), z: f(r(-5, 5)) });
        else if (roll < 0.6) ctx.setTransform(entity, "rotation", { x: f(r(-1, 1)), y: f(r(-1, 1)), z: f(r(-1, 1)), w: f(r(-1, 1)) });
        else if (roll < 0.8) ctx.setTransform(entity, "scale", { x: f(r(0.1, 3)), y: f(r(0.1, 3)), z: f(r(0.1, 3)) });
        else if (roll < 0.9) ctx.setTransform(entity, "scale", { x: 0, y: 1, z: 1 }); // rejected
        else {
          // The value the entity has: not a change.
          const record = entity as EntityRecord;
          ctx.setTransform(entity, "position", record.position);
          ctx.setTransform(entity, "rotation", record.rotation);
        }
      }
      const recomputed = world.propagate();
      const changes = world.takeWorldChanges();
      const after = recompute(world);
      // The in-place matrices are the ones the records give, bit for bit.
      after.forEach((expected, i) => {
        expect(bits(world.worldMatrix(i)), `pass ${String(pass)}, entity ${String(i)}`).toBe(bits(expected));
      });
      // Everything whose matrix differs from the pass before is listed; nothing is listed twice; the count agrees.
      const listed = new Set(changes);
      expect(listed.size).toBe(changes.length);
      expect(changes.length).toBe(recomputed);
      after.forEach((expected, i) => {
        if (bits(expected) !== before[i]) expect(listed.has(i), `pass ${String(pass)}: entity ${String(i)} changed and is not listed`).toBe(true);
      });
      if (writes === 0) {
        quiet += 1;
        expect(recomputed).toBe(0);
        expect(changes).toEqual([]);
      }
      listedTotal += changes.length;
      before = after.map(bits);
    }
    expect(quiet).toBeGreaterThan(10);
    expect(listedTotal).toBeGreaterThan(100);
  });

  it("a write to a parent lists its descendants and nothing else; a write to a leaf lists the leaf only", () => {
    const { world, ctx } = makeWorld();
    world.initialise(() => undefined);
    world.takeWorldChanges();
    ctx.setTransform(ctx.e[1], "position", { x: 1, y: 2, z: 3 });
    expect(world.propagate()).toBe(3);
    expect([...world.takeWorldChanges()].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    ctx.setTransform(ctx.e[13], "position", { x: 1, y: 2, z: 3 });
    expect(world.propagate()).toBe(1);
    expect([...world.takeWorldChanges()]).toEqual([13]);
  });

  it("markAllTransformsDirty recomputes and lists every entity, and a second take is empty", () => {
    const { world } = makeWorld();
    world.initialise(() => undefined);
    world.takeWorldChanges();
    world.markAllTransformsDirty();
    expect(world.propagate()).toBe(PARENTS.length);
    expect([...world.takeWorldChanges()].sort((a, b) => a - b)).toEqual(PARENTS.map((_, i) => i));
    expect(world.takeWorldChanges()).toEqual([]);
    expect(world.propagate()).toBe(0);
  });

  it("the device-recovery rebind lists every slot once, even after some were listed already", () => {
    const { world, ctx } = makeWorld();
    world.initialise(() => undefined);
    world.takeWorldChanges();
    ctx.setTransform(ctx.e[2], "position", { x: 1, y: 0, z: 0 });
    world.propagate();
    world.rebindParams({ writeParam: () => undefined });
    const changes = world.takeWorldChanges();
    expect([...changes].sort((a, b) => a - b)).toEqual(PARENTS.map((_, i) => i));
    expect(new Set(changes).size).toBe(changes.length);
  });

  it("a world matrix is rewritten in place: the array that worldMatrix returned holds the new matrix after a pass", () => {
    const { world, ctx } = makeWorld();
    world.initialise(() => undefined);
    const held = world.worldMatrix(0);
    ctx.setTransform(ctx.e[0], "position", { x: 4, y: 5, z: 6 });
    world.propagate();
    expect(held).toBe(world.worldMatrix(0));
    expect([held[12], held[13], held[14]]).toEqual([4, 5, 6]);
  });
});

describe("the resolved setters of the bindings do what the context's setters do", () => {
  const transformCases: readonly [string, unknown][] = [
    ["position", { x: 1, y: 2, z: 3 }],
    ["position", { x: 1, y: 2, z: 3 }], // the same again: no change
    ["position", { x: 1, y: 2 }], // not a vec3: an internal error
    ["rotation", { x: 0, y: 0, z: 0, w: 1 }], // the default: no change
    ["rotation", { x: 0.5, y: 0.5, z: 0.5, w: 0.5 }],
    ["rotation", "turn"],
    ["scale", { x: 2, y: 2, z: 2 }],
    ["scale", { x: 0, y: 2, z: 2 }], // E8090
    ["scale", { x: Number.NaN, y: 2, z: 2 }], // E8090
    ["size", { x: 1, y: 1, z: 1 }], // not a transform field
  ];

  function attempt(run: () => void): string {
    try {
      run();
      return "ok";
    } catch (error) {
      return error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error);
    }
  }

  it("transformSetter and ctx.setTransform give the same records, diagnostics, errors and dirty flags", () => {
    const direct = makeWorld();
    const resolved = makeWorld();
    direct.world.initialise(() => undefined);
    resolved.world.initialise(() => undefined);
    for (const [field, value] of transformCases) {
      const a = attempt(() => direct.ctx.setTransform(direct.ctx.e[2], field, value));
      const apply = resolved.world.transformSetter(resolved.ctx.e[2], field);
      const b = attempt(() => apply(value));
      expect(b, `${field} ${JSON.stringify(value)}`).toBe(a);
      expect(resolved.world.propagate()).toBe(direct.world.propagate());
      expect(JSON.stringify(resolved.world.entities[2])).toBe(JSON.stringify(direct.world.entities[2]));
      expect([...resolved.world.takeWorldChanges()]).toEqual([...direct.world.takeWorldChanges()]);
    }
    expect(resolved.reported.map((d) => [d.code, d.message])).toEqual(direct.reported.map((d) => [d.code, d.message]));
    expect(resolved.reported.length).toBeGreaterThan(0);
  });

  it("transformSetter for something that is not an entity record fails like the context does, when it is called", () => {
    const { world, ctx } = makeWorld();
    const apply = world.transformSetter({ position: 1 }, "position");
    const expected = attempt(() => ctx.setTransform({ position: 1 }, "position", { x: 0, y: 0, z: 0 }));
    expect(expected).toMatch(/RuntimeInternalError/);
    expect(attempt(() => apply({ x: 0, y: 0, z: 0 }))).toBe(expected);
  });

  const paramCases: readonly [string, unknown][] = [
    ["color", { r: 1, g: 0.5, b: 0.25, a: 1 }],
    ["color", { r: 1, g: 0.5, b: 0.25, a: 1 }],
    ["color", { r: 1, g: 0.5, b: 0.25, a: 0.5 }], // E8100
    ["color", { r: 1, g: 0.5 }], // not a colour
    ["tint", { r: 1, g: 1, b: 1, a: 1 }], // not a param of the material
  ];

  it("paramSetter and ctx.setParam give the same writes, mirrors, diagnostics and errors", () => {
    const direct = makeWorld();
    const resolved = makeWorld();
    for (const [name, value] of paramCases) {
      const a = attempt(() => direct.ctx.setParam(direct.ctx.e[3], name, value));
      const apply = resolved.world.paramSetter(resolved.ctx.e[3], name);
      const b = attempt(() => apply(value));
      expect(b, `${name} ${JSON.stringify(value)}`).toBe(a);
      expect(resolved.writes).toEqual(direct.writes);
      expect(JSON.stringify(resolved.world.entities[3]?.mat)).toBe(JSON.stringify(direct.world.entities[3]?.mat));
    }
    expect(resolved.reported.map((d) => [d.code, d.message])).toEqual(direct.reported.map((d) => [d.code, d.message]));
    expect(resolved.reported.map((d) => d.code)).toContain("MTEK-E8100");
  });

  it("a paramSetter keeps writing to the parameter store the world points at now (device recovery rebinds it)", () => {
    const { world, ctx, writes } = makeWorld();
    const apply = world.paramSetter(ctx.e[1], "color");
    apply({ r: 0.25, g: 0.5, b: 0.75, a: 1 });
    const later: string[] = [];
    world.rebindParams({ writeParam: (instance, name, value) => later.push(`${String(instance)}.${name}=${JSON.stringify(value)}`) });
    later.length = 0;
    apply({ r: 1, g: 1, b: 1, a: 1 });
    expect(writes.length).toBe(1);
    expect(later).toEqual(['1.color={"r":1,"g":1,"b":1,"a":1}']);
  });
});
