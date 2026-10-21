# 0136. Game packages: `mtek build --release [--itch]`

- Status: Accepted
- Date: 2026-10-21
- Specification: `spec/tooling.md` §1 and §2.1; `spec/diagnostics.md` (`E7103`, `E7104`).
- Small-game plan: phase 8 (shipping), step 4.

## Context

`mtek build` already defaults to `--mode release`. What it writes is meant for developers: the unminified runtime (about 820 kB), a bare page that is blank until the program mounts, no favicon. A player sees a white page while the runtime downloads. Uploading to itch.io means zipping the folder by hand, with `index.html` at the root.

## Decision

1. **A flag, not a mode.** `--release` packages a `release` build. It conflicts with `--mode` and `--loop-budget`. The compiler's modes and their pages are unchanged, so no golden page, codegen fixture or reproducible-build evidence changes.
2. **Minified flavour.** The runtime build writes a third flavour, `dist/runtime.min.js`: the release flavour with esbuild `minify` and no source map. `mtek-cli/build.rs` embeds it and `scripts/prebuilt-runtime.mjs` keeps a prebuilt copy. Only `--release` uses it. The compiler treats the bundle as opaque bytes, so nothing else changes. `app.js` is not minified: it is small next to the runtime, and its source map is what maps run-time diagnostics to Mtek source.
3. **The compiler writes the page.** `package::html::game_html(title, favicon)` emits the page, and the CLI only chooses it. The CLI does not patch HTML (decision 0032). `BuildResult.title` carries `[build] title` to the CLI.
4. **Loading screen.** Plain HTML and CSS over the canvas (title, a spinner, "Loading…"), removed when the mount promise settles either way. It uses no runtime API, so it cannot break the ABI.
5. **Favicon by convention.** `assets/favicon.{svg,png,ico}` is used with no new `mtek.toml` key. It is checked by content (`E7103`), because a renamed JPEG would silently show no icon. Otherwise a built-in SVG "M" is used.
6. **itch.io zip.** A stored zip written by the CLI with no new dependency (CRC-32 and the zip records are about 80 lines). Entries are sorted and timestamps are fixed, so it is reproducible. itch.io's HTML5 limits (1000 files, 500 MB, 240-character paths) are checked before writing (`E7104`).

## Consequences

- New codes `E7103` and `E7104`. They are CLI-level, so they are tested by `crates/mtek-cli/src/game_package.rs` (listed in `tests/semantics/code-coverage-exceptions.json`).
- The prebuilt runtime gains `runtime.min.js` (about 500 kB).
- The loading screen and the minified runtime are only checked in a browser by hand (`TESTING-codey2.md` §7).

## Verification

- `cargo test -p mtek-cli --bin mtek game_package` (CRC-32 check value, zip structure and reproducibility, itch limits, favicon sniffing, packaging) and `cargo test -p mtek-compiler --lib package::html` (`the_game_page_has_the_loading_screen_favicon_and_escaped_title`).
- `mtek build --release --itch` on `examples/hud-score` wrote the folder and the zip. Python's `zipfile` accepted the zip (`testzip()` found no bad entry); that was done here. Loading it in a browser is in `TESTING-codey2.md` §7 and was not run here.
