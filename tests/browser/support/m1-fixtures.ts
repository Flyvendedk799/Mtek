// The M1 exit-gate fixtures (task M1-21, spec/testing.md section 6.1): Mtek projects under
// `tests/browser/fixtures/m1/<name>/`, each built by global setup with `mtek build --mode test` into
// `.out/m1/<name>/`, plus the post-build failure variants derived from fixture A.
//
// A and B are byte-identical copies of the semantic pass fixtures of M1-11 (a unit test keeps them so);
// A-moved differs from A only in the entity's `position`, A-renamed only in the declared names.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BROWSER_ROOT, REPO_ROOT } from "./environment.ts";

export const M1_FIXTURES_DIR = join(BROWSER_ROOT, "fixtures", "m1");
/** Where built fixtures are served from: `<server>/m1/<name>/index.html`. */
export const M1_OUT_DIR = join(BROWSER_ROOT, ".out", "m1");

export const FIXTURE_A = "scene_a_target_camera_box";
export const FIXTURE_B = "scene_b_orthographic_nested";
export const FIXTURE_A_MOVED = "scene_a_moved";
export const FIXTURE_A_RENAMED = "scene_a_renamed";

/** The fixtures that are copies of `tests/semantics/pass/<name>`. */
export const SEMANTIC_COPIES: readonly string[] = [FIXTURE_A, FIXTURE_B];

/** Post-build variant of A whose manifest declares `runtimeAbi: 99` (spec/testing.md section 6.7). */
export const VARIANT_ABI_99 = `${FIXTURE_A}.abi-99`;
/** Post-build variant of A whose WGSL file has a line appended that is not WGSL (test-only corruption). */
export const VARIANT_BAD_SHADER = `${FIXTURE_A}.bad-shader`;
/** The line appended to the WGSL file of `VARIANT_BAD_SHADER`. */
export const SHADER_CORRUPTION = "this line is not WGSL;\n";

/** The fail fixtures of M1-11 that must be rejected before launch, with their expected diagnostics. */
export const PRE_LAUNCH_FAILURES: readonly string[] = ["e5001_unknown_entity_field", "e3102_wrong_vector_dimension"];
export const SEMANTIC_FAIL_DIR = join(REPO_ROOT, "tests", "semantics", "fail");
export const SEMANTIC_PASS_DIR = join(REPO_ROOT, "tests", "semantics", "pass");

/** Every fixture directory under `fixtures/m1/`, sorted. */
export function m1FixtureNames(): string[] {
  return readdirSync(M1_FIXTURES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** One message of `cargo build --message-format=json`, as far as it is read here. */
interface CargoMessage {
  reason?: string;
  target?: { name?: string; kind?: string[] };
  executable?: string | null;
}

/**
 * Builds the CLI (`cargo build -p mtek-cli --locked`, spec/testing.md section 6.1) and returns the path
 * of the `mtek` executable as Cargo reports it, wherever the target directory is.
 */
export function buildCli(): string {
  const stdout = execFileSync("cargo", ["build", "-p", "mtek-cli", "--locked", "--message-format=json-render-diagnostics"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
  });
  let executable: string | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith("{")) continue;
    const message = JSON.parse(line) as CargoMessage;
    if (message.reason === "compiler-artifact" && message.target?.name === "mtek" && typeof message.executable === "string") {
      executable = message.executable;
    }
  }
  if (executable === undefined) throw new Error("cargo build -p mtek-cli reported no `mtek` executable");
  return executable;
}

/** What one CLI invocation produced. */
export interface CliRun {
  status: number;
  stdout: string;
  stderr: string;
}

/** Runs the CLI; a non-zero exit is a result, not an exception. */
export function runCli(cli: string, args: readonly string[]): CliRun {
  try {
    const stdout = execFileSync(cli, args, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failed = error as { status?: number | null; stdout?: string; stderr?: string };
    if (typeof failed.status !== "number") throw error;
    return { status: failed.status, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
  }
}

/** The CLI path global setup built, handed to workers through the environment. */
export function cliPath(): string {
  const path = process.env["MTEK_CLI"];
  if (path === undefined || path === "") throw new Error("MTEK_CLI is not set; global setup sets it");
  return path;
}

/**
 * Builds every M1 fixture into `.out/m1/<name>/` with `mtek build --mode test --format json` and derives
 * the failure variants. A fixture that does not build fails the whole run with the CLI's report.
 */
export function buildM1Fixtures(cli: string): void {
  rmSync(M1_OUT_DIR, { recursive: true, force: true });
  for (const name of m1FixtureNames()) {
    const out = join(M1_OUT_DIR, name);
    const run = runCli(cli, ["build", "--mode", "test", "--format", "json", "--out", out, join(M1_FIXTURES_DIR, name)]);
    if (run.status !== 0 || !existsSync(join(out, "index.html"))) {
      throw new Error(`mtek build --mode test of fixtures/m1/${name} failed (exit ${String(run.status)}):\n${run.stdout}${run.stderr}`);
    }
  }
  deriveFailureVariants();
}

/** A built program's manifest, as JSON. */
export function readBuiltManifest(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(M1_OUT_DIR, name, "program.manifest.json"), "utf8")) as Record<string, unknown>;
}

function deriveFailureVariants(): void {
  const source = join(M1_OUT_DIR, FIXTURE_A);

  const abi = join(M1_OUT_DIR, VARIANT_ABI_99);
  cpSync(source, abi, { recursive: true });
  const manifest = readBuiltManifest(VARIANT_ABI_99);
  manifest["runtimeAbi"] = 99;
  writeFileSync(join(abi, "program.manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const bad = join(M1_OUT_DIR, VARIANT_BAD_SHADER);
  cpSync(source, bad, { recursive: true });
  const shaders = (readBuiltManifest(VARIANT_BAD_SHADER)["shaders"] ?? []) as Array<{ url: string }>;
  if (shaders.length === 0) throw new Error(`fixtures/m1/${FIXTURE_A} has no shader to corrupt`);
  for (const shader of shaders) {
    const file = join(bad, ...shader.url.split("/"));
    writeFileSync(file, `${readFileSync(file, "utf8")}${SHADER_CORRUPTION}`);
  }
}
