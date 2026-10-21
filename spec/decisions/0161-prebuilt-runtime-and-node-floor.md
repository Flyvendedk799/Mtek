# 0161. The prebuilt runtime in the CLI, and Node 22.18 as the floor

- Status: Accepted
- Date: 2026-10-21
- Supersedes: in decision 0032 item 10 and `spec/tooling.md` section 1, "a CLI built without `packages/runtime-web/dist` fails `build` with `E9030`" for a fresh clone; in decision 0007, the exact `engines` range `>=24 <25`.
- Small-game plan: phase 8, step 1.

## Context

`mtek-cli/build.rs` embeds `packages/runtime-web/dist/` and `packages/physics-rapier/dist/` when they exist. A fresh clone has neither, so `cargo build -p mtek-cli` gave an `mtek` whose `build` and `dev` fail with `E9030` until Node, `npm ci` and `npm run build` have run. For a game author who only wants the tool, Node is a large prerequisite. Separately, `engines: ">=24 <25"` with `engine-strict` made `npm ci` refuse Node 22 although nothing in the repository needs 24.

## Decision

1. **A prebuilt copy of the four bundles is checked in** at `crates/mtek-cli/prebuilt/`: `runtime.js`, `runtime.dev.js`, `runtime.d.ts` and `physics.js` (about 6 MB, most of it Rapier's WebAssembly), with `PROVENANCE.json` (sha256 and size of each file, and one hash of the sources they are built from).
2. **`build.rs` prefers `dist/`, then the prebuilt copy**, separately for the runtime and for physics. A checkout that builds the runtime therefore embeds exactly what it built, as before; a fresh clone embeds the prebuilt copy. `MTEK_RUNTIME_ORIGIN` (`dist` or `prebuilt`) is set for the binary's own tests. `E9030` stays in the catalogue for a binary built with neither (the prebuilt copy deleted).
3. **Staleness is a check, not a hope.** `scripts/prebuilt-runtime.mjs --check` (`npm run check:prebuilt`, part of `npm run check`) hashes the runtime and physics sources (every tracked or untracked file under `packages/runtime-web`, `packages/physics-rapier`, the manifest schema, its validator generator and `package-lock.json`, without tests, line endings normalised) and fails when they changed since `--write`. `--check --against-dist` additionally compares the bytes with a fresh `dist/`. `npm run build && npm run prebuilt:write` refreshes the copy; the Rust test `crates/mtek-cli/tests/prebuilt.rs` checks completeness and the recorded hashes without Node.
4. **Node.js `>=22.18.0`.** 22.18 is the first release that strips TypeScript types without a flag, which the tools rely on (`node tools/*/src/cli.ts`). `.nvmrc` stays `24`, the version CI and the recorded runs use. Measured: with Node 22.18.0, `npm run build -w @mtek/runtime-web -w @mtek/physics-rapier` produced bundles byte-identical to Node 24's (`prebuilt-runtime.mjs --check --against-dist` passed), and the release-docs generator ran.
5. `.gitattributes` marks the prebuilt bundles `-diff linguist-generated`, so a refresh is one line in a diff.

## Consequences

- Every change to the runtime needs a `prebuilt:write` before the commit, or `npm run check` fails. That is the price of a working fresh clone.
- The repository grows by about 6 MB per refresh of the physics bundle (it changes only when Rapier or the adapter does).
- Not verified: `npm ci` and the whole suite on Node 22 (only the bundle build and one generator were run).
