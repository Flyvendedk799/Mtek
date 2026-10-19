// A call that gets no response at all (a connection error, a timeout, DNS) is a failure of the network, not of the model (decision 0124):
// the repair loop retries it with a growing pause, at most three times, every try is a record of its own, and when there is still no
// answer the attempt ends `error` / `transport-error` (not judged), never `failure`. An answer with an HTTP status keeps its handling.
// The spend guard charges a connection error nothing and a timeout its worst case. All with fake transports; nothing opens a network.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createClient as createAnthropic, transportOf } from "../src/adapters/anthropic.ts";
import { createReplayClient, parseTranscript, type ReplayEntry } from "../src/adapters/replay.ts";
import { createChatCompletionsClient } from "../src/chat-completions.ts";
import { isTransportFailure, type FetchLike, type GenerateRequest, type GenerateResult, type ModelClient } from "../src/model-client.ts";
import { TRANSPORT_RETRY_DELAYS_MS } from "../src/repair-loop.ts";
import { guardClient, SpendLedger, worstCaseUsd } from "../src/spend.ts";
import { FIX_EDIT, GOOD_EDIT, harness, reply, TYPE_ERROR_EDIT, tempDir, usage, validateRecord } from "./helpers.ts";

type Rec = Record<string, unknown>;
const ofType = (records: Rec[], type: string): Rec[] => records.filter((r) => r["type"] === type);
const MODEL = "claude-haiku-4-5-20251001";

const connectionError = (): ReplayEntry => reply("", { finish: "error", error: "Connection error.", transport: "connection", usage: usage(0, 0) });
const timeoutError = (): ReplayEntry => reply("", { finish: "error", error: "Request timed out.", transport: "timeout", usage: usage(0, 0) });
const httpError = (status: number): ReplayEntry => reply("", { finish: "error", error: `${String(status)} overloaded`, httpStatus: status, usage: usage(0, 0) });

/** A sleep that does not wait and remembers how long it was asked to. */
function sleeper(): { sleep: (ms: number) => Promise<void>; waited: number[] } {
  const waited: number[] = [];
  return {
    waited,
    sleep: (ms) => {
      waited.push(ms);
      return Promise.resolve();
    },
  };
}

function expectValidRecords(records: Rec[]): void {
  for (const record of records) expect(validateRecord(record), JSON.stringify(record).slice(0, 200)).toEqual([]);
}

