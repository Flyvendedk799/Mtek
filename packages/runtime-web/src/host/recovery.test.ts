// Device loss and recovery (spec/runtime-abi.md sections 9.4 and 9.5, decision 0056) against the fake GPU:
// the bounded rebuild (3 attempts, 250 ms / 1 s / 4 s on injectable timers), the retained CPU state, the
// failed state with E8062 and its overlay, and every way an attempt or the application can end meanwhile.
import { describe, expect, it } from "vitest";
import type { MtekProgramScene } from "../abi/program.js";
import type { MtekDiagnostic } from "../diagnostics/types.js";
import { checkManifest } from "../abi/validate.js";
import { BASE_URL, FakeHost, FakeHostDevice, asDom, fakeProgram, minimalSceneInit, type InitContext } from "../test-support/fake-host.js";
import { SHADER_HASH, VALID_WGSL, healthyHost, installProgram, mountOn, spanMapJson } from "../test-support/mount-fixture.js";
import { DEFAULT_RECOVERY_DELAYS_MS, RECOVERY_ATTEMPTS } from "./app.js";
import { mountMtekWith } from "./mount.js";
import type { MtekApp, MtekDebug, MtekMountOptions } from "./types.js";

const TARGET = { width: 16, height: 8 } as const;

function overlayOf(host: FakeHost): ReturnType<FakeHost["document"]["body"]["find"]> {
  return host.document.body.find("data-mtek-overlay");
}

function debugOf(app: MtekApp): MtekDebug {
  if (app.debug === undefined) throw new Error("the app has no debug API");
  return app.debug;
}

/** Polls until `condition` holds; every step of a rebuild is a promise or a zero timeout. */
async function until(condition: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 500; i += 1) {
    if (condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Lets every pending promise and zero timeout run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/** The manual clock with an offscreen target, so frames are driven by `debug.step`. */
function manual(extra: NonNullable<MtekMountOptions["test"]> = {}): MtekMountOptions {
  return { test: { manualClock: true, renderTarget: TARGET, ...extra } };
}

/** The device is lost the way the GPU process dying would: `device.lost` resolves with `unknown`. */
async function lose(host: FakeHost, app: MtekApp, message = "the GPU process crashed"): Promise<void> {
  host.latestDevice.loseDevice("unknown", message);
  await until(() => app.state === "recovering", "state recovering");
}

/** Runs the oldest recovery timer and waits until that attempt ended (success, retry scheduled, or failure). */
async function runAttempt(host: FakeHost, app: MtekApp): Promise<void> {
  const scheduled = host.timers.requestedDelays.length;
  if (!host.timers.runNext()) throw new Error("no recovery timer is waiting");
  await until(() => app.state !== "recovering" || host.timers.requestedDelays.length > scheduled, "the end of the attempt");
}

function codes(seen: readonly MtekDiagnostic[]): string[] {
  return seen.map((d) => d.code);
}

/** A program whose scene `update` moves the first entity with the frame time, so the CPU state is observable. */
function movingProgram(): ReturnType<typeof fakeProgram> {
  const base = fakeProgram();
  const scenes = base.scenes as Record<string, MtekProgramScene>;
  const name = Object.keys(scenes)[0];
  const entry = name === undefined ? undefined : scenes[name];
  if (name === undefined || entry === undefined) throw new Error("no entry scene");
  const update = (ctx: { e: readonly object[]; frame: { time: number }; setTransform(entity: object | undefined, field: string, value: unknown): void }): void => {
    ctx.setTransform(ctx.e[0], "position", { x: Math.fround(ctx.frame.time), y: 0.5, z: 0 });
  };
  return { ...base, scenes: { [name]: { ...entry, update } as unknown as MtekProgramScene } };
}

async function mountMoving(host: FakeHost, options: MtekMountOptions = manual()): Promise<MtekApp> {
  return mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), movingProgram(), options);
}

/** What is on the GPU: every live buffer of a device by label with its bytes, and the last render pass. */
function gpuSnapshot(device: FakeHostDevice): { buffers: [string, number[]][]; draws: number; clear: unknown } {
  const buffers = device.buffers
    .filter((buffer) => !buffer.destroyed && buffer.label !== "mtek readback")
    .map((buffer): [string, number[]] => [buffer.label, [...buffer.contents]]);
  const pass = device.renderPasses.at(-1);
  return { buffers, draws: pass?.draws.length ?? -1, clear: pass?.clearValue };
}

