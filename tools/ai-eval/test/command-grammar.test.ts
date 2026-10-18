// The real grammar capability (src/command-grammar.ts) against scripted programs: it never reports an
// available constrained mode unless the adapter says so AND the grammar can be exported.
import { describe, expect, it } from "vitest";
import { commandGrammarCapability, type ExecFile, type ExecResult } from "../src/command-grammar.ts";
import { GRAMMAR_UNAVAILABLE_MESSAGE } from "../src/grammar.ts";
import type { ModelClient } from "../src/model-client.ts";

const client = {} as ModelClient;

const AVAILABLE = JSON.stringify({
  status: "available",
  mode: "constrained",
  backend: "llama.cpp",
  release: "b11719",
  model: { id: "Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF", revision: "f86cb2c1" },
});

function script(adapter: ExecResult, exported: ExecResult): { exec: ExecFile; calls: string[][] } {
  const calls: string[][] = [];
  const exec: ExecFile = (file, args) => {
    calls.push([file, ...args]);
    return Promise.resolve(file === "adapter" ? adapter : exported);
  };
  return { exec, calls };
}

const ok = (stdout: string): ExecResult => ({ exitCode: 0, stdout, spawnError: null });

describe("command grammar capability", () => {
  it("is available when the adapter says so and the GBNF exports", async () => {
    const { exec, calls } = script(ok(AVAILABLE), ok('root ::= "scene"\n'));
    const check = await commandGrammarCapability({ adapter: "adapter", mtek: "mtek", exec }).check(client);
    expect(check).toEqual({
      available: true,
      grammar: 'root ::= "scene"\n',
      backend: "llama.cpp b11719 Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF",
      replyFormat: "module",
    });
    expect(calls).toEqual([
      ["adapter", "check", "--format", "json"],
      ["mtek", "grammar", "export", "--format", "gbnf"],
    ]);
  });

  it("passes the install directory on", async () => {
    const { exec, calls } = script(ok(AVAILABLE), ok("root ::= x\n"));
    await commandGrammarCapability({ adapter: "adapter", mtek: "mtek", exec, installDir: "D" }).check(client);
    expect(calls[0]).toEqual(["adapter", "check", "--format", "json", "--install-dir", "D"]);
  });

  it("is unavailable, with the adapter's reason and the exact message, when the adapter says so", async () => {
    const adapter: ExecResult = {
      exitCode: 1,
      stdout: JSON.stringify({ status: "unavailable", message: `${GRAMMAR_UNAVAILABLE_MESSAGE}: no model`, reason: "the model file is missing" }),
      spawnError: null,
    };
    const check = await commandGrammarCapability({ adapter: "adapter", mtek: "mtek", exec: script(adapter, ok("x")).exec }).check(client);
    expect(check).toEqual({ available: false, reason: `${GRAMMAR_UNAVAILABLE_MESSAGE}: the model file is missing` });
  });

  it.each([
    ["the adapter cannot be started", { exitCode: null, stdout: "", spawnError: "ENOENT" } satisfies ExecResult, ok("x"), /could not be run \(ENOENT\)/],
    ["its output is not JSON", ok("not json"), ok("x"), /did not print a JSON report/],
    ["its output is not an object", ok("[1]"), ok("x"), /did not print a JSON report/],
    ["it says available but exits non-zero", { exitCode: 1, stdout: AVAILABLE, spawnError: null } satisfies ExecResult, ok("x"), /exits 1/],
    ["it names no backend", ok(JSON.stringify({ status: "available" })), ok("x"), /names no backend/],
    ["the GBNF cannot be exported", ok(AVAILABLE), { exitCode: 2, stdout: "", spawnError: null } satisfies ExecResult, /could not be exported/],
    ["the exported GBNF is empty", ok(AVAILABLE), ok("  \n"), /could not be exported/],
  ])("is unavailable when %s", async (_name, adapter, exported, reason) => {
    const check = await commandGrammarCapability({ adapter: "adapter", mtek: "mtek", exec: script(adapter, exported).exec }).check(client);
    expect(check.available).toBe(false);
    if (check.available) throw new Error("unreachable");
    expect(check.reason.startsWith(`${GRAMMAR_UNAVAILABLE_MESSAGE}: `)).toBe(true);
    expect(check.reason).toMatch(reason);
  });
});
