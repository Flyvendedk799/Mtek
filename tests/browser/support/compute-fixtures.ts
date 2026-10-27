import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { BROWSER_ROOT, REPO_ROOT } from "./environment.ts";
import { POSITION_WGSL, INVOCATION_WGSL, QUAD_WGSL } from "./compute-reference.ts";
import { COMPOSITE_WGSL } from "./compute-composite-reference.ts";

export interface AcceptanceBuild { format: string; sourceSha256: string; projectConfigSha256?: string | null; runtimeSha256: string; developmentSourceGateBypass: string; files: { path: string; sha256: string }[]; references?: { path: string; sha256: string }[]; harnessSha256?: string; shadow?: AcceptanceBuild; shadowHarnessSha256?: string }
const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function verifyPackage(program: string, source: string, config?: string): AcceptanceBuild {
  const provenance = JSON.parse(readFileSync(join(program, "acceptance-build.json"), "utf8")) as AcceptanceBuild;
  if (provenance.format !== "mtek-compute-acceptance-package/1" || provenance.sourceSha256 !== hash(readFileSync(source))) throw new Error("compute fixture source provenance mismatch");
  if (provenance.developmentSourceGateBypass !== "none: ordinary public analysis" || (config !== undefined && provenance.projectConfigSha256 !== hash(readFileSync(config)))) throw new Error("compute package analysis/configuration provenance mismatch");
  for (const file of provenance.files) {
    if (!/^[a-zA-Z0-9_./-]+$/.test(file.path) || file.path.split("/").some((part) => part === ".." || part === "")) throw new Error("invalid acceptance package path");
    if (hash(readFileSync(join(program, file.path))) !== file.sha256) throw new Error(`acceptance package hash mismatch: ${file.path}`);
  }
  const runtimeFile = provenance.files.find((file) => /^runtime\.[0-9a-f]{16}\.js$/.test(file.path));
  if (runtimeFile === undefined || runtimeFile.sha256 !== provenance.runtimeSha256 || !runtimeFile.path.includes(runtimeFile.sha256.slice(0, 16))) throw new Error("compute fixture runtime is not content addressed");
  return provenance;
}

/** Compiler-produced numerical and scene-lighting packages; no GPU work during preparation. */
export async function buildComputeAcceptance(out = join(BROWSER_ROOT, ".out", "compute")): Promise<AcceptanceBuild> {
  const program = join(out, "program"), shadow = join(out, "shadow"); mkdirSync(program, { recursive: true });
  const built = join(REPO_ROOT, "packages/runtime-web/dist");
  const runtime = ["core.dev.js", "runtime.d.ts"].every((file) => existsSync(join(built, file))) ? built : join(REPO_ROOT, "crates/mtek-cli/prebuilt");
  execFileSync("cargo", ["test", "-p", "mtek-compiler", "--locked", "-j", "2", "--test", "compute_lowering", "--", "--test-threads=2"], {
    cwd: REPO_ROOT, stdio: "pipe", windowsHide: true, env: { ...process.env, MTEK_COMPUTE_ACCEPTANCE_OUT: program, MTEK_COMPUTE_SHADOW_OUT: shadow, MTEK_COMPUTE_ACCEPTANCE_RUNTIME: runtime, MTEK_BLESS: "0" },
  });
  const provenance = verifyPackage(program, join(REPO_ROOT, "tests/codegen/compute-contract/kernel.mtek"));
  const shadowProvenance = verifyPackage(shadow, join(REPO_ROOT, "examples/compute-geometry/scene/src/main.mtek"), join(REPO_ROOT, "examples/compute-geometry/scene/mtek.toml"));
  mkdirSync(join(out, "reference"), { recursive: true });
  for (const [name, code] of [["positions", POSITION_WGSL], ["invocation", INVOCATION_WGSL], ["quad", QUAD_WGSL], ["composite", COMPOSITE_WGSL]]) writeFileSync(join(out, "reference", `${name}.wgsl`), code!);
  copyFileSync(join(BROWSER_ROOT, "pages", "compute.html"), join(out, "index.html"));
  await build({ entryPoints: [join(BROWSER_ROOT, "pages", "compute.ts")], outfile: join(out, "acceptance.js"), bundle: true, format: "esm", target: "es2022", platform: "browser", logLevel: "warning" });
  await build({ entryPoints: [join(BROWSER_ROOT, "pages", "compute-shadow.ts")], outfile: join(out, "shadow-acceptance.js"), bundle: true, format: "esm", target: "es2022", platform: "browser", logLevel: "warning" });
  const example = join(out, "example"); mkdirSync(example, { recursive: true });
  for (const file of ["index.html", "main.js", "geometry.js"]) copyFileSync(join(REPO_ROOT, "examples/compute-geometry", file), join(example, file));
  cpSync(shadow, join(example, ".out"), { recursive: true });
  if (!readdirSync(program).includes("index.html")) throw new Error("compute package bootstrap is missing");
  return { ...provenance, shadow: shadowProvenance, shadowHarnessSha256: hash(readFileSync(join(out, "shadow-acceptance.js"))), references: ["positions", "invocation", "quad", "composite"].map((name) => ({ path: `reference/${name}.wgsl`, sha256: hash(readFileSync(join(out, "reference", `${name}.wgsl`))) })), harnessSha256: hash(readFileSync(join(out, "acceptance.js"))) };
}
