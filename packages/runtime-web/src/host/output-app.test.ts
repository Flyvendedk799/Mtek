import { describe, expect, it, vi } from "vitest";
import type { MtekManifest } from "../abi/manifest-types.js";
import type { MtekProgramScene } from "../abi/program.js";
import { checkManifest } from "../abi/validate.js";
import { FakeHost, asDom, fakeProgram, minimalSceneInit, MANIFEST_URL } from "../test-support/fake-host.js";
import { installProgram } from "../test-support/mount-fixture.js";
import { loadGoldenProgram } from "../test-support/program.js";
import { mountMtekWith } from "./mount.js";
import type { MtekMountOptions } from "./types.js";

interface Context { s: { quantity: number; total: number } }
function setup() {
  const host = new FakeHost();
  const json = installProgram(host, (json) => {
    const scene = json["scene"] as Record<string, unknown>;
    scene["state"] = ["quantity", "total"].map((name) => ({ name, type: "f32", symbol: `src/main.mtek::Demo.${name}` }));
    scene["hostInputs"] = [{ name: "quantity", type: "f32", codec: "f32", target: { kind: "state", name: "quantity" } }];
    scene["hostOutputs"] = ["quantity", "total"].map((name) => ({ name, type: "f32", source: { kind: "state", name } }));
  });
  const parsed = checkManifest(json);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.failures));
  const manifest = parsed.manifest;
  const base = fakeProgram((ctx) => {
    minimalSceneInit(ctx);
    const state = (ctx as Context).s;
    state.quantity = 1; state.total = 10;
  }, manifest);
  const scene = (base.scenes as Record<string, MtekProgramScene>)[manifest.entryScene]!;
  const program = { ...base, scenes: { [manifest.entryScene]: {
    ...scene,
    update: (ctx: object) => { const state = (ctx as Context).s; state.total = state.quantity * 10; },
    events: { key_down: [{ key: "Space", owner: -1, fn: (ctx: object) => { (ctx as Context).s.quantity += 1; } }] },
  } } };
  const mount = (options: MtekMountOptions = {}) => mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), program, options);
  return { host, json, manifest, program, mount };
}

const manual: MtekMountOptions = { test: { manualClock: true, renderTarget: { width: 8, height: 8 } } };

