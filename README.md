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
| `npm run check` | `cargo fmt --check`, `cargo clippy --workspace --all-targets --locked -- -D warnings`, `npm run check:ts`, `npm run lint`, `npm run check:naming` |
| `npm run check:ts` | `tsc -b` over all TypeScript projects |
| `npm run lint` | ESLint (`recommended-type-checked`, no `any`) |
| `npm run check:naming` | fails if the retired placeholder name appears outside the two decision records that explain the rename (decision 0017) |
| `npm run test:unit` | Vitest unit tests |
| `npm test` | `check`, then `cargo test --workspace --locked`, then `test:unit` |
| `cargo run -p mtek-cli -- --version` | prints `mtek 0.1.0-dev (language 0.1, runtime ABI 1)` |

Browser tests (`npm run test:browser`) do not exist yet (planned for M0, `spec/testing.md` section 6).

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
