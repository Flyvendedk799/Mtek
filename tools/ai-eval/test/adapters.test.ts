import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createClient as createAnthropic, toResult } from "../src/adapters/anthropic.ts";
import { createClient as createLlama, DEFAULT_BASE_URL } from "../src/adapters/llama-cpp.ts";
import { createClient as createOpenAi } from "../src/adapters/openai-compatible.ts";
import { ADAPTER_NAMES, createClient, loadAdapter } from "../src/adapters/registry.ts";
import { createReplayClient, loadTranscript, parseTranscript } from "../src/adapters/replay.ts";
import type { FetchLike, GenerateRequest } from "../src/model-client.ts";
import { requestHash } from "../src/model-client.ts";
import { tempDir } from "./helpers.ts";

const REQUEST: GenerateRequest = {
  system: "be brief",
  messages: [{ role: "user", content: "hello" }],
  maxOutputTokens: 100,
  temperature: 0.5,
};

interface Seen {
  url: string;
  method: string | undefined;
  headers: Headers;
  body: Record<string, unknown>;
}

/** A transport that records what it was sent and answers from a script. No network is involved. */
function fakeFetch(answer: (seen: Seen) => { status?: number; body: unknown } | Error): { fetch: FetchLike; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetch: FetchLike = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const entry: Seen = {
      url,
      method: init?.method,
      headers: new Headers(init?.headers),
      body: JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>,
    };
    seen.push(entry);
    if (init?.signal?.aborted === true) return Promise.reject(new DOMException("aborted", "AbortError"));
    const reply = answer(entry);
    if (reply instanceof Error) return Promise.reject(reply);
    const text = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
    return Promise.resolve(new Response(text, { status: reply.status ?? 200, headers: { "content-type": "application/json" } }));
  };
  return { fetch, seen };
}

describe("replay", () => {
  it("serves plain entries in order and counts what is left", async () => {
    const client = createReplayClient([
      { text: "one", finish: "stop", usage: { inputTokens: 1, outputTokens: 2 } },
      { text: "two", finish: "length", usage: { inputTokens: 3, outputTokens: 4 } },
    ]);
    expect(client.provider).toBe("replay");
    expect((await client.generate(REQUEST)).text).toBe("one");
    expect(client.remaining()).toBe(1);
    expect(await client.generate(REQUEST)).toMatchObject({ text: "two", finish: "length", usage: { inputTokens: 3, outputTokens: 4 } });
    expect(client.requests).toHaveLength(2);
  });

  it("reports an exhausted transcript as an error result", async () => {
    const result = await createReplayClient([]).generate(REQUEST);
    expect(result).toMatchObject({ finish: "error", text: "" });
    expect(result.error).toContain("exhausted");
  });

  it("checks the prompt hash when the entry has one", async () => {
    const good = createReplayClient([{ text: "x", finish: "stop", usage: { inputTokens: 0, outputTokens: 0 }, promptHash: requestHash(REQUEST) }]);
    expect((await good.generate(REQUEST)).finish).toBe("stop");
    const bad = createReplayClient([{ text: "x", finish: "stop", usage: { inputTokens: 0, outputTokens: 0 }, promptHash: requestHash(REQUEST) }]);
    const other = await bad.generate({ ...REQUEST, temperature: 0.9 });
    expect(other).toMatchObject({ finish: "error" });
    expect(other.error).toContain("replay mismatch");
  });

  it("the hash covers every part of the condition", () => {
    const base = requestHash(REQUEST);
    const variants: Partial<GenerateRequest>[] = [
      { system: "other" }, { maxOutputTokens: 101 }, { temperature: null }, { stop: ["x"] }, { seed: 1 }, { grammar: "root ::= a" },
      { messages: [{ role: "user", content: "hello!" }] },
    ];
    for (const change of variants) expect(requestHash({ ...REQUEST, ...change }), JSON.stringify(change)).not.toBe(base);
    expect(requestHash({ ...REQUEST })).toBe(base);
  });

  it("reads a recorded run as a transcript: model-call records are replayed, other records and budget stops are skipped", () => {
    const lines = [
      { type: "run-start", harnessVersion: "x" },
      { type: "model-call", generation: "completed", response: { text: "a" }, finish: "stop", usage: { inputTokens: 5, outputTokens: 6, cachedInputTokens: null }, promptHash: "h", error: null },
      { type: "validation", verdict: "pass" },
      { type: "model-call", generation: "budget-exceeded", response: null, finish: null, usage: null },
      { type: "model-call", generation: "truncated", response: { text: "b" }, finish: "length", usage: { inputTokens: 1, outputTokens: 2 } },
    ];
    const entries = parseTranscript(lines.map((l) => JSON.stringify(l)).join("\n"));
    expect(entries).toEqual([
      { text: "a", finish: "stop", usage: { inputTokens: 5, outputTokens: 6, cachedInputTokens: null }, promptHash: "h" },
      { text: "b", finish: "length", usage: { inputTokens: 1, outputTokens: 2, cachedInputTokens: 0 } },
    ]);
  });

  it("names the line of a transcript it cannot read", () => {
    expect(() => parseTranscript("{\n")).toThrow(/line 1: not JSON/);
    expect(() => parseTranscript('{"text": 3, "finish": "stop"}')).toThrow(/line 1: no response text/);
    expect(() => parseTranscript('\n{"text": "x", "finish": "done"}')).toThrow(/line 2: 'finish' must be one of/);
  });

  it("loads a transcript file", () => {
    const file = join(tempDir(), "t.jsonl");
    writeFileSync(file, '{"text": "x", "finish": "stop"}\n');
    expect(loadTranscript(file)).toHaveLength(1);
  });

  it("refuses a grammar unless told to forward it", () => {
    expect(createReplayClient([]).capabilities).toEqual({ grammar: false, seed: true });
    expect(createReplayClient([], { acceptGrammar: true }).capabilities.grammar).toBe(true);
  });
});

