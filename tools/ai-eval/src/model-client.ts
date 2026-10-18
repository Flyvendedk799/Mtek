// The provider-independent model interface (spec/ai-and-benchmarks.md section 4.1, decision 0077).
//
// This file and everything it imports knows no provider. Adapters live in `adapters/`; only
// `adapters/registry.ts` loads them, lazily and by name, and no language package imports any of them
// (`check-boundary.ts` fails if one does).

import { canonicalJson, sha256Hex } from "./canonical.ts";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** What `generate` is given. Every field is part of the recorded condition (spec 4.2). */
export interface GenerateRequest {
  system: string;
  messages: readonly ChatMessage[];
  /** The most tokens one reply may have; hitting it is `finish: "length"`, a failure state. */
  maxOutputTokens: number;
  /**
   * The sampling temperature, or `null` for "the provider's default, sent as nothing". `null` is a
   * recorded condition of its own: some current models reject sampling parameters outright, and a
   * temperature that was recorded but not applied would be a false record.
   */
  temperature: number | null;
  stop?: readonly string[];
  seed?: number;
  /** A GBNF grammar for constrained decoding. Only sent in a `constrained` trial (see `grammar.ts`). */
  grammar?: string;
}

/** Why generation ended. `length` is never repaired silently: the trial fails (spec 1). */
export type FinishReason = "stop" | "length" | "refusal" | "cancelled" | "error";

/**
 * Token counts as the provider reported them. `null` means the provider did not report the number:
 * it is unknown, never zero (a zero would corrupt "tokens per completed task", spec 6.4).
 */
export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens?: number | null;
}

export interface GenerateResult {
  text: string;
  usage: Usage;
  finish: FinishReason;
  /** A message for `finish: "error"` (transport or server failure) and `"refusal"` when there is one. */
  error?: string;
}

export interface GenerateOptions {
  /** Aborted when the wall-clock budget runs out; the client then returns `finish: "cancelled"`. */
  signal?: AbortSignal;
}

export interface ClientCapabilities {
  /** True when `generate` forwards `request.grammar`. A client without it never receives a grammar. */
  grammar: boolean;
  /** True when `generate` forwards `request.seed`. A run that asks for a seed the client cannot apply is refused. */
  seed: boolean;
}

/** The `fetch` of the platform; adapters take it as an injected dependency so tests never touch a network. */
export type FetchLike = typeof globalThis.fetch;

export interface ModelClient {
  /** The provider name recorded with every run (`replay`, `anthropic`, ...). */
  readonly provider: string;
  /** The model id exactly as sent; changing it creates a new condition (spec 4.2). */
  readonly model: string;
  readonly capabilities: ClientCapabilities;
  generate(request: GenerateRequest, options?: GenerateOptions): Promise<GenerateResult>;
}

/**
 * The hash of everything that is sent to the model: system prompt, messages, token cap, temperature,
 * stop sequences, seed and the grammar (by its own hash). Two requests with the same hash are the
 * same prompt under the same condition.
 */
export function requestHash(request: GenerateRequest): string {
  return sha256Hex(
    canonicalJson({
      system: request.system,
      messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
      maxOutputTokens: request.maxOutputTokens,
      temperature: request.temperature,
      stop: request.stop === undefined ? null : [...request.stop],
      seed: request.seed ?? null,
      grammarSha256: request.grammar === undefined ? null : sha256Hex(request.grammar),
    }),
  );
}

/** The usage of zero calls: the identity of `addUsage`. */
export const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };

/**
 * Adds token counts. A sum with an unknown term (null, or a cached count the provider never
 * reports) is unknown (null), never a partial sum.
 */
export function addUsage(a: Usage, b: Usage): Usage {
  const sum = (x: number | null | undefined, y: number | null | undefined): number | null =>
    x === null || x === undefined || y === null || y === undefined ? null : x + y;
  return {
    inputTokens: sum(a.inputTokens, b.inputTokens),
    outputTokens: sum(a.outputTokens, b.outputTokens),
    cachedInputTokens: sum(a.cachedInputTokens, b.cachedInputTokens),
  };
}
