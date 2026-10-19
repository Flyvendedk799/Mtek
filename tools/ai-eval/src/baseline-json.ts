// The machine-readable baseline of the AI benchmark (decision 0125): `evidence/M7/ai-baseline.json`, written by
// `compare-cli --baseline-json FILE` from the stored records and the holdout summary files ONLY. It states what was measured (model,
// temperature, prompt caching, the price table, the harness), which files it was computed from (run id and SHA-256 of every
// `records.jsonl`, SHA-256 of every holdout summary), the numbers of every condition, the verdicts and the targets a later run is held to.
// The same inputs give the same bytes.
import { PRICING } from "./spend.ts";
import { MAX_EXCLUDED_SHARE, PROTOCOL_TRIALS, TARGET_RATIO, MATCHED_SUCCESS_POINTS, summarize, type CellSummary, type Comparison as H4Comparison, type RunInfo, type TrialRow } from "./report.ts";
import type { Comparison } from "./compare.ts";
import type { HoldoutComparison } from "./holdout-compare.ts";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** One file the baseline was computed from. `path` is relative to the repository root with `/`; the hash is of the text with CRLF read as LF. */
export interface SourceFile {
  role: "before" | "after" | "retry" | "holdout-summary-earlier" | "holdout-summary-new";
  path: string;
  sha256: string;
  /** The run ids the file holds (records files) or the number of rows (summary files). */
  runIds: string[];
  rows: number;
}

export interface BaselineInput {
  comparison: Comparison;
  files: SourceFile[];
  harnessVersion: string;
}

/** JSON with sorted keys and two spaces of indentation, ending in a newline: a stable text for a stored file. */
export function stringifySorted(value: JsonValue): string {
  const sort = (v: JsonValue): JsonValue => {
    if (Array.isArray(v)) return v.map(sort);
    if (v !== null && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k] as JsonValue)]));
    return v;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

const cell = (c: CellSummary): JsonValue => ({
  attempts: c.n,
  completed: c.success,
  failed: c.failure,
  notJudged: c.n - c.valid,
  completionRate: c.completionRate,
  tokensPerCompletedTask: c.tokensPerCompleted,
  totalTokens: c.totalTokens,
  costUsd: c.costUsd,
  costPerCompletedTaskUsd: c.costPerCompleted,
});

function scoped(rows: readonly TrialRow[], pick: (t: TrialRow) => string): JsonValue {
  const keys = [...new Set(rows.map(pick))].sort();
  return Object.fromEntries(keys.map((k) => [k, cell(summarize(rows.filter((t) => pick(t) === k)))]));
}

function verdict(c: H4Comparison): JsonValue {
  return {
    verdict: c.verdict,
    reason: c.reason,
    provisional: c.provisional,
    provisionalReasons: c.provisionalReasons,
    tasks: c.tasks.length,
    minTrialsPerTaskSide: c.minTrialsPerTaskSide,
    completionDifferencePoints: c.completionDifference === null ? null : c.completionDifference * 100,
    successAxis: c.successAxis,
    tokensAxis: c.tokensAxis,
    tokenRatio: { point: c.interval.point, low: c.interval.low, high: c.interval.high },
    researchTargetMet: c.targetMet,
  };
}

const settingsOf = (runs: readonly RunInfo[], key: string): JsonValue => {
  const values = [...new Set(runs.filter((r) => r.settings !== null && r.settings[key] !== undefined).map((r) => JSON.stringify(r.settings?.[key])))];
  const parsed = values.map((v) => JSON.parse(v) as JsonValue);
  return parsed.length === 0 ? null : parsed.length === 1 ? (parsed[0] as JsonValue) : parsed;
};

