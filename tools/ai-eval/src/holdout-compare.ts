// The holdout section of the before/after comparison (decision 0125), computed from SUMMARY JSONL FILES ONLY: the files written by
// `report-cli --holdout-summary` (ids, outcomes and layer outcomes, tokens and cost; the only form of a holdout result that may be in
// the repository). Nothing of a holdout run directory is read here, so a test can regenerate the section from the repository.
//
// Two summary files exist: `holdout-summary.jsonl` (M7-05: Mtek with the old context alone, and the three.js baseline) and
// `holdout-summary-m7-1.jsonl` (M7.1: the new context alone and with the guide, plus the lost attempts of the first holdout re-run, each marked
// `supersededBy` the retry run that replaced it). The first has no `runId`, `variant`, `trial` or links: they are read from the attempt id.
import { compare, summarize, type CellSummary, type Comparison as H4Comparison, type TrialRow } from "./report.ts";

export interface HoldoutRow {
  runId: string | null;
  trialId: string;
  taskId: string;
  side: "mtek" | "baseline";
  variant: string;
  trialKind: string;
  trial: number;
  outcome: TrialRow["outcome"];
  reason: string | null;
  calls: number;
  repairsUsed: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  costUsd: number | null;
  firstAttemptLayers: Record<string, string> | null;
  finalVerdict: string | null;
  supersededBy: string | null;
  retryOf: string | null;
}

const OUTCOMES: readonly string[] = ["success", "failure", "not-run", "error", "unavailable", "unfinished"];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const optString = (value: unknown): string | null => (typeof value === "string" ? value : null);
const optNumber = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** Reads a summary file. Throws on a line that is not a summary row: the form is part of what a test checks. */
export function parseHoldoutSummary(text: string, what = "holdout summary"): HoldoutRow[] {
  const rows: HoldoutRow[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    const where = `${what} line ${String(index + 1)}`;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`${where}: not JSON`);
    }
    if (!isRecord(value)) throw new Error(`${where}: not an object`);
    const trialId = optString(value["trialId"]);
    const taskId = optString(value["taskId"]);
    const outcome = optString(value["outcome"]);
    const side = value["side"];
    if (trialId === null || taskId === null || outcome === null || !OUTCOMES.includes(outcome) || (side !== "mtek" && side !== "baseline")) throw new Error(`${where}: not a holdout summary row (needs trialId, taskId, side and a known outcome)`);
    // `holdout-01--mtek-guide-unconstrained--00`: task, condition (side, document, kind), trial index
    const parts = trialId.split("--");
    const condition = parts[1] ?? "";
    const variant = optString(value["variant"]) ?? (side === "mtek" && condition.includes("guide") ? "+guide" : "");
    const trial = optNumber(value["trial"]) ?? Number.parseInt(parts[parts.length - 1] ?? "", 10);
    if (!Number.isInteger(trial)) throw new Error(`${where}: no trial index in the attempt id '${trialId}'`);
    const layers = value["firstAttemptLayers"];
    rows.push({
      runId: optString(value["runId"]),
      trialId,
      taskId,
      side,
      variant,
      trialKind: optString(value["trialKind"]) ?? "unconstrained",
      trial,
      outcome: outcome as TrialRow["outcome"],
      reason: optString(value["reason"]),
      calls: optNumber(value["calls"]) ?? 0,
      repairsUsed: optNumber(value["repairsUsed"]) ?? 0,
      inputTokens: optNumber(value["inputTokens"]),
      outputTokens: optNumber(value["outputTokens"]),
      cachedInputTokens: optNumber(value["cachedInputTokens"]),
      costUsd: optNumber(value["costUsd"]),
      firstAttemptLayers: isRecord(layers) ? (layers as Record<string, string>) : null,
      finalVerdict: optString(value["finalVerdict"]),
      supersededBy: optString(value["supersededBy"]),
      retryOf: optString(value["retryOf"]),
    });
  }
  return rows;
}

/** The attempts that count: the rows that a retry run did not replace. */
export const activeRows = (rows: readonly HoldoutRow[]): HoldoutRow[] => rows.filter((r) => r.supersededBy === null);

