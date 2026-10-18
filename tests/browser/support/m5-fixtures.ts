// The M5-01 fixture (prefabs, decision 0062): a Mtek project under `tests/browser/fixtures/m5/<name>/`,
// built by global setup with `mtek build --mode test` into `.out/m5/<name>/`.
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { BROWSER_ROOT } from "./environment.ts";
import { runCli } from "./m1-fixtures.ts";

export const M5_FIXTURES_DIR = join(BROWSER_ROOT, "fixtures", "m5");
/** Where built fixtures are served from: `<server>/m5/<name>/index.html`. */
export const M5_OUT_DIR = join(BROWSER_ROOT, ".out", "m5");

/** Three instances of one prefab with their own params, and an instance whose position is bound to the clock. */
export const PREFAB_INSTANCES = "prefab_instances";

/** Spawned and destroyed blocks in a ring of eight slots under an orthographic camera (M5-02, decision 0064). */
export const SPAWN_RING = "spawn_ring";

/** Every fixture directory under `fixtures/m5/`, sorted. */
export function m5FixtureNames(): string[] {
  return readdirSync(M5_FIXTURES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Builds every M5 fixture; a fixture that does not build fails the whole run with the CLI's report. */
export function buildM5Fixtures(cli: string): void {
  rmSync(M5_OUT_DIR, { recursive: true, force: true });
  for (const name of m5FixtureNames()) {
    const out = join(M5_OUT_DIR, name);
    const run = runCli(cli, ["build", "--mode", "test", "--format", "json", "--out", out, join(M5_FIXTURES_DIR, name)]);
    if (run.status !== 0 || !existsSync(join(out, "index.html"))) {
      throw new Error(`mtek build --mode test of fixtures/m5/${name} failed (exit ${String(run.status)}):\n${run.stdout}${run.stderr}`);
    }
  }
}
