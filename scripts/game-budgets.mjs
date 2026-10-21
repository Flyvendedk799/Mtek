// Small-game budgets (decision 0137): bundle size of every example's game package, checked in CI, and
// frame time from hardware evidence, checked when an evidence file exists. Never invents a measurement.
//
//   node scripts/game-budgets.mjs size [--mtek target/debug/mtek] [--json out.json]
//       builds every example of budgets/small-games.json with `mtek build --release --itch`, measures the
//       folder and the zip, and fails when one is over its budget
//   node scripts/game-budgets.mjs frames <evidence.json>...
//       checks frame-time evidence recorded by scripts/record-frame-evidence.mjs on a real GPU against the
//       frame budget; a software or unknown adapter is refused, not counted
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const budgets = JSON.parse(readFileSync(join(root, "budgets/small-games.json"), "utf8"));

/** Bytes of every file under `dir`. */
export function folderBytes(dir) {
  return readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => {
    const path = join(dir, entry.name);
    return sum + (entry.isDirectory() ? folderBytes(path) : statSync(path).size);
  }, 0);
}

/** Problems of one size measurement against its budget (empty: within budget). */
export function sizeProblems(name, measured, budget) {
  const problems = [];
  if (measured.folderBytes > budget.maxFolderBytes) problems.push(`${name}: folder ${measured.folderBytes} B > budget ${budget.maxFolderBytes} B`);
  if (measured.zipBytes > budget.maxZipBytes) problems.push(`${name}: zip ${measured.zipBytes} B > budget ${budget.maxZipBytes} B`);
  return problems;
}

/**
 * Problems of one frame-time evidence file (empty: accepted and within budget). Evidence from a fallback
 * (software) adapter, without an adapter description, or with too few frames is not evidence.
 */
export function frameProblems(evidence, frame = budgets.frame) {
  const problems = [];
  if (evidence?.format !== "mtek-frame-evidence/1") return ["not an mtek-frame-evidence/1 file"];
  const adapter = evidence.adapter ?? {};
  if (adapter.isFallbackAdapter !== false) problems.push("the adapter is a software fallback or unknown: not hardware evidence");
  if (![adapter.vendor, adapter.architecture, adapter.description].some((part) => typeof part === "string" && part.length > 0)) {
    problems.push("the adapter is not identified (vendor, architecture or description)");
  }
  for (const [name, run] of Object.entries(evidence.examples ?? {})) {
    if (!(run.frames >= frame.minFrames)) problems.push(`${name}: ${run.frames} frames < ${frame.minFrames}`);
    else if (!(run.p95Ms <= frame.maxP95Ms)) problems.push(`${name}: p95 ${run.p95Ms} ms > budget ${frame.maxP95Ms} ms`);
  }
  if (Object.keys(evidence.examples ?? {}).length === 0) problems.push("no example was measured");
  return problems;
}

function size(args) {
  const mtek = resolve(args[args.indexOf("--mtek") + 1] && args.includes("--mtek") ? args[args.indexOf("--mtek") + 1] : join(root, "target/debug/mtek"));
  const scratch = mkdtempSync(join(tmpdir(), "mtek-budgets-"));
  const rows = {};
  const problems = [];
  try {
    for (const [name, budget] of Object.entries(budgets.size)) {
      const out = join(scratch, name);
      const result = spawnSync(mtek, ["build", "--release", "--itch", "--out", out, join(root, "examples", name)], { encoding: "utf8" });
      if (result.status !== 0) {
        problems.push(`${name}: mtek build --release --itch failed (${result.status}): ${result.stderr || result.error}`);
        continue;
      }
      rows[name] = { folderBytes: folderBytes(out), zipBytes: statSync(`${out}-itch.zip`).size };
      problems.push(...sizeProblems(name, rows[name], budget));
      console.log(`${name.padEnd(24)} folder ${String(rows[name].folderBytes).padStart(9)} B / ${budget.maxFolderBytes}   zip ${String(rows[name].zipBytes).padStart(9)} B / ${budget.maxZipBytes}`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (args.includes("--json")) writeFileSync(args[args.indexOf("--json") + 1], JSON.stringify({ format: "mtek-size-report/1", examples: rows }, null, 2) + "\n");
  return problems;
}

function frames(files) {
  if (files.length === 0) return ["no evidence file given: frame-time budgets need a run on real GPU hardware (TESTING-codey2.md section 8)"];
  return files.flatMap((file) => frameProblems(JSON.parse(readFileSync(file, "utf8"))).map((problem) => `${file}: ${problem}`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  const problems = command === "size" ? size(args) : command === "frames" ? frames(args) : [`unknown command '${command}' (size | frames)`];
  for (const problem of problems) console.error(`game-budgets: ${problem}`);
  if (problems.length > 0) process.exit(1);
  console.log(`game-budgets: ${command}: every budget holds`);
}
