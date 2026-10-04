# M1 completion report

- Milestone: **M1 — Compile source into a real browser scene** (blueprint §11, M1). The blueprint text still uses the retired placeholder name and file extension; the language is now Mtek with `.mtek` files ([decision 0017](../../spec/decisions/0017-language-name.md)).
- Gate task: M1-GATE
- Gate run: clean `git clone` of `main` at commit `909ae4b` (`git status` clean, `gitDirty: false` in every environment record), 2026-10-04
- Decision: **passed**. Each exit criterion and the guardrail below links to evidence from this gate run. Every rendering criterion was proved on a hardware WebGPU adapter (`isFallbackAdapter: false`). None rests on a NOT-RUN result or a software-adapter result.

## Implemented behaviour

| Work item | What now works | Proved by |
|---|---|---|
| M1-01 | Source manager: files, byte spans, BOM handling, line index, conversions between positions and spans | `crates/mtek-compiler/src/source/`, its unit tests, `tests/no_direct_io.rs` |
| M1-02 | Diagnostics core: code catalogue, JSON envelope and schema, human renderer with source excerpts | `tests/diagnostics_{catalogue,schema,render}.rs` (14 + 9 + 27 tests); `spec/diagnostic.schema.json` |
| M1-03 | Lexer: tokens, literals, comments, doc trivia, lexical diagnostics | `tests/lexer_{spec,fixtures,robustness}.rs`; `tests/syntax/lex/` (38 fixtures) |
| M1-04 | AST and Pratt expression parser, with AST dump fixtures | `src/syntax/parser/expr_tests.rs`; `tests/syntax/ast/` (52 fixtures) |
| M1-05 | Full parser for the **whole grammar**: items, members, statements, error recovery | `tests/fixtures.rs::every_production_has_a_fixture` and `::the_production_list_is_the_production_list_of_the_grammar` (checked against `spec/grammar.ebnf`); `tests/syntax/pass/` (95) and `tests/syntax/fail/` (196) |
| M1-06 | Deterministic fuzz-style robustness suite for the lexer and parser | `tests/robustness.rs` (9 tests by default, plus `fifty_thousand_cases`, which this gate also ran: see Tests run), `tests/lexer_robustness.rs` |
| M1-07 | Project loading: the `mtek.toml` model, entry discovery, module graph (entry module only) | `tests/project_loading.rs`; [decision 0018](../../spec/decisions/0018-project-file-validation.md) |
| M1-08 | Standard library registry and the generated `stdlib-schema.json` | `tests/stdlib_registry.rs` (23 tests), `tests/stdlib_schema.rs::generation_is_deterministic` |
| M1-09 | Name resolution: scopes, DefIds, no shadowing, milestone gating (`E9010`) | `tests/resolve_corpus.rs`; `tests/semantics/fail/e2*` |
| M1-10 | Types and constant evaluation for the M1 subset | `tests/consteval_{goldens,robustness}.rs`; `tests/semantics/fail/e3*` |
| M1-11 | Scene and schema checks: fields, cameras (exactly one active camera), entities, primitive meshes, Unlit | `tests/fixtures.rs` with `tests/semantics/pass` (10) and `tests/semantics/fail` (119, each with `expected.diag.json`), `tests/scene_robustness.rs` |
| M1-12 | Typed high-level IR of the scene subset, and `mtek inspect --ir` | `tests/ir_goldens.rs` (`ir_is_byte_identical_across_runs_and_shuffled_listings`); `tests/codegen/ir/` |
| M1-13 | Manifest schema and program ABI types shared by compiler and runtime | `tests/abi/manifests/` (2 valid, 57 invalid) tested by `packages/runtime-web/src/abi/abi.test.ts` and by `crates/mtek-compiler/tests/manifest_model.rs` (the Rust side was added in M1-17) |
| M1-14 | Runtime bootstrap: `mountMtek`, failure overlay, surface setup, frame-loop skeleton | `packages/runtime-web/src/host/*.test.ts`; `tests/browser/specs/mount.spec.ts` (12 on hardware) |
| M1-15 | Primitive meshes (Box, Sphere, Plane) and camera/transform matrices in the runtime | `packages/runtime-web/src/mesh/primitives.test.ts`, `src/math/mat4.test.ts` |
| M1-16 | Minimal shader IR, the standard vertex stage and the **temporary** compiler-built Unlit | `tests/unlit_shader.rs` (`unlit_is_byte_identical_across_builds_and_source_maps`), `tests/naga_oracle.rs`; [decision 0029](../../spec/decisions/0029-shader-ir-and-standard-stage-details.md) |
| M1-17 | JavaScript output and packaging: `app.js`, manifest, `index.html`, declarations, `dist/` | `tests/build.rs::builds_are_reproducible_including_with_shuffled_listings`; `tests/codegen/{scene_a_target_camera_box,scene_b_orthographic_nested}` and `app.test.ts` |
| M1-18 | Runtime scene rendering: meshes, frame and object blocks, pipelines, draw list | `packages/runtime-web/src/render/*.test.ts`; `mount.spec.ts` "draws the golden program's box…" on hardware |
| M1-19 | CLI: `mtek check`, `mtek build`, `mtek inspect --ir`, real file system, embedded runtime | `crates/mtek-cli/tests/cli.rs` (17), CLI unit tests (51) |
| M1-20 | `mtek dev` (basic): serve, watch, rebuild, full-page reload over SSE | `crates/mtek-cli/tests/dev.rs` (4 on Windows; 5 on Linux CI including `ctrl_c_stops_the_server_gracefully`); the gate probe below |
| M1-21 | Browser tests for the exit gate: two scenes, a transform change, renaming, failures before launch, visible failures | `tests/browser/specs/m1/{render,pre-launch,failures}.spec.ts`; [decision 0034](../../spec/decisions/0034-m1-gate-browser-tests.md) |
| M1-22 | Every diagnostic's `docs` link resolves to an anchor | covered by the diagnostics catalogue tests |

