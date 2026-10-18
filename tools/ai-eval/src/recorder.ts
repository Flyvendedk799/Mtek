// The Recorder (spec/ai-and-benchmarks.md section 4.1): JSONL, one record per line, written to
// `benchmarks/results/<run-id>/records.jsonl`. The schema is `spec/ai-eval-record.schema.json`
// (schema version 1; a test validates every kind of record the loop writes against it).
//
// Deterministic: every record is canonical JSON (keys sorted, no whitespace), records carry a
// sequence number instead of relying on file order, nothing machine-specific is written (no absolute
// path, no host name), and the only clock readings are the `startedAt`/`durationMs` fields, which come
// from the injected `Clock`: with a fixed clock, equal runs produce equal bytes.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson, type Json } from "./canonical.ts";
import type { BudgetStop } from "./budget.ts";
import type { AppliedEdit, EditFormat, EditRejection } from "./editor.ts";
import type { TrialKind } from "./grammar.ts";
import type { FinishReason, Usage } from "./model-client.ts";
import type { GenerationOutcome, Layers, TrialOutcome, TrialReason, Verdict } from "./outcomes.ts";
import type { CommandLog, SymbolCheck, TestReportSummary } from "./validator.ts";
import type { Diagnostic } from "./diagnostics.ts";

export const RECORD_SCHEMA_VERSION = 1;
export const RECORDS_FILE = "records.jsonl";

/** Everything that identifies a condition (spec 4.2): changing any of it is a new condition. */
export interface Condition {
  provider: string;
  model: string;
  temperature: number | null;
  maxOutputTokens: number;
  stop: string[] | null;
  seed: number | null;
  promptVersion: string;
  testFeedback: string;
  contextMaxBytes: number;
  maxRepairs: number;
  maxWallSeconds: number;
  maxTotalTokens: number | null;
  trialKind: TrialKind;
  replyFormat: "edit-blocks" | "module";
}

export interface RunStartRecord {
  type: "run-start";
  harnessVersion: string;
  startedAt: string;
}

export interface TrialStartRecord {
  type: "trial-start";
  trialId: string;
  taskId: string;
  category: string;
  mode: "cold" | "edit";
  trialKind: TrialKind;
  /** The index of this trial among the repetitions of its condition (spec 6.4: at least 5 per task per condition). */
  trial: number;
  condition: Condition;
  conditionId: string;
  /** Constrained trials: the backend label of the capability check; null otherwise. */
  grammar: { backend: string; replyFormat: "edit-blocks" | "module" } | null;
  compilerVersion: string | null;
  contextSha256: string | null;
  contextBytes: number | null;
  contextTruncated: Record<string, unknown> | null;
  startedAt: string;
}

export interface ModelCallRecord {
  type: "model-call";
  trialId: string;
  /** 0 is the first generation; n is the n-th repair. */
  round: number;
  /** Null when no request was made (`budget-exceeded`). */
  promptHash: string | null;
  request: {
    system: string;
    messages: { role: "user" | "assistant"; content: string }[];
    maxOutputTokens: number;
    temperature: number | null;
    stop: string[] | null;
    seed: number | null;
    grammarSha256: string | null;
  } | null;
  /** Characters per prompt section of the newest user message (instructions, context, project, diagnostics, ...). */
  promptSections: Record<string, number> | null;
  response: { text: string } | null;
  usage: Usage | null;
  finish: FinishReason | null;
  generation: GenerationOutcome;
  error: string | null;
  budget: BudgetStop | null;
  startedAt: string;
  durationMs: number;
}

export interface EditRecord {
  type: "edit";
  trialId: string;
  round: number;
  format: EditFormat;
  outcome: "applied" | "rejected";
  applied: AppliedEdit[];
  rejected: EditRejection[];
  /** The hash of the candidate's sources after this reply (unchanged when the reply was rejected). */
  projectHash: string;
}

export interface ValidationRecord {
  type: "validation";
  trialId: string;
  round: number;
  projectHash: string;
  verdict: Verdict;
  layers: Layers;
  requiredSymbols: SymbolCheck;
  diagnostics: Diagnostic[];
  testReport: TestReportSummary | null;
  compilerVersion: string | null;
  toolError: string | null;
  commands: CommandLog[];
  startedAt: string;
  durationMs: number;
}

export interface TrialEndRecord {
  type: "trial-end";
  trialId: string;
  outcome: TrialOutcome;
  reason: TrialReason | null;
  message: string | null;
  /** Model calls made (the first generation plus repairs, whatever their outcome). */
  calls: number;
  /** Repair rounds used (calls after the first). */
  repairsUsed: number;
  /** The verdict and layers of the first candidate that was validated; null when there was none. First-attempt success is a metric of its own (spec 6.4). */
  firstAttempt: { verdict: Verdict; layers: Layers; requiredSymbols: SymbolCheck } | null;
  /** The last validation. */
  final: { verdict: Verdict; layers: Layers; requiredSymbols: SymbolCheck } | null;
  totals: { inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null };
  durationMs: number;
  /** Where the final candidate was preserved, relative to the run directory; null when there was none. */
  finalProject: string | null;
}

export type RecordBody = RunStartRecord | TrialStartRecord | ModelCallRecord | EditRecord | ValidationRecord | TrialEndRecord;
export type RecordType = RecordBody["type"];

export interface Recorder {
  record(body: RecordBody): void;
}

/** Serialises a record with its envelope; the single place that decides what a line looks like. */
export function recordLine(runId: string, seq: number, body: RecordBody): string {
  const record = { schemaVersion: RECORD_SCHEMA_VERSION, runId, seq, ...body };
  return canonicalJson(record as unknown as Json);
}

/** Writes `records.jsonl` in a run directory. */
export class JsonlRecorder implements Recorder {
  readonly runId: string;
  readonly dir: string;
  private seq = 0;

  /** `dir` is the run directory (`benchmarks/results/<run-id>`); it is created and `records.jsonl` is started empty. */
  constructor(dir: string, runId: string) {
    this.dir = dir;
    this.runId = runId;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, RECORDS_FILE), "", { flag: "wx" });
  }

  record(body: RecordBody): void {
    appendFileSync(join(this.dir, RECORDS_FILE), `${recordLine(this.runId, this.seq, body)}\n`, "utf8");
    this.seq += 1;
  }
}

/** Keeps the lines in memory (tests). */
export class MemoryRecorder implements Recorder {
  readonly runId: string;
  readonly lines: string[] = [];

  constructor(runId = "test-run") {
    this.runId = runId;
  }

  record(body: RecordBody): void {
    this.lines.push(recordLine(this.runId, this.lines.length, body));
  }

  /** The records as parsed objects. */
  get records(): Record<string, unknown>[] {
    return this.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  get text(): string {
    return this.lines.map((line) => `${line}\n`).join("");
  }
}
