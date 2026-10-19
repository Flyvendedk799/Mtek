// From raw results to the numbers of the report. Pure functions of the files in `raw/<run-id>/`: the report generator and its
// verification test call exactly these, so a number in `report.md` can be recomputed from the stored raw data by running them.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { median, percentileSorted, summarize, type Summary } from "../harness/stats.ts";
import type { EnvironmentRecord } from "../../../tests/browser/support/environment-types.ts";
import { chooseAttempts, groupAttempts } from "./attempts.ts";
import { isDisturbed } from "./host-load.ts";
import { comparePictures, type PictureComparison } from "./parity.ts";
import { decodePng } from "./png.ts";
import type { RawJob, RawPairFile, RawRunMeta } from "./raw-types.ts";

export const IMPLEMENTATION_ORDER = ["mtek", "direct", "three"] as const;
export type Impl = (typeof IMPLEMENTATION_ORDER)[number];

export interface PercentileSet {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

/** Per-run percentiles of a series, and the median of each across the runs, with the range. */
export interface RunPercentiles {
  readonly runs: number;
  readonly samplesPerRun: number;
  readonly median: PercentileSet;
  readonly min: PercentileSet;
  readonly max: PercentileSet;
  readonly mean: number;
}

export function percentileSetOf(samples: ArrayLike<number>): PercentileSet {
  const s = summarize(samples);
  return { p50: s.p50, p95: s.p95, p99: s.p99 };
}

export function combineRuns(series: ReadonlyArray<ArrayLike<number>>): RunPercentiles {
  const per = series.map((s) => ({ set: percentileSetOf(s), mean: summarize(s).mean }));
  const pick = (f: (set: PercentileSet) => number): number[] => per.map((p) => f(p.set));
  const of = (agg: (v: number[]) => number): PercentileSet => ({ p50: agg(pick((s) => s.p50)), p95: agg(pick((s) => s.p95)), p99: agg(pick((s) => s.p99)) });
  return {
    runs: series.length,
    samplesPerRun: series[0]?.length ?? 0,
    median: of((v) => median(v)),
    min: of((v) => Math.min(...v)),
    max: of((v) => Math.max(...v)),
    mean: median(per.map((p) => p.mean)),
  };
}

export interface CountsSummary {
  readonly drawCallsPerFrame: number;
  readonly instancedDrawCallsPerFrame: number;
  readonly instancesDrawnPerFrame: number;
  readonly setBindGroupPerFrame: number;
  readonly renderPassesPerFrame: number;
  readonly writeBufferCallsPerFrame: number;
  /** writeBuffer + writeTexture + copyExternalImageToTexture bytes per steady frame. */
  readonly uploadBytesPerFrame: number;
  /** GPU objects (buffers, textures, samplers, shader modules, bind groups, pipelines) created in a steady frame; 0 for a retained renderer. */
  readonly gpuObjectsCreatedPerFrameMax: number;
  readonly startup: StartupCounts;
  /** Whether the steady-frame counters were the same in every counted frame (min equals max for draw calls and uploads). */
  readonly steadyIsConstant: boolean;
  readonly runtimeCrossCheck: RuntimeCrossCheck | null;
}

export interface StartupCounts {
  readonly pipelines: number;
  readonly shaderModules: number;
  readonly buffers: number;
  readonly textures: number;
  readonly bindGroups: number;
  readonly samplers: number;
  readonly bufferBytes: number;
  readonly textureBytes: number;
  /** Everything uploaded from the application call to the end of warm-up (create, first frame, warm-up frames). */
  readonly uploadBytes: number;
}

export interface RuntimeCrossCheck {
  /** The runtime's own `drawCalls` counter against the instrument's draw calls per frame. */
  readonly runtimeDrawCallsPerFrame: number;
  readonly instrumentDrawCallsPerFrame: number;
  readonly runtimePipelinesCreated: number;
  readonly instrumentPipelinesCreated: number;
  readonly agrees: boolean;
}

export interface StartupSummary {
  readonly runs: number;
  readonly startupMs: Summary;
  readonly navigationToFirstFrameMs: Summary;
  readonly createMs: Summary;
  readonly firstFrameMs: Summary;
  readonly bundleEvaluatedMs: Summary;
}

export interface GpuTimeSummary {
  readonly available: boolean;
  readonly reason: string | null;
  readonly timedFrames: number;
  readonly percentiles: PercentileSet | null;
}

export interface CycleSeries {
  readonly cycles: number;
  readonly mountMs: Summary;
  readonly reloadMs: Summary;
  readonly disposeMs: Summary;
  /** mount + reload + dispose of every cycle. */
  readonly lifecycleMs: Summary;
  readonly resources: readonly ResourceSeries[];
  readonly creationsPerCycle: { readonly buffers: number; readonly textures: number; readonly pipelines: number; readonly bindGroups: number; readonly constant: boolean };
}

export interface ResourceSeries {
  readonly name: string;
  readonly unit: string;
  readonly values: readonly number[];
  /** Value after the first cycle, the 10th, the 25th and the last. */
  readonly at: Readonly<Record<string, number>>;
  /** Least-squares slope over the last half of the cycles, in `unit` per cycle. */
  readonly slopePerCycle: number;
  /** `slope * (cycles in the last half) / mean value of the last half`, in percent: the growth the last half would add again. */
  readonly relativeGrowthPercent: number;
  readonly classification: "zero" | "plateau" | "growing";
  /** The median change from one cycle to the next (a series that grows in steps has a median near zero) and the largest single-cycle increase. */
  readonly medianChangePerCycle: number;
  readonly largestIncrease: number;
}

export interface PairSummary {
  readonly workload: string;
  readonly implementation: string;
  readonly status: "ok" | "error" | "missing";
  readonly errors: readonly string[];
  readonly frame: { readonly cpu: RunPercentiles; readonly completed: RunPercentiles; readonly update: RunPercentiles; readonly renderPrep: RunPercentiles; readonly drawnPixelShare: number } | null;
  readonly gpu: GpuTimeSummary | null;
  readonly counts: CountsSummary | null;
  readonly jsAllocationBytesPerFrame: number | null;
  /** The allocation sites with the most sampled bytes per frame (see `RawJob.allocation`). */
  readonly allocationSites: ReadonlyArray<{ readonly site: string; readonly bytesPerFrame: number }> | null;
  readonly startup: StartupSummary | null;
  readonly cycles: CycleSeries | null;
  /** The supplementary long run (`longCycles` cycles) that shows whether a series that was still moving after 50 cycles settles. */
  readonly cyclesLong: CycleSeries | null;
  readonly parity: (PictureComparison & { readonly maxPositionDifference: number | null }) | null;
  readonly host: {
    readonly passes: number;
    readonly maxBusyBeforePercent: number;
    readonly noisyPasses: number;
    readonly meanBusyDuringPercent: number;
    /** Attempts (passes counting repeats) that were disturbed by other load, how many passes were repeated, and how many counted attempts were still disturbed. */
    readonly disturbedAttempts: number;
    readonly repeatedPasses: number;
    readonly disturbedAfterRetry: number;
  };
  readonly physicsInfo: { readonly sleepingBodies: number | null } | null;
}

export interface RawRun {
  readonly dir: string;
  readonly meta: RawRunMeta;
  readonly environment: EnvironmentRecord;
  readonly pairs: ReadonlyMap<string, RawPairFile>;
  readonly floor: RawPairFile | null;
  readonly sizes: readonly SizeEntry[];
  /** `parity/<workload>--<impl>.png` decoded, keyed `workload--impl`. */
  readonly pictures: ReadonlyMap<string, Uint8Array>;
}

export interface SizeEntry {
  readonly workload: string;
  readonly implementation: string;
  readonly javascript: { readonly rawBytes: number; readonly gzipBytes: number };
  readonly javascriptMinified: { readonly rawBytes: number; readonly gzipBytes: number };
  readonly programData: { readonly rawBytes: number; readonly gzipBytes: number } | null;
  readonly lazy: readonly string[];
}

export function loadRun(dir: string): RawRun {
  const read = <T>(name: string): T => JSON.parse(readFileSync(join(dir, name), "utf8")) as T;
  const meta = read<RawRunMeta>("run.json");
  const environment = read<EnvironmentRecord>("environment.json");
  const pairs = new Map<string, RawPairFile>();
  let floor: RawPairFile | null = null;
  for (const name of readdirSync(dir)) {
    if (name === "floor.json") floor = read<RawPairFile>(name);
    else if (name.includes("--") && name.endsWith(".json")) pairs.set(name.slice(0, -".json".length), read<RawPairFile>(name));
  }
  const pictures = new Map<string, Uint8Array>();
  const parityDir = join(dir, "parity");
  if (existsSync(parityDir)) {
    for (const name of readdirSync(parityDir)) {
      if (name.endsWith(".png")) pictures.set(name.slice(0, -".png".length), decodePng(readFileSync(join(parityDir, name))).rgba);
    }
  }
  const sizes = existsSync(join(dir, "sizes.json")) ? read<SizeEntry[]>("sizes.json") : [];
  return { dir, meta, environment, pairs, floor, sizes, pictures };
}

/** The attempts that count for a pass, one per run, in run order (a disturbed pass that was repeated counts with its first undisturbed attempt). */
function jobsOf(file: RawPairFile | undefined, pass: string): RawJob[] {
  return chooseAttempts((file?.jobs ?? []).filter((j) => j.pass === pass)).sort((a, b) => a.run - b.run);
}

function numbers(value: unknown): number[] {
  return Array.isArray(value) ? (value as number[]) : [];
}

function startupCounts(counts: { create: Record<string, number>; firstFrame: Record<string, number>; warmup: Record<string, number> }): StartupCounts {
  const sum = (key: string): number => (counts.create[key] ?? 0) + (counts.firstFrame[key] ?? 0) + (counts.warmup[key] ?? 0);
  return {
    pipelines: sum("renderPipelinesCreated") + sum("computePipelinesCreated"),
    shaderModules: sum("shaderModulesCreated"),
    buffers: sum("buffersCreated"),
    textures: sum("texturesCreated"),
    bindGroups: sum("bindGroupsCreated"),
    samplers: sum("samplersCreated"),
    bufferBytes: sum("bufferBytesCreated"),
    textureBytes: sum("textureBytesCreated"),
    uploadBytes: sum("writeBufferBytes") + sum("writeTextureBytes") + sum("externalImageBytes") + sum("mappedAtCreationBytes"),
  };
}

function summarizeCounts(job: RawJob | undefined): CountsSummary | null {
  if (job === undefined || job.status !== "ok") return null;
  const r = job.result as {
    frames: number;
    create: Record<string, number>;
    firstFrame: Record<string, number>;
    warmup: Record<string, number>;
    steady: { total: Record<string, number>; perFrameMin: Record<string, number>; perFrameMax: Record<string, number> };
    runtimeCounters: Record<string, number> | null;
    runtimeDrawCallsPerFrame: number[];
  };
  const frames = r.frames;
  const t = r.steady.total;
  const per = (key: string): number => (t[key] ?? 0) / frames;
  const created = ["buffersCreated", "texturesCreated", "samplersCreated", "shaderModulesCreated", "bindGroupsCreated", "renderPipelinesCreated", "computePipelinesCreated"];
  // An upper bound: the largest per-frame count of each kind of object, added up.
  const maxOf = (keys: string[]): number => keys.reduce((sum, k) => sum + (r.steady.perFrameMax[k] ?? 0), 0);
  const constant = ["drawCalls", "writeBufferBytes", "writeBufferCalls"].every((k) => r.steady.perFrameMin[k] === r.steady.perFrameMax[k]);
  const startup = startupCounts(r);
  let cross: RuntimeCrossCheck | null = null;
  if (r.runtimeCounters !== null) {
    const runtimeDraw = median(r.runtimeDrawCallsPerFrame);
    const instrumentDraw = per("drawCalls");
    cross = {
      runtimeDrawCallsPerFrame: runtimeDraw,
      instrumentDrawCallsPerFrame: instrumentDraw,
      runtimePipelinesCreated: r.runtimeCounters["pipelinesCreated"] ?? NaN,
      instrumentPipelinesCreated: startup.pipelines,
      agrees: runtimeDraw === instrumentDraw && r.runtimeCounters["pipelinesCreated"] === startup.pipelines,
    };
  }
  return {
    drawCallsPerFrame: per("drawCalls"),
    instancedDrawCallsPerFrame: per("instancedDrawCalls"),
    instancesDrawnPerFrame: per("instancesDrawn"),
    setBindGroupPerFrame: per("setBindGroup"),
    renderPassesPerFrame: per("renderPassesBegun"),
    writeBufferCallsPerFrame: per("writeBufferCalls"),
    uploadBytesPerFrame: per("writeBufferBytes") + per("writeTextureBytes") + per("externalImageBytes"),
    gpuObjectsCreatedPerFrameMax: maxOf(created),
    startup,
    steadyIsConstant: constant,
    runtimeCrossCheck: cross,
  };
}

function summarizeGpu(job: RawJob | undefined): GpuTimeSummary | null {
  if (job === undefined || job.status !== "ok") return null;
  const r = job.result as { available: boolean; reason: string | null; timedFrames?: number; gpuMs?: number[] };
  if (!r.available || r.gpuMs === undefined || r.gpuMs.length === 0) {
    return { available: false, reason: r.reason ?? "unavailable", timedFrames: 0, percentiles: null };
  }
  return { available: true, reason: null, timedFrames: r.gpuMs.length, percentiles: percentileSetOf(r.gpuMs) };
}

function summarizeStartup(jobs: RawJob[]): StartupSummary | null {
  const ok = jobs.filter((j) => j.status === "ok").map((j) => j.result as Record<string, number>);
  if (ok.length === 0) return null;
  const of = (key: string): Summary => summarize(ok.map((r) => r[key] as number));
  return {
    runs: ok.length,
    startupMs: of("startupMs"),
    navigationToFirstFrameMs: of("navigationToFirstFrameMs"),
    createMs: of("createMs"),
    firstFrameMs: of("firstFrameMs"),
    bundleEvaluatedMs: of("bundleEvaluatedMs"),
  };
}

/** Ordinary least squares slope of `values` against their index. */
export function slope(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  values.forEach((y, x) => {
    num += (x - meanX) * (y - meanY);
    den += (x - meanX) ** 2;
  });
  return num / den;
}

/** A resource series is a plateau when the last half of the cycles would add at most this much again. */
export const PLATEAU_GROWTH_PERCENT = 1;

export function resourceSeries(name: string, unit: string, values: readonly number[]): ResourceSeries {
  const half = values.slice(Math.floor(values.length / 2));
  const s = slope(half);
  const meanHalf = half.reduce((a, b) => a + b, 0) / Math.max(1, half.length);
  const growth = meanHalf === 0 ? 0 : (100 * s * half.length) / meanHalf;
  const at: Record<string, number> = {};
  for (const index of [1, 10, 25, values.length]) {
    if (index <= values.length) at[`cycle ${String(index)}`] = values[index - 1] as number;
  }
  const allZero = values.every((v) => v === 0);
  const deltas = values.slice(1).map((v, i) => v - (values[i] as number));
  return {
    name,
    unit,
    values,
    at,
    slopePerCycle: s,
    relativeGrowthPercent: growth,
    classification: allZero ? "zero" : growth <= PLATEAU_GROWTH_PERCENT ? "plateau" : "growing",
    medianChangePerCycle: deltas.length === 0 ? 0 : median(deltas),
    largestIncrease: deltas.length === 0 ? 0 : Math.max(0, ...deltas),
  };
}

interface CycleRecord {
  mountMs: number;
  reloadMs: number;
  disposeMs: number;
  createdDuringMount: Record<string, number>;
  createdDuringReload: Record<string, number>;
  liveBufferBytesAfterDispose: number;
  liveTextureBytesAfterDispose: number;
  devicesRequestedTotal: number;
  devicesDestroyedTotal: number;
  runtimeBeforeDispose: Record<string, number> | null;
  runtimeAfterDispose: Record<string, number> | null;
  process: Record<string, number> | null;
}

function summarizeCycles(job: RawJob | undefined): CycleSeries | null {
  if (job === undefined || job.status !== "ok") return null;
  const records = (job.result as { records: CycleRecord[] }).records;
  const column = (f: (r: CycleRecord) => number): number[] => records.map(f);
  const hasProcess = records.every((r) => r.process !== null);
  const resources: ResourceSeries[] = [];
  if (hasProcess) {
    resources.push(resourceSeries("JavaScript heap in use after a forced collection", "bytes", column((r) => (r.process as Record<string, number>)["heapUsedBytes"] ?? 0)));
    resources.push(resourceSeries("DOM nodes", "nodes", column((r) => (r.process as Record<string, number>)["Nodes"] ?? 0)));
    resources.push(resourceSeries("JavaScript event listeners", "listeners", column((r) => (r.process as Record<string, number>)["JSEventListeners"] ?? 0)));
  }
  resources.push(resourceSeries("GPU buffer bytes not destroyed after dispose", "bytes", column((r) => r.liveBufferBytesAfterDispose)));
  resources.push(resourceSeries("GPU texture bytes not destroyed after dispose", "bytes", column((r) => r.liveTextureBytesAfterDispose)));
  resources.push(resourceSeries("GPU devices not destroyed", "devices", column((r) => r.devicesRequestedTotal - r.devicesDestroyedTotal)));
  if (records.every((r) => r.runtimeAfterDispose !== null)) {
    for (const key of ["liveBuffers", "liveTextures", "liveSamplers", "liveShaderModules", "livePipelines", "liveBindGroups", "liveListeners"]) {
      resources.push(resourceSeries(`Mtek runtime ${key} after dispose`, "objects", column((r) => (r.runtimeAfterDispose as Record<string, number>)[key] ?? 0)));
    }
  }
  const mount = (key: string): number[] => column((r) => (r.createdDuringMount[key] ?? 0) + (r.createdDuringReload[key] ?? 0));
  const perCycle = {
    buffers: median(mount("buffersCreated")),
    textures: median(mount("texturesCreated")),
    pipelines: median(column((r) => (r.createdDuringMount["renderPipelinesCreated"] ?? 0) + (r.createdDuringReload["renderPipelinesCreated"] ?? 0))),
    bindGroups: median(mount("bindGroupsCreated")),
  };
  const sameEveryCycle = ["buffersCreated", "texturesCreated", "bindGroupsCreated", "renderPipelinesCreated"].every((key) => {
    const v = mount(key);
    return v.every((x) => x === v[0]);
  });
  return {
    cycles: records.length,
    mountMs: summarize(column((r) => r.mountMs)),
    reloadMs: summarize(column((r) => r.reloadMs)),
    disposeMs: summarize(column((r) => r.disposeMs)),
    lifecycleMs: summarize(column((r) => r.mountMs + r.reloadMs + r.disposeMs)),
    resources,
    creationsPerCycle: { ...perCycle, constant: sameEveryCycle },
  };
}

export function hostOf(file: RawPairFile | undefined): PairSummary["host"] {
  const jobs = file?.jobs ?? [];
  const counted = chooseAttempts(jobs);
  return {
    passes: jobs.length,
    maxBusyBeforePercent: jobs.reduce((m, j) => Math.max(m, j.hostLoad.busyBeforePercent), 0),
    noisyPasses: jobs.filter((j) => j.hostLoad.noisy).length,
    meanBusyDuringPercent: jobs.length === 0 ? 0 : jobs.reduce((s, j) => s + j.hostLoad.busyDuringPercent, 0) / jobs.length,
    disturbedAttempts: jobs.filter((j) => isDisturbed(j.hostLoad)).length,
    repeatedPasses: groupAttempts(jobs).filter((g) => g.length > 1).length,
    disturbedAfterRetry: counted.filter((j) => isDisturbed(j.hostLoad)).length,
  };
}

interface InfoSample {
  name: string;
  position: unknown;
}

function samplePositions(job: RawJob | undefined): Map<string, [number, number, number]> {
  const out = new Map<string, [number, number, number]>();
  const info = (job?.result as { info?: { sample?: InfoSample[] } | null } | undefined)?.info;
  for (const entry of info?.sample ?? []) {
    const p = entry.position as { x?: number; y?: number; z?: number } | null;
    if (p !== null && typeof p?.x === "number" && typeof p.y === "number" && typeof p.z === "number") out.set(entry.name, [p.x, p.y, p.z]);
  }
  return out;
}

export function summarizePair(run: RawRun, workload: string, implementation: string): PairSummary {
  const key = `${workload}--${implementation}`;
  const file = run.pairs.get(key);
  const host = hostOf(file);
  if (file === undefined) {
    return { workload, implementation, status: "missing", errors: ["no raw result for this implementation"], frame: null, gpu: null, counts: null, jsAllocationBytesPerFrame: null, allocationSites: null, startup: null, cycles: null, cyclesLong: null, parity: null, host, physicsInfo: null };
  }
  const errors = file.jobs.filter((j) => j.status === "error").map((j) => `${j.pass}#${String(j.run)}: ${j.error ?? "failed"}`);
  const timing = jobsOf(file, "timing").filter((j) => j.status === "ok");
  let frame: PairSummary["frame"] = null;
  if (timing.length > 0) {
    const series = (key2: string): number[][] => timing.map((j) => numbers((j.result as Record<string, unknown>)[key2]));
    frame = {
      cpu: combineRuns(series("cpuMs")),
      completed: combineRuns(series("completedMs")),
      update: combineRuns(series("updateMs")),
      renderPrep: combineRuns(series("renderPrepMs")),
      drawnPixelShare: median(timing.map((j) => (j.result as { drawnPixelShare: number }).drawnPixelShare)),
    };
  }
  const alloc = jobsOf(file, "allocation")[0];
  const allocFrames = (alloc?.result as { frames?: number } | undefined)?.frames;
  const referenceKey = `${workload}--direct`;
  const own = run.pictures.get(key);
  const reference = run.pictures.get(referenceKey);
  let parity: PairSummary["parity"] = null;
  if (own !== undefined && reference !== undefined) {
    const comparison = comparePictures(reference, own);
    let maxPositionDifference: number | null = null;
    const a = samplePositions(jobsOf(file, "parity")[0]);
    const b = samplePositions(jobsOf(run.pairs.get(referenceKey), "parity")[0]);
    for (const [name, p] of a) {
      const q = b.get(name);
      if (q === undefined) continue;
      const d = Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]));
      maxPositionDifference = Math.max(maxPositionDifference ?? 0, d);
    }
    parity = { ...comparison, maxPositionDifference };
  }
  const timingInfo = (timing[0]?.result as { info?: { sleepingBodies?: number } | null } | undefined)?.info;
  return {
    workload,
    implementation,
    status: errors.length > 0 ? "error" : "ok",
    errors,
    frame,
    gpu: summarizeGpu(jobsOf(file, "gpu-time")[0]),
    counts: summarizeCounts(jobsOf(file, "counts")[0]),
    jsAllocationBytesPerFrame: alloc?.allocation !== undefined && allocFrames !== undefined && alloc.status === "ok" ? alloc.allocation.sampledBytes / allocFrames : null,
    allocationSites:
      alloc?.allocation !== undefined && allocFrames !== undefined && alloc.status === "ok"
        ? alloc.allocation.topSites.map((s) => ({ site: s.site, bytesPerFrame: s.sampledBytes / allocFrames }))
        : null,
    startup: summarizeStartup(jobsOf(file, "startup")),
    cycles: summarizeCycles(jobsOf(file, "cycles")[0]),
    cyclesLong: summarizeCycles(jobsOf(file, "cycles-long")[0]),
    parity,
    host,
    physicsInfo: timingInfo?.sleepingBodies === undefined ? null : { sleepingBodies: timingInfo.sleepingBodies },
  };
}

