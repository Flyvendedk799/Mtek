// The flavours of the runtime bundle (decision 0055; `min`: decision 0136): `release` (dist/runtime.js) has no development
// code at all, `dev` (dist/runtime.dev.js) adds the overlay and GPU timing. The only difference is the
// compile-time constant `__MTEK_DEV__` (src/flavour.d.ts): esbuild replaces it, drops every `if (false)`
// branch and, with it, every module only that branch reached (everything under src/dev/).
// `mtek build --mode release` embeds the first, `--mode dev|test` the second. `min` (dist/runtime.min.js) is
// the release flavour fully minified, without a source map, for `mtek build --release` game packages. Shared by the build script and
// by src/release-bundle.test.ts, which inspects the real output.

/** The flavours: output file (relative to the package) and the value of `__MTEK_DEV__`. */
export const FLAVOURS = {
  release: { outfile: "dist/runtime.js", dev: false },
  dev: { outfile: "dist/runtime.dev.js", dev: true },
  min: { outfile: "dist/runtime.min.js", dev: false, minify: true },
};

/** esbuild options for `flavour`. Extra options (for example `write: false`, `metafile: true`) are merged last. */
export function bundleOptions(flavour, extra = {}) {
  const { outfile, dev, minify = false } = FLAVOURS[flavour];
  return {
    entryPoints: ["src/index.ts"],
    outfile,
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    minify,
    // Folds the constant and removes the dead branches it leaves; names and whitespace stay as written.
    minifySyntax: true,
    sourcemap: !minify,
    legalComments: "none",
    logLevel: "info",
    define: { __MTEK_DEV__: dev ? "true" : "false" },
    ...extra,
  };
}
