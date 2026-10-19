// The measurement page. One bundle per (workload, implementation) imports its `create` function through the esbuild alias
// `@implementation` and registers `window.__bench`; the node-side runner (`tools/run.ts`) loads the page in a fresh browser
// context for every pass and calls `__bench.run(spec, context)` once (decision 0095).
//
// Passes (each in its own page load, so no pass perturbs another):
//   timing      frame-time distribution, CPU split, no instrumentation beyond device capture
//   counts      GPU object creations, uploads, draw calls, startup totals (the instrument counts the API)
//   gpu-time    GPU time per frame from timestamp queries (only when the device has `timestamp-query`)
//   allocation  JavaScript allocation of the measured frames, measured by the runner with the sampling heap profiler
//   parity      the picture after a fixed number of frames, to prove the three implementations show the same scene
//   startup     create-to-first-frame latency
//   cycles      mount, frames, reload, frames, dispose; repeated
import { create } from "@implementation";
import {
  currentDevice,
  devices,
  diffCounters,
  installCounters,
  installDeviceCapture,
  installGpuTimer,
  snapshotCounters,
  unknownTextureFormats,
  type DeviceRecord,
  type GpuCounters,
} from "./instrument.ts";
import { summarize } from "./stats.ts";
import type { BenchApp, BenchContext, BenchGate, BenchPageApi, PassSpec } from "./types.ts";

const scriptEvaluatedAt = performance.now();

declare global {
  interface Window {
    __bench: BenchPageApi;
    __benchGate?: BenchGate;
    __benchSample?: () => Promise<Record<string, number>>;
  }
}

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** Problems the instrument saw on any device: validation errors and losses that were not our own `destroy`. */
function deviceProblems(records: readonly DeviceRecord[] = devices()): string[] {
  const problems: string[] = [];
  records.forEach((record, index) => {
    for (const error of record.errors.slice(0, 5)) problems.push(`device ${String(index)}: uncaptured error: ${error}`);
    if (record.lost !== null && record.lost.reason !== "destroyed") {
      problems.push(`device ${String(index)}: lost (${record.lost.reason}): ${record.lost.message}`);
    }
  });
  return problems;
}

function requireDevice(): DeviceRecord {
  const record = currentDevice();
  if (record === undefined) throw new Error("the application did not request a WebGPU device");
  return record;
}

/** Runs `frames` frames, each completed on the GPU before the next starts; `observe` sees the frame index and timings. */
async function drive(
  app: BenchApp,
  record: DeviceRecord,
  dt: number,
  frames: number,
  observe?: (index: number, cpuMs: number, completedMs: number) => void,
): Promise<void> {
  const queue = record.device.queue;
  for (let index = 0; index < frames; index += 1) {
    const t0 = performance.now();
    app.frame(dt);
    const t1 = performance.now();
    await queue.onSubmittedWorkDone();
    const t2 = performance.now();
    observe?.(index, t1 - t0, t2 - t0);
  }
}

async function runTiming(spec: Extract<PassSpec, { pass: "timing" }>, context: BenchContext): Promise<unknown> {
  installDeviceCapture({ timestampQuery: false });
  const app = await create(context);
  const record = requireDevice();
  const total = spec.warmupFrames + spec.frames;
  const completed = new Float64Array(spec.frames);
  const cpu = new Float64Array(spec.frames);
  const update = new Float64Array(spec.frames);
  const renderPrep = new Float64Array(spec.frames);
  const queue = record.device.queue;
  for (let index = 0; index < total; index += 1) {
    const t0 = performance.now();
    app.frame(spec.frameDeltaSeconds);
    const t1 = performance.now();
    await queue.onSubmittedWorkDone();
    const t2 = performance.now();
    const split = app.split();
    const slot = index - spec.warmupFrames;
    if (slot >= 0) {
      cpu[slot] = t1 - t0;
      completed[slot] = t2 - t0;
      update[slot] = split.updateMs;
      renderPrep[slot] = split.renderPrepMs;
    }
  }
  const pixels = await app.readPixels();
  const lit = countNonClear(pixels.data);
  const info = app.info?.() ?? null;
  await app.dispose();
  return {
    pass: "timing",
    warmupFrames: spec.warmupFrames,
    frames: spec.frames,
    completedMs: Array.from(completed),
    cpuMs: Array.from(cpu),
    updateMs: Array.from(update),
    renderPrepMs: Array.from(renderPrep),
    // A sanity check that the frames drew something: the share of pixels that differ from the first pixel (the clear colour).
    drawnPixelShare: lit,
    summary: { completed: summarize(completed), cpu: summarize(cpu) },
    info,
    problems: deviceProblems(),
  };
}

