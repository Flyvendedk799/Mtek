# Mtek

Mtek is a typed language for browser applications where visual behaviour matters more than the
surrounding web application: interactive product scenes, procedural visualisations, physics
playgrounds and small 3D games. A Mtek program describes scene structure, state, shader stages and
their resource dependencies as one checked unit; the compiler produces JavaScript and WGSL for a
runtime on browser WebGPU, and the toolchain works fully offline, without any AI service.

## Status: pre-alpha

The specification is in [`spec/`](spec/README.md). The repository contains the compiler and the `mtek`
command line tool (the commands are listed [below](#the-mtek-command)), the web runtime, six
examples and the test and benchmark infrastructure. There is no release, no installer and no package
registry: you build the tool from a checkout. **New here? Start with
[`docs/getting-started.md`](docs/getting-started.md)**: install, create a project, run it, break it,
read the error and repair it. A feature counts as supported only when a test that would fail without
it passes in a recorded environment (`spec/testing.md`).

**The documentation starts at [`docs/README.md`](docs/README.md)**: a learning path, a [tutorial](docs/tutorial.md) and a page for each concept (lighting and units, time and input, state and bindings, entities and references, prefabs, textures and assets, materials, physics, modules), each with the rule, the reason, a worked example and the common mistakes with the diagnostic code each raises. Every Mtek code block in them is compiled by a test.

What the language is and what it is not: the [language guide](docs/language-guide.md) (the compact page for programs that write Mtek), the
[language reference](docs/language-reference.md) and the [limitations](docs/limitations.md) (every
unsupported feature, every gate, every reserved diagnostic, each with its reason) are generated from the
specification, the registry and the compiler, and checked against the compiler, the runtime and this file
by `npm run check:release`. The [draft release notes](docs/release-notes-v0.1.md) cite evidence for every
claim and mark every result that does not exist yet as pending.

## Requirements

What a clean checkout needs. The list comes from building and testing fresh clones on one Windows 11 machine ([`evidence/M7/reproducible-builds.md`](evidence/M7/reproducible-builds.md) says what that run did and did not exercise); no manual edit and no step beyond these was needed there.

- Git, to clone.
- Rust **1.99.0** (installed automatically by `rustup` from `rust-toolchain.toml`). On Windows `rustup`'s default toolchain targets MSVC (`x86_64-pc-windows-msvc`), which needs the Visual Studio Build Tools with the C++ workload for its linker.
- Node.js **24** (`.nvmrc`, the version CI and the recorded runs use) with the bundled npm (`packageManager` names npm 11.16.0, which Node 24.18 bundles). Any Node.js from **22.18.0** on also works: `engines` says `>=22.18.0` (the first release that runs TypeScript without a flag, which the tools rely on) and `.npmrc` sets `engine-strict=true`, so `npm ci` refuses only an older Node (decision 0161).
- Node.js is not needed just to build and use `mtek`: the CLI embeds the prebuilt runtime of [`crates/mtek-cli/prebuilt`](crates/mtek-cli/prebuilt) when `packages/runtime-web/dist` was not built, so `cargo build -p mtek-cli` on a fresh clone gives an `mtek` whose `build` works (decision 0161). Node is needed to change the runtime, for `mtek test` and for the test suites.
- Network access for `npm ci` (npm registry) and for the first `cargo` run (crates.io, locked by `Cargo.lock`).

Only for running the browser tests, the editor tests or the grammar backend, none of which `npm ci` and `npm run build` need:

- **Browser tests** (`npm run test:browser`): the browser that Playwright drives, once, with `npx playwright install chromium` (Linux CI uses `npx playwright install --with-deps chromium`). A GPU with WebGPU, for the `hardware` and `benchmarks` projects; without one those tests are NOT-RUN, and `MTEK_REQUIRE_GPU=1` turns NOT-RUN into a failure. The `software` project needs no GPU.
- **VS Code integration tests** (`npm run test:integration -w mtek-vscode`): network access to download the pinned VS Code, and a display (`xvfb-run -a` on Linux without one).
- **Grammar backend** (optional): `node tools/grammar-adapters/fetch-backend.mjs --all` downloads and verifies llama.cpp, builds its GBNF validator and downloads a 1.1 GB model. It needs CMake and a C++ compiler (on Windows the Visual Studio Build Tools; CMake is found on `PATH`, in `$CMAKE` or in the copy bundled with Visual Studio) and network access. Without it `cargo test --workspace --locked` still passes: the conformance suite and the smoke test print NOT-RUN and succeed, unless `MTEK_REQUIRE_GBNF_VALIDATOR=1` and `MTEK_REQUIRE_GBNF_BACKEND=1` are set, which make them fail instead (decision 0073).

Reproducibility: [`scripts/verify-reproducible-build.mjs`](scripts/verify-reproducible-build.mjs) makes two fresh clones in two directories, builds the packages, all examples and the runtime benchmark programs in both, and compares the output trees byte for byte (below).

## Commands

From a clean checkout:

| Command | Purpose |
|---|---|
| `npm ci` | install the exact locked npm dependencies |
| `npm run build` | bundle `@mtek/runtime-web` to `packages/runtime-web/dist/runtime.js`, the Rapier adapter to `packages/physics-rapier/dist/physics.js` and the VS Code extension to `packages/editor-vscode/dist/extension.cjs`, then `cargo build -p mtek-cli --locked` |
| `npm run check` | `cargo fmt --check`, `cargo clippy --workspace --all-targets --locked -- -D warnings`, `npm run check:ts`, `npm run lint`, `npm run check:naming`, `npm run check:tasks`, `npm run check:assets`, `npm run check:prebuilt` (the prebuilt runtime of `crates/mtek-cli/prebuilt` matches its sources, decision 0161) |
| `npm run check:ts` | `tsc -b` over all TypeScript projects |
| `npm run lint` | ESLint (`recommended-type-checked`, no `any`) |
| `npm run check:naming` | fails if the retired placeholder name appears outside the two decision records that explain the rename (decision 0017) |
| `npm run test:unit` | Vitest unit tests |
| `npm run test:browser` | builds, then runs the Playwright browser tests (`hardware`, `software` and `benchmarks` projects; add `--project=<name>` to select one); tests without a WebGPU adapter are reported NOT-RUN, never passed |
| `npm run check:assets` | fails if a generated GLB test asset on disk differs from what `tests/assets/tools/make-glb.mjs` writes (`spec/assets.md` section 7, decision 0058) |
| `npm run check:prebuilt` | fails if the runtime or physics sources changed since the prebuilt runtime of `crates/mtek-cli/prebuilt` was written (decision 0161) |
| `npm run prebuilt:write` | copies the freshly built `dist/` bundles into `crates/mtek-cli/prebuilt` and records their hashes; run `npm run build` first |
| `npm run check:tasks` | validates the benchmark tasks and the recorded holdout hash (`benchmarks/README.md`, decision 0021) |
| `npm run check:coverage` | the feature coverage matrix (decision 0093): derives from the compiled examples and fixtures what each uses, fails when a v0.1 feature has no demonstration or positive fixture, a diagnostic code no negative test, or `docs/coverage-matrix.md` is stale (`npm run generate -w @mtek/coverage-matrix` rewrites it); needs `npm run build` first |
| `npm run check:release` | the release documentation and the capability consistency check (decisions 0100, 0101, 0104 and 0116 to 0118): regenerates `docs/language-guide.md`, `docs/language-reference.md`, `docs/limitations.md` and the index, tutorial and concept pages (`tools/release-docs/templates/pages`) and fails if they are stale; compiles every Mtek code block of the concept pages, the tutorial and the guide, checks their links, anchors and cited diagnostic codes, and holds the guide to 16 384 bytes; compares the compiler's supported features, the registry, the runtime's ABI and capabilities, the specification and the claims of this README, naming both sides of every mismatch; checks that every claim of `docs/release-notes-v0.1.md` links to evidence (`npm run generate -w @mtek/release-docs` rewrites the pages); needs `npm run build` first |
| `npm run check:baseline` | the M7 baseline (decision 0126): `evidence/M7/baseline.json` and the number tables of `evidence/M7/report.md` follow from the stored benchmark results (`node scripts/gen-m7-baseline.mjs` regenerates them) |
| `npm run test:benchmarks` | the `benchmarks` Playwright project: every benchmark task's fixtures against its three.js baseline reference (hardware configuration; `MTEK_BASELINE_SOURCE=starter` runs the starters instead) |
| `npm run test:browser:hardware` | the `hardware` project only; with `MTEK_REQUIRE_GPU=1` it fails on any NOT-RUN test or software adapter |
| `npm test` | `check`, then `cargo test --workspace --locked`, then `test:unit`, then `check:coverage`, then `check:release`, then `check:baseline`, then `test:browser` (NOT-RUN tolerant unless `MTEK_REQUIRE_GPU=1`) |
| `cargo run -p mtek-cli -- --version` | prints `mtek 0.1.0-dev (language 0.1, runtime ABI 1)` |

### Examples

| Directory | What it is |
|---|---|
| [`examples/pulse-cube`](examples/pulse-cube) | the `mtek new` scaffold: a rotating cube, one material, one host input (M3) |
| [`examples/material-configurator`](examples/material-configurator) | a multi-file configurator: a generated chair (GLB), PBR materials bound to host inputs, a custom fragment material, lights, a host page, and instanced legs (M4); its browser specs are the evidence for the M4 exit gate |
| [`examples/product-configurator`](examples/product-configurator) | an embedded sample storefront: one seven-part chair prefab instantiated twice, typed host inputs and scene outputs, keyboard-driven selection, a live quote, and disposal/remounting |
| [`examples/physics-playground`](examples/physics-playground) | a floor, a prefab crate, an impulse on Space, seeded crates on C, a sensor zone that counts them, crates destroyed below a height, and a bar bound to the count (M5); its browser spec is part of the M5 evidence |
| [`examples/modular-scene`](examples/modular-scene) | a five-file showroom: constants and one function, one material imported by three modules, two prefabs declared in other files and instantiated with different params, prefab state read by the scene, and a prefab of another file spawned on P (M7); its browser spec and `mtek test` fixtures are the M7 evidence |
| [`examples/arcade-audio`](examples/arcade-audio) | hit and score sounds, looping music, a global volume and a mute button (key N or a click on the speaker); the sounds are generated by `scripts/gen-sounds.mjs` (`spec/audio.md`, decision 0160); hearing it is a manual check |

Global setup of the browser tests builds the first five with the CLI (`tests/browser/support/m3-fixtures.ts`, `m4-configurator.ts`, `product-configurator.ts`, `m5-playground.ts`, `m7-modular-scene.ts`).

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
| `MTEK_EXPERIMENTAL_BROWSER=firefox` | adds the opt-in `firefox` project (headed Firefox with `dom.webgpu.enabled` and `gfx.webgpu.ignore-blocklist`; needs `npx playwright install firefox`); the default run does not include it (decision 0107) |
| `MTEK_BROWSER_ARGS` | extra Chromium arguments, space separated (for example `--disable-gpu` to simulate a machine without a GPU) |
| `MTEK_RESULTS_DIR` | results directory, default `tests/browser/results/<timestamp>` (JSON report and `environment-<project>.json`) |

The working configuration on the development machine is recorded in decision 0012 (amendment) and `evidence/environments/`.

#### Environments

Which browsers, operating systems and adapters the suite has been run on, with the result of each and what was not run, is [`docs/supported-environments.md`](docs/supported-environments.md); every row links to a stored run under `evidence/M7/environments/` and `npm run check:release` fails when the page lists something that has no stored run, a number that the run does not contain, or leaves out a stored record (decision 0107). To add an environment, run the suite there and store it:

```
MTEK_REQUIRE_GPU=1 MTEK_BROWSER_CHANNEL=chrome npm run test:browser           # an installed Chrome (or msedge)
node tests/browser/support/probe-browser.ts --browser firefox --name NAME --out DIR   # only ask a browser for an adapter
node tests/browser/support/summarize-run.ts DIR                                 # DIR holds test-results.json and the environment records
```

#### Reproducible builds

`node scripts/verify-reproducible-build.mjs --root <dir> --out <report.json> [--suite --gpu-lock <dir>]` makes two fresh clones of the current commit in two differently named directories, runs `npm ci` and `npm run build` in each, builds all examples in all four modes and prepares the runtime benchmark programs, then compares every output file byte for byte and searches the outputs for the clone paths (decision 0106; the stored run is [`evidence/M7/reproducible-builds.md`](evidence/M7/reproducible-builds.md)). With `--suite` it then runs the full test suite from the clean install of the first clone. It proves that two clones on the same machine agree; it does not prove anything across machines or operating systems.

#### `mtek test`

`mtek test [--allow-not-run] [--format human|json] [PATH]` runs the declarative fixtures `tests/*.test.toml` of a project (the six examples have theirs) in Chromium with the launch configuration of the hardware project (`spec/tooling.md` section 6, decision 0074, report schema `spec/test-report.schema.json`). A fixture that cannot run (no WebGPU adapter, no Playwright, no Node) is reported **NOT-RUN**, never as a pass; that exits 1 unless `--allow-not-run`. It uses the browser variables above and these:

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

## The `mtek` command

| Command | Purpose |
|---|---|
| `mtek new NAME` | scaffold a project (the Demo scene) |
| `mtek check [PATH]` | parse and type-check; no GPU needed |
| `mtek build [PATH]` | produce `dist/` (release, `--mode dev`, `test` or `preview`) |
| `mtek dev [PATH]` | build, serve, watch and hot reload |
| `mtek inspect --ir\|--bindings\|--shaders\|--assets` | what the compiler made of a project |
| `mtek fmt [--check] [PATHS]` | the canonical formatter |
| `mtek test [PATH]` | run a project's `tests/*.test.toml` in a browser |
| `mtek context --entry FILE --format json` | language and project context for AI agents |
| `mtek grammar export --format ebnf\|gbnf` | the grammar |
| `mtek lsp` | the language server |

Options, exit codes and the details of each command are in [`spec/tooling.md`](spec/tooling.md).

## Licence

All rights reserved — licence to be decided.
