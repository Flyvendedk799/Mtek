// Supplemental CPU diagnostic, not a substitute for the frozen whole-frame run.
// Run after GPU timing, serially: node <this file>. Output retains every sample.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { summarize } from "../../../benchmarks/runtime/harness/stats.ts";

const root = import.meta.dirname, actors = 50, warmup = 300, frames = 1800, dt = 1 / 60;
const runtimes = await Promise.all(["baseline", "optimized"].map(name => import(pathToFileURL(join(root, name, "runtime.js")).href)));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const rows = [];
for (const [model, clip] of [["Fox", "Walk"], ["CesiumMan", "animation_0"]]) {
  const manifestPath = join(root, "../../../benchmarks/runtime/.out/animation/site/mtek", `${model}-50/program.manifest.json`);
  const manifestBytes = readFileSync(manifestPath), skin = JSON.parse(manifestBytes).meshes[0].skin;
  const cohorts = runtimes.map(runtime => Array.from({ length: actors }, (_, i) => {
    const controller = runtime.createAnimationController(skin, { clip });
    controller.player.clock.seek(0, i / actors * controller.player.clock.duration(0)); controller.player.evaluate(); return controller;
  }));
  const samples = [[], []];
  const update = index => { for (const controller of cohorts[index]) controller.update(dt); };
  const check = () => {
    for (let i = 0; i < actors; i++) {
      assert.deepEqual(cohorts[0][i].player.palette, cohorts[1][i].player.palette, `${model} palette ${i}`);
      assert.deepEqual(cohorts[0][i].player.pose, cohorts[1][i].player.pose, `${model} pose ${i}`);
    }
  };
  for (let frame = 0; frame < warmup; frame++) { update(0); update(1); }
  check();
  for (let frame = 0; frame < frames; frame++) {
    // Alternate each pair's order so a separate long before/after window cannot
    // masquerade as a pose-speed change. Exact output checks stay outside timing.
    for (const index of frame % 2 === 0 ? [0, 1] : [1, 0]) {
      const start = performance.now(); update(index); samples[index].push(performance.now() - start);
    }
    if (frame % 60 === 0) check();
  }
  check();
  rows.push({ model, actors, manifestSha256: sha256(manifestBytes), samples, summaries: samples.map(summarize), exactPosePaletteChecks: true });
  cohorts.flat().forEach(controller => controller.dispose());
}
const record = { format: "mtek-pose-only-paired-diagnostic/1", recordedAt: new Date().toISOString(), node: process.version, platform: process.platform, actors, warmup, frames, dt,
  runtimeSha256: ["baseline", "optimized"].map(name => sha256(readFileSync(join(root, name, "runtime.js")))),
  limitations: "Node pose/controller CPU only; no bounds, GPU, renderer, uploads, frame scheduling or Three.js. Alternating paired samples mitigate time drift but do not establish isolated CPU or whole-frame performance.", rows };
writeFileSync(join(root, "pose-only.json"), JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify(rows.map(row => ({ model: row.model, before: row.summaries[0], after: row.summaries[1] })), null, 2));
