// A synthetic raw run for the tests of the analysis and the report: the same shapes `run.ts` writes, with numbers a test chooses,
// so that every statistic can be checked against a value worked out by hand. Test support only.
import type { EnvironmentRecord } from "../../../tests/browser/support/environment-types.ts";
import protocol from "../protocol.json" with { type: "json" };
import type { RawRun } from "./analyze.ts";
import { IMPLEMENTATIONS, WORKLOADS } from "./paths.ts";
import type { RawJob, RawPairFile, RawRunMeta } from "./raw-types.ts";

export interface SyntheticOptions {
  /** The p95 CPU frame time of Mtek relative to direct (every frame workload). */
  readonly mtekFactor?: number;
  /** Drop an implementation's raw file entirely (a missing result). */
  readonly missing?: ReadonlyArray<`${string}--${string}`>;
  /** Make one job of a pair fail. */
  readonly failing?: ReadonlyArray<{ pair: `${string}--${string}`; pass: RawJob["pass"] }>;
  /** Mtek's GPU time unavailable. */
  readonly noGpuTime?: boolean;
  /** Growth per cycle of Mtek's heap (bytes), to make the plateau classification visible. */
  readonly mtekHeapGrowthPerCycle?: number;
}

const hostLoad = { busyBeforePercent: 10, busyDuringPercent: 30, waitedForQuietMs: 0, noisy: false, logicalCpus: 24 };

/** `n` samples whose nearest-rank p95 is exactly `p95` and p50 exactly `p95 / 2` (a ramp then a flat top). */
export function samplesWithP95(n: number, p95: number): number[] {
  const out: number[] = [];
  for (let i = 1; i <= n; i += 1) out.push(i <= Math.ceil(0.95 * n) ? (p95 * i) / Math.ceil(0.95 * n) : p95 * 1.5);
  return out;
}

function job(pass: RawJob["pass"], run: number, result: unknown, extra: Partial<RawJob> = {}): RawJob {
  return { pass, run, startedAt: `2026-10-19T00:00:${String(10 + run).padStart(2, "0")}.000Z`, durationMs: 1000, hostLoad, gpuLockWaitedMs: 0, status: "ok", pageErrors: [], consoleWarnings: 0, result, ...extra };
}

function counts(drawCalls: number, instanced: number, writes: number, bytes: number): unknown {
  const zero = {
    renderPipelinesCreated: 0, computePipelinesCreated: 0, shaderModulesCreated: 0, buffersCreated: 0, texturesCreated: 0, bindGroupsCreated: 0, samplersCreated: 0,
    bufferBytesCreated: 0, textureBytesCreated: 0, writeBufferBytes: 0, writeTextureBytes: 0, externalImageBytes: 0, mappedAtCreationBytes: 0,
  };
  const steady = (n: number): Record<string, number> => ({ drawCalls: drawCalls * n, instancedDrawCalls: instanced * n, instancesDrawn: drawCalls * n, setBindGroup: 2 * n, renderPassesBegun: n, writeBufferCalls: writes * n, writeBufferBytes: bytes * n, writeTextureBytes: 0, externalImageBytes: 0, buffersCreated: 0, texturesCreated: 0, samplersCreated: 0, shaderModulesCreated: 0, bindGroupsCreated: 0, renderPipelinesCreated: 0, computePipelinesCreated: 0 });
  return {
    pass: "counts",
    warmupFrames: 120,
    frames: 120,
    create: { ...zero, renderPipelinesCreated: 1, shaderModulesCreated: 1, buffersCreated: 5, bindGroupsCreated: 1 },
    firstFrame: zero,
    warmup: zero,
    steady: { total: steady(120), perFrameMin: steady(1), perFrameMax: steady(1) },
    runtimeCounters: null,
    runtimeDrawCallsPerFrame: [],
  };
}

