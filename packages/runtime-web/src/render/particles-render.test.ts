/**
 * Particles in the renderer (decisions 0155 and 0173), through a mounted application on the fake host: where they are
 * drawn relative to the opaque and translucent draws, the blended pipeline of a translucent emitter, the single
 * buffer, the draw cap and its warning, and drawing with instancing off.
 */
import { describe, expect, it } from "vitest";
import { checkManifest } from "../abi/validate.js";
import type { MtekDiagnostic } from "../diagnostics/types.js";
import { mountMtekWith } from "../host/mount.js";
import type { MtekMountOptions } from "../host/types.js";
import { FakeHost, asDom, fakeProgram, minimalSceneInit, type FakeDrawRecord, type InitContext } from "../test-support/fake-host.js";
import { installProgram } from "../test-support/mount-fixture.js";

type Json = Record<string, unknown>;

const TARGET = { width: 16, height: 8 } as const;
const UNLIT = "std/materials.mtek::Unlit";
const PARTICLE_BUFFER = "mtek particle billboards";
const OPAQUE = { r: 1, g: 0, b: 0, a: 1 };
const GLASS = { r: 0, g: 0, b: 1, a: 0.5 };

interface Item {
  readonly color: typeof OPAQUE;
  readonly z: number;
  readonly emitter?: boolean;
}

const EMITTER = { rate: 10_000, lifetime: 100, speed: 0, size: 0.1, gravity: 0 };

async function mount(items: readonly Item[], options: MtekMountOptions["test"] = { manualClock: true, renderTarget: TARGET }) {
  const host = new FakeHost();
  const json = installProgram(host, (manifest: Json) => {
    const shader = (manifest["shaders"] as Json[])[0];
    if (shader === undefined) throw new Error("no shader");
    shader["instancedVertexEntry"] = "mtek_vs_instanced";
    const scene = manifest["scene"] as { entities: Json[]; materialInstances: Json[] };
    const template = scene.entities[0] ?? {};
    scene.entities = items.map((item, index) => ({
      ...template,
      index,
      name: `E${String(index)}`,
      symbol: `src/main.mtek::Demo.E${String(index)}`,
      mesh: "mesh:0",
      material: { id: UNLIT, instance: index },
      ...(item.emitter === true ? { particles: EMITTER } : {}),
    }));
    scene.materialInstances = items.map((_, index) => ({
      index,
      material: UNLIT,
      entity: index,
      params: [{ name: "color", class: "initial" }],
      shareable: false,
    }));
  });
  const parsed = checkManifest(json);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.failures));
  const reported: MtekDiagnostic[] = [];
  const init = (context: object): void => {
    minimalSceneInit(context);
    const ctx = context as InitContext;
    ctx.setCamera("position", { x: 0, y: 0, z: 10 });
    ctx.setCamera("target", { x: 0, y: 0, z: 0 });
    items.forEach((item, i) => {
      ctx.setTransform(ctx.e[i], "position", { x: 0, y: 0, z: item.z });
      ctx.setParam(ctx.e[i], "color", item.color);
    });
  };
  const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), fakeProgram(init, parsed.manifest), {
    test: options,
    onDiagnostic: (d) => reported.push(d),
  });
  if (app.debug === undefined) throw new Error("no debug API");
  return { host, app, debug: app.debug, reported };
}

function lastDraws(host: FakeHost): readonly FakeDrawRecord[] {
  const pass = host.device.renderPasses.at(-1);
  if (pass === undefined) throw new Error("no render pass");
  return pass.draws;
}

const isParticles = (draw: FakeDrawRecord): boolean => draw.vertexBuffers.some((buffer) => buffer.label === PARTICLE_BUFFER);

interface Described {
  readonly blend: boolean;
  readonly depthWrite: boolean;
}
function describe_(draw: FakeDrawRecord): Described {
  const descriptor = draw.pipeline.descriptor as { fragment: { targets: { blend?: unknown }[] }; depthStencil: { depthWriteEnabled: boolean } };
  return { blend: descriptor.fragment.targets[0]?.blend !== undefined, depthWrite: descriptor.depthStencil.depthWriteEnabled };
}

describe("particles in the frame (decision 0173)", () => {
  it("are drawn after the opaque draws and before the translucent ones", async () => {
    // E0 is opaque, E1 an opaque emitter (its own mesh is drawn too), E2 a translucent entity: in the order the pass must show.
    const { host, debug, app, reported } = await mount([{ color: OPAQUE, z: 0 }, { color: OPAQUE, z: 1, emitter: true }, { color: GLASS, z: 2 }]);
    debug.step(2, 0.016);
    const draws = lastDraws(host);
    expect(draws.map(isParticles)).toEqual([false, false, true, false]);
    expect(draws.map((draw) => describe_(draw))).toEqual([
      { blend: false, depthWrite: true },
      { blend: false, depthWrite: true },
      { blend: false, depthWrite: true },
      { blend: true, depthWrite: false },
    ]);
    expect(draws[2]?.instanceCount).toBe(64);
    expect(reported).toEqual([]);
    app.dispose();
  });

  it("use the blended pipeline without depth writes when the emitter's material is translucent, after the opaque particles", async () => {
    const { host, debug, app } = await mount([{ color: GLASS, z: 0, emitter: true }, { color: OPAQUE, z: 1, emitter: true }]);
    debug.step(2, 0.016);
    const draws = lastDraws(host);
    // The opaque emitter's mesh, its particles, the translucent emitter's particles, then its own translucent mesh.
    expect(draws.map(isParticles)).toEqual([false, true, true, false]);
    expect(draws.map((draw) => describe_(draw))).toEqual([
      { blend: false, depthWrite: true },
      { blend: false, depthWrite: true },
      { blend: true, depthWrite: false },
      { blend: true, depthWrite: false },
    ]);
    app.dispose();
  });

  it("use one buffer for the whole run, not one per frame", async () => {
    const { host, debug, app } = await mount([{ color: OPAQUE, z: 0, emitter: true }]);
    debug.step(1, 0.016);
    const count = (): number => host.device.buffers.filter((buffer) => buffer.label === PARTICLE_BUFFER).length;
    expect(count()).toBe(1);
    // The pool fills over the next frames; the buffer was made for the cap already.
    debug.step(10, 0.016);
    expect(count()).toBe(1);
    app.dispose();
  });

  it("warn once when more are alive than are drawn, and draw the cap", async () => {
    const items: Item[] = Array.from({ length: 65 }, () => ({ color: OPAQUE, z: 0, emitter: true }));
    const { host, debug, app, reported } = await mount(items);
    debug.step(3, 0.016);
    debug.step(3, 0.016);
    expect(reported.map((d) => d.code)).toEqual(["MTEK-W8210"]);
    expect(lastDraws(host).filter(isParticles).reduce((sum, draw) => sum + draw.instanceCount, 0)).toBe(4096);
    app.dispose();
  });

  it("are drawn when instancing is off", async () => {
    const { host, debug, app } = await mount([{ color: OPAQUE, z: 0, emitter: true }], { manualClock: true, renderTarget: TARGET, disableInstancing: true });
    debug.step(2, 0.016);
    const draws = lastDraws(host);
    expect(draws.filter(isParticles)).toHaveLength(1);
    app.dispose();
  });
});
