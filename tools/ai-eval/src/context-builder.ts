// The ContextBuilder (spec/ai-and-benchmarks.md section 4.1): runs `mtek context` for the task's
// project and symbols (decision 0072) and hands its text to the prompt. The document is the compiler's
// own statement of what this build supports; the harness adds nothing to it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseToml } from "@mtek/benchmarks/toml-subset";
import { sha256Hex } from "./canonical.ts";
import type { CommandRunner } from "./commands.ts";
import { ToolError } from "./errors.ts";

export interface BuiltContext {
  /** The exact text of the document `mtek context` printed (two-space JSON, one trailing line feed). */
  text: string;
  sha256: string;
  bytes: number;
  compilerVersion: string;
  contextFormat: number;
  /** Sections the compiler dropped to fit `--max-bytes`, as it reports them; null when nothing was dropped. */
  truncated: Record<string, unknown> | null;
}

/** The entry module of a project: `project.entry` of its `mtek.toml`, default `src/main.mtek` (spec/tooling.md section 3). */
export function projectEntry(projectDir: string): string {
  try {
    const toml = parseToml(readFileSync(join(projectDir, "mtek.toml"), "utf8")) as Record<string, unknown>;
    const project = toml["project"];
    if (typeof project === "object" && project !== null && !Array.isArray(project)) {
      const entry = (project as Record<string, unknown>)["entry"];
      if (typeof entry === "string" && entry !== "") return entry;
    }
  } catch {
    // an unreadable or invalid mtek.toml: the compiler reports it; the default names the usual entry
  }
  return "src/main.mtek";
}

export interface ContextOptions {
  projectDir: string;
  symbols: readonly string[];
  maxBytes: number;
  timeoutMs?: number;
}

export class ContextBuilder {
  private readonly runner: CommandRunner;

  constructor(runner: CommandRunner) {
    this.runner = runner;
  }

  async build(options: ContextOptions): Promise<BuiltContext> {
    const args = ["context", "--entry", projectEntry(options.projectDir), "--max-bytes", String(options.maxBytes), "--format", "json"];
    for (const symbol of options.symbols) args.push("--symbol", symbol);
    const result = await this.runner.run({ args, cwd: options.projectDir, timeoutMs: options.timeoutMs ?? 60_000 });
    if (result.spawnError !== null) throw new ToolError(`mtek context could not be started: ${result.spawnError}`);
    if (result.timedOut) throw new ToolError("mtek context timed out");
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() !== "" ? result.stderr.trim() : result.stdout.slice(0, 300);
      throw new ToolError(`mtek context exited with ${String(result.exitCode)}: ${detail}`);
    }
    let value: unknown;
    try {
      value = JSON.parse(result.stdout);
    } catch {
      throw new ToolError("mtek context did not print JSON");
    }
    const record = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    if (record === null || record["contextFormat"] !== 1 || typeof record["compilerVersion"] !== "string") {
      throw new ToolError("mtek context printed a document that is not contextFormat 1 (spec/context.schema.json)");
    }
    const truncated = record["truncated"];
    return {
      text: result.stdout,
      sha256: sha256Hex(result.stdout),
      bytes: Buffer.byteLength(result.stdout, "utf8"),
      compilerVersion: record["compilerVersion"],
      contextFormat: 1,
      truncated: typeof truncated === "object" && truncated !== null && !Array.isArray(truncated) ? (truncated as Record<string, unknown>) : null,
    };
  }
}
