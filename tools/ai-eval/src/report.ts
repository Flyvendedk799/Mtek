// The report of the AI/token benchmark (spec/ai-and-benchmarks.md section 6.4, decision 0108), computed from the stored
// `records.jsonl` files ONLY: nothing is read from a running process, a ledger or the repository's tasks except the list of
// holdout ids (directory names) that tells the holdout apart. The same records give the same report, byte for byte.
//
// What it computes (per side, trial kind and model, per category and per mode):
//   - the outcomes of all attempts, the completion rate (completed / attempts that ended by themselves) and, separately, the
//     attempts the harness could not judge (not-run, error, unavailable, unfinished by budget), which are listed, never dropped;
//   - tokens per completed task = ALL tokens consumed by ALL attempts (successes, failures, unfinished) / completed tasks,
//     UNDEFINED (never 0, never infinity) when nothing completed;
//   - medians and interquartile ranges of tokens, repairs, wall time and cost; first-attempt parse, check, start and test success;
//   - input and output tokens separately, cached reads, cache writes and uncached input separately when the provider reported them;
//   - the input tokens attributed to instructions, task, documentation, project files, diagnostics, tool results, repair context
//     and generated code, by each part's share of the characters of the request (the provider counts tokens per request, not per part);
//   - the conclusion of hypothesis H4 by the rule of decision 0108: better, equivalent, worse or inconclusive, with its evidence.
// The holdout is reported apart and only by ids and layer outcomes: no prompt, message or candidate text.
import { MIN_TASKS_FOR_INTERVAL, quantile, ratioInterval, spread, sum, type RatioInterval, type Spread, type TaskTotals } from "./stats.ts";

export type SideName = "mtek" | "baseline";
export type Outcome = "success" | "failure" | "not-run" | "error" | "unavailable" | "unfinished";

type Raw = Record<string, unknown>;

export const MATCHED_SUCCESS_POINTS = 0.1;
export const PROTOCOL_TRIALS = 5;
export const TARGET_RATIO = 0.7;
/** Above this share of attempts that the harness could not judge, a comparison is not concluded. */
export const MAX_EXCLUDED_SHARE = 0.1;

const LAYER_NAMES = ["parse", "check", "build", "start", "tests"] as const;
type LayerName = (typeof LAYER_NAMES)[number];

export interface FirstAttempt {
  verdict: string;
  layers: Record<LayerName, string>;
  symbols: string;
}

export interface TrialRow {
  runId: string;
  trialId: string;
  taskId: string;
  category: string;
  mode: string;
  side: SideName;
  /** Which Mtek condition: empty for the compiler context alone, `+guide` when a document of `docs/` was added. */
  variant: string;
  trialKind: string;
  trial: number;
  model: string;
  provider: string;
  conditionId: string;
  outcome: Outcome;
  reason: string | null;
  message: string | null;
  /** True for an attempt recorded as a failure that the legacy rule of decision 0124 reads as not judged (`transport-error`). */
  legacyTransport?: boolean;
  /** Set on an attempt that was not judged and whose cell a retry run supplied instead: the id of that retry run (decision 0125). */
  supersededBy?: string;
  /** Set on an attempt of a retry run: the id of the run whose not-judged attempt of the same cell it replaces (decision 0125). */
  retryOf?: string;
  calls: number;
  repairsUsed: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteInputTokens: number | null;
  /** Input that was neither read from nor written to the cache. */
  uncachedInputTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  durationMs: number;
  modelMs: number;
  validationMs: number;
  firstAttempt: FirstAttempt | null;
  final: FirstAttempt | null;
  holdout: boolean;
  /** Input tokens attributed to sources (character share of each request) and the output tokens. */
  attribution: Attribution;
  /** The documentation (context export or reference) given to the model, in bytes. */
  documentationBytes: number | null;
}

export const SOURCES = ["instructions", "task", "documentation", "project files", "diagnostics", "tool results", "repair context", "generated code", "other"] as const;
export type Source = (typeof SOURCES)[number];

export interface Attribution {
  input: Record<Source, number>;
  outputTokens: number;
  /** Input tokens of the calls after the first (repair rounds). */
  repairRoundInputTokens: number;
  repairRoundOutputTokens: number;
}

export interface RunInfo {
  runId: string;
  settings: Raw | null;
  spend: Raw | null;
  status: string | null;
  startedAt: string | null;
  endedAt: string | null;
  /** True for a retry run (decision 0125): its attempts replace not-judged attempts of the other runs. */
  retry?: boolean;
}

const SECTION_SOURCE: Record<string, Source> = {
  system: "instructions",
  instructions: "instructions",
  task: "task",
  requiredSymbols: "task",
  context: "documentation",
  project: "project files",
  diagnostics: "diagnostics",
  "required-symbols": "diagnostics",
  "edit-errors": "diagnostics",
  layers: "tool results",
  "test-feedback": "tool results",
  "current-files": "repair context",
};

function emptyAttribution(): Attribution {
  const input = {} as Record<Source, number>;
  for (const source of SOURCES) input[source] = 0;
  return { input, outputTokens: 0, repairRoundInputTokens: 0, repairRoundOutputTokens: 0 };
}

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function parseRecords(jsonl: string): Raw[] {
  const out: Raw[] = [];
  for (const [index, line] of jsonl.split("\n").entries()) {
    if (line.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`records line ${String(index + 1)}: not JSON`);
    }
    if (!isRecord(value) || typeof value["type"] !== "string") throw new Error(`records line ${String(index + 1)}: not a record`);
    out.push(value);
  }
  return out;
}

/**
 * The records of the attempts of one side only (plus the run-start and run-end records), for a report that borrows the other
 * side of an earlier run (a re-run of Mtek compared with the baseline attempts of the earlier run, decision 0124). The attempts
 * of the side that is left out are not read at all.
 */
export function selectSide(records: readonly Raw[], side: SideName): Raw[] {
  const keep = new Set<string>();
  for (const record of records) {
    if (record["type"] !== "trial-start") continue;
    const condition = isRecord(record["condition"]) ? record["condition"] : {};
    if ((condition["side"] === "baseline" ? "baseline" : "mtek") === side) keep.add(`${str(record["runId"], "?")}\u0000${str(record["trialId"])}`);
  }
  return records.filter((record) => {
    const type = str(record["type"]);
    if (type === "run-start" || type === "run-end") return true;
    return keep.has(`${str(record["runId"], "?")}\u0000${str(record["trialId"])}`);
  });
}

/** The first attempt of a trial whose first reply produced no candidate. */
const NO_CANDIDATE: FirstAttempt = { verdict: "no-candidate", layers: { parse: "none", check: "none", build: "none", start: "none", tests: "none" }, symbols: "none" };

/** `context-export+docs/language-guide.md:ab12` is the variant `+guide`; the context alone and the baseline have none. */
export function variantOf(documentation: string): string {
  const match = /^context-export\+([^:]+)/.exec(documentation);
  if (match === null) return "";
  return (match[1] as string)
    .split("+")
    .map((path) => `+${(path.split("/").pop() ?? path).replace(/\.md$/, "").replace(/^language-/, "")}`)
    .join("");
}