function countNonClear(data: Uint8Array): number {
  const r = data[0] ?? 0;
  const g = data[1] ?? 0;
  const b = data[2] ?? 0;
  let different = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] !== r || data[i + 1] !== g || data[i + 2] !== b) different += 1;
  }
  return different / (data.length / 4);
}

interface CounterAggregate {
  readonly total: GpuCounters;
  readonly perFrameMin: GpuCounters;
  readonly perFrameMax: GpuCounters;
}

function aggregate(diffs: readonly GpuCounters[]): CounterAggregate {
  const first = diffs[0];
  if (first === undefined) throw new Error("no frames were counted");
  const total = { ...first };
  const min = { ...first };
  const max = { ...first };
  for (const diff of diffs.slice(1)) {
    for (const key of Object.keys(total) as Array<keyof GpuCounters>) {
      total[key] += diff[key];
      min[key] = Math.min(min[key], diff[key]);
      max[key] = Math.max(max[key], diff[key]);
    }
  }
  return { total, perFrameMin: min, perFrameMax: max };
}

async function runCounts(spec: Extract<PassSpec, { pass: "counts" }>, context: BenchContext): Promise<unknown> {
  installDeviceCapture({ timestampQuery: false });
  installCounters();
  const before = snapshotCounters();
  const app = await create(context);
  const record = requireDevice();
  const afterCreate = snapshotCounters();
  const queue = record.device.queue;
  // The first frame is part of startup: pipelines and bind groups many renderers create lazily appear here.
  app.frame(spec.frameDeltaSeconds);
  await queue.onSubmittedWorkDone();
  const afterFirstFrame = snapshotCounters();
  for (let index = 1; index < spec.warmupFrames; index += 1) {
    app.frame(spec.frameDeltaSeconds);
    await queue.onSubmittedWorkDone();
  }
  const afterWarmup = snapshotCounters();
  const diffs: GpuCounters[] = [];
  const runtimeDrawCalls: number[] = [];
  let previous = afterWarmup;
  for (let index = 0; index < spec.frames; index += 1) {
    app.frame(spec.frameDeltaSeconds);
    await queue.onSubmittedWorkDone();
    const now = snapshotCounters();
    diffs.push(diffCounters(now, previous));
    previous = now;
    const counters = app.runtimeCounters?.();
    if (counters !== undefined) runtimeDrawCalls.push(counters["drawCalls"] ?? NaN);
  }
  const runtimeCounters = app.runtimeCounters?.() ?? null;
  const info = app.info?.() ?? null;
  await app.dispose();
  const afterDispose = snapshotCounters();
  return {
    pass: "counts",
    warmupFrames: spec.warmupFrames,
    frames: spec.frames,
    create: diffCounters(afterCreate, before),
    firstFrame: diffCounters(afterFirstFrame, afterCreate),
    warmup: diffCounters(afterWarmup, afterFirstFrame),
    steady: aggregate(diffs),
    dispose: diffCounters(afterDispose, previous),
    liveAfterDispose: { bufferBytes: afterDispose.liveBufferBytes, textureBytes: afterDispose.liveTextureBytes },
    runtimeCounters,
    runtimeDrawCallsPerFrame: runtimeDrawCalls,
    unknownTextureFormats: unknownTextureFormats(),
    info,
    problems: deviceProblems(),
  };
}

