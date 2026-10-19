// Generates `benchmarks/results/runtime/report.md` and `summary.json` from the raw results of one run.
//
//   node tools/report.ts [--run=<run-id>] [--check]
//
// Every number in the report is computed by `analyze.ts` from the files under `raw/<run-id>/`; nothing is typed in by hand.
// `--check` regenerates both files in memory and fails when the committed ones differ, which is how the reproducibility of
// the report from the stored raw results is verified (`report.test.ts` runs it over the published run).
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readWorkload, type WorkloadFile } from "./gen-mtek.ts";
import {
  IMPLEMENTATION_ORDER,
  PLATEAU_GROWTH_PERCENT,
  THRESHOLD_PERCENT,
  loadRun,
  summarizePair,
  verdictFor,
  type CycleSeries,
  type Impl,
  type PairSummary,
  type RawRun,
  type ResourceSeries,
  type SizeEntry,
  type Verdict,
} from "./analyze.ts";
import { MAX_DIFFERING_SHARE, CHANNEL_TOLERANCE } from "./parity.ts";
import { RAW_DIR, RESULTS_DIR, WORKLOADS, type WorkloadName } from "./paths.ts";
import { stringifyCompact } from "./json.ts";
import type { PercentileSet, RunPercentiles } from "./analyze.ts";

// ---- formatting ---------------------------------------------------------------------------------------------------

export function fmtMs(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  if (value >= 100) return `${value.toFixed(1)} ms`;
  if (value >= 10) return `${value.toFixed(2)} ms`;
  return `${value.toFixed(3)} ms`;
}

export function fmtNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return value.toFixed(digits);
}

export function fmtInt(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return Math.round(value).toLocaleString("en-US");
}

export function fmtBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  const abs = Math.abs(value);
  if (abs >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MiB`;
  if (abs >= 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${value.toFixed(0)} B`;
}

export function fmtPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(1)} %`;
}

export function fmtRatio(value: number | null, reference: number | null): string {
  if (value === null || reference === null || reference <= 0) return "n/a";
  const ratio = value / reference;
  return ratio >= 10 ? `${ratio.toFixed(1)}x` : `${ratio.toFixed(2)}x`;
}

const triple = (set: PercentileSet): string => `${fmtMs(set.p50)} / ${fmtMs(set.p95)} / ${fmtMs(set.p99)}`;
const pair2 = (set: PercentileSet): string => `${fmtMs(set.p50)} / ${fmtMs(set.p95)}`;

function range95(runs: RunPercentiles): string {
  return runs.runs > 1 ? ` (p95 over ${String(runs.runs)} runs: ${fmtMs(runs.min.p95)} to ${fmtMs(runs.max.p95)})` : "";
}

function table(header: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
  const line = (cells: readonly string[]): string => `| ${cells.join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n");
}

const IMPL_LABEL: Readonly<Record<Impl, string>> = { mtek: "Mtek", direct: "direct WebGPU", three: "three.js" };

// ---- the data ------------------------------------------------------------------------------------------------------

export interface WorkloadReport {
  readonly name: WorkloadName;
  readonly file: WorkloadFile;
  readonly pairs: Readonly<Record<Impl, PairSummary>>;
  readonly verdict: Verdict;
}

export interface FloorSummary {
  readonly cpu: PercentileSet | null;
  readonly completed: PercentileSet | null;
  readonly gpu: PercentileSet | null;
  readonly jsAllocationBytesPerFrame: number | null;
}

export function collect(run: RawRun, workloads: readonly WorkloadName[] = WORKLOADS): { reports: WorkloadReport[]; floor: FloorSummary } {
  const reports = workloads.map((name) => {
    const file = readWorkload(name);
    const pairs = Object.fromEntries(IMPLEMENTATION_ORDER.map((impl) => [impl, summarizePair(run, name, impl)])) as Record<Impl, PairSummary>;
    return { name, file, pairs, verdict: verdictFor(file.kind, name, pairs) };
  });
  const floor = run.floor === null ? null : summarizePair({ ...run, pairs: new Map([["floor--floor", run.floor]]) }, "floor", "floor");
  return {
    reports,
    floor: {
      cpu: floor?.frame?.cpu.median ?? null,
      completed: floor?.frame?.completed.median ?? null,
      gpu: floor?.gpu?.percentiles ?? null,
      jsAllocationBytesPerFrame: floor?.jsAllocationBytesPerFrame ?? null,
    },
  };
}

// ---- sections ------------------------------------------------------------------------------------------------------

function summarySection(reports: readonly WorkloadReport[]): string {
  const rows = reports.map((r) => {
    const v = r.verdict;
    const cell = (value: number | null): string => (value === null ? "n/a" : fmtMs(value));
    return [
      `[${r.file.title}](#${r.name})`,
      v.metricName,
      cell(v.mtek),
      cell(v.direct),
      cell(v.three),
      fmtPercent(v.mtekOverDirectPercent),
      fmtPercent(v.threeOverDirectPercent),
      v.outcome === "within" ? "within 20 %" : v.outcome === "exceeds" ? "**exceeds 20 %**" : "not measured",
    ];
  });
  const exceeding = reports.filter((r) => r.verdict.outcome === "exceeds");
  const within = reports.filter((r) => r.verdict.outcome === "within");
  const unmeasured = reports.filter((r) => r.verdict.outcome === "not-measured");
  const lines = [
    table(["Workload", "Threshold metric", "Mtek", "direct WebGPU", "three.js", "Mtek vs direct", "three.js vs direct", `Threshold (${String(THRESHOLD_PERCENT)} %)`], rows),
    "",
    `The investigation threshold of spec/ai-and-benchmarks.md section 7 is a **proposal, not a speed guarantee**: a p95 more than ${String(THRESHOLD_PERCENT)} % above the direct-WebGPU reference on the same machine means the cause must be investigated before release copy says anything about performance. ` +
      `Of ${String(reports.length)} workloads, **${String(exceeding.length)} exceed it**${exceeding.length > 0 ? ` (${exceeding.map((r) => r.file.title).join("; ")})` : ""}, ${String(within.length)} are within it${within.length > 0 ? ` (${within.map((r) => r.file.title).join("; ")})` : ""}` +
      `${unmeasured.length > 0 ? `, and ${String(unmeasured.length)} could not be measured (${unmeasured.map((r) => `${r.file.title}: ${r.verdict.reason}`).join("; ")})` : ""}. No workload was removed or relaxed after a failure. The spec's "controlled core-rendering workload" is the constant scene (decision 0096); the others are held to the same number so that none escapes.`,
  ];
  return lines.join("\n");
}

