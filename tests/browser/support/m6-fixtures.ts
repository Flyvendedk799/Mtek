// The M6 fixtures: Mtek projects under `tests/browser/fixtures/m6/<name>/`, built by global setup with
// `mtek build --mode test` into `.out/m6/<name>/`.
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { BROWSER_ROOT } from "./environment.ts";
import { runCli } from "./m1-fixtures.ts";

export const M6_FIXTURES_DIR = join(BROWSER_ROOT, "fixtures", "m6");
/** Where built fixtures are served from: `<server>/m6/<name>/index.html`. */
export const M6_OUT_DIR = join(BROWSER_ROOT, ".out", "m6");

/** The params of the built-in `Unlit` and `Pbr` assigned by name from key handlers and read back (decision 0087). */
export const BUILTIN_PARAMS = "builtin_params";

/** Every fixture directory under `fixtures/m6/`, sorted. */
export function m6FixtureNames(): string[] {
  return readdirSync(M6_FIXTURES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Builds every M6 fixture; a fixture that does not build fails the whole run with the CLI's report. */
export function buildM6Fixtures(cli: string): void {
  rmSync(M6_OUT_DIR, { recursive: true, force: true });
  for (const name of m6FixtureNames()) {
    const out = join(M6_OUT_DIR, name);
    const run = runCli(cli, ["build", "--mode", "test", "--format", "json", "--out", out, join(M6_FIXTURES_DIR, name)]);
    if (run.status !== 0 || !existsSync(join(out, "index.html"))) {
      throw new Error(`mtek build --mode test of fixtures/m6/${name} failed (exit ${String(run.status)}):\n${run.stdout}${run.stderr}`);
    }
  }
}
