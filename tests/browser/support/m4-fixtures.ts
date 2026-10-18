// The M4-07 fixtures (culling, renderer counters, development overlay; decision 0055): Mtek projects under
// `tests/browser/fixtures/m4/<name>/`, each built by global setup with `mtek build --mode test` into
// `.out/m4/<name>/` (the development runtime, which has the overlay) and with `mtek build --mode release`
// into `.out/m4-release/<name>/` (the release runtime, which has none).
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { BROWSER_ROOT } from "./environment.ts";
import { runCli } from "./m1-fixtures.ts";

export const M4_FIXTURES_DIR = join(BROWSER_ROOT, "fixtures", "m4");
/** Where the test-mode builds are served from: `<server>/m4/<name>/index.html`. */
export const M4_OUT_DIR = join(BROWSER_ROOT, ".out", "m4");
/** Where the release-mode builds are served from: `<server>/m4-release/<name>/index.html`. */
export const M4_RELEASE_OUT_DIR = join(BROWSER_ROOT, ".out", "m4-release");

/** The frustum culling fixture: nine spheres in a row, a camera moved by the host input `camera_x`. */
export const CULLING = "culling";

/** The M4-08 fixtures (decision 0059): 500 identical boxes (one group), and 17 entities in groups that must stay apart. */
export const INSTANCING_GRID = "instancing_grid";
export const INSTANCING_MIXED = "instancing_mixed";

/** Every fixture directory under `fixtures/m4/`, sorted. */
export function m4FixtureNames(): string[] {
  return readdirSync(M4_FIXTURES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Builds every M4 fixture in both modes; a fixture that does not build fails the whole run with the CLI's report. */
export function buildM4Fixtures(cli: string): void {
  for (const [mode, outDir] of [
    ["test", M4_OUT_DIR],
    ["release", M4_RELEASE_OUT_DIR],
  ] as const) {
    rmSync(outDir, { recursive: true, force: true });
    for (const name of m4FixtureNames()) {
      const out = join(outDir, name);
      const run = runCli(cli, ["build", "--mode", mode, "--format", "json", "--out", out, join(M4_FIXTURES_DIR, name)]);
      if (run.status !== 0 || !existsSync(join(out, "index.html"))) {
        throw new Error(`mtek build --mode ${mode} of fixtures/m4/${name} failed (exit ${String(run.status)}):\n${run.stdout}${run.stderr}`);
      }
    }
  }
}

/** The PBR fixture (M4-03, decision 0057): a unit sphere lit by up to three lights, everything varied through host inputs. */
export const PBR = "pbr";