describe("the repair loop retries a call that got no response", () => {
  it("retries with 2 s, 8 s and 30 s, bounded at three retries", () => {
    expect(TRANSPORT_RETRY_DELAYS_MS).toEqual([2000, 8000, 30000]);
  });

  it("retries a connection error and a timeout, then succeeds: every try is a record of its own and nothing is a failure", async () => {
    const { sleep, waited } = sleeper();
    const h = harness([connectionError(), timeoutError(), reply(GOOD_EDIT)], { deps: { sleep } });
    const result = await h.run();
    expect(result).toMatchObject({ outcome: "success", reason: null, calls: 3, repairsUsed: 0 });
    expect(waited).toEqual([2000, 8000]);
    const calls = ofType(h.recorder.records, "model-call");
    expect(calls.map((c) => [c["round"], c["retry"], c["errorKind"], c["generation"], c["error"]])).toEqual([
      [0, undefined, "connection", "backend-error", "Connection error."],
      [0, 1, "timeout", "backend-error", "Request timed out."],
      [0, 2, undefined, "completed", null],
    ]);
    // the same request each time: a retry is the same call
    expect(new Set(calls.map((c) => c["promptHash"])).size).toBe(1);
    expect(h.client.remaining()).toBe(0);
    expectValidRecords(h.recorder.records);
  });

  it("ends error / transport-error, not failure, when the three retries get no response either", async () => {
    const { sleep, waited } = sleeper();
    const h = harness([connectionError(), connectionError(), timeoutError(), connectionError(), reply(GOOD_EDIT)], { deps: { sleep } });
    const result = await h.run();
    expect(result).toMatchObject({ outcome: "error", reason: "transport-error", calls: 4, repairsUsed: 0, firstAttempt: null, final: null });
    expect(result.message).toContain("Connection error.");
    expect(result.message).toContain("3 retries");
    expect(waited).toEqual([2000, 8000, 30000]);
    expect(h.client.remaining()).toBe(1); // no fifth call
    const calls = ofType(h.recorder.records, "model-call");
    expect(calls.map((c) => c["retry"])).toEqual([undefined, 1, 2, 3]);
    expect(ofType(h.recorder.records, "edit")).toHaveLength(0);
    expect(ofType(h.recorder.records, "validation")).toHaveLength(0);
    expect(ofType(h.recorder.records, "trial-end")[0]).toMatchObject({ outcome: "error", reason: "transport-error", calls: 4, final: null });
    expectValidRecords(h.recorder.records);
  });

  it("keeps the first attempt when the transport fails in a repair round", async () => {
    const { sleep } = sleeper();
    const h = harness([reply(TYPE_ERROR_EDIT), connectionError(), connectionError(), connectionError(), connectionError(), reply(FIX_EDIT)], { deps: { sleep } });
    const result = await h.run();
    expect(result).toMatchObject({ outcome: "error", reason: "transport-error", calls: 5, repairsUsed: 1 });
    expect(result.firstAttempt?.verdict).toBe("fail");
    const calls = ofType(h.recorder.records, "model-call");
    expect(calls.map((c) => c["round"])).toEqual([0, 1, 1, 1, 1]);
    expectValidRecords(h.recorder.records);
  });

  it("can be given fewer or no retries", async () => {
    const none = harness([connectionError(), reply(GOOD_EDIT)], { deps: { retryDelaysMs: [], sleep: sleeper().sleep } });
    expect(await none.run()).toMatchObject({ outcome: "error", reason: "transport-error", calls: 1 });
    const one = harness([connectionError(), reply(GOOD_EDIT)], { deps: { retryDelaysMs: [5], sleep: sleeper().sleep } });
    expect(await one.run()).toMatchObject({ outcome: "success", calls: 2 });
  });

  it("does not retry a response with an HTTP status, and keeps its handling (a failure, generation-error)", async () => {
    for (const status of [400, 429, 500, 529]) {
      const { sleep, waited } = sleeper();
      const h = harness([httpError(status), reply(GOOD_EDIT)], { deps: { sleep } });
      const result = await h.run();
      expect(result).toMatchObject({ outcome: "failure", reason: "generation-error", calls: 1 });
      expect(waited).toEqual([]);
      expect(h.client.remaining()).toBe(1);
      expect(ofType(h.recorder.records, "model-call")[0]).toMatchObject({ errorKind: "http", httpStatus: status, generation: "backend-error" });
      expectValidRecords(h.recorder.records);
    }
  });

  it("does not retry any other failure: an error without a kind, a truncation, a refusal", async () => {
    for (const entry of [reply("", { finish: "error", error: "unexpected stop_reason" }), reply(GOOD_EDIT, { finish: "length" }), reply("no", { finish: "refusal", error: "refused" })]) {
      const { sleep, waited } = sleeper();
      const h = harness([entry, reply(GOOD_EDIT)], { deps: { sleep } });
      const result = await h.run();
      expect(result.outcome).toBe("failure");
      expect(result.calls).toBe(1);
      expect(waited).toEqual([]);
    }
  });

  it("does not retry a client that throws", async () => {
    const { sleep, waited } = sleeper();
    const h = harness([], { deps: { sleep } });
    const throwing: ModelClient = { ...h.client, generate: () => Promise.reject(new Error("socket hang up")) };
    expect(await h.run({ client: throwing })).toMatchObject({ outcome: "failure", reason: "generation-error", message: "socket hang up" });
    expect(waited).toEqual([]);
  });

  it("stops retrying when the run is interrupted", async () => {
    const controller = new AbortController();
    const waited: number[] = [];
    const sleep = (ms: number): Promise<void> => {
      waited.push(ms);
      controller.abort();
      return Promise.resolve();
    };
    const h = harness([connectionError(), reply(GOOD_EDIT)], { deps: { sleep, signal: controller.signal } });
    const result = await h.run();
    expect(result).toMatchObject({ outcome: "error", reason: "transport-error", calls: 1 });
    expect(waited).toEqual([2000]);
  });

  it("is recognised by the client's own marker only", () => {
    const base: GenerateResult = { text: "", usage: usage(0, 0), finish: "error", error: "x" };
    expect(isTransportFailure({ ...base, transport: "connection" })).toBe(true);
    expect(isTransportFailure({ ...base, transport: "timeout" })).toBe(true);
    expect(isTransportFailure(base)).toBe(false);
    expect(isTransportFailure({ ...base, transport: "connection", httpStatus: 503 })).toBe(false);
    expect(isTransportFailure({ ...base, finish: "cancelled", transport: "timeout" })).toBe(false);
    expect(isTransportFailure({ ...base, transport: "connection", budgetStop: "spend" })).toBe(false);
  });
});

