/**
 * The runtime flavour, replaced by the bundler (`scripts/flavours.mjs`, decision 0055): `true` in the
 * development bundle (`runtime.dev.js`, used by `mtek build --mode dev|test`), `false` in the release
 * bundle (`runtime.js`). Code under `src/dev/` is reachable only through `if (__MTEK_DEV__)`, so the
 * release bundle contains none of it. Unit tests run as the development flavour (`vitest.config.ts`).
 */
declare const __MTEK_DEV__: boolean;
