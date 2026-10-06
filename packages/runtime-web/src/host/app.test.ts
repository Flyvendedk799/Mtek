import { describe, expect, it } from "vitest";
import type { MtekDiagnostic } from "../diagnostics/types.js";
import { FakeHost, type FakeHostDevice } from "../test-support/fake-host.js";
import { healthyHost, installProgram, mountOn } from "../test-support/mount-fixture.js";
import type { MtekApp } from "./types.js";

function overlayOf(host: FakeHost): ReturnType<FakeHost["document"]["body"]["find"]> {
  return host.document.body.find("data-mtek-overlay");
}

/** The numeric live counters of spec/runtime-abi.md section 10.1. */
const LIVE_COUNTERS = [
  "liveBuffers",
  "liveTextures",
  "liveSamplers",
  "liveShaderModules",
  "livePipelines",
  "liveBindGroups",
  "liveListeners",
] as const;

function debugOf<I>(app: MtekApp<I>): NonNullable<MtekApp<I>["debug"]> {
  if (app.debug === undefined) throw new Error("the app has no debug API (options.test missing)");
  return app.debug;
}

async function mountManual<I = Record<string, unknown>>(
  host: FakeHost,
  extra: { width?: number; height?: number } = {},
): Promise<MtekApp<I>> {
  return mountOn<I>(host, { test: { manualClock: true, renderTarget: { width: extra.width ?? 16, height: extra.height ?? 8 } } });
}

describe("lifecycle: pause, resume and the paused interval", () => {
  it("renders on every animation frame while running and never when paused", async () => {
    const host = healthyHost();
    const app = await mountOn(host);
    expect(host.pendingFrames).toBe(1);
    host.tickFrames(1000);
    host.tickFrames(1016);
    expect(host.device.queue.submits).toBe(2);

    app.pause();
    expect(app.state).toBe("paused");
    expect(host.pendingFrames).toBe(0); // the pending frame request was cancelled
    host.tickFrames(1032);
    expect(host.device.queue.submits).toBe(2);

    app.resume();
    expect(app.state).toBe("running");
    expect(host.pendingFrames).toBe(1);
    app.dispose();
  });

  it("never simulates the paused interval: the first frame after resume has delta 0", async () => {
    const host = healthyHost();
    const app = await mountOn(host, { test: { renderTarget: { width: 8, height: 8 } } });
    host.tickFrames(1000); // first frame: delta 0
    host.tickFrames(1016); // delta 0.016
    const before = debugOf(app).counters();
    app.pause();
    app.resume();
    host.tickFrames(61_000); // a minute later: lastMs was reset by resume
    host.tickFrames(61_016);
    // Only the 16 ms of the frame after the first post-resume frame count. Observe it through discardedSteps:
    // a 60 s delta (clamped to 0.1 s) would have discarded fixed steps.
    expect(debugOf(app).counters()["discardedSteps"]).toBe(before["discardedSteps"]);
    app.dispose();
  });

  it("a delta above maxFrameDelta is clamped and its surplus fixed steps are counted as discarded", async () => {
    const host = healthyHost();
    const app = await mountManual(host);
    // The 10 s delta is clamped to maxFrameDelta 0.1 s = 5.99999 fixed steps of 0.016666668 s: 4 run, 1 is discarded.
    debugOf(app).step(1, 10);
    expect(debugOf(app).counters()["discardedSteps"]).toBe(1);
    expect(debugOf(app).counters()["framesRendered"]).toBe(1);
    app.dispose();
  });

  it("pause, resume and dispose are ignored in states where they do not apply", async () => {
    const host = healthyHost();
    const app = await mountOn(host);
    app.resume(); // already running
    expect(app.state).toBe("running");
    app.pause();
    app.pause();
    expect(app.state).toBe("paused");
    app.dispose();
    app.pause();
    app.resume();
    expect(app.state).toBe("disposed");
    expect(host.pendingFrames).toBe(0);
  });

  it("pauses when the page becomes hidden and resumes when visible again (pauseWhenHidden)", async () => {
    const host = healthyHost();
    const app = await mountOn(host);
    host.document.setVisibility("hidden");
    expect(app.state).toBe("paused");
    expect(host.pendingFrames).toBe(0);
    host.document.setVisibility("visible");
    expect(app.state).toBe("running");
    expect(host.pendingFrames).toBe(1);
    app.dispose();
  });

  it("does not override a pause requested by the host when the page becomes visible", async () => {
    const host = healthyHost();
    const app = await mountOn(host);
    app.pause();
    host.document.setVisibility("hidden");
    host.document.setVisibility("visible");
    expect(app.state).toBe("paused");
    app.resume();
    expect(app.state).toBe("running");
    app.dispose();
  });

  it("ignores visibility changes with pauseWhenHidden: false", async () => {
    const host = healthyHost();
    const app = await mountOn(host, { pauseWhenHidden: false });
    host.document.setVisibility("hidden");
    expect(app.state).toBe("running");
    app.dispose();
  });
});