function failingSection(reports: readonly WorkloadReport[]): string {
  const out: string[] = [];
  const exceeding = reports.filter((r) => r.verdict.outcome === "exceeds");
  out.push(exceeding.length === 0 ? "No workload exceeds the threshold." : "Every workload that exceeds the threshold, with what the counters of the same run show:");
  out.push("");
  for (const r of exceeding) {
    const m = r.pairs.mtek;
    const d = r.pairs.direct;
    const t = r.pairs.three;
    const facts: string[] = [];
    if (m.counts !== null && d.counts !== null) {
      facts.push(`draw calls per frame: Mtek ${fmtNumber(m.counts.drawCallsPerFrame, 0)} (${fmtNumber(m.counts.instancedDrawCallsPerFrame, 0)} instanced), direct ${fmtNumber(d.counts.drawCallsPerFrame, 0)}, three.js ${fmtNumber(t.counts?.drawCallsPerFrame ?? null, 0)}`);
      facts.push(`\`writeBuffer\` calls per frame: Mtek ${fmtNumber(m.counts.writeBufferCallsPerFrame, 0)}, direct ${fmtNumber(d.counts.writeBufferCallsPerFrame, 0)}, three.js ${fmtNumber(t.counts?.writeBufferCallsPerFrame ?? null, 0)}`);
      facts.push(`bytes uploaded per frame: Mtek ${fmtBytes(m.counts.uploadBytesPerFrame)}, direct ${fmtBytes(d.counts.uploadBytesPerFrame)}, three.js ${fmtBytes(t.counts?.uploadBytesPerFrame ?? null)}`);
    }
    if (m.frame !== null && d.frame !== null) {
      facts.push(`CPU update / render preparation p50: Mtek ${fmtMs(m.frame.update.median.p50)} / ${fmtMs(m.frame.renderPrep.median.p50)}, direct ${fmtMs(d.frame.update.median.p50)} / ${fmtMs(d.frame.renderPrep.median.p50)}`);
    }
    if (m.jsAllocationBytesPerFrame !== null && d.jsAllocationBytesPerFrame !== null) {
      facts.push(`JavaScript allocation per frame (sampled): Mtek ${fmtBytes(m.jsAllocationBytesPerFrame)}, direct ${fmtBytes(d.jsAllocationBytesPerFrame)}, three.js ${fmtBytes(t.jsAllocationBytesPerFrame)}`);
    }
    out.push(`- **${r.file.title}**: ${r.verdict.metricName}: Mtek ${fmtMs(r.verdict.mtek)} against direct ${fmtMs(r.verdict.direct)} (${fmtPercent(r.verdict.mtekOverDirectPercent)}, ${fmtRatio(r.verdict.mtek, r.verdict.direct)}); three.js ${fmtMs(r.verdict.three)} (${fmtPercent(r.verdict.threeOverDirectPercent)}).${facts.length > 0 ? ` ${facts.join("; ")}.` : ""}`);
  }
  out.push("");
  const errored = reports.flatMap((r) => IMPLEMENTATION_ORDER.map((impl) => ({ r, impl, pair: r.pairs[impl] }))).filter((x) => x.pair.status !== "ok");
  if (errored.length === 0) {
    out.push("Every implementation of every workload ran to completion in every pass (no page error, no uncaptured GPU validation error, no device loss).");
  } else {
    out.push("Implementations that errored or are missing (never dropped from the comparison):");
    out.push("");
    for (const x of errored) out.push(`- ${x.r.file.title}, ${IMPL_LABEL[x.impl]}: ${x.pair.status}; ${x.pair.errors.join(" | ")}`);
  }
  return out.join("\n");
}

