# 0007. Repository, toolchain and dependency policy

- Status: Accepted
- Date: 2026-10-03
- Blueprint origin: §13.

## Context

Blueprint §13 requires pinned, tested toolchains, a small Rust workspace and a small runtime package.

## Decision

- The repository root is the `mtek/` root of blueprint §13.
- Rust stable **1.99.0** (current stable, verified 2026-10-03) pinned in `rust-toolchain.toml`, edition 2024, Cargo resolver 3; `Cargo.lock` committed; CI uses `--locked`.
- Node.js **24 LTS** pinned (`.nvmrc`, `engines`); npm workspaces; `package-lock.json` committed; `save-exact`. Node 26 becomes LTS on 2026-10-28; moving to it requires a superseding record after a full green run.
- Exact versions of TypeScript, esbuild, Vitest, ESLint and `@playwright/test` (1.63.x current) are chosen at bootstrap and listed in the table below by the bootstrap task.
- Rust dependency allow-list and introduction milestones as in `spec/compiler-architecture.md` §2; Naga **30.0.1** with `wgsl-in`.
- Hygiene: `forbid(unsafe_code)`; Clippy with `-D warnings` and no `unwrap`/`expect`/`panic`/`todo` outside tests; TypeScript strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; no `any`.
- No `LICENSE` file is added until the repository owner chooses a licence (open question on the board); the README states "All rights reserved — licence to be decided".

**Dependency table** (filled by M0-02 and kept current by every task that adds a dependency):