describe("dispose", () => {
  function assertReleased(host: FakeHost, app: MtekApp): void {
    expect(app.state).toBe("disposed");
    const device: FakeHostDevice = host.device;
    expect(device.destroyed).toBe(true);
    expect(device.textures.every((t) => t.destroyed)).toBe(true);
    expect(device.buffers.every((b) => b.destroyed)).toBe(true);
    expect(host.pendingFrames).toBe(0);
    expect(host.document.listenerCount).toBe(0);
    expect(host.resizeObservers.every((o) => o.disconnected)).toBe(true);
    expect(host.context.configuration).toBeNull();
    expect(overlayOf(host)).toBeUndefined();
  }

  it("releases everything: live counts 0, no listener, no observer, overlay gone (50 mount/dispose cycles)", async () => {
    const host = healthyHost();
    for (let cycle = 0; cycle < 50; cycle += 1) {
      const app = await mountOn(host, { test: { manualClock: true, renderTarget: { width: 8, height: 8 } } });
      const debug = debugOf(app);
      debug.step(3, 0.016);
      await debug.readPixels();
      // Alive while mounted.
      expect(debug.counters()["liveTextures"]).toBeGreaterThan(0);
      expect(host.document.listenerCount).toBe(1);
      app.dispose();

      const counters = debug.counters();
      for (const name of LIVE_COUNTERS) expect(counters[name], `${name} after cycle ${String(cycle)}`).toBe(0);
      const device = host.adapter?.hostDevices[cycle];
      expect(device?.destroyed).toBe(true);
      expect(host.document.listenerCount).toBe(0);
      expect(host.pendingFrames).toBe(0);
      expect(host.resizeObservers[cycle]?.disconnected).toBe(true);
    }
    expect(host.adapter?.hostDevices).toHaveLength(50);
    // Every texture and buffer of every cycle was destroyed by the runtime itself.
    for (const device of host.adapter?.hostDevices ?? []) {
      expect(device.textures.every((t) => t.destroyed)).toBe(true);
      expect(device.buffers.every((b) => b.destroyed)).toBe(true);
    }
  });

  it("is synchronous: everything is released when dispose() returns", async () => {
    const host = healthyHost();
    const app = await mountOn(host);
    host.tickFrames(1000);
    app.dispose();
    assertReleased(host, app);
  });

  it("is idempotent and does not report the device loss it causes", async () => {
    const host = healthyHost();
    const seen: MtekDiagnostic[] = [];
    const app = await mountOn(host, { onDiagnostic: (d) => seen.push(d) });
    app.dispose();
    app.dispose();
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual([]);
    expect(app.state).toBe("disposed");
  });

  it("stops a pending animation frame from rendering after dispose", async () => {
    const host = healthyHost();
    const app = await mountOn(host);
    host.tickFrames(1000);
    const submits = host.device.queue.submits;
    app.dispose();
    host.tickFrames(1016);
    expect(host.device.queue.submits).toBe(submits);
  });

  it("removes the overlay a runtime error produced", async () => {
    const host = healthyHost();
    const app = await mountOn(host);
    host.device.raiseValidation("boom");
    expect(overlayOf(host)).toBeDefined();
    app.dispose();
    expect(overlayOf(host)).toBeUndefined();
  });

  it("rejects readPixels after dispose", async () => {
    const host = healthyHost();
    const app = await mountManual(host);
    const debug = debugOf(app);
    app.dispose();
    await expect(debug.readPixels()).rejects.toThrow(/disposed/);
  });
});