describe("the contract constants", () => {
  it("allows 3 attempts after 250 ms, 1 s and 4 s", () => {
    expect(RECOVERY_ATTEMPTS).toBe(3);
    expect(DEFAULT_RECOVERY_DELAYS_MS).toEqual([250, 1000, 4000]);
  });
});

it.each([BASE_URL, "https://example.test/other-build/"])("recovers a reloaded shader from %s without fetching it again", async (candidateBase) => {
  const host = healthyHost();
  const app = await mountOn(host, manual());
  const hash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const manifest = installProgram(host, (json) => {
    const shader = (json["shaders"] as Record<string, unknown>[])[0]!;
    shader["hash"] = hash;
    shader["url"] = "shaders/aaaaaaaaaaaaaaaa.wgsl";
    shader["map"] = "shaders/aaaaaaaaaaaaaaaa.mtek-map.json";
    (json["materials"] as Record<string, unknown>[])[0]!["shader"] = hash;
  });
  host.files.set(`${candidateBase}shaders/aaaaaaaaaaaaaaaa.wgsl`, VALID_WGSL);
  host.files.set(`${candidateBase}shaders/aaaaaaaaaaaaaaaa.mtek-map.json`, spanMapJson(hash));
  host.files.set(new URL("program.manifest.json", candidateBase).href, JSON.stringify(manifest));
  const checked = checkManifest(manifest);
  if (!checked.ok) throw new Error("invalid candidate manifest");
  const candidate = { ...fakeProgram(minimalSceneInit, checked.manifest), baseUrl: new URL(candidateBase), manifestUrl: new URL("program.manifest.json", candidateBase) };
  expect(await app.replaceProgram?.(candidate)).toEqual({ ok: true });
  debugOf(app).step(1, 0.016);
  const fetched = [...host.fetched];
  host.files.clear();
  await lose(host, app);
  await runAttempt(host, app);
  expect(app.state).toBe("running");
  expect(host.fetched).toEqual(fetched);
  debugOf(app).step(1, 0.016);
  expect(debugOf(app).counters()["failedMaterials"]).toBe(0);
  expect(host.latestDevice.renderPasses.at(-1)?.draws).toHaveLength(1);
  app.dispose();
});

it("retains WGSL by hash when a reused shader moves builds, but loads that build's own map", async () => {
  const host = healthyHost();
  const app = await mountOn(host, manual());
  const manifest = installProgram(host);
  const candidateBase = "https://example.test/moved/";
  host.files.set(`${candidateBase}program.manifest.json`, JSON.stringify(manifest));
  const mapUrl = `${candidateBase}shaders/${SHADER_HASH.slice(0, 16)}.mtek-map.json`;
  host.files.set(mapUrl, spanMapJson());
  const checked = checkManifest(manifest);
  if (!checked.ok) throw new Error("invalid manifest");
  const candidate = { ...fakeProgram(minimalSceneInit, checked.manifest), baseUrl: new URL(candidateBase), manifestUrl: new URL("program.manifest.json", candidateBase) };
  const modules = debugOf(app).counters()["shaderModulesCreated"];
  expect(await app.replaceProgram?.(candidate)).toEqual({ ok: true });
  expect(host.fetched).toContain(mapUrl);
  expect(host.fetched).not.toContain(`${candidateBase}shaders/${SHADER_HASH.slice(0, 16)}.wgsl`);
  expect(debugOf(app).counters()["shaderModulesCreated"]).toBe(modules);
  debugOf(app).step(1, 0.016);
  const fetched = [...host.fetched];
  host.files.clear();
  await lose(host, app);
  await runAttempt(host, app);
  expect(app.state).toBe("running");
  expect(host.fetched).toEqual(fetched);
  debugOf(app).step(1, 0.016);
  expect(host.latestDevice.renderPasses.at(-1)?.draws).toHaveLength(1);
  expect(debugOf(app).counters()["failedMaterials"]).toBe(0);
  app.dispose();
});