export function buildBaselineJson(input: BaselineInput): string {
  const { comparison, files, harnessVersion } = input;
  const runs = [...comparison.runs.before, ...comparison.runs.after];
  const measured = comparison.runs.after.filter((r) => r.retry !== true);
  const model = settingsOf(measured, "model");
  const modelIds = (Array.isArray(model) ? model : [model]).filter((m): m is string => typeof m === "string");
  const base = comparison.baseline;
  const holdout = comparison.holdout;
  const holdoutBaseline: HoldoutComparison["conditions"][number] | undefined = holdout?.conditions.find((c) => c.side === "baseline");

  const main: JsonValue = {
    scope: "main set: every task of benchmarks/tasks, 5 trials per task and condition; the retry attempts stand in the place of the attempts that were not judged",
    baseline: base === null ? null : { description: "three.js baseline, M7-05 run m7-05-main, not re-run", ...(cell(base) as Record<string, JsonValue>), byMode: scoped(comparison.baselineRows, (t) => t.mode), byCategory: scoped(comparison.baselineRows, (t) => t.category) },
    conditions: comparison.conditions.map((c) => ({
      label: c.label,
      trialKind: c.trialKind,
      variant: c.variant,
      before: { ...(cell(c.before.all) as Record<string, JsonValue>), byMode: scoped(c.before.rows, (t) => t.mode), byCategory: scoped(c.before.rows, (t) => t.category) },
      after: { ...(cell(c.after.all) as Record<string, JsonValue>), byMode: scoped(c.after.rows, (t) => t.mode), byCategory: scoped(c.after.rows, (t) => t.category) },
      matchedCells: c.matchedCells,
      lostAttemptsReplacedByRetry: c.replaced.length,
      verdictAgainstBaseline: c.h4 === null ? null : verdict(c.h4),
    })),
  };

  const holdoutJson: JsonValue =
    holdout === null
      ? null
      : {
          exploratory: true,
          note: "8 tasks x 5 trials, one model, one run of each condition; the holdout baseline was not re-run; summary files only",
          tasks: holdout.tasks,
          trialsPerTaskAndCondition: holdout.trialsPerTask,
          lostAttemptRowsReplacedByRetry: { earlier: holdout.supersededRows.earlier, new: holdout.supersededRows.new },
          conditions: holdout.conditions.map((c) => ({ set: c.set, label: c.label, side: c.side, variant: c.variant, ...(cell(c.summary) as Record<string, JsonValue>), verdictAgainstEarlierBaseline: c.h4 === null ? null : verdict(c.h4) })),
        };

  const json: JsonValue = {
    kind: "mtek-ai-baseline",
    version: 1,
    generatedBy: "tools/ai-eval/src/compare-cli.ts --baseline-json (decision 0125); not edited by hand",
    measurement: {
      model: { ids: modelIds, provider: settingsOf(measured, "provider") },
      temperature: settingsOf(measured, "temperature"),
      promptCaching: settingsOf(measured, "promptCaching"),
      testFeedback: settingsOf(measured, "testFeedback"),
      maxRepairs: settingsOf(measured, "maxRepairs"),
      contextMaxBytes: settingsOf(measured, "contextMaxBytes"),
      promptVersions: settingsOf(measured, "promptVersions"),
      trialsPerTask: settingsOf(measured, "trials"),
      priceTableUsdPerMillionTokens: Object.fromEntries(modelIds.filter((m) => PRICING[m] !== undefined).map((m) => [m, PRICING[m] as unknown as JsonValue])),
      priceNote: "list prices from tools/ai-eval/src/spend.ts, applied to the usage the provider reported; not an invoice",
      harness: { package: "@mtek/ai-eval", version: harnessVersion, recordSchema: "spec/ai-eval-record.schema.json", decisions: ["0077", "0108", "0109", "0124", "0125"] },
      runsSeen: runs.map((r) => ({ runId: r.runId, retry: r.retry === true, status: r.status, startedAt: r.startedAt })),
    },
    sources: files.map((f) => ({ role: f.role, path: f.path, sha256: f.sha256, runIds: f.runIds, rows: f.rows })),
    main,
    holdout: holdoutJson,
    rule: { decision: "0108", matchedSuccessPoints: MATCHED_SUCCESS_POINTS * 100, maxNotJudgedShare: MAX_EXCLUDED_SHARE, protocolTrials: PROTOCOL_TRIALS },
    targets: {
      main: base === null ? null : { baselineCompletionRatePercent: base.completionRate === null ? null : Math.round(base.completionRate * 1000) / 10, baselineTokensPerCompletedTask: base.tokensPerCompleted === null ? null : Math.round(base.tokensPerCompleted) },
      holdout: holdoutBaseline === undefined ? null : { baselineCompletionRatePercent: holdoutBaseline.summary.completionRate === null ? null : Math.round(holdoutBaseline.summary.completionRate * 1000) / 10, baselineTokensPerCompletedTask: holdoutBaseline.summary.tokensPerCompleted === null ? null : Math.round(holdoutBaseline.summary.tokensPerCompleted) },
      research: { tokenRatioMax: TARGET_RATIO, meaning: "at matched success, at least 30 % fewer tokens per completed task than the baseline, with the verdict better (spec 6.4); a target, not a result" },
    },
  };
  return stringifySorted(json);
}