/** A summary row as the report's attempt row, so that the report's own summary and verdict functions apply (fields a summary lacks are empty). */
export function asTrialRow(row: HoldoutRow): TrialRow {
  const layers = row.firstAttemptLayers;
  const verdict = row.finalVerdict;
  return {
    runId: row.runId ?? "?",
    trialId: row.trialId,
    taskId: row.taskId,
    category: "",
    mode: "",
    side: row.side,
    variant: row.variant,
    trialKind: row.trialKind,
    trial: row.trial,
    model: "?",
    provider: "?",
    conditionId: "",
    outcome: row.outcome,
    reason: row.reason,
    message: null,
    calls: row.calls,
    repairsUsed: row.repairsUsed,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cachedInputTokens: row.cachedInputTokens,
    cacheWriteInputTokens: null,
    uncachedInputTokens: null,
    totalTokens: row.inputTokens === null || row.outputTokens === null ? null : row.inputTokens + row.outputTokens,
    costUsd: row.costUsd,
    durationMs: 0,
    modelMs: 0,
    validationMs: 0,
    firstAttempt:
      layers === null
        ? null
        : { verdict: "unknown", layers: { parse: layers["parse"] ?? "unknown", check: layers["check"] ?? "unknown", build: layers["build"] ?? "unknown", start: layers["start"] ?? "unknown", tests: layers["tests"] ?? "unknown" }, symbols: "unknown" },
    final: verdict === null ? null : { verdict, layers: { parse: "unknown", check: "unknown", build: "unknown", start: "unknown", tests: "unknown" }, symbols: "unknown" },
    holdout: true,
    attribution: { input: { instructions: 0, task: 0, documentation: 0, "project files": 0, diagnostics: 0, "tool results": 0, "repair context": 0, "generated code": 0, other: 0 }, outputTokens: 0, repairRoundInputTokens: 0, repairRoundOutputTokens: 0 },
    documentationBytes: null,
  };
}

export interface HoldoutCondition {
  /** `earlier` (the summary files before) or `new` (the files after). */
  set: "earlier" | "new";
  label: string;
  side: "mtek" | "baseline";
  variant: string;
  summary: CellSummary;
  rows: TrialRow[];
  /** The rule of decision 0108 against the earlier baseline; null for the baseline itself or when there is none. */
  h4: H4Comparison | null;
}

export interface HoldoutComparison {
  conditions: HoldoutCondition[];
  /** The rows of the summary files that a retry run replaced (lost attempts), by set. */
  supersededRows: { earlier: number; new: number };
  tasks: number;
  trialsPerTask: number;
}

function label(side: "mtek" | "baseline", variant: string): string {
  if (side === "baseline") return "three.js baseline";
  return variant === "" ? "Mtek, context only" : `Mtek, context + ${variant.slice(1).split("+").join(" + ")}`;
}

/**
 * The holdout conditions of the earlier and the new summary files, in the order: earlier Mtek (by variant), the earlier baseline, new Mtek
 * (by variant). Every Mtek condition is judged by the rule of decision 0108 against the EARLIER baseline (the holdout baseline was not
 * re-run). Only rows that no retry run replaced count.
 */
export function compareHoldout(earlier: readonly HoldoutRow[], later: readonly HoldoutRow[]): HoldoutComparison {
  const baselineRows = activeRows(earlier).filter((r) => r.side === "baseline").map(asTrialRow);
  const conditions: HoldoutCondition[] = [];
  const add = (set: "earlier" | "new", source: readonly HoldoutRow[]): void => {
    const keys = [...new Set(activeRows(source).map((r) => `${r.side === "baseline" ? "1" : "0"}\u0000${r.variant}`))].sort();
    for (const key of keys) {
      const [order = "0", variant = ""] = key.split("\u0000");
      const side = order === "1" ? "baseline" : "mtek";
      const rows = activeRows(source).filter((r) => r.side === side && r.variant === variant).map(asTrialRow);
      conditions.push({ set, label: label(side, variant), side, variant, summary: summarize(rows), rows, h4: side === "baseline" || baselineRows.length === 0 ? null : compare(rows, baselineRows) });
    }
  };
  add("earlier", earlier);
  add("new", later);
  // earlier Mtek first, then the earlier baseline, then the new Mtek conditions
  const rank = (c: HoldoutCondition): number => (c.set === "earlier" ? (c.side === "mtek" ? 0 : 1) : 2);
  conditions.sort((x, y) => rank(x) - rank(y));
  const all = conditions.flatMap((c) => c.rows);
  const tasks = new Set(all.map((r) => r.taskId));
  const perTask = [...tasks].flatMap((t) => conditions.map((c) => c.rows.filter((r) => r.taskId === t).length)).filter((n) => n > 0);
  return {
    conditions,
    supersededRows: { earlier: earlier.length - activeRows(earlier).length, new: later.length - activeRows(later).length },
    tasks: tasks.size,
    trialsPerTask: perTask.length === 0 ? 0 : Math.min(...perTask),
  };
}
