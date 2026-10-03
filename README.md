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
| `npm run build` | bundle `@mtek/runtime-web` to `packages/runtime-web/dist/runtime.js`, then `cargo build -p mtek-cli --locked` |
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
