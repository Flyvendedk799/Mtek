// Mutation check of the Mtek side of interaction-02 .. interaction-08 (decision 0079).
//
//   node evidence/M6/benchmark-interaction/mutation/run.mjs [mutants|alternates] [task-id-filter] > results.json
//
// Every MUTANT is the task's Mtek reference with one plausible mistake (no clamp, a stale timer, polling instead
// of events, ...): it must FAIL the task's fixtures, else the fixtures would not discriminate. Every ALTERNATE is
// a different, correct way to solve the task (state bound to the picture, writes in `update`, a timer from
// `frame.time`, ...): it must PASS, else the fixtures would over-constrain the solution. Each candidate is
// validated with the repair harness's `validate` command (parse, check, build, start and the fixtures through
// `mtek test` on the real browser). Machine paths are not written to the report.
//
// `MTEK_GPU_LOCK` (a directory name) is taken with mkdir for the duration of each run when set: a lock shared by
// the processes of one machine that use the GPU adapter.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ALTERNATES from "./alternates.mjs";
import MUTANTS from "./mutants.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const LOCK = process.env["MTEK_GPU_LOCK"];
const kind = process.argv[2] ?? "mutants";
const filter = process.argv[3] ?? "";
if (kind !== "mutants" && kind !== "alternates") throw new Error("usage: run.mjs [mutants|alternates] [task filter]");
const list = kind === "mutants" ? MUTANTS : ALTERNATES;

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withLock(action) {
  if (LOCK === undefined) return action();
  for (let attempt = 0; ; attempt += 1) {
    try {
      mkdirSync(LOCK);
      break;
    } catch {
      if (attempt > 360) throw new Error("the GPU lock was not released");
      sleep(5000);
    }
  }
  try {
    return action();
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
  }
}

const scratch = mkdtempSync(join(tmpdir(), "mtek-mutation-"));
const results = [];
try {
  for (const candidate of list) {
    if (!candidate.task.includes(filter)) continue;
    const project = join(scratch, `${candidate.task}-${candidate.name}`);
    cpSync(join(REPO, "benchmarks", "tasks", candidate.task, "reference", "mtek"), project, { recursive: true });
    const file = join(project, "src", "main.mtek");
    let text = readFileSync(file, "utf8");
    if (candidate.whole !== undefined) {
      text = candidate.whole;
    } else {
      for (const [from, to] of candidate.edits) {
        if (!text.includes(from)) throw new Error(`${candidate.task}/${candidate.name}: '${from}' is not in the reference`);
        text = text.replace(from, to);
      }
    }
    writeFileSync(file, text);
    const run = withLock(() =>
      spawnSync("node", ["tools/ai-eval/src/cli.ts", "validate", "--task", `benchmarks/tasks/${candidate.task}`, "--project", project], {
        cwd: REPO,
        encoding: "utf8",
        maxBuffer: 1 << 26,
      }),
    );
    const report = JSON.parse(run.stdout);
    const fixtures = report.testReport?.fixtures ?? [];
    const failedFixtures = fixtures.filter((f) => f.status === "fail").map((f) => f.name).sort();
    const expected = kind === "mutants" ? "fail" : "pass";
    results.push({
      task: candidate.task,
      name: candidate.name,
      what: candidate.what,
      expected,
      verdict: report.verdict,
      layers: Object.fromEntries(Object.entries(report.layers).map(([k, v]) => [k, v.outcome])),
      fixturesFailed: failedFixtures.length,
      fixturesTotal: fixtures.length,
      failedFixtures,
      ok: report.verdict === expected,
    });
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
const summary = {
  kind,
  total: results.length,
  ok: results.filter((r) => r.ok).length,
  unexpected: results.filter((r) => !r.ok).map((r) => `${r.task}/${r.name}`),
  results,
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
process.exitCode = summary.unexpected.length === 0 ? 0 : 1;
