// The report reads an attempt that never reached the model as NOT JUDGED (decision 0124), also when it was recorded the old way: a
// failure with the reason generation-error whose every call is a connection error or a timeout with no response. The rule is narrow
// on purpose: any other call, any other error text or any HTTP status keeps the attempt a failure.
import { describe, expect, it } from "vitest";
import { buildReport, extractTrials, holdoutSummary, selectSide, summarize } from "../src/report.ts";
import { GOOD_EDIT, harness, reply, TYPE_ERROR_EDIT, usage } from "./helpers.ts";

const none = { usage: usage(0, 0) };
/** The shape of an attempt lost to the transport in a record made before decision 0124: no marker on the call. */
const legacyConnection = () => reply("", { finish: "error", error: "Connection error.", ...none });
const legacyTimeout = () => reply("", { finish: "error", error: "Request timed out.", ...none });

async function mixedRun() {
  const h = harness(
    [
      reply(GOOD_EDIT), // 0 success
      legacyConnection(), // 1 not judged (legacy)
      legacyTimeout(), // 2 not judged (legacy)
      reply(TYPE_ERROR_EDIT), // 3 failure: max-repairs
      reply("", { finish: "error", error: "Connection error.", httpStatus: 503, ...none }), // 4 failure: the service answered with a status
      reply("", { finish: "error", error: "overloaded", ...none }), // 5 failure: another error text
      reply(TYPE_ERROR_EDIT), // 6 failure: not every call of the attempt is a transport error ...
      legacyConnection(), // ... (the second one is)
      reply("", { finish: "error", error: "Connection error.", transport: "connection", ...none }), // 7 not judged (new record, retried away below)
    ],
    { deps: { retryDelaysMs: [] } },
  );
  for (let i = 0; i < 8; i += 1) await h.run({ trialIndex: i, ...(i === 3 ? { maxRepairs: 0 } : {}) });
  return h.recorder.records;
}

describe("the legacy rule for attempts lost to the transport", () => {
  it("reads exactly the attempts that never reached the model as not judged", async () => {
    const records = await mixedRun();
    const { trials } = extractTrials(records);
    const by = (i: number) => trials[i];
    expect(trials.map((t) => [t.outcome, t.reason])).toEqual([
      ["success", null],
      ["error", "transport-error"],
      ["error", "transport-error"],
      ["failure", "max-repairs"],
      ["failure", "generation-error"],
      ["failure", "generation-error"],
      ["failure", "generation-error"],
      ["error", "transport-error"],
    ]);
    expect([1, 2].map((i) => by(i)?.legacyTransport)).toEqual([true, true]);
    expect(by(7)?.legacyTransport).toBeUndefined(); // recorded as an error already
    expect(by(1)?.message).toContain("record made before decision 0124");
    // an attempt that never reached the model has no first attempt; a failed first reply that did reach it does
    expect([1, 2, 7].map((i) => by(i)?.firstAttempt)).toEqual([null, null, null]);
    expect(by(5)?.firstAttempt).not.toBeNull();
  });

  it("keeps them out of the completion rate and the tokens per completed task, and in the counts", async () => {
    const { trials } = extractTrials(await mixedRun());
    const s = summarize(trials);
    expect(s).toMatchObject({ n: 8, success: 1, failure: 4, error: 3, valid: 5 });
    expect(s.completionRate).toBeCloseTo(1 / 5, 12);
    expect(s.excludedShare).toBeCloseTo(3 / 8, 12);
    // the tokens of the attempts that did reach the model are all in, the three lost ones have none
    expect(s.tokensPerCompleted).toBe(s.totalTokens);
  });

  it("lists them under 'Attempts that could not be judged' and states the rule", async () => {
    const { markdown } = buildReport({ records: await mixedRun(), title: "T" });
    const section = markdown.slice(markdown.indexOf("## Attempts that could not be judged"), markdown.indexOf("## Holdout"));
    expect(section.match(/\| error \| transport-error/g)).toHaveLength(3);
    expect(section).toContain("3 of the 8 attempts ended with the reason `transport-error`");
    expect(section).toContain("not judged, are out of every completion rate and of tokens per completed task");
    expect(section).toContain("2 of them are read by a legacy rule (decision 0124)");
    expect(section).toContain("EVERY model call of it is `backend-error` with the error text `Connection error.` or `Request timed out.`");
    // the failures that are not transport failures are not in that section
    expect(section).not.toContain("max-repairs");
    expect(section).not.toContain("overloaded");
  });

  it("states no legacy rule when every such attempt was recorded as an error already", async () => {
    const h = harness([reply("", { finish: "error", error: "Connection error.", transport: "connection", ...none })], { deps: { retryDelaysMs: [] } });
    await h.run();
    const { markdown } = buildReport({ records: h.recorder.records, title: "T" });
    expect(markdown).toContain("1 of the 1 attempts ended with the reason `transport-error`");
    expect(markdown).not.toContain("legacy rule");
  });

  it("leaves a report without such attempts exactly as it was (no new text)", () => {
    const { markdown } = buildReport({ records: [], title: "T" });
    expect(markdown).not.toContain("transport-error");
    expect(markdown).not.toContain("legacy");
  });

  it("gives the holdout summary the reason transport-error", async () => {
    const records = await mixedRun();
    const taskId = (records.find((r) => r["type"] === "trial-start") as Record<string, unknown>)["taskId"] as string;
    const { trials } = extractTrials(records, new Set([taskId]));
    const rows = holdoutSummary(trials);
    expect(rows).toHaveLength(8);
    expect(rows.filter((r) => r["outcome"] === "error").map((r) => r["reason"])).toEqual(["transport-error", "transport-error", "transport-error"]);
  });
});

describe("selecting one side of a run", () => {
  const start = (runId: string, trialId: string, side: string | undefined) => ({ type: "trial-start", runId, trialId, taskId: "t", condition: side === undefined ? {} : { side } });
  const records = [
    { type: "run-start", runId: "r" },
    start("r", "a", undefined),
    start("r", "b", "baseline"),
    { type: "model-call", runId: "r", trialId: "a" },
    { type: "model-call", runId: "r", trialId: "b" },
    { type: "trial-end", runId: "r", trialId: "a" },
    { type: "trial-end", runId: "r", trialId: "b" },
    { type: "run-end", runId: "r" },
  ];

  it("keeps the run records and the records of the attempts of that side only (no side is Mtek)", () => {
    const id = (r: Record<string, unknown>): string => (typeof r["trialId"] === "string" ? r["trialId"] : "");
    expect(selectSide(records, "baseline").map((r) => `${String(r["type"])}:${id(r)}`)).toEqual(["run-start:", "trial-start:b", "model-call:b", "trial-end:b", "run-end:"]);
    expect(selectSide(records, "mtek").map(id)).toEqual(["", "a", "a", "a", ""]);
  });
});
