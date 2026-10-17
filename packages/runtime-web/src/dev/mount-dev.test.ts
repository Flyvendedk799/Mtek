/**
 * The development overlay and GPU timing as `mountMtek` wires them (decision 0055), on the fake host.
 * These run as the development flavour of the runtime (`vitest.config.ts`); that the release flavour has
 * none of this code is checked on the real bundle by `src/release-bundle.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { mountMtekWith } from "../host/mount.js";
import type { MtekApp, MtekDebug, MtekMountOptions } from "../host/types.js";
import { FakeHost, asDom, fakeProgram, minimalSceneInit, type FakeElement, type InitContext } from "../test-support/fake-host.js";
import { installProgram, mountOn } from "../test-support/mount-fixture.js";
import { DEV_OVERLAY_ATTRIBUTE } from "./overlay.js";

const TEST = { manualClock: true, renderTarget: { width: 16, height: 8 } } as const;

async function mount(
  hostOptions: ConstructorParameters<typeof FakeHost>[0],
  options: MtekMountOptions = {},
): Promise<{ host: FakeHost; app: MtekApp; debug: MtekDebug }> {
  const host = new FakeHost(hostOptions);
  installProgram(host);
  const app = await mountOn(host, { test: TEST, ...options });
  if (app.debug === undefined) throw new Error("no debug API");
  return { host, app, debug: app.debug };
}

function panel(host: FakeHost): FakeElement | undefined {
  return host.canvas.parentElement?.find(DEV_OVERLAY_ATTRIBUTE) ?? host.document.body.find(DEV_OVERLAY_ATTRIBUTE);
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));
const WITH_TIMESTAMPS = { adapter: { features: ["timestamp-query"] } } as const;

describe("a development runtime without options.devOverlay", () => {
  it("shows no panel, adds no listener and measures no GPU time, but requests timestamp-query when the adapter has it", async () => {
    const { host, app, debug } = await mount(WITH_TIMESTAMPS);
    const baseline = host.document.listenerCount;
    debug.step(2, 0.016);
    expect(panel(host)).toBeUndefined();
    expect(host.device.features.has("timestamp-query")).toBe(true);
    expect(host.device.querySets).toHaveLength(0);
    const counters = debug.counters();
    expect(counters["gpuTimeAvailable"]).toBe(0);
    expect("gpuTimeMs" in counters).toBe(false);
    expect(host.document.listenerCount).toBe(baseline);
    app.dispose();
  });

  it("does not ask the device for timestamp-query when the adapter lacks it", async () => {
    const { host, app } = await mount({});
    expect(host.device.features.has("timestamp-query")).toBe(false);
    app.dispose();
  });
});

describe("options.devOverlay", () => {
  it("shows the panel after the first frame, with this frame's counters and 'GPU time unavailable' without the feature", async () => {
    const { host, app, debug } = await mount({}, { devOverlay: true });
    expect(panel(host)).toBeUndefined();
    debug.step(1, 0.016);
    const text = panel(host)?.textContent ?? "";
    expect(text).toContain("scene: Demo");
    expect(text).toMatch(/entity: .* \(1\/1\) src\/main\.mtek:\d+/);
    expect(text).toContain("draw calls: 1  instanced draws: 0  culled objects: 0");
    expect(text).toContain("GPU time unavailable");
    expect(text).toContain("errors: none");
    expect(host.device.querySets).toHaveLength(0);
    expect(debug.counters()["gpuTimeAvailable"]).toBe(0);
    app.dispose();
  });

  it("frame time comes from the host clock (performance.now), with p50 and p95 over the frames so far", async () => {
    const { host, app, debug } = await mount({}, { devOverlay: true });
    debug.step(3, 0.016);
    const text = panel(host)?.textContent ?? "";
    // The fake clock advances 0.25 ms per read; every frame reads it twice (start of frame, end of render prep)
    // plus the render start, so each frame is a whole number of quarter milliseconds.
    expect(text).toMatch(/frame time: \d+\.\d\d ms {2}p50 \d+\.\d\d {2}p95 \d+\.\d\d {2}\(last 3 frames\)/);
    expect(debug.counters()["frameTimeMs"]).toBeGreaterThan(0);
    app.dispose();
  });

  it("measures GPU time with timestamp-query and shows it; the counters carry the value", async () => {
    const { host, app, debug } = await mount(WITH_TIMESTAMPS, { devOverlay: true });
    expect(host.device.querySets).toHaveLength(1);
    debug.step(1, 0.016);
    // Before the mapping completes the value is pending, not zero and not a CPU time.
    expect(panel(host)?.textContent).toContain("GPU time: pending");
    expect(debug.counters()["gpuTimeAvailable"]).toBe(0);
    await settle();
    // The fake device resolves (3_500_000 - 1_000_000) ns = 2.5 ms.
    expect(debug.counters()).toMatchObject({ gpuTimeAvailable: 1, gpuTimeMs: 2.5 });
    debug.step(1, 0.016);
    expect(panel(host)?.textContent).toContain("GPU time: 2.50 ms");
    app.dispose();
  });

  it("the backquote key toggles the panel and Shift+backquote cycles entities, through the registry's listener", async () => {
    const { host, app, debug } = await mount({}, { devOverlay: true });
    debug.step(1, 0.016);
    const press = (shiftKey: boolean): void => {
      host.document.dispatch("keydown", { code: "Backquote", shiftKey, ctrlKey: false, altKey: false, metaKey: false });
    };
    press(false);
    expect(panel(host)?.style["display"]).toBe("none");
    press(false);
    expect(panel(host)?.style["display"]).toBe("block");
    press(true);
    expect(panel(host)?.textContent).toMatch(/entity: .* \(1\/1\)/);
    app.dispose();
  });

  it("lists the latest error diagnostics", async () => {
    const host = new FakeHost();
    installProgram(host);
    // A scale of 0 is invalid: E8090, reported once the application exists.
    const program = fakeProgram((context) => {
      minimalSceneInit(context);
      const ctx = context as InitContext;
      ctx.setTransform(ctx.e[0], "scale", { x: 0, y: 1, z: 1 });
    });
    const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), program, { test: TEST, devOverlay: true });
    app.debug?.step(1, 0.016);
    expect(panel(host)?.textContent).toMatch(/errors: 1\n {2}MTEK-E8090: The scale/);
    app.dispose();
  });

  it("never changes the pixels of a frame: the panel is DOM, not drawn into the canvas", async () => {
    const plain = await mount({});
    plain.debug.step(2, 0.016);
    const before = await plain.debug.readPixels();
    plain.app.dispose();

    const withPanel = await mount(WITH_TIMESTAMPS, { devOverlay: true });
    withPanel.debug.step(2, 0.016);
    const after = await withPanel.debug.readPixels();
    withPanel.app.dispose();

    expect(after.width).toBe(before.width);
    expect(Array.from(after.data)).toEqual(Array.from(before.data));
  });

  it("dispose removes the panel and the key listener and destroys the GPU timer", async () => {
    const { host, app, debug } = await mount(WITH_TIMESTAMPS, { devOverlay: true });
    debug.step(1, 0.016);
    expect(panel(host)).toBeDefined();
    app.dispose();
    expect(panel(host)).toBeUndefined();
    expect(host.document.listenerCount).toBe(0);
    expect(host.device.querySets[0]?.destroyed).toBe(true);
  });

  it("does not leak across 20 mount and dispose cycles", async () => {
    for (let i = 0; i < 20; i += 1) {
      const { host, app, debug } = await mount(WITH_TIMESTAMPS, { devOverlay: true });
      debug.step(1, 0.016);
      app.dispose();
      expect(host.document.listenerCount).toBe(0);
      expect(host.device.buffers.every((b) => b.destroyed)).toBe(true);
    }
  });
});
