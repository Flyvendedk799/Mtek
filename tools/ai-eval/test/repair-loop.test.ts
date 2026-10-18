import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createReplayClient } from "../src/adapters/replay.ts";
import type { Clock } from "../src/clock.ts";
import { GRAMMAR_UNAVAILABLE_MESSAGE, type GrammarCapability } from "../src/grammar.ts";
import type { GenerateOptions, GenerateRequest, GenerateResult, ModelClient } from "../src/model-client.ts";
import {
  coldTask,
  editTask,
  DELETE_CUBE_EDIT,
  FIX_EDIT,
  GOOD_EDIT,
  harness,
  RESTORE_CUBE_EDIT,
  reply,
  SYNTAX_ERROR_EDIT,
  TYPE_ERROR_EDIT,
  usage,
  validateRecord,
} from "./helpers.ts";

type Rec = Record<string, unknown>;
const ofType = (records: Rec[], type: string): Rec[] => records.filter((r) => r["type"] === type);

/** Every record the loop writes validates against spec/ai-eval-record.schema.json. */
function expectValidRecords(records: Rec[]): void {
  for (const record of records) expect(validateRecord(record), JSON.stringify(record).slice(0, 200)).toEqual([]);
  expect(records.map((r) => r["seq"])).toEqual(records.map((_, i) => i));
}

describe("success", () => {
  it("passes on the first try only when every layer passes, and records each layer", async () => {
    const h = harness([reply(GOOD_EDIT)]);
    const result = await h.run();
    expect(result).toMatchObject({ outcome: "success", reason: null, calls: 1, repairsUsed: 0 });
    const records = h.recorder.records;
    expectValidRecords(records);
    expect(records.map((r) => r["type"])).toEqual(["trial-start", "model-call", "edit", "validation", "trial-end"]);

    const validation = ofType(records, "validation")[0] as Rec;
    expect(validation["verdict"]).toBe("pass");
    const layers = validation["layers"] as Record<string, { outcome: string }>;
    expect(Object.fromEntries(Object.entries(layers).map(([k, v]) => [k, v.outcome]))).toEqual({
      parse: "pass", check: "pass", build: "pass", start: "pass", tests: "pass",
    });
    expect(validation["requiredSymbols"]).toMatchObject({ outcome: "pass", missing: [] });

    // the commands ran in the documented order, each as its own process
    expect(h.fake.commandsRun()).toEqual(["context", "check", "context", "context", "build", "test"]);
    const end = ofType(records, "trial-end")[0] as Rec;
    expect(end).toMatchObject({ outcome: "success", calls: 1, repairsUsed: 0 });
    expect((end["firstAttempt"] as Rec)["verdict"]).toBe("pass");
  });

  it("records the model call completely: prompt, hash, response, usage, finish, generation", async () => {
    const h = harness([reply(GOOD_EDIT, { usage: usage(1234, 56) })]);
    await h.run({ temperature: 0.2, stop: ["END"], seed: 7 });
    const call = ofType(h.recorder.records, "model-call")[0] as Rec;
    expect(call).toMatchObject({
      round: 0,
      generation: "completed",
      finish: "stop",
      response: { text: GOOD_EDIT },
      usage: { inputTokens: 1234, outputTokens: 56 },
      error: null,
      budget: null,
    });
    const request = call["request"] as Rec;
    expect(request).toMatchObject({ temperature: 0.2, stop: ["END"], seed: 7, maxOutputTokens: 4000, grammarSha256: null });
    expect(String(request["system"])).toContain("<<<SEARCH");
    const messages = request["messages"] as { role: string; content: string }[];
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toContain("Make the cube's speed negative");
    expect(messages[0]?.content).toContain("Demo.Cube, Demo.Marker");
    expect(messages[0]?.content).toContain("speed = 1;"); // the starter's files
    expect(messages[0]?.content).toContain("contextFormat"); // the compiler's context document
    expect(messages[0]?.content).not.toContain("expect_state"); // the task's tests stay hidden
    expect(call["promptHash"]).toMatch(/^[0-9a-f]{64}$/);
    const sections = call["promptSections"] as Record<string, number>;
    expect(Object.keys(sections).sort()).toEqual(["context", "instructions", "project", "requiredSymbols", "system", "task"]);
    expect(h.client.requests[0]).toMatchObject({ temperature: 0.2, stop: ["END"], seed: 7 });
  });
});

