/**
 * Frustum culling in the renderer (`spec/runtime-abi.md` section 8.4, decision 0055), through a mounted
 * application on the fake host: which draws are encoded, the `drawCalls` / `culledObjects` counters, and
 * that culling never changes what an entity writes to its object block.
 *
 * The expected visibility of every entity is worked out by hand from the camera (below), not by running
 * the code under test. The camera looks along -Z from (0, 0, 10) with `fov_y = 0.9`, and the render target is
 * 16 x 8 (aspect 2), so for an entity on the z = 0 plane (10 units away):
 *   half height = 10 * tan(0.45)   = 4.83,   half width = 2 * 4.83 = 9.66.
 * The unit box has bounding radius sqrt(3) / 2 = 0.866. The side planes are tilted, so the distance of a
 * point to the right plane is (9.66 - x) * cos(atan(0.966)) = (9.66 - x) * 0.719, to the top plane
 * (4.83 - y) * cos(atan(0.483)) = (4.83 - y) * 0.9; an entity is culled when that distance is below -0.866 times
 * its scale.
 */
import { describe, expect, it } from "vitest";
import { checkManifest } from "../abi/validate.js";
import type { MtekManifest } from "../abi/manifest-types.js";
import { mountMtekWith } from "../host/mount.js";
import type { MtekApp, MtekDebug, MtekTestOptions } from "../host/types.js";
import {
  FakeHost,
  asDom,
  fakeProgram,
  minimalSceneInit,
  type FakeDrawRecord,
  type InitContext,
} from "../test-support/fake-host.js";
import { installProgram } from "../test-support/mount-fixture.js";
import type { FakeBuffer } from "../test-support/fake-gpu.js";

type Json = Record<string, unknown>;

const TARGET = { width: 16, height: 8 } as const;

/** Five entities sharing the Unlit material, one instance each (so five distinct draws). */
function fiveEntities(json: Json): void {
  const scene = json["scene"] as { entities: Json[]; materialInstances: Json[] };
  const template = scene.entities[0] ?? {};
  const unlit = "std/materials.mtek::Unlit";
  scene.entities = [0, 1, 2, 3, 4].map((index) => ({
    ...template,
    index,
    name: `E${String(index)}`,
    symbol: `src/main.mtek::Demo.E${String(index)}`,
    material: { id: unlit, instance: index },
  }));
  scene.materialInstances = [0, 1, 2, 3, 4].map((index) => ({
    index,
    material: unlit,
    entity: index,
    params: [{ name: "color", class: "initial" }],
    shareable: true,
  }));
}

interface Vec {
  x: number;
  y: number;
  z: number;
}

interface Scene {
  readonly host: FakeHost;
  readonly app: MtekApp;
  readonly debug: MtekDebug;
  readonly manifest: MtekManifest;
  /** Moves the camera (position and target) after mounting. */
  readonly moveCamera: (position: Vec, target: Vec) => void;
}

async function mountEntities(
  positions: readonly Vec[],
  options: { scales?: readonly Vec[]; camera?: [Vec, Vec]; test?: MtekTestOptions; hidden?: readonly number[] } = {},
): Promise<Scene> {
  const host = new FakeHost();
  const json = installProgram(host, fiveEntities);
  const parsed = checkManifest(json);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.failures));
  let saved: InitContext | undefined;
  const [position, target] = options.camera ?? [{ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 0 }];
  const init = (context: object): void => {
    minimalSceneInit(context);
    const ctx = context as InitContext;
    ctx.setCamera("position", position);
    ctx.setCamera("target", target);
    positions.forEach((p, i) => {
      ctx.setTransform(ctx.e[i], "position", p);
      const scale = options.scales?.[i];
      if (scale !== undefined) ctx.setTransform(ctx.e[i], "scale", scale);
    });
    // Entities without a position given are hidden, so they take no part in the test.
    for (let i = positions.length; i < ctx.e.length; i += 1) ctx.setVisible(ctx.e[i], false);
    for (const i of options.hidden ?? []) ctx.setVisible(ctx.e[i], false);
    saved = ctx;
  };
  const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), fakeProgram(init, parsed.manifest), {
    test: options.test ?? { manualClock: true, renderTarget: TARGET },
  });
  if (app.debug === undefined || saved === undefined) throw new Error("no debug API");
  const ctx = saved;
  return {
    host,
    app,
    debug: app.debug,
    manifest: parsed.manifest,
    moveCamera: (p, t) => {
      ctx.setCamera("position", p);
      ctx.setCamera("target", t);
    },
  };
}

