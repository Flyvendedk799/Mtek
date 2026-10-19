// The `replay` adapter: deterministic recorded transcripts. It is the only adapter that the harness's
// own unit tests and CI use, and it needs no network, no key and no provider library.
//
// A transcript is JSONL. Each line is either
//   - a plain entry   {"text": "...", "finish": "stop", "usage": {...}, "promptHash": "..."}  or
//   - a `model-call` record written by the Recorder (a recorded run is itself a transcript).
// Entries are served in order, one per `generate` call. When an entry carries a `promptHash`, the
// request must hash to it, so a transcript recorded for one prompt cannot silently answer another.
import { readFileSync } from "node:fs";
import {
  requestHash,
  type ClientCapabilities,
  type FinishReason,
  type GenerateRequest,
  type GenerateResult,
  type ModelClient,
  type TransportFailure,
  type Usage,
} from "../model-client.ts";

export interface ReplayEntry {
  text: string;
  finish: FinishReason;
  usage: Usage;
  error?: string;
  /** A call that got no response at all (decision 0124); the harness retries it. A recorded call's `errorKind` of `connection` or `timeout` is read as this. */
  transport?: TransportFailure;
  /** A call the service answered with an error status. */
  httpStatus?: number;
  /** When present the request must hash to it (`requestHash`). */
  promptHash?: string;
}

const FINISH_REASONS: readonly string[] = ["stop", "length", "refusal", "cancelled", "error"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseUsage(value: unknown): Usage {
  if (!isRecord(value)) return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  const count = (key: string): number | null => {
    const item = value[key];
    return typeof item === "number" && Number.isInteger(item) && item >= 0 ? item : null;
  };
  const cached = value["cachedInputTokens"];
  return {
    inputTokens: count("inputTokens"),
    outputTokens: count("outputTokens"),
    cachedInputTokens: cached === undefined ? 0 : count("cachedInputTokens"),
  };
}

/**
 * Reads the entries of a transcript. A `model-call` record that never reached the model
 * (`generation: "budget-exceeded"`) has no response and is skipped; a plain entry or a recorded call
 * with an unusable shape is an error that names the line.
 */
export function parseTranscript(jsonl: string): ReplayEntry[] {
  const entries: ReplayEntry[] = [];
  for (const [index, raw] of jsonl.split("\n").entries()) {
    const line = raw.trim();
    if (line === "") continue;
    const where = `transcript line ${String(index + 1)}`;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`${where}: not JSON`);
    }
    if (!isRecord(value)) throw new Error(`${where}: not a JSON object`);
    const recorded = value["type"] === "model-call";
    if (value["type"] !== undefined && !recorded) continue; // another record type of a recorded run
    if (recorded && value["generation"] === "budget-exceeded") continue;
    const response = recorded ? value["response"] : value;
    const text = isRecord(response) ? response["text"] : undefined;
    const finish = value["finish"];
    if (typeof text !== "string") throw new Error(`${where}: no response text`);
    if (typeof finish !== "string" || !FINISH_REASONS.includes(finish)) {
      throw new Error(`${where}: 'finish' must be one of ${FINISH_REASONS.join(", ")}`);
    }
    const entry: ReplayEntry = { text, finish: finish as FinishReason, usage: parseUsage(value["usage"]) };
    if (typeof value["error"] === "string") entry.error = value["error"];
    const kind = recorded ? value["errorKind"] : value["transport"];
    if (kind === "connection" || kind === "timeout") entry.transport = kind;
    if (typeof value["httpStatus"] === "number") entry.httpStatus = value["httpStatus"];
    if (typeof value["promptHash"] === "string") entry.promptHash = value["promptHash"];
    entries.push(entry);
  }
  return entries;
}

export function loadTranscript(path: string): ReplayEntry[] {
  return parseTranscript(readFileSync(path, "utf8"));
}

export interface ReplayOptions {
  /** The model id recorded for the run; default `replay`. */
  model?: string;
  /** Whether `generate` forwards a grammar (to test the constrained path); default false. */
  acceptGrammar?: boolean;
}

export interface ReplayClient extends ModelClient {
  /** Every request received so far, in order. */
  readonly requests: readonly GenerateRequest[];
  /** Entries not yet served. A finished run with entries left over replayed a different run. */
  remaining(): number;
}

export function createReplayClient(entries: readonly ReplayEntry[], options: ReplayOptions = {}): ReplayClient {
  const requests: GenerateRequest[] = [];
  let next = 0;
  const capabilities: ClientCapabilities = { grammar: options.acceptGrammar === true, seed: true };
  const failure = (error: string): GenerateResult => ({
    text: "",
    usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
    finish: "error",
    error,
  });
  return {
    provider: "replay",
    model: options.model ?? "replay",
    capabilities,
    requests,
    remaining: () => entries.length - next,
    generate(request: GenerateRequest): Promise<GenerateResult> {
      requests.push(request);
      const callNumber = next + 1;
      const entry = entries[next];
      if (entry === undefined) {
        return Promise.resolve(failure(`replay transcript exhausted: call ${String(callNumber)} has no recorded response`));
      }
      next += 1;
      if (entry.promptHash !== undefined && entry.promptHash !== requestHash(request)) {
        return Promise.resolve(
          failure(`replay mismatch at call ${String(callNumber)}: the prompt does not hash to the recorded promptHash`),
        );
      }
      const result: GenerateResult = { text: entry.text, usage: entry.usage, finish: entry.finish };
      if (entry.error !== undefined) result.error = entry.error;
      if (entry.transport !== undefined) result.transport = entry.transport;
      if (entry.httpStatus !== undefined) result.httpStatus = entry.httpStatus;
      return Promise.resolve(result);
    },
  };
}