function environmentSection(run: RawRun, floor: FloorSummary): string {
  const e = run.environment;
  const adapter = e.gpu.adapter;
  const m = run.meta;
  const all = [...run.pairs.values(), ...(run.floor === null ? [] : [run.floor])].flatMap((f) => f.jobs);
  const busyBefore = all.map((j) => j.hostLoad.busyBeforePercent);
  const busyDuring = all.map((j) => j.hostLoad.busyDuringPercent);
  const timer = all.map((j) => (j.result as { page?: { timerGranularityMs?: number; crossOriginIsolated?: boolean } } | undefined)?.page).filter((p) => p !== undefined);
  const granularity = timer.length === 0 ? NaN : Math.max(...timer.map((p) => p?.timerGranularityMs ?? NaN));
  const isolated = timer.length > 0 && timer.every((p) => p?.crossOriginIsolated === true);
  const rows: string[][] = [
    ["Run id", `\`${m.runId}\`${m.smoke ? " (SMOKE: not a result)" : ""}`],
    ["Started / finished (UTC)", `${m.startedAt} / ${m.finishedAt}`],
    ["Source commit", `\`${m.gitCommit}\` (working tree ${m.gitDirty ? "dirty" : "clean"})`],
    ["Frozen definitions (tree hash)", `\`${m.frozen.treeHash}\` (${m.frozen.matches ? "equals the last entry of FROZEN.json" : "DOES NOT equal FROZEN.json"})`],
    ["Operating system", `${e.os.version} ${e.os.release}, ${e.os.arch}`],
    ["Browser", `${e.browser.name} ${e.browser.version} (${e.browser.channel} channel, ${e.browser.headless ? "headless" : "headed"})`],
    ["Launch arguments", `\`${e.browser.launchArgs.join(" ")}\``],
    ["Adapter", adapter === null ? "none" : `${adapter.info.description || adapter.info.vendor} (vendor ${adapter.info.vendor}, architecture ${adapter.info.architecture}, device ${adapter.info.device})`],
    ["`isFallbackAdapter`", adapter === null ? "n/a" : String(adapter.info.isFallbackAdapter)],
    ["`timestamp-query`", adapter === null ? "n/a" : adapter.adapterFeatures.includes("timestamp-query") ? "supported by the adapter; requested on the device in the GPU-time pass only" : "NOT supported: GPU time is unavailable"],
    ["Toolchain", `Node ${e.toolchain.node}, Playwright ${e.toolchain.playwright}, ${e.toolchain.rustc}; mtek ${m.versions.mtek}, runtime-web ${m.versions.runtimeWeb}, three.js ${m.versions.three}, Rapier ${m.versions.rapier}`],
    ["Timer", `\`performance.now()\` resolution at most ${fmtMs(granularity)} (page ${isolated ? "is" : "is NOT"} cross-origin isolated)`],
    ["Render target", `${String(m.protocol.target.width)} x ${String(m.protocol.target.height)} ${m.protocol.target.colorFormat}, depth ${m.protocol.target.depthFormat}, offscreen (no presentation)`],
    ["Frame delta", `${String(m.protocol.frameDeltaSeconds)} s (one fixed physics tick per frame)`],
    ["Frames", `${String(m.protocol.warmupFrames)} warm-up, then ${String(m.protocol.timingFrames)} measured per timing run, ${String(m.protocol.timingRuns)} timing runs per implementation (each in a fresh page); GPU time ${String(m.protocol.gpuTimeFrames)} frames; allocation ${String(m.protocol.allocationFrames)} frames; counters ${String(m.protocol.countFrames)} frames; startup ${String(m.protocol.startupRuns)} fresh page loads; ${String(m.protocol.cycles)} + ${String(m.protocol.longCycles)} cycles`],
    ["Pass order", `shuffled with seed ${String(m.seed)} (${String(m.order.length)} passes, listed in run.json)`],
    ["Machine load", `${String(all.length)} passes; busy share of all logical CPUs before a pass: median ${fmtNumber(medianOf(busyBefore), 0)} %, maximum ${fmtNumber(Math.max(...busyBefore), 0)} %; during a pass (includes the benchmark's own browser): mean ${fmtNumber(mean(busyDuring), 0)} %; passes that started above the ${String(m.quietLimitPercent)} % quiet limit after waiting: ${String(all.filter((j) => j.hostLoad.noisy).length)}`],
    ["GPU lock", m.gpuLockConfigured ? "every pass ran while holding the machine's GPU lock (no other GPU user overlapped)" : "no GPU lock was configured"],
  ];
  const lines = [table(["Item", "Value"], rows), ""];
  lines.push(
    "The machine is a shared workstation: other processes (other agents' builds and browser tests) may have run on its CPU during a pass, which no setting here can exclude. The load columns above are measured, not assumed. Wall-clock outliers are therefore reported as measured (p99 and the min/max of the p95 across runs), never trimmed.",
  );
  lines.push("");
  lines.push(
    `**Harness floor.** An application that clears the target and draws nothing, run through the same passes: frame time (CPU) p50 / p95 / p99 ${floor.cpu === null ? "n/a" : triple(floor.cpu)}; frame latency to GPU completion ${floor.completed === null ? "n/a" : triple(floor.completed)}; GPU time ${floor.gpu === null ? "n/a (unavailable)" : triple(floor.gpu)}; JavaScript allocation per frame ${fmtBytes(floor.jsAllocationBytesPerFrame)}. Everything below includes this floor.`,
  );
  return lines.join("\n");
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? NaN : values.reduce((a, b) => a + b, 0) / values.length;
}