function layersOf(value: unknown): Record<LayerName, string> {
  const layers = {} as Record<LayerName, string>;
  for (const name of LAYER_NAMES) {
    const layer = isRecord(value) ? value[name] : undefined;
    layers[name] = isRecord(layer) ? str(layer["outcome"], "unknown") : "unknown";
  }
  return layers;
}

function attemptOf(value: unknown): FirstAttempt | null {
  if (!isRecord(value)) return null;
  const symbols = value["requiredSymbols"];
  return { verdict: str(value["verdict"], "unknown"), layers: layersOf(value["layers"]), symbols: isRecord(symbols) ? str(symbols["outcome"], "unknown") : "unknown" };
}

/**
 * The error texts of the Anthropic SDK for a call that got no response at all: a refused or dropped connection and a timeout.
 * Records made before decision 0124 have no `errorKind`, so this text is what the legacy rule reads.
 */
const LEGACY_TRANSPORT_ERRORS: ReadonlySet<string> = new Set(["Connection error.", "Request timed out."]);

/**
 * The legacy rule (decision 0124): a trial recorded as a `failure` with the reason `generation-error`, of which every model call
 * is `backend-error` with one of the transport texts above, no response text, no tokens and no HTTP status, never reached a
 * model: it is read as `error` / `transport-error` (not judged). A trial with any other call is not touched.
 */
function legacyTransportTrial(calls: readonly CallInfo[], outcome: string, reason: string | null): boolean {
  return (
    outcome === "failure" &&
    reason === "generation-error" &&
    calls.length > 0 &&
    calls.every(
      (c) =>
        c.generation === "backend-error" &&
        c.error !== null &&
        LEGACY_TRANSPORT_ERRORS.has(c.error.trim()) &&
        c.responseChars === 0 &&
        c.httpStatus === null &&
        c.usage !== null &&
        num(c.usage["inputTokens"]) === 0 &&
        num(c.usage["outputTokens"]) === 0,
    )
  );
}

interface CallInfo {
  round: number;
  generation: string;
  error: string | null;
  httpStatus: number | null;
  usage: Raw | null;
  costUsd: number | null;
  durationMs: number;
  sections: Record<string, number> | null;
  system: number;
  messages: { role: string; chars: number }[] | null;
  responseChars: number;
}

/** Splits the records of one or more runs into trials (one row each, in the order they started) and the runs. */
function extractPlain(records: readonly Raw[], holdoutIds: ReadonlySet<string>): { trials: TrialRow[]; runs: RunInfo[] } {
  const runs = new Map<string, RunInfo>();
  const byTrial = new Map<string, { start: Raw | null; calls: CallInfo[]; validations: Raw[]; end: Raw | null; runId: string }>();
  const order: string[] = [];
  for (const record of records) {
    const runId = str(record["runId"], "?");
    const type = str(record["type"]);
    if (type === "run-start") {
      const info = runs.get(runId) ?? { runId, settings: null, spend: null, status: null, startedAt: null, endedAt: null };
      info.settings = isRecord(record["settings"]) ? record["settings"] : null;
      info.startedAt = str(record["startedAt"]) || null;
      runs.set(runId, info);
      continue;
    }
    if (type === "run-end") {
      const info = runs.get(runId) ?? { runId, settings: null, spend: null, status: null, startedAt: null, endedAt: null };
      info.spend = isRecord(record["spend"]) ? record["spend"] : null;
      info.status = str(record["status"]) || null;
      info.endedAt = str(record["endedAt"]) || null;
      runs.set(runId, info);
      continue;
    }
    const trialId = str(record["trialId"]);
    if (trialId === "") continue;
    const key = `${runId}\u0000${trialId}`;
    let entry = byTrial.get(key);
    if (entry === undefined) {
      entry = { start: null, calls: [], validations: [], end: null, runId };
      byTrial.set(key, entry);
      order.push(key);
    }
    if (type === "trial-start") entry.start = record;
    else if (type === "trial-end") entry.end = record;
    else if (type === "validation") entry.validations.push(record);
    else if (type === "model-call") {
      const request = isRecord(record["request"]) ? record["request"] : null;
      const messages = request !== null && Array.isArray(request["messages"]) ? (request["messages"] as unknown[]).filter(isRecord).map((m) => ({ role: str(m["role"]), chars: str(m["content"]).length })) : null;
      const sections = isRecord(record["promptSections"]) ? (record["promptSections"] as Record<string, number>) : null;
      const response = isRecord(record["response"]) ? record["response"] : null;
      entry.calls.push({
        round: num(record["round"]) ?? 0,
        generation: str(record["generation"]),
        error: typeof record["error"] === "string" ? record["error"] : null,
        httpStatus: num(record["httpStatus"]),
        usage: isRecord(record["usage"]) ? record["usage"] : null,
        costUsd: num(record["costUsd"]),
        durationMs: num(record["durationMs"]) ?? 0,
        sections,
        system: request === null ? 0 : str(request["system"]).length,
        messages,
        responseChars: response === null ? 0 : str(response["text"]).length,
      });
    }
  }

  const trials: TrialRow[] = [];
  for (const key of order) {
    const entry = byTrial.get(key);
    if (entry === undefined || entry.start === null) continue;
    const start = entry.start;
    const condition = isRecord(start["condition"]) ? start["condition"] : {};
    const end = entry.end;
    const calls = [...entry.calls].sort((a, b) => a.round - b.round);
    const real = calls.filter((c) => c.usage !== null);
    const known = (field: string): number | null => {
      let total = 0;
      for (const call of real) {
        const value = num((call.usage as Raw)[field]);
        if (value === null) return null;
        total += value;
      }
      return total;
    };
    const inputTokens = known("inputTokens");
    const outputTokens = known("outputTokens");
    const cachedInputTokens = known("cachedInputTokens");
    // A provider that reports no write count has no cache writes to report.
    const writes = real.every((c) => (c.usage as Raw)["cacheWriteInputTokens"] === undefined) ? (real.length === 0 ? 0 : null) : known("cacheWriteInputTokens");
    const uncached = inputTokens === null || cachedInputTokens === null ? null : inputTokens - cachedInputTokens - (writes ?? 0);
    const costs = calls.map((c) => c.costUsd);
    const costUsd = costs.every((c) => c === null) ? null : sum(costs.map((c) => c ?? 0));
    const taskId = str(start["taskId"]);
    const validations = entry.validations;
    // The first attempt is the candidate of the first reply (round 0). A first reply that produced no candidate (its edit was
    // rejected, or the generation failed) is a failed first attempt on every layer, not a missing one; a trial that made no call
    // at all (unavailable, unfinished by budget) has no first attempt.
    const first = validations.find((v) => (num(v["round"]) ?? 0) === 0);
    const firstCalled = calls.some((c) => c.round === 0 && c.usage !== null);
    const endOutcome = end === null ? "unfinished" : str(end["outcome"]);
    const recordedOutcome = (["success", "failure", "not-run", "error", "unavailable", "unfinished"] as const).includes(endOutcome as Outcome) ? (endOutcome as Outcome) : "error";
    const recordedReason = end === null || end["reason"] === null ? null : str(end["reason"]);
    // Records made before the harness retried and marked transport failures (decision 0124) say `failure` for an attempt that never
    // reached the model; they are read as not judged. The records themselves are not changed.
    const legacyTransport = end !== null && legacyTransportTrial(calls, recordedOutcome, recordedReason);
    const outcome: Outcome = legacyTransport ? "error" : recordedOutcome;
    const reason = end === null ? "no trial-end record (the run was interrupted)" : legacyTransport ? "transport-error" : recordedReason;
    const recordedMessage = end === null || end["message"] === null ? null : str(end["message"]);
    const message = legacyTransport ? `${recordedMessage ?? "no response"} (no response from the model; record made before decision 0124, read as not judged)` : recordedMessage;
    // An attempt that never reached the model has no first attempt; a failed first reply that did reach it is a failed first attempt.
    const noModel = reason === "transport-error";
    trials.push({
      runId: entry.runId,
      trialId: str(start["trialId"]),
      taskId,
      category: str(start["category"]),
      mode: str(start["mode"]),
      side: condition["side"] === "baseline" ? "baseline" : "mtek",
      variant: variantOf(str(condition["documentation"])),
      trialKind: str(start["trialKind"], "unconstrained"),
      trial: num(start["trial"]) ?? 0,
      model: str(condition["model"], "?"),
      provider: str(condition["provider"], "?"),
      conditionId: str(start["conditionId"]),
      outcome,
      reason,
      message,
      ...(legacyTransport ? { legacyTransport: true } : {}),
      calls: end === null ? calls.length : (num(end["calls"]) ?? calls.length),
      repairsUsed: end === null ? Math.max(0, calls.length - 1) : (num(end["repairsUsed"]) ?? 0),
      inputTokens,
      outputTokens,
      cachedInputTokens,
      cacheWriteInputTokens: writes,
      uncachedInputTokens: uncached,
      totalTokens: inputTokens === null || outputTokens === null ? null : inputTokens + outputTokens,
      costUsd: costUsd === null ? (end !== null && num(end["costUsd"]) !== null ? num(end["costUsd"]) : null) : costUsd,
      durationMs: end === null ? 0 : (num(end["durationMs"]) ?? 0),
      modelMs: sum(calls.map((c) => c.durationMs)),
      validationMs: sum(validations.map((v) => num(v["durationMs"]) ?? 0)),
      firstAttempt: first !== undefined ? attemptOf(first) : firstCalled && !noModel ? NO_CANDIDATE : null,
      final: end === null ? null : attemptOf(end["final"]),
      holdout: holdoutIds.has(taskId),
      attribution: attribute(calls),
      documentationBytes: num(start["contextBytes"]),
    });
  }
  return { trials, runs: [...runs.values()] };
}

