// Bundles the runtime to dist/runtime.js (ESM, ES2022, unminified, with a source map) and copies the
// hand-maintained host declarations to dist/runtime.d.ts (spec/runtime-abi.md section 6.1).
import { copyFile, mkdir } from "node:fs/promises";
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

await mkdir("dist", { recursive: true });
await copyFile("src/runtime.d.ts", "dist/runtime.d.ts");