function medianOf(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

const METHOD = `
**Frame time.** For every frame the page times \`app.frame(dt)\` with \`performance.now()\`: update (application work: input, ticks and physics, update functions, bindings, transform propagation, animation maths) plus render preparation (culling, draw-list building, uploads, command encoding) up to the return of \`queue.submit\`. That CPU time is the **frame time** the 20 % threshold is applied to, as p50 / p95 / p99 over the measured frames of each run (nearest-rank percentiles), reported as the median across the runs with the range of the p95. Frames are driven by a manual loop (not \`requestAnimationFrame\`) into an offscreen target, so the numbers are not capped by the display's refresh rate; the loop waits for \`queue.onSubmittedWorkDone()\` before the next frame, which keeps at most one frame in flight and keeps the CPU measurement free of back-pressure. The wait is also timed, as **frame latency to GPU completion**; it contains a queue round trip that an empty frame already pays (the floor above), so it is reported but not used for the threshold.

**GPU time.** Only from \`timestamp-query\`: the page puts \`timestampWrites\` on every render pass of the frame and sums end minus begin; the pass runs on its own page load with the feature requested on the device. When the adapter lacks the feature the figure is printed as unavailable; it is never derived from CPU clocks.

**CPU update time and render-preparation time** are the two parts of the frame time above. Mtek's own counters \`cpuUpdateMs\` and \`renderPrepMs\` are used for the Mtek side; the direct and three.js implementations time the same two parts around their own code (their update is the animation maths and physics; three.js does its matrix updates inside \`renderer.render\`, i.e. in render preparation). The split is a convention; the total is the comparable number.

**Draw calls, uploads, pipelines, allocations** are counted by an instrument that wraps the WebGPU API before any application code runs (the same code counts all three implementations, in passes of their own so the wrapping costs no frame time): draw calls (\`draw*\`), \`writeBuffer\`/\`writeTexture\`/\`copyExternalImageToTexture\` calls and bytes (**upload bytes**), and creations of pipelines, shader modules, buffers, textures, samplers and bind groups. **Allocations** are two numbers (decision 0095): the GPU objects created per steady frame (zero for a renderer that retains its resources) and the JavaScript heap bytes allocated per frame, taken by the Chrome DevTools Protocol sampling heap profiler (4 KiB sampling interval, collected objects included) over measured frames; it is a statistical estimate and includes what the frame loop of the harness itself allocates (see the floor). Mtek's own counters are used as a cross-check of the instrument in section 3.

**Startup latency** is the time from the start of the page's navigation to the completion of the first frame on the GPU, over fresh page loads in fresh browser contexts (no HTTP cache; the files come from a local server, so network latency is absent). It includes parsing the page's script, for Mtek the dynamic import of the program and the runtime (as shipped, unminified), fetching and validating the manifest, shaders and assets, compiling shaders and pipelines, and the first frame.

**Bundle size** is the JavaScript the page runs, raw and gzip (level 9): Mtek as \`mtek build\` ships it (v0.1 does not minify), direct and three.js as bundled by esbuild without minification; the minified figures apply esbuild's minifier to all three (an upper bound on a production build). Mtek's program data (manifest, shader files, packaged assets) is listed separately; the physics module of Mtek is a lazily loaded file counted in its JavaScript total.

**What the three implementations are** (the direct reference is the design a competent engineer would choose for the workload, not a re-implementation of Mtek's renderer, so differences in draw-call structure are part of what is measured; the three.js baseline uses the three.js idiom of the workload, instancing only where the workload is about instancing):
`.trim();

const IMPLEMENTATION_NOTES: Readonly<Record<WorkloadName, readonly [string, string, string]>> = {
  "constant-scene": [
    "400 entities of a `Block` prefab with a colour param: entities of one colour share a parameter block, so the runtime groups them (8 colours) into instanced draws.",
    "One instance buffer (matrices and colours) written once; one instanced draw call per frame.",
    "400 `Mesh` objects sharing one geometry and 8 materials; matrices computed once and `matrixAutoUpdate` / `matrixWorldAutoUpdate` switched off.",
  ],
  "changing-transforms": [
    "1,000 entities of a `Mover` prefab whose `position` and `rotation` are `bind(...)` expressions of `frame.time`; all share one parameter block, so one instanced draw whose instance data changes every frame.",
    "One instance buffer of matrices rewritten every frame with one `writeBuffer`; one instanced draw call.",
    "1,000 `Mesh` objects (shared geometry and material); position and rotation assigned every frame; `renderer.render` updates the matrices.",
  ],
  "changing-material-params": [
    "500 entities of a `Glow` prefab whose material `color` param is a `bind(...)` of `frame.time`: 500 parameter blocks of their own, rewritten every frame, 500 individual draws.",
    "Per-instance colours in a vertex buffer rewritten every frame with one `writeBuffer`; matrices written once; one instanced draw call.",
    "500 `Mesh` objects, each with its own `MeshBasicMaterial` whose colour is assigned every frame; matrices computed once.",
  ],
  "repeated-meshes": [
    "2,000 entities of one mesh and one constant parameter block (each with its own transform): the instancing path, one instanced draw; nothing uploaded after startup.",
    "One instance buffer written once; one instanced draw call.",
    "One `InstancedMesh` of 2,000 instances, matrices written once.",
  ],
  "asset-heavy-startup": [
    "`asset.glb` (4 meshes, 21,600 triangles each) and 8 `asset.texture` PNGs of 512 x 512, a `Skin` material sampling the texture; 12 entities.",
    "GLB and PNGs fetched in parallel with the device request; vertex/index buffers, `createImageBitmap` + `copyExternalImageToTexture`; one textured pipeline, 12 draws.",
    "`GLTFLoader` for the GLB, `createImageBitmap` for the PNGs, a `MeshBasicMaterial` per texture, 12 meshes; loader, decoding and `renderer.init()` concurrent.",
  ],
  "physics-bodies": [
    "300 `Crate` entities (`Dynamic` body, `BoxCollider`) and a static floor; `fixed_update` applies a small periodic force to each crate so none sleeps; Rapier through Mtek's adapter (collision events enabled on every collider, as the adapter does).",
    "Rapier 0.21.0 used directly (no collision events), the same bodies, colliders, forces and tick order; poses written into one instance buffer every frame; one instanced draw.",
    "The same Rapier code as the direct implementation; 300 crate `Mesh` objects and a floor mesh, poses assigned every frame.",
  ],
  "mount-reload-dispose": [
    "A 100-box scene mounted with `mountMtek`, reloaded with `replaceProgram` (a program edit that shifts the palette; development runtime flavour, the only one with reload), disposed with `dispose()`.",
    "Mount: adapter, device, targets, pipeline, buffers. Reload: scene buffers released and rebuilt on the same device with the same pipeline. Dispose: all buffers, targets and the device destroyed.",
    "Mount: renderer and scene. Reload: meshes removed, geometry and materials disposed, scene rebuilt. Dispose: geometry, materials, target and renderer disposed (which also destroys the device).",
  ],
};

function implementationsSection(): string {
  const rows = WORKLOADS.map((name) => {
    const [mtek, direct, three] = IMPLEMENTATION_NOTES[name];
    return [`\`${name}\``, mtek, direct, three];
  });
  return table(["Workload", "Mtek", "direct WebGPU", "three.js"], rows);
}

function row(label: string, pairs: Readonly<Record<Impl, PairSummary>>, cell: (p: PairSummary) => string, ratio?: (p: PairSummary) => number | null): string[] {
  const cells = IMPLEMENTATION_ORDER.map((impl) => cell(pairs[impl]));
  const vs = ratio === undefined ? "" : fmtPercentCell(ratio(pairs.mtek), ratio(pairs.direct));
  return [label, ...cells, vs];
}

function fmtPercentCell(mtek: number | null, direct: number | null): string {
  if (mtek === null || direct === null || direct <= 0) return "";
  return fmtPercent(100 * (mtek / direct - 1));
}

function workloadSection(r: WorkloadReport, floor: FloorSummary): string {
  const { pairs } = r;
  const out: string[] = [`<a id="${r.name}"></a>`, "", `### ${r.file.title}`, "", r.file.description, ""];
  const rows: string[][] = [];
  const frame = (f: (p: PairSummary) => string): ((p: PairSummary) => string) => (p) => (p.frame === null ? "n/a" : f(p));
  if (r.file.kind !== "cycles") {
    rows.push(row("Frame time (CPU) p50 / p95 / p99", pairs, frame((p) => `${triple((p.frame as NonNullable<PairSummary["frame"]>).cpu.median)}${range95((p.frame as NonNullable<PairSummary["frame"]>).cpu)}`), (p) => p.frame?.cpu.median.p95 ?? null));
    rows.push(row("CPU update time p50 / p95", pairs, frame((p) => pair2((p.frame as NonNullable<PairSummary["frame"]>).update.median)), (p) => p.frame?.update.median.p95 ?? null));
    rows.push(row("Render preparation p50 / p95", pairs, frame((p) => pair2((p.frame as NonNullable<PairSummary["frame"]>).renderPrep.median)), (p) => p.frame?.renderPrep.median.p95 ?? null));
    rows.push(row(`Frame latency to GPU completion p50 / p95 / p99 (floor ${floor.completed === null ? "n/a" : fmtMs(floor.completed.p50)} p50)`, pairs, frame((p) => triple((p.frame as NonNullable<PairSummary["frame"]>).completed.median)), (p) => p.frame?.completed.median.p95 ?? null));
    rows.push(
      row("GPU time p50 / p95 / p99 (timestamp-query)", pairs, (p) =>
        p.gpu === null ? "n/a" : p.gpu.available && p.gpu.percentiles !== null ? `${triple(p.gpu.percentiles)} over ${String(p.gpu.timedFrames)} frames` : `unavailable (${p.gpu.reason ?? "no reason recorded"})`,
        (p) => p.gpu?.percentiles?.p95 ?? null,
      ),
    );
    const counts = (f: (c: NonNullable<PairSummary["counts"]>) => string): ((p: PairSummary) => string) => (p) => (p.counts === null ? "n/a" : f(p.counts));
    rows.push(row("Draw calls per frame (of which instanced)", pairs, counts((c) => `${fmtNumber(c.drawCallsPerFrame, 0)} (${fmtNumber(c.instancedDrawCallsPerFrame, 0)})`)));
    rows.push(row("`writeBuffer` calls per frame", pairs, counts((c) => fmtNumber(c.writeBufferCallsPerFrame, 0))));
    rows.push(row("Upload bytes per frame", pairs, counts((c) => fmtBytes(c.uploadBytesPerFrame))));
    rows.push(row("GPU objects created in a steady frame (at most)", pairs, counts((c) => fmtNumber(c.gpuObjectsCreatedPerFrameMax, 0))));
    rows.push(row("JavaScript allocation per frame (sampled)", pairs, (p) => fmtBytes(p.jsAllocationBytesPerFrame)));
    rows.push(row("Pipelines / shader modules created at startup", pairs, counts((c) => `${fmtNumber(c.startup.pipelines, 0)} / ${fmtNumber(c.startup.shaderModules, 0)}`)));
    rows.push(row("Buffers / textures / bind groups created at startup", pairs, counts((c) => `${fmtNumber(c.startup.buffers, 0)} / ${fmtNumber(c.startup.textures, 0)} / ${fmtNumber(c.startup.bindGroups, 0)}`)));
    rows.push(row("Bytes uploaded during startup and warm-up", pairs, counts((c) => fmtBytes(c.startup.uploadBytes))));
    if (r.name === "physics-bodies") {
      rows.push(row("Bodies asleep at the end of the timing run", pairs, (p) => (p.physicsInfo === null ? "not observable" : fmtInt(p.physicsInfo.sleepingBodies))));
    }
  }
  const startup = (f: (s: NonNullable<PairSummary["startup"]>) => string): ((p: PairSummary) => string) => (p) => (p.startup === null ? "n/a" : f(p.startup));
  rows.push(row(`Startup latency, navigation to first frame: median / p95 (${String(pairs.mtek.startup?.runs ?? 0)} fresh loads)`, pairs, startup((s) => `${fmtMs(s.navigationToFirstFrameMs.p50)} / ${fmtMs(s.navigationToFirstFrameMs.p95)}`), (p) => p.startup?.navigationToFirstFrameMs.p95 ?? null));
  rows.push(row("  of which create (mount) / first frame, median", pairs, startup((s) => `${fmtMs(s.createMs.p50)} / ${fmtMs(s.firstFrameMs.p50)}`)));
  if (r.file.kind === "cycles") {
    const cycles = (f: (c: CycleSeries) => string): ((p: PairSummary) => string) => (p) => (p.cycles === null ? "n/a" : f(p.cycles));
    rows.push(row("Mount, p50 / p95 over the cycles", pairs, cycles((c) => pair2(c.mountMs)), (p) => p.cycles?.mountMs.p95 ?? null));
    rows.push(row("Reload, p50 / p95", pairs, cycles((c) => pair2(c.reloadMs)), (p) => p.cycles?.reloadMs.p95 ?? null));
    rows.push(row("Dispose, p50 / p95", pairs, cycles((c) => pair2(c.disposeMs)), (p) => p.cycles?.disposeMs.p95 ?? null));
    rows.push(row("Mount + reload + dispose, p50 / p95 (threshold metric)", pairs, cycles((c) => pair2(c.lifecycleMs)), (p) => p.cycles?.lifecycleMs.p95 ?? null));
    rows.push(row("GPU objects created per cycle: buffers / pipelines / bind groups (constant every cycle?)", pairs, cycles((c) => `${fmtNumber(c.creationsPerCycle.buffers, 0)} / ${fmtNumber(c.creationsPerCycle.pipelines, 0)} / ${fmtNumber(c.creationsPerCycle.bindGroups, 0)} (${c.creationsPerCycle.constant ? "yes" : "no"})`)));
  }
  out.push(table(["Metric", "Mtek", "direct WebGPU", "three.js", "Mtek vs direct (p95 or total)"], rows));
  out.push("");
  const sites = pairs.mtek.allocationSites;
  if (r.file.kind !== "cycles" && sites !== null && sites.length > 0) {
    out.push(
      `Where Mtek's JavaScript allocation comes from (sampling profile, bytes per frame, largest sites; function and line of the runtime bundle as built): ${sites
        .slice(0, 5)
        .map((s) => `\`${s.site}\` ${fmtBytes(s.bytesPerFrame)}`)
        .join("; ")}.`,
    );
    out.push("");
  }
  const v = r.verdict;
  out.push(
    v.outcome === "not-measured"
      ? `**Threshold: not measured** (${v.reason}).`
      : `**Threshold metric: ${v.metricName}.** Mtek ${fmtMs(v.mtek)}, direct ${fmtMs(v.direct)}, three.js ${fmtMs(v.three)}: Mtek is ${fmtPercent(v.mtekOverDirectPercent)} (${fmtRatio(v.mtek, v.direct)}) against direct WebGPU, three.js ${fmtPercent(v.threeOverDirectPercent)}; ${v.outcome === "within" ? `within the ${String(THRESHOLD_PERCENT)} % investigation threshold` : `**exceeds the ${String(THRESHOLD_PERCENT)} % investigation threshold**`}.`,
  );
  return out.join("\n");
}

function parityAndCrossCheckSection(reports: readonly WorkloadReport[]): string {
  const rows: string[][] = [];
  for (const r of reports) {
    for (const impl of ["mtek", "three"] as const) {
      const p = r.pairs[impl].parity;
      rows.push([
        r.file.title,
        IMPL_LABEL[impl],
        p === null ? "n/a" : fmtInt(p.differingPixels),
        p === null ? "n/a" : `${(100 * p.differingShare).toFixed(4)} %`,
        p === null ? "n/a" : String(p.maxChannelDifference),
        p === null ? "n/a" : `${(100 * p.referenceDrawnShare).toFixed(1)} %`,
        p === null ? "n/a" : p.maxPositionDifference === null ? "not compared" : `${p.maxPositionDifference.toExponential(2)} m`,
        p === null ? "no picture" : p.sameScene ? "same scene" : "**DIFFERENT**",
      ]);
    }
  }
  const cross = reports.map((r) => {
    const c = r.pairs.mtek.counts?.runtimeCrossCheck ?? null;
    return [
      r.file.title,
      c === null ? "n/a" : `${fmtNumber(c.runtimeDrawCallsPerFrame, 0)} / ${fmtNumber(c.instrumentDrawCallsPerFrame, 0)}`,
      c === null ? "n/a" : `${fmtNumber(c.runtimePipelinesCreated, 0)} / ${fmtNumber(c.instrumentPipelinesCreated, 0)}`,
      c === null ? "n/a" : c.agrees ? "agree" : "**DIFFER**",
    ];
  });
  return [
    `Each implementation draws its scene after the workload's parity frames and the picture is stored (\`raw/<run>/parity/\`). A pixel counts as different when a colour channel differs from the direct implementation's by more than ${String(CHANNEL_TOLERANCE)} of 255; two pictures show the same scene when at most ${String(100 * MAX_DIFFERING_SHARE)} % of the pixels differ and the picture is not blank. The position column compares the first bodies or entities each side reports (physics only).`,
    "",
    table(["Workload", "Implementation", "Differing pixels", "Share", "Largest channel difference", "Pixels drawn", "Largest position difference", "Verdict"], rows),
    "",
    "**Instrument against Mtek's own counters.** The runtime's `drawCalls` per frame and `pipelinesCreated`, against what the instrument counted on the same run (runtime / instrument):",
    "",
    table(["Workload", "Draw calls per frame", "Pipelines created", "Verdict"], cross),
  ].join("\n");
}

function sizeSection(run: RawRun): string {
  const byKey = new Map<string, SizeEntry>(run.sizes.map((s) => [`${s.workload}--${s.implementation}`, s]));
  const rows: string[][] = [];
  for (const name of WORKLOADS) {
    const cells = IMPLEMENTATION_ORDER.map((impl) => {
      const s = byKey.get(`${name}--${impl}`);
      if (s === undefined) return "n/a";
      return `${fmtBytes(s.javascript.rawBytes)} raw / ${fmtBytes(s.javascript.gzipBytes)} gzip; minified ${fmtBytes(s.javascriptMinified.rawBytes)} / ${fmtBytes(s.javascriptMinified.gzipBytes)}`;
    });
    const data = byKey.get(`${name}--mtek`)?.programData;
    rows.push([`\`${name}\``, ...cells, data === null || data === undefined ? "" : `${fmtBytes(data.rawBytes)} raw / ${fmtBytes(data.gzipBytes)} gzip`]);
  }
  return [
    "JavaScript the page runs (raw / gzip level 9; then the same after esbuild minification). Mtek's figure is the program module plus the runtime bundle as `mtek build` ships them (unminified in v0.1; the physics workload adds the lazily loaded physics module with the Rapier engine); the program data column is what Mtek fetches besides code (manifest, shader files, packaged assets).",
    "",
    table(["Workload", "Mtek", "direct WebGPU", "three.js", "Mtek program data"], rows),
  ].join("\n");
}

