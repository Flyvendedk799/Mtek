/**
 * A clip composes with the entity's own transform (decision 0174): the local matrix is `base * clip`, so a prefab
 * placed somewhere and given a clip with a translation plays the clip around that place, not around the origin.
 */
import { describe, expect, it } from "vitest";
import { checkManifest } from "../abi/validate.js";
import { minimalManifestJson } from "../test-support/fake-host.js";
import { resolveStructure } from "./structure.js";
import { World, type EntityRecord } from "./world.js";

interface Ctx {
  readonly e: readonly EntityRecord[];
  setTransform(e: unknown, field: string, value: unknown): void;
  animationPlay(ref: unknown, looping: boolean, speed: number): boolean;
  animationPause(ref: unknown): boolean;
  animationSeek(ref: unknown, time: number): boolean;
  animationFade(ref: unknown, weight: number, duration: number): boolean;
  animationTime(ref: unknown): number;
}

/** One entity with a clip of `duration` seconds and `channels`. */
function clipped(channels: readonly Record<string, unknown>[], duration = 1): { world: World; ctx: Ctx } {
  const json = minimalManifestJson();
  const scene = json["scene"] as { entities: Record<string, unknown>[] };
  const first = scene.entities[0];
  if (first === undefined) throw new Error("minimal manifest has no entity");
  scene.entities[0] = { ...first, clip: { name: "Move", duration, channels } };
  const parsed = checkManifest(json);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.failures));
  const structure = resolveStructure(parsed.manifest);
  if (!structure.ok) throw new Error(JSON.stringify(structure.diagnostics));
  const world = new World({ manifest: parsed.manifest, structure: structure.structure, params: { writeParam: () => undefined }, report: () => undefined });
  return { world, ctx: world.ctx as Ctx };
}

const SLIDE = { path: "translation", interpolation: "linear", times: [0, 1], values: [0, 0, 0, 2, 0, 0] };
const TURN = { path: "rotation", interpolation: "step", times: [0], values: [0, Math.SQRT1_2, 0, Math.SQRT1_2] };
const GROW = { path: "scale", interpolation: "step", times: [0], values: [2, 2, 2] };

function translationOf(world: World): number[] {
  const m = world.worldMatrix(0);
  return [m[12] ?? 0, m[13] ?? 0, m[14] ?? 0].map((v) => Math.round(v * 1e4) / 1e4);
}

describe("a clip on an entity that is placed elsewhere", () => {
  it("preserves init controls and applies seeks and zero-duration fades immediately", () => {
    const { world, ctx } = clipped([SLIDE]);
    const ref = ctx.e[0]?.ref;
    world.initialise(() => {
      ctx.animationPause(ref);
      ctx.animationSeek(ref, 0.75);
    });
    expect(translationOf(world)).toEqual([1.5, 0, 0]);
    world.advanceClips(1);
    world.propagate();
    expect(translationOf(world)).toEqual([1.5, 0, 0]);
    expect(ctx.animationFade(ref, 0.5, 0)).toBe(true);
    world.propagate();
    expect(translationOf(world)).toEqual([0.75, 0, 0]);
    expect(ctx.animationSeek(ref, 0.25)).toBe(true);
    world.propagate();
    expect(translationOf(world)).toEqual([0.25, 0, 0]);
    expect(ctx.animationPlay({ slot: 0, gen: 99 }, false, 1)).toBe(false);
    expect(ctx.animationTime({ slot: 0, gen: 99 })).toBe(0);
    expect(ctx.animationTime(ref)).toBe(0.25);
  });

  it("plays around the entity's own position, not the origin", () => {
    const { world, ctx } = clipped([SLIDE]);
    world.initialise(() => undefined);
    // Placed after the spawn, as a handler does with the new entity's `entity_ref`.
    ctx.setTransform(ctx.e[0], "position", { x: 10, y: 3, z: 0 });
    world.advanceClips(0.5);
    world.propagate();
    expect(translationOf(world)).toEqual([11, 3, 0]);
    world.advanceClips(0.25);
    world.propagate();
    expect(translationOf(world)).toEqual([11.5, 3, 0]);
    // The entity's own record is left as it was written.
    expect(ctx.e[0]?.position).toEqual({ x: 10, y: 3, z: 0 });
  });

  it("two copies at two positions play the same motion at two places", () => {
    const a = clipped([SLIDE]);
    const b = clipped([SLIDE]);
    for (const [{ world, ctx }, x] of [[a, -5], [b, 5]] as const) {
      world.initialise(() => undefined);
      ctx.setTransform(ctx.e[0], "position", { x, y: 0, z: 0 });
      world.advanceClips(1);
      world.propagate();
    }
    expect(translationOf(a.world)).toEqual([-3, 0, 0]); // t = 1 is the exact end: the last key is held
    expect(translationOf(b.world)).toEqual([7, 0, 0]);
  });

  it("composes rotation and scale as base times clip", () => {
    const { world, ctx } = clipped([TURN, GROW]);
    world.initialise(() => undefined);
    // The entity's own pose: a scale of 3 along x, then the clip scales by 2 and turns a quarter about Y.
    ctx.setTransform(ctx.e[0], "scale", { x: 3, y: 1, z: 1 });
    world.advanceClips(0);
    world.propagate();
    const m = world.worldMatrix(0);
    const round = (v: number | undefined): number => Math.round((v ?? 0) * 1e4) / 1e4;
    // Column 0 is the image of the x axis: the clip turns it to -z and doubles it; the base scale on x does not touch it.
    expect([round(m[0]), round(m[1]), round(m[2])]).toEqual([0, 0, -2]);
    // Column 2 is the image of z: the clip turns it to +x and doubles it, then the base scale triples x (clip * base would give 2).
    expect([round(m[8]), round(m[9]), round(m[10])]).toEqual([6, 0, 0]);
  });

  it("is posed at time 0 once init has run", () => {
    const { world } = clipped([SLIDE]);
    world.initialise(() => undefined);
    expect(translationOf(world)).toEqual([0, 0, 0]);
  });
});