| Name | Exact version | Purpose | Added by task |
|---|---|---|---|
| Rust (rustc, cargo, rustfmt, clippy) | 1.99.0 (b940084d7 2026-09-28) | compiler toolchain, pinned in `rust-toolchain.toml` | M0-02 |
| rustup | 1.29.1 | toolchain manager used on the bootstrap machine (not a project dependency) | M0-02 |
| Node.js | 24 (24.18.1 on the bootstrap machine) | JavaScript runtime for tooling and tests, pinned by `.nvmrc` and `engines` | M0-02 |
| npm | 11.16.0 (bundled with Node 24.18.1) | package manager, recorded in `packageManager` | M0-02 |
| typescript | 6.0.3 | strict type checking (`tsc -b`) of TypeScript packages | M0-02 |
| esbuild | 0.28.2 | bundles `@mtek/runtime-web` to `dist/runtime.js` | M0-02 |
| vitest | 5.0.3 | unit tests for TypeScript packages | M0-02 |
| @webgpu/types | 0.1.74 | WebGPU type declarations for the runtime | M0-02 |
| eslint | 10.12.0 | linting | M0-02 |
| typescript-eslint | 8.71.0 | typed ESLint rules (`recommended-type-checked`) | M0-02 |
| @eslint/js | 10.0.1 | ESLint recommended base rules | M0-02 |
| sha2 (Rust, `mtek-compiler`) | =0.11.0 (pinned with `=`; transitive crates fixed by `Cargo.lock`: digest 0.11.3, hybrid-array 0.4.15, typenum 1.20.1, block-buffer, crypto-common, const-oid, cpufeatures, cfg-if, libc) | SHA-256 content hash of every source file (`SourceFile::sha256`); allow-listed in `spec/compiler-architecture.md` section 2 from M1 | M1-01 |
| serde (feature `derive`) | =1.0.229 | serialisation of the layout record (`crates/mtek-compiler`); pulls serde_core, serde_derive, syn, quote, proc-macro2 and unicode-ident, all fixed by `Cargo.lock` | M0-03 |
| serde_json (Rust, `mtek-compiler`) | =1.0.151, feature `preserve_order` (transitive crates fixed by `Cargo.lock`: indexmap, itoa, memchr, serde_core, zmij) | JSON for layout records and the fixture type parser (M0-03); diagnostic envelopes and reports with keys in specification order (M1-02) | M0-03, M1-02 |
| naga (Rust, `mtek-compiler`, `default-features = false`, feature `wgsl-in`) | =30.0.1 | WGSL parser and validator (`ValidationFlags::all()`, `Capabilities::default()`): the layout oracle of `spec/gpu-layout.md` section 9.2 and the production validator of generated WGSL from M2 (`spec/compiler-architecture.md` section 8); normal dependency; pulls naga-types 30.0.1, arrayvec, bit-set, bit-vec, bitflags, cfg_aliases, codespan-reporting, half, hashbrown, indexmap, libm, log, num-traits, once_cell, rustc-hash, thiserror, unicode-ident, unicode-width, zerocopy and others, all fixed by `Cargo.lock` | M0-04 |
| libm (Rust, `mtek-compiler`) | =0.2.16 (already in `Cargo.lock` as a transitive dependency of naga; no new transitive crates) | pure-Rust `pow` for the exact sRGB transfer function of colour-literal defaults in the standard library registry (`crates/mtek-compiler/src/stdlib/value.rs`, `spec/language.md` section 5.4); the constant evaluator reuses it for transcendental functions (`spec/compiler-architecture.md` section 2) | M1-08 |
| ajv | 8.20.0 | (1) tests/browser (M0-07): JSON Schema validation of environment records (`tests/browser/environment.schema.json`); (2) runtime-web **devDependency only**: `scripts/gen-manifest-validator.mjs` compiles `spec/manifest.schema.json` with `Ajv2020` standalone code generation (`code: { source: true, esm: true }`, `unicode: false`) into `packages/runtime-web/src/abi/generated/validate-manifest.js`, which is bundled into the runtime. Ajv is never imported at run time; the generator fails the build if the generated module imports it, and a test asserts that `dist/runtime.js` contains no `ajv`. npm nests it under `packages/runtime-web/node_modules` because ESLint needs Ajv 6 at the root. | M0-07, M1-13 |
| @playwright/test | 1.63.0 | browser test runner for `tests/browser` (latest stable on 2026-10-03; 1.63.x as chosen in this record) | M0-07 |
| @types/node | 24.19.1 | Node 24 typings for the browser test harness (`tests/browser`, M0-07) and the codegen tests (`tests/codegen`, M0-05: `node:fs`, `node:child_process`, `node:url`); runtime-web devDependency for `src/runtime-dts.test.ts` (M1-14: `tsc --strict` over the host declarations, `node:child_process` to run the build), referenced only from that test file | M0-07, M0-05, M1-14 |
| Chromium for Testing (Playwright build) | 153.0.8010.12 (Playwright `chromium` v1243) | test browser, installed with `npx playwright install chromium` (not an npm dependency) | M0-07 |
| jsonschema (Rust, `mtek-compiler`, **dev-dependency only**) | =0.58.5 with `default-features = false` (no HTTP resolver, no TLS; transitive crates fixed by `Cargo.lock`, built for tests only) | validates every JSON diagnostic and report produced in `crates/mtek-compiler/tests/diagnostics_schema.rs` against `spec/diagnostic.schema.json` (JSON Schema draft 2020-12). Chosen over `ajv` in the Node suite because the diagnostics are produced in Rust, so the check runs in `cargo test --workspace --locked` with no extra build step; allow-listed in `spec/compiler-architecture.md` section 2 | M1-02 |
| three | 0.186.1 (latest on npm on 2026-10-03; `three/webgpu` and `three/tsl`) | **baseline only** (`benchmarks/baselines/m0-bridge`, `@mtek/baseline-m0-bridge`): the competent TypeScript + three.js WebGPU/TSL implementation of the M0 scenario against which Mtek is measured (decision 0001). Never a dependency of the runtime or compiler. | M0-09 |
| @types/three | 0.186.0 (the only 0.186.x release of `@types/three`; `three` 0.186.1 ships no TypeScript declarations, so strict `tsc` needs it and the H2 type-checking experiment measures nothing without it). Pulls `@dimforge/rapier3d-compat` 0.12.0, `@tweenjs/tween.js` 23.1.3, `@types/stats.js` 0.17.4, `@types/webxr` 0.5.24, `fflate` 0.8.3 and `meshoptimizer` 1.1.1 transitively, all fixed by `package-lock.json`. | type declarations for `three` in the baseline workspace (devDependency) | M0-09 |
| toml (Rust, `mtek-compiler`) | =1.1.6 (`spec-1.1.0`) with `default-features = false`, features `std` and `parse` (no `serde`, no `display`, no `preserve_order`); transitive crates fixed by `Cargo.lock`: serde_spanned 1.1.1, toml_datetime 1.1.1, toml_parser 1.1.3, toml_writer 1.1.2, winnow 1.0.4 (serde_core, indexmap are already in the lock file) | parses `mtek.toml` with `toml::de::DeTable`, which keeps a byte span for every key and value; the compiler walks the table by hand so that every `E9001` names the exact key path and line (`spec/tooling.md` section 3; validation rules in decision 0018). Allow-listed in `spec/compiler-architecture.md` section 2 from M1; the tables are sorted by key (no `preserve_order`), and all reporting order is by file position | M1-07 |
| clap (Rust, `mtek-cli`) | =4.6.7 (latest on crates.io on 2026-10-04, `rust-version` 1.85) with `default-features = false`, features `std`, `derive`, `help`, `usage`, `error-context`, `suggestions` (no `color`: usage errors are plain text, and the diagnostics' colour follows `spec/diagnostics.md` section 4 on its own); new crates fixed by `Cargo.lock`: clap_builder 4.6.7, clap_derive 4.6.7, clap_lex 1.1.1, anstyle 1.0.14, strsim 0.11.1 (heck, syn, quote and proc-macro2 were already in the lock file) | argument parsing of the `mtek` command line tool (`spec/tooling.md` section 1): subcommands, `--format`/`--mode`/`--target` value enums, help text, usage errors with exit code 2 and "did you mean" suggestions. Allow-listed in `spec/compiler-architecture.md` section 2 from M1; the compiler library does not depend on it | M1-19 |
| serde_json, jsonschema (Rust, `mtek-cli`, **dev-dependencies only**) | =1.0.151 (feature `preserve_order`) and =0.58.5 (`default-features = false`), the versions already in the table above; no new crates | the CLI integration tests (`crates/mtek-cli/tests/cli.rs`) parse the one JSON document the binary prints and validate every report against `spec/diagnostic.schema.json` | M1-19 |

Versions were the latest stable releases on the npm registry on **2026-10-03**, with one deliberate exception: `typescript` **7.0.2** was the latest tag, but `typescript-eslint` 8.71.0 declares the peer range `typescript >=4.8.4 <6.1.0`, so the newest release in the supported range, **6.0.3**, is pinned. Moving to TypeScript 7 requires a typescript-eslint release that supports it and a superseding note here after a full green run. Rust crates: every external crate is listed in the table above with the task that added it; transitive crates are fixed by the committed `Cargo.lock`. Transitive npm dependencies (for example `vite` 8.3.2 via Vitest) are fixed by the committed `package-lock.json`. npm 11 reports that the `esbuild` postinstall script is not covered by `allowScripts`; the script is not run and esbuild works without it, which keeps the "no install-time lifecycle scripts" rule of `spec/testing.md` section 1.

`@playwright/test` is not part of this bootstrap (M0-02 does not create `tests/browser`); the task that creates the browser harness chooses and records its exact version.