describe("repair", () => {
  it("sends localized diagnostics after a failed candidate and succeeds on the repair", async () => {
    const h = harness([reply(TYPE_ERROR_EDIT), reply(FIX_EDIT)]);
    const result = await h.run();
    expect(result).toMatchObject({ outcome: "success", calls: 2, repairsUsed: 1 });
    expect(result.firstAttempt?.verdict).toBe("fail");
    expect(result.final?.verdict).toBe("pass");

    const second = h.client.requests[1] as GenerateRequest;
    expect(second.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(second.messages[1]?.content).toBe(TYPE_ERROR_EDIT);
    const feedback = second.messages[2]?.content ?? "";
    expect(feedback).toContain("MTEK-E3102"); // the envelope entry
    expect(feedback).toContain("Field expects f32, but received vec3."); // its message
    expect(feedback).toContain("speed = TYPE_ERROR;"); // the source line around the span
    expect(feedback).toContain("> 3 |"); // numbered, the span's line marked
    expect(feedback).toContain("check: fail");
    expect(feedback).toContain("build: not-run (skipped) - check failed");
    expect(feedback).toContain("repair 1 of 3");

    const records = h.recorder.records;
    expectValidRecords(records);
    const validations = ofType(records, "validation");
    expect(validations.map((v) => v["verdict"])).toEqual(["fail", "pass"]);
    expect((validations[0]?.["layers"] as Record<string, { outcome: string }>)["check"]?.outcome).toBe("fail");
    expect(validations[0]?.["diagnostics"]).toHaveLength(1);
    // the first attempt's layers are preserved in the trial end
    const end = ofType(records, "trial-end")[0] as Rec;
    expect(((end["firstAttempt"] as Rec)["layers"] as Record<string, { outcome: string }>)["check"]?.outcome).toBe("fail");
    expect(end["repairsUsed"]).toBe(1);
  });

  it("does not count syntax as success: a candidate that parses and checks but fails its tests is a failure", async () => {
    const h = harness([reply("<<<FILE src/main.mtek\n<<<SEARCH\n        speed = 1;\n===\n        speed = 2;\n>>>REPLACE\n")], {});
    const result = await h.run({ maxRepairs: 0 });
    expect(result).toMatchObject({ outcome: "failure", reason: "max-repairs" });
    const layers = result.final?.layers;
    expect(layers?.parse.outcome).toBe("pass");
    expect(layers?.check.outcome).toBe("pass");
    expect(layers?.build.outcome).toBe("pass");
    expect(layers?.start.outcome).toBe("pass");
    expect(layers?.tests.outcome).toBe("fail");
    expect(result.final?.verdict).toBe("fail");
  });

  it("records parse and check separately: a syntax error fails both and skips the rest", async () => {
    const h = harness([reply(SYNTAX_ERROR_EDIT)]);
    const result = await h.run({ maxRepairs: 0 });
    const layers = result.final?.layers;
    expect(layers?.parse.outcome).toBe("fail");
    expect(layers?.check.outcome).toBe("fail");
    expect([layers?.build.outcome, layers?.start.outcome, layers?.tests.outcome]).toEqual(["not-run", "not-run", "not-run"]);
    expect(layers?.build.notRun).toBe("skipped");
    expect(h.fake.commandsRun()).not.toContain("build"); // nothing was built
    expect(h.fake.commandsRun()).not.toContain("test");
  });

  it("a failing build is its own layer", async () => {
    const edit = "<<<FILE src/main.mtek\n<<<SEARCH\n        speed = 1;\n===\n        speed = BUILD_ERROR;\n>>>REPLACE\n";
    const h = harness([reply(edit), reply("<<<FILE src/main.mtek\n<<<SEARCH\n        speed = BUILD_ERROR;\n===\n        speed = -speed;\n>>>REPLACE\n")]);
    const result = await h.run();
    expect(result.outcome).toBe("success");
    const first = result.firstAttempt?.layers;
    expect([first?.parse.outcome, first?.check.outcome, first?.build.outcome, first?.start.outcome]).toEqual(["pass", "pass", "fail", "not-run"]);
    expect(h.client.requests[1]?.messages[2]?.content).toContain("MTEK-E6001");
  });

  it("sends the task's failing test messages as feedback, or only their names when asked", async () => {
    const wrong = "<<<FILE src/main.mtek\n<<<SEARCH\n        speed = 1;\n===\n        speed = 2;\n>>>REPLACE\n";
    const full = harness([reply(wrong), reply(GOOD_EDIT.replace("        speed = 1;", "        speed = 2;"))]);
    await full.run();
    const text = full.client.requests[1]?.messages[2]?.content ?? "";
    expect(text).toContain("expect_state at step 2: Cube.speed is 1, expected -1");
    const quiet = harness([reply(wrong), reply(GOOD_EDIT.replace("        speed = 1;", "        speed = 2;"))]);
    await quiet.run({ testFeedback: "status-only" });
    const hidden = quiet.client.requests[1]?.messages[2]?.content ?? "";
    expect(hidden).toContain("the cube's speed is negative: failed (expect_state)");
    expect(hidden).not.toContain("expected -1");
  });

  it("shows the current content of the changed files in the repair prompt", async () => {
    const h = harness([reply(TYPE_ERROR_EDIT), reply(FIX_EDIT)]);
    await h.run();
    const text = h.client.requests[1]?.messages[2]?.content ?? "";
    expect(text).toContain("# Current content of the files you have changed");
    expect(text).toContain("## src/main.mtek");
  });
});

describe("integrity: the exact-match rule", () => {
  it("rejects a search that matches nothing, records it, counts a repair round and applies nothing", async () => {
    const miss = "<<<FILE src/main.mtek\n<<<SEARCH\n        speed = 99;\n===\n        speed = -speed;\n>>>REPLACE\n";
    const h = harness([reply(miss), reply(GOOD_EDIT)]);
    const result = await h.run();
    expect(result).toMatchObject({ outcome: "success", calls: 2, repairsUsed: 1 });
    const records = h.recorder.records;
    expectValidRecords(records);
    const edits = ofType(records, "edit");
    expect(edits.map((e) => e["outcome"])).toEqual(["rejected", "applied"]);
    expect((edits[0]?.["rejected"] as Rec[])[0]).toMatchObject({ code: "search-not-found", file: "src/main.mtek", index: 1 });
    // a rejected reply produced no validation of its own
    expect(ofType(records, "validation")).toHaveLength(1);
    // the structured error went back to the model, with the file as it is
    const feedback = h.client.requests[1]?.messages[2]?.content ?? "";
    expect(feedback).toContain("Your reply was rejected and nothing was applied (repair 1 of 3)");
    expect(feedback).toContain("[search-not-found]");
    expect(feedback).toContain("speed = 1;");
  });

  it("rejects a search that matches several places", async () => {
    const twice = "<<<FILE src/main.mtek\n<<<SEARCH\n    }\n===\n    }\n    // x\n>>>REPLACE\n";
    const h = harness([reply(twice), reply(GOOD_EDIT)]);
    await h.run();
    const edit = ofType(h.recorder.records, "edit")[0] as Rec;
    expect((edit["rejected"] as Rec[])[0]).toMatchObject({ code: "search-ambiguous", matches: 2 });
  });

  it("a reply with no edit blocks is a rejected round, too", async () => {
    const h = harness([reply("I would change the speed."), reply(GOOD_EDIT)]);
    const result = await h.run();
    expect(result.outcome).toBe("success");
    expect((ofType(h.recorder.records, "edit")[0]?.["rejected"] as Rec[])[0]?.["code"]).toBe("no-edit-blocks");
  });

  it("uses up the repair rounds on rejected edits and then fails", async () => {
    const miss = reply("<<<FILE src/main.mtek\n<<<SEARCH\nnothing here\n===\nx\n>>>REPLACE\n");
    const h = harness([miss, miss, miss, miss]);
    const result = await h.run();
    expect(result).toMatchObject({ outcome: "failure", reason: "max-repairs", calls: 4, repairsUsed: 3, firstAttempt: null });
    expect(ofType(h.recorder.records, "validation")).toHaveLength(0);
  });

  it("refuses a whole-file block over an existing file of an edit task, but not in a cold task", async () => {
    const whole = "<<<FILE src/main.mtek\n<<<WHOLE\nscene Demo {\n    entity Cube {\n        speed = -speed;\n    }\n    entity Marker {\n    }\n}\n>>>END\n";
    const edit = harness([reply(whole), reply(GOOD_EDIT)]);
    await edit.run();
    expect((ofType(edit.recorder.records, "edit")[0]?.["rejected"] as Rec[])[0]?.["code"]).toBe("whole-file-not-allowed");

    const coldWhole = "<<<FILE src/main.mtek\n<<<WHOLE\nscene Demo {\n    entity Cube {\n        speed = -speed;\n    }\n    entity Marker {\n    }\n}\n>>>END\n";
    const cold = harness([reply(coldWhole)], { task: coldTask(), fake: { behaviour: () => "pass" } });
    const result = await cold.run({ task: coldTask() });
    expect(ofType(cold.recorder.records, "edit")[0]?.["outcome"]).toBe("applied");
    expect(result).toMatchObject({ outcome: "success" }); // Cube is the only required symbol of the cold task, and it is declared
  });

  it("refuses to change the task's tests or anything but the project's sources", async () => {
    const tamper = "<<<FILE tests/negative.test.toml\n<<<SEARCH\n-1\n===\n1\n>>>REPLACE\n";
    const h = harness([reply(tamper), reply(GOOD_EDIT)]);
    await h.run();
    expect((ofType(h.recorder.records, "edit")[0]?.["rejected"] as Rec[])[0]?.["code"]).toBe("path-not-allowed");
  });
});

describe("integrity: required symbols", () => {
  it("rejects a 'repair' that deletes the feature under test even though everything compiles and the tests pass", async () => {
    // Round 0 introduces a type error; round 1 "fixes" it by deleting the entity. The fake's tests are
    // vacuous (they pass), so only the required-symbols check can catch it.
    const h = harness([reply(TYPE_ERROR_EDIT), reply(DELETE_CUBE_EDIT), reply(RESTORE_CUBE_EDIT)], {
      fake: { behaviour: () => "pass" },
    });
    const result = await h.run();
    const validations = ofType(h.recorder.records, "validation");
    expect(validations.map((v) => v["verdict"])).toEqual(["fail", "fail", "pass"]);

    const deleted = validations[1] as Rec;
    const layers = deleted["layers"] as Record<string, { outcome: string }>;
    // every layer passed: the deletion is invisible to parse, check, build, start and tests ...
    expect(Object.values(layers).map((l) => l.outcome)).toEqual(["pass", "pass", "pass", "pass", "pass"]);
    // ... and is caught by the required symbols.
    expect(deleted["requiredSymbols"]).toMatchObject({ outcome: "fail", missing: ["Demo.Cube"] });
    expect(deleted["verdict"]).toBe("fail");
    expectValidRecords(h.recorder.records);

    // the model is told, and restoring the feature succeeds
    expect(h.client.requests[2]?.messages[4]?.content).toContain("Demo.Cube");
    expect(h.client.requests[2]?.messages[4]?.content).toContain("removing a feature is never a fix");
    expect(result).toMatchObject({ outcome: "success", repairsUsed: 2 });
  });

  it("ends in failure when the model keeps the feature deleted", async () => {
    const h = harness([reply(TYPE_ERROR_EDIT), reply(DELETE_CUBE_EDIT)], { fake: { behaviour: () => "pass" } });
    const result = await h.run({ maxRepairs: 1 });
    expect(result).toMatchObject({ outcome: "failure", reason: "max-repairs" });
    expect(result.final?.requiredSymbols.missing).toEqual(["Demo.Cube"]);
    expect(result.final?.verdict).toBe("fail");
  });
});

describe("budgets", () => {
  it("stops after maxRepairs and preserves the failing project", async () => {
    const wrong = reply("<<<FILE src/main.mtek\n<<<SEARCH\n        speed = 1;\n===\n        speed = 2;\n>>>REPLACE\n");
    const more = (from: number, to: number) =>
      reply(`<<<FILE src/main.mtek\n<<<SEARCH\n        speed = ${String(from)};\n===\n        speed = ${String(to)};\n>>>REPLACE\n`);
    const h = harness([wrong, more(2, 3), more(3, 4), more(4, 5)]);
    const result = await h.run();
    expect(result).toMatchObject({ outcome: "failure", reason: "max-repairs", calls: 4, repairsUsed: 3 });
    expect(h.client.remaining()).toBe(0);

    const end = ofType(h.recorder.records, "trial-end")[0] as Rec;
    expect(end).toMatchObject({ outcome: "failure", reason: "max-repairs", finalProject: `trials/${result.trialId}/project` });
    // the failing project, all diagnostics (here: test failures per round) and the transcript are preserved
    const preserved = join(h.runDir, "trials", result.trialId, "project", "src", "main.mtek");
    expect(readFileSync(preserved, "utf8")).toContain("speed = 5;");
    expect(existsSync(join(h.runDir, "trials", result.trialId, "project", "tests"))).toBe(false); // the task's tests are not part of the candidate
    expect(ofType(h.recorder.records, "model-call")).toHaveLength(4);
    expect(ofType(h.recorder.records, "validation")).toHaveLength(4);
    expectValidRecords(h.recorder.records);
  });

  it("honours a smaller maxRepairs than the task's", async () => {
    const wrong = reply("<<<FILE src/main.mtek\n<<<SEARCH\n        speed = 1;\n===\n        speed = 2;\n>>>REPLACE\n");
    const h = harness([wrong, wrong]);
    const result = await h.run({ maxRepairs: 1 });
    expect(result).toMatchObject({ calls: 2, reason: "max-repairs" });
  });

  it("stops when the wall-clock budget is used up, recording the call that did not happen", async () => {
    let now = 0;
    const clock: Clock = { nowMs: () => now, iso: () => new Date(Date.UTC(2026, 0, 1) + now).toISOString() };
    const wrong = reply("<<<FILE src/main.mtek\n<<<SEARCH\n        speed = 1;\n===\n        speed = 2;\n>>>REPLACE\n");
    const h = harness([wrong, reply(GOOD_EDIT)], { clock });
    const slow: ModelClient = {
      ...h.client,
      generate: async (request, options) => {
        const result = await h.client.generate(request, options);
        now += 301_000; // the model call takes longer than max_wall_seconds = 300
        return result;
      },
    };
    const result = await h.run({ client: slow });
    expect(result).toMatchObject({ outcome: "failure", reason: "budget-wall-clock", calls: 1 });
    const calls = ofType(h.recorder.records, "model-call");
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ generation: "budget-exceeded", budget: "wall-clock", request: null, response: null, usage: null, finish: null, promptHash: null, round: 1 });
    expectValidRecords(h.recorder.records);
    expect(h.client.remaining()).toBe(1); // the second reply was never requested
  });

  it("stops when the token budget is used up", async () => {
    const wrong = reply("<<<FILE src/main.mtek\n<<<SEARCH\n        speed = 1;\n===\n        speed = 2;\n>>>REPLACE\n", { usage: usage(900, 200) });
    const h = harness([wrong, reply(GOOD_EDIT)]);
    const result = await h.run({ maxTotalTokens: 1000 });
    expect(result).toMatchObject({ outcome: "failure", reason: "budget-total-tokens", calls: 1 });
    expect(ofType(h.recorder.records, "model-call")[1]).toMatchObject({ generation: "budget-exceeded", budget: "total-tokens" });
  });

  it("refuses to enforce a token budget on a provider that reports no usage", async () => {
    const unknown = reply("<<<FILE src/main.mtek\n<<<SEARCH\n        speed = 1;\n===\n        speed = 2;\n>>>REPLACE\n", { usage: { inputTokens: null, outputTokens: null } });
    const h = harness([unknown]);
    const result = await h.run({ maxTotalTokens: 5000 });
    expect(result).toMatchObject({ outcome: "error", reason: "tool-error" });
    expect(result.message).toContain("cannot be enforced");
  });

  it("sums usage across calls and keeps unknown usage unknown instead of zero", async () => {
    const bad = reply("<<<FILE src/main.mtek\n<<<SEARCH\n        speed = 1;\n===\n        speed = TYPE_ERROR;\n>>>REPLACE\n", { usage: usage(100, 10) });
    const h = harness([bad, reply(FIX_EDIT, { usage: usage(200, 20) })]);
    const result = await h.run();
    expect(result.usage).toMatchObject({ inputTokens: 300, outputTokens: 30 });
    expect(ofType(h.recorder.records, "trial-end")[0]?.["totals"]).toEqual({ inputTokens: 300, outputTokens: 30, cachedInputTokens: 0 });

    const partial = harness([reply(TYPE_ERROR_EDIT, { usage: usage(100, 10) }), reply(FIX_EDIT, { usage: { inputTokens: null, outputTokens: 5 } })]);
    const sum = await partial.run();
    expect(sum.usage.inputTokens).toBeNull();
    expect(sum.usage.outputTokens).toBe(15);
  });
});