export function syntheticRun(options: SyntheticOptions = {}): RawRun {
  const factor = options.mtekFactor ?? 3;
  const pairs = new Map<string, RawPairFile>();
  const pictures = new Map<string, Uint8Array>();
  const picture = new Uint8Array(16 * 16 * 4).fill(255);
  for (let i = 0; i < picture.length; i += 4) picture.set([16, 24, 32, 255], i);
  picture.set([200, 100, 50, 255], 0);
  for (let i = 4; i < 200; i += 4) picture.set([200, 100, 50, 255], i);
  for (const workload of WORKLOADS) {
    for (const impl of IMPLEMENTATIONS) {
      const key = `${workload}--${impl}` as const;
      if (options.missing?.includes(key) === true) continue;
      const base = impl === "direct" ? 0.2 : impl === "three" ? 0.5 : 0.2 * factor;
      const jobs: RawJob[] = [];
      const isCycles = workload === "mount-reload-dispose";
      if (!isCycles) {
        for (let run = 0; run < 3; run += 1) {
          const cpu = samplesWithP95(600, base * (1 + run * 0.01));
          jobs.push(
            job("timing", run, {
              pass: "timing",
              warmupFrames: 120,
              frames: 600,
              cpuMs: cpu,
              completedMs: cpu.map((x) => x + 2.7),
              updateMs: cpu.map((x) => x / 4),
              renderPrepMs: cpu.map((x) => (3 * x) / 4),
              drawnPixelShare: 0.3,
              info: workload === "physics-bodies" ? { sleepingBodies: 0, sample: [{ name: "C000", position: { x: 1, y: 2, z: 3 } }] } : null,
            }),
          );
        }
        jobs.push(job("counts", 0, counts(impl === "three" ? 400 : 1, impl === "three" ? 0 : 1, impl === "direct" ? 1 : 1000, 64_000)));
        jobs.push(
          job(
            "gpu-time",
            0,
            options.noGpuTime === true && impl === "mtek"
              ? { pass: "gpu-time", available: false, reason: "the device has no timestamp-query feature" }
              : { pass: "gpu-time", available: true, reason: null, timedFrames: 600, gpuMs: samplesWithP95(600, 0.01) },
          ),
        );
        jobs.push(job("allocation", 0, { pass: "allocation", frames: 300 }, { allocation: { sampledBytes: 300 * 1000 * (impl === "mtek" ? 50 : 1), profileNodes: 10, samplingIntervalBytes: 4096, topSites: [{ site: "cull runtime.js:100", sampledBytes: 300 * 8000 }] } }));
        for (let run = 0; run < 5; run += 1) {
          const startup = base * 100 + run;
          jobs.push(job("startup", run, { pass: "startup", bundleEvaluatedMs: 20, createMs: startup, firstFrameMs: 10, secondFrameMs: 3, startupMs: startup + 10, navigationToFirstFrameMs: startup + 30 }));
        }
      } else {
        const records = (n: number): unknown[] =>
          Array.from({ length: n }, (_, c) => ({
            cycle: c,
            mountMs: base * 20,
            reloadMs: base * 5,
            disposeMs: base,
            createdDuringMount: { buffersCreated: 8, texturesCreated: 0, renderPipelinesCreated: 1, bindGroupsCreated: 2 },
            createdDuringReload: { buffersCreated: 8, texturesCreated: 0, renderPipelinesCreated: 0, bindGroupsCreated: 2 },
            liveBufferBytesAfterDispose: 0,
            liveTextureBytesAfterDispose: 0,
            devicesRequestedTotal: c + 1,
            devicesDestroyedTotal: c + 1,
            runtimeBeforeDispose: impl === "mtek" ? { liveBuffers: 8 } : null,
            runtimeAfterDispose: impl === "mtek" ? { liveBuffers: 0, liveTextures: 0, liveSamplers: 0, liveShaderModules: 0, livePipelines: 0, liveBindGroups: 0, liveListeners: 0 } : null,
            process: {
              heapUsedBytes: 1_000_000 + (impl === "mtek" ? (options.mtekHeapGrowthPerCycle ?? 0) * c : 20_000 * Math.min(c, 5)),
              Nodes: 10,
              JSEventListeners: 14,
            },
          }));
        jobs.push(job("cycles", 0, { pass: "cycles", records: records(50) }));
        jobs.push(job("cycles-long", 0, { pass: "cycles", records: records(200) }));
        jobs.push(job("counts", 0, counts(4, 4, 0, 0)));
        jobs.push(...[0].map((run) => job("startup", run, { pass: "startup", bundleEvaluatedMs: 20, createMs: 100, firstFrameMs: 10, secondFrameMs: 3, startupMs: 110, navigationToFirstFrameMs: 130 })));
      }
      jobs.push(job("parity", 0, { pass: "parity", width: 16, height: 16, info: null }));
      for (const failing of options.failing ?? []) {
        if (failing.pair === key) {
          const index = jobs.findIndex((j) => j.pass === failing.pass);
          if (index >= 0) jobs[index] = { ...(jobs[index] as RawJob), status: "error", error: "the page threw: synthetic failure", result: undefined };
        }
      }
      pairs.set(key, { schemaVersion: 1, runId: "synthetic", workload, implementation: impl, jobs });
      pictures.set(key, picture);
    }
  }
  const floorJobs: RawJob[] = [
    job("timing", 0, { pass: "timing", cpuMs: samplesWithP95(600, 0.04), completedMs: samplesWithP95(600, 3.2), updateMs: new Array<number>(600).fill(0), renderPrepMs: samplesWithP95(600, 0.04), drawnPixelShare: 0 }),
    job("allocation", 0, { pass: "allocation", frames: 300 }, { allocation: { sampledBytes: 300 * 200, profileNodes: 3, samplingIntervalBytes: 4096, topSites: [] } }),
    job("gpu-time", 0, { pass: "gpu-time", available: true, reason: null, timedFrames: 600, gpuMs: new Array<number>(600).fill(0.001) }),
  ];
  const meta: RawRunMeta = {
    schemaVersion: 1,
    runId: "synthetic",
    smoke: false,
    status: "complete",
    startedAt: "2026-10-19T00:00:00.000Z",
    finishedAt: "2026-10-19T01:00:00.000Z",
    gitCommit: "0".repeat(40),
    gitDirty: false,
    frozen: { treeHash: "f".repeat(64), recordedHash: "f".repeat(64), matches: true },
    protocol,
    seed: 1,
    workloads: [...WORKLOADS],
    implementations: [...IMPLEMENTATIONS],
    order: ["synthetic"],
    versions: { mtek: "0.1.0-dev", three: "0.186.1", rapier: "0.21.0", runtimeWeb: "0.1.0-dev" },
    gpuLockConfigured: true,
    quietLimitPercent: 25,
    arguments: [],
  };
  const environment: EnvironmentRecord = {
    schemaVersion: 1,
    project: "runtime-benchmark",
    recordedAt: "2026-10-19T00:00:00.000Z",
    os: { platform: "win32", release: "10.0.26200", version: "Windows 11 Pro", arch: "x64" },
    browser: { name: "chromium", channel: "chromium", version: "153.0", headless: true, launchArgs: ["--enable-unsafe-webgpu"] },
    userAgent: "synthetic",
    devicePixelRatio: 1,
    renderTargetSize: { width: 128, height: 128 },
    gpu: {
      navigatorGpu: true,
      reason: null,
      wgslLanguageFeatures: [],
      adapter: { info: { vendor: "amd", architecture: "rdna-3", device: "0x744c", description: "AMD Radeon RX 7900 XTX", isFallbackAdapter: false }, adapterFeatures: ["timestamp-query"], deviceFeatures: [], limits: {} },
    },
    source: { gitCommit: "0".repeat(40), gitDirty: false },
    toolchain: { rustc: "rustc 1.99.0", naga: "none", node: "v24.18.1", playwright: "1.63.0", runtimeWeb: "0.1.0-dev" },
    settings: { requireGpu: true, acceptSoftware: false },
  };
  return {
    dir: "synthetic",
    meta,
    environment,
    pairs,
    floor: { schemaVersion: 1, runId: "synthetic", workload: "floor", implementation: "floor", jobs: floorJobs },
    sizes: WORKLOADS.flatMap((workload) =>
      IMPLEMENTATIONS.map((implementation) => ({
        workload,
        implementation,
        javascript: { rawBytes: implementation === "mtek" ? 800_000 : 400_000, gzipBytes: implementation === "mtek" ? 150_000 : 100_000 },
        javascriptMinified: { rawBytes: 300_000, gzipBytes: 80_000 },
        programData: implementation === "mtek" ? { rawBytes: 20_000, gzipBytes: 4_000 } : null,
        lazy: [],
      })),
    ),
    pictures,
  };
}
