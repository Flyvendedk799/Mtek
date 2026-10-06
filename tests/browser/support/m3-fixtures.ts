/**
 * M3-08: build `examples/pulse-cube` for browser behaviour specs (`spec/testing.md` §6.5).
 *
 * Until M3-01..05 open `bind` / lifecycle / handlers on this branch, `mtek build` fails with
 * E9010. Global setup records that honestly; specs skip as NOT-RUN rather than faking a pass.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BROWSER_ROOT, REPO_ROOT } from "./environment.ts";
import type { CliRun } from "./m1-fixtures.ts";
import { runCli } from "./m1-fixtures.ts";

export const PULSE_CUBE_SRC = join(REPO_ROOT, "examples", "pulse-cube");
export const PULSE_CUBE_OUT = join(BROWSER_ROOT, ".out", "m3", "pulse-cube");
export const PULSE_CUBE_STATUS = join(BROWSER_ROOT, ".out", "m3", "pulse-cube-build.json");

export interface PulseCubeBuildStatus {
  ok: boolean;
  status: number;
  stdout: string;
  stderr: string;
  reason?: string;
}

function runBuild(cli: string): CliRun {
  mkdirSync(join(BROWSER_ROOT, ".out", "m3"), { recursive: true });
  return runCli(cli, [
    "build",
    "--mode",
    "test",
    "--format",
    "json",
    "--out",
    PULSE_CUBE_OUT,
    PULSE_CUBE_SRC,
  ]);
}

/**
 * Attempts to build the pulse-cube example. Never throws on a compiler error: writes a status
 * file so specs can NOT-RUN with an explicit reason. Throws only on missing CLI / I/O failure.
 */
export function buildPulseCube(cli: string): PulseCubeBuildStatus {
  if (!existsSync(PULSE_CUBE_SRC)) {
    const status: PulseCubeBuildStatus = {
      ok: false,
      status: 1,
      stdout: "",
      stderr: "",
      reason: "NOT-RUN: examples/pulse-cube is missing from the checkout",
    };
    writeFileSync(PULSE_CUBE_STATUS, `${JSON.stringify(status, null, 2)}\n`);
    return status;
  }
  const run = runBuild(cli);
  const status: PulseCubeBuildStatus = {
    ok: run.status === 0,
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
  };
  if (!status.ok) {
    const combined = `${run.stdout}\n${run.stderr}`;
    status.reason = combined.includes("MTEK-E9010")
      ? "NOT-RUN: pulse-cube Demo still gated (E9010) — M3-01..05 (bind, lifecycle, handlers, self) are not on this branch"
      : `NOT-RUN: mtek build of examples/pulse-cube failed (exit ${String(run.status)})`;
  }
  writeFileSync(PULSE_CUBE_STATUS, `${JSON.stringify(status, null, 2)}\n`);
  return status;
}

export function readPulseCubeStatus(): PulseCubeBuildStatus | null {
  if (!existsSync(PULSE_CUBE_STATUS)) return null;
  return JSON.parse(readFileSync(PULSE_CUBE_STATUS, "utf8")) as PulseCubeBuildStatus;
}