describe("runtime failures", () => {
  it("device loss reports W8060, sets state failed, shows the overlay and stops the loop (no recovery before M4-09)", async () => {
    const host = healthyHost();
    const seen: MtekDiagnostic[] = [];
    const app = await mountOn(host, { onDiagnostic: (d) => seen.push(d) });
    host.tickFrames(1000);
    host.device.loseDevice("unknown", "the GPU process crashed");
    await Promise.resolve();
    await Promise.resolve();

    expect(app.state).toBe("failed");
    expect(seen.map((d) => d.code)).toEqual(["MTEK-W8060"]);
    expect(seen[0]?.phase).toBe("runtime:device");
    expect(seen[0]?.severity).toBe("warning");
    expect(seen[0]?.message).toContain("the GPU process crashed");
    expect(seen[0]?.notes.join(" ")).toContain("M4-09");
    const overlay = overlayOf(host);
    expect(overlay?.getAttribute("role")).toBe("alert");
    expect(overlay?.textContent).toContain("MTEK-W8060");
    expect(host.pendingFrames).toBe(0);

    // Still disposable.
    app.dispose();
    expect(app.state).toBe("disposed");
    expect(overlayOf(host)).toBeUndefined();
  });

  it("device loss with failureDisplay 'none' reports but shows no overlay", async () => {
    const host = healthyHost();
    const seen: MtekDiagnostic[] = [];
    const app = await mountOn(host, { failureDisplay: "none", onDiagnostic: (d) => seen.push(d) });
    host.device.loseDevice("unknown", "gone");
    await Promise.resolve();
    await Promise.resolve();
    expect(app.state).toBe("failed");
    expect(seen).toHaveLength(1);
    expect(overlayOf(host)).toBeUndefined();
    app.dispose();
  });

  it("an uncaptured GPU error is reported as E8050 once per message and shown, but does not stop the app", async () => {
    const host = healthyHost();
    const seen: MtekDiagnostic[] = [];
    const app = await mountOn(host, { onDiagnostic: (d) => seen.push(d) });
    host.device.raiseValidation("bind group layout mismatch");
    host.device.raiseValidation("bind group layout mismatch");
    host.device.raiseValidation("another problem");
    expect(app.state).toBe("running");
    expect(seen.map((d) => d.code)).toEqual(["MTEK-E8050", "MTEK-E8050"]);
    expect(seen[0]?.message).toContain("bind group layout mismatch");
    expect(overlayOf(host)?.textContent).toContain("MTEK-E8050");
    app.dispose();
  });

  it("a frame that throws stops the loop with E8050 and the overlay", async () => {
    const host = healthyHost();
    const seen: MtekDiagnostic[] = [];
    const app = await mountOn(host, { onDiagnostic: (d) => seen.push(d) });
    host.tickFrames(1000);
    host.device.createCommandEncoder = (): never => {
      throw new Error("encoder exploded");
    };
    host.tickFrames(1016);
    expect(app.state).toBe("failed");
    expect(seen.map((d) => d.code)).toEqual(["MTEK-E8050"]);
    expect(seen[0]?.message).toContain("encoder exploded");
    expect(overlayOf(host)).toBeDefined();
    expect(host.pendingFrames).toBe(0);
    app.dispose();
  });

  it("an out-of-memory allocation after mount reports E8063, fails the app and shows the overlay", async () => {
    const host = healthyHost();
    const seen: MtekDiagnostic[] = [];
    const app = await mountOn(host, { onDiagnostic: (d) => seen.push(d) });
    // The depth texture recreated by a resize is the only allocation of an M1 frame loop.
    host.device.failNextAllocations(1);
    host.canvas.clientWidth = 300;
    host.resizeObservers[0]?.trigger();
    await new Promise((resolve) => setTimeout(resolve, 0)); // the error scope resolves asynchronously
    expect(app.state).toBe("failed");
    expect(seen.map((d) => d.code)).toEqual(["MTEK-E8063"]);
    expect(overlayOf(host)?.textContent).toContain("MTEK-E8063");
    expect(host.pendingFrames).toBe(0);
    app.dispose();
  });
});

