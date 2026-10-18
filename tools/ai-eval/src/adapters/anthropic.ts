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
import Anthropic from "@anthropic-ai/sdk";
import { requireOption, type AdapterDeps, type AdapterOptions } from "../adapter-options.ts";
import type { FinishReason, GenerateOptions, GenerateRequest, GenerateResult, ModelClient, Usage } from "../model-client.ts";

export const NAME = "anthropic";
const MAX_ERROR_LENGTH = 500;

function failure(error: string, finish: FinishReason = "error"): GenerateResult {
  return { text: "", usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, finish, error };
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
  const client = new Anthropic({
    apiKey,
    ...(options.baseUrl === undefined ? {} : { baseURL: options.baseUrl }),
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
  });
  return {
    provider: NAME,
    model,
    capabilities: { grammar: false, seed: false },
    async generate(request: GenerateRequest, generateOptions: GenerateOptions = {}): Promise<GenerateResult> {
      if (request.grammar !== undefined) return failure("this adapter does not forward grammars; refusing to run unconstrained");
      if (request.seed !== undefined) return failure("this adapter does not forward seeds; refusing to run with an unapplied seed");
      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model,
        max_tokens: request.maxOutputTokens,
        system: request.system,
        messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
        ...(request.temperature === null ? {} : { temperature: request.temperature }),
        ...(request.stop === undefined || request.stop.length === 0 ? {} : { stop_sequences: [...request.stop] }),
      };
      try {
        const message = await client.messages.create(
          params,
          generateOptions.signal === undefined ? {} : { signal: generateOptions.signal },
        );
        return toResult(message);
      } catch (error) {
        if (generateOptions.signal?.aborted === true) return failure("the request was aborted", "cancelled");
        const text = error instanceof Error ? error.message : String(error);
        return failure(text.slice(0, MAX_ERROR_LENGTH));
      }
    },
  };
}