describe("mounted host outputs", () => {
  it("works in production without debug and emits only after input, update and render", async () => {
    const { host, mount } = setup();
    const app = await mount();
    expect(app.debug).toBeUndefined();
    const observed: unknown[] = [];
    app.onOutput("total", (value) => { observed.push([value, host.device.queue.submits]); });
    app.setInput("quantity", 2); app.setInput("quantity", 3);
    expect(observed).toEqual([]);
    host.tickFrames(1000);
    host.tickFrames(1016);
    expect(observed).toEqual([[30, 1]]);
    app.dispose();
  });

  it("reports final handler-derived state once per frame and queues feedback for the next frame", async () => {
    const { mount } = setup();
    const app = await mount(manual);
    const observed: unknown[] = [];
    app.onOutput("total", (value) => { observed.push(value); if (value === 20) app.setInput("quantity", 5); });
    app.debug!.pressKey("Space");
    app.debug!.step(1, 0);
    expect(observed).toEqual([20]);
    expect(app.debug!.scene().state["quantity"]).toBe(2);
    app.debug!.step(1, 0);
    expect(observed).toEqual([20, 50]);
    app.dispose();
  });

  it("pauses publication, releases subscriptions on disposal/failure, and isolates listener errors", async () => {
    const { mount } = setup();
    const app = await mount(manual);
    const listener = vi.fn();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    app.onOutput("total", () => { throw new Error("host error"); });
    const stop = app.onOutput("total", listener);
    app.pause(); app.debug!.step(1, 0);
    expect(listener).not.toHaveBeenCalled();
    app.resume(); app.debug!.step(1, 0);
    expect(listener).toHaveBeenCalledExactlyOnceWith(10);
    expect(app.state).toBe("running");
    expect(error).toHaveBeenCalledOnce();
    app.debug!.failAllocation();
    expect(app.state).toBe("failed");
    expect(() => app.onOutput("total", listener)).toThrow(/failed/);
    stop(); app.dispose(); app.debug!.step(1, 0);
    expect(listener).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("validates source references, declared types and duplicate output names before mounting", async () => {
    for (const change of [
      (m: MtekManifest) => ({ ...m.scene.hostOutputs![0]!, source: { kind: "state", name: "missing" } }),
      (m: MtekManifest) => ({ ...m.scene.hostOutputs![0]!, type: "string" }),
      (m: MtekManifest) => m.scene.hostOutputs![0]!,
    ]) {
      const { host, manifest, mount } = setup();
      const invalid = { ...manifest, scene: { ...manifest.scene, hostOutputs: [...manifest.scene.hostOutputs!, change(manifest)] } };
      host.files.set(MANIFEST_URL, JSON.stringify(invalid));
      await expect(mount(manual)).rejects.toMatchObject({ kind: "manifest-invalid" });
      expect(host.pendingFrames).toBe(0);
    }
  });

  it("preserves listeners through a successful hot replacement and leaves them unchanged for a rejected candidate", async () => {
    const { host, json, program, mount } = setup();
    const app = await mount(manual);
    const listener = vi.fn(); app.onOutput("total", listener);
    app.debug!.step(1, 0);
    host.files.set(MANIFEST_URL, "{}");
    expect((await app.replaceProgram!(program)).ok).toBe(false);
    app.setInput("quantity", 2); app.debug!.step(1, 0);
    expect(listener.mock.calls).toEqual([[10], [20]]);
    host.files.set(MANIFEST_URL, JSON.stringify(json));
    expect(await app.replaceProgram!(program)).toEqual({ ok: true });
    app.debug!.step(1, 0);
    expect(listener.mock.calls).toEqual([[10], [20], [20]]);
    app.dispose();
  });

  it("keeps subscriptions across GPU recovery without emitting a duplicate or resetting CPU state", async () => {
    const { host, mount } = setup();
    const app = await mount(manual);
    const listener = vi.fn(); app.onOutput("total", listener);
    app.setInput("quantity", 3); app.debug!.step(1, 0);
    const until = async (condition: () => boolean): Promise<void> => {
      for (let i = 0; i < 100; i += 1) {
        if (condition()) return;
        await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
      }
      throw new Error("recovery did not settle");
    };
    host.latestDevice.loseDevice("unknown", "test loss");
    await until(() => app.state === "recovering");
    app.debug!.step(1, 0);
    expect(listener.mock.calls).toEqual([[30]]);
    expect(host.timers.runNext()).toBe(true);
    await until(() => app.state === "running");
    app.debug!.step(1, 0);
    expect(listener.mock.calls).toEqual([[30]]);
    app.setInput("quantity", 4); app.debug!.step(1, 0);
    expect(listener.mock.calls).toEqual([[30], [40]]);
    app.dispose();
  });

  it("observes a real compiled binding only after its transform has settled", async () => {
    const golden = await loadGoldenProgram("bindings");
    const host = new FakeHost();
    for (const [url, text] of golden.files) host.files.set(url, text);
    const manifest = { ...golden.manifest, scene: { ...golden.manifest.scene,
      hostInputs: [{ name: "speed", type: "f32", codec: "f32", target: { kind: "state", name: "speed" } }],
      hostOutputs: [{ name: "speed", type: "f32", source: { kind: "state", name: "speed" } }],
    } };
    host.files.set(golden.program.manifestUrl.href, JSON.stringify(manifest));
    const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), golden.program, manual);
    const seen: unknown[] = [];
    app.onOutput("speed", (value) => { seen.push([value, app.debug!.scene().entities.find((e) => e.name === "Mover")!.position]); });
    app.setInput("speed", 4);
    app.debug!.step(1, 0.1);
    expect(seen).toEqual([[4, { x: Math.fround(Math.fround(0.1) * 4), y: 0, z: 0 }]]);
    app.dispose();
  });
});