function resourceTable(series: readonly ResourceSeries[]): string {
  const rows = series.map((s) => {
    const at = Object.entries(s.at).map(([k, v]) => `${k}: ${s.unit === "bytes" ? fmtBytes(v) : fmtInt(v)}`).join("; ");
    return [
      s.name,
      at,
      s.classification === "zero" ? "0 in every cycle" : `${s.unit === "bytes" ? fmtBytes(s.slopePerCycle) : s.slopePerCycle.toFixed(3)} per cycle`,
      s.classification === "zero" ? "-" : fmtPercent(s.relativeGrowthPercent),
      s.classification,
    ];
  });
  return table(["Resource", "Value", "Slope over the last half", "Growth the last half would add again", "Classification"], rows);
}

function cyclesSection(r: WorkloadReport | undefined): string {
  if (r === undefined) return "The mount-reload-dispose workload was not run.";
  const out: string[] = [];
  out.push(
    `A cycle mounts the scene, draws ${String(5)} frames, reloads the edited program, draws ${String(5)} frames and disposes. After every dispose the page waits 50 ms, then the runner forces a garbage collection through the DevTools protocol and reads the JavaScript heap in use, the DOM node and event-listener counts; the instrument knows which GPU buffers and textures were created and not destroyed and how many devices were requested and destroyed; for Mtek the runtime's own live-object counters are read just before and just after \`dispose()\`. A series is called a **plateau** when the least-squares slope over the last half of the cycles would add at most ${String(PLATEAU_GROWTH_PERCENT)} % of that half's mean value again (decision 0098), **growing** otherwise, and **zero** when it is 0 in every cycle. GPU memory itself is not observable from the page; "GPU bytes not destroyed" is what the application released through \`destroy()\`, and objects that have no \`destroy()\` (pipelines, bind groups, samplers) are visible only through Mtek's registry counters.`,
  );
  for (const impl of IMPLEMENTATION_ORDER) {
    const p = r.pairs[impl];
    out.push("", `#### ${IMPL_LABEL[impl]}`, "");
    if (p.cycles === null) {
      out.push(`No cycle data (${p.errors.join(" | ") || p.status}).`);
      continue;
    }
    out.push(`${String(p.cycles.cycles)} cycles.`, "", resourceTable(p.cycles.resources));
    if (p.cyclesLong !== null) {
      out.push("", `The supplementary run of ${String(p.cyclesLong.cycles)} cycles (same page, same code), to see whether a series that is still moving after ${String(p.cycles.cycles)} cycles settles:`, "", resourceTable(p.cyclesLong.resources.filter((s) => s.classification !== "zero")));
      const heap = p.cyclesLong.resources.find((s) => s.unit === "bytes" && s.name.startsWith("JavaScript heap"));
      if (heap !== undefined) {
        out.push("", `Heap in use, whole ${String(p.cyclesLong.cycles)}-cycle run: median change per cycle ${fmtBytes(heap.medianChangePerCycle)}, largest single-cycle increase ${fmtBytes(heap.largestIncrease)}, total change from the first to the last cycle ${fmtBytes((heap.values[heap.values.length - 1] ?? 0) - (heap.values[0] ?? 0))}.`);
      }
    }
  }
  out.push("", cyclesReading(r));
  return out.join("\n");
}

