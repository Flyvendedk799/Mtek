// The real grammar capability: M6-06's capability check, run as a command (decision 0073) and wired into
// the harness (decision 0077 item 10). This workspace still imports no adapter code: it spawns the
// `grammar-adapter` binary and the `mtek` binary and reads their JSON, so the boundary check holds.
//
// `grammar-adapter check --format json` answers `{ status: "available", backend, release, model, ... }`
// (exit 0) or `{ status: "unavailable", message, reason }` (exit 1). When it is available the GBNF text comes
// from `mtek grammar export --format gbnf`. Anything else (no binary, no JSON, a failing export) is
// `unavailable` with the reason: a constrained trial is never run unconstrained instead.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { repoRoot } from "./commands.ts";
import { GRAMMAR_UNAVAILABLE_MESSAGE, type GrammarCapability, type GrammarCheck } from "./grammar.ts";

export interface ExecResult {
  /** Null when the process did not exit normally. */
  exitCode: number | null;
  stdout: string;
  /** Why the process could not be started or finished, or null. */
  spawnError: string | null;
}

/** Runs a program to completion; the seam the unit tests replace. */
export type ExecFile = (file: string, args: readonly string[], timeoutMs: number) => Promise<ExecResult>;

export const execFileDefault: ExecFile = (file, args, timeoutMs) =>
  new Promise((resolveResult) => {
    execFile(file, [...args], { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error === null) {
        resolveResult({ exitCode: 0, stdout, spawnError: null });
        return;
      }
      const code = (error as NodeJS.ErrnoException & { code?: number | string }).code;
      resolveResult(
        typeof code === "number"
          ? { exitCode: code, stdout, spawnError: null }
          : { exitCode: null, stdout, spawnError: error.message },
      );
    });
  });

export interface CommandGrammarOptions {
  /** The `grammar-adapter` binary (`target/debug/grammar-adapter`). */
  adapter: string;
  /** The `mtek` binary that exports the GBNF grammar. */
  mtek: string;
  exec?: ExecFile;
  /** An install directory of the pinned backend other than the default (`--install-dir` of the adapter). */
  installDir?: string;
}

/** The `grammar-adapter` executable of this repository's build, or null when it was not built. */
export function findGrammarAdapter(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const named = env["MTEK_GRAMMAR_ADAPTER"];
  if (named !== undefined && named !== "") return existsSync(named) ? resolve(named) : null;
  const exe = process.platform === "win32" ? "grammar-adapter.exe" : "grammar-adapter";
  for (const profile of ["debug", "release"]) {
    const candidate = resolve(repoRoot(), "target", profile, exe);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function unavailable(reason: string): GrammarCheck {
  return { available: false, reason: `${GRAMMAR_UNAVAILABLE_MESSAGE}: ${reason}` };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function commandGrammarCapability(options: CommandGrammarOptions): GrammarCapability {
  const exec = options.exec ?? execFileDefault;
  return {
    async check(): Promise<GrammarCheck> {
      const args = ["check", "--format", "json", ...(options.installDir === undefined ? [] : ["--install-dir", options.installDir])];
      const checked = await exec(options.adapter, args, 120_000);
      if (checked.spawnError !== null) return unavailable(`the grammar adapter could not be run (${checked.spawnError})`);
      let answer: Record<string, unknown> | null;
      try {
        answer = record(JSON.parse(checked.stdout));
      } catch {
        return unavailable("the grammar adapter did not print a JSON report");
      }
      if (answer === null) return unavailable("the grammar adapter did not print a JSON report");
      if (answer["status"] !== "available") {
        return unavailable(text(answer["reason"]) ?? text(answer["message"]) ?? "the grammar adapter reports it is unavailable");
      }
      if (checked.exitCode !== 0) return unavailable(`the grammar adapter says available but exits ${String(checked.exitCode)}`);
      const model = record(answer["model"]);
      const backend = [text(answer["backend"]), text(answer["release"]), model === null ? null : text(model["id"])].filter(
        (part): part is string => part !== null,
      );
      if (backend.length === 0) return unavailable("the grammar adapter's report names no backend");
      const exported = await exec(options.mtek, ["grammar", "export", "--format", "gbnf"], 60_000);
      if (exported.spawnError !== null || exported.exitCode !== 0 || exported.stdout.trim().length === 0) {
        return unavailable("the GBNF grammar could not be exported with `mtek grammar export --format gbnf`");
      }
      return { available: true, grammar: exported.stdout, backend: backend.join(" "), replyFormat: "module" };
    },
  };
}
