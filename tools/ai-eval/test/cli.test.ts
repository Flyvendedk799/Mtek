import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli, type CliIo } from "../src/cli.ts";
import { steppingClock } from "../src/clock.ts";
import { FIX_EDIT, fakeMtek, FIXTURE_TASKS, GOOD_EDIT, tempDir, TYPE_ERROR_EDIT, validateRecord } from "./helpers.ts";

function io(): CliIo & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, out: (t) => stdout.push(t), err: (t) => stderr.push(t) };
}

function transcript(...replies: string[]): string {
  const file = join(tempDir("ai-eval-transcript-"), "t.jsonl");
  writeFileSync(file, replies.map((text) => JSON.stringify({ text, finish: "stop", usage: { inputTokens: 10, outputTokens: 2 } })).join("\n"));
  return file;
}

const task = join(FIXTURE_TASKS, "demo-01");

describe("ai-eval run", () => {
  it("runs trials with the replay client and writes records.jsonl and the final projects", async () => {
    const out = tempDir("ai-eval-out-");
    const sink = io();
    const code = await runCli(
      ["run", "--task", task, "--client", "replay", "--transcript", transcript(TYPE_ERROR_EDIT, FIX_EDIT, GOOD_EDIT), "--trials", "2", "--out", out, "--run-id", "cli-run", "--model", "replay-1"],
      { io: sink, runner: fakeMtek(), clock: steppingClock() },
    );
    expect(code).toBe(0);
    expect(sink.stderr).toEqual([]);
    const lines = readFileSync(join(out, "cli-run", "records.jsonl"), "utf8").trim().split("\n");
    const records = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    for (const record of records) expect(validateRecord(record)).toEqual([]);
    expect(records[0]).toMatchObject({ type: "run-start", runId: "cli-run", seq: 0 });
    const ends = records.filter((r) => r["type"] === "trial-end");
    // trial 0 used the first two replies and repaired; trial 1 found its third reply (GOOD_EDIT) and passed first try
    expect(ends.map((e) => [e["trialId"], e["outcome"], e["repairsUsed"]])).toEqual([
      ["demo-01--unconstrained--00", "success", 1],
      ["demo-01--unconstrained--01", "success", 0],
    ]);
    expect(records.find((r) => r["type"] === "trial-start")).toMatchObject({ condition: { model: "replay-1", temperature: 0, provider: "replay" } });
    expect(readFileSync(join(out, "cli-run", "trials", "demo-01--unconstrained--00", "project", "src", "main.mtek"), "utf8")).toContain("speed = -speed;");
    expect(sink.stdout.join("")).toContain("demo-01--unconstrained--00: success");
  });

  it("a constrained run says 'grammar-constrained mode unavailable' and writes an unavailable trial", async () => {
    const out = tempDir("ai-eval-out-");
    const sink = io();
    const code = await runCli(
      ["run", "--task", task, "--client", "replay", "--transcript", transcript(GOOD_EDIT), "--trial-kind", "constrained", "--out", out, "--run-id", "c"],
      { io: sink, runner: fakeMtek(), clock: steppingClock() },
    );
    expect(code).toBe(0);
    expect(sink.stdout.join("")).toContain("demo-01--constrained--00: unavailable (grammar-unavailable) - grammar-constrained mode unavailable: ");
    const records = readFileSync(join(out, "c", "records.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(records.map((r) => r["type"])).toEqual(["run-start", "trial-start", "trial-end"]);
    expect(records[2]).toMatchObject({ outcome: "unavailable", calls: 0 });
  });

  it("temperature default sends no sampling parameter", async () => {
    const out = tempDir("ai-eval-out-");
    await runCli(["run", "--task", task, "--client", "replay", "--transcript", transcript(GOOD_EDIT), "--temperature", "default", "--out", out, "--run-id", "t"], {
      io: io(),
      runner: fakeMtek(),
      clock: steppingClock(),
    });
    const start = readFileSync(join(out, "t", "records.jsonl"), "utf8").split("\n").map((l) => (l === "" ? null : (JSON.parse(l) as Record<string, unknown>))).find((r) => r?.["type"] === "trial-start");
    expect(start).toMatchObject({ condition: { temperature: null } });
  });

  it("refuses to overwrite an earlier run", async () => {
    const out = tempDir("ai-eval-out-");
    const args = ["run", "--task", task, "--client", "replay", "--transcript", transcript(GOOD_EDIT), "--out", out, "--run-id", "same"];
    expect(await runCli(args, { io: io(), runner: fakeMtek(), clock: steppingClock() })).toBe(0);
    const sink = io();
    expect(await runCli(args, { io: sink, runner: fakeMtek(), clock: steppingClock() })).toBe(3);
    expect(sink.stderr.join("")).toContain("EEXIST");
  });

  it("a seed on a client that cannot apply it is refused with exit 3", async () => {
    // the anthropic adapter has no seed; --client anthropic needs a key, so inject the key-less failure instead
    const sink = io();
    const code = await runCli(["run", "--task", task, "--client", "anthropic", "--model", "m", "--seed", "1", "--out", tempDir(), "--run-id", "s"], {
      io: sink,
      env: { ANTHROPIC_API_KEY: "k" },
      runner: fakeMtek(),
      clock: steppingClock(),
      fetch: () => Promise.reject(new Error("no network in tests")),
    });
    expect(code).toBe(3);
    expect(sink.stderr.join("")).toContain("cannot apply a seed");
  });
});

describe("ai-eval validate", () => {
  it("prints every layer and exits 1 for a candidate that fails, 0 for one that passes, 4 for not-run", async () => {
    const results: [string[], number, string][] = [];
    for (const [options, expected, verdict] of [
      [{ behaviour: () => "pass" as const }, 0, "pass"],
      [{}, 1, "fail"],
      [{ gpu: false, behaviour: () => "pass" as const }, 4, "not-run"],
    ] as const) {
      const sink = io();
      const code = await runCli(["validate", "--task", task], { io: sink, runner: fakeMtek(options), clock: steppingClock() });
      const doc = JSON.parse(sink.stdout.join("")) as { verdict: string; layers: Record<string, { outcome: string }> };
      expect(Object.keys(doc.layers).sort()).toEqual(["build", "check", "parse", "start", "tests"]);
      results.push([[], code, doc.verdict]);
      expect([code, doc.verdict]).toEqual([expected, verdict]);
    }
    expect(results).toHaveLength(3);
  });

  it("can validate another project of the task, such as a reference solution", async () => {
    const sink = io();
    const solved = join(tempDir("ai-eval-ref-"), "ref");
    const { cpSync } = await import("node:fs");
    cpSync(join(task, "mtek"), solved, { recursive: true });
    writeFileSync(join(solved, "src", "main.mtek"), readFileSync(join(solved, "src", "main.mtek"), "utf8").replace("speed = 1;", "speed = -speed;"));
    const code = await runCli(["validate", "--task", task, "--project", solved], { io: sink, runner: fakeMtek(), clock: steppingClock() });
    expect(code).toBe(0);
    expect(JSON.parse(sink.stdout.join(""))).toMatchObject({ verdict: "pass", project: solved });
  });
});

describe("usage", () => {
  it.each([
    [[], /missing command/],
    [["frobnicate"], /unknown command/],
    [["run"], /--task is required/],
    [["run", "--task", task], /--client is required/],
    [["run", "--task", task, "--client", "replay", "--bogus", "x"], /unknown option --bogus/],
    [["run", "--task", task, "--client", "replay", "--trials", "0"], /--trials must be an integer of at least 1/],
    [["run", "--task", task, "--client", "replay", "--trial-kind", "maybe"], /--trial-kind/],
    [["run", "--task", task, "--client", "replay", "--temperature", "hot"], /--temperature/],
    [["run", "--task", task, "--client", "replay", "--run-id", "../x"], /--run-id/],
    [["run", "--task", task, "--client", "replay", "--model"], /--model needs a value/],
    [["run", "extra"], /unexpected argument/],
  ])("%j is a usage error (exit 2)", async (args, pattern) => {
    const sink = io();
    expect(await runCli(args, { io: sink, runner: fakeMtek(), clock: steppingClock() })).toBe(2);
    expect(sink.stderr.join("")).toMatch(pattern);
    expect(sink.stderr.join("")).toContain("usage:");
  });

  it("an unknown client or a missing transcript is exit 3 with the reason", async () => {
    const sink = io();
    expect(await runCli(["run", "--task", task, "--client", "gpt"], { io: sink, runner: fakeMtek() })).toBe(3);
    expect(sink.stderr.join("")).toContain("unknown adapter 'gpt'");
    const sink2 = io();
    expect(await runCli(["run", "--task", task, "--client", "replay"], { io: sink2, runner: fakeMtek() })).toBe(3);
    expect(sink2.stderr.join("")).toContain("--transcript is required");
  });

  it("without an mtek executable it says how to get one and exits 3", async () => {
    const sink = io();
    const code = await runCli(["validate", "--task", task], { io: sink, env: { MTEK_BIN: join(tempDir(), "nope.exe") } });
    expect(code).toBe(3);
    expect(sink.stderr.join("")).toContain("no mtek executable");
  });

  it("--help prints the usage", async () => {
    const sink = io();
    expect(await runCli(["run", "--help"], { io: sink })).toBe(0);
    expect(sink.stdout.join("")).toContain("usage:");
  });
});