describe("generation outcomes other than completed are failures, never repaired", () => {
  it("a truncated generation fails the trial even when the partial output parses and would pass", async () => {
    // The reply is a complete, valid, correct edit; the model stopped because it hit max tokens.
    const h = harness([reply(GOOD_EDIT, { finish: "length" }), reply(GOOD_EDIT)]);
    const result = await h.run();
    expect(result).toMatchObject({ outcome: "failure", reason: "generation-truncated", calls: 1, repairsUsed: 0, firstAttempt: null });
    const records = h.recorder.records;
    expectValidRecords(records);
    expect(ofType(records, "model-call")[0]).toMatchObject({ generation: "truncated", finish: "length" });
    // nothing was applied or validated and no repair was asked for
    expect(ofType(records, "edit")).toHaveLength(0);
    expect(ofType(records, "validation")).toHaveLength(0);
    expect(h.client.remaining()).toBe(1);
    expect(h.fake.commandsRun().filter((c) => c === "build" || c === "test")).toEqual([]);
    // the project is the untouched starter
    expect(readFileSync(join(h.runDir, "trials", result.trialId, "project", "src", "main.mtek"), "utf8")).toContain("speed = 1;");
  });

  it("a truncated repair fails the trial too", async () => {
    const h = harness([reply(TYPE_ERROR_EDIT), reply(FIX_EDIT, { finish: "length" })]);
    const result = await h.run();
    expect(result).toMatchObject({ outcome: "failure", reason: "generation-truncated", calls: 2, repairsUsed: 1 });
    expect(result.final?.verdict).toBe("fail");
  });

  it.each([
    ["refusal", "refused", "generation-refused"],
    ["cancelled", "cancelled", "generation-cancelled"],
    ["error", "backend-error", "generation-error"],
  ] as const)("finish %s is recorded as %s and ends the trial (%s)", async (finish, generation, reason) => {
    const h = harness([reply(GOOD_EDIT, { finish, error: "because" })]);
    const result = await h.run();
    expect(result).toMatchObject({ outcome: "failure", reason, message: "because" });
    expect(ofType(h.recorder.records, "model-call")[0]).toMatchObject({ generation, finish, error: "because" });
    expect(ofType(h.recorder.records, "edit")).toHaveLength(0);
  });

  it("a client that throws is a backend error", async () => {
    const h = harness([]);
    const throwing: ModelClient = { ...h.client, generate: () => Promise.reject(new Error("socket hang up")) };
    const result = await h.run({ client: throwing });
    expect(result).toMatchObject({ outcome: "failure", reason: "generation-error", message: "socket hang up" });
  });

  it("an exhausted or mismatching replay transcript is a backend error, not a silent pass", async () => {
    const empty = await harness([]).run();
    expect(empty).toMatchObject({ outcome: "failure", reason: "generation-error" });
    expect(empty.message).toContain("exhausted");

    const h = harness([]);
    const mismatched = createReplayClient([{ ...reply(GOOD_EDIT), promptHash: "0".repeat(64) }]);
    const result = await h.run({ client: mismatched });
    expect(result.message).toContain("replay mismatch");
  });
});