/** A reading of the cycle tables computed from them: what moved, what stayed zero, and what the data cannot say. */
function cyclesReading(r: WorkloadReport): string {
  const lines: string[] = ["**What the numbers show.**", ""];
  for (const impl of IMPLEMENTATION_ORDER) {
    const p = r.pairs[impl];
    if (p.cycles === null) continue;
    const growing = p.cycles.resources.filter((s) => s.classification === "growing");
    const zero = p.cycles.resources.filter((s) => s.classification === "zero");
    const long = p.cyclesLong === null ? [] : p.cyclesLong.resources.filter((s) => s.classification === "growing");
    const names = (list: readonly ResourceSeries[]): string => list.map((s) => s.name).join("; ");
    lines.push(
      `- ${IMPL_LABEL[impl]}: ${String(zero.length)} of ${String(p.cycles.resources.length)} series are exactly zero in every cycle${zero.length > 0 ? ` (${names(zero)})` : ""}. ` +
        `${growing.length === 0 ? `No series is still growing over the last half of the ${String(p.cycles.cycles)} cycles.` : `Still growing over the last half of ${String(p.cycles.cycles)} cycles: ${names(growing)}.`}` +
        `${p.cyclesLong === null ? "" : long.length === 0 ? ` In the ${String(p.cyclesLong.cycles)}-cycle run no series is growing over its last half.` : ` In the ${String(p.cyclesLong.cycles)}-cycle run these are still growing over the last half: ${names(long)}.`}`,
    );
  }
  lines.push(
    "",
    "A plateau of the JavaScript heap does not by itself prove the absence of a leak smaller than the V8 heap's own noise, and a heap that is still growing after 50 cycles may be a one-time warm-up (code caches, inline caches, lazily created tables) rather than a leak; the long run is there to tell the two apart. Hypotheses about causes are in the analysis notes of decision 0098, not here.",
  );
  return lines.join("\n");
}