function lastDraws(host: FakeHost): readonly FakeDrawRecord[] {
  const pass = host.device.renderPasses.at(-1);
  if (pass === undefined) throw new Error("no render pass");
  return pass.draws;
}

/** The entities (= object slots, 256 bytes apart) of the last pass's draws, in draw order. */
function drawnEntities(host: FakeHost): number[] {
  return lastDraws(host).map((draw) => (draw.dynamicOffsets[2]?.[0] ?? -1) / 256);
}

function bufferLabelled(host: FakeHost, label: string): FakeBuffer {
  const found = host.device.buffers.filter((buffer) => buffer.label === label && !buffer.destroyed);
  if (found.length !== 1 || found[0] === undefined) throw new Error(`expected one live buffer '${label}', found ${String(found.length)}`);
  return found[0];
}

const ROW: readonly Vec[] = [-4, -2, 0, 2, 4].map((x) => ({ x, y: 0, z: 0 }));

describe("frustum culling in the renderer", () => {
  it("draws everything that is in view and counts nothing as culled", async () => {
    const { host, debug, app } = await mountEntities(ROW);
    debug.step(1, 0.016);
    expect(drawnEntities(host)).toEqual([0, 1, 2, 3, 4]);
    expect(debug.counters()).toMatchObject({ drawCalls: 5, culledObjects: 0, liveEntities: 5 });
    app.dispose();
  });

  it("culls the entities whose bounding sphere is outside a side plane, above, or behind the camera", async () => {
    const { host, debug, app } = await mountEntities([
      { x: 0, y: 0, z: 0 }, //   centre of the view: visible
      { x: 9, y: 0, z: 0 }, //   distance to the right plane (9.66 - 9) * 0.719 = 0.47 > 0: visible
      { x: 12, y: 0, z: 0 }, //  (9.66 - 12) * 0.719 = -1.68 < -0.866: right of the view, culled
      { x: 0, y: 7, z: 0 }, //   (4.83 - 7) * 0.9 = -1.95 < -0.866: above the view, culled
      { x: 0, y: 0, z: 20 }, //  10 behind the camera: culled by the near plane
    ]);
    debug.step(1, 0.016);
    expect(drawnEntities(host)).toEqual([0, 1]);
    expect(debug.counters()).toMatchObject({ drawCalls: 2, culledObjects: 3 });
    app.dispose();
  });

  it("keeps an entity whose sphere reaches into the view but whose centre is outside", async () => {
    // Centre x = 10 is 0.34 outside the right plane at (9.66 - 10) * 0.719 = -0.24, within the radius 0.866.
    const { host, debug, app } = await mountEntities([{ x: 10, y: 0, z: 0 }]);
    debug.step(1, 0.016);
    expect(drawnEntities(host)).toEqual([0]);
    expect(debug.counters()["culledObjects"]).toBe(0);
    app.dispose();
  });

  it("scales the bounding radius by the largest world scale", async () => {
    // x = 12 is culled at scale 1 (above). With scale (3, 1, 1) the radius is 3 * 0.866 = 2.6 > 1.68: kept.
    const unscaled = await mountEntities([{ x: 12, y: 0, z: 0 }]);
    unscaled.debug.step(1, 0.016);
    expect(unscaled.debug.counters()).toMatchObject({ drawCalls: 0, culledObjects: 1 });
    unscaled.app.dispose();

    const scaled = await mountEntities([{ x: 12, y: 0, z: 0 }], { scales: [{ x: 3, y: 1, z: 1 }] });
    scaled.debug.step(1, 0.016);
    expect(scaled.debug.counters()).toMatchObject({ drawCalls: 1, culledObjects: 0 });
    scaled.app.dispose();

    // The smallest scale does not count: (1, 1, 3) also gives radius 2.6, (1, 1, 1) gives 0.866.
    const deep = await mountEntities([{ x: 12, y: 0, z: 0 }], { scales: [{ x: 1, y: 1, z: 3 }] });
    deep.debug.step(1, 0.016);
    expect(deep.debug.counters()).toMatchObject({ drawCalls: 1, culledObjects: 0 });
    deep.app.dispose();
  });

  it("does not count hidden entities as culled", async () => {
    const { host, debug, app } = await mountEntities(ROW, { hidden: [1, 3] });
    debug.step(1, 0.016);
    expect(drawnEntities(host)).toEqual([0, 2, 4]);
    expect(debug.counters()).toMatchObject({ drawCalls: 3, culledObjects: 0 });
    app.dispose();
  });

  it("moving the camera away culls more objects and encodes fewer draws; moving it back restores them", async () => {
    // Window of x seen from camera x = c: [c - 9.66, c + 9.66] widened by the radius effect (see the header).
    const { host, debug, app, moveCamera } = await mountEntities(ROW);
    debug.step(1, 0.016);
    expect(debug.counters()).toMatchObject({ drawCalls: 5, culledObjects: 0 });

    // Camera at x = 14: the left edge of the view on z = 0 is 14 - 9.66 = 4.34. The entity at x = 4 is 0.34
    // outside (-0.24 > -0.866: kept); x = 2 is (2 - 4.34) * 0.719 = -1.68 outside (culled), and so are -2, 0, -4.
    moveCamera({ x: 14, y: 0, z: 10 }, { x: 14, y: 0, z: 0 });
    debug.step(1, 0.016);
    expect(drawnEntities(host)).toEqual([4]);
    expect(debug.counters()).toMatchObject({ drawCalls: 1, culledObjects: 4 });

    // Far away: everything is culled and nothing is encoded.
    moveCamera({ x: 100, y: 0, z: 10 }, { x: 100, y: 0, z: 0 });
    debug.step(1, 0.016);
    expect(lastDraws(host)).toHaveLength(0);
    expect(debug.counters()).toMatchObject({ drawCalls: 0, culledObjects: 5 });

    moveCamera({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 0 });
    debug.step(1, 0.016);
    expect(drawnEntities(host)).toEqual([0, 1, 2, 3, 4]);
    expect(debug.counters()).toMatchObject({ drawCalls: 5, culledObjects: 0 });
    app.dispose();
  });

  it("accumulates the per-frame counters into cumulative ones", async () => {
    const { debug, app, moveCamera } = await mountEntities(ROW);
    debug.step(1, 0.016); // 5 draws, 0 culled
    moveCamera({ x: 14, y: 0, z: 10 }, { x: 14, y: 0, z: 0 });
    debug.step(2, 0.016); // 2 frames of 1 draw, 4 culled
    expect(debug.counters()).toMatchObject({ drawCalls: 1, culledObjects: 4, drawCallsTotal: 5 + 2, culledObjectsTotal: 8 });
    app.dispose();
  });

  it("an entity that was culled has the right object block when it returns (the block is written when a draw reads it, decision 0120)", async () => {
    const { host, debug, app, manifest, moveCamera } = await mountEntities(ROW, { camera: [{ x: 100, y: 0, z: 10 }, { x: 100, y: 0, z: 0 }] });
    debug.step(1, 0.016);
    expect(debug.counters()).toMatchObject({ drawCalls: 0, culledObjects: 5 });
    const model = manifest.layouts.find((layout) => layout.id === "builtin:object")?.root.members.find((m) => m.name === "model")?.node.offset;
    if (model === undefined) throw new Error("no model member");
    const object = bufferLabelled(host, "mtek:uniform-arena:builtin:object");
    // Translation of entity 3 (x = 2): elements 12..14 of its column-major model matrix, in its 256-byte slot.
    const translation = (): number[] => Array.from(new Float32Array(object.contents.buffer.slice(3 * 256 + model + 12 * 4, 3 * 256 + model + 15 * 4)));
    // Nothing reads the block while the entity is culled, so nothing is uploaded for it.
    expect(translation()).toEqual([0, 0, 0]);
    moveCamera({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 0 });
    debug.step(1, 0.016);
    expect(drawnEntities(host)).toEqual([0, 1, 2, 3, 4]);
    expect(translation()).toEqual([2, 0, 0]);
    app.dispose();
  });

  it("test.disableCulling draws every visible entity and counts none as culled", async () => {
    const { host, debug, app } = await mountEntities(ROW, {
      camera: [{ x: 100, y: 0, z: 10 }, { x: 100, y: 0, z: 0 }],
      test: { manualClock: true, renderTarget: TARGET, disableCulling: true },
    });
    debug.step(1, 0.016);
    expect(drawnEntities(host)).toEqual([0, 1, 2, 3, 4]);
    expect(debug.counters()).toMatchObject({ drawCalls: 5, culledObjects: 0 });
    app.dispose();
  });

  it("a frame that is not drawn (zero-sized canvas) reports 0 draws and 0 culled", async () => {
    const host = new FakeHost();
    host.canvas.clientWidth = 0;
    host.canvas.clientHeight = 0;
    const json = installProgram(host, fiveEntities);
    const parsed = checkManifest(json);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.failures));
    const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), fakeProgram(minimalSceneInit, parsed.manifest), {
      test: { manualClock: true },
    });
    app.debug?.step(2, 0.016);
    expect(app.debug?.counters()).toMatchObject({ drawCalls: 0, culledObjects: 0, framesSkipped: 2 });
    app.dispose();
  });
});