describe("openai-compatible (fake transport)", () => {
  const completion = (overrides: Record<string, unknown> = {}) => ({
    choices: [{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 12, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 8 } },
    ...overrides,
  });

  it("sends the documented request and maps the response", async () => {
    const { fetch, seen } = fakeFetch(() => ({ body: completion() }));
    const client = createOpenAi({ model: "m-1", baseUrl: "http://localhost:9999/v1/" }, { fetch, env: { OPENAI_API_KEY: "sk-secret" } });
    const result = await client.generate({ ...REQUEST, stop: ["END"], seed: 4 });
    expect(result).toEqual({ text: "hi", finish: "stop", usage: { inputTokens: 12, outputTokens: 3, cachedInputTokens: 8 } });
    const [request] = seen;
    expect(request?.url).toBe("http://localhost:9999/v1/chat/completions");
    expect(request?.method).toBe("POST");
    expect(request?.headers.get("authorization")).toBe("Bearer sk-secret");
    expect(request?.body).toEqual({
      model: "m-1",
      messages: [{ role: "system", content: "be brief" }, { role: "user", content: "hello" }],
      max_tokens: 100,
      stream: false,
      temperature: 0.5,
      stop: ["END"],
      seed: 4,
    });
    expect(JSON.stringify(result)).not.toContain("sk-secret");
  });

  it("sends no key without one, no temperature when null, and reads the key from the named variable", async () => {
    const { fetch, seen } = fakeFetch(() => ({ body: completion() }));
    const local = createOpenAi({ model: "m", baseUrl: "http://x/v1" }, { fetch, env: {} });
    await local.generate({ ...REQUEST, temperature: null });
    expect(seen[0]?.headers.get("authorization")).toBeNull();
    expect(seen[0]?.body).not.toHaveProperty("temperature");
    const named = createOpenAi({ model: "m", baseUrl: "http://x/v1", apiKeyEnv: "MY_KEY" }, { fetch, env: { MY_KEY: "k2", OPENAI_API_KEY: "wrong" } });
    await named.generate(REQUEST);
    expect(seen[1]?.headers.get("authorization")).toBe("Bearer k2");
  });

  it("maps finish reasons: length is truncation, refusals and content filters are refusals, anything else an error", async () => {
    const run = async (choice: Record<string, unknown>) => {
      const { fetch } = fakeFetch(() => ({ body: completion({ choices: [choice] }) }));
      return createOpenAi({ model: "m", baseUrl: "http://x/v1" }, { fetch, env: {} }).generate(REQUEST);
    };
    expect((await run({ message: { content: "partial" }, finish_reason: "length" }))).toMatchObject({ finish: "length", text: "partial" });
    expect(await run({ message: { content: "", refusal: "no" }, finish_reason: "stop" })).toMatchObject({ finish: "refusal", error: "no" });
    expect(await run({ message: { content: "" }, finish_reason: "content_filter" })).toMatchObject({ finish: "refusal" });
    expect(await run({ message: { content: "" }, finish_reason: "tool_calls" })).toMatchObject({ finish: "error" });
    expect(await run({ message: { content: "" } })).toMatchObject({ finish: "error" });
  });

  it("keeps usage unknown when the server does not report it", async () => {
    const { fetch } = fakeFetch(() => ({ body: { choices: [{ message: { content: "x" }, finish_reason: "stop" }] } }));
    const result = await createOpenAi({ model: "m", baseUrl: "http://x/v1" }, { fetch, env: {} }).generate(REQUEST);
    expect(result.usage).toEqual({ inputTokens: null, outputTokens: null, cachedInputTokens: null });
  });

  it("turns HTTP errors, transport failures and garbage into error results, never exceptions", async () => {
    const cases: [ReturnType<typeof fakeFetch>, RegExp][] = [
      [fakeFetch(() => ({ status: 500, body: "upstream exploded" })), /HTTP 500: upstream exploded/],
      [fakeFetch(() => ({ status: 401, body: { error: "bad key" } })), /HTTP 401/],
      [fakeFetch(() => new Error("connect ECONNREFUSED")), /ECONNREFUSED/],
      [fakeFetch(() => ({ body: "<html>" })), /not JSON/],
      [fakeFetch(() => ({ body: [] })), /not a JSON object/],
      [fakeFetch(() => ({ body: { choices: [] } })), /no choices/],
    ];
    for (const [{ fetch }, pattern] of cases) {
      const result = await createOpenAi({ model: "m", baseUrl: "http://x/v1" }, { fetch, env: {} }).generate(REQUEST);
      expect(result.finish).toBe("error");
      expect(result.error).toMatch(pattern);
    }
  });

  it("reports an aborted call as cancelled", async () => {
    const { fetch } = fakeFetch(() => ({ body: completion() }));
    const controller = new AbortController();
    controller.abort();
    const result = await createOpenAi({ model: "m", baseUrl: "http://x/v1" }, { fetch, env: {} }).generate(REQUEST, { signal: controller.signal });
    expect(result.finish).toBe("cancelled");
  });

  it("refuses to run a grammar it does not forward, and requires a model and a base URL", async () => {
    const { fetch, seen } = fakeFetch(() => ({ body: completion() }));
    const client = createOpenAi({ model: "m", baseUrl: "http://x/v1" }, { fetch, env: {} });
    expect(client.capabilities).toEqual({ grammar: false, seed: true });
    const result = await client.generate({ ...REQUEST, grammar: "root ::= a" });
    expect(result).toMatchObject({ finish: "error" });
    expect(result.error).toContain("refusing to run unconstrained");
    expect(seen).toHaveLength(0);
    expect(() => createOpenAi({ baseUrl: "http://x/v1" }, { fetch })).toThrow(/--model is required/);
    expect(() => createOpenAi({ model: "m" }, { fetch })).toThrow(/--base-url is required/);
  });
});

