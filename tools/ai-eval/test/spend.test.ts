// The spend guard (decision 0108): money is a budget. The ledger lives outside the repository, every call is checked against the
// cap BEFORE it is made (with its worst case) and charged AFTER (from the provider's own usage), a refused call is recorded as
// unfinished-by-budget and is never a success, and nothing about the cost can be made smaller by a quiet failure.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createReplayClient } from "../src/adapters/replay.ts";
import type { GenerateRequest, GenerateResult, ModelClient } from "../src/model-client.ts";
import { costUsd, estimateInputTokens, guardClient, PRICING, pricingFor, SpendError, SpendLedger, worstCaseUsd } from "../src/spend.ts";
import { GOOD_EDIT, harness, reply, tempDir, validateRecord } from "./helpers.ts";

const MODEL = "claude-haiku-4-5-20251001";
const REQUEST: GenerateRequest = { system: "s".repeat(250), messages: [{ role: "user", content: "u".repeat(2500) }], maxOutputTokens: 1000, temperature: 0 };

function ledgerIn(dir = tempDir("ai-spend-")): SpendLedger {
  return new SpendLedger(join(dir, "nested", "ai-spend.json"));
}

/** A client that answers with fixed results and counts the calls that reached it. */
function scripted(results: GenerateResult[], model = MODEL): ModelClient & { calls: number } {
  let next = 0;
  const client = {
    provider: "anthropic",
    model,
    capabilities: { grammar: false, seed: false },
    calls: 0,
    generate(): Promise<GenerateResult> {
      client.calls += 1;
      const result = results[next] ?? results[results.length - 1];
      next += 1;
      return Promise.resolve(result as GenerateResult);
    },
  };
  return client;
}

const answer = (inputTokens: number, outputTokens: number, extra: Partial<GenerateResult["usage"]> = {}): GenerateResult => ({
  text: "ok",
  finish: "stop",
  usage: { inputTokens, outputTokens, cachedInputTokens: 0, ...extra },
});

describe("prices", () => {
  it("know Claude Haiku 4.5 under both of its names and refuse a model they do not know", () => {
    expect(pricingFor("claude-haiku-4-5-20251001")).toEqual({ inputPerMTok: 1, cacheWritePerMTok: 1.25, cacheReadPerMTok: 0.1, outputPerMTok: 5 });
    expect(pricingFor("claude-haiku-4-5")).toBe(PRICING["claude-haiku-4-5"]);
    expect(() => pricingFor("claude-opus-5-5")).toThrow(SpendError);
    expect(() => pricingFor("claude-opus-5-5")).toThrow(/no price is known/);
  });

  it("charge the plain input, the cache writes, the cache reads and the output at their own prices", () => {
    // 1 000 000 input tokens in all: 400 000 read, 100 000 written, 500 000 plain; 200 000 output.
    const usd = costUsd(MODEL, { inputTokens: 1_000_000, outputTokens: 200_000, cachedInputTokens: 400_000, cacheWriteInputTokens: 100_000 });
    expect(usd).toBeCloseTo(0.5 * 1 + 0.1 * 1.25 + 0.4 * 0.1 + 0.2 * 5, 10);
  });

  it("charge the dearer write price for an unreported part of a call that asked for caching, and nothing is guessed from an unknown count", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 0 };
    expect(costUsd(MODEL, usage)).toBeCloseTo(1, 10);
    expect(costUsd(MODEL, usage, { cachingRequested: true })).toBeCloseTo(1.25, 10);
    expect(costUsd(MODEL, { inputTokens: null, outputTokens: 5 })).toBeNull();
    expect(costUsd(MODEL, { inputTokens: 5, outputTokens: null })).toBeNull();
  });

  it("have a worst case that is the whole estimated input at the dearest input price plus the whole token cap as output", () => {
    const tokens = estimateInputTokens(REQUEST);
    expect(tokens).toBe(Math.ceil(2750 / 2.5));
    expect(worstCaseUsd(MODEL, REQUEST)).toBeCloseTo((tokens * 1.25 + 1000 * 5) / 1_000_000, 12);
  });
});