describe("NOT-RUN is not success", () => {
  it("a machine without a GPU ends the trial not-run and never success", async () => {
    const h = harness([reply(GOOD_EDIT), reply(GOOD_EDIT)], { fake: { gpu: false } });
    const result = await h.run();
    expect(result).toMatchObject({ outcome: "not-run", reason: "validation-not-run", calls: 1 });
    expect(result.message).toContain("no WebGPU adapter");
    const validation = ofType(h.recorder.records, "validation")[0] as Rec;
    expect(validation["verdict"]).toBe("not-run");
    const layers = validation["layers"] as Record<string, { outcome: string; notRun: string | null }>;
    expect([layers["parse"]?.outcome, layers["check"]?.outcome, layers["build"]?.outcome]).toEqual(["pass", "pass", "pass"]);
    expect(layers["start"]).toMatchObject({ outcome: "not-run", notRun: "environment" });
    expect(layers["tests"]).toMatchObject({ outcome: "not-run", notRun: "environment" });
    expectValidRecords(h.recorder.records);
    expect(h.client.remaining()).toBe(1); // no repair was attempted: there was nothing to repair
  });
});

describe("tool failures are not model failures", () => {
  it("a crashing compiler ends the trial with outcome error", async () => {
    const h = harness([reply(GOOD_EDIT)], { fake: { crash: "check" } });
    const result = await h.run();
    expect(result).toMatchObject({ outcome: "error", reason: "tool-error" });
    expect(result.message).toContain("mtek check exited with 3");
    expect(ofType(h.recorder.records, "validation")[0]).toMatchObject({ verdict: "error" });
  });

  it("a failing context export ends the trial before the first model call", async () => {
    const h = harness([reply(GOOD_EDIT)], { fake: { crash: "context" } });
    const result = await h.run();
    expect(result).toMatchObject({ outcome: "error", reason: "tool-error", calls: 0 });
    expect(h.client.requests).toHaveLength(0);
    expectValidRecords(h.recorder.records);
  });

  it("an invalid task fixture is a tool error", async () => {
    const h = harness([reply(GOOD_EDIT)], { fake: { behaviour: () => "invalid-fixture" } });
    const result = await h.run();
    expect(result).toMatchObject({ outcome: "error", reason: "tool-error" });
    expect(result.message).toContain("invalid");
  });

  it("a runtime bundle missing from the compiler (E9030) is a tool error, not a failed build", async () => {
    const noRuntime = "<<<FILE src/main.mtek\n<<<SEARCH\n        speed = 1;\n===\n        speed = NO_RUNTIME;\n>>>REPLACE\n";
    const result = await harness([reply(noRuntime)]).run();
    expect(result).toMatchObject({ outcome: "error" });
    expect(result.message).toContain("MTEK-E9030");
  });

  it("a program that does not start fails the start layer and skips the tests layer", async () => {
    const h = harness([reply(GOOD_EDIT)], { fake: { behaviour: () => "mount-fail" } });
    const result = await h.run({ maxRepairs: 0 });
    expect(result.final?.layers.start.outcome).toBe("fail");
    expect(result.final?.layers.tests).toMatchObject({ outcome: "not-run", notRun: "skipped" });
    expect(result.outcome).toBe("failure");
  });
});