describe("the spend guard and a call that got no response", () => {
  const REQUEST: GenerateRequest = { system: "s".repeat(250), messages: [{ role: "user", content: "u".repeat(2500) }], maxOutputTokens: 1000, temperature: 0 };
  const failing = (extra: Partial<GenerateResult>): ModelClient => ({
    provider: "anthropic",
    model: MODEL,
    capabilities: { grammar: false, seed: false },
    generate: () => Promise.resolve({ text: "", usage: usage(0, 0), finish: "error", error: "failed", ...extra }),
  });
  const notes = (ledger: SpendLedger): string[] => (JSON.parse(readFileSync(ledger.path, "utf8")) as { entries: { note: string | null }[] }).entries.map((e) => String(e.note));
  const newLedger = (): SpendLedger => new SpendLedger(join(tempDir("ai-spend-"), "ai-spend.json"));

  it("charges a connection error nothing and notes it 'no response: not charged'", async () => {
    const ledger = newLedger();
    const result = await guardClient(failing({ transport: "connection", error: "Connection error." }), { ledger, capUsd: 1, runId: "r" }).generate(REQUEST);
    expect(result.costUsd).toBe(0);
    expect(ledger.totalUsd()).toBe(0);
    expect(notes(ledger)).toEqual(["no response: not charged"]);
  });

  it("still charges a timeout, after the request was sent, its worst case", async () => {
    const ledger = newLedger();
    const result = await guardClient(failing({ transport: "timeout", error: "Request timed out." }), { ledger, capUsd: 1, runId: "r" }).generate(REQUEST);
    expect(result.costUsd).toBeCloseTo(worstCaseUsd(MODEL, REQUEST), 12);
    expect(ledger.totalUsd()).toBeCloseTo(worstCaseUsd(MODEL, REQUEST), 12);
    expect(notes(ledger)[0]).toMatch(/worst case/);
  });

  it("charges an HTTP error nothing, as before, and an error with no kind its worst case, as before", async () => {
    const ledger = newLedger();
    const http = await guardClient(failing({ httpStatus: 529 }), { ledger, capUsd: 1, runId: "r" }).generate(REQUEST);
    expect(http.costUsd).toBe(0);
    const plain = await guardClient(failing({}), { ledger, capUsd: 1, runId: "r" }).generate(REQUEST);
    expect(plain.costUsd).toBeCloseTo(worstCaseUsd(MODEL, REQUEST), 12);
    expect(notes(ledger)[0]).toMatch(/not billed/);
  });

  it("charges every try of a trial on its own: connection 0, timeout the worst case, then the real cost", async () => {
    const ledger = newLedger();
    const { sleep } = sleeper();
    const replay = createReplayClient([connectionError(), timeoutError(), reply(GOOD_EDIT, { usage: usage(1000, 100) })], { model: MODEL });
    const priced: ModelClient = { provider: "anthropic", model: MODEL, capabilities: replay.capabilities, generate: (r, o) => replay.generate(r, o) };
    const h = harness([], { deps: { sleep } });
    const result = await h.run({ client: guardClient(priced, { ledger, capUsd: 100, runId: "r" }) });
    expect(result.outcome).toBe("success");
    const calls = ofType(h.recorder.records, "model-call");
    const request = calls[0]?.["request"] as { system: string; messages: { content: string }[]; maxOutputTokens: number };
    const worst = worstCaseUsd(MODEL, request as unknown as GenerateRequest);
    expect(calls.map((c) => c["costUsd"])).toEqual([0, expect.closeTo(worst, 12), expect.closeTo(0.0015, 10)]);
    expect(result.costUsd).toBeCloseTo(worst + 0.0015, 10);
    expect(notes(ledger)).toEqual(["no response: not charged", expect.stringMatching(/worst case/), "null"]);
    expect(ledger.totalUsd()).toBeCloseTo(worst + 0.0015, 10);
    expectValidRecords(h.recorder.records);
  });

  it("charges nothing for a trial that never got a response over four connection errors", async () => {
    const ledger = newLedger();
    const replay = createReplayClient([connectionError(), connectionError(), connectionError(), connectionError()], { model: MODEL });
    const priced: ModelClient = { provider: "anthropic", model: MODEL, capabilities: replay.capabilities, generate: (r, o) => replay.generate(r, o) };
    const h = harness([], { deps: { sleep: sleeper().sleep } });
    const result = await h.run({ client: guardClient(priced, { ledger, capUsd: 100, runId: "r" }) });
    expect(result).toMatchObject({ outcome: "error", reason: "transport-error", costUsd: 0 });
    expect(ledger.totalUsd()).toBe(0);
    expect(notes(ledger)).toEqual(Array(4).fill("no response: not charged"));
  });
});

