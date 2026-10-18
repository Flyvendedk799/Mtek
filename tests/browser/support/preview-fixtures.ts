// The M6-10 fixtures (untrusted previews, decision 0075): Mtek projects under `tests/browser/fixtures/preview/<name>/`,
// built by global setup with `mtek build --mode preview` into `.out/preview/<name>/`, a few of them also in release mode
// (`<name>.release`) as the control that shows what the preview mode prevents, and the M5 physics fixture
// (`fixtures/m5/physics_drop`) built as a preview, so the policy page is exercised with the physics module.
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { BROWSER_ROOT } from "./environment.ts";
import { runCli } from "./m1-fixtures.ts";
import { M5_FIXTURES_DIR, PHYSICS_DROP } from "./m5-fixtures.ts";

export const PREVIEW_FIXTURES_DIR = join(BROWSER_ROOT, "fixtures", "preview");
/** Where the builds are served from: `<server>/preview/<name>/index.html`. */
export const PREVIEW_OUT_DIR = join(BROWSER_ROOT, ".out", "preview");

/** `update` that, from the sixth frame on, runs two nested loops of 2^31 - 1 iterations: for ever. */
export const RUNAWAY_UPDATE = "runaway_update";
/** The same program with `--loop-budget 12345`. */
export const RUNAWAY_UPDATE_SMALL = "runaway_update.budget-12345";
/** The loop budget of {@link RUNAWAY_UPDATE_SMALL}. */
export const SMALL_BUDGET = 12345;
/** A state initialiser whose function loops for ever: the mount must fail instead of hanging. */
export const RUNAWAY_INIT = "runaway_init";
/** 200 000 iterations of an f32 loop per frame, far below the budget: what the checks cost. */
export const LOOP_COST = "loop_cost";
/** The M5 physics fixture, built as a preview. */
export const PREVIEW_PHYSICS = PHYSICS_DROP;

/** The name under which the release build of `name` is served. */
export const releaseOf = (name: string): string => `${name}.release`;

/** The default loop budget of a preview build (`spec/ai-and-benchmarks.md` section 5). */
export const DEFAULT_LOOP_BUDGET = 10_000_000;

/** Every fixture directory under `fixtures/preview/`, sorted. */
export function previewFixtureNames(): string[] {
  return readdirSync(PREVIEW_FIXTURES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function build(cli: string, args: string[], source: string, out: string): void {
  const run = runCli(cli, ["build", ...args, "--format", "json", "--out", out, source]);
  if (run.status !== 0 || !existsSync(join(out, "index.html"))) {
    throw new Error(`mtek build ${args.join(" ")} of ${source} failed (exit ${String(run.status)}):\n${run.stdout}${run.stderr}`);
  }
}

/** Builds every preview fixture (and the controls); a fixture that does not build fails the whole run with the CLI's report. */
export function buildPreviewFixtures(cli: string): void {
  rmSync(PREVIEW_OUT_DIR, { recursive: true, force: true });
  for (const name of previewFixtureNames()) {
    const source = join(PREVIEW_FIXTURES_DIR, name);
    build(cli, ["--mode", "preview"], source, join(PREVIEW_OUT_DIR, name));
  }
  const runaway = join(PREVIEW_FIXTURES_DIR, RUNAWAY_UPDATE);
  build(cli, ["--mode", "preview", "--loop-budget", String(SMALL_BUDGET)], runaway, join(PREVIEW_OUT_DIR, RUNAWAY_UPDATE_SMALL));
  for (const name of [RUNAWAY_UPDATE, LOOP_COST]) {
    build(cli, ["--mode", "release"], join(PREVIEW_FIXTURES_DIR, name), join(PREVIEW_OUT_DIR, releaseOf(name)));
  }
  build(cli, ["--mode", "preview"], join(M5_FIXTURES_DIR, PREVIEW_PHYSICS), join(PREVIEW_OUT_DIR, PREVIEW_PHYSICS));
}