describe("constrained and unconstrained trials are separate kinds", () => {
  it("a constrained trial without the capability ends 'unavailable' with the exact message and never runs unconstrained", async () => {
    const h = harness([reply(GOOD_EDIT)]);
    const result = await h.run({ trialKind: "constrained" });
    expect(result).toMatchObject({ outcome: "unavailable", reason: "grammar-unavailable", calls: 0 });
    expect(result.message?.startsWith(`${GRAMMAR_UNAVAILABLE_MESSAGE}: `)).toBe(true);
    expect(GRAMMAR_UNAVAILABLE_MESSAGE).toBe("grammar-constrained mode unavailable");
    expect(h.client.requests).toHaveLength(0); // no model call, constrained or not
    expect(h.fake.calls).toHaveLength(0);
    const records = h.recorder.records;
    expectValidRecords(records);
    expect(records.map((r) => r["type"])).toEqual(["trial-start", "trial-end"]);
    expect(records[0]).toMatchObject({ trialKind: "constrained", condition: { trialKind: "constrained" } });
    expect(records[1]).toMatchObject({ outcome: "unavailable", reason: "grammar-unavailable" });
  });

  it("records the two kinds as separate trials and conditions", async () => {
    const a = harness([reply(GOOD_EDIT)]);
    await a.run();
    const b = harness([reply(GOOD_EDIT)]);
    await b.run({ trialKind: "constrained" });
    const startA = ofType(a.recorder.records, "trial-start")[0] as Rec;
    const startB = ofType(b.recorder.records, "trial-start")[0] as Rec;
    expect(startA["trialKind"]).toBe("unconstrained");
    expect(startB["trialKind"]).toBe("constrained");
    expect(startA["conditionId"]).not.toBe(startB["conditionId"]);
    expect(startA["trialId"]).not.toBe(startB["trialId"]);
  });

  it("runs a constrained trial when a capability check supplies the grammar, sending it with every request", async () => {
    const capability: GrammarCapability = {
      check: () => Promise.resolve({ available: true, grammar: "root ::= module", backend: "fake-backend 1.0", replyFormat: "edit-blocks" }),
    };
    const h = harness([reply(TYPE_ERROR_EDIT), reply(FIX_EDIT)], { acceptGrammar: true, deps: { grammar: capability } });
    const result = await h.run({ trialKind: "constrained" });
    expect(result.outcome).toBe("success");
    expect(h.client.requests.map((r) => r.grammar)).toEqual(["root ::= module", "root ::= module"]);
    const start = ofType(h.recorder.records, "trial-start")[0] as Rec;
    expect(start["grammar"]).toEqual({ backend: "fake-backend 1.0", replyFormat: "edit-blocks" });
    const call = ofType(h.recorder.records, "model-call")[0] as Rec;
    expect((call["request"] as Rec)["grammarSha256"]).toMatch(/^[0-9a-f]{64}$/);
    expectValidRecords(h.recorder.records);
  });

  it("a capability that is available but a client that cannot forward grammars is unavailable too", async () => {
    const capability: GrammarCapability = {
      check: () => Promise.resolve({ available: true, grammar: "root ::= x", backend: "b", replyFormat: "edit-blocks" }),
    };
    const h = harness([reply(GOOD_EDIT)], { acceptGrammar: false, deps: { grammar: capability } });
    const result = await h.run({ trialKind: "constrained" });
    expect(result).toMatchObject({ outcome: "unavailable" });
    expect(result.message).toContain("does not forward grammars");
    expect(h.client.requests).toHaveLength(0);
  });

  it("a constrained trial with a module reply format applies the reply as the whole entry file", async () => {
    const capability: GrammarCapability = {
      check: () => Promise.resolve({ available: true, grammar: "root ::= module", backend: "b", replyFormat: "module" }),
    };
    const module = "scene Demo {\n    entity Cube {\n        speed = -speed;\n    }\n    entity Marker {\n    }\n}\n";
    const h = harness([reply(module)], { acceptGrammar: true, deps: { grammar: capability } });
    const result = await h.run({ trialKind: "constrained", policy: { isWritable: (p) => p === "src/main.mtek", wholeFile: "any", writableDescription: "the entry" } });
    expect(result.outcome).toBe("success");
    expect(ofType(h.recorder.records, "edit")[0]).toMatchObject({ format: "module", outcome: "applied" });
  });
});

