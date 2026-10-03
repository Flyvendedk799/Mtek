// Bundles a baseline project (`src/main.ts`) into a directory a static server can serve. No type
// checking happens here (esbuild strips types); `tsc` is a separate step, so that a starter that does
// not type-check still runs and its failure shows up in the browser behaviour.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Mtek benchmark baseline</title>
  </head>
  <body>
    <script type="module" src="/main.js"></script>
  </body>
</html>
`;

export async function buildBaseline(projectDir: string, outDir: string): Promise<void> {
  const entry = join(resolve(projectDir), "src", "main.ts");
  if (!existsSync(entry)) throw new Error(`${entry} does not exist`);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  await build({
    entryPoints: { main: entry },
    outdir: outDir,
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    minify: false,
    sourcemap: false,
    legalComments: "none",
    logLevel: "warning",
  });
  writeFileSync(join(outDir, "index.html"), PAGE);
}
