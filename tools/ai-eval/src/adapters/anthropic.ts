// The `anthropic` adapter: the Messages API through the official `@anthropic-ai/sdk` (an optional
// dependency of this workspace). Optional and isolated: nothing but `registry.ts` imports this file,
// and the registry loads it only when `--client anthropic` is asked for.
//
// The API key is read from the environment variable named by `apiKeyEnv` (default
// `ANTHROPIC_API_KEY`) when the client is created and is never recorded. `fetch` is injected, so the
// unit tests run the real SDK against a fake transport and never reach a network.
//
// Honest limits, all visible in the recorded condition:
//   - No default model: the model id is part of the condition and the operator chooses it.
//   - `seed` is not an Anthropic parameter (`capabilities.seed` is false; a run that asks for one is refused).
//   - `temperature: null` sends no sampling parameter. Several current models reject sampling
//     parameters; for those, run with `temperature: null` (the CLI's `--temperature default`).
//   - Token usage: `inputTokens` is the whole input (`input_tokens` + cache writes + cache reads),
//     `cachedInputTokens` the part read from the cache, so uncached input is the difference.
import { AsyncLocalStorage } from "node:async_hooks";
import Anthropic from "@anthropic-ai/sdk";
import { requireOption, type AdapterDeps, type AdapterOptions } from "../adapter-options.ts";
import type { FetchLike, FinishReason, GenerateOptions, GenerateRequest, GenerateResult, ModelClient, TransportFailure, Usage } from "../model-client.ts";

export const NAME = "anthropic";
const MAX_ERROR_LENGTH = 500;

function failure(error: string, finish: FinishReason = "error", httpStatus?: number, transport?: TransportFailure): GenerateResult {
  return {
    text: "",
    usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
    finish,
    error,
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(transport === undefined ? {} : { transport }),
  };
}

