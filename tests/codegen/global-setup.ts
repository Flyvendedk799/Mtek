// Vitest global setup: dumps the layout record and the generated JavaScript writers of every
// layout fixture into `tests/codegen/.out/` by running the compiler's `layout_fixtures` example
// (spec/testing.md section 4.2). The directory is rebuilt from scratch on every run.
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export default function setup(): void {
  const repoRoot = resolve(here, "../..");
  const outDir = resolve(here, ".out");
  rmSync(outDir, { recursive: true, force: true });
  execFileSync(
    "cargo",
    [
      "run",
      "--quiet",
      "--locked",
      "-p",
      "mtek-compiler",
      "--example",
      "layout_fixtures",
      "--",
      outDir,
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );
}