function limits(run: RawRun): string {
  const adapter = run.environment.gpu.adapter;
  const machine = `${adapter?.info.description ?? "no adapter"}, ${run.environment.os.version} ${run.environment.os.release}`;
  const headless = run.environment.browser.headless ? "headless mode" : "headed mode";
  return `
- **One machine, one browser, one run.** All numbers come from one workstation (${machine}) and one Chromium build in ${headless}, in one run with ${String(run.meta.protocol.timingRuns)} timing runs per implementation. They say nothing about other GPUs, drivers, browsers or operating systems, and nothing about presented frame rates: the target is offscreen and the loop is not tied to the display.
- **The machine was shared.** It is a workstation that other processes use (other agents' builds and browser tests): they may have used the CPU during any pass, and under the lock they took turns on the GPU. Load before and during each pass is recorded in the raw results and summarised above.
- **Frame time is CPU time.** Each workload's GPU-time row shows how large the GPU part of a frame is next to the CPU part; where the GPU part is the larger one, a CPU-side comparison understates the difference, and where it is a tiny part the CPU time is what separates the implementations. A workload that is GPU-bound on slower hardware needs its GPU rows read first.
- **GPU time resolution.** Timestamps are written at the beginning and end of the render passes; Chromium's timestamp quantisation is disabled by \`--enable-webgpu-developer-features\`. Per-frame values are small enough that their resolution matters; they are reported as measured.
- **Allocation figures are estimates.** The sampling heap profiler samples every 4 KiB on average; small differences between implementations are not meaningful. The harness's own frame loop allocates (see the floor).
- **Not observable.** Memory used on the GPU (Chromium exposes none to the page), the number of bodies asleep inside Mtek's physics world (the runtime does not report it), and pipeline or bind-group *destruction* (WebGPU has no such call) are not measured; where a table says "not observable" that is why.
- **The direct reference is not a ceiling.** It is hand-written TypeScript for each workload, written once, not tuned further; a more specialised renderer could be faster, and a reference that instanced where Mtek cannot (distinct material parameters) shows the cost of the design difference as much as of implementation overhead.
- **three.js and Mtek load their code differently.** Startup includes Mtek's dynamic import of an unminified runtime (as shipped) while the other two ship one bundle; the bundle-size table shows what that code is.
- **Mount/reload/dispose reload is not like for like.** Mtek's reload re-validates a candidate program (development runtime flavour); the other two rebuild their scene objects. The numbers compare what a developer waits for, not equal work.
- **No speed claim follows.** Nothing in this report is a performance guarantee or may be quoted as one; it records what was measured and what exceeds the investigation threshold.
`.trim();
}

