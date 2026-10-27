// The bundles of the runtime package (decision 0055; `min`: decision 0136; core and animation: decision 0225).
//
// The core runtime (src/core.ts) is what `mtek build` embeds and writes as `runtime.<h16>.js`. It has no skeletal
// animation code: a program with a skinned mesh or `clips_from` gets the animation module (src/animation-module/entry.ts)
// as `animation/<h16>.js`, which the runtime imports at mount, like the physics module.
//
//   core.js        `release`: no development code at all (previews and `--mode release` builds)
//   core.dev.js    `dev`: adds the overlay and GPU timing; the only difference is the compile-time constant
//                  `__MTEK_DEV__` (src/flavour.d.ts): esbuild replaces it, drops every `if (false)` branch and, with it,
//                  every module only that branch reached (everything under src/dev/)
//   core.min.js    `min`: the release flavour fully minified, without a source map, for `mtek build --release`
//   animation.js / animation.min.js   the animation module, readable and minified (`--release`)
//   runtime.js     `full`: the npm entry (src/index.ts) = core plus the host animation API, for host code that bundles
//                  what it imports (`createAnimationController`, `retargetHumanoid`, ...); not embedded by `mtek`
//
// Shared by the build script and by src/release-bundle.test.ts, which inspects the real output.

/** The bundles: entry and output file (relative to the package) and the value of `__MTEK_DEV__`. */
export const FLAVOURS = {
  release: { entry: "src/core.ts", outfile: "dist/core.js", dev: false },
  dev: { entry: "src/core.ts", outfile: "dist/core.dev.js", dev: true },
  min: { entry: "src/core.ts", outfile: "dist/core.min.js", dev: false, minify: true },
  full: { entry: "src/index.ts", outfile: "dist/runtime.js", dev: false },
  animation: { entry: "src/animation-module/entry.ts", outfile: "dist/animation.js", dev: false, module: true },
  animationMin: { entry: "src/animation-module/entry.ts", outfile: "dist/animation.min.js", dev: false, minify: true, module: true },
};

/** esbuild options for `flavour`. Extra options (for example `write: false`, `metafile: true`) are merged last. */
export function bundleOptions(flavour, extra = {}) {
  const { entry, outfile, dev, minify = false, module = false } = FLAVOURS[flavour];
  return {
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    minify,
    // Folds the constant and removes the dead branches it leaves; names and whitespace stay as written.
    minifySyntax: true,
    // The animation module is a content-addressed file next to the program: no map to go with it.
    sourcemap: !minify && !module,
    legalComments: "none",
    logLevel: "info",
    define: { __MTEK_DEV__: dev ? "true" : "false" },
    ...extra,
  };
}