/** True when the harness could judge the attempt: it ended by itself, as a success or a failure. */
export const isJudged = (t: Pick<TrialRow, "outcome">): boolean => t.outcome === "success" || t.outcome === "failure";

/** The cell an attempt occupies: side, trial kind, Mtek variant, task and trial index. A retry attempt replaces the attempt of its own cell. */
export const cellOf = (t: TrialRow): string => `${t.side}\u0000${t.trialKind}\u0000${t.variant}\u0000${t.taskId}\u0000${String(t.trial)}`;

const describeCell = (t: TrialRow): string => `${t.taskId}, trial ${String(t.trial)}, ${t.side}${t.variant === "" ? "" : ` ${t.variant}`}${t.trialKind === "unconstrained" ? "" : ` ${t.trialKind}`}`;

export interface Extracted {
  /** The attempts that count: every attempt of the runs, except that a not-judged attempt a retry run replaced is left out and the retry attempt is in. */
  trials: TrialRow[];
  runs: RunInfo[];
  /** The not-judged attempts that a retry run replaced (each marked `supersededBy`); empty without retry runs. */
  superseded: TrialRow[];
  /** Every attempt of every run, replaced ones included: the superseded attempts in the place of the run they came from, the retry attempts after them. */
  listing: TrialRow[];
}

/**
 * Splits the records into trials. `retryRecords` are the records of RETRY runs (decision 0125): a retry run supplies attempts for cells
 * (task, condition, trial index) whose attempt in `records` was NOT judged (error, unavailable, unfinished, not-run, or a failure read
 * as `transport-error` by the legacy rule). In `trials` the retry attempt replaces the not-judged one; the replaced attempt stays in
 * `listing` and `superseded`. A retry attempt for a cell that was judged, for a cell with no attempt in `records`, a second retry
 * attempt for one cell, a retry whose model or condition differs from the attempt it replaces, and a retry run that repeats a run id of
 * `records` are all errors: nothing is silently dropped or replaced.
 */
export function extractTrials(records: readonly Raw[], holdoutIds: ReadonlySet<string> = new Set(), retryRecords: readonly Raw[] = []): Extracted {
  const base = extractPlain(records, holdoutIds);
  if (retryRecords.length === 0) return { trials: base.trials, runs: base.runs, superseded: [], listing: base.trials };
  const retry = extractPlain(retryRecords, holdoutIds);
  const known = new Set(base.runs.map((r) => r.runId));
  for (const run of retry.runs) if (known.has(run.runId)) throw new Error(`retry run '${run.runId}' has the same id as a run it is a retry of; give each run its own id`);
  const byCell = new Map<string, TrialRow[]>();
  for (const t of base.trials) byCell.set(cellOf(t), [...(byCell.get(cellOf(t)) ?? []), t]);
  const replaced = new Map<TrialRow, TrialRow>();
  const seen = new Set<string>();
  const retried: TrialRow[] = [];
  for (const r of retry.trials) {
    const cell = cellOf(r);
    const where = `retry run '${r.runId}', attempt ${r.trialId} (${describeCell(r)})`;
    if (seen.has(cell)) throw new Error(`${where}: the retry runs hold more than one attempt for this cell`);
    seen.add(cell);
    const originals = byCell.get(cell) ?? [];
    if (originals.length === 0) throw new Error(`${where}: no attempt of the other runs occupies this cell; a retry run supplies attempts only for cells whose attempt there was not judged`);
    if (originals.length > 1) throw new Error(`${where}: more than one attempt of the other runs occupies this cell, so it is not clear which one the retry replaces`);
    const original = originals[0] as TrialRow;
    if (isJudged(original)) throw new Error(`${where}: the attempt ${original.trialId} of run '${original.runId}' for this cell WAS judged (${original.outcome}); a retry run may replace only an attempt that was not judged`);
    if (original.model !== r.model || original.provider !== r.provider) throw new Error(`${where}: it was run with ${r.provider} / ${r.model}, the attempt it replaces with ${original.provider} / ${original.model}`);
    if (original.conditionId !== r.conditionId) throw new Error(`${where}: its condition id differs from that of the attempt it replaces (${original.conditionId.slice(0, 12)} against ${r.conditionId.slice(0, 12)}): not the same condition`);
    replaced.set(original, { ...original, supersededBy: r.runId });
    retried.push({ ...r, retryOf: original.runId });
  }
  const marked = (t: TrialRow): TrialRow => replaced.get(t) ?? t;
  const superseded = base.trials.filter((t) => replaced.has(t)).map(marked);
  return {
    trials: [...base.trials.filter((t) => !replaced.has(t)), ...retried],
    runs: [...base.runs, ...retry.runs.map((r) => ({ ...r, retry: true }))],
    superseded,
    listing: [...base.trials.map(marked), ...retried],
  };
}