describe("device loss starts a recovery", () => {
  it("pauses, reports W8060 and waits 250 ms before the first attempt", async () => {
    const host = healthyHost();
    const seen: MtekDiagnostic[] = [];
    const app = await mountOn(host, { onDiagnostic: (d) => seen.push(d) });
    host.tickFrames(1000);
    await lose(host, app);

    expect(app.state).toBe("recovering");
    expect(codes(seen)).toEqual(["MTEK-W8060"]);
    expect(seen[0]?.phase).toBe("runtime:device");
    expect(seen[0]?.severity).toBe("warning");
    expect(seen[0]?.message).toContain("the GPU process crashed");
    expect(seen[0]?.notes.join(" ")).toContain("3 attempts");
    expect(seen[0]?.notes.join(" ")).toContain("250 ms, 1000 ms, 4000 ms");
    // A warning is not an overlay entry; nothing is shown while recovering.
    expect(overlayOf(host)).toBeUndefined();
    expect(host.pendingFrames).toBe(0);
    expect(host.timers.pending.map((timer) => timer.delayMs)).toEqual([250]);
    expect(host.adapter?.deviceRequests).toHaveLength(1);
    app.dispose();
  });

  it("does not start a recovery for the destroyed loss of dispose()", async () => {
    const host = healthyHost();
    const seen: MtekDiagnostic[] = [];
    const app = await mountOn(host, { onDiagnostic: (d) => seen.push(d) });
    app.dispose();
    await settle();
    expect(seen).toEqual([]);
    expect(host.timers.pending).toEqual([]);
  });

  it("ignores losses while disposed or failed", async () => {
    const host = healthyHost();
    const app = await mountOn(host, manual({ recovery: { failDeviceRequests: 3, delaysMs: [0, 0, 0] } }));
    await lose(host, app);
    await runAttempt(host, app);
    await runAttempt(host, app);
    await runAttempt(host, app);
    expect(app.state).toBe("failed");
    host.device.loseDevice("unknown", "again");
    await Promise.resolve();
    expect(app.state).toBe("failed");
    expect(host.timers.pending).toEqual([]);
    app.dispose();
  });
});

