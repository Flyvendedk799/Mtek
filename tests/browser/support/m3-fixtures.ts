/**
 * M3-08: build `examples/pulse-cube` for browser behaviour specs (`spec/testing.md` §6.5).
 *
 * A build failure is recorded in a status file and the specs skip as NOT-RUN with the reason rather
 * than faking a pass. Source variants of the Demo (a colour edit, an added entity) are built beside
 * it so the reload specs exercise the real compiler output (`buildPulseCubeVariants`).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/** Source edits of the Demo that the reload specs load as reload candidates. */
export const PULSE_CUBE_VARIANTS = {
  /** The tint stops following `bind(tint)`: a colour edit of the existing material (same shader, same pipeline). */
  colour: (source: string): string => source.replace("tint: bind(tint);", "tint: #f04f72;"),
  /** A second entity: a structural change that forces a restart (W8070). */
  extra: (source: string): string =>
    source.replace(
      "    on key_down(Key.Space) {",
      `    entity Extra {
        mesh: Box { size: vec3(0.5, 0.5, 0.5) };
        material: Pulse { tint: #ffffff; };
        position: vec3(2.0, 0.5, 0.0);
    }

    on key_down(Key.Space) {`,
    ),
} as const;

export type PulseCubeVariant = keyof typeof PULSE_CUBE_VARIANTS;

export function pulseCubeVariantOut(name: PulseCubeVariant): string {
  return join(BROWSER_ROOT, ".out", "m3", `pulse-cube-${name}`);
}

/** Builds each variant into `.out/m3/pulse-cube-<name>/`; a variant that does not build fails the setup loudly. */
export function buildPulseCubeVariants(cli: string): void {
  if (!existsSync(PULSE_CUBE_SRC)) return;
  for (const name of Object.keys(PULSE_CUBE_VARIANTS) as PulseCubeVariant[]) {
    const src = join(BROWSER_ROOT, ".out", "m3", "variant-src", name);
    rmSync(src, { recursive: true, force: true });
    cpSync(PULSE_CUBE_SRC, src, { recursive: true, filter: (path) => !path.endsWith("dist") });
    const mainPath = join(src, "src", "main.mtek");
    const original = readFileSync(mainPath, "utf8");
    const edited = PULSE_CUBE_VARIANTS[name](original);
    if (edited === original) throw new Error(`pulse-cube variant '${name}' did not change the source`);
    writeFileSync(mainPath, edited);
    const out = pulseCubeVariantOut(name);
    rmSync(out, { recursive: true, force: true });
    const run = runCli(cli, ["build", "--mode", "test", "--format", "json", "--out", out, src]);
    if (run.status !== 0) {
      throw new Error(`pulse-cube variant '${name}' failed to build (exit ${String(run.status)}):
${run.stdout}
${run.stderr}`);
    }
  }
}
