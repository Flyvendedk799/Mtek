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
| serde_json | =1.0.151 | JSON for layout records and the fixture type parser (`crates/mtek-compiler`); pulls itoa, memchr and zmij, fixed by `Cargo.lock` | M0-03 |
| ajv | 8.20.0 | **devDependency only**: `scripts/gen-manifest-validator.mjs` compiles `spec/manifest.schema.json` with `Ajv2020` standalone code generation (`code: { source: true, esm: true }`, `unicode: false`) into `packages/runtime-web/src/abi/generated/validate-manifest.js`, which is bundled into the runtime. Ajv is never imported at run time; the generator fails the build if the generated module imports it, and a test asserts that `dist/runtime.js` contains no `ajv`. npm nests it under `packages/runtime-web/node_modules` because ESLint needs Ajv 6 at the root. | M1-13 |

Versions were the latest stable releases on the npm registry on **2026-10-03**, with one deliberate exception: `typescript` **7.0.2** was the latest tag, but `typescript-eslint` 8.71.0 declares the peer range `typescript >=4.8.4 <6.1.0`, so the newest release in the supported range, **6.0.3**, is pinned. Moving to TypeScript 7 requires a typescript-eslint release that supports it and a superseding note here after a full green run. Rust crates: every external crate is listed in the table above with the task that added it; transitive crates are fixed by the committed `Cargo.lock`. Transitive npm dependencies (for example `vite` 8.3.2 via Vitest) are fixed by the committed `package-lock.json`. npm 11 reports that the `esbuild` postinstall script is not covered by `allowScripts`; the script is not run and esbuild works without it, which keeps the "no install-time lifecycle scripts" rule of `spec/testing.md` section 1.

`@playwright/test` is not part of this bootstrap (M0-02 does not create `tests/browser`); the task that creates the browser harness chooses and records its exact version.