// ---- the clients ------------------------------------------------------------------------------------------------------------

const KEY = "sk-ant-api03-THISISAFAKEKEYFORTESTS";
const REQUEST: GenerateRequest = { system: "s", messages: [{ role: "user", content: "hi" }], maxOutputTokens: 100, temperature: 0 };
const withCause = (message: string, cause: unknown): TypeError => Object.assign(new TypeError(message), { cause });
const coded = (message: string, code: string, name = "Error"): Error => Object.assign(new Error(message), { code, name });

function rejecting(error: () => Error): { fetch: FetchLike; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    fetch: () => {
      calls += 1;
      return Promise.reject(error());
    },
  };
}

describe("the anthropic adapter marks a call that got no response", () => {
  const client = (fetch: FetchLike) => createAnthropic({ model: MODEL }, { fetch, env: { ANTHROPIC_API_KEY: KEY } });

  it("calls a refused connection, DNS and a plain network failure a connection error, once (the SDK does not retry)", async () => {
    for (const cause of [coded("connect ECONNREFUSED 127.0.0.1:443", "ECONNREFUSED"), coded("getaddrinfo ENOTFOUND api.anthropic.com", "ENOTFOUND"), coded("getaddrinfo EAI_AGAIN", "EAI_AGAIN"), new Error("network down")]) {
      const t = rejecting(() => withCause("fetch failed", cause));
      const result = await client(t.fetch).generate(REQUEST);
      expect(result).toMatchObject({ finish: "error", error: "Connection error.", transport: "connection" });
      expect(result.httpStatus).toBeUndefined();
      expect(t.calls()).toBe(1);
    }
  });

  it("calls a connect timeout a connection error (nothing was sent), though the SDK words it 'Request timed out.'", async () => {
    const t = rejecting(() => withCause("fetch failed", coded("Connect Timeout Error", "UND_ERR_CONNECT_TIMEOUT", "ConnectTimeoutError")));
    const result = await client(t.fetch).generate(REQUEST);
    expect(result).toMatchObject({ finish: "error", error: "Request timed out.", transport: "connection" });
  });

  it("calls a timeout after the request was sent, and a reset, a timeout (they may have been processed)", async () => {
    const aborted = await client(rejecting(() => new DOMException("The operation was aborted", "AbortError")).fetch).generate(REQUEST);
    expect(aborted).toMatchObject({ finish: "error", error: "Request timed out.", transport: "timeout" });
    const reset = await client(rejecting(() => withCause("fetch failed", coded("read ECONNRESET", "ECONNRESET"))).fetch).generate(REQUEST);
    expect(reset).toMatchObject({ finish: "error", error: "Connection error.", transport: "timeout" });
    const socket = await client(rejecting(() => withCause("fetch failed", coded("other side closed", "UND_ERR_SOCKET"))).fetch).generate(REQUEST);
    expect(socket.transport).toBe("timeout");
  });

  it("reads the codes of an AggregateError (several addresses tried)", async () => {
    const reset = new AggregateError([coded("a", "ECONNRESET")], "connect failed");
    expect((await client(rejecting(() => withCause("fetch failed", reset)).fetch).generate(REQUEST)).transport).toBe("timeout");
    const refused = new AggregateError([coded("a", "ECONNREFUSED"), coded("b", "ECONNREFUSED")], "connect failed");
    expect((await client(rejecting(() => withCause("fetch failed", refused)).fetch).generate(REQUEST)).transport).toBe("connection");
  });

  it("says nothing about an error that is not a connection error", () => {
    expect(transportOf(new Error("boom"), coded("x", "ECONNREFUSED"))).toBeUndefined();
  });

  it("marks nothing on a response with a status, on a user abort, or on a success", async () => {
    const server = createAnthropic({ model: MODEL }, { fetch: () => Promise.resolve(new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }), { status: 529, headers: { "content-type": "application/json" } })), env: { ANTHROPIC_API_KEY: KEY } });
    const overloaded = await server.generate(REQUEST);
    expect(overloaded).toMatchObject({ finish: "error", httpStatus: 529 });
    expect(overloaded.transport).toBeUndefined();
    const controller = new AbortController();
    controller.abort();
    const cancelled = await client(rejecting(() => new Error("x")).fetch).generate(REQUEST, { signal: controller.signal });
    expect(cancelled.finish).toBe("cancelled");
    expect(cancelled.transport).toBeUndefined();
  });
});