describe("configuration is honest", () => {
  it("refuses a seed that the client cannot apply instead of recording one that was not", async () => {
    const h = harness([reply(GOOD_EDIT)]);
    const noSeed: ModelClient = { ...h.client, capabilities: { grammar: false, seed: false } };
    await expect(h.run({ client: noSeed, seed: 1 })).rejects.toThrow(/cannot apply a seed/);
    expect(h.recorder.lines).toHaveLength(0);
  });

  it("changing any part of the condition changes the condition id", async () => {
    const id = async (config: Parameters<ReturnType<typeof harness>["run"]>[0]): Promise<string> => {
      const h = harness([reply(GOOD_EDIT)]);
      await h.run(config);
      return String(ofType(h.recorder.records, "trial-start")[0]?.["conditionId"]);
    };
    const base = await id({});
    expect(await id({})).toBe(base);
    for (const change of [{ temperature: 0.5 }, { temperature: null }, { stop: ["x"] }, { seed: 3 }, { maxRepairs: 1 }, { testFeedback: "status-only" as const }, { contextMaxBytes: 5000 }, { maxTotalTokens: 99999 }]) {
      expect(await id(change), JSON.stringify(change)).not.toBe(base);
    }
  });

  it("sends no sampling parameter when the temperature is null, and records null", async () => {
    const h = harness([reply(GOOD_EDIT)]);
    await h.run({ temperature: null });
    expect(h.client.requests[0]?.temperature).toBeNull();
    expect((ofType(h.recorder.records, "model-call")[0]?.["request"] as Rec)["temperature"]).toBeNull();
  });

  it("passes an abort signal that fires at the wall-clock budget to every model call", async () => {
    const h = harness([reply(GOOD_EDIT)]);
    const seen: (AbortSignal | undefined)[] = [];
    const spy: ModelClient = {
      ...h.client,
      generate: (request: GenerateRequest, options?: GenerateOptions): Promise<GenerateResult> => {
        seen.push(options?.signal);
        return h.client.generate(request, options);
      },
    };
    await h.run({ client: spy });
    expect(seen[0]).toBeInstanceOf(AbortSignal);
    expect(seen[0]?.aborted).toBe(false);
  });

  it("starts every trial from a fresh copy of the starter and leaves the task's files alone", async () => {
    const h = harness([reply(GOOD_EDIT), reply(GOOD_EDIT)]);
    const first = await h.run({ trialIndex: 0 });
    const second = await h.run({ trialIndex: 1 });
    expect(first.outcome).toBe("success");
    expect(second.outcome).toBe("success"); // the second GOOD_EDIT applied: its search 'speed = 1;' existed again
    const starter = readFileSync(join(editTask().projectDir, "src", "main.mtek"), "utf8");
    expect(starter).toContain("speed = 1;");
  });
});
