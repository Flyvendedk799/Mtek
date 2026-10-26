import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BROWSER_ROOT, REPO_ROOT } from "./environment.ts";
import { runCli } from "./m1-fixtures.ts";

/** Compile and serve the actual standalone example, including its interactive host page. */
export function buildLightingStudio(cli: string): void {
  const root = join(BROWSER_ROOT, ".out/lighting-studio"), example = join(REPO_ROOT, "examples/lighting-studio");
  mkdirSync(root, { recursive: true });
  for (const file of ["index.html", "studio.js", "studio.css"]) copyFileSync(join(example, file), join(root, file));
  const out = join(root, ".out");
  const result = runCli(cli, ["build", "--out", out, join(example, "scene")]);
  if (result.status !== 0) throw new Error(`Lighting studio did not build: ${result.stderr}${result.stdout}`);
  const runtime = readdirSync(out).find(file => /^runtime\.[a-f0-9]{16}\.js$/.test(file));
  if (runtime === undefined) throw new Error("Lighting studio has no embedded runtime");
  writeFileSync(join(out, "lighting-api.js"), `export {decodeRadiance} from "./${runtime}";\n`);
}