describe("the chat-completions clients mark a call that got no response", () => {
  const make = (fetch: FetchLike) => createChatCompletionsClient({ provider: "openai-compatible", model: "m", baseUrl: "http://x/v1", fetch, capabilities: { grammar: false, seed: true }, sendGrammar: false });

  it("marks a rejected fetch as a connection error, a timeout as a timeout, and gives an HTTP error its status", async () => {
    expect(await make(rejecting(() => new Error("connect ECONNREFUSED")).fetch).generate(REQUEST)).toMatchObject({ finish: "error", transport: "connection" });
    const timedOut = Object.assign(new Error("The operation timed out"), { name: "TimeoutError" });
    expect(await make(rejecting(() => timedOut).fetch).generate(REQUEST)).toMatchObject({ finish: "error", transport: "timeout" });
    const server = make(() => Promise.resolve(new Response("upstream exploded", { status: 500 })));
    const result = await server.generate(REQUEST);
    expect(result).toMatchObject({ finish: "error", httpStatus: 500 });
    expect(result.transport).toBeUndefined();
  });
});

describe("the replay client", () => {
  it("serves a recorded transport failure again: a recorded run is a transcript", () => {
    const line = JSON.stringify({ type: "model-call", generation: "backend-error", finish: "error", error: "Connection error.", errorKind: "connection", response: { text: "" }, usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 } });
    const http = JSON.stringify({ type: "model-call", generation: "backend-error", finish: "error", error: "529", errorKind: "http", httpStatus: 529, response: { text: "" }, usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 } });
    const [first, second] = parseTranscript(`${line}\n${http}\n`);
    expect(first).toMatchObject({ finish: "error", transport: "connection" });
    expect(second).toMatchObject({ finish: "error", httpStatus: 529 });
    expect(second?.transport).toBeUndefined();
  });
});

// ---- the record schema ------------------------------------------------------------------------------------------------------

describe("the record schema (version 1, keys added only)", () => {
  it("accepts the new keys and the new reason, and the old shape of a failed call and of a failed trial", async () => {
    const h = harness([connectionError(), reply("", { finish: "error", error: "Connection error." })], { deps: { sleep: sleeper().sleep, retryDelaysMs: [1] } });
    await h.run();
    const calls = ofType(h.recorder.records, "model-call");
    expect(calls[0]).toMatchObject({ errorKind: "connection" });
    expect(calls[1]).toMatchObject({ retry: 1 });
    expect(calls[1]?.["errorKind"]).toBeUndefined(); // a record made without a kind (the shape of every record before decision 0124)
    expectValidRecords(h.recorder.records);
    // the old shape of an attempt lost to the transport (what records before decision 0124 say): a failure, generation-error
    expect(ofType(h.recorder.records, "trial-end")[0]).toMatchObject({ outcome: "failure", reason: "generation-error" });
  });

  it("refuses transport-error under another outcome, a bad retry and an unknown error kind", async () => {
    const h = harness([connectionError()], { deps: { sleep: sleeper().sleep, retryDelaysMs: [] } });
    await h.run();
    const end = ofType(h.recorder.records, "trial-end")[0] as Rec;
    const call = ofType(h.recorder.records, "model-call")[0] as Rec;
    expect(validateRecord(end)).toEqual([]);
    expect(validateRecord({ ...end, outcome: "failure" })).not.toEqual([]);
    expect(validateRecord({ ...call, retry: -1 })).not.toEqual([]);
    expect(validateRecord({ ...call, errorKind: "dns" })).not.toEqual([]);
    expect(validateRecord({ ...call, httpStatus: "500" })).not.toEqual([]);
  });
});
