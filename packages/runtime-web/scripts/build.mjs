// Bundles the runtime (ESM, ES2022; scripts/flavours.mjs): the minified dist/runtime.min.js for game packages
// (decision 0136) and, unminified with source maps,
// dist/runtime.js (release: no development code) and dist/runtime.dev.js (dev: overlay, GPU timing), and
// prints the maintained host declarations without comments for compiled app packages (decision 0206).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { compactDeclarations } from "./declarations.mjs";
import { FLAVOURS, bundleOptions } from "./flavours.mjs";

for (const flavour of Object.keys(FLAVOURS)) {
  await build(bundleOptions(flavour));
}

await mkdir("dist", { recursive: true });
await writeFile("dist/runtime.d.ts", compactDeclarations(await readFile("src/runtime.d.ts", "utf8")));