describe("the ledger", () => {
  it("is created where it is asked for, starts at zero and keeps every charge", () => {
    const ledger = ledgerIn();
    expect(ledger.totalUsd()).toBe(0);
    const entry = { at: "2026-01-01T00:00:00.000Z", runId: "r", model: MODEL, inputTokens: 1, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 1, usd: 0.25, note: null };
    expect(ledger.settle(null, entry)).toBeCloseTo(0.25, 12);
    expect(ledger.settle(null, entry)).toBeCloseTo(0.5, 12);
    expect(new SpendLedger(ledger.path).totalUsd()).toBeCloseTo(0.5, 12); // persists
    expect((JSON.parse(readFileSync(ledger.path, "utf8")) as { entries: unknown[] }).entries).toHaveLength(2);
  });

  it("reserves worst cases against the cap and releases them", () => {
    const ledger = ledgerIn();
    const a = ledger.reserve(0.6, 1);
    expect(a.id).not.toBeNull();
    expect(ledger.reserve(0.6, 1).id).toBeNull(); // 0.6 reserved + 0.6 > 1
    expect(ledger.committedUsd()).toBeCloseTo(0.6, 12);
    ledger.release(a.id as string);
    expect(ledger.reserve(0.6, 1).id).not.toBeNull();
  });

  it("lets a reservation that was never settled expire instead of blocking the money forever", () => {
    let now = Date.parse("2026-01-01T00:00:00Z");
    const ledger = new SpendLedger(join(tempDir("ai-spend-"), "l.json"), () => now);
    expect(ledger.reserve(0.9, 1).id).not.toBeNull();
    expect(ledger.reserve(0.2, 1).id).toBeNull();
    now += 16 * 60 * 1000;
    expect(ledger.reserve(0.2, 1).id).not.toBeNull();
  });

  it("refuses a ledger that was edited (a total that is not the sum of its entries)", () => {
    const ledger = ledgerIn();
    ledger.settle(null, { at: "t", runId: "r", model: MODEL, inputTokens: 1, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 1, usd: 0.5, note: null });
    const file = JSON.parse(readFileSync(ledger.path, "utf8")) as { totalUsd: number };
    file.totalUsd = 0.1;
    writeFileSync(ledger.path, JSON.stringify(file));
    expect(() => ledger.totalUsd()).toThrow(/edited/);
  });

  it("leaves no lock behind", () => {
    const ledger = ledgerIn();
    ledger.totalUsd();
    ledger.reserve(0.1, 1);
    expect(existsSync(`${ledger.path}.lock`)).toBe(false);
  });
});