describe("a successful recovery", () => {
  it("rebuilds on a new device, reports W8061, resumes the frame loop and destroys the lost device", async () => {
    const host = healthyHost();
    const seen: MtekDiagnostic[] = [];
    const app = await mountOn(host, { onDiagnostic: (d) => seen.push(d) });
    host.tickFrames(1000);
    const first = host.device;
    await lose(host, app);
    await runAttempt(host, app);

    expect(app.state).toBe("running");
    expect(codes(seen)).toEqual(["MTEK-W8060", "MTEK-W8061"]);
    expect(seen[1]?.severity).toBe("warning");
    expect(seen[1]?.message).toContain("attempt 1 of 3");
    expect(host.adapter?.hostDevices).toHaveLength(2);
    expect(first.destroyed).toBe(true);
    expect(host.context.configuration?.device).toBe(host.latestDevice);
    expect(host.pendingFrames).toBe(1);
    expect(overlayOf(host)).toBeUndefined();
    // The new device renders: a frame after recovery is submitted to it, not to the lost one.
    const before = first.queue.submits;
    host.tickFrames(2000);
    host.tickFrames(2016);
    expect(host.latestDevice.queue.submits).toBeGreaterThan(0);
    expect(first.queue.submits).toBe(before);
    app.dispose();
  });

  it("recreates every GPU resource: the live counts equal the counts before the loss, totals keep growing", async () => {
    const host = healthyHost();
    const app = await mountOn(host, manual());
    debugOf(app).step(2, 0.016);
    const before = debugOf(app).counters();
    await lose(host, app);
    await runAttempt(host, app);
    debugOf(app).step(1, 0.016);
    const after = debugOf(app).counters();

    for (const name of ["liveBuffers", "liveTextures", "liveSamplers", "liveShaderModules", "livePipelines", "liveBindGroups", "liveListeners", "liveEntities"]) {
      expect(after[name], name).toBe(before[name]);
    }
    expect(after["pipelinesCreated"]).toBe((before["pipelinesCreated"] ?? 0) * 2);
    expect(after["shaderModulesCreated"]).toBe((before["shaderModulesCreated"] ?? 0) * 2);
    expect(after["deviceLosses"]).toBe(1);
    expect(after["deviceRecoveries"]).toBe(1);
    expect(after["recoveryAttempts"]).toBe(1);
    app.dispose();
    const disposed = host.latestDevice;
    expect(disposed.buffers.every((buffer) => buffer.destroyed)).toBe(true);
    expect(disposed.textures.every((texture) => texture.destroyed)).toBe(true);
  });

  it("reads the shaders from the remembered files: the rebuild fetches nothing", async () => {
    const host = healthyHost();
    const app = await mountOn(host, manual());
    const fetched = host.fetched.length;
    await lose(host, app);
    await runAttempt(host, app);
    expect(host.fetched).toHaveLength(fetched);
    app.dispose();
  });

  it("produces output identical to a run without the loss, and keeps the CPU state and the clock", async () => {
    const withLoss = new FakeHost();
    const control = new FakeHost();
    installProgram(withLoss);
    installProgram(control);

    const appA = await mountMoving(withLoss);
    const appB = await mountMoving(control);
    debugOf(appA).step(3, 1 / 60);
    await lose(withLoss, appA);
    await runAttempt(withLoss, appA);
    debugOf(appA).step(2, 1 / 60);

    debugOf(appB).step(5, 1 / 60);

    expect(debugOf(appA).scene()).toEqual(debugOf(appB).scene());
    expect(debugOf(appA).scene().entities[0]?.position).toEqual({ x: Math.fround(5 / 60), y: 0.5, z: 0 });
    expect(gpuSnapshot(withLoss.latestDevice)).toEqual(gpuSnapshot(control.latestDevice));
    expect(debugOf(appA).counters()["framesRendered"]).toBe(5);
    const pixelsA = await debugOf(appA).readPixels();
    const pixelsB = await debugOf(appB).readPixels();
    expect([...pixelsA.data]).toEqual([...pixelsB.data]);
    appA.dispose();
    appB.dispose();
  });

  it("refills the material parameter blocks from the mirrors", async () => {
    const host = healthyHost();
    const app = await mountOn(host, manual());
    debugOf(app).step(1, 0.016);
    debugOf(app).setParam("Cube", "color", { r: 0.5, g: 0.25, b: 0.125, a: 1 });
    debugOf(app).step(1, 0.016);
    const before = gpuSnapshot(host.device);
    await lose(host, app);
    await runAttempt(host, app);
    debugOf(app).step(1, 0.016);
    expect(gpuSnapshot(host.latestDevice).buffers).toEqual(before.buffers);
    app.dispose();
  });
});

/** Five identical boxes in a row, one material, instancing available: draws as one instanced draw. */
async function mountInstanced(host: FakeHost, options: MtekMountOptions = manual()): Promise<MtekApp> {
  const json = installProgram(host, (manifest) => {
    const shaders = manifest["shaders"] as Record<string, unknown>[];
    if (shaders[0] !== undefined) shaders[0]["instancedVertexEntry"] = "mtek_vs_instanced";
    const scene = manifest["scene"] as { entities: Record<string, unknown>[]; materialInstances: Record<string, unknown>[] };
    const template = scene.entities[0] ?? {};
    const unlit = "std/materials.mtek::Unlit";
    scene.entities = [0, 1, 2, 3, 4].map((index) => ({ ...template, index, name: `E${String(index)}`, symbol: `src/main.mtek::Demo.E${String(index)}`, material: { id: unlit, instance: index } }));
    scene.materialInstances = [0, 1, 2, 3, 4].map((index) => ({ index, material: unlit, entity: index, params: [{ name: "color", class: "initial" }], shareable: true }));
  });
  const parsed = checkManifest(json);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.failures));
  const init = (context: object): void => {
    minimalSceneInit(context);
    const ctx = context as InitContext;
    ctx.setCamera("position", { x: 0, y: 0, z: 10 });
    ctx.setCamera("target", { x: 0, y: 0, z: 0 });
    ctx.e.forEach((entity, i) => {
      ctx.setTransform(entity, "position", { x: i * 2 - 4, y: 0, z: 0 });
    });
  };
  return mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), fakeProgram(init, parsed.manifest), options);
}

function lastDrawShape(device: FakeHostDevice): [number, number][] {
  return (device.renderPasses.at(-1)?.draws ?? []).map((draw) => [draw.instanceCount, draw.firstInstance]);
}