const REPRODUCE = (runId: string): string =>
  `
\`\`\`
npm ci
npm run build                                   # runtime bundles, physics bundle, the mtek executable
export MTEK_REQUIRE_GPU=1
node benchmarks/runtime/tools/freeze.ts --check # the definitions are the frozen ones
node benchmarks/runtime/tools/run.ts --publish  # prepares, runs every pass on hardware, writes raw/<run-id>/
node benchmarks/runtime/tools/report.ts         # regenerates report.md and summary.json from the newest raw run
node benchmarks/runtime/tools/report.ts --check # fails unless the committed report equals the regeneration
\`\`\`

The report in this directory was generated from \`raw/${runId}/\`. \`npm run test:unit -w @mtek/runtime-benchmarks\` runs \`report.ts --check\` against it and refuses a report that does not follow from its raw data.
`.trim();

export function renderReport(run: RawRun): { markdown: string; summary: unknown } {
  const { reports, floor } = collect(run);
  const cycleReport = reports.find((r) => r.name === "mount-reload-dispose");
  const parts: string[] = [
    "# Runtime benchmark: results (M7-04)",
    "",
    `> Generated by \`benchmarks/runtime/tools/report.ts\` from \`benchmarks/results/runtime/raw/${run.meta.runId}/\`. Do not edit by hand: \`node benchmarks/runtime/tools/report.ts --check\` fails when this file is not what the generator prints from the stored raw results. Method: decisions 0095 to 0099; workloads and frozen definitions: \`benchmarks/runtime/\`.`,
    "",
    run.meta.smoke ? "**THIS IS A SMOKE RUN. It is not a result.**\n" : "",
    run.meta.frozen.matches ? "" : "**THESE RESULTS WERE PRODUCED UNDER DEFINITIONS THAT DIFFER FROM THE LAST RECORDED FREEZE (FROZEN.json). They are stale.**\n",
    run.meta.gitDirty ? "**The working tree was dirty when this run was taken: the commit below does not fully describe the code that ran.**\n" : "",
    "## 1. Summary",
    "",
    summarySection(reports),
    "",
    "### Failing, errored and missing workloads",
    "",
    failingSection(reports),
    "",
    "## 2. Run record",
    "",
    environmentSection(run, floor),
    "",
    "## 3. Method and definitions",
    "",
    METHOD,
    "",
    implementationsSection(),
    "",
    "### Same visible result, and the instrument against Mtek's counters",
    "",
    parityAndCrossCheckSection(reports),
    "",
    "## 4. Results by workload",
    "",
    ...reports.flatMap((r) => [workloadSection(r, floor), ""]),
    "## 5. Mount, reload and dispose: resource plateaus",
    "",
    cyclesSection(cycleReport),
    "",
    "## 6. Bundle sizes",
    "",
    sizeSection(run),
    "",
    "## 7. Limitations and what was not measured",
    "",
    limits(run),
    "",
    "## 8. Reproducing this report",
    "",
    REPRODUCE(run.meta.runId),
    "",
  ];
  const summary = {
    schemaVersion: 1,
    runId: run.meta.runId,
    thresholdPercent: THRESHOLD_PERCENT,
    verdicts: reports.map((r) => r.verdict),
    floor,
    workloads: reports.map((r) => ({ workload: r.name, pairs: r.pairs })),
  };
  return { markdown: `${parts.join("\n")}\n`, summary };
}

export function newestRun(): string {
  const runs = existsSync(RAW_DIR) ? readdirSync(RAW_DIR).filter((n) => existsSync(join(RAW_DIR, n, "run.json"))).sort() : [];
  const last = runs[runs.length - 1];
  if (last === undefined) throw new Error(`no raw run under ${RAW_DIR}`);
  return last;
}

export function reportPaths(): { report: string; summary: string } {
  return { report: join(RESULTS_DIR, "report.md"), summary: join(RESULTS_DIR, "summary.json") };
}

function main(): number {
  const args = process.argv.slice(2);
  const runArg = args.find((a) => a.startsWith("--run="));
  const dirArg = args.find((a) => a.startsWith("--dir="));
  const id = runArg === undefined ? (dirArg === undefined ? newestRun() : "") : runArg.slice("--run=".length);
  // `--dir=<run directory>` reads (and writes next to) a run outside the published results, for development.
  const run = loadRun(dirArg === undefined ? join(RAW_DIR, id) : join(process.cwd(), dirArg.slice("--dir=".length)));
  const { markdown, summary } = renderReport(run);
  const summaryText = stringifyCompact(summary);
  const paths = dirArg === undefined ? reportPaths() : { report: join(run.dir, "report.md"), summary: join(run.dir, "summary.json") };
  if (args.includes("--check")) {
    const problems: string[] = [];
    if (!existsSync(paths.report) || readFileSync(paths.report, "utf8") !== markdown) problems.push("report.md is not what the generator prints from the raw results");
    if (!existsSync(paths.summary) || readFileSync(paths.summary, "utf8") !== summaryText) problems.push("summary.json is not what the generator prints from the raw results");
    if (problems.length > 0) {
      process.stderr.write(`${problems.join("\n")}\n`);
      return 1;
    }
    process.stdout.write(`report.md and summary.json follow from raw/${id}\n`);
    return 0;
  }
  writeFileSync(paths.report, markdown);
  writeFileSync(paths.summary, summaryText);
  process.stdout.write(`wrote ${paths.report} and ${paths.summary} from raw/${id}\n`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) process.exitCode = main();
