// Running the `mtek` command line. Every validation layer is a fresh process (`mtek check`, `mtek
// build`, `mtek test`, `mtek context`), so nothing carries over from one candidate to the next: in
// particular `mtek test` starts a fresh browser context for every fixture of every run
// (decision 0074; spec/ai-and-benchmarks.md section 5).
//
// `CommandRunner` is the seam the unit tests replace with a scripted fake.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface CommandSpec {
  /** Arguments of `mtek`, e.g. `["check", "--format", "json", "."]`. */
  args: readonly string[];
  /** Working directory (the candidate's project directory). */
  cwd: string;
  timeoutMs: number;
  /** Added to the environment of the process. */
  env?: Readonly<Record<string, string>>;
}

export interface CommandResult {
  /** Null when the process did not exit normally (spawn failure, killed on timeout). */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Why the process could not be started, or null. */
  spawnError: string | null;
}

export interface CommandRunner {
  run(spec: CommandSpec): Promise<CommandResult>;
}

/** The repository root, from the location of this file (`tools/ai-eval/src`). */
export function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

/** The `mtek` executable: `MTEK_BIN`, else the debug or release build of this repository. Null when there is none. */
export function findMtek(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const named = env["MTEK_BIN"];
  if (named !== undefined && named !== "") return existsSync(named) ? resolve(named) : null;
  const exe = process.platform === "win32" ? "mtek.exe" : "mtek";
  for (const profile of ["debug", "release"]) {
    const candidate = resolve(repoRoot(), "target", profile, exe);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function killTree(pid: number | undefined, child: { kill: (signal: NodeJS.Signals) => boolean }): void {
  if (process.platform === "win32" && pid !== undefined) {
    // The tree of this one process only (`mtek test` starts Node and a browser); never by image name.
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGKILL");
  }
}

/** A runner that executes the real `mtek` binary. */
export function createMtekRunner(mtekPath: string): CommandRunner {
  return {
    run(spec: CommandSpec): Promise<CommandResult> {
      return new Promise((resolveResult) => {
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let timedOut = false;
        let settled = false;
        const finish = (result: CommandResult): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolveResult(result);
        };
        const child = spawn(mtekPath, [...spec.args], {
          cwd: spec.cwd,
          env: { ...process.env, ...spec.env },
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        const timer = setTimeout(() => {
          timedOut = true;
          killTree(child.pid, child);
        }, spec.timeoutMs);
        child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
        child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
        child.on("error", (error) => {
          finish({ exitCode: null, stdout: "", stderr: "", timedOut: false, spawnError: error.message });
        });
        child.on("close", (code) => {
          finish({
            exitCode: timedOut ? null : code,
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat(stderr).toString("utf8"),
            timedOut,
            spawnError: null,
          });
        });
      });
    },
  };
}
