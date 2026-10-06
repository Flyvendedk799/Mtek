// The M2 exit-gate fixtures (task M2-12, spec/testing.md section 6): Mtek projects under
// `tests/browser/fixtures/m2/<name>/`, each built by global setup with `mtek build --mode test` into
// `.out/m2/<name>/`, plus the test-only post-build corruptions of the `pulse` shader.
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { join } from "node:path";
import { BROWSER_ROOT, REPO_ROOT } from "./environment.ts";
import { runCli } from "./m1-fixtures.ts";

export const M2_FIXTURES_DIR = join(BROWSER_ROOT, "fixtures", "m2");
/** Where built fixtures are served from: `<server>/m2/<name>/index.html`. */
export const M2_OUT_DIR = join(BROWSER_ROOT, ".out", "m2");

/** The blueprint `Pulse` material with a pure `pulse` function. */
export const PULSE = "pulse";
/** The `mixed` layout (f32, vec3, u32, vec2, bool, color) in a real scene. */
export const MIXED_LAYOUT = "mixed_layout";

/** Post-build variant of `pulse` whose WGSL file has a line appended that is not WGSL. */
export const VARIANT_BAD_SHADER = `${PULSE}.bad-shader`;
/** The line appended to the WGSL file of `VARIANT_BAD_SHADER`. */
export const SHADER_CORRUPTION = "this line is not WGSL;\n";
/** Post-build variant of `pulse` in which the call of the built-in `sin` inside `pulse` is misspelled. */
export const VARIANT_BAD_CALL = `${PULSE}.bad-call`;
/** What `VARIANT_BAD_CALL` replaces, and what it puts in its place. */
export const CALL_CORRUPTION = { from: "sin(", to: "sinn(" } as const;

/** The existing compile-time failure fixtures that the M2 gate cites (`tests/semantics/fail/<group>/<name>`). */
export const SEMANTIC_FAIL_DIR = join(REPO_ROOT, "tests", "semantics", "fail");

/** Every fixture directory under `fixtures/m2/`, sorted. */
export function m2FixtureNames(): string[] {
  return readdirSync(M2_FIXTURES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** A built M2 program's manifest, as JSON. */
export function readBuiltM2Manifest(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(M2_OUT_DIR, name, "program.manifest.json"), "utf8")) as Record<string, unknown>;
}

/** The text of `fixtures/m2/<name>/src/main.mtek`. */
export function m2Source(name: string): string {
  return readFileSync(join(M2_FIXTURES_DIR, name, "src", "main.mtek"), "utf8");
}

/**
 * Builds every M2 fixture into `.out/m2/<name>/` with `mtek build --mode test --format json` and derives the
 * failure variants. A fixture that does not build fails the whole run with the CLI's report.
 */
export function buildM2Fixtures(cli: string): void {
  rmSync(M2_OUT_DIR, { recursive: true, force: true });
  for (const name of m2FixtureNames()) {
    const out = join(M2_OUT_DIR, name);
    const run = runCli(cli, ["build", "--mode", "test", "--format", "json", "--out", out, join(M2_FIXTURES_DIR, name)]);
    if (run.status !== 0 || !existsSync(join(out, "index.html"))) {
      throw new Error(`mtek build --mode test of fixtures/m2/${name} failed (exit ${String(run.status)}):\n${run.stdout}${run.stderr}`);
    }
  }
  deriveFailureVariants();
}

function shaderFiles(variant: string): string[] {
  const shaders = (readBuiltM2Manifest(variant)["shaders"] ?? []) as Array<{ url: string }>;
  if (shaders.length === 0) throw new Error(`fixtures/m2/${PULSE} has no shader to corrupt`);
  return shaders.map((shader) => join(M2_OUT_DIR, variant, ...shader.url.split("/")));
}

function deriveFailureVariants(): void {
  const source = join(M2_OUT_DIR, PULSE);

  cpSync(source, join(M2_OUT_DIR, VARIANT_BAD_SHADER), { recursive: true });
  for (const file of shaderFiles(VARIANT_BAD_SHADER)) writeFileSync(file, `${readFileSync(file, "utf8")}${SHADER_CORRUPTION}`);

  cpSync(source, join(M2_OUT_DIR, VARIANT_BAD_CALL), { recursive: true });
  for (const file of shaderFiles(VARIANT_BAD_CALL)) {
    const text = readFileSync(file, "utf8");
    if (!text.includes(CALL_CORRUPTION.from)) throw new Error(`${file} has no ${CALL_CORRUPTION.from} to corrupt`);
    writeFileSync(file, text.replaceAll(CALL_CORRUPTION.from, CALL_CORRUPTION.to));
  }
}