describe("the guard", () => {
  it("charges a call from the provider's usage and reports the cost and the ledger total with the result", async () => {
    const ledger = ledgerIn();
    const guarded = guardClient(scripted([answer(1000, 100, { cacheWriteInputTokens: 0 })]), { ledger, capUsd: 1, runId: "run-a" });
    const result = await guarded.generate(REQUEST);
    expect(result.costUsd).toBeCloseTo((1000 * 1 + 100 * 5) / 1_000_000, 12);
    expect(result.ledgerTotalUsd).toBeCloseTo(result.costUsd as number, 12);
    expect(ledger.totalUsd()).toBeCloseTo(result.costUsd as number, 12);
    expect(guarded.summary()).toMatchObject({ capUsd: 1, runSpendUsd: result.costUsd, calls: 1, refusedCalls: 0, ledgerTotalAtStartUsd: 0 });
    const entries = (JSON.parse(readFileSync(ledger.path, "utf8")) as { entries: { runId: string; model: string }[] }).entries;
    expect(entries[0]).toMatchObject({ runId: "run-a", model: MODEL });
  });

  it("refuses a call whose worst case could exceed the cap, without reaching the provider and without charging", async () => {
    const ledger = ledgerIn();
    const inner = scripted([answer(10, 10)]);
    const worst = worstCaseUsd(MODEL, REQUEST);
    const guarded = guardClient(inner, { ledger, capUsd: worst / 2, runId: "r" });
    const result = await guarded.generate(REQUEST);
    expect(result.budgetStop).toBe("spend");
    expect(result.finish).toBe("error");
    expect(result.error).toMatch(/spend cap reached/);
    expect(inner.calls).toBe(0);
    expect(ledger.totalUsd()).toBe(0);
    expect(guarded.summary()).toMatchObject({ calls: 0, refusedCalls: 1 });
  });

  it("counts the money of earlier runs: the cap is on the ledger total, which persists across runs", async () => {
    const ledger = ledgerIn();
    const worst = worstCaseUsd(MODEL, REQUEST);
    const first = guardClient(scripted([answer(2000, 2000)]), { ledger, capUsd: worst * 1.5, runId: "one" });
    expect((await first.generate(REQUEST)).budgetStop).toBeUndefined();
    const second = guardClient(scripted([answer(1, 1)]), { ledger, capUsd: worst * 1.5, runId: "two" });
    expect(second.summary().ledgerTotalAtStartUsd).toBeGreaterThan(0);
    expect((await second.generate(REQUEST)).budgetStop).toBe("spend"); // the first run's real cost + this worst case > cap
  });

  it("stops at the cap in the middle of a series of calls and never overshoots it", async () => {
    const ledger = ledgerIn();
    const worst = worstCaseUsd(MODEL, REQUEST);
    const cap = worst * 2.5;
    const guarded = guardClient(scripted([answer(2500, 1000)]), { ledger, capUsd: cap, runId: "r" });
    let made = 0;
    for (let i = 0; i < 20; i += 1) {
      const result = await guarded.generate(REQUEST);
      if (result.budgetStop === "spend") break;
      made += 1;
      expect(ledger.totalUsd()).toBeLessThanOrEqual(cap);
    }
    expect(made).toBeGreaterThanOrEqual(2);
    expect(made).toBeLessThan(20);
    expect(ledger.committedUsd()).toBeLessThanOrEqual(cap);
  });

  it("does not charge an error response the provider answered with a status, and charges the worst case for a call that vanished", async () => {
    const ledger = ledgerIn();
    const rejected: GenerateResult = { text: "", usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, finish: "error", error: "400 invalid", httpStatus: 400 };
    const vanished: GenerateResult = { text: "", usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, finish: "cancelled", error: "the request was aborted" };
    const guarded = guardClient(scripted([rejected, vanished]), { ledger, capUsd: 1, runId: "r" });
    expect((await guarded.generate(REQUEST)).costUsd).toBe(0);
    const second = await guarded.generate(REQUEST);
    expect(second.costUsd).toBeCloseTo(worstCaseUsd(MODEL, REQUEST), 12);
    const notes = (JSON.parse(readFileSync(ledger.path, "utf8")) as { entries: { note: string }[] }).entries.map((e) => e.note);
    expect(notes[0]).toMatch(/not billed/);
    expect(notes[1]).toMatch(/worst case/);
  });

  it("charges the worst case for a usage the provider did not report, and for a call that threw", async () => {
    const ledger = ledgerIn();
    const unknown: GenerateResult = { text: "x", usage: { inputTokens: null, outputTokens: null }, finish: "stop" };
    const guarded = guardClient(scripted([unknown]), { ledger, capUsd: 1, runId: "r" });
    expect((await guarded.generate(REQUEST)).costUsd).toBeCloseTo(worstCaseUsd(MODEL, REQUEST), 12);
    const thrower: ModelClient = { provider: "anthropic", model: MODEL, capabilities: { grammar: false, seed: false }, generate: () => Promise.reject(new Error("boom")) };
    const total = ledger.totalUsd();
    await expect(guardClient(thrower, { ledger, capUsd: 1, runId: "r" }).generate(REQUEST)).rejects.toThrow("boom");
    expect(ledger.totalUsd()).toBeCloseTo(total + worstCaseUsd(MODEL, REQUEST), 12);
    expect(ledger.committedUsd()).toBeCloseTo(ledger.totalUsd(), 12); // no reservation is left behind
  });

  it("refuses a model without a price and a cap that is not a positive number", () => {
    const ledger = ledgerIn();
    expect(() => guardClient(scripted([answer(1, 1)], "some-other-model"), { ledger, capUsd: 1, runId: "r" })).toThrow(/no price/);
    for (const capUsd of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => guardClient(scripted([answer(1, 1)]), { ledger, capUsd, runId: "r" })).toThrow(/positive number/);
  });

  it("passes the client's prompt caching flag on", () => {
    const inner = { ...scripted([answer(1, 1)]), promptCaching: true };
    expect(guardClient(inner, { ledger: ledgerIn(), capUsd: 1, runId: "r" }).promptCaching).toBe(true);
  });
});

