# Mtek

Mtek is a typed language for browser applications where visual behaviour matters more than the
surrounding web application: interactive product scenes, procedural visualisations, physics
playgrounds and small 3D games. A Mtek program describes scene structure, state, shader stages and
their resource dependencies as one checked unit; the compiler produces JavaScript and WGSL for a
runtime on browser WebGPU, and the toolchain works fully offline, without any AI service.

## Status: pre-alpha — only the toolchain exists

The specification is in [`spec/`](spec/README.md). The repository currently contains the build
toolchain (Rust workspace, npm workspace, CI) and nothing else: the compiler library exposes only
version constants, the `mtek` CLI implements only `--version`, and `@mtek/runtime-web` exports only
its version constants. Everything else described in `spec/` is a design, not a feature; a feature
counts as supported only when a test that would fail without it passes in a recorded environment
(`spec/testing.md`).

## Requirements

- Rust **1.99.0** (installed automatically by `rustup` from `rust-toolchain.toml`)
- Node.js **24** (`.nvmrc`) with the bundled npm

## Commands

From a clean checkout:

| Command | Purpose |
|---|---|
| `npm ci` | install the exact locked npm dependencies |
| `npm run build` | bundle `@mtek/runtime-web` to `packages/runtime-web/dist/runtime.js`, the Rapier adapter to `packages/physics-rapier/dist/physics.js` and the VS Code extension to `packages/editor-vscode/dist/extension.cjs`, then `cargo build -p mtek-cli --locked` |
| `npm run check` | `cargo fmt --check`, `cargo clippy --workspace --all-targets --locked -- -D warnings`, `npm run check:ts`, `npm run lint`, `npm run check:naming`, `npm run check:tasks` |
| `npm run check:ts` | `tsc -b` over all TypeScript projects |
| `npm run lint` | ESLint (`recommended-type-checked`, no `any`) |
| `npm run check:naming` | fails if the retired placeholder name appears outside the two decision records that explain the rename (decision 0017) |
| `npm run test:unit` | Vitest unit tests |
| `npm run test:browser` | builds, then runs the Playwright browser tests (`hardware`, `software` and `benchmarks` projects; add `--project=<name>` to select one); tests without a WebGPU adapter are reported NOT-RUN, never passed |
| `npm run check:tasks` | validates the benchmark tasks and the recorded holdout hash (`benchmarks/README.md`, decision 0021) |
| `npm run test:benchmarks` | the `benchmarks` Playwright project: every benchmark task's fixtures against its three.js baseline reference (hardware configuration; `MTEK_BASELINE_SOURCE=starter` runs the starters instead) |
| `npm run test:browser:hardware` | the `hardware` project only; with `MTEK_REQUIRE_GPU=1` it fails on any NOT-RUN test or software adapter |
| `npm test` | `check`, then `cargo test --workspace --locked`, then `test:unit`, then `test:browser` (NOT-RUN tolerant unless `MTEK_REQUIRE_GPU=1`) |
| `cargo run -p mtek-cli -- --version` | prints `mtek 0.1.0-dev (language 0.1, runtime ABI 1)` |

### Examples

| Directory | What it is |
|---|---|
| [`examples/pulse-cube`](examples/pulse-cube) | the `mtek new` scaffold: a rotating cube, one material, one host input (M3) |
| [`examples/material-configurator`](examples/material-configurator) | a multi-file configurator: a generated chair (GLB), PBR materials bound to host inputs, a custom fragment material, lights, a host page, and instanced legs (M4); its browser specs are the evidence for the M4 exit gate |
| [`examples/physics-playground`](examples/physics-playground) | a floor, a prefab crate, an impulse on Space, seeded crates on C, a sensor zone that counts them, crates destroyed below a height, and a bar bound to the count (M5); its browser spec is part of the M5 evidence |

Global setup of the browser tests builds all three with the CLI (`tests/browser/support/m3-fixtures.ts`, `m4-configurator.ts`, `m5-playground.ts`).

### Browser tests

The browser harness lives in [`tests/browser`](tests/browser) (`spec/testing.md` section 6, decision 0012). One-time browser install:

```
npx playwright install chromium
```

| Variable | Effect |
|---|---|
| `MTEK_REQUIRE_GPU=1` | fail the run on any NOT-RUN test, and when a hardware project reports `isFallbackAdapter === true` (required for gate evidence) |
| `MTEK_ACCEPT_SOFTWARE=1` | with `MTEK_REQUIRE_GPU=1`, accept a software adapter in the hardware project |
| `MTEK_BROWSER_CHANNEL` | Playwright channel, default `chromium` (new headless mode); `chrome` uses installed Google Chrome |
| `MTEK_HEADED=1` | run headed instead of headless |
| `MTEK_BROWSER_ARGS` | extra Chromium arguments, space separated (for example `--disable-gpu` to simulate a machine without a GPU) |
| `MTEK_RESULTS_DIR` | results directory, default `tests/browser/results/<timestamp>` (JSON report and `environment-<project>.json`) |

The working configuration on the development machine is recorded in decision 0012 (amendment) and `evidence/environments/`.

#### `mtek test`

`mtek test [--allow-not-run] [--format human|json] [PATH]` runs the declarative fixtures `tests/*.test.toml` of a project (the three examples have theirs) in Chromium with the launch configuration of the hardware project (`spec/tooling.md` section 6, decision 0074, report schema `spec/test-report.schema.json`). A fixture that cannot run (no WebGPU adapter, no Playwright, no Node) is reported **NOT-RUN**, never as a pass; that exits 1 unless `--allow-not-run`. It uses the browser variables above and these:

| Variable | Effect |
|---|---|
| `MTEK_NODE` | the Node.js executable that runs the browser runner [default: `node`; version 24 or newer] |
| `MTEK_TEST_RUNNER` | the runner script [default: `tests/browser/support/mtek-test/main.ts`, found above the `mtek` executable] |
| `MTEK_TEST_TIMEOUT_MS` | the longest one fixture may take [default: 120000] |

```
cargo run -p mtek-cli -- test examples/pulse-cube
MTEK_BROWSER_ARGS=--disable-gpu cargo run -p mtek-cli -- test examples/pulse-cube --allow-not-run   # NOT-RUN, exit 0
```

#### The repair harness (M6)

`tools/ai-eval` is the provider-independent generate, validate, repair loop of the AI benchmark
(`spec/ai-and-benchmarks.md` section 4, decision 0077, usage in `tools/ai-eval/README.md`). It runs
the real `mtek check`, `build`, `test` and `context` on a candidate, records every layer on its own to
`records.jsonl` (`spec/ai-eval-record.schema.json`), and counts a candidate as a success only when every layer
passes and the task's required declarations still exist; a layer that could not run (no GPU) is NOT-RUN,
never a pass. `node tools/ai-eval/src/cli.ts validate --task benchmarks/tasks/<id> [--project DIR]`
validates the starter or any project of a task; `npm run test:unit -w @mtek/ai-eval` needs no network and no GPU.
No language package imports the harness or an inference provider: `npm run lint` checks it.

#### The CPU/GPU bridge specs (M0)

`tests/browser/specs/bridge/` proves on real WebGPU that values written by the **generated** JavaScript
writers into a production uniform arena are read bit-exactly by **generated** WGSL (`spec/gpu-layout.md`
section 9.4; `spec/testing.md` section 6.2), for all 14 layout fixtures: the bit-exact probe, two
instances in one arena, no pipeline or shader module created by value updates, and a rendered colour.
Global setup generates the inputs with the disposable
`cargo run -p mtek-compiler --example bridge_spike -- tests/browser/.out/bridge` (shaders, writers,
layout records; every shader is validated with Naga first) and bundles `tests/browser/pages/bridge.ts`,
which drives the production `gpu/device`, `gpu/registry` and `gpu/uniform-arena` modules. Randomised
tests record their seed as a `seed` annotation; `MTEK_TEST_SEED` reproduces a run. Gate evidence is
`MTEK_REQUIRE_GPU=1 npm run test:browser:hardware` on the recorded hardware machine, saved as
`evidence/M0/environment-bridge.json` and `evidence/M0/test-results-bridge.json`. Committed evidence
must be machine-neutral: the raw Playwright report is passed through
`npm run evidence:sanitize -- <in.json> <out.json>` (`tests/browser/support/sanitize-report.ts`), which
rewrites paths under the checkout to repo-relative POSIX paths, the results directory to `<results>/...`
and any other absolute path to `<external>`, and leaves timestamps, durations and every other value
unchanged. The environment record contains no paths and is committed as written.

## Language server

`mtek lsp [--stdio]` is a language server over standard input and output (`spec/tooling.md` section 7, decision 0076): diagnostics for the whole project (150 ms after the last change, over the editor's unsaved buffers), hover (types, doc comments, standard-library documentation), go to definition (across modules and into the standard library as read-only `mtek-prelude:` documents), completion, and a quick fix for every validated suggested edit of `spec/diagnostics.md` section 6. Positions are UTF-8 if the client offers it and UTF-16 otherwise. A client needs only the launch command; the VS Code extension (`packages/editor-vscode`, below) is a thin client of it.

```
cargo run -p mtek-cli -- lsp        # waits for an LSP client on stdin; exit code 0 after shutdown and exit
```

## VS Code extension

`packages/editor-vscode` (npm name `mtek-vscode`, `spec/tooling.md` section 8, decision 0090) is a VS Code extension for `.mtek` files: syntax highlighting from a TextMate grammar that `scripts/gen-grammar.ts` generates from `spec/grammar.ebnf`, a language configuration that matches `mtek fmt`, and a client of `mtek lsp` (the `mtek` executable on `PATH`, or the setting `mtek.server.path`). It is not published to a marketplace; CI builds the `.vsix` and uploads it as a workflow artifact.

| Command | Purpose |
|---|---|
| `npm run package -w mtek-vscode` | bundle the extension and make `packages/editor-vscode/mtek-vscode-<version>.vsix` with `@vscode/vsce` (install it with *Extensions: Install from VSIX...*) |
| `npm run gen:grammar -w mtek-vscode` | regenerate `syntaxes/mtek.tmLanguage.json` (`npm run check:grammar -w mtek-vscode` fails if the committed file differs) |
| `npm run test:integration -w mtek-vscode` | download a pinned VS Code (cached in `target/vscode-test/`), open a temporary project in it and run the integration suite against `target/debug/mtek lsp`; needs `npm run build` first and a display (`xvfb-run -a` on Linux without one); a VS Code that cannot be downloaded or started prints NOT-RUN and exits 1 |

## Planned commands (not available)

None of these commands exists yet. The milestone in which each is planned is listed in
[`spec/tooling.md`](spec/tooling.md). Any other `mtek` invocation currently prints usage and exits with code 2.

| Command | Purpose | Planned |
|---|---|---|
| `mtek check` | parse and type-check a project | M1 |
| `mtek build` | produce a deployable web build | M1 |
| `mtek dev` | build, serve and watch with hot reload | M1 (candidate-based reload: M3) |
| `mtek inspect` | inspect IR, bindings and shaders | M1 / M2 |
| `mtek new` | scaffold a project | M3 |
| `mtek fmt`, `mtek test`, `mtek context`, `mtek grammar export`, `mtek lsp` | formatter, fixtures, AI context export, grammar export, language server | M6 |

## Licence

All rights reserved — licence to be decided.
