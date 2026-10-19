// `compare`: a before/after comparison of the Mtek conditions of two sets of stored runs (decision 0124), as markdown, computed from
// the `records.jsonl` files ONLY (it never runs a model, never opens a task, and reads only the NAMES of the directories below
// `benchmarks/holdout/` to leave holdout attempts out).
//
//   node tools/ai-eval/src/compare-cli.ts --before RUN[,RUN...] --after RUN[,RUN...] --out FILE [--title T] [--note N]
//
// RUN is a run directory (it holds `records.jsonl`). `--before` and `--after` may be repeated. The baseline row is taken from the runs
// before. See `compare.ts` for what is computed.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "./commands.ts";
import { buildComparison } from "./compare.ts";
import { taskIdsIn } from "./benchmark-run.ts";
import { RECORDS_FILE } from "./recorder.ts";
import { parseRecords } from "./report.ts";

const USAGE = "usage: compare --before RUN[,RUN...] --after RUN[,RUN...] --out FILE [--title T] [--note N]\n";

export function runCompare(argv: readonly string[], io: { out(t: string): void; err(t: string): void } = { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) }, root: string = repoRoot()): number {
  const before: string[] = [];
  const after: string[] = [];
  let out: string | undefined;
  let title: string | undefined;
  let note: string | undefined;
  const runs = (value: string): string[] => value.split(",").filter((part) => part !== "").map((part) => resolve(part));
  for (let i = 0; i < argv.length; i += 2) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (value === undefined) {
      io.err(`error: incomplete option ${String(arg)}\n${USAGE}`);
      return 2;
    }
    if (arg === "--before") before.push(...runs(value));
    else if (arg === "--after") after.push(...runs(value));
    else if (arg === "--out") out = resolve(value);
    else if (arg === "--title") title = value;
    else if (arg === "--note") note = value;
    else {
      io.err(`error: unknown option ${String(arg)}\n${USAGE}`);
      return 2;
    }
  }
  if (before.length === 0 || after.length === 0 || out === undefined) {
    io.err(`error: --before, --after and --out are required\n${USAGE}`);
    return 2;
  }
  const read = (dirs: readonly string[]) => dirs.flatMap((dir) => parseRecords(readFileSync(join(dir, RECORDS_FILE), "utf8")));
  try {
    const comparison = buildComparison({
      before: read(before),
      after: read(after),
      holdoutIds: new Set(taskIdsIn(join(root, "benchmarks", "holdout"))),
      ...(title === undefined ? {} : { title }),
      ...(note === undefined ? {} : { note }),
    });
    writeFileSync(out, comparison.markdown, "utf8");
  } catch (error) {
    io.err(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 3;
  }
  io.out(`comparison: ${out}\n`);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runCompare(process.argv.slice(2));
}
