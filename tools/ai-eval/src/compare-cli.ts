// `compare`: a before/after comparison of the Mtek conditions of two sets of stored runs (decisions 0124 and 0125), as markdown, computed from
// the `records.jsonl` files ONLY (it never runs a model, never opens a task, and reads only the NAMES of the directories below
// `benchmarks/holdout/` to leave holdout attempts out).
//
//   node tools/ai-eval/src/compare-cli.ts --before RUN[,RUN...] --after RUN[,RUN...] [--after-retry RUN[,RUN...]] --out FILE [--title T] [--note N]
//                                         [--holdout-before FILE[,FILE...] --holdout-after FILE[,FILE...]] [--baseline-json FILE]
//
// RUN is a run directory (it holds `records.jsonl`). `--before`, `--after` and `--after-retry` may be repeated. The baseline row is taken from
// the runs before. `--after-retry` names RETRY runs of the runs after: their attempts replace the NOT-JUDGED attempts of the same cells
// (a retry attempt for a cell that was judged is an error, exit 3). `--holdout-before` and `--holdout-after` are holdout SUMMARY files
// (JSONL, the only form of a holdout result in the repository); they add the exploratory holdout section. `--baseline-json` writes the
// machine-readable baseline (`baseline-json.ts`). See `compare.ts` for what is computed.
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "./commands.ts";
import { sha256Hex } from "./canonical.ts";
import { buildBaselineJson, type SourceFile } from "./baseline-json.ts";
import { buildComparison } from "./compare.ts";
import { parseHoldoutSummary } from "./holdout-compare.ts";
import { taskIdsIn } from "./benchmark-run.ts";
import { RECORDS_FILE } from "./recorder.ts";
import { parseRecords } from "./report.ts";

const USAGE =
  "usage: compare --before RUN[,RUN...] --after RUN[,RUN...] [--after-retry RUN[,RUN...]] --out FILE [--title T] [--note N] [--holdout-before FILE[,FILE...] --holdout-after FILE[,FILE...]] [--baseline-json FILE]\n";

/** The text of a stored file with CRLF read as LF, so that a hash does not depend on how a checkout converted line endings. */
const normalized = (path: string): string => readFileSync(path, "utf8").replaceAll("\r\n", "\n");

export function runCompare(argv: readonly string[], io: { out(t: string): void; err(t: string): void } = { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) }, root: string = repoRoot()): number {
  const before: string[] = [];
  const after: string[] = [];
  const afterRetry: string[] = [];
  const holdoutBefore: string[] = [];
  const holdoutAfter: string[] = [];
  let out: string | undefined;
  let title: string | undefined;
  let note: string | undefined;
  let baselineJson: string | undefined;
  const list = (value: string): string[] => value.split(",").filter((part) => part !== "").map((part) => resolve(part));
  for (let i = 0; i < argv.length; i += 2) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (value === undefined) {
      io.err(`error: incomplete option ${String(arg)}\n${USAGE}`);
      return 2;
    }
    if (arg === "--before") before.push(...list(value));
    else if (arg === "--after") after.push(...list(value));
    else if (arg === "--after-retry") afterRetry.push(...list(value));
    else if (arg === "--holdout-before") holdoutBefore.push(...list(value));
    else if (arg === "--holdout-after") holdoutAfter.push(...list(value));
    else if (arg === "--baseline-json") baselineJson = resolve(value);
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
  if ((holdoutBefore.length === 0) !== (holdoutAfter.length === 0)) {
    io.err(`error: --holdout-before and --holdout-after are given together\n${USAGE}`);
    return 2;
  }
  const read = (dirs: readonly string[]) => dirs.flatMap((dir) => parseRecords(readFileSync(join(dir, RECORDS_FILE), "utf8")));
  try {
    const earlier = holdoutBefore.flatMap((file) => parseHoldoutSummary(readFileSync(file, "utf8"), file));
    const later = holdoutAfter.flatMap((file) => parseHoldoutSummary(readFileSync(file, "utf8"), file));
    const comparison = buildComparison({
      before: read(before),
      after: read(after),
      afterRetry: read(afterRetry),
      ...(holdoutBefore.length === 0 ? {} : { holdout: { earlier, later } }),
      holdoutIds: new Set(taskIdsIn(join(root, "benchmarks", "holdout"))),
      ...(title === undefined ? {} : { title }),
      ...(note === undefined ? {} : { note }),
    });
    writeFileSync(out, comparison.markdown, "utf8");
    io.out(`comparison: ${out}\n`);
    if (baselineJson !== undefined) {
      const rel = (path: string): string => {
        const r = relative(root, path);
        return r.startsWith("..") ? `(outside the repository) ${path.split(sep).pop() ?? path}` : r.split(sep).join("/");
      };
      const files: SourceFile[] = [];
      const records = (role: SourceFile["role"], dirs: readonly string[]): void => {
        for (const dir of dirs) {
          const file = join(dir, RECORDS_FILE);
          const text = normalized(file);
          const parsed = parseRecords(text);
          files.push({ role, path: rel(file), sha256: sha256Hex(text), runIds: [...new Set(parsed.map((r) => String(r["runId"])))].sort(), rows: parsed.length });
        }
      };
      records("before", before);
      records("after", after);
      records("retry", afterRetry);
      const summaries = (role: SourceFile["role"], paths: readonly string[]): void => {
        for (const path of paths) {
          const text = normalized(path);
          files.push({ role, path: rel(path), sha256: sha256Hex(text), runIds: [], rows: parseHoldoutSummary(text, path).length });
        }
      };
      summaries("holdout-summary-earlier", holdoutBefore);
      summaries("holdout-summary-new", holdoutAfter);
      const version = (JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as { version: string }).version;
      writeFileSync(baselineJson, buildBaselineJson({ comparison, files, harnessVersion: version }), "utf8");
      io.out(`baseline: ${baselineJson}\n`);
    }
  } catch (error) {
    io.err(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 3;
  }
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runCompare(process.argv.slice(2));
}
