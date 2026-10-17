// The texture sampling fixture of task M4-04 (spec/testing.md section 6): `fixtures/m4/texture_sampling` built by
// global setup with `mtek build --mode test` into `.out/m4/texture_sampling/`, served as
// `<server>/m4/texture_sampling/index.html`.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BROWSER_ROOT } from "./environment.ts";
import { runCli } from "./m1-fixtures.ts";

export const TEXTURE_SAMPLING = "texture_sampling";
export const TEXTURE_SAMPLING_DIR = join(BROWSER_ROOT, "fixtures", "m4", TEXTURE_SAMPLING);
export const TEXTURE_SAMPLING_OUT = join(BROWSER_ROOT, ".out", "m4", TEXTURE_SAMPLING);

/** The text of the fixture's `src/main.mtek`. */
export function textureSamplingSource(): string {
  return readFileSync(join(TEXTURE_SAMPLING_DIR, "src", "main.mtek"), "utf8");
}

/** The built fixture's manifest, as JSON. */
export function readTextureSamplingManifest(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(TEXTURE_SAMPLING_OUT, "program.manifest.json"), "utf8")) as Record<string, unknown>;
}

/** Builds the fixture; a fixture that does not build fails the whole run with the CLI's report. */
export function buildTextureSamplingFixture(cli: string): void {
  const run = runCli(cli, ["build", "--mode", "test", "--format", "json", "--out", TEXTURE_SAMPLING_OUT, TEXTURE_SAMPLING_DIR]);
  if (run.status !== 0 || !existsSync(join(TEXTURE_SAMPLING_OUT, "index.html"))) {
    throw new Error(`mtek build --mode test of fixtures/m4/${TEXTURE_SAMPLING} failed (exit ${String(run.status)}):\n${run.stdout}${run.stderr}`);
  }
}
