// Running the compiler. The matrix is derived from what `mtek` and `coverage-uses` print, so the tool
// needs the real binaries: `mtek` (built by `npm run build`, or named by `MTEK_BIN`) and the helper
// `coverage-uses` (built here with cargo when it is missing, or named by `MTEK_COVERAGE_USES`).
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";

/** The repository root, from the location of this file (`tools/coverage-matrix/src`). */
export function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type Runner = (command: string, args: readonly string[], options?: { cwd?: string; input?: string }) => Promise<RunResult>;

/** Run a process to the end; never throws. */
export const run: Runner = (command, args, options = {}) =>
  new Promise((resolveResult) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const child = spawn(command, [...args], {
      cwd: options.cwd ?? repoRoot(),
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      resolveResult({ code: null, stdout: "", stderr: error.message });
    });
    child.on("close", (code) => {
      resolveResult({ code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
    if (options.input !== undefined && child.stdin !== null) {
      child.stdin.on("error", () => undefined);
      child.stdin.end(options.input);
    }
  });

function exeName(name: string): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

/** The `mtek` executable: `MTEK_BIN`, else the debug or release build of this repository. Null when there is none. */
export function findMtek(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const named = env["MTEK_BIN"];
  if (named !== undefined && named !== "") return existsSync(named) ? resolve(named) : null;
  for (const profile of ["debug", "release"]) {
    const candidate = resolve(repoRoot(), "target", profile, exeName("mtek"));
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * The `coverage-uses` helper: `MTEK_COVERAGE_USES`, else the one cargo builds for this repository
 * (a no-op when it is current). Null when it cannot be had.
 */
export function findUses(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const named = env["MTEK_COVERAGE_USES"];
  if (named !== undefined && named !== "") return existsSync(named) ? resolve(named) : null;
  const built = spawnSync("cargo", ["build", "-p", "mtek-coverage-uses", "--locked", "--quiet"], {
    cwd: repoRoot(),
    stdio: ["ignore", "ignore", "inherit"],
    windowsHide: true,
  });
  if (built.status !== 0) return null;
  const candidate = resolve(repoRoot(), "target", "debug", exeName("coverage-uses"));
  return existsSync(candidate) ? candidate : null;
}

/** Map `items` with at most `limit` calls in flight, keeping the order of the results. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T, index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/** How many compiler processes to run at once. */
export function concurrency(): number {
  return Math.max(2, Math.min(8, cpus().length));
}