describe("setInput", () => {
  it("never throws and answers MTEK-E8040 for an undeclared key", async () => {
    const host = healthyHost();
    const app = await mountOn<{ tint: string }>(host);
    const result = app.setInput("tint", "#ff0000");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("MTEK-E8040");
      expect(result.error.message).toContain("'tint'");
    }
    app.dispose();
  });

  it("queues a valid value and applies it only at the next frame boundary", async () => {
    const host = new FakeHost();
    installProgram(host, (manifest) => {
      const scene = manifest["scene"] as Record<string, unknown>;
      scene["state"] = [{ name: "speed", type: "f32", symbol: "src/main.mtek::Demo.speed" }];
      scene["hostInputs"] = [
        { name: "speed", target: { kind: "state", name: "speed" }, type: "f32", codec: "f32" },
      ];
    });
    const app = await mountManual<{ speed: number }>(host);
    expect(debugOf(app).scene().state["speed"]).toBe(0);
    const result = app.setInput("speed", 2.5);
    expect(result).toEqual({ ok: true });
    expect(debugOf(app).scene().state["speed"]).toBe(0);
    debugOf(app).step(1, 0.016);
    expect(debugOf(app).scene().state["speed"]).toBe(Math.fround(2.5));
    app.dispose();
  });
});

describe("debug API (options.test)", () => {
  it("is present only when options.test is set", async () => {
    const host = healthyHost();
    const plain = await mountOn(host);
    expect(plain.debug).toBeUndefined();
    plain.dispose();
    const test = await mountOn(host, { test: {} });
    expect(test.debug).toBeDefined();
    test.dispose();
  });

  it("step runs frames synchronously with the manual clock, rendering included", async () => {
    const host = healthyHost();
    const app = await mountManual(host);
    expect(host.pendingFrames).toBe(0); // no requestAnimationFrame with the manual clock
    debugOf(app).step(5, 0.016);
    expect(host.device.queue.submits).toBe(5);
    expect(debugOf(app).counters()["framesRendered"]).toBe(5);
    expect(host.pendingFrames).toBe(0);
    app.dispose();
  });

  it("step is rejected without manualClock, and with invalid arguments", async () => {
    const host = healthyHost();
    const app = await mountOn(host, { test: { renderTarget: { width: 8, height: 8 } } });
    expect(() => debugOf(app).step(1, 0.016)).toThrow(/manualClock/);
    app.dispose();

    const manual = await mountManual(host);
    expect(() => debugOf(manual).step(-1, 0.016)).toThrow(RangeError);
    expect(() => debugOf(manual).step(1, Number.NaN)).toThrow(RangeError);
    manual.dispose();
  });

  it("step does nothing while paused (the paused interval is never simulated)", async () => {
    const host = healthyHost();
    const app = await mountManual(host);
    app.pause();
    debugOf(app).step(3, 0.016);
    expect(host.device.queue.submits).toBe(0);
    app.resume();
    debugOf(app).step(1, 0.016);
    expect(host.device.queue.submits).toBe(1);
    app.dispose();
  });

  it("readPixels returns tightly packed rows of the sRGB-encoded clear colour (rows are 256-padded on the GPU side)", async () => {
    const host = healthyHost();
    // 50 px * 4 = 200 bytes per row, padded to 256 for the copy.
    const app = await mountManual(host, { width: 50, height: 3 });
    debugOf(app).step(1, 0.016);
    const liveBuffers = debugOf(app).counters()["liveBuffers"];
    const pixels = await debugOf(app).readPixels();
    expect(pixels.format).toBe("rgba8unorm-srgb");
    expect([pixels.width, pixels.height]).toEqual([50, 3]);
    expect(pixels.data).toHaveLength(50 * 3 * 4);
    // Clear colour of the minimal manifest scene (linear), encoded to sRGB by the -srgb view.
    const encode = (c: number): number => Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255);
    const expected = [encode(0.0052), encode(0.007), encode(0.0091), 255];
    for (let pixel = 0; pixel < 50 * 3; pixel += 1) {
      expect(Array.from(pixels.data.subarray(pixel * 4, pixel * 4 + 4)), `pixel ${String(pixel)}`).toEqual(expected);
    }
    // The staging buffer was released again.
    expect(debugOf(app).counters()["liveBuffers"]).toBe(liveBuffers);
    app.dispose();
  });

  it("readPixels reads back the render target, not the canvas, and needs renderTarget", async () => {
    const noTargetHost = healthyHost();
    const noTarget = await mountOn(noTargetHost, { test: { manualClock: true } });
    await expect(debugOf(noTarget).readPixels()).rejects.toThrow(/renderTarget/);
    noTarget.dispose();

    const host = healthyHost();
    const app = await mountManual(host);
    debugOf(app).step(1, 0.016);
    expect(host.context.currentTextureCalls).toBe(0);
    expect(host.device.renderPasses.at(-1)?.viewFormat).toBe("rgba8unorm-srgb");
    app.dispose();
  });

  it("renders into the canvas through the -srgb view of the preferred format without a render target", async () => {
    for (const preferred of ["bgra8unorm", "rgba8unorm"]) {
      const host = new FakeHost({ gpu: { preferredFormat: preferred } });
      host.files.clear();
      const healthy = healthyHost();
      for (const [url, file] of healthy.files) host.files.set(url, file);
      const app = await mountOn(host, { test: { manualClock: true } });
      debugOf(app).step(1, 0.016);
      expect(host.context.currentTextureCalls).toBe(1);
      expect(host.device.renderPasses.at(-1)?.viewFormat).toBe(`${preferred}-srgb`);
      app.dispose();
    }
  });

  it("counters carry the section 10.1 names, registry values and frame values", async () => {
    const host = healthyHost();
    const app = await mountManual(host);
    debugOf(app).step(2, 0.016);
    const counters = debugOf(app).counters();
    for (const name of [
      "frameTimeMs",
      "cpuUpdateMs",
      "renderPrepMs",
      "drawCalls",
      "instancedDraws",
      "culledObjects",
      "uploads",
      "uploadBytes",
      "pipelinesCreated",
      "shaderModulesCreated",
      "bindGroupsCreated",
      "buffersAllocated",
      "texturesAllocated",
      "liveBuffers",
      "liveTextures",
      "liveSamplers",
      "liveShaderModules",
      "livePipelines",
      "liveBindGroups",
      "liveListeners",
      "sharedParamBlocks",
      "ownedParamBlocks",
      "discardedSteps",
      "liveEntities",
    ]) {
      expect(counters, name).toHaveProperty(name);
    }
    expect(counters["shaderModulesCreated"]).toBe(1);
    expect(counters["liveShaderModules"]).toBe(1);
    expect(counters["liveEntities"]).toBe(1);
    expect(counters["frameTimeMs"]).toBeGreaterThan(0);
    // render target + depth
    expect(counters["liveTextures"]).toBe(2);
    expect(counters["liveListeners"]).toBe(1); // the visibilitychange listener
    app.dispose();
  });

  it("scene() lists the entities by manifest name with the transforms init set; state is empty before M3", async () => {
    const host = healthyHost();
    const app = await mountManual(host);
    expect(debugOf(app).scene()).toEqual({
      state: {},
      entities: [{ name: "Cube", position: { x: 0, y: 0.5, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } }],
    });
    app.dispose();
  });

  it("pressKey, releaseKey and setParam say plainly that they arrive later", async () => {
    const host = healthyHost();
    const app = await mountManual(host);
    expect(() => debugOf(app).pressKey("Space")).toThrow(/M3/);
    expect(() => debugOf(app).releaseKey("Space")).toThrow(/M3/);
    expect(() => debugOf(app).setParam("Cube", "tint", 1)).toThrow(/M3/);
    app.dispose();
  });
});

