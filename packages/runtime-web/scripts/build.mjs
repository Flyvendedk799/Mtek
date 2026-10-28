// Bundles the runtime (ESM, ES2022; scripts/flavours.mjs):
//   - the core runtime that `mtek build` embeds, without skeletal animation: dist/core.js (release), dist/core.dev.js
//     (overlay, GPU timing) and the minified dist/core.min.js for game packages (decisions 0055, 0136, 0225);
//   - the animation module, dist/animation.js and dist/animation.min.js, written by `mtek build` as animation/<h16>.js
//     for programs with skinned meshes (decision 0225);
//   - the npm entry dist/runtime.js: the core plus the host animation API, for host code that bundles what it imports;
// and prints the maintained host declarations without comments for compiled app packages (decision 0206).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { compactDeclarations } from "./declarations.mjs";
import { FLAVOURS, bundleOptions } from "./flavours.mjs";

for (const flavour of Object.keys(FLAVOURS)) {
  await build(bundleOptions(flavour));
}

await mkdir("dist", { recursive: true });
await writeFile("dist/runtime.d.ts", compactDeclarations(await readFile("src/runtime.d.ts", "utf8")));
