// Run separately built release examples alternately. No builds/tests should run concurrently.
// node scripts/performance-audit.mjs <output.csv> <before-executable> <after-executable>
import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cpus, release } from "node:os";

const [, , output, before, after, suite = "synthetic"] = process.argv;
if (!output || !before || !after) throw new Error("output.csv before-executable after-executable required");
const executables = { before: resolve(before), after: resolve(after) };
writeFileSync(`${output}.environment.json`, JSON.stringify({
  recordedAt: new Date().toISOString(), node: process.version, platform: process.platform,
  arch: process.arch, os: release(), cpu: cpus()[0]?.model, logicalProcessors: cpus().length,
  protocol: { warmups: 1, samplesPerProcess: 3, rounds: 3, orders: ["before,after", "after,before", "before,after"] },
}, null, 2) + "\n");
writeFileSync(output, "revision,round,shape,count,operation,sample,nanoseconds\n");
const shapes = suite === "projects" ? [
  ...["pulse-cube", "modular-scene", "material-configurator", "physics-playground", "product-configurator"].map((name) => `project:examples/${name}`),
  ...["changing-transforms", "changing-material-params", "repeated-meshes"].map((name) => `project:benchmarks/runtime/${name}/mtek`),
] : ["independent", "chain", "fanout", "diamond", "dense", "mesh-identical", "mesh-reuse", "mesh-unique"];
for (const shape of shapes) {
  for (const count of suite === "projects" ? [0] : [128, 512, 2048, 8192]) {
    for (const operation of [shape.startsWith("mesh-") ? "plan" : "analyze", "build"]) {
      for (let round = 0; round < 3; round++) {
        const order = round % 2 ? ["after", "before"] : ["before", "after"];
        for (const revision of order) {
          const result = spawnSync(executables[revision], [shape, String(count), "3", operation], { encoding: "utf8" });
          if (result.status !== 0) throw new Error(`${revision} ${shape} ${count}: ${result.stderr} ${result.error ?? ""}`);
          const rows = result.stdout.trim().split(/\r?\n/);
          if (rows.length !== 3) throw new Error(`expected 3 samples, got ${result.stdout}`);
          for (const row of rows) appendFileSync(output, `${revision},${round},${row}\n`);
        }
      }
      console.log(shape, count, operation);
    }
  }
}
