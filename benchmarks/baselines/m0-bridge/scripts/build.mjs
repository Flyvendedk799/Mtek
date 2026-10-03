// Bundles the baseline pages into dist/: index.html + baseline.js (the scenario) and
// misuse.html + misuse.js (run-time half of the type experiment). ESM, ES2022, unminified.
import { copyFileSync, mkdirSync } from "node:fs";
import { build } from "esbuild";

mkdirSync("dist", { recursive: true });
await build({
  entryPoints: { baseline: "src/index.ts", misuse: "experiments/misuse.ts" },
  outdir: "dist",
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "browser",
  minify: false,
  sourcemap: true,
  legalComments: "none",
  logLevel: "info",
});
copyFileSync("page/index.html", "dist/index.html");
copyFileSync("page/misuse.html", "dist/misuse.html");