/** The first `records` records of the live instance buffer (the ones the last draws read; the tail may hold stale data). */
function instanceBytes(device: FakeHostDevice, records: number): number[] {
  const live = device.buffers.filter((buffer) => !buffer.destroyed && buffer.label === "mtek instance matrices");
  if (live.length !== 1 || live[0] === undefined) throw new Error(`expected one live instance buffer, found ${String(live.length)}`);
  return [...live[0].contents.slice(0, records * 128)];
}

describe("a recovery with instancing active", () => {
  it("rebuilds the instance buffer and the instanced pipelines and draws exactly what a run without the loss draws", async () => {
    const withLoss = new FakeHost();
    const control = new FakeHost();
    const appA = await mountInstanced(withLoss);
    const appB = await mountInstanced(control);
    // E2 gets its own parameters, so the rebuild has to recreate a shared block, a split-off block and the groups.
    for (const app of [appA, appB]) {
      debugOf(app).step(2, 1 / 60);
      debugOf(app).setParam("E2", "color", { r: 1, g: 0, b: 0, a: 1 });
      debugOf(app).step(1, 1 / 60);
    }
    expect(lastDrawShape(withLoss.device)).toEqual([[4, 0], [1, 0]]);
    const lost = withLoss.device;
    expect(instanceBytes(lost, 5)).toHaveLength(5 * 128);

    await lose(withLoss, appA);
    await runAttempt(withLoss, appA);
    debugOf(appA).step(1, 1 / 60);
    debugOf(appB).step(1, 1 / 60);

    // The lost device's instance buffer is gone, a new one exists on the new device, with the same records.
    expect(lost.buffers.filter((buffer) => buffer.label === "mtek instance matrices").every((buffer) => buffer.destroyed)).toBe(true);
    expect(instanceBytes(withLoss.latestDevice, 4)).toEqual(instanceBytes(control.device, 4));
    expect(lastDrawShape(withLoss.latestDevice)).toEqual([[4, 0], [1, 0]]);
    const a = debugOf(appA).counters();
    const b = debugOf(appB).counters();
    for (const name of ["drawCalls", "instancedDraws", "sharedParamBlocks", "ownedParamBlocks", "liveBuffers", "livePipelines"]) expect(a[name], name).toBe(b[name]);
    expect(a["drawCalls"]).toBe(2);
    expect(a["instancedDraws"]).toBe(1);
    expect([...(await debugOf(appA).readPixels()).data]).toEqual([...(await debugOf(appB).readPixels()).data]);
    appA.dispose();
    appB.dispose();
  });
});

