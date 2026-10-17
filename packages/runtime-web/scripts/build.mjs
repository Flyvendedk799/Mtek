// Bundles the runtime twice (ESM, ES2022, unminified, with source maps; scripts/flavours.mjs):
// dist/runtime.js (release: no development code) and dist/runtime.dev.js (dev: overlay, GPU timing), and
// copies the hand-maintained host declarations to dist/runtime.d.ts (spec/runtime-abi.md section 6.1).
import { copyFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { FLAVOURS, bundleOptions } from "./flavours.mjs";

for (const flavour of Object.keys(FLAVOURS)) {
  await build(bundleOptions(flavour));
}

await mkdir("dist", { recursive: true });
await copyFile("src/runtime.d.ts", "dist/runtime.d.ts");
