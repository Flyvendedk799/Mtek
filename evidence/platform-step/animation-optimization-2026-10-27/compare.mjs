// Reproduce/check the before/after comparison without changing frozen definitions.
// node evidence/platform-step/animation-optimization-2026-10-27/compare.mjs [--check]
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generate, writeReport } from "../../../benchmarks/runtime/animation/report.ts";
import { median } from "../../../benchmarks/runtime/harness/stats.ts";

const root = import.meta.dirname;
const directories = ["baseline/run-01", "optimized/run-01"];
const json = path => JSON.parse(readFileSync(path, "utf8"));
const runs = directories.map(directory => {
  const path = join(root, directory);
  writeReport(path, true); // Refuse incomplete, stale, smoke or failed evidence.
  return { summary: generate(path).summary, meta: json(join(path, "run.json")), environment: json(join(path, "environment.json")), build: json(join(path, "build-inputs.json")) };
});
const [before, after] = runs;
assert.deepEqual(before.meta.protocol, after.meta.protocol);
assert.deepEqual(before.meta.definitions, after.meta.definitions);
assert.deepEqual(before.environment.os, after.environment.os);
assert.deepEqual(before.environment.browser, after.environment.browser);
assert.deepEqual(before.environment.gpu.adapter.info, after.environment.gpu.adapter.info);
assert.equal(before.environment.gpu.adapter.info.isFallbackAdapter, false);
assert.equal(before.build.packageLockSha256, after.build.packageLockSha256);
assert.deepEqual(before.build.compatibility, after.build.compatibility);

const percent = (a, b) => a === 0 ? null : (b / a - 1) * 100;
const measurement = (a, b) => ({ before: a, after: b, changePercent: percent(a, b) });
const key = row => `${row.model}/${row.actors}/${row.engine}`;
const lookup = new Map(after.summary.rows.map(row => [key(row), row]));
assert.equal(lookup.size, 12);
assert.equal(before.summary.rows.length, 12);
const rows = before.summary.rows.map(a => {
  const b = lookup.get(key(a)); assert.ok(b, `Missing ${key(a)}`);
  assert.equal(a.verticesPerActor, b.verticesPerActor); assert.equal(a.jointsPerActor, b.jointsPerActor);
  return { model: a.model, actors: a.actors, engine: a.engine,
    cpuP95Ms: measurement(a.cpuP95Ms.median, b.cpuP95Ms.median),
    gpuPassSumP95Ms: a.gpuPassSumP95Ms === null || b.gpuPassSumP95Ms === null ? null : measurement(a.gpuPassSumP95Ms.median, b.gpuPassSumP95Ms.median),
    liveGpuBufferBytes: measurement(median(a.liveGpuBufferBytes), median(b.liveGpuBufferBytes)),
    liveJsHeapUsedBytes: measurement(median(a.liveJsHeapUsedBytes), median(b.liveJsHeapUsedBytes)),
    writeBufferBytesPerFrame: measurement(median(a.allWriteBufferBytesPerFrame), median(b.allWriteBufferBytesPerFrame)),
    drawCallsPerFrame: measurement(median(a.drawCallsPerFrame), median(b.drawCallsPerFrame)) };
});
const summary = { format: "mtek-animation-before-after/1", definitions: before.meta.definitions.hash, runs: directories, rows };
const fixed = value => value === null ? "unavailable" : value.toFixed(3);
const change = value => value === null ? "unavailable" : Math.abs(value) < 0.05 ? "0.0%" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
const lines = ["# Animation optimization: matched before/after", "",
  "Both complete runs use identical frozen definitions, protocol, browser, adapter, OS and package lock. Each passes all 210 gates. All rows include Three.js controls so changes in the unchanged engine remain visible.", "",
  "| Asset | Actors | Engine | CPU p95 ms before → after | CPU change | GPU pass-sum p95 ms before → after | GPU change | GPU buffer MiB before → after |",
  "|---|---:|---|---:|---:|---:|---:|---:|"];
for (const row of rows) lines.push(`| ${row.model} | ${row.actors} | ${row.engine} | ${fixed(row.cpuP95Ms.before)} → ${fixed(row.cpuP95Ms.after)} | ${change(row.cpuP95Ms.changePercent)} | ${fixed(row.gpuPassSumP95Ms?.before ?? null)} → ${fixed(row.gpuPassSumP95Ms?.after ?? null)} | ${change(row.gpuPassSumP95Ms?.changePercent ?? null)} | ${(row.liveGpuBufferBytes.before / 1048576).toFixed(3)} → ${(row.liveGpuBufferBytes.after / 1048576).toFixed(3)} |`);
lines.push("", "Values are the median of three per-run p95s, not confidence intervals. Negative changes mean less time or memory. CPU near the recorded clock quantum is precision-limited. GPU sums compute and render passes; transfers, queue gaps and presentation are excluded. RAF callback intervals are not presented-frame timing. Buffer bytes are logical allocations, not physical VRAM; JS heap and transfer/draw counts are in comparison.json and both full reports.", "",
  "CPU interpretation: Mtek's whole-frame CPU results are mixed, including a regression for 50 Fox actors. The unchanged Three.js control also changes substantially. These measurements do not establish a whole-frame CPU reduction or isolate the cause of every change. The separate alternating pose-only diagnostic in pose-only.json measures a narrower Node workload and must not replace these browser results.", "",
  "This flat opaque workload intentionally disables primary culling, pose sharing and throttling. The candidate skips unused normal deformation and unneeded opaque bounds work; materials reading normals retain inverse-transpose deformation. Culling-edge gates still run with culling enabled. These results cover two assets on one physical desktop, not PBR quality, all animation compositions, other devices or general engine superiority.", "",
  "Compatibility correction: the frozen report template still describes CesiumMan's original mixed-filter sampler as rejected. That text is historical. Both fresh build-inputs.json records show original import exit code 0 for Fox and CesiumMan; the importer fix predates both runs. The frozen workload still explicitly replaces materials identically on both sides. The template is retained unchanged to preserve the definition hash.", "");
for (const [file, value] of [["comparison.json", JSON.stringify(summary, null, 2) + "\n"], ["comparison.md", lines.join("\n")]]) {
  if (process.argv.includes("--check")) assert.equal(readFileSync(join(root, file), "utf8"), value, `Stale ${file}`);
  else writeFileSync(join(root, file), value);
}
