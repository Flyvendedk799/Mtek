// What the first run against the real service taught the `anthropic` adapter (decision 0108): the cache breakpoint of
// prompt caching, the cache-write count that makes a cached call dearer, the HTTP status of a rejected call (a rejected call is
// not billed), no retries (a retry is a second bill), and a key that can appear in no error text. The transport is a fake;
// the shapes below are the ones the real API answered in the first runs.
import { describe, expect, it } from "vitest";
import { createClient, scrubSecrets, toResult } from "../src/adapters/anthropic.ts";
import type { FetchLike, GenerateRequest } from "../src/model-client.ts";

const KEY = "sk-ant-api03-THISISAFAKEKEYFORTESTS";
const REQUEST: GenerateRequest = {
  system: "be brief",
  messages: [
    { role: "user", content: "first" },
    { role: "assistant", content: "answer" },
    { role: "user", content: "second" },
  ],
  maxOutputTokens: 100,
  temperature: 0,
};

function transport(respond: () => { status?: number; body: unknown }): { fetch: FetchLike; bodies: Record<string, unknown>[] } {
  const bodies: Record<string, unknown>[] = [];
  const fetch: FetchLike = (_input, init) => {
    bodies.push(JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>);
    const { status, body } = respond();
    return Promise.resolve(new Response(JSON.stringify(body), { status: status ?? 200, headers: { "content-type": "application/json" } }));
  };
  return { fetch, bodies };
}

const ok = (usage: Record<string, unknown>) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-haiku-4-5-20251001",
  content: [{ type: "text", text: "Hello." }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 17, output_tokens: 5, ...usage },
});

describe("anthropic prompt caching", () => {
  it("puts the cache breakpoint on the newest message only, and only when asked", async () => {
    const plain = transport(() => ({ body: ok({}) }));
    await createClient({ model: "claude-haiku-4-5-20251001" }, { fetch: plain.fetch, env: { ANTHROPIC_API_KEY: KEY } }).generate(REQUEST);
    expect(plain.bodies[0]?.["messages"]).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "answer" },
      { role: "user", content: "second" },
    ]);
    const cached = transport(() => ({ body: ok({}) }));
    const client = createClient({ model: "claude-haiku-4-5-20251001", promptCaching: true }, { fetch: cached.fetch, env: { ANTHROPIC_API_KEY: KEY } });
    expect(client.promptCaching).toBe(true);
    await client.generate(REQUEST);
    expect(cached.bodies[0]?.["messages"]).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "answer" },
      { role: "user", content: [{ type: "text", text: "second", cache_control: { type: "ephemeral" } }] },
    ]);
    expect(createClient({ model: "m" }, { fetch: plain.fetch, env: { ANTHROPIC_API_KEY: KEY } }).promptCaching).toBe(false);
  });

  it("reports the cache writes apart from the reads and from the plain input, as the real service did", () => {
    // The first call of the real run: 5 514 tokens written to the cache. The second call: the same tokens read.
    const write = toResult(ok({ input_tokens: 3, cache_creation_input_tokens: 5514, cache_read_input_tokens: 0 }) as unknown as Parameters<typeof toResult>[0]);
    expect(write.usage).toEqual({ inputTokens: 5517, outputTokens: 5, cachedInputTokens: 0, cacheWriteInputTokens: 5514 });
    const read = toResult(ok({ input_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 5514 }) as unknown as Parameters<typeof toResult>[0]);
    expect(read.usage).toEqual({ inputTokens: 5517, outputTokens: 5, cachedInputTokens: 5514, cacheWriteInputTokens: 0 });
    const none = toResult(ok({}) as unknown as Parameters<typeof toResult>[0]);
    expect(none.usage).toEqual({ inputTokens: 17, outputTokens: 5, cachedInputTokens: 0 }); // the service said nothing about writes
  });
});

describe("anthropic failures", () => {
  it("returns the HTTP status of a rejected call, so that the spend guard does not charge it", async () => {
    const { fetch } = transport(() => ({ status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "max_tokens: too large" } } }));
    const result = await createClient({ model: "m" }, { fetch, env: { ANTHROPIC_API_KEY: KEY } }).generate(REQUEST);
    expect(result).toMatchObject({ finish: "error", httpStatus: 400 });
    expect(result.error).toContain("max_tokens: too large");
  });

  it("never retries: a 500 is one call, one record, and at most one bill", async () => {
    const { fetch, bodies } = transport(() => ({ status: 500, body: { type: "error", error: { type: "api_error", message: "overloaded" } } }));
    const result = await createClient({ model: "m" }, { fetch, env: { ANTHROPIC_API_KEY: KEY } }).generate(REQUEST);
    expect(result.httpStatus).toBe(500);
    expect(bodies).toHaveLength(1);
  });

  it("scrubs a key from error text, by value and by shape", () => {
    expect(scrubSecrets(`bad key ${KEY} here`, KEY)).toBe("bad key <redacted> here");
    expect(scrubSecrets("another sk-ant-api03-OTHER_KEY-123 leaked", KEY)).toBe("another <redacted> leaked");
    expect(scrubSecrets("nothing to hide", "")).toBe("nothing to hide");
  });

  it("scrubs a key an error message echoes", async () => {
    const { fetch } = transport(() => ({ status: 401, body: { type: "error", error: { type: "authentication_error", message: `invalid x-api-key ${KEY}` } } }));
    const result = await createClient({ model: "m" }, { fetch, env: { ANTHROPIC_API_KEY: KEY } }).generate(REQUEST);
    expect(result.httpStatus).toBe(401);
    expect(result.error).not.toContain("THISISAFAKEKEY");
    expect(result.error).toContain("<redacted>");
  });
});