describe("resize and zero-sized canvases", () => {
  it("recomputes the backing size on ResizeObserver callbacks and observes the canvas", async () => {
    const host = healthyHost();
    const app = await mountOn(host);
    expect(host.resizeObservers).toHaveLength(1);
    expect(host.resizeObservers[0]?.targets.has(host.canvas)).toBe(true);

    host.canvas.clientWidth = 640;
    host.canvas.clientHeight = 360;
    host.devicePixelRatio = 2;
    host.resizeObservers[0]?.trigger();
    expect([host.canvas.width, host.canvas.height]).toEqual([1280, 720]);
    app.dispose();
  });

  it("recreates the depth texture on a size change and releases the old one through the registry", async () => {
    const onCanvas = healthyHost();
    const canvasApp = await mountOn(onCanvas, { test: { manualClock: true } });
    const depthBefore = onCanvas.device.textures.filter((t) => t.format === "depth24plus");
    expect(depthBefore).toHaveLength(1);
    expect(debugOf(canvasApp).counters()["liveTextures"]).toBe(1);

    onCanvas.canvas.clientWidth = 500;
    onCanvas.canvas.clientHeight = 250;
    onCanvas.resizeObservers[0]?.trigger();
    const depth = onCanvas.device.textures.filter((t) => t.format === "depth24plus");
    expect(depth).toHaveLength(2);
    expect(depth[0]?.destroyed).toBe(true);
    expect(depth[1]?.destroyed).toBe(false);
    expect([depth[1]?.width, depth[1]?.height]).toEqual([500, 250]);
    // Old one released, new one live: the live count did not grow.
    expect(debugOf(canvasApp).counters()["liveTextures"]).toBe(1);

    // A callback without a size change creates nothing.
    onCanvas.resizeObservers[0]?.trigger();
    expect(onCanvas.device.textures.filter((t) => t.format === "depth24plus")).toHaveLength(2);
    canvasApp.dispose();
  });

  it("skips rendering for a zero-sized canvas (not an error), keeps simulating, and renders again when sized", async () => {
    const host = healthyHost();
    const seen: MtekDiagnostic[] = [];
    const app = await mountOn(host, { test: { manualClock: true }, onDiagnostic: (d) => seen.push(d) });
    debugOf(app).step(1, 0.016);
    expect(host.device.queue.submits).toBe(1);

    host.canvas.clientWidth = 0;
    host.resizeObservers[0]?.trigger();
    expect(host.canvas.width).toBe(0);
    debugOf(app).step(3, 0.016);
    expect(host.device.queue.submits).toBe(1); // nothing was drawn
    expect(debugOf(app).counters()["framesSkipped"]).toBe(3);
    expect(app.state).toBe("running");
    expect(seen).toEqual([]);
    expect(overlayOf(host)).toBeUndefined();

    host.canvas.clientWidth = 100;
    host.resizeObservers[0]?.trigger();
    debugOf(app).step(1, 0.016);
    expect(host.device.queue.submits).toBe(2);
    app.dispose();
  });

  it("mounts on a zero-sized canvas without error", async () => {
    const host = healthyHost();
    host.canvas.clientWidth = 0;
    host.canvas.clientHeight = 0;
    const app = await mountOn(host, { test: { manualClock: true } });
    debugOf(app).step(2, 0.016);
    expect(host.device.queue.submits).toBe(0);
    expect(debugOf(app).counters()["framesSkipped"]).toBe(2);
    app.dispose();
  });

  it("clamps the backing size to maxTextureDimension2D", async () => {
    const host = healthyHost();
    host.canvas.clientWidth = 100_000;
    const app = await mountOn(host);
    expect(host.canvas.width).toBe(8192);
    app.dispose();
  });

  it("works in a browser without ResizeObserver (size is read once at mount)", async () => {
    const host = new FakeHost({ resizeObserver: false });
    const healthy = healthyHost();
    for (const [url, file] of healthy.files) host.files.set(url, file);
    const app = await mountOn(host);
    expect(host.canvas.width).toBe(200);
    app.dispose();
  });

  it("ignores a resize after the app failed or was disposed", async () => {
    const host = healthyHost();
    const app = await mountOn(host);
    const observer = host.resizeObservers[0];
    app.dispose();
    host.canvas.clientWidth = 999;
    observer?.trigger();
    expect(host.canvas.width).toBe(200);
  });
});