describe("a trial under the guard", () => {
  function priced(entries: Parameters<typeof createReplayClient>[0]): ModelClient {
    const replay = createReplayClient(entries, { model: MODEL });
    return { provider: "anthropic", model: MODEL, capabilities: replay.capabilities, generate: (r, o) => replay.generate(r, o) };
  }

  it("ends unfinished-by-budget when the cap is reached, records the prevented call, and is never a success", async () => {
    const h = harness([]);
    const ledger = ledgerIn();
    const guarded = guardClient(priced([reply(GOOD_EDIT)]), { ledger, capUsd: 0.0001, runId: "r" });
    const result = await h.run({ client: guarded });
    expect(result.outcome).toBe("unfinished");
    expect(result.reason).toBe("budget-spend");
    expect(result.calls).toBe(0);
    const calls = h.recorder.records.filter((r) => r["type"] === "model-call");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ generation: "budget-exceeded", budget: "spend", request: null, response: null });
    const end = h.recorder.records.find((r) => r["type"] === "trial-end");
    expect(end).toMatchObject({ outcome: "unfinished", reason: "budget-spend", final: null });
    for (const line of h.recorder.lines) expect(validateRecord(JSON.parse(line) as unknown), line).toEqual([]);
  });

  it("stops in the middle of a trial when the cap is reached after the first call, keeping what was spent", async () => {
    const h = harness([]);
    const ledger = ledgerIn();
    const firstCost = (2000 * 1 + 500 * 5) / 1_000_000;
    // After the first call there is not enough left for the worst case of the second.
    const guarded = guardClient(priced([reply("not an edit at all", { usage: { inputTokens: 2000, outputTokens: 500, cachedInputTokens: 0 } }), reply(GOOD_EDIT)]), { ledger, capUsd: 0.0235, runId: "r" });
    const result = await h.run({ client: guarded });
    expect(result.outcome).toBe("unfinished");
    expect(result.calls).toBe(1);
    expect(result.costUsd).toBeCloseTo(firstCost, 10);
    const [first, second] = h.recorder.records.filter((r) => r["type"] === "model-call");
    expect(first).toMatchObject({ round: 0, generation: "completed" });
    expect(first?.["costUsd"]).toBeCloseTo(firstCost, 10);
    expect(second).toMatchObject({ round: 1, generation: "budget-exceeded", budget: "spend" });
    const end = h.recorder.records.find((r) => r["type"] === "trial-end");
    expect(end?.["costUsd"]).toBeCloseTo(firstCost, 10);
    expect(end?.["totals"]).toMatchObject({ inputTokens: 2000, outputTokens: 500 });
    for (const line of h.recorder.lines) expect(validateRecord(JSON.parse(line) as unknown), line).toEqual([]);
  });

  it("records what each call cost and the ledger total", async () => {
    const h = harness([]);
    const guarded = guardClient(priced([reply(GOOD_EDIT, { usage: { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 0 } })]), { ledger: ledgerIn(), capUsd: 1, runId: "r" });
    const result = await h.run({ client: guarded });
    expect(result.outcome).toBe("success");
    const call = h.recorder.records.find((r) => r["type"] === "model-call");
    expect(call?.["costUsd"]).toBeCloseTo(0.0015, 10);
    expect(call?.["ledgerTotalUsd"]).toBeCloseTo(0.0015, 10);
    expect(h.recorder.records.find((r) => r["type"] === "trial-end")?.["costUsd"]).toBeCloseTo(0.0015, 10);
  });
});