## Tests run

Gate run on 2026-10-04 from a clean `git clone https://github.com/Flyvendedk799/Mtek.git` checked out at `909ae4b`, in a temporary directory.

Toolchain: node v24.18.1 (put first on `PATH` explicitly; see Unsupported / remaining), npm 11.16.0, rustc 1.99.0, Naga 30.0.1, Playwright 1.63.0.

| # | Command | Duration | Result |
|---|---|---|---|
| 1 | `npm ci` | 5 s | exit 0 |
| 2 | `npm run build` | 26 s | exit 0 |
| 3 | `npm test` | 214 s | exit 0 (details below) |
| 4 | `cargo test --workspace --locked` (repeated alone so its output is captured) | 23 s | **949 passed, 0 failed, 1 ignored** ([`cargo-test-gate.txt`](cargo-test-gate.txt)). The ignored test is `robustness::fifty_thousand_cases`; see run 6. |
| 5 | `MTEK_REQUIRE_GPU=1 npm run test:browser:hardware` | 35 s | **98 passed / 0 failed / 0 not-run** on the hardware adapter ([`test-results-gate.json`](test-results-gate.json), [`environment-gate.json`](environment-gate.json)) |
| 6 | `cargo test -p mtek-compiler --test robustness --release --locked -- --ignored` | 36 s (including the release build) | `fifty_thousand_cases` **passed**: 50 000 generated inputs, no panic ([`robustness-50k-gate.txt`](robustness-50k-gate.txt)) |
| 7 | Gate probe: `mtek dev` serving a scene written for this gate, rendered in Chromium on the hardware adapter, with live edits | ~10 s | passed ([`dev-probe-gate.json`](dev-probe-gate.json)); see the guardrail row |

`npm test` runs `npm run check && cargo test --workspace --locked && npm run test:unit && npm run test:browser`:

- **`npm run check`:** passed. That covers `cargo fmt --check`, `cargo clippy --workspace --all-targets --locked -D warnings`, `tsc -b`, eslint, the naming check (1396 files) and `validate-tasks: OK`.
- **`cargo test`:** 949 passed, 0 failed, 1 ignored (the same as run 4).
- **`npm run test:unit`:**
  - runtime-web: 559 passed
  - browser harness: 76 passed
  - codegen: 94 passed
  - benchmarks: 74 passed, 1 skipped (see Unsupported)
  - baseline: 8 passed