describe("a recovery is bounded", () => {
  it("makes at most 3 attempts at 250 ms, 1 s and 4 s, then fails with E8062 and the overlay", async () => {
    const host = healthyHost();
    const seen: MtekDiagnostic[] = [];
    const app = await mountOn(host, { onDiagnostic: (d) => seen.push(d) });
    host.tickFrames(1000);
    // Every request for a new device is rejected, as when the adapter is gone.
    const requests = host.adapter?.requestDevice.bind(host.adapter);
    if (host.adapter === null || requests === undefined) throw new Error("no adapter");
    let calls = 0;
    host.adapter.requestDevice = (): never => {
      calls += 1;
      return Promise.reject(new Error("the adapter is gone")) as never;
    };
    await lose(host, app);
    expect(host.timers.requestedDelays).toEqual([250]);

    await runAttempt(host, app);
    expect(app.state).toBe("recovering");
    expect(host.timers.requestedDelays).toEqual([250, 1000]);
    await runAttempt(host, app);
    expect(app.state).toBe("recovering");
    expect(host.timers.requestedDelays).toEqual([250, 1000, 4000]);
    await runAttempt(host, app);

    expect(app.state).toBe("failed");
    expect(calls).toBe(3);
    // No fourth attempt, no timer left behind.
    expect(host.timers.requestedDelays).toEqual([250, 1000, 4000]);
    expect(host.timers.pending).toEqual([]);
    expect(codes(seen)).toEqual(["MTEK-W8060", "MTEK-E8062"]);
    const failure = seen[1];
    expect(failure?.severity).toBe("error");
    expect(failure?.phase).toBe("runtime:device");
    expect(failure?.message).toContain("3 attempts");
    expect(failure?.notes.filter((note) => note.startsWith("attempt "))).toHaveLength(3);
    expect(failure?.notes.join("\n")).toContain("the adapter is gone");
    const overlay = overlayOf(host);
    expect(overlay?.getAttribute("role")).toBe("alert");
    expect(overlay?.textContent).toContain("MTEK-E8062");
    expect(host.pendingFrames).toBe(0);

    app.dispose();
    expect(app.state).toBe("disposed");
    expect(overlayOf(host)).toBeUndefined();
    expect(host.timers.requestedDelays).toEqual([250, 1000, 4000]);
  });

  it("succeeds on a later attempt: W8061 names the attempt and later delays are never requested", async () => {
    const host = healthyHost();
    const seen: MtekDiagnostic[] = [];
    const app = await mountOn(host, { onDiagnostic: (d) => seen.push(d), test: { recovery: { failDeviceRequests: 1 } } });
    await lose(host, app);
    await runAttempt(host, app);
    expect(app.state).toBe("recovering");
    await runAttempt(host, app);
    expect(app.state).toBe("running");
    expect(host.timers.requestedDelays).toEqual([250, 1000]);
    expect(seen.at(-1)?.code).toBe("MTEK-W8061");
    expect(seen.at(-1)?.message).toContain("attempt 2 of 3");
    expect(host.timers.pending).toEqual([]);
    app.dispose();
  });

  it("counts a device lost during an attempt as a failed attempt and destroys that device", async () => {
    const host = healthyHost();
    const seen: MtekDiagnostic[] = [];
    const app = await mountOn(host, { onDiagnostic: (d) => seen.push(d) });
    const adapter = host.adapter;
    if (adapter === null) throw new Error("no adapter");
    const original = adapter.requestDevice.bind(adapter);
    let first = true;
    adapter.requestDevice = async (descriptor) => {
      const device = await original(descriptor);
      if (first) {
        first = false;
        device.queue.onSubmittedWorkDone = async (): Promise<void> => {
          device.loseDevice("unknown", "lost again during the rebuild");
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        };
      }
      return device;
    };
    await lose(host, app);
    await runAttempt(host, app);
    expect(app.state).toBe("recovering");
    expect(host.adapter?.hostDevices[1]?.destroyed).toBe(true);
    await runAttempt(host, app);
    expect(app.state).toBe("running");
    expect(host.adapter?.hostDevices).toHaveLength(3);
    expect(host.context.configuration?.device).toBe(host.latestDevice);
    expect(codes(seen)).toEqual(["MTEK-W8060", "MTEK-W8061"]);
    app.dispose();
  });

  it("counts an allocation failure during an attempt as a failed attempt, not as E8063 of the application", async () => {
    const host = healthyHost();
    const seen: MtekDiagnostic[] = [];
    const app = await mountOn(host, { onDiagnostic: (d) => seen.push(d) });
    const adapter = host.adapter;
    if (adapter === null) throw new Error("no adapter");
    const original = adapter.requestDevice.bind(adapter);
    let first = true;
    adapter.requestDevice = async (descriptor) => {
      const device = await original(descriptor);
      if (first) {
        first = false;
        device.failNextAllocations(1);
      }
      return device;
    };
    await lose(host, app);
    await runAttempt(host, app);
    expect(app.state).toBe("recovering");
    await runAttempt(host, app);
    expect(app.state).toBe("running");
    expect(codes(seen)).toEqual(["MTEK-W8060", "MTEK-W8061"]);
    app.dispose();
  });
});

