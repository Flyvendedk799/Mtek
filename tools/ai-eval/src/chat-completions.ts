// The OpenAI-style `POST {baseUrl}/chat/completions` wire protocol, shared by the `openai-compatible`
// and `llama-cpp` adapters (neither imports the other). It is not an adapter: it knows no provider,
// only the request and response shape, and it receives `fetch` from its caller.
import type {
  ClientCapabilities,
  FetchLike,
  FinishReason,
  GenerateOptions,
  GenerateRequest,
  GenerateResult,
  ModelClient,
  TransportFailure,
  Usage,
} from "./model-client.ts";

export interface ChatCompletionsConfig {
  provider: string;
  model: string;
  /** The URL that `/chat/completions` is appended to, e.g. `http://127.0.0.1:8080/v1`. */
  baseUrl: string;
  /** Sent as `Authorization: Bearer`; absent for local servers. Never recorded, never logged. */
  apiKey?: string | undefined;
  fetch: FetchLike;
  capabilities: ClientCapabilities;
  /** Whether `request.grammar` is sent, as the `grammar` member of the body (llama.cpp's extension). */
  sendGrammar: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

const MAX_ERROR_BODY = 500;

export function failureResult(error: string, finish: FinishReason = "error", extra: { httpStatus?: number; transport?: TransportFailure } = {}): GenerateResult {
  return { text: "", usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, finish, error, ...extra };
}

/** Parses a successful response body; anything that is not a complete completion is an `error` result. */
export function parseChatCompletion(body: string): GenerateResult {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return failureResult("the response body is not JSON");
  }
  if (!isRecord(value)) return failureResult("the response body is not a JSON object");
  const choices = value["choices"];
  const choice: unknown = Array.isArray(choices) ? (choices as unknown[])[0] : undefined;
  if (!isRecord(choice)) return failureResult("the response has no choices");
  const message = choice["message"];
  const text = isRecord(message) && typeof message["content"] === "string" ? message["content"] : "";
  const refusal = isRecord(message) && typeof message["refusal"] === "string" && message["refusal"] !== "" ? message["refusal"] : null;

  const usageValue = value["usage"];
  const usage: Usage = { inputTokens: null, outputTokens: null, cachedInputTokens: null };
  if (isRecord(usageValue)) {
    usage.inputTokens = count(usageValue["prompt_tokens"]);
    usage.outputTokens = count(usageValue["completion_tokens"]);
    const details = usageValue["prompt_tokens_details"];
    usage.cachedInputTokens = isRecord(details) ? count(details["cached_tokens"]) : null;
  }

  const reason = choice["finish_reason"];
  let finish: FinishReason;
  let error: string | undefined;
  if (refusal !== null) {
    finish = "refusal";
    error = refusal;
  } else if (reason === "stop") finish = "stop";
  else if (reason === "length") finish = "length";
  else if (reason === "content_filter") {
    finish = "refusal";
    error = "the server's content filter stopped the generation";
  } else {
    finish = "error";
    error = `unexpected finish_reason ${JSON.stringify(reason)}`;
  }
  const result: GenerateResult = { text, usage, finish };
  if (error !== undefined) result.error = error;
  return result;
}

export function createChatCompletionsClient(config: ChatCompletionsConfig): ModelClient {
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return {
    provider: config.provider,
    model: config.model,
    capabilities: config.capabilities,
    async generate(request: GenerateRequest, options: GenerateOptions = {}): Promise<GenerateResult> {
      if (request.grammar !== undefined && !config.sendGrammar) {
        return failureResult("this adapter does not forward grammars; refusing to run unconstrained");
      }
      if (request.seed !== undefined && !config.capabilities.seed) {
        return failureResult("this adapter does not forward seeds; refusing to run with an unapplied seed");
      }
      const body: Record<string, unknown> = {
        model: config.model,
        messages: [{ role: "system", content: request.system }, ...request.messages.map((m) => ({ role: m.role, content: m.content }))],
        max_tokens: request.maxOutputTokens,
        stream: false,
      };
      if (request.temperature !== null) body["temperature"] = request.temperature;
      if (request.stop !== undefined && request.stop.length > 0) body["stop"] = [...request.stop];
      if (request.seed !== undefined) body["seed"] = request.seed;
      if (request.grammar !== undefined) body["grammar"] = request.grammar;
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (config.apiKey !== undefined && config.apiKey !== "") headers["authorization"] = `Bearer ${config.apiKey}`;
      try {
        const init: RequestInit = { method: "POST", headers, body: JSON.stringify(body) };
        if (options.signal !== undefined) init.signal = options.signal;
        const response = await config.fetch(url, init);
        const text = await response.text();
        if (!response.ok) {
          return failureResult(`HTTP ${String(response.status)}: ${text.slice(0, MAX_ERROR_BODY)}`, "error", { httpStatus: response.status });
        }
        return parseChatCompletion(text);
      } catch (error) {
        if (options.signal?.aborted === true) return failureResult("the request was aborted", "cancelled");
        // A rejected fetch is a call that got no response (decision 0124): a timeout is told apart from a refused or unreachable server.
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        return failureResult(error instanceof Error ? error.message : String(error), "error", { transport: timedOut ? "timeout" : "connection" });
      }
    },
  };
}
