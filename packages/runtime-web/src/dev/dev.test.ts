/**
 * The development tools (`src/dev/`, decision 0055): frame statistics, the panel text, the overlay element
 * and its keys, and the GPU timer. Expected values are worked out by hand in each test.
 */
import { describe, expect, it } from "vitest";
import { makeRuntimeDiagnostic } from "../diagnostics/types.js";
import type { ResourceRegistry } from "../gpu/registry.js";
import { FakeBuffer } from "../test-support/fake-gpu.js";
import { FakeCanvas, FakeDocument, FakeElement, asDom } from "../test-support/fake-host.js";
import { FRAME_WINDOW, FrameStats, nearestRank } from "./frame-stats.js";
import { GpuTimer, hasTimestampQuery, type TimerDevice } from "./gpu-timer.js";
import { DEV_OVERLAY_ATTRIBUTE, DevOverlay } from "./overlay.js";
import { PANEL_KEYS_HELP, panelLines, type PanelData } from "./panel.js";
import { MAX_PANEL_ERRORS, errorLine } from "./tools.js";

describe("nearestRank", () => {
  const ascending = Array.from({ length: 120 }, (_, i) => i + 1);

  it("is the value at rank ceil(p/100 * n)", () => {
    // n = 120: p50 -> rank 60, p95 -> rank 114, p99 -> rank 119 (118.8 rounds up).
    expect(nearestRank(ascending, 50)).toBe(60);
    expect(nearestRank(ascending, 95)).toBe(114);
    expect(nearestRank(ascending, 99)).toBe(119);
    expect(nearestRank(ascending, 100)).toBe(120);
    expect(nearestRank(ascending, 0)).toBe(1);
  });

  it("small samples: five values", () => {
    // p50 of 5 -> rank ceil(2.5) = 3; p95 -> rank 5.
    expect(nearestRank([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(nearestRank([1, 2, 3, 4, 5], 95)).toBe(5);
    expect(nearestRank([7], 50)).toBe(7);
  });

  it("is undefined for no samples", () => {
    expect(nearestRank([], 50)).toBeUndefined();
  });
});

describe("FrameStats", () => {
  it("sorts before ranking: the order of arrival does not matter", () => {
    const stats = new FrameStats();
    for (const ms of [5, 1, 4, 2, 3]) stats.push(ms);
    expect(stats.count).toBe(5);
    expect(stats.percentile(50)).toBe(3);
    expect(stats.percentile(95)).toBe(5);
  });

  it("keeps only the last 120 frames", () => {
    const stats = new FrameStats();
    for (let i = 1; i <= 150; i += 1) stats.push(i);
    expect(FRAME_WINDOW).toBe(120);
    expect(stats.count).toBe(120);
    // The window is 31..150: rank 60 is 30 + 60 = 90, rank 114 is 30 + 114 = 144.
    expect(stats.percentile(50)).toBe(90);
    expect(stats.percentile(95)).toBe(144);
  });

  it("ignores values that are not finite and reports nothing before the first frame", () => {
    const stats = new FrameStats();
    expect(stats.percentile(50)).toBeUndefined();
    stats.push(Number.NaN);
    stats.push(Number.POSITIVE_INFINITY);
    expect(stats.count).toBe(0);
  });
});

function data(over: Partial<PanelData> = {}): PanelData {
  return {
    scene: "Demo",
    entity: { item: { name: "Cube", source: "src/main.mtek:23" }, position: 2, count: 5 },
    frame: { lastMs: 16.6666, p50Ms: 16.5, p95Ms: 17.25, samples: 120 },
    gpuTimeMs: null,
    gpuTimeActive: false,
    counters: {
      cpuUpdateMs: 0.5,
      renderPrepMs: 1.25,
      drawCalls: 7,
      instancedDraws: 0,
      culledObjects: 3,
      uploads: 12,
      uploadBytes: 4096,
      pipelinesCreated: 2,
      shaderModulesCreated: 2,
      bindGroupsCreated: 9,
      buffersAllocated: 11,
      texturesAllocated: 2,
      liveBuffers: 10,
      liveTextures: 2,
      liveSamplers: 0,
      liveShaderModules: 2,
      livePipelines: 2,
      liveBindGroups: 9,
      liveListeners: 6,
      liveEntities: 5,
      discardedSteps: 4,
    },
    errors: [],
    ...over,
  };
}

describe("panelLines (spec/tooling.md section 9)", () => {
  const text = (over?: Partial<PanelData>): string => panelLines(data(over)).join("\n");

  it("shows every item of the specification", () => {
    const lines = panelLines(data());
    expect(lines).toContain("scene: Demo");
    expect(lines).toContain("entity: Cube (3/5) src/main.mtek:23");
    expect(lines).toContain("frame time: 16.67 ms  p50 16.50  p95 17.25  (last 120 frames)");
    expect(lines).toContain("draw calls: 7  instanced draws: 0  culled objects: 3");
    expect(lines).toContain("uploads: 12  upload bytes: 4096");
    expect(lines).toContain("discarded steps: 4");
    expect(text()).toContain("pipelines 2");
    expect(text()).toContain("live: buffers 10  textures 2");
    expect(lines).toContain("errors: none");
    expect(lines.at(-1)).toBe(`keys: ${PANEL_KEYS_HELP}`);
  });

  it("says 'GPU time unavailable' without timestamp-query, never a CPU number", () => {
    const t = text({ gpuTimeMs: null, gpuTimeActive: false });
    expect(t).toContain("GPU time unavailable");
    expect(t).not.toMatch(/GPU time: \d/);
  });

  it("shows the measured GPU time, and 'pending' before the first measurement", () => {
    expect(text({ gpuTimeMs: 0.4567, gpuTimeActive: true })).toContain("GPU time: 0.46 ms");
    const pending = text({ gpuTimeMs: null, gpuTimeActive: true });
    expect(pending).toContain("GPU time: pending");
    expect(pending).not.toContain("unavailable");
  });

  it("lists the errors and says so for a scene without entities or source spans", () => {
    expect(text({ errors: ["MTEK-E8051: shader failed", "MTEK-E8090: bad scale"] })).toContain(
      "errors: 2\n  MTEK-E8051: shader failed\n  MTEK-E8090: bad scale",
    );
    expect(text({ entity: null })).toContain("entity: (none)");
    expect(text({ entity: { item: { name: "A", source: null }, position: 0, count: 1 } })).toContain("entity: A (1/1) source unknown");
  });

  it("marks missing counters instead of inventing numbers", () => {
    expect(text({ counters: {} })).toContain("draw calls: ?");
  });

  it("errorLine keeps the code and the first line of the message, shortened", () => {
    const d = makeRuntimeDiagnostic("E8051", { phase: "runtime:mount", message: `First line.\nSecond line.` });
    expect(errorLine(d)).toBe("MTEK-E8051: First line.");
    const long = makeRuntimeDiagnostic("E8051", { phase: "runtime:mount", message: "x".repeat(300) });
    expect(errorLine(long)).toBe(`MTEK-E8051: ${"x".repeat(117)}...`);
    expect(MAX_PANEL_ERRORS).toBeGreaterThan(0);
  });
});

function overlaySetup(): { doc: FakeDocument; canvas: FakeCanvas; overlay: DevOverlay; listeners: string[] } {
  const doc = new FakeDocument();
  const canvas = new FakeCanvas(doc);
  canvas.offsetLeft = 10;
  canvas.offsetTop = 20;
  const listeners: string[] = [];
  const overlay = new DevOverlay({
    canvas: asDom<HTMLCanvasElement>(canvas),
    keyTarget: doc as unknown as EventTarget,
    listen: (target, type, listener) => {
      listeners.push(type);
      target.addEventListener(type, listener);
    },
  });
  overlay.setEntities([
    { name: "A", source: "src/a.mtek:3" },
    { name: "B", source: "src/a.mtek:9" },
    { name: "C", source: null },
  ]);
  return { doc, canvas, overlay, listeners };
}

function panel(doc: FakeDocument): FakeElement {
  const element = doc.body.find(DEV_OVERLAY_ATTRIBUTE);
  if (element === undefined) throw new Error("no development overlay in the document");
  return element;
}

describe("DevOverlay", () => {
  it("is absent until the first update, then a panel in the top-left corner of the canvas", () => {
    const { doc, overlay, listeners } = overlaySetup();
    expect(doc.body.find(DEV_OVERLAY_ATTRIBUTE)).toBeUndefined();
    expect(listeners).toEqual(["keydown"]);
    overlay.update(data());
    const element = panel(doc);
    expect(element.tagName).toBe("pre");
    expect(element.style["left"]).toBe("18px");
    expect(element.style["top"]).toBe("28px");
    expect(element.style["cssText"]).toContain("pointer-events:none");
    expect(element.textContent).toContain("scene: Demo");
    expect(element.textContent).toContain("entity: A (1/3) src/a.mtek:3");
  });

  it("is distinct from the failure overlay and invisible to assistive technology", () => {
    const { doc, overlay } = overlaySetup();
    overlay.update(data());
    const element = panel(doc);
    expect(element.getAttribute("data-mtek-overlay")).toBeNull();
    expect(element.getAttribute("aria-hidden")).toBe("true");
    expect(DEV_OVERLAY_ATTRIBUTE).toBe("data-mtek-dev-overlay");
  });

  it("the backquote key hides and shows it; the text refreshes after showing", () => {
    const { doc, overlay } = overlaySetup();
    overlay.update(data());
    doc.dispatch("keydown", { code: "Backquote", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
    expect(overlay.visible).toBe(false);
    expect(panel(doc).style["display"]).toBe("none");
    // While hidden, updates are only remembered.
    overlay.update(data({ scene: "Other" }));
    expect(panel(doc).textContent).toContain("scene: Demo");
    doc.dispatch("keydown", { code: "Backquote", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
    expect(overlay.visible).toBe(true);
    expect(panel(doc).style["display"]).toBe("block");
    expect(panel(doc).textContent).toContain("scene: Other");
  });

  it("Shift+backquote selects the next entity, wrapping around, and shows its source", () => {
    const { doc, overlay } = overlaySetup();
    overlay.update(data());
    const next = (): void => {
      doc.dispatch("keydown", { code: "Backquote", shiftKey: true, ctrlKey: false, altKey: false, metaKey: false });
    };
    next();
    expect(overlay.selectedIndex).toBe(1);
    expect(panel(doc).textContent).toContain("entity: B (2/3) src/a.mtek:9");
    next();
    expect(panel(doc).textContent).toContain("entity: C (3/3) source unknown");
    next();
    expect(overlay.selectedIndex).toBe(0);
    expect(panel(doc).textContent).toContain("entity: A (1/3) src/a.mtek:3");
  });

  it("ignores other keys and backquote with ctrl, alt or meta; Shift+backquote does nothing while hidden", () => {
    const { doc, overlay } = overlaySetup();
    overlay.update(data());
    const key = (code: string, mods: Record<string, boolean> = {}): void => {
      doc.dispatch("keydown", { code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...mods });
    };
    key("KeyA");
    key("Backquote", { ctrlKey: true });
    key("Backquote", { altKey: true });
    key("Backquote", { metaKey: true });
    expect(overlay.visible).toBe(true);
    key("Backquote");
    key("Backquote", { shiftKey: true });
    expect(overlay.selectedIndex).toBe(0);
  });

  it("keeps the selection when the entity list changes, and resets it when it no longer exists", () => {
    const { overlay } = overlaySetup();
    overlay.selectNext();
    overlay.selectNext();
    expect(overlay.selectedIndex).toBe(2);
    overlay.setEntities([{ name: "A", source: null }, { name: "B", source: null }, { name: "C", source: null }, { name: "D", source: null }]);
    expect(overlay.selectedIndex).toBe(2);
    overlay.setEntities([{ name: "A", source: null }]);
    expect(overlay.selectedIndex).toBe(0);
    overlay.setEntities([]);
    expect(overlay.selection()).toBeNull();
  });

  it("follows the canvas when repositioned, and remove() takes the panel out of the document", () => {
    const { doc, canvas, overlay } = overlaySetup();
    overlay.update(data());
    canvas.offsetLeft = 100;
    canvas.offsetTop = 50;
    overlay.reposition();
    expect(panel(doc).style["left"]).toBe("108px");
    expect(panel(doc).style["top"]).toBe("58px");
    overlay.remove();
    expect(doc.body.find(DEV_OVERLAY_ATTRIBUTE)).toBeUndefined();
    expect(overlay.element).toBeNull();
    overlay.remove();
  });

  it("without a document to listen on it has no keys but still shows the panel", () => {
    const doc = new FakeDocument();
    const canvas = new FakeCanvas(doc);
    const overlay = new DevOverlay({ canvas: asDom<HTMLCanvasElement>(canvas), keyTarget: undefined, listen: () => undefined });
    overlay.update(data());
    expect(panel(doc).textContent).toContain("scene: Demo");
  });
});

// ---------------------------------------------------------------- GpuTimer

/** The slice of the registry the timer uses, over fake buffers. */
function fakeRegistry(): { registry: ResourceRegistry; buffers: FakeBuffer[] } {
  const buffers: FakeBuffer[] = [];
  const registry = {
    createBuffer: (descriptor: { size: number; usage: number; label?: string }) => {
      const buffer = new FakeBuffer(descriptor, () => undefined);
      buffers.push(buffer);
      return buffer;
    },
  } as unknown as ResourceRegistry;
  return { registry, buffers };
}

function fakeTimerDevice(features: string[] = ["timestamp-query"]): { device: TimerDevice; sets: Array<{ destroyed: boolean }> } {
  const sets: Array<{ destroyed: boolean }> = [];
  const device = {
    features: new Set(features),
    createQuerySet: (descriptor: { count: number }) => {
      const set = { destroyed: false, count: descriptor.count, destroy: () => { set.destroyed = true; } };
      sets.push(set);
      return set;
    },
  };
  return { device: device as never, sets };
}

/** A command encoder that records what the timer asks of it. */
function fakeEncoder(resolveInto: (buffer: FakeBuffer) => void): { encoder: GPUCommandEncoder; calls: string[] } {
  const calls: string[] = [];
  const encoder = {
    resolveQuerySet: (_set: unknown, first: number, count: number, destination: FakeBuffer, offset: number) => {
      calls.push(`resolve:${String(first)}:${String(count)}:${String(offset)}`);
      resolveInto(destination);
    },
    copyBufferToBuffer: (source: FakeBuffer, sourceOffset: number, destination: FakeBuffer, destinationOffset: number, size: number) => {
      calls.push(`copy:${String(sourceOffset)}:${String(destinationOffset)}:${String(size)}`);
      destination.contents.set(source.contents.subarray(sourceOffset, sourceOffset + size), destinationOffset);
    },
  };
  return { encoder: encoder as unknown as GPUCommandEncoder, calls };
}

function timestamps(begin: bigint, end: bigint): (buffer: FakeBuffer) => void {
  return (buffer) => {
    const view = new BigUint64Array(buffer.contents.buffer);
    view[0] = begin;
    view[1] = end;
  };
}

/** Lets pending `mapAsync` timers (the fake resolves after a task) and promise callbacks run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

describe("GpuTimer", () => {
  it("needs the timestamp-query feature", () => {
    const { device } = fakeTimerDevice([]);
    expect(hasTimestampQuery(device as never)).toBe(false);
    expect(() => new GpuTimer(device, fakeRegistry().registry)).toThrow(/without timestamp-query/);
  });

  it("measures the pass: ns to ms, one measurement in flight at a time", async () => {
    const { device, sets } = fakeTimerDevice();
    const { registry, buffers } = fakeRegistry();
    const timer = new GpuTimer(device, registry);
    expect(sets).toHaveLength(1);
    expect(buffers.map((b) => b.label)).toEqual(["mtek gpu timer resolve", "mtek gpu timer read"]);
    expect(timer.lastMs).toBeNull();

    const writes = timer.passTimestampWrites();
    expect(writes).toMatchObject({ beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 });
    const { encoder, calls } = fakeEncoder(timestamps(2_000_000n, 3_500_000n));
    timer.resolve(encoder);
    expect(calls).toEqual(["resolve:0:2:0", "copy:0:0:16"]);
    timer.submitted();

    // Until the mapping completes the next frame is not measured.
    expect(timer.passTimestampWrites()).toBeUndefined();
    await settle();
    // (3_500_000 - 2_000_000) ns = 1.5 ms.
    expect(timer.lastMs).toBe(1.5);
    expect(timer.measurements).toBe(1);
    expect(timer.passTimestampWrites()).toBeDefined();
  });

  it("keeps the last measurement while a frame is not measured, and replaces it by the next", async () => {
    const { device } = fakeTimerDevice();
    const timer = new GpuTimer(device, fakeRegistry().registry);
    timer.passTimestampWrites();
    timer.resolve(fakeEncoder(timestamps(0n, 1_000_000n)).encoder);
    timer.submitted();
    await settle();
    expect(timer.lastMs).toBe(1);
    timer.passTimestampWrites();
    timer.resolve(fakeEncoder(timestamps(10n, 250_010n)).encoder);
    timer.submitted();
    await settle();
    expect(timer.lastMs).toBe(0.25);
    expect(timer.measurements).toBe(2);
  });

  it("a frame that did not ask for timestamps records and submits nothing", () => {
    const { device } = fakeTimerDevice();
    const timer = new GpuTimer(device, fakeRegistry().registry);
    const { encoder, calls } = fakeEncoder(timestamps(0n, 1n));
    timer.resolve(encoder);
    timer.submitted();
    expect(calls).toEqual([]);
    expect(timer.passTimestampWrites()).toBeDefined();
  });

  it("discards a result whose end is before its begin", async () => {
    const { device } = fakeTimerDevice();
    const timer = new GpuTimer(device, fakeRegistry().registry);
    timer.passTimestampWrites();
    timer.resolve(fakeEncoder(timestamps(5_000n, 1_000n)).encoder);
    timer.submitted();
    await settle();
    expect(timer.lastMs).toBeNull();
    expect(timer.measurements).toBe(0);
    expect(timer.passTimestampWrites()).toBeDefined();
  });

  it("a mapping that fails (device destroyed) ends the measurement without a value", async () => {
    const { device } = fakeTimerDevice();
    const { registry, buffers } = fakeRegistry();
    const timer = new GpuTimer(device, registry);
    timer.passTimestampWrites();
    timer.resolve(fakeEncoder(timestamps(0n, 1_000_000n)).encoder);
    timer.submitted();
    buffers[1]?.destroy();
    await settle();
    expect(timer.lastMs).toBeNull();
    expect(timer.passTimestampWrites()).toBeDefined();
  });

  it("dispose destroys the query set, stops measuring and ignores a late result", async () => {
    const { device, sets } = fakeTimerDevice();
    const timer = new GpuTimer(device, fakeRegistry().registry);
    timer.passTimestampWrites();
    timer.resolve(fakeEncoder(timestamps(0n, 1_000_000n)).encoder);
    timer.submitted();
    timer.dispose();
    timer.dispose();
    expect(sets[0]?.destroyed).toBe(true);
    expect(timer.passTimestampWrites()).toBeUndefined();
    await settle();
    expect(timer.lastMs).toBeNull();
  });
});