describe("what else can happen during a recovery", () => {
  it("dispose() during the wait cancels the timer and requests no device", async () => {
    const host = healthyHost();
    const app = await mountOn(host);
    await lose(host, app);
    expect(host.timers.pending).toHaveLength(1);
    app.dispose();
    expect(host.timers.pending).toEqual([]);
    expect(app.state).toBe("disposed");
    expect(host.adapter?.deviceRequests).toHaveLength(1);
  });

  it("dispose() while an attempt runs releases everything that attempt created", async () => {
    const host = healthyHost();
    const app = await mountOn(host);
    const adapter = host.adapter;
    if (adapter === null) throw new Error("no adapter");
    const original = adapter.requestDevice.bind(adapter);
    let release: (() => void) | undefined;
    adapter.requestDevice = async (descriptor) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return original(descriptor);
    };
    await lose(host, app);
    host.timers.runNext();
    await until(() => release !== undefined, "the device request");
    app.dispose();
    release?.();
    await until(() => host.adapter?.hostDevices.length === 2, "the late device");
    await until(() => host.latestDevice.destroyed, "the late device to be destroyed");
    expect(app.state).toBe("disposed");
    expect(host.timers.pending).toEqual([]);
    expect(host.context.configuration).toBeNull();
  });

  it("does not resize while recovering; the rebuilt surface has the size the canvas has by then", async () => {
    const host = healthyHost();
    const app = await mountOn(host, { test: { manualClock: true } });
    await lose(host, app);
    host.canvas.clientWidth = 640;
    host.canvas.clientHeight = 360;
    host.resizeObservers[0]?.trigger();
    expect(host.canvas.width).toBe(200);
    await runAttempt(host, app);
    expect([host.canvas.width, host.canvas.height]).toEqual([640, 360]);
    const depth = host.latestDevice.textures.filter((texture) => texture.format === "depth24plus" && !texture.destroyed);
    expect(depth.map((texture) => [texture.width, texture.height])).toEqual([[640, 360]]);
    app.dispose();
  });

  it("restores a pause the host asked for, and the pause of a hidden page", async () => {
    const host = healthyHost();
    const app = await mountOn(host);
    app.pause();
    await lose(host, app);
    await runAttempt(host, app);
    expect(app.state).toBe("paused");
    expect(host.pendingFrames).toBe(0);
    app.resume();
    expect(app.state).toBe("running");

    await lose(host, app);
    host.document.setVisibility("hidden");
    await runAttempt(host, app);
    expect(app.state).toBe("paused");
    host.document.setVisibility("visible");
    expect(app.state).toBe("running");
    expect(host.pendingFrames).toBe(1);
    app.dispose();
  });

  it("ignores pause() and resume() while recovering, and refuses replaceProgram", async () => {
    const host = healthyHost();
    const seen: MtekDiagnostic[] = [];
    const app = await mountOn(host, { onDiagnostic: (d) => seen.push(d) });
    await lose(host, app);
    app.pause();
    app.resume();
    expect(app.state).toBe("recovering");
    const result = await app.replaceProgram?.(fakeProgram());
    expect(result?.ok).toBe(false);
    expect(seen.at(-1)?.message).toContain("recovering");
    app.dispose();
  });

  it("recovers from a second loss and reports it as a new W8060 (never deduplicated)", async () => {
    const host = healthyHost();
    const seen: MtekDiagnostic[] = [];
    const app = await mountOn(host, { onDiagnostic: (d) => seen.push(d) });
    await lose(host, app, "same message");
    await runAttempt(host, app);
    await lose(host, app, "same message");
    await runAttempt(host, app);
    expect(app.state).toBe("running");
    expect(codes(seen)).toEqual(["MTEK-W8060", "MTEK-W8061", "MTEK-W8060", "MTEK-W8061"]);
    expect(seen[2]?.message).toContain("device loss 2");
    expect(seen[3]?.message).toContain("recovery 2");
    app.dispose();
  });

  it("ignores the late loss event of a device that was already replaced", async () => {
    const host = healthyHost();
    const seen: MtekDiagnostic[] = [];
    const app = await mountOn(host, { onDiagnostic: (d) => seen.push(d) });
    const first = host.device;
    await lose(host, app);
    await runAttempt(host, app);
    first.loseDevice("unknown", "late echo");
    await settle();
    expect(app.state).toBe("running");
    expect(codes(seen)).toEqual(["MTEK-W8060", "MTEK-W8061"]);
    app.dispose();
  });

  it("takes a material whose pipeline fails after the rebuild out of the scene (E8051, phase runtime:device) and keeps running", async () => {
    const broken = { on: false };
    const host = new FakeHost({ adapter: { pipelineError: () => (broken.on ? "pipeline rejected" : undefined) } });
    installProgram(host);
    const seen: MtekDiagnostic[] = [];
    const app = await mountOn(host, { ...manual(), onDiagnostic: (d) => seen.push(d) });
    debugOf(app).step(1, 0.016);
    expect(debugOf(app).counters()["drawCalls"]).toBe(1);
    await lose(host, app);
    broken.on = true;
    await runAttempt(host, app);

    expect(app.state).toBe("running");
    expect(codes(seen)).toEqual(["MTEK-W8060", "MTEK-E8051", "MTEK-W8061"]);
    expect(seen[1]?.phase).toBe("runtime:device");
    debugOf(app).step(1, 0.016);
    expect(debugOf(app).counters()["failedMaterials"]).toBe(1);
    expect(debugOf(app).counters()["drawCalls"]).toBe(0);
    app.dispose();
  });
});