async function runGpuTime(spec: Extract<PassSpec, { pass: "gpu-time" }>, context: BenchContext): Promise<unknown> {
  installDeviceCapture({ timestampQuery: true });
  installCounters();
  const app = await create(context);
  const record = requireDevice();
  if (!record.device.features.has("timestamp-query")) {
    await app.dispose();
    return {
      pass: "gpu-time",
      available: false,
      reason: "the device has no timestamp-query feature",
      deviceFeatures: record.features,
      problems: deviceProblems(),
    };
  }
  const timer = installGpuTimer(record.device);
  const queue = record.device.queue;
  const gpuMs: Array<number | null> = [];
  const total = spec.warmupFrames + spec.frames;
  for (let index = 0; index < total; index += 1) {
    app.frame(spec.frameDeltaSeconds);
    await queue.onSubmittedWorkDone();
    const ms = await timer.readMs();
    if (index >= spec.warmupFrames) gpuMs.push(ms);
  }
  const measured = gpuMs.filter((v): v is number => v !== null);
  const result = {
    pass: "gpu-time",
    available: measured.length > 0,
    reason: measured.length > 0 ? null : "no render pass was timed",
    frames: spec.frames,
    timedFrames: measured.length,
    gpuMs: measured,
    encodersSkipped: timer.encodersSkipped,
    passesSkipped: timer.passesSkipped,
    deviceFeatures: record.features,
    problems: deviceProblems(),
  };
  timer.destroy();
  await app.dispose();
  return result;
}

async function runAllocation(spec: Extract<PassSpec, { pass: "allocation" }>, context: BenchContext): Promise<unknown> {
  installDeviceCapture({ timestampQuery: false });
  const gate = window.__benchGate;
  if (gate === undefined) throw new Error("the allocation pass needs the runner's __benchGate");
  const app = await create(context);
  const record = requireDevice();
  await drive(app, record, spec.frameDeltaSeconds, spec.warmupFrames);
  await gate("begin");
  await drive(app, record, spec.frameDeltaSeconds, spec.frames);
  await gate("end");
  await app.dispose();
  return { pass: "allocation", warmupFrames: spec.warmupFrames, frames: spec.frames, problems: deviceProblems() };
}

async function runParity(spec: Extract<PassSpec, { pass: "parity" }>, context: BenchContext): Promise<unknown> {
  installDeviceCapture({ timestampQuery: false });
  const app = await create(context);
  const record = requireDevice();
  await drive(app, record, spec.frameDeltaSeconds, spec.frames);
  const pixels = await app.readPixels();
  const info = app.info?.() ?? null;
  await app.dispose();
  return {
    pass: "parity",
    frames: spec.frames,
    width: pixels.width,
    height: pixels.height,
    rgba: toBase64(pixels.data),
    info,
    problems: deviceProblems(),
  };
}

async function runStartup(spec: Extract<PassSpec, { pass: "startup" }>, context: BenchContext): Promise<unknown> {
  installDeviceCapture({ timestampQuery: false });
  const t0 = performance.now();
  const app = await create(context);
  const t1 = performance.now();
  const record = requireDevice();
  app.frame(spec.frameDeltaSeconds);
  await record.device.queue.onSubmittedWorkDone();
  const t2 = performance.now();
  // A second frame shows what the first one paid for (lazy pipelines, first uploads).
  app.frame(spec.frameDeltaSeconds);
  await record.device.queue.onSubmittedWorkDone();
  const t3 = performance.now();
  const info = app.info?.() ?? null;
  await app.dispose();
  return {
    pass: "startup",
    // Milliseconds since the navigation started until the bundle was evaluated: download, parse, top-level code.
    bundleEvaluatedMs: scriptEvaluatedAt,
    // The window around the application's own startup.
    createMs: t1 - t0,
    firstFrameMs: t2 - t1,
    secondFrameMs: t3 - t2,
    startupMs: t2 - t0,
    navigationToFirstFrameMs: t2,
    info,
    problems: deviceProblems(),
  };
}