/** Input tokens per source by each part's share of the request's characters; output tokens are generated code. */
function attribute(calls: readonly CallInfo[]): Attribution {
  const result = emptyAttribution();
  const sectionsOfRound = new Map<number, Record<string, number>>();
  for (const call of calls) if (call.sections !== null) sectionsOfRound.set(call.round, call.sections);
  for (const call of calls) {
    if (call.usage === null) continue;
    const input = num(call.usage["inputTokens"]);
    const output = num(call.usage["outputTokens"]);
    if (output !== null) {
      result.outputTokens += output;
      if (call.round > 0) result.repairRoundOutputTokens += output;
    }
    if (input === null || call.messages === null) continue;
    if (call.round > 0) result.repairRoundInputTokens += input;
    const chars = {} as Record<Source, number>;
    for (const source of SOURCES) chars[source] = 0;
    chars.instructions += call.system;
    let user = 0;
    for (const message of call.messages) {
      if (message.role === "assistant") {
        chars["generated code"] += message.chars;
        continue;
      }
      const sections = sectionsOfRound.get(user);
      user += 1;
      let accounted = 0;
      if (sections !== undefined) {
        for (const [name, size] of Object.entries(sections)) {
          if (name === "system") continue;
          chars[SECTION_SOURCE[name] ?? "other"] += size;
          accounted += size;
        }
      }
      chars.other += Math.max(0, message.chars - accounted);
    }
    const total = sum(SOURCES.map((source) => chars[source]));
    if (total === 0) continue;
    for (const source of SOURCES) result.input[source] += (input * chars[source]) / total;
  }
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------
// Aggregates

export interface CellSummary {
  n: number;
  success: number;
  failure: number;
  notRun: number;
  error: number;
  unavailable: number;
  unfinished: number;
  /** success + failure: the attempts that ended by themselves. */
  valid: number;
  /** success / valid; null when no attempt ended by itself. */
  completionRate: number | null;
  /** success / n, counting every attempt. */
  completionRateAll: number | null;
  /** The attempts the harness could not judge, as a share of all. */
  excludedShare: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  uncachedInputTokens: number;
  /** Attempts with an unknown token count (their tokens are not in the sums). */
  unknownUsage: number;
  /** All tokens of all attempts / completed tasks; null = UNDEFINED (nothing completed). */
  tokensPerCompleted: number | null;
  costUsd: number;
  costPerCompleted: number | null;
  tokensAll: Spread;
  tokensCompleted: Spread;
  repairsCompleted: Spread;
  callsAll: Spread;
  durationSeconds: Spread;
  firstAttempt: { n: number; parse: number; check: number; start: number; tests: number; pass: number };
}

export function summarize(rows: readonly TrialRow[]): CellSummary {
  const count = (outcome: Outcome): number => rows.filter((r) => r.outcome === outcome).length;
  const success = count("success");
  const failure = count("failure");
  const valid = success + failure;
  const known = rows.filter((r) => r.totalTokens !== null);
  const total = sum(known.map((r) => r.totalTokens as number));
  const part = (pick: (r: TrialRow) => number | null): number => sum(rows.map((r) => pick(r) ?? 0));
  const done = rows.filter((r) => r.outcome === "success");
  const withFirst = rows.filter((r) => r.firstAttempt !== null);
  const passes = (layer: LayerName): number => withFirst.filter((r) => (r.firstAttempt as FirstAttempt).layers[layer] === "pass").length;
  const costKnown = rows.filter((r) => r.costUsd !== null);
  const cost = sum(costKnown.map((r) => r.costUsd as number));
  return {
    n: rows.length,
    success,
    failure,
    notRun: count("not-run"),
    error: count("error"),
    unavailable: count("unavailable"),
    unfinished: count("unfinished"),
    valid,
    completionRate: valid === 0 ? null : success / valid,
    completionRateAll: rows.length === 0 ? null : success / rows.length,
    excludedShare: rows.length === 0 ? 0 : (rows.length - valid) / rows.length,
    totalTokens: total,
    inputTokens: part((r) => r.inputTokens),
    outputTokens: part((r) => r.outputTokens),
    cachedInputTokens: part((r) => r.cachedInputTokens),
    cacheWriteInputTokens: part((r) => r.cacheWriteInputTokens),
    uncachedInputTokens: part((r) => r.uncachedInputTokens),
    unknownUsage: rows.length - known.length,
    tokensPerCompleted: success === 0 ? null : total / success,
    costUsd: cost,
    costPerCompleted: success === 0 || costKnown.length === 0 ? null : cost / success,
    tokensAll: spread(known.map((r) => r.totalTokens as number)),
    tokensCompleted: spread(done.filter((r) => r.totalTokens !== null).map((r) => r.totalTokens as number)),
    repairsCompleted: spread(done.map((r) => r.repairsUsed)),
    callsAll: spread(rows.map((r) => r.calls)),
    durationSeconds: spread(rows.filter((r) => r.durationMs > 0).map((r) => r.durationMs / 1000)),
    firstAttempt: { n: withFirst.length, parse: passes("parse"), check: passes("check"), start: passes("start"), tests: passes("tests"), pass: withFirst.filter((r) => (r.firstAttempt as FirstAttempt).verdict === "pass").length },
  };
}

export type H4Verdict = "better" | "equivalent" | "worse" | "inconclusive";

export interface Comparison {
  /** Tasks with attempts on both sides. */
  tasks: string[];
  /** Tasks with attempts on one side only (left out of the comparison and listed). */
  unmatchedTasks: string[];
  mtek: CellSummary;
  baseline: CellSummary;
  interval: RatioInterval;
  /** mtek completion rate - baseline completion rate, in points (0 to 1); null when either is undefined. */
  completionDifference: number | null;
  successAxis: "higher" | "matched" | "lower" | "undefined";
  tokensAxis: "fewer" | "same" | "more" | "undefined";
  verdict: H4Verdict;
  /** What decided the verdict, or why none could be reached. */
  reason: string;
  /** The research target of spec 6.4: better, and at least 30 % fewer tokens per completed task (point estimate). */
  targetMet: boolean;
  /** True when the evidence is below the protocol (fewer than 5 trials per task and side, or too many attempts unjudged). */
  provisional: boolean;
  provisionalReasons: string[];
  minTrialsPerTaskSide: number;
}

function totalsOf(rows: readonly TrialRow[], taskId: string): TaskTotals {
  const mine = rows.filter((r) => r.taskId === taskId);
  return {
    tokens: sum(mine.map((r) => r.totalTokens ?? 0)),
    completed: mine.filter((r) => r.outcome === "success").length,
    valid: mine.filter((r) => r.outcome === "success" || r.outcome === "failure").length,
  };
}

/**
 * H4 by the rule of decision 0108. The two axes: success (completion rate over the attempts that ended by themselves,
 * `matched` when within 10 points) and tokens per completed task (the ratio mtek / baseline over the same tasks, `fewer` when
 * the 95 % bootstrap interval over tasks lies below 1, `more` when above, else `same`).
 *   better       success matched or higher and tokens fewer; or success higher and tokens the same
 *   worse        success matched or lower and tokens more; or success lower and tokens the same
 *   equivalent   success matched and tokens the same
 *   inconclusive nothing completes on either side, the axes oppose each other, or too much was left unjudged
 * One side completing nothing while the other completes something is decided: the one that completes is better.
 * The research target (30 % fewer tokens per completed task) is reported apart and is not part of the verdict.
 */
export function compare(mtekRows: readonly TrialRow[], baselineRows: readonly TrialRow[]): Comparison {
  const mtekTasks = new Set(mtekRows.map((r) => r.taskId));
  const baselineTasks = new Set(baselineRows.map((r) => r.taskId));
  const tasks = [...mtekTasks].filter((t) => baselineTasks.has(t)).sort();
  const unmatchedTasks = [...new Set([...mtekTasks, ...baselineTasks])].filter((t) => !(mtekTasks.has(t) && baselineTasks.has(t))).sort();
  const m = mtekRows.filter((r) => tasks.includes(r.taskId));
  const b = baselineRows.filter((r) => tasks.includes(r.taskId));
  const mtek = summarize(m);
  const baseline = summarize(b);
  const interval = ratioInterval(tasks.map((t) => totalsOf(m, t)), tasks.map((t) => totalsOf(b, t)));
  const difference = mtek.completionRate === null || baseline.completionRate === null ? null : mtek.completionRate - baseline.completionRate;
  const successAxis = difference === null ? "undefined" : difference > MATCHED_SUCCESS_POINTS ? "higher" : difference < -MATCHED_SUCCESS_POINTS ? "lower" : "matched";
  let tokensAxis: Comparison["tokensAxis"] = "undefined";
  if (interval.point !== null && interval.low !== null && interval.high !== null) tokensAxis = interval.high < 1 ? "fewer" : interval.low > 1 ? "more" : "same";

  let verdict: H4Verdict;
  let reason: string;
  if (tasks.length === 0) {
    verdict = "inconclusive";
    reason = "no task has attempts on both sides";
  } else if (mtek.tokensPerCompleted === null && baseline.tokensPerCompleted === null) {
    verdict = "inconclusive";
    reason = "nothing completes on either side: tokens per completed task is undefined for both";
  } else if (mtek.tokensPerCompleted === null) {
    verdict = "worse";
    reason = "nothing completes on the Mtek side while the baseline completes tasks: tokens per completed task is undefined for Mtek";
  } else if (baseline.tokensPerCompleted === null) {
    verdict = "better";
    reason = "the Mtek side completes tasks while nothing completes on the baseline side: tokens per completed task is undefined for the baseline";
  } else if (tokensAxis === "undefined") {
    verdict = "inconclusive";
    reason = `${String(tasks.length)} task(s) are too few for an interval of the token ratio (at least ${String(MIN_TASKS_FOR_INTERVAL)} are needed): the point estimate is reported, no direction is concluded`;
  } else if (successAxis === "matched" && tokensAxis === "same") {
    verdict = "equivalent";
    reason = "completion matched within 10 points and the interval of the token ratio contains 1";
  } else if ((successAxis === "matched" || successAxis === "higher") && tokensAxis === "fewer") {
    verdict = "better";
    reason = `completion ${successAxis === "higher" ? "higher" : "matched"} and tokens per completed task significantly fewer`;
  } else if (successAxis === "higher" && tokensAxis === "same") {
    verdict = "better";
    reason = "completion higher by more than 10 points at the same tokens per completed task";
  } else if ((successAxis === "matched" || successAxis === "lower") && tokensAxis === "more") {
    verdict = "worse";
    reason = `completion ${successAxis === "lower" ? "lower" : "matched"} and tokens per completed task significantly more`;
  } else if (successAxis === "lower" && tokensAxis === "same") {
    verdict = "worse";
    reason = "completion lower by more than 10 points at the same tokens per completed task";
  } else {
    verdict = "inconclusive";
    reason = `the axes oppose each other (completion ${successAxis}, tokens ${tokensAxis}): neither side dominates`;
  }

  const minTrials = Math.min(
    ...tasks.flatMap((t) => [m.filter((r) => r.taskId === t).length, b.filter((r) => r.taskId === t).length]),
    Number.POSITIVE_INFINITY,
  );
  const provisionalReasons: string[] = [];
  if (Number.isFinite(minTrials) && minTrials < PROTOCOL_TRIALS) provisionalReasons.push(`some task has only ${String(minTrials)} trial(s) on a side; the protocol asks for ${String(PROTOCOL_TRIALS)}`);
  if (Math.max(mtek.excludedShare, baseline.excludedShare) > MAX_EXCLUDED_SHARE) provisionalReasons.push(`more than ${String(MAX_EXCLUDED_SHARE * 100)} % of the attempts could not be judged (not-run, error, unavailable or unfinished)`);
  if (mtek.unknownUsage + baseline.unknownUsage > 0) provisionalReasons.push("some attempts have unknown token counts");
  if (unmatchedTasks.length > 0) provisionalReasons.push(`${String(unmatchedTasks.length)} task(s) have attempts on one side only`);
  return {
    tasks,
    unmatchedTasks,
    mtek,
    baseline,
    interval,
    completionDifference: difference,
    successAxis,
    tokensAxis,
    verdict,
    reason,
    targetMet: verdict === "better" && interval.point !== null && interval.point <= TARGET_RATIO,
    provisional: provisionalReasons.length > 0,
    provisionalReasons,
    minTrialsPerTaskSide: Number.isFinite(minTrials) ? minTrials : 0,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Rendering

const n0 = (value: number): string => Math.round(value).toLocaleString("en-US");
const n1 = (value: number): string => value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (value: number | null): string => (value === null ? "undefined" : `${n1(value * 100)} %`);
const usd = (value: number | null): string => (value === null ? "n/a" : `$${value.toFixed(4)}`);
const tok = (value: number | null): string => (value === null ? "UNDEFINED" : n0(value));
const spreadText = (s: Spread, digits = 0): string =>
  s.median === null || s.q1 === null || s.q3 === null ? "n/a" : `${digits === 0 ? n0(s.median) : n1(s.median)} [${digits === 0 ? n0(s.q1) : n1(s.q1)}, ${digits === 0 ? n0(s.q3) : n1(s.q3)}]`;

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`)];
  return lines.join("\n");
}

function cellRow(label: string, c: CellSummary): string[] {
  return [
    label,
    String(c.n),
    `${String(c.success)} / ${String(c.failure)} / ${String(c.notRun + c.error + c.unavailable + c.unfinished)}`,
    pct(c.completionRate),
    tok(c.tokensPerCompleted),
    spreadText(c.tokensAll),
    spreadText(c.tokensCompleted),
    spreadText(c.repairsCompleted, 1),
    spreadText(c.durationSeconds, 1),
    usd(c.costUsd),
  ];
}

const CELL_HEADER = ["cell", "attempts", "completed / failed / not judged", "completion rate", "tokens per completed task", "tokens per attempt, median [IQR]", "tokens per completed attempt, median [IQR]", "repairs per completed, median [IQR]", "seconds per attempt, median [IQR]", "cost"];

function sideLabel(side: SideName, kind: string): string {
  return `${side} ${kind}`;
}

export interface ReportInput {
  records: readonly Raw[];
  /** Records of retry runs (decision 0125): their attempts replace not-judged attempts of the same cells in `records`. */
  retryRecords?: readonly Raw[];
  /** Task ids of the holdout set (names of the directories); attempts at these are reported apart, by outcome only. */
  holdoutIds?: ReadonlySet<string>;
  title?: string;
  /** A one-paragraph label printed under the title (for example, that the report is a pilot). */
  note?: string;
}

export interface ReportOutput {
  markdown: string;
  comparisons: { model: string; kind: string; scope: string; comparison: Comparison }[];
  trials: TrialRow[];
  /** Not-judged attempts that a retry run replaced (empty without retry runs). */
  superseded: TrialRow[];
  /** Every attempt, replaced ones included. */
  listing: TrialRow[];
}

function describeCondition(runs: readonly RunInfo[]): string {
  const rows: string[][] = [];
  for (const run of runs) {
    const s = run.settings;
    const spend = run.spend;
    rows.push([
      run.retry === true ? `${run.runId} (retry run)` : run.runId,
      run.startedAt ?? "?",
      run.status ?? "no run-end record",
      s === null ? "?" : `${str(s["provider"], "?")} / ${str(s["model"], "?")}`,
      s === null ? "?" : `temperature ${String(s["temperature"])}, prompt caching ${String(s["promptCaching"])}, test feedback ${String(s["testFeedback"])}, max repairs ${String(s["maxRepairs"])}`,
      spend === null ? "no guard" : `cap $${String(spend["capUsd"])}, this run $${(num(spend["runSpendUsd"]) ?? 0).toFixed(4)}, ledger after $${(num(spend["ledgerTotalEndUsd"]) ?? 0).toFixed(4)}, ${String(spend["calls"])} calls, ${String(spend["refusedCalls"])} refused`,
    ]);
  }
  return table(["run", "started", "status", "provider / model", "settings", "spend"], rows);
}

export function buildReport(input: ReportInput): ReportOutput {
  const holdoutIds = input.holdoutIds ?? new Set<string>();
  const { trials, runs, superseded, listing } = extractTrials(input.records, holdoutIds, input.retryRecords ?? []);
  const main = trials.filter((t) => !t.holdout);
  const holdout = trials.filter((t) => t.holdout);
  const mainListing = listing.filter((t) => !t.holdout);
  const holdoutListing = listing.filter((t) => t.holdout);
  const mainSuperseded = superseded.filter((t) => !t.holdout);
  const comparisons: ReportOutput["comparisons"] = [];
  const out: string[] = [];
  out.push(`# ${input.title ?? "AI/token benchmark report"}`, "");
  if (input.note !== undefined) out.push(input.note, "");
  out.push(
    "Generated from the stored `records.jsonl` by `tools/ai-eval/src/report.ts` (decision 0108); the same records give the same text. " +
      "Every attempt is listed in the last section, failures included. The original \"about 80 % fewer tokens\" claim is an unverified hypothesis and is not tested by the 30 % research target below.",
    "",
  );

  out.push("## Runs and recorded settings", "", describeCondition(runs), "");
  const models = [...new Set(main.map((t) => t.model))].sort();
  const dates = runs.map((r) => r.startedAt).filter((d): d is string => d !== null).sort();
  out.push(`Date of the runs: ${dates.length === 0 ? "unknown" : `${dates[0] as string} to ${dates[dates.length - 1] as string}`}. Models: ${models.join(", ") || "none"}.`, "");

  for (const model of models) {
    const rows = main.filter((t) => t.model === model);
    const kinds = [...new Set(rows.map((t) => t.trialKind))].sort();
    out.push(`## Model ${model}`, "");

    // ---- the conclusion
    const baselineRows = rows.filter((t) => t.side === "baseline" && t.trialKind === "unconstrained");
    out.push("### Conclusion on H4 (agent-facing contract), decision 0001 by the rule of decision 0108", "");
    const variants = [...new Set(rows.filter((t) => t.side === "mtek").map((t) => t.variant))].sort();
    for (const variant of variants) {
      for (const kind of kinds) {
        const mtekRows = rows.filter((t) => t.side === "mtek" && t.trialKind === kind && t.variant === variant);
        if (mtekRows.length === 0) continue;
        const name = `${kind}${variant}`;
        const comparison = compare(mtekRows, baselineRows);
        comparisons.push({ model, kind: name, scope: "all", comparison });
        out.push(...conclusion(`Mtek ${kind}${variant === "" ? "" : ` with the document${variant.includes("+", 1) ? "s" : ""} ${variant.slice(1).split("+").join(", ")} added`} against the baseline`, comparison), "");
        for (const category of [...new Set(mtekRows.map((t) => t.category))].sort()) {
          comparisons.push({ model, kind: name, scope: `category ${category}`, comparison: compare(mtekRows.filter((t) => t.category === category), baselineRows.filter((t) => t.category === category)) });
        }
        for (const mode of [...new Set(mtekRows.map((t) => t.mode))].sort()) {
          comparisons.push({ model, kind: name, scope: `mode ${mode}`, comparison: compare(mtekRows.filter((t) => t.mode === mode), baselineRows.filter((t) => t.mode === mode)) });
        }
      }
    }

    // ---- the cells
    out.push("### Aggregates per condition", "");
    const cells: [string, TrialRow[]][] = [];
    for (const side of ["mtek", "baseline"] as const) {
      for (const variant of side === "mtek" ? variants : [""]) {
        for (const kind of kinds) {
          const cell = rows.filter((t) => t.side === side && t.trialKind === kind && t.variant === variant);
          if (cell.length > 0) cells.push([sideLabel(side, `${kind}${variant}`), cell]);
        }
      }
    }
    out.push(table(CELL_HEADER, cells.map(([label, cell]) => cellRow(label, summarize(cell)))), "");
    out.push("Tokens are input plus output of every call of every attempt (cached reads and writes are input). \"Not judged\" counts not-run, error, unavailable and unfinished-by-budget attempts: they are in the token sums, not in the completion rate.", "");

    out.push("### Tokens, separately", "");
    out.push(
      table(
        ["cell", "input", "of which cache reads", "of which cache writes", "of which uncached", "output", "total", "attempts with unknown usage"],
        cells.map(([label, cell]) => {
          const c = summarize(cell);
          return [label, n0(c.inputTokens), n0(c.cachedInputTokens), n0(c.cacheWriteInputTokens), n0(c.uncachedInputTokens), n0(c.outputTokens), n0(c.totalTokens), String(c.unknownUsage)];
        }),
      ),
      "",
    );

    out.push("### First-attempt success (the first candidate that was validated)", "");
    out.push(
      table(
        ["cell", "candidates", "parse", "check", "start", "tests", "everything"],
        cells.map(([label, cell]) => {
          const f = summarize(cell).firstAttempt;
          const share = (k: number): string => (f.n === 0 ? "n/a" : `${String(k)} / ${String(f.n)} (${pct(k / f.n)})`);
          return [label, String(f.n), share(f.parse), share(f.check), share(f.start), share(f.tests), share(f.pass)];
        }),
      ),
      "",
    );

    out.push("### Where the input tokens went (by each part's share of the request's characters)", "");
    out.push(
      table(
        ["cell", ...SOURCES, "output (generated code)", "input in repair rounds", "output in repair rounds"],
        cells.map(([label, cell]) => {
          const totals = {} as Record<Source, number>;
          for (const source of SOURCES) totals[source] = sum(cell.map((t) => t.attribution.input[source]));
          const input = sum(SOURCES.map((s) => totals[s]));
          const share = (v: number): string => (input === 0 ? "0" : `${n0(v)} (${pct(v / input)})`);
          return [
            label,
            ...SOURCES.map((s) => share(totals[s])),
            n0(sum(cell.map((t) => t.attribution.outputTokens))),
            n0(sum(cell.map((t) => t.attribution.repairRoundInputTokens))),
            n0(sum(cell.map((t) => t.attribution.repairRoundOutputTokens))),
          ];
        }),
      ),
      "",
    );
    out.push("The provider counts tokens per request, not per part of a request: each request's input tokens are split by the share of its characters (system prompt, each message's sections, the model's earlier replies). \"documentation\" is the compiler context export on the Mtek side (its examples are inside it and are not counted apart) and the reference document on the baseline side. These are estimates of attribution, the totals are exact.", "");

    out.push("### Per category", "");
    const categories = [...new Set(rows.map((t) => t.category))].sort();
    const catRows: string[][] = [];
    for (const category of categories) {
      for (const [label, cell] of cells) catRows.push(cellRow(`${category}: ${label}`, summarize(cell.filter((t) => t.category === category))));
    }
    out.push(table(CELL_HEADER, catRows), "");
    out.push("### Per mode (cold authoring, edit)", "");
    const modeRows: string[][] = [];
    for (const mode of [...new Set(rows.map((t) => t.mode))].sort()) {
      for (const [label, cell] of cells) modeRows.push(cellRow(`${mode}: ${label}`, summarize(cell.filter((t) => t.mode === mode))));
    }
    out.push(table(CELL_HEADER, modeRows), "");

    out.push("### Per task", "");
    const taskIds = [...new Set(rows.map((t) => t.taskId))].sort();
    const taskTable: string[][] = [];
    for (const id of taskIds) {
      const row = [id, rows.find((t) => t.taskId === id)?.category ?? "", rows.find((t) => t.taskId === id)?.mode ?? ""];
      for (const [, cell] of cells) {
        const c = summarize(cell.filter((t) => t.taskId === id));
        row.push(c.n === 0 ? "-" : `${String(c.success)}/${String(c.n)} done, ${tok(c.tokensPerCompleted)} tok/done, ${usd(c.costUsd)}`);
      }
      taskTable.push(row);
    }
    out.push(table(["task", "category", "mode", ...cells.map(([label]) => label)], taskTable), "");
  }

  if (models.length === 0) out.push("No attempt outside the holdout set is in these records.", "");

  // ---- the documentation overhead
  const docs = new Map<string, number>();
  for (const t of main) if (t.documentationBytes !== null) docs.set(`${t.side}${t.variant}`, Math.max(docs.get(`${t.side}${t.variant}`) ?? 0, t.documentationBytes));
  if (docs.size > 0) out.push("## Documentation given to the model", "", table(["side", "largest documentation in bytes"], [...docs.entries()].sort().map(([side, bytes]) => [side, n0(bytes)])), "");

  // ---- accounting of everything that is not a judged attempt
  const unjudged = main.filter((t) => t.outcome !== "success" && t.outcome !== "failure");
  out.push("## Attempts that could not be judged", "");
  out.push(unjudged.length === 0 ? (mainSuperseded.length > 0 ? "None: every attempt that counts ended in success or failure (the not-judged attempts that a retry run replaced are listed below)." : "None: every attempt ended in success or failure.") : table(["attempt", "outcome", "reason"], unjudged.map((t) => [t.trialId, t.outcome, `${t.reason ?? ""}${t.message === null ? "" : `: ${t.message}`}`])), "");
  const transport = main.filter((t) => t.reason === "transport-error");
  if (transport.length > 0) {
    const per = new Map<string, number>();
    for (const t of transport) per.set(sideLabel(t.side, `${t.trialKind}${t.variant}`), (per.get(sideLabel(t.side, `${t.trialKind}${t.variant}`)) ?? 0) + 1);
    out.push(
      `${String(transport.length)} of the ${String(main.length)} attempts ended with the reason \`transport-error\`: the model could not be reached (a connection error or a timeout, no response at all). That is a failure of the network or the service, not of the model: these attempts are not judged, are out of every completion rate and of tokens per completed task, and are listed here. By condition: ${[...per.entries()].sort().map(([label, count]) => `${label} ${String(count)}`).join(", ")}.`,
      "",
    );
    const legacy = transport.filter((t) => t.legacyTransport === true).length;
    if (legacy > 0) out.push(legacyText(`${String(legacy)} of them are read`), "");
  }
  // ---- attempts that a retry run replaced (decision 0125)
  if (mainSuperseded.length > 0) {
    const per = new Map<string, number>();
    for (const t of mainSuperseded) per.set(sideLabel(t.side, `${t.trialKind}${t.variant}`), (per.get(sideLabel(t.side, `${t.trialKind}${t.variant}`)) ?? 0) + 1);
    const retryRuns = [...new Set(mainSuperseded.map((t) => t.supersededBy))].sort();
    out.push(
      `${String(mainSuperseded.length)} attempts that were not judged are superseded by the attempt of the same cell (task, condition, trial index) in the retry run${retryRuns.length === 1 ? "" : "s"} ${retryRuns.map((r) => `\`${String(r)}\``).join(", ")} (decision 0125): in every aggregate and in the verdict the retry attempt stands in the place of the lost one, which is listed below and in "All attempts" and is in no aggregate. By condition: ${[...per.entries()].sort().map(([label, count]) => `${label} ${String(count)}`).join(", ")}.`,
      "",
    );
    out.push(table(["attempt", "outcome", "reason", "superseded by"], mainSuperseded.map((t) => [`${String(t.runId)}: ${t.trialId}`, t.outcome, `${t.reason ?? ""}${t.message === null ? "" : `: ${t.message}`}`, String(t.supersededBy)])), "");
    const legacy = mainSuperseded.filter((t) => t.legacyTransport === true).length;
    if (legacy > 0) out.push(legacyText(`${String(legacy)} of the superseded attempts are read`), "");
  }

  // ---- the holdout
  out.push("## Holdout (reported apart, by ids and layer outcomes only)", "");
  if (holdout.length === 0) {
    out.push("No holdout attempt is in these records.", "");
  } else {
    out.push("The holdout set is never used for design (decision 0021). These attempts are not in any aggregate above; no prompt, message or candidate text of the holdout appears here.", "");
    out.push(
      table(
        ["attempt", "side", "outcome", "reason", "calls", "repairs", "tokens", "cost", "first attempt: parse/check/start/tests", "final verdict"],
        holdoutListing.map((t) => [
          attemptCell(t),
          t.side,
          t.outcome,
          reasonCell(t),
          String(t.calls),
          String(t.repairsUsed),
          t.totalTokens === null ? "unknown" : n0(t.totalTokens),
          usd(t.costUsd),
          t.firstAttempt === null ? "-" : LAYER_NAMES.filter((l) => l !== "build").map((l) => (t.firstAttempt as FirstAttempt).layers[l]).join("/"),
          t.final === null ? "-" : t.final.verdict,
        ]),
      ),
      "",
    );
    const hs = summarize(holdout);
    out.push(`Holdout: ${String(hs.n)} attempts, ${String(hs.success)} completed, ${String(hs.failure)} failed, ${String(hs.n - hs.valid)} not judged; ${n0(hs.totalTokens)} tokens, ${usd(hs.costUsd)}.`, "");
  }

  // ---- every attempt
  out.push("## All attempts", "");
  out.push(
    table(
      ["attempt", "task", "category", "mode", "side", "kind", "outcome", "reason", "calls", "repairs", "input", "cache read", "cache write", "output", "cost", "seconds", "first attempt parse/check/build/start/tests"],
      mainListing.map((t) => [
        attemptCell(t),
        t.taskId,
        t.category,
        t.mode,
        t.side,
        t.trialKind,
        t.outcome,
        reasonCell(t),
        String(t.calls),
        String(t.repairsUsed),
        t.inputTokens === null ? "unknown" : n0(t.inputTokens),
        t.cachedInputTokens === null ? "unknown" : n0(t.cachedInputTokens),
        t.cacheWriteInputTokens === null ? "-" : n0(t.cacheWriteInputTokens),
        t.outputTokens === null ? "unknown" : n0(t.outputTokens),
        usd(t.costUsd),
        n1(t.durationMs / 1000),
        t.firstAttempt === null ? "-" : LAYER_NAMES.map((l) => (t.firstAttempt as FirstAttempt).layers[l]).join("/"),
      ]),
    ),
    "",
  );

  out.push("## How the conclusion is reached", "");
  out.push(...RULE_TEXT, "");
  return { markdown: `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`, comparisons, trials, superseded, listing };
}

function legacyText(prefix: string): string {
  return `${prefix} by a legacy rule (decision 0124): the records were made before the harness retried and marked such attempts, and say outcome \`failure\`, reason \`generation-error\`. An attempt is read as \`error\` / \`transport-error\` when it is recorded that way, its reason is \`generation-error\` and EVERY model call of it is \`backend-error\` with the error text \`Connection error.\` or \`Request timed out.\`, no response text, no tokens and no HTTP status. An attempt with any other call, or with another error text, stays a failure. The records are not changed.`;
}

/** The attempt id; an attempt that is linked to a retry run also names its run, because the lost attempt and its retry have the same id. */
function attemptCell(t: TrialRow): string {
  return t.supersededBy !== undefined || t.retryOf !== undefined ? `${t.runId}: ${t.trialId}` : t.trialId;
}

/** The reason of an attempt, with the note that links it to a retry run when it has one (decision 0125). */
function reasonCell(t: TrialRow): string {
  const note = t.supersededBy !== undefined ? `superseded by retry run ${t.supersededBy}` : t.retryOf !== undefined ? `retry of the attempt in run ${t.retryOf}` : "";
  return note === "" ? (t.reason ?? "") : `${t.reason === null ? "" : `${t.reason}; `}${note}`;
}

export const RULE_TEXT: readonly string[] = [
  "The rule (decision 0108, applying decision 0001 and `spec/ai-and-benchmarks.md` section 6.4) compares the Mtek condition with the baseline over the tasks both have attempts at, on two axes:",
  "",
  "- success: completion rate = completed / attempts that ended by themselves (completed or failed); \"matched\" when the two differ by at most 10 points, \"higher\" or \"lower\" otherwise;",
  "- tokens per completed task = all tokens of all attempts (successes, failures, unfinished) / completed tasks; the ratio Mtek / baseline with a 95 % percentile interval from a bootstrap over tasks (4 000 resamples, fixed seed); \"fewer\" when the whole interval is below 1, \"more\" when above 1, \"same\" otherwise.",
  "",
  "better = success matched or higher and tokens fewer, or success higher and tokens the same; worse = success matched or lower and tokens more, or success lower and tokens the same; equivalent = success matched and tokens the same; inconclusive = nothing completes on either side, the axes oppose each other, or no task has attempts on both sides. If only one side completes anything it is better; the other is worse. No comparison is tuned to turn \"equivalent\" into a win.",
  "",
  "The research target (proposed, not a result): at matched success, at least 30 % fewer tokens per completed task than the baseline (ratio at most 0.70 and the verdict better). Missing it triggers the investigation of spec 6.4, not a cryptic syntax. A verdict is provisional when a task has fewer than 5 trials on a side, when more than 10 % of the attempts could not be judged, or when token counts are unknown.",
];

export function conclusion(label: string, c: Comparison): string[] {
  const lines: string[] = [];
  lines.push(`**${label}: ${c.verdict.toUpperCase()}${c.provisional ? " (provisional)" : ""}.** ${c.reason}.`, "");
  lines.push(
    table(
      ["", "attempts", "completed", "completion rate", "tokens per completed task", "cost per completed task"],
      [
        ["Mtek", String(c.mtek.n), String(c.mtek.success), pct(c.mtek.completionRate), tok(c.mtek.tokensPerCompleted), usd(c.mtek.costPerCompleted)],
        ["baseline", String(c.baseline.n), String(c.baseline.success), pct(c.baseline.completionRate), tok(c.baseline.tokensPerCompleted), usd(c.baseline.costPerCompleted)],
      ],
    ),
    "",
  );
  const iv = c.interval;
  lines.push(
    `Over ${String(c.tasks.length)} task(s): token ratio Mtek / baseline ${iv.point === null ? "undefined" : iv.point.toFixed(3)}` +
      (iv.low === null || iv.high === null ? " (no interval)" : `, 95 % interval [${iv.low.toFixed(3)}, ${iv.high.toFixed(3)}]`) +
      `; completion difference ${c.completionDifference === null ? "undefined" : `${n1(c.completionDifference * 100)} points`} (success ${c.successAxis}, tokens ${c.tokensAxis}). Research target of 30 % fewer tokens: ${c.targetMet ? "met" : "not met"}.`,
  );
  if (c.provisional) lines.push("", `Provisional because: ${c.provisionalReasons.join("; ")}.`);
  if (c.unmatchedTasks.length > 0) lines.push("", `Tasks with attempts on one side only (left out of the comparison): ${c.unmatchedTasks.join(", ")}.`);
  return lines;
}

/**
 * The holdout attempts reduced to ids and layer outcomes: the only form of a holdout result that may enter the repository. Pass the
 * `listing` of `extractTrials` to keep the attempts that a retry run replaced (they carry `supersededBy`; the retry attempts carry
 * `retryOf`). The summary of M7-05 (`holdout-summary.jsonl`) was written before `runId`, `variant`, `trial` and the two links existed.
 */
export function holdoutSummary(trials: readonly TrialRow[]): Record<string, unknown>[] {
  return trials
    .filter((t) => t.holdout)
    .map((t) => ({
      runId: t.runId,
      trialId: t.trialId,
      taskId: t.taskId,
      side: t.side,
      variant: t.variant,
      trialKind: t.trialKind,
      trial: t.trial,
      ...(t.supersededBy === undefined ? {} : { supersededBy: t.supersededBy }),
      ...(t.retryOf === undefined ? {} : { retryOf: t.retryOf }),
      outcome: t.outcome,
      reason: t.reason,
      calls: t.calls,
      repairsUsed: t.repairsUsed,
      inputTokens: t.inputTokens,
      outputTokens: t.outputTokens,
      cachedInputTokens: t.cachedInputTokens,
      costUsd: t.costUsd,
      firstAttemptLayers: t.firstAttempt?.layers ?? null,
      finalVerdict: t.final?.verdict ?? null,
    }));
}

export { quantile };
