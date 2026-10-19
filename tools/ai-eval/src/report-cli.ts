// `report`: turns stored run directories into `report.md` (decision 0108). It reads `records.jsonl` only (and the NAMES of the
// directories below `benchmarks/holdout/`, to tell holdout attempts apart); it never runs a model and never opens a task.
//
//   node tools/ai-eval/src/report-cli.ts --run DIR [--run DIR ...] [--out report.md] [--title T] [--note N]
//                                        [--holdout-summary FILE]
//
// A run directory of a holdout run lives outside the repository (its records hold prompts); pass it with `--run` and the
// report holds ids and layer outcomes of those attempts only. `--holdout-summary` writes them as JSONL, the only form of a
// holdout result that may be stored in the repository. `--projection FILE` writes the cost projection of the full protocol from the
// cost per attempt in these runs (`projection.ts`).
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "./commands.ts";
import { canonicalJson, type Json } from "./canonical.ts";
import { buildReport, extractTrials, holdoutSummary, parseRecords } from "./report.ts";
import { taskIdsIn } from "./benchmark-run.ts";
import { RECORDS_FILE } from "./recorder.ts";
import { conditionCosts, renderProjection } from "./projection.ts";

export function runReport(argv: readonly string[], io: { out(t: string): void; err(t: string): void } = { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) }, root: string = repoRoot()): number {
  const runs: string[] = [];
  let out: string | undefined;
  let title: string | undefined;
  let note: string | undefined;
  let summary: string | undefined;
  let projection: string | undefined;
  let budget = 8;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === "--run" && value !== undefined) runs.push(resolve(value));
    else if (arg === "--out" && value !== undefined) out = resolve(value);
    else if (arg === "--title" && value !== undefined) title = value;
    else if (arg === "--note" && value !== undefined) note = value;
    else if (arg === "--holdout-summary" && value !== undefined) summary = resolve(value);
    else if (arg === "--projection" && value !== undefined) projection = resolve(value);
    else if (arg === "--budget" && value !== undefined) budget = Number(value);
    else {
      io.err(`error: unknown or incomplete option ${String(arg)}\nusage: report --run DIR [--run DIR ...] [--out FILE] [--title T] [--note N] [--holdout-summary FILE] [--projection FILE [--budget USD]]\n`);
      return 2;
    }
    i += 1;
  }
  if (runs.length === 0) {
    io.err("error: --run DIR is required\n");
    return 2;
  }
  const records = runs.flatMap((dir) => parseRecords(readFileSync(join(dir, RECORDS_FILE), "utf8")));
  const holdoutIds = new Set(taskIdsIn(join(root, "benchmarks", "holdout")));
  const report = buildReport({ records, holdoutIds, ...(title === undefined ? {} : { title }), ...(note === undefined ? {} : { note }) });
  const target = out ?? join(runs[0] as string, "report.md");
  writeFileSync(target, report.markdown, "utf8");
  io.out(`report: ${target}\n`);
  if (summary !== undefined) {
    const { trials } = extractTrials(records, holdoutIds);
    const lines = holdoutSummary(trials).map((row) => canonicalJson(row as Json));
    writeFileSync(summary, lines.length === 0 ? "" : `${lines.join("\n")}\n`, "utf8");
    io.out(`holdout summary: ${summary} (${String(lines.length)} attempts)\n`);
  }
  if (projection !== undefined) {
    const { trials } = extractTrials(records, holdoutIds);
    writeFileSync(projection, renderProjection(conditionCosts(trials.filter((t) => !t.holdout)), budget), "utf8");
    io.out(`projection: ${projection}\n`);
  }
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runReport(process.argv.slice(2));
}