// ---- the 20 % investigation threshold -------------------------------------------------------------------------------

export type MetricKind = "frame" | "startup" | "lifecycle";

export interface Verdict {
  readonly workload: string;
  readonly metric: MetricKind;
  readonly metricName: string;
  readonly mtek: number | null;
  readonly direct: number | null;
  readonly three: number | null;
  readonly mtekOverDirectPercent: number | null;
  readonly threeOverDirectPercent: number | null;
  readonly outcome: "within" | "exceeds" | "not-measured";
  readonly reason: string;
}

export const THRESHOLD_PERCENT = 20;

/** The metric the 20 % threshold is applied to for a workload kind (decision 0096). */
export function primaryMetric(kind: "frames" | "startup" | "cycles"): { kind: MetricKind; name: string } {
  switch (kind) {
    case "frames":
      return { kind: "frame", name: "p95 frame time (CPU: update + render preparation + submit)" };
    case "startup":
      return { kind: "startup", name: "p95 startup latency (navigation start to first frame complete)" };
    case "cycles":
      return { kind: "lifecycle", name: "p95 of mount + reload + dispose time per cycle" };
  }
}

export function p95Of(pair: PairSummary, metric: MetricKind): number | null {
  if (pair.status === "missing") return null;
  switch (metric) {
    case "frame":
      return pair.frame?.cpu.median.p95 ?? null;
    case "startup":
      return pair.startup === null ? null : pair.startup.navigationToFirstFrameMs.p95;
    case "lifecycle":
      return pair.cycles?.lifecycleMs.p95 ?? null;
  }
}

export function verdictFor(kind: "frames" | "startup" | "cycles", workload: string, pairs: Readonly<Record<Impl, PairSummary>>): Verdict {
  const { kind: metric, name } = primaryMetric(kind);
  const mtek = p95Of(pairs.mtek, metric);
  const direct = p95Of(pairs.direct, metric);
  const three = p95Of(pairs.three, metric);
  const over = (value: number | null): number | null => (value === null || direct === null || direct <= 0 ? null : 100 * (value / direct - 1));
  const mtekOver = over(mtek);
  if (mtek === null || direct === null) {
    return { workload, metric, metricName: name, mtek, direct, three, mtekOverDirectPercent: null, threeOverDirectPercent: over(three), outcome: "not-measured", reason: pairs.mtek.errors[0] ?? pairs.direct.errors[0] ?? "no measurement" };
  }
  const outcome = (mtekOver as number) <= THRESHOLD_PERCENT ? "within" : "exceeds";
  return {
    workload,
    metric,
    metricName: name,
    mtek,
    direct,
    three,
    mtekOverDirectPercent: mtekOver,
    threeOverDirectPercent: over(three),
    outcome,
    reason: "",
  };
}

export { percentileSorted };
