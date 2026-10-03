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
| (none yet) | | | |