/** Error codes of a connection that failed after the request may have been sent: the call may have been processed (and billed). */
const AFTER_SEND_CODES: ReadonlySet<string> = new Set(["ECONNRESET", "EPIPE", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);
/** Error codes of a connection that failed before anything was sent. */
const NOT_SENT_CODES: ReadonlySet<string> = new Set(["UND_ERR_CONNECT_TIMEOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "ETIMEDOUT"]);

/** An error, its `cause` chain and the members of an AggregateError (bounded; a cycle cannot loop). */
function causeChain(root: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const queue: unknown[] = [root];
  while (queue.length > 0 && out.length < 12) {
    const item = queue.shift();
    if (typeof item !== "object" || item === null || out.includes(item as Record<string, unknown>)) continue;
    const record = item as Record<string, unknown>;
    out.push(record);
    queue.push(record["cause"]);
    if (Array.isArray(record["errors"])) queue.push(...(record["errors"] as unknown[]));
  }
  return out;
}

/**
 * Which kind of transport failure an SDK error is, or undefined when the call did get a response (decision 0124). The SDK
 * words both a refused connection and a connect timeout as "Connection error." / "Request timed out." and drops the cause of
 * the latter, so the cause is taken from the fetch that failed (`fetchError`). `connection`: nothing was sent (refused, DNS, no
 * route, connect timeout, or a failure with no known code); `timeout`: the request was or may have been sent and no answer
 * came (a reset, a socket error, a header or body timeout, the SDK's own timeout).
 */
export function transportOf(error: unknown, fetchError: unknown): TransportFailure | undefined {
  if (!(error instanceof Anthropic.APIConnectionError)) return undefined;
  const chain = [...causeChain(error), ...causeChain(fetchError)];
  const codes = chain.flatMap((e) => (typeof e["code"] === "string" ? [e["code"]] : []));
  const names = chain.map((e) => (typeof e["name"] === "string" ? e["name"] : ""));
  if (codes.some((code) => AFTER_SEND_CODES.has(code))) return "timeout";
  if (codes.some((code) => NOT_SENT_CODES.has(code)) || names.includes("ConnectTimeoutError")) return "connection";
  return error instanceof Anthropic.APIConnectionTimeoutError ? "timeout" : "connection";
}

/** Error text for a record: no API key (by shape or by value) can ever be part of it. */
export function scrubSecrets(text: string, apiKey: string): string {
  let out = apiKey === "" ? text : text.split(apiKey).join("<redacted>");
  out = out.replace(/sk-ant-[A-Za-z0-9_-]+/g, "<redacted>");
  return out;
}

/** Maps a Messages API response onto the harness's result. Anything unexpected is an `error`, never a quiet success. */
export function toResult(message: Anthropic.Message): GenerateResult {
  const text = message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  const raw = message.usage;
  const cacheRead = raw.cache_read_input_tokens;
  const cacheWrite = raw.cache_creation_input_tokens;
  const usage: Usage = {
    inputTokens: raw.input_tokens + (cacheRead ?? 0) + (cacheWrite ?? 0),
    outputTokens: raw.output_tokens,
    cachedInputTokens: cacheRead ?? 0,
    // Only when the provider says: the write count is what makes a cached call dearer than a plain one.
    ...(typeof cacheWrite === "number" ? { cacheWriteInputTokens: cacheWrite } : {}),
  };
  const reason = message.stop_reason;
  let finish: FinishReason;
  let error: string | undefined;
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      finish = "stop";
      break;
    case "max_tokens":
    case "model_context_window_exceeded":
      finish = "length";
      break;
    case "refusal": {
      finish = "refusal";
      const category = message.stop_details?.category ?? null;
      error = category === null ? "the model refused" : `the model refused (category: ${category})`;
      break;
    }
    default:
      finish = "error";
      error = `unexpected stop_reason ${JSON.stringify(reason)}`;
  }
  const result: GenerateResult = { text, usage, finish };
  if (error !== undefined) result.error = error;
  return result;
}

export function createClient(options: AdapterOptions, deps: AdapterDeps): ModelClient {
  const model = requireOption(options.model, "--model", NAME);
  const env = deps.env ?? process.env;
  const keyName = options.apiKeyEnv ?? "ANTHROPIC_API_KEY";
  const apiKey = env[keyName];
  if (apiKey === undefined || apiKey === "") throw new Error(`adapter '${NAME}': the environment variable ${keyName} is not set`);
  // The fetch that failed is remembered per call, so a transport error can be told apart by the cause the SDK drops (see `transportOf`).
  const calls = new AsyncLocalStorage<{ fetchError?: unknown }>();
  const baseFetch: FetchLike = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const watchedFetch: FetchLike = async (input, init) => {
    try {
      return await baseFetch(input, init);
    } catch (error) {
      const store = calls.getStore();
      if (store !== undefined) store.fetchError = error;
      throw error;
    }
  };
  const client = new Anthropic({
    apiKey,
    // A retry is a different call with a different bill, so none is made inside the SDK: the repair loop retries a call that got
    // no response at all and records each try (decision 0124); every other failure is recorded and not retried (decision 0077 item 13).
    maxRetries: 0,
    ...(options.baseUrl === undefined ? {} : { baseURL: options.baseUrl }),
    fetch: watchedFetch,
  });
  return {
    provider: NAME,
    model,
    promptCaching: options.promptCaching === true,
    capabilities: { grammar: false, seed: false },
    async generate(request: GenerateRequest, generateOptions: GenerateOptions = {}): Promise<GenerateResult> {
      if (request.grammar !== undefined) return failure("this adapter does not forward grammars; refusing to run unconstrained");
      if (request.seed !== undefined) return failure("this adapter does not forward seeds; refusing to run with an unapplied seed");
      const last = request.messages.length - 1;
      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model,
        max_tokens: request.maxOutputTokens,
        system: request.system,
        // With prompt caching the newest message carries the cache breakpoint, so each call reads the whole earlier
        // conversation from the cache and writes only what is new (the provider ignores it below its minimum prefix).
        messages: request.messages.map((message, index) => ({
          role: message.role,
          content:
            options.promptCaching === true && index === last
              ? [{ type: "text" as const, text: message.content, cache_control: { type: "ephemeral" as const } }]
              : message.content,
        })),
        ...(request.temperature === null ? {} : { temperature: request.temperature }),
        ...(request.stop === undefined || request.stop.length === 0 ? {} : { stop_sequences: [...request.stop] }),
      };
      const store: { fetchError?: unknown } = {};
      try {
        const message = await calls.run(store, () =>
          client.messages.create(params, generateOptions.signal === undefined ? {} : { signal: generateOptions.signal }),
        );
        return toResult(message);
      } catch (error) {
        if (generateOptions.signal?.aborted === true) return failure("the request was aborted", "cancelled");
        const text = scrubSecrets(error instanceof Error ? error.message : String(error), apiKey);
        const status = error instanceof Anthropic.APIError && typeof error.status === "number" ? error.status : undefined;
        return failure(text.slice(0, MAX_ERROR_LENGTH), "error", status, status === undefined ? transportOf(error, store.fetchError) : undefined);
      }
    },
  };
}
