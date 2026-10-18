// Bundles the Rapier adapter to dist/physics.js (scripts/bundle.mjs). `mtek-cli`'s build.rs embeds the file
// next to the runtime bundles; the compiler writes it as physics/<h16>.js for programs that use physics.
import { build } from "esbuild";
import { bundleOptions } from "./bundle.mjs";

await build(bundleOptions());