describe("the debug hooks", () => {
  it("loseDevice() destroys the device and the runtime recovers from it", async () => {
    const host = healthyHost();
    const seen: MtekDiagnostic[] = [];
    const app = await mountOn(host, { ...manual(), onDiagnostic: (d) => seen.push(d) });
    debugOf(app).loseDevice();
    expect(host.device.destroyed).toBe(true);
    await until(() => app.state === "recovering", "state recovering");
    expect(seen[0]?.message).toContain("destroyed");
    await runAttempt(host, app);
    expect(app.state).toBe("running");
    // The hook works again on the new device.
    debugOf(app).loseDevice();
    await until(() => app.state === "recovering", "state recovering again");
    await runAttempt(host, app);
    expect(app.state).toBe("running");
    expect(debugOf(app).counters()["deviceLosses"]).toBe(2);
    app.dispose();
  });

  it("loseDevice() and failAllocation() refuse a disposed application; there is no debug API without options.test", async () => {
    const host = healthyHost();
    const app = await mountOn(host, manual());
    const debug = debugOf(app);
    app.dispose();
    expect(() => {
      debug.loseDevice();
    }).toThrow(/disposed/);
    expect(() => {
      debug.failAllocation();
    }).toThrow(/disposed/);

    const plain = healthyHost();
    const production = await mountOn(plain);
    expect(production.debug).toBeUndefined();
    production.dispose();
  });

  it("failAllocation() reports E8063 and stops the scene with the overlay", async () => {
    const host = healthyHost();
    const seen: MtekDiagnostic[] = [];
    const app = await mountOn(host, { ...manual(), onDiagnostic: (d) => seen.push(d) });
    debugOf(app).failAllocation();
    expect(app.state).toBe("failed");
    expect(codes(seen)).toEqual(["MTEK-E8063"]);
    expect(overlayOf(host)?.textContent).toContain("MTEK-E8063");
    expect(() => {
      debugOf(app).step(1, 0.016);
    }).not.toThrow();
    expect(debugOf(app).counters()["framesRendered"]).toBe(0);
    app.dispose();
  });

  it("loseDevice() is refused while recovering", async () => {
    const host = healthyHost();
    const app = await mountOn(host, manual());
    await lose(host, app);
    expect(() => {
      debugOf(app).loseDevice();
    }).toThrow(/recovering/);
    app.dispose();
  });
});

describe("test.recovery option validation", () => {
  it("rejects delays that are not three non-negative numbers, and a bad injected failure count", async () => {
    for (const recovery of [
      { delaysMs: [1, 2] },
      { delaysMs: [1, 2, 3, 4] },
      { delaysMs: [1, -2, 3] },
      { delaysMs: [1, Number.NaN, 3] },
      { failDeviceRequests: -1 },
      { failDeviceRequests: 1.5 },
    ]) {
      const host = healthyHost();
      await expect(mountOn(host, { test: { recovery } as never }), JSON.stringify(recovery)).rejects.toThrow(RangeError);
    }
    const host = healthyHost();
    await expect(mountOn(host, { test: { renderTarget: TARGET, canvasRenderTarget: true } })).rejects.toThrow(/exclude each other/);
  });

  it("uses the delays it is given", async () => {
    const host = healthyHost();
    const app = await mountOn(host, { test: { manualClock: true, recovery: { delaysMs: [1, 2, 3], failDeviceRequests: 3 } } });
    await lose(host, app);
    await runAttempt(host, app);
    await runAttempt(host, app);
    await runAttempt(host, app);
    expect(host.timers.requestedDelays).toEqual([1, 2, 3]);
    expect(app.state).toBe("failed");
    app.dispose();
  });
});
