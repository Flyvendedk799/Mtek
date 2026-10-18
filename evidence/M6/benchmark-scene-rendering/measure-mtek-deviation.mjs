// How far the Mtek references of the lit tasks are from the fixtures: for each task, the smallest tolerance (replacing
// the fixture's lit tolerance) at which `mtek test` passes, and the first pixel that fails below it. Needs a built
// `mtek` and a WebGPU adapter. Run from the repository root: node evidence/M6/benchmark-scene-rendering/measure-mtek-deviation.mjs
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..", "..");
const mtek = process.env.MTEK_BIN ?? join(root, "target", "debug", "mtek");
const scratch = mkdtempSync(join(tmpdir(), "mtek-deviation-"));
const LIT_TOLERANCE = "tolerance = 6";
for (const n of ["06", "07", "10"]) {
  const task = join(root, "benchmarks", "tasks", `scene-rendering-${n}`);
  const text = readFileSync(join(task, "mtek-tests", "scene.test.toml"), "utf8");
  for (let tolerance = 0; tolerance <= 6; tolerance += 1) {
    const project = join(scratch, n);
    rmSync(project, { recursive: true, force: true });
    mkdirSync(join(project, "tests"), { recursive: true });
    cpSync(join(task, "reference", "mtek"), project, { recursive: true });
    writeFileSync(join(project, "tests", "scene.test.toml"), text.replaceAll(LIT_TOLERANCE, `tolerance = ${tolerance}`));
    const run = spawnSync(mtek, ["test", project, "--format", "json"], { encoding: "utf8" });
    const fixture = JSON.parse(run.stdout).fixtures[0];
    console.log(`scene-rendering-${n}: tolerance ${tolerance}: ${fixture.status}${fixture.failure === null ? "" : `; ${fixture.failure.message}`}`);
    if (fixture.status === "pass") break;
  }
}
rmSync(scratch, { recursive: true, force: true });
