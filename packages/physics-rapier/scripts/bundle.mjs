// The physics bundle (decision 0063): the adapter and Rapier's embedded WebAssembly as one ESM file,
// dist/physics.js. The compiler hashes it and writes it to physics/<h16>.js of a program's dist/ only when
// the manifest says subsystems.physics (spec/physics.md section 5). Shared by the build script and by
// src/bundle.test.ts, which builds the real output and imports it.

/** The output file, relative to the package. */
export const OUTFILE = "dist/physics.js";

/** esbuild options for the bundle. Extra options (for example `outfile`, `write: false`) are merged last. */
export function bundleOptions(extra = {}) {
  return {
    entryPoints: ["src/index.ts"],
    outfile: OUTFILE,
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    // Like the runtime bundle: unminified, readable. No source map: the file is copied under a content hash
    // and only the .js is shipped, and a map of a 4 MB embedded binary is of no use.
    minify: false,
    sourcemap: false,
    legalComments: "none",
    logLevel: "info",
    ...extra,
  };
}