describe("llama-cpp (fake transport)", () => {
  it("defaults to the local server and forwards the grammar and the seed", async () => {
    const { fetch, seen } = fakeFetch(() => ({ body: { choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 4, completion_tokens: 1 } } }));
    const client = createLlama({ model: "qwen-gguf" }, { fetch, env: {} });
    expect(client.provider).toBe("llama-cpp");
    expect(client.capabilities).toEqual({ grammar: true, seed: true });
    const result = await client.generate({ ...REQUEST, grammar: "root ::= module", seed: 3 });
    expect(result.finish).toBe("stop");
    expect(seen[0]?.url).toBe(`${DEFAULT_BASE_URL}/chat/completions`);
    expect(seen[0]?.body).toMatchObject({ grammar: "root ::= module", seed: 3, model: "qwen-gguf" });
    expect(seen[0]?.headers.get("authorization")).toBeNull();
  });

  it("requires the model id, because it is recorded", () => {
    expect(() => createLlama({}, { env: {} })).toThrow(/--model is required/);
  });
});

describe("anthropic (the official SDK on a fake transport)", () => {
  const message = (overrides: Record<string, unknown> = {}) => ({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-test",
    content: [{ type: "text", text: "hello " }, { type: "text", text: "world" }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 4, cache_creation_input_tokens: 5, cache_read_input_tokens: 20 },
    ...overrides,
  });
  const create = (fetch: FetchLike, env: Record<string, string> = { ANTHROPIC_API_KEY: "sk-ant-secret" }) =>
    createAnthropic({ model: "claude-test" }, { fetch, env });

  it("sends the Messages API request and maps text and usage (cached input is part of input)", async () => {
    const { fetch, seen } = fakeFetch(() => ({ body: message() }));
    const result = await create(fetch).generate({ ...REQUEST, stop: ["END"] });
    expect(result).toEqual({ text: "hello world", finish: "stop", usage: { inputTokens: 35, outputTokens: 4, cachedInputTokens: 20, cacheWriteInputTokens: 5 } });
    const [request] = seen;
    expect(request?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request?.headers.get("x-api-key")).toBe("sk-ant-secret");
    expect(request?.headers.get("anthropic-version")).toBeTruthy();
    expect(request?.body).toMatchObject({
      model: "claude-test",
      max_tokens: 100,
      system: "be brief",
      messages: [{ role: "user", content: "hello" }],
      temperature: 0.5,
      stop_sequences: ["END"],
    });
    expect(JSON.stringify(result)).not.toContain("sk-ant-secret");
  });

  it("sends no temperature for null (models that reject sampling parameters)", async () => {
    const { fetch, seen } = fakeFetch(() => ({ body: message() }));
    await create(fetch).generate({ ...REQUEST, temperature: null });
    expect(seen[0]?.body).not.toHaveProperty("temperature");
    expect(seen[0]?.body).not.toHaveProperty("stop_sequences");
  });

  it("maps stop reasons: max_tokens is truncation, refusal is a refusal with its category, anything else an error", () => {
    const base = message() as unknown as Parameters<typeof toResult>[0];
    expect(toResult({ ...base, stop_reason: "stop_sequence" }).finish).toBe("stop");
    expect(toResult({ ...base, stop_reason: "max_tokens" }).finish).toBe("length");
    expect(toResult({ ...base, stop_reason: "model_context_window_exceeded" }).finish).toBe("length");
    const refused = toResult({ ...base, stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: null } } as never);
    expect(refused).toMatchObject({ finish: "refusal", error: "the model refused (category: cyber)" });
    expect(toResult({ ...base, stop_reason: "tool_use" })).toMatchObject({ finish: "error" });
    expect(toResult({ ...base, stop_reason: "pause_turn" }).error).toContain("pause_turn");
  });

  it("ignores non-text blocks and counts missing cache fields as zero cached input", () => {
    const base = message({ content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: "x" }], usage: { input_tokens: 7, output_tokens: 1, cache_creation_input_tokens: null, cache_read_input_tokens: null } });
    expect(toResult(base as unknown as Parameters<typeof toResult>[0])).toMatchObject({ text: "x", usage: { inputTokens: 7, cachedInputTokens: 0 } });
  });

  it("turns an API error into an error result", async () => {
    const { fetch } = fakeFetch(() => ({ status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "temperature is not supported" } } }));
    const result = await create(fetch).generate(REQUEST);
    expect(result.finish).toBe("error");
    expect(result.error).toContain("temperature is not supported");
    expect(result.error).not.toContain("sk-ant-secret");
  });

  it("reports an aborted call as cancelled", async () => {
    const { fetch } = fakeFetch(() => ({ body: message() }));
    const controller = new AbortController();
    controller.abort();
    const result = await create(fetch).generate(REQUEST, { signal: controller.signal });
    expect(result.finish).toBe("cancelled");
  });

  it("neither forwards a grammar nor a seed, and says so instead of running without them", async () => {
    const { fetch, seen } = fakeFetch(() => ({ body: message() }));
    const client = create(fetch);
    expect(client.capabilities).toEqual({ grammar: false, seed: false });
    expect((await client.generate({ ...REQUEST, grammar: "root ::= a" })).error).toContain("refusing to run unconstrained");
    expect((await client.generate({ ...REQUEST, seed: 1 })).error).toContain("refusing to run with an unapplied seed");
    expect(seen).toHaveLength(0);
  });

  it("reads the key from the environment when the client is created, and never has a default", () => {
    const { fetch } = fakeFetch(() => ({ body: message() }));
    expect(() => create(fetch, {})).toThrow(/ANTHROPIC_API_KEY is not set/);
    expect(() => createAnthropic({ model: "m", apiKeyEnv: "OTHER" }, { fetch, env: { ANTHROPIC_API_KEY: "x" } })).toThrow(/OTHER is not set/);
    expect(() => createAnthropic({}, { fetch, env: { ANTHROPIC_API_KEY: "x" } })).toThrow(/--model is required/);
  });
});

describe("the registry", () => {
  it("knows exactly the four adapters and rejects any other name", async () => {
    expect([...ADAPTER_NAMES]).toEqual(["replay", "anthropic", "openai-compatible", "llama-cpp"]);
    await expect(loadAdapter("gpt")).rejects.toThrow(/unknown adapter 'gpt'/);
  });

  it("loads each adapter by name, and only when asked", async () => {
    const { fetch } = fakeFetch(() => ({ body: {} }));
    const file = join(tempDir(), "t.jsonl");
    writeFileSync(file, '{"text": "x", "finish": "stop"}\n');
    expect((await createClient("replay", { transcript: file })).provider).toBe("replay");
    expect((await createClient("openai-compatible", { model: "m", baseUrl: "http://x/v1" }, { fetch })).provider).toBe("openai-compatible");
    expect((await createClient("llama-cpp", { model: "m" }, { fetch })).provider).toBe("llama-cpp");
    expect((await createClient("anthropic", { model: "m" }, { fetch, env: { ANTHROPIC_API_KEY: "k" } })).provider).toBe("anthropic");
    await expect(createClient("replay", {})).rejects.toThrow(/--transcript is required/);
  });
});