async function runCycles(spec: Extract<PassSpec, { pass: "cycles" }>, context: BenchContext): Promise<unknown> {
  installDeviceCapture({ timestampQuery: false });
  installCounters();
  const sample = window.__benchSample;
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));
  const cycles: unknown[] = [];
  const baseline = sample === undefined ? null : await sample();
  for (let cycle = 0; cycle < spec.cycles; cycle += 1) {
    const counters0 = snapshotCounters();
    const tMount = performance.now();
    const app = await create(context);
    const record = requireDevice();
    const mountMs = performance.now() - tMount;
    const queue = record.device.queue;
    const firstFrameStart = performance.now();
    app.frame(spec.frameDeltaSeconds);
    await queue.onSubmittedWorkDone();
    const firstFrameMs = performance.now() - firstFrameStart;
    for (let i = 1; i < spec.framesPerPhase; i += 1) {
      app.frame(spec.frameDeltaSeconds);
      await queue.onSubmittedWorkDone();
    }
    const liveBeforeReload = snapshotCounters();
    const tReload = performance.now();
    if (app.reload === undefined) throw new Error("this implementation has no reload step");
    await app.reload();
    const reloadMs = performance.now() - tReload;
    const postStart = performance.now();
    app.frame(spec.frameDeltaSeconds);
    await queue.onSubmittedWorkDone();
    const postReloadFrameMs = performance.now() - postStart;
    for (let i = 1; i < spec.framesPerPhase; i += 1) {
      app.frame(spec.frameDeltaSeconds);
      await queue.onSubmittedWorkDone();
    }
    const runtimeBeforeDispose = app.runtimeCounters?.() ?? null;
    const counters1 = snapshotCounters();
    const tDispose = performance.now();
    await app.dispose();
    const disposeMs = performance.now() - tDispose;
    await settle();
    const counters2 = snapshotCounters();
    let runtimeAfterDispose: Readonly<Record<string, number>> | null = null;
    try {
      runtimeAfterDispose = app.runtimeCounters?.() ?? null;
    } catch {
      runtimeAfterDispose = null;
    }
    const heap = sample === undefined ? null : await sample();
    cycles.push({
      cycle,
      mountMs,
      firstFrameMs,
      reloadMs,
      postReloadFrameMs,
      disposeMs,
      createdDuringMount: diffCounters(liveBeforeReload, counters0),
      createdDuringReload: diffCounters(counters1, liveBeforeReload),
      createdDuringDispose: diffCounters(counters2, counters1),
      liveBufferBytesAfterDispose: counters2.liveBufferBytes,
      liveTextureBytesAfterDispose: counters2.liveTextureBytes,
      buffersCreatedTotal: counters2.buffersCreated,
      buffersDestroyedTotal: counters2.buffersDestroyed,
      texturesCreatedTotal: counters2.texturesCreated,
      texturesDestroyedTotal: counters2.texturesDestroyed,
      devicesRequestedTotal: counters2.devicesRequested,
      devicesDestroyedTotal: counters2.devicesDestroyed,
      runtimeBeforeDispose,
      runtimeAfterDispose,
      process: heap,
    });
  }
  return {
    pass: "cycles",
    cycles: spec.cycles,
    framesPerPhase: spec.framesPerPhase,
    baselineProcess: baseline,
    records: cycles,
    unknownTextureFormats: unknownTextureFormats(),
    problems: deviceProblems(),
  };
}

async function run(spec: PassSpec, context: BenchContext): Promise<unknown> {
  switch (spec.pass) {
    case "timing":
      return runTiming(spec, context);
    case "counts":
      return runCounts(spec, context);
    case "gpu-time":
      return runGpuTime(spec, context);
    case "allocation":
      return runAllocation(spec, context);
    case "parity":
      return runParity(spec, context);
    case "startup":
      return runStartup(spec, context);
    case "cycles":
      return runCycles(spec, context);
  }
}

window.__bench = { ready: true, run };
