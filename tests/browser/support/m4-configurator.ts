// M4-10: the builds of `examples/material-configurator` for the browser specs (specs/m4/configurator*.spec.ts), made by global
// setup with the CLI, like every other fixture:
//   .out/m4-configurator/site/dist/    `mtek build --mode test` of the example itself (served as /m4-configurator/site/dist/index.html)
//   .out/m4-configurator/site/host/    the example's host page, copied next to dist/ so that its `../dist/app.js` resolves
//   .out/m4-configurator/repeated/     `mtek build --mode test` of the repeated-object variant: the example with `src/main.mtek`
//                                      replaced by the generated scene of configurator-scene.ts (80 copies of the chair's meshes)
// A build that fails fails the whole run with the CLI's report. The variants that must NOT build (a GLB with a normal texture, a
// GLB that requires an extension) are made inside the spec that checks them, with `buildBrokenVariant`.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BROWSER_ROOT, REPO_ROOT } from "./environment.ts";
import { repeatedSource } from "./configurator-scene.ts";
import { runCli, type CliRun } from "./m1-fixtures.ts";

export const CONFIGURATOR_SRC = join(REPO_ROOT, "examples", "material-configurator");
export const CONFIGURATOR_OUT = join(BROWSER_ROOT, ".out", "m4-configurator");
export const CONFIGURATOR_SITE = join(CONFIGURATOR_OUT, "site");
/** URLs under the static server's root (`.out/`). */
export const CONFIGURATOR_URL = "/m4-configurator/site/dist/index.html";
export const CONFIGURATOR_HOST_URL = "/m4-configurator/site/host/configurator.html";
export const REPEATED_URL = "/m4-configurator/repeated/index.html";
/** Where the variant GLBs live (written by tests/assets/tools/make-glb.mjs). */
export const VARIANT_GLB_DIR = join(BROWSER_ROOT, "fixtures", "m4-variants");

function build(cli: string, project: string, out: string): void {
  const run = runCli(cli, ["build", "--mode", "test", "--format", "json", "--out", out, project]);
  if (run.status !== 0 || !existsSync(join(out, "index.html"))) {
    throw new Error(`mtek build --mode test of ${project} failed (exit ${String(run.status)}):\n${run.stdout}${run.stderr}`);
  }
}

/** A copy of the example under `.out/` (without a stale `dist`), for variants that edit it. */
export function copyExample(name: string): string {
  const target = join(CONFIGURATOR_OUT, "variant-src", name);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(CONFIGURATOR_SRC, target, { recursive: true, filter: (path) => !/[\\/]dist([\\/]|$)/.test(path) });
  return target;
}

export function buildConfigurator(cli: string): void {
  rmSync(CONFIGURATOR_OUT, { recursive: true, force: true });
  build(cli, CONFIGURATOR_SRC, join(CONFIGURATOR_SITE, "dist"));
  cpSync(join(CONFIGURATOR_SRC, "host"), join(CONFIGURATOR_SITE, "host"), { recursive: true });

  const repeated = copyExample("repeated");
  writeFileSync(join(repeated, "src", "main.mtek"), repeatedSource());
  // The variant has its own scene and none of the example's inputs.
  const toml = readFileSync(join(repeated, "mtek.toml"), "utf8");
  writeFileSync(join(repeated, "mtek.toml"), toml.replace('scene = "Configurator"', 'scene = "Repeated"').replace(/\n\[host\.inputs\][\s\S]*$/, "\n"));
  build(cli, repeated, join(CONFIGURATOR_OUT, "repeated"));
}

export interface BrokenVariantRuns {
  readonly check: CliRun;
  readonly build: CliRun;
  /** Whether `mtek build` wrote any output at all. */
  readonly wroteOutput: boolean;
}

/**
 * Copies the example, replaces `models/chair.glb` by a variant GLB from `fixtures/m4-variants/` and runs `mtek check` and
 * `mtek build` on it. Both are expected to fail; the runs are returned for the spec to inspect.
 */
export function buildBrokenVariant(cli: string, variantGlb: string): BrokenVariantRuns {
  const project = copyExample(variantGlb.replace(/\.glb$/, ""));
  writeFileSync(join(project, "models", "chair.glb"), readFileSync(join(VARIANT_GLB_DIR, variantGlb)));
  const out = join(CONFIGURATOR_OUT, "variant-out", variantGlb.replace(/\.glb$/, ""));
  rmSync(out, { recursive: true, force: true });
  const check = runCli(cli, ["check", "--format", "json", project]);
  const built = runCli(cli, ["build", "--mode", "test", "--format", "json", "--out", out, project]);
  return { check, build: built, wroteOutput: existsSync(out) };
}
