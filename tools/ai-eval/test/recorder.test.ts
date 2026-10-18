import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../src/canonical.ts";
import { steppingClock } from "../src/clock.ts";
import { JsonlRecorder, MemoryRecorder, RECORDS_FILE, recordLine, type RecordBody } from "../src/recorder.ts";
import {
  DELETE_CUBE_EDIT,
  FIX_EDIT,
  GOOD_EDIT,
  harness,
  reply,
  TYPE_ERROR_EDIT,
  tempDir,
  validateRecord,
} from "./helpers.ts";

/** A run that writes every kind of record, including a rejected edit, a budget stop and a not-run layer. */
async function richRun() {
  const miss = reply("<<<FILE src/main.mtek\n<<<SEARCH\nnot there\n===\nx\n>>>REPLACE\n");
  const h = harness([miss, reply(TYPE_ERROR_EDIT), reply(DELETE_CUBE_EDIT), reply(FIX_EDIT)], { fake: { behaviour: () => "pass" } });
  h.recorder.record({ type: "run-start", harnessVersion: "0.1.0-test", startedAt: "2026-01-01T00:00:00.000Z" });
  await h.run({ maxRepairs: 3, maxTotalTokens: 1_000_000 });
  return h;
}

describe("the records follow spec/ai-eval-record.schema.json", () => {
  it("every record of a rich run validates, and each type occurs", async () => {
    const h = await richRun();
    const types = new Set(h.recorder.records.map((r) => r["type"]));
    for (const type of ["run-start", "trial-start", "model-call", "edit", "validation", "trial-end"]) expect(types.has(type), type).toBe(true);
    for (const record of h.recorder.records) expect(validateRecord(record), JSON.stringify(record).slice(0, 120)).toEqual([]);
  });

  it("the schema is not vacuous: it rejects a changed record in every way that matters", async () => {
    const h = await richRun();
    const find = (type: string): Record<string, unknown> => structuredClone(h.recorder.records.find((r) => r["type"] === type) as Record<string, unknown>);
    const bad = (mutate: (r: Record<string, unknown>) => void, type: string): string[] => {
      const record = find(type);
      mutate(record);
      return validateRecord(record);
    };
    // every record type is held to the envelope and to its own keys
    for (const type of ["run-start", "trial-start", "model-call", "edit", "validation", "trial-end"]) {
      expect(bad((r) => { r["schemaVersion"] = 2; }, type), `${type}: schemaVersion`).not.toEqual([]);
      expect(bad((r) => { delete r["runId"]; }, type), `${type}: runId`).not.toEqual([]);
      expect(bad((r) => { r["extra"] = 1; }, type), `${type}: unknown key`).not.toEqual([]);
    }
    expect(bad((r) => { r["type"] = "other"; }, "edit")).not.toEqual([]);
    expect(bad((r) => { delete r["layers"]; }, "validation")).not.toEqual([]);
    expect(bad((r) => { (r["layers"] as Record<string, unknown>)["tests"] = { outcome: "maybe", reason: null, notRun: null }; }, "validation")).not.toEqual([]);
    expect(bad((r) => { r["generation"] = "completed"; r["finish"] = "length"; }, "model-call")).not.toEqual([]); // truncated cannot be completed
    expect(bad((r) => { r["outcome"] = "success"; r["reason"] = "max-repairs"; }, "trial-end")).not.toEqual([]);
    expect(bad((r) => { r["conditionId"] = "short"; }, "trial-start")).not.toEqual([]);
    expect(bad((r) => { r["round"] = -1; }, "model-call")).not.toEqual([]);
    expect(bad((r) => { r["outcome"] = "applied"; }, "edit")).not.toEqual([]); // a rejected edit with outcome applied
  });

  it("a passing verdict cannot be recorded with a layer that did not pass", async () => {
    const h = harness([reply(GOOD_EDIT)]);
    await h.run();
    const validation = structuredClone(h.recorder.records.find((r) => r["type"] === "validation") as Record<string, unknown>);
    expect(validateRecord(validation)).toEqual([]);
    ((validation["layers"] as Record<string, unknown>)["start"]) = { outcome: "not-run", reason: "no gpu", notRun: "environment" };
    expect(validateRecord(validation)).not.toEqual([]);
  });

  it("a success needs a passing final verdict", async () => {
    const h = harness([reply(GOOD_EDIT)]);
    await h.run();
    const end = structuredClone(h.recorder.records.find((r) => r["type"] === "trial-end") as Record<string, unknown>);
    expect(validateRecord(end)).toEqual([]);
    (end["final"] as Record<string, unknown>)["verdict"] = "fail";
    expect(validateRecord(end)).not.toEqual([]);
    end["final"] = null;
    expect(validateRecord(end)).not.toEqual([]);
  });
});

describe("determinism", () => {
  it("equal runs under an equal clock write equal bytes", async () => {
    const run = async (): Promise<string> => {
      const h = harness([reply(TYPE_ERROR_EDIT), reply(FIX_EDIT)], { clock: steppingClock() });
      await h.run();
      return h.recorder.text;
    };
    const a = await run();
    expect(a).toBe(await run());
    expect(a.length).toBeGreaterThan(1000);
  });

  it("contains no machine-specific path, scratch location or host name", async () => {
    const h = await richRun();
    const strings: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === "string") strings.push(value);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (typeof value === "object" && value !== null) Object.values(value).forEach(collect);
    };
    h.recorder.records.forEach(collect);
    expect(strings.length).toBeGreaterThan(50);
    for (const text of strings) {
      expect(text).not.toMatch(/\b[A-Za-z]:[\\/]/); // a Windows drive path
      expect(text).not.toContain("ai-eval-scratch");
      expect(text).not.toContain("ai-eval-run");
      expect(text).not.toMatch(/\/Users\/|\/home\//);
    }
  });

  it("writes canonical JSON: sorted keys, no whitespace, one record per line, LF only", async () => {
    const h = await richRun();
    for (const line of h.recorder.lines) {
      expect(line).not.toContain("\n");
      expect(line).toBe(canonicalJson(JSON.parse(line) as never));
    }
    expect(h.recorder.text.endsWith("\n")).toBe(true);
    expect(h.recorder.text).not.toContain("\r");
  });

  it("canonical JSON rejects what JSON cannot say", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson(Infinity)).toThrow();
    expect(canonicalJson({ b: 1, a: [2, { d: null, c: "x" }], u: undefined })).toBe('{"a":[2,{"c":"x","d":null}],"b":1}');
  });

  it("numbers records by sequence", () => {
    const recorder = new MemoryRecorder("r");
    const body: RecordBody = { type: "run-start", harnessVersion: "x", startedAt: "t" };
    recorder.record(body);
    recorder.record(body);
    expect(recorder.records.map((r) => r["seq"])).toEqual([0, 1]);
    expect(recordLine("r", 0, body)).toBe(recorder.lines[0]);
  });
});

describe("JsonlRecorder", () => {
  it("writes records.jsonl and never overwrites an earlier run", () => {
    const dir = join(tempDir(), "run-1");
    const recorder = new JsonlRecorder(dir, "run-1");
    recorder.record({ type: "run-start", harnessVersion: "x", startedAt: "t" });
    recorder.record({ type: "run-start", harnessVersion: "x", startedAt: "u" });
    const lines = readFileSync(join(dir, RECORDS_FILE), "utf8").split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[1] as string)).toMatchObject({ seq: 1, runId: "run-1", startedAt: "u" });
    expect(() => new JsonlRecorder(dir, "run-1")).toThrow(/EEXIST/);
    expect(existsSync(join(dir, RECORDS_FILE))).toBe(true);
  });
});
