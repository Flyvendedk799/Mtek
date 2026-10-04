// Vitest global setup (spec/testing.md sections 4.1 and 4.2), rebuilding `tests/codegen/.out/`
// from scratch on every run:
//  1. the runtime bundle `packages/runtime-web/dist/runtime.js` from the current sources, so the
//     execution tests never run against a stale runtime;
//  2. the layout record and generated writers of every layout fixture (`layout_fixtures`);
//  3. every codegen fixture built with that real runtime bundle, its typed IR and the compiler's
//     copy of the runtime's operation index (`codegen_programs`, decision 0040).
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function example(repoRoot: string, name: string, outDir: string): void {
  execFileSync(
    "cargo",
    ["run", "--quiet", "--locked", "-p", "mtek-compiler", "--example", name, "--", outDir],
    { cwd: repoRoot, stdio: "inherit" },
  );
}

export default function setup(): void {
  const repoRoot = resolve(here, "../..");
  const outDir = resolve(here, ".out");
  rmSync(outDir, { recursive: true, force: true });
  execFileSync(process.execPath, [resolve(repoRoot, "scripts/gen-manifest-validator.mjs")], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  execFileSync(process.execPath, ["scripts/build.mjs"], {
    cwd: resolve(repoRoot, "packages/runtime-web"),
    stdio: "inherit",
  });
  example(repoRoot, "layout_fixtures", outDir);
  example(repoRoot, "codegen_programs", outDir);
  // Next to each built program (test files run in parallel workers, so they only read): the
  // sources its app.js.map names (decision 0030) and the runtime bundle's own source map, which
  // `dist/` does not ship.
  const programs = resolve(outDir, "programs");
  const runtimeMap = resolve(repoRoot, "packages/runtime-web/dist/runtime.js.map");
  for (const name of readdirSync(programs)) {
    cpSync(resolve(here, name, "src"), resolve(programs, name, "src"), { recursive: true });
    if (existsSync(runtimeMap)) cpSync(runtimeMap, resolve(programs, name, "runtime.js.map"));
  }
}