- **`npm run test:browser`:** 203 passed / 0 failed / 0 not-run ([`test-results-gate-full.json`](test-results-gate-full.json)):
  - benchmarks: 7, on the hardware adapter
  - hardware: 98
  - software: 98 (informational)

Breakdown of run 5 (hardware project):

| Spec | Passed |
|---|---|
| `m1/render.spec.ts` | 4 (scene A, scene B, transform change, renaming) |
| `m1/pre-launch.spec.ts` | 2 (`e5001_unknown_entity_field`, `e3102_wrong_vector_dimension`) |
| `m1/failures.spec.ts` | 3 (ABI 99 → E8003, corrupted shader → E8051, no WebGPU → E8004) |
| `mount.spec.ts` | 12 |
| `bridge/probe.spec.ts` | 42 |
| `bridge/instances.spec.ts` | 14 |
| `bridge/counters.spec.ts` | 14 |
| `bridge/color.spec.ts` | 1 |
| `baselines/m0-bridge.spec.ts` | 3 |
| `env.spec.ts` | 3 |

`npm run evidence:sanitize` made the paths in the JSON reports repo-relative. In the two cargo logs, the clone's absolute path was replaced with `<repo>`. Nothing else was changed.

## Environments

| Record | Adapter | `isFallbackAdapter` | Commit |
|---|---|---|---|
| [`environment-gate.json`](environment-gate.json) (run 5, `requireGpu: true`, `acceptSoftware: false`) | AMD Radeon RX 7900 XTX (rdna-3) | **false** | `909ae4b`, clean |
| [`environment-gate-full-hardware.json`](environment-gate-full-hardware.json) (run 3) | AMD Radeon RX 7900 XTX | **false** | `909ae4b`, clean |
| [`environment-gate-full-benchmarks.json`](environment-gate-full-benchmarks.json) (run 3) | AMD Radeon RX 7900 XTX | **false** | `909ae4b`, clean |
| [`environment-gate-full-software.json`](environment-gate-full-software.json) (run 3) | SwiftShader (software) | true: informational only, no criterion relies on it | `909ae4b`, clean |
| [`dev-probe-gate.json`](dev-probe-gate.json) (run 7) | AMD Radeon RX 7900 XTX | false | `909ae4b` CLI |
| [`environment-m1-specs.json`](environment-m1-specs.json) (M1-21's own run, kept) | AMD Radeon RX 7900 XTX | false | M1-21 branch |

All hardware records share one setup:
- Windows 11 Pro 10.0.26200 x64
- Chromium for Testing 153.0.8010.12, new headless mode, with `--enable-unsafe-webgpu --ignore-gpu-blocklist --enable-webgpu-developer-features`
- Playwright 1.63.0

This is the configuration of decision 0012 (amendment).

## Exit gate checklist

| # | Criterion (blueprint M1) | Status | Evidence |
|---|---|---|---|
| 1 | Deliver: project skeleton, source spans, parser and type checker, small typed IR, JavaScript output, runtime bootstrap, one camera, one primitive mesh, an unlit material | **passed** | See Implemented behaviour. The parser covers the full grammar (`every_production_has_a_fixture`). Three primitive meshes exist (Box, Sphere, Plane), as does the temporary Unlit (remaining item 1). All suites listed there passed in runs 3 and 4. |
| 2 | `mtek check`, `mtek build` and basic `mtek dev` exist | **passed** | `mtek --help` lists `check`, `build`, `inspect` and `dev`. `crates/mtek-cli/tests/cli.rs` 17/17 and `tests/dev.rs` 4/4 passed. Run 7 used `mtek dev` on the hardware adapter: it served, rebuilt on an edit (20 ms) and reloaded the page. |
| 3 | A checked-in `.mtek` fixture builds from a clean checkout and renders through WebGPU | **passed** | Global setup of run 5 builds the CLI and runs `mtek build --mode test` on every `tests/browser/fixtures/m1/*` in the fresh clone; a non-zero exit fails the run. `m1/render.spec.ts` scene A (`scene_a_target_camera_box`) passed on hardware. The centre pixel (64, 64) read back rgb(107,92,255), the expected Unlit `#6b5cff`. The grid matches the CPU reference at 976 clear-colour samples and 29 box samples, with 0 mismatches. |
| 4 | Changing its declared transform changes the output | **passed** | `render.spec.ts` "changing A's declared position…" passed on hardware. The box's footprint centroid moved from (64.00, 64.96) to (98.27, 48.40), a measured shift of (34.27, −16.56) px. The CPU-predicted shift was (33.11, −16.06) px. The old centre now shows the clear colour and the new centre the box colour. Run 7 shows the same with `mtek dev` on a scene that is not checked in: adding `position: vec3(0.0, 2.5, 0.0)` moved the `Dock` centroid from y=123 to y=73.9. |
| 5 | An unknown field and a wrong vector dimension fail before launch with source spans | **passed** | `m1/pre-launch.spec.ts` 2/2. `mtek check --format json` exits 1 with exactly one report that is valid against the schema. It contains the expected `MTEK-E5001` (bytes 58–65, `positon`, "did you mean 'position'?") and `MTEK-E3102` (bytes 68–82, expected vec3, found vec2). Line and column agree with the byte offsets. `mtek build` refuses both and writes no output directory. The human renderer in this gate showed `src/main.mtek:4:9` and `src/main.mtek:4:19` with carets. |
| 6 | The browser reports failures visibly rather than drawing an unexplained empty page | **passed** | `m1/failures.spec.ts` 3/3 on hardware. Each case shows a visible `role="alert"` overlay over the canvas (within 1 px) that names the code: E8003 (runtime ABI 99), E8051 (corrupted shader; the overlay shows the material declaration's `file:line:column`) and E8004 (no `navigator.gpu`). `mount.spec.ts` adds manifest-invalid, device-failed and shader-failed. Run 7: a broken edit under `mtek dev` showed "mtek: build failed … src/main.mtek:11:16: error[MTEK-E3102]" on the page instead of an empty canvas. |
| 7 | Guardrail: no hard-coded "if input contains Cube" demo path; at least two structurally different scene fixtures compile and render | **passed** | **Two structurally different scenes on hardware.** Scene A has a perspective camera with a `target` and one Box. Scene B has an orthographic camera with a `rotation`, a Plane with a nested, non-uniformly scaled Sphere, a second Sphere with the default material, module constants in fields, and a 256×160 target. Both compile and match the CPU reference: for B, 920 clear, 1494 Ground and 34 Fountain grid samples with 0 mismatches, plus the Lamp centre. **Renaming test:** renaming A's scene, camera and entity (`Showroom`/`Lens`/`Parcel`) gives a byte-identical readback. **Grep of non-test code:** I searched `crates/*/src` and `packages/runtime-web/src` for Crate, Gallery, Courtyard, Ground, Fountain, Lamp, Cube, Main, Overhead, Showroom, Parcel and Lens. Every hit is in a `#[cfg(test)]` module, a `*_tests.rs` file, or a doc comment (`ir/model.rs:39-40`, `stdlib/data/schemas.rs:34`, `syntax/ast.rs:333`, `runtime-web/src/abi/manifest-types.ts:14`). None is in a code path. **Third scene:** run 7 used a scene written for this gate that is not in the repo (`Harbour`/`Eye`/`Dock`/`Buoy`/`Sea`). It compiled and rendered every declared colour on hardware, with 0 unexpected pixels. |

**Temporary Unlit path.** `crates/mtek-compiler/src/lowering/builtin_unlit.rs:1` and `crates/mtek-compiler/src/lowering/mod.rs:11` both start with `// TEMPORARY (decision 0013): removed in M2-09`. The module documentation says that M2-09 replaces it with the prelude's `Unlit` compiled from source, and that the M2 gate checks the file is gone. It is listed under remaining item 1.

**Code-quality spot check across M1:**
- **No panics in the robustness suites.** `robustness.rs` covers random bytes, random token sequences and mutated corpus files. `lexer_robustness.rs`, `scene_robustness.rs` and `consteval_robustness.rs` also pass. The parser unit tests for truncation, token swaps and deletion pass, and the 50 000-case run (run 6) passes. The CLI turns any internal panic into `E9999` (`guard::tests::a_panic_is_caught_with_its_message`, `commands::tests::a_panic_becomes_e9999_in_both_formats`).
- **No `unwrap`/`expect`/`panic!`/`todo!` outside tests.** The workspace lints deny `unwrap_used`, `expect_used`, `panic`, `todo` and `unimplemented`, and forbid `unsafe_code`. Both crates inherit them (`[lints] workspace = true`). `clippy.toml` relaxes them only in tests, and clippy runs with `--all-targets -D warnings` in `npm run check`. A text scan of `crates/*/src` outside `#[cfg(test)]` modules found no occurrences. `#![allow(clippy::unwrap_used, …)]` appears only in files under `crates/*/tests/`.
- **Determinism.** `tests/determinism.rs::no_hash_collections_in_output_producing_modules` passes. So do `build.rs::builds_are_reproducible_including_with_shuffled_listings`, `ir_goldens.rs::ir_is_byte_identical_across_runs_and_shuffled_listings`, `fixtures.rs::semantic_results_are_deterministic`, `unlit_shader.rs::unlit_is_byte_identical_across_builds_and_source_maps`, `stdlib_schema.rs::generation_is_deterministic` and `robustness.rs::the_generator_is_deterministic_and_platform_independent`.
- **TypeScript.** `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on in `packages/runtime-web` and `tests/browser`. `@typescript-eslint/no-explicit-any` is set to `error`, and there are no `any`, `@ts-ignore` or `@ts-expect-error` in the sources. The three `eslint-disable-next-line` comments in test code each carry a reason.
- **CI on `main`.** `gh run list` shows the last 8 pushes to `main`, through the merges of M1-11 … M1-21, all `success`. Run 37214546202, for `909ae4b` itself, passed rust (ubuntu and windows), node and browser-software.

## Deviations from the spec

Each deviation is recorded in a decision record or a spec commit:

- [0018](../../spec/decisions/0018-project-file-validation.md) (M1-07): `mtek.toml` value ranges and shapes; diagnostics for that file have `source: null` and give the key path.
- [0019](../../spec/decisions/0019-manifest-spans-carry-line-columns.md) (M1-14): manifest spans carry 1-based line and column, and the runtime copies them verbatim.
- [0020](../../spec/decisions/0020-m1-runtime-interim-behaviour.md): device loss is terminal (`W8060`) until M4-09.
- [0022](../../spec/decisions/0022-parser-nesting-limit-counts-tree-height.md) (M1-04): the nesting limit also caps expression-tree height.
- [0023](../../spec/decisions/0023-parser-conventions-for-the-full-grammar.md) (M1-05): parser conventions, including `material` accepted as a field name, which contradicts `grammar.ebnf`.
- [0024](../../spec/decisions/0024-stdlib-registry-details.md) (M1-08): stdlib registry details. `color.srgb` is const-eligible, so its folded result may differ in the last bit from the run-time result of M2-06.
- [0025](../../spec/decisions/0025-name-resolution-and-milestone-gating.md) to [0028](../../spec/decisions/0028-typed-ir-and-public-api-details.md) (M1-09 to M1-12):
  - name resolution and milestone gating;
  - the operators that wait for M2;
  - `E5013` for a lone inactive camera;
  - the `check()`/`analyze()` split.
- [0029](../../spec/decisions/0029-shader-ir-and-standard-stage-details.md) (M1-16): the `validate` signature, optional `ShaderArtifact.layout`, and the temporary Unlit.
- [0030](../../spec/decisions/0030-code-generation-and-packaging-details.md) (M1-17):
  - The Node execution test imports the golden `app.js` with a stand-in runtime module, not the real bundle that `spec/testing.md` §4.1 requires. This must change in M2.
  - `std/` is reserved.
  - There is no `rt` import until M2.
- [0031](../../spec/decisions/0031-runtime-scene-rendering-details.md) (M1-18):
  - only the M1 subset of `ctx`;
  - camera relations are checked after `init`;
  - one parameter block per instance until M4.
- [0032](../../spec/decisions/0032-command-line-tool-details.md) (M1-19): the colour decision follows stderr, but `spec/diagnostics.md` §4 still says stdout. New code `E9031`.
- [0033](../../spec/decisions/0033-development-server-details.md) (M1-20): the dev reload client shows a build-failure overlay, which goes beyond 0030 item 9.
- [0034](../../spec/decisions/0034-m1-gate-browser-tests.md) (M1-21): scene B renders at 256×160, and the guardrail is also tested by behaviour (the renaming test).
- Spec commits `065576b` (M1-02: the diagnostic header shows the message, and `source: null` for unloaded files) and `28768eb` (M1-03: `////` is an ordinary comment).

## Unsupported / remaining

1. **Temporary Unlit path.** `crates/mtek-compiler/src/lowering/builtin_unlit.rs` is marked `// TEMPORARY (decision 0013): removed in M2-09`. Until M2-09, `Unlit` is not compiled from `std/materials.mtek`. `E6100` cannot be reached by any program and is covered by unit tests only.
2. **`mtek dev` Ctrl+C on Windows is untested.** `ctrl_c_stops_the_server_gracefully` is `#[cfg(unix)]`. It passes on Linux CI (run 37214546202, jobs rust ubuntu and node), but the Windows `tokio::signal::ctrl_c` path has no automated test. Large `node_modules` trees may need a higher inotify limit (0033 item 11). Hot reload comes in M3 and the full overlay in M4.
3. **Node version on the development machine.** `PATH` finds Node 22 before Node 24, while `package.json` declares `engines.node ">=24 <25"`, and npm does not enforce `engines` by default. The gate put Node 24.18.1 first explicitly. Recommendation: add `engine-strict=true` in `.npmrc` or a version preflight in `scripts/`. `npm ci` also warns that esbuild's postinstall script is not covered by `allowScripts`.
4. **Decision 0032 has the M1-20 and M1-21 labels swapped.** Its Consequences say "M1-20 (browser fixtures)" and "M1-21 (`mtek dev`)", but M1-20 is `mtek dev` and M1-21 is the browser gate. 0030 (line 33) and 0031 (line 29) carry the same wrong "M1-20 (browser fixtures)" label. Recommendation: a spec chore to correct the labels. No behaviour depends on them.
5. **M1-13 board feature "Shared valid/invalid example manifests tested on both sides" is still unticked.** The tests exist on both sides, but the Rust side arrived with M1-17. The Rust test does not check the expected `field`, and asserts nothing for the 5 `E8003` cases (`manifest_model.rs`, `Some("E8003") => {}`). Recommendation: a small follow-up to tighten `manifest_model.rs` and tick the feature.
6. **Stale comment.** `packages/runtime-web/src/schedule/scheduler.ts:5` and `:28` say phases 1–6 do nothing until M3, but `host/app.ts` implements phases 1 and 6. Fix it in passing.
7. **Deferred by design:**
   - source maps for expressions (M2-07);
   - `inspect --bindings`/`--shaders` (M2);
   - the operators `%`, comparisons, equality and logic (M2);
   - preview mode (`E9010` until M6);
   - candidate edits in diagnostics (M6-02);
   - device-loss recovery (M4-09);
   - shared parameter blocks and culling (M4);
   - the module graph beyond the entry module.
8. **`mtek-cli` rebuilds on every Cargo call while the runtime bundle is missing.** Restored files with old timestamps can also be missed (0032).
9. **The pre-launch criterion is verified through the CLI** (`mtek check` and `mtek build`, which write no output), not by loading a page. This matches "before launch". Run 7 also shows `mtek dev` refusing the build and displaying the error.
10. **One skipped unit test:** `benchmarks/tools/hash-holdout.test.ts` "rejects symbolic links". Creating a symbolic link needs a Windows privilege. No criterion depends on it.
11. **Holdout exposure.** Chore `836dc4c` (merge `3262b48`) records that one holdout reference file was exposed. It recommends replacing that holdout task before M6.
12. **Single hardware machine.** All hardware evidence comes from one Windows 11 machine with an AMD RX 7900 XTX. The render and shader-failure specs report NOT-RUN on machines without a GPU (0034 item 9).
13. **Software-adapter results** (SwiftShader, 98/98) are informational. No criterion is passed on them.
