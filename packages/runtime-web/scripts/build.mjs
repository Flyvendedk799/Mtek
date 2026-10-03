// Bundles the runtime to dist/runtime.js (ESM, ES2022, unminified, with a source map).
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/runtime.js",
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "browser",
  minify: false,
  sourcemap: true,
  legalComments: "none",
  logLevel: "info",
});
