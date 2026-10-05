# M2 completion report

- Milestone: **M2 — Implement the typed CPU/GPU contract** (blueprint §11, M2). The blueprint text still uses the retired placeholder name; the language is Mtek with `.mtek` files ([decision 0017](../../spec/decisions/0017-language-name.md)).
- Gate task: M2-GATE
- Gate run: clean `git clone` of the local `main` at commit `d5d18ff` (`gitCommit` in every gate environment record, `gitDirty: false`), 2026-10-05. **The commit has not been pushed**, so no CI run of it exists and none is cited.
- Decision: **passed**. Each exit criterion and the guardrail below links to evidence from this gate run. Every rendering criterion was proved on a hardware WebGPU adapter (`isFallbackAdapter: false`, AMD Radeon RX 7900 XTX). None rests on a NOT-RUN result or a software-adapter result.

## Implemented behaviour

| Work item | What now works | Proved by |
|---|---|---|
| M2-01 | The complete type system: numeric and spatial types (`f32 i32 u32 bool`, `vec2/3/4`, `quat`, `color`, `mat4`, structs, fixed arrays), every operator of `spec/language.md` §6.2, conversions, constant evaluation | `crates/mtek-compiler/src/types/` unit tests; `tests/consteval_goldens.rs`; `tests/semantics/pass/types/op_*` (one fixture per row) and `tests/semantics/fail/types/`; [decision 0035](../../spec/decisions/0035-complete-type-system-details.md) |
| M2-02 | Pure functions, statements, effects: `fn` / `cpu fn`, `let`/`var`, `if`, bounded loops, recursion rejected, reachability from CPU and GPU roots | `tests/semantics/{pass,fail,gpu}/functions/` (a fixture per rule), `src/types/effects_tests.rs`, `tests/function_robustness.rs`; [0038](../../spec/decisions/0038-functions-statements-and-effects-details.md) |
| M2-03 | Module resolution: `import`/`export`, path rules, depth-first load order, cycles, same-named declarations of two modules | `tests/modules.rs` (10 tests), `src/project/specifier.rs`, `tests/semantics/{pass,fail}/modules_*`, `e2030`–`e2036`; [0036](../../spec/decisions/0036-modules-details.md) |
| M2-04 | Materials in the checker: params with defaults and update classes, the fragment stage, `SurfaceInput`, the capture and reachability rules (`E4040`, `E4002`, `E4010`, `E4011`), opaque colours | `tests/semantics/{pass,fail}/materials/` (a fixture per rule), IR goldens `materials_pulse`, `materials_params_and_defaults`; [0039](../../spec/decisions/0039-materials-in-the-checker-details.md) |
| M2-05 | Shader lowering: typed IR to shader IR to WGSL; the generated vertex stage and fragment wrapper; helpers; span maps; Naga validation of every material | `tests/shader_lowering.rs` (7 tests: goldens of Pulse, structs/arrays/bools, loops, quaternions, scalar semantics, same-named structs; every material of every fixture validated and deterministic), `tests/wgsl_blocks.rs`, `tests/naga_oracle.rs`; [0041](../../spec/decisions/0041-shader-lowering-details.md) |
| M2-06 | The runtime math library `rt`: value helpers for every CPU operation with WGSL-matching semantics | `packages/runtime-web/src/math/*.test.ts` (680 runtime unit tests in all), `conformance.test.ts` (every `cpu.json` row against `rt`); [0037](../../spec/decisions/0037-runtime-math-library-details.md) |
| M2-07 | The CPU emitter: typed IR to JavaScript with source maps, executed against the real runtime bundle | `tests/build.rs`, `tests/js_source_map.rs` (every emitted statement mapped), `tests/codegen/exec.test.ts` (981 codegen tests), `tests/codegen_cpu_table.rs`; [0040](../../spec/decisions/0040-cpu-emitter-details.md) |
| M2-08 | CPU/GPU numeric conformance: every row of the CPU table evaluated on the GPU through the compiler's own WGSL and compared with WGSL's accuracy rules | `tests/browser/specs/numeric/conformance.spec.ts` on hardware and software; [0043](../../spec/decisions/0043-numeric-conformance-details.md) |
| M2-09 | Prelude materials compiled from source (`std/materials.mtek`), the resource plan from the IR, `mtek inspect --shaders` and `--bindings` | `tests/unlit_shader.rs`, `tests/inspect_views.rs` (6 tests), `src/plan/tests.rs`; [0044](../../spec/decisions/0044-prelude-materials-resource-plan-and-inspect-views.md) |
| M2-10 | The runtime supports any compiled material: one arena per layout id, writers by layout id, per-instance bind groups, a pipeline per shader, `debug.setParam`, and a defined behaviour for a material that fails after mount | `packages/runtime-web/src/render/materials.test.ts`, `renderer.test.ts`, `host/shaders.test.ts`; [0046](../../spec/decisions/0046-runtime-materials-set-param-and-failed-materials.md) |
| M2-11 | `tools/grammar-coverage` and the grammar freeze: every production (73), top-level alternative (116) and `[S: …]` rule (11) of `spec/grammar.ebnf` is covered by a positive or negative fixture | `tools/grammar-coverage/tests/coverage.rs` (5 tests, part of `cargo test --workspace`); [0042](../../spec/decisions/0042-grammar-coverage-and-freeze.md) |
| M2-12 | Browser tests for the exit gate: Pulse, rejections, mixed layout, shader failures | `tests/browser/specs/m2/*.spec.ts` (16 specs); [0048](../../spec/decisions/0048-m2-gate-browser-tests.md); [`m2-specs.md`](m2-specs.md) |
| M2-13 | Assignable struct fields and array elements (owner decision of 2026-10-04): `p.offset = …`, `arr[i] = …`, nested forms, compound assignment; run-time write indices clamped exactly like reads, on the CPU and the GPU | `src/types/tests.rs`, `tests/codegen/assignable_places/` (`exec.json` with in-range, negative and too-large indices and their `W8030`), `tests/semantics/{pass,fail}/functions/*places*`; [0045](../../spec/decisions/0045-assignable-struct-fields-and-array-elements.md) |
| M2-14 | CPU/GPU numeric agreement (owner decisions of 2026-10-05): WGSL's conversion saturation on the CPU, in folded constants and on the GPU; `mix` and `normalize` lowered to helpers in the CPU's operation order | `tests/semantics/numeric/cpu.json`, `numeric-conformance-gate-hardware.json`; [0047](../../spec/decisions/0047-numeric-agreement-conversion-clamp-and-cpu-order-helpers.md) |

## Tests run

Gate run on 2026-10-05 from a clean `git clone` of the local `main` into a new directory, at `d5d18ff`, with the logs kept outside the clone.

Toolchain: node v24.18.1 (put first on `PATH` explicitly; see Unsupported / remaining), npm 11.16.0, rustc 1.99.0, Naga 30.0.1, Playwright 1.63.0. Windows 11 Pro 10.0.26200 x64.

| # | Command | Duration | Result |
|---|---|---|---|
| 1 | `npm ci` | 12 s | exit 0 |
| 2 | `npm run build` | 32 s | exit 0 |
| 3 | `npm test` | 263 s | exit 0 (details below) |
| 4 | `cargo test --workspace --locked` (repeated alone so its output is captured) | 39 s | **1116 passed, 0 failed, 1 ignored** ([`cargo-test-gate.txt`](cargo-test-gate.txt)). The ignored test is `robustness::fifty_thousand_cases`; see run 6. |
| 5 | `MTEK_REQUIRE_GPU=1 npm run test:browser:hardware` | 40 s | **117 passed / 0 failed / 0 not-run** on the hardware adapter ([`test-results-gate.json`](test-results-gate.json), [`environment-gate.json`](environment-gate.json)) |
| 6 | `cargo test -p mtek-compiler --test robustness --release --locked -- --ignored` | 44 s (including the release build) | `fifty_thousand_cases` **passed**: 50 000 generated inputs, no panic ([`robustness-50k-gate.txt`](robustness-50k-gate.txt)) |

`npm test` runs `npm run check && cargo test --workspace --locked && npm run test:unit && npm run test:browser`:

- **`npm run check`:** passed. That covers `cargo fmt --check`, `cargo clippy --workspace --all-targets --locked -D warnings`, `tsc -b`, eslint, the naming check (2028 files) and `validate-tasks: OK`.
- **`cargo test`:** 1116 passed, 0 failed, 1 ignored (the same as run 4).
- **`npm run test:unit`:**
  - runtime-web: 680 passed
  - browser harness: 102 passed
  - codegen: 981 passed
  - benchmarks: 74 passed, 1 skipped (see Unsupported)
  - baseline: 8 passed
- **`npm run test:browser`:** 241 passed / 0 failed / 0 not-run ([`test-results-gate-full.json`](test-results-gate-full.json)):
  - benchmarks: 7, on the hardware adapter
  - hardware: 117
  - software: 117 (informational)

Breakdown of run 5 (hardware project):

| Spec | Passed |
|---|---|
| `m2/pulse.spec.ts` | 1 (seven phases, pixels against the CPU, constant pipeline counters) |
| `m2/rejections.spec.ts` | 10 (nine `E4040`/`E4002` fixtures, one GPU-only built-in from CPU code) |
| `m2/mixed-layout.spec.ts` | 2 (manifest layout equals the golden; round trip in a real scene) |
| `m2/failures.spec.ts` | 3 (corrupted shader, misspelled call, uncorrupted mounts) |
| `numeric/conformance.spec.ts` | 3 (compiled helpers, helper families, every portable row) |
| `m1/render.spec.ts`, `m1/pre-launch.spec.ts`, `m1/failures.spec.ts` | 4, 2, 3 (the M1 specs still pass) |
| `mount.spec.ts` | 12 |
| `bridge/probe.spec.ts`, `instances`, `counters`, `color` | 42, 14, 14, 1 |
| `baselines/m0-bridge.spec.ts` | 3 |
| `env.spec.ts` | 3 |

`npm run evidence:sanitize` made the paths in the JSON reports repo-relative. In the cargo logs, the clone's absolute path was replaced with `<repo>` and terminal colour codes were removed. Nothing else was changed.

## Environments

| Record | Adapter | `isFallbackAdapter` | Commit |
|---|---|---|---|
| [`environment-gate.json`](environment-gate.json) (run 5, `requireGpu: true`, `acceptSoftware: false`) | AMD Radeon RX 7900 XTX (rdna-3) | **false** | `d5d18ff`, clean |
| [`environment-gate-full-hardware.json`](environment-gate-full-hardware.json) (run 3) | AMD Radeon RX 7900 XTX | **false** | `d5d18ff`, clean |
| [`environment-gate-full-benchmarks.json`](environment-gate-full-benchmarks.json) (run 3) | AMD Radeon RX 7900 XTX | **false** | `d5d18ff`, clean |
| [`environment-gate-full-software.json`](environment-gate-full-software.json) (run 3) | SwiftShader (software) | true: informational only, no criterion relies on it | `d5d18ff`, clean |
| [`environment-m2-specs.json`](environment-m2-specs.json) (M2-12's own run, kept) | AMD Radeon RX 7900 XTX | false | M2-12 branch |

All hardware records share one setup: Chromium for Testing 153.0.8010.12, new headless mode, with `--enable-unsafe-webgpu --ignore-gpu-blocklist --enable-webgpu-developer-features` (decision 0012, amendment).

## Exit gate checklist

| # | Criterion (blueprint M2) | Status | Evidence |
|---|---|---|---|
| 1 | Deliver: numeric and spatial types | **passed** | M2-01 row above; `tests/semantics/pass/types/op_*` and `fail/types/`; `numeric/conformance.spec.ts` on hardware: **330 bit-exact rows** (315 identical, 15 differing only where a quoted WGSL rule permits: 9 zero-sign, 6 flush-to-zero) and **220 tolerance rows** (220 within the WGSL bound), 0 failures, 0 spec-disagreement rows, 0 known deviations ([`numeric-conformance-gate-hardware.json`](numeric-conformance-gate-hardware.json)). The M2-14 decision record has the before/after counts. |
| 2 | Deliver: pure functions | **passed** | M2-02 row; `tests/semantics/*/functions/`; `tests/codegen/exec.test.ts` runs the generated functions against the real runtime bundle; the same functions lowered to WGSL are in the numeric probe (every function of `cpu.json`), compared on hardware. |
| 3 | Deliver: module resolution | **passed** | M2-03 row; `tests/modules.rs` 10/10 including `modules_load_depth_first_in_import_order_whatever_the_listing_order`, `same_named_materials_of_two_modules_build_to_distinct_names`. |
| 4 | Deliver: material parameters | **passed** | M2-04 row; `fixtures/m2/pulse` and `fixtures/m2/mixed_layout` build and render; `m2/pulse.spec.ts` and `m2/mixed-layout.spec.ts` on hardware. |
| 5 | Deliver: fragment functions | **passed** | `tests/semantics/pass/materials/`; `m2/pulse.spec.ts`: the fragment of `Pulse` produced `rgb(87,75,211)` at phase 0 (expected the same) and tracked `tint * (0.65 + 0.35 * sin(phase))` within 3/255 at seven phases. |
| 6 | Deliver: shader IR | **passed** | M2-05 row; `lowering/shader_ir.rs` is a closed typed node set (see the guardrail); `every_golden_material_matches_its_expected_wgsl`. |
| 7 | Deliver: Naga validation | **passed** | `tests/naga_oracle.rs` 6/6; `every_material_of_every_fixture_lowers_validates_and_is_deterministic`; every `mtek build` validates its WGSL (`E6100` is a compiler defect, covered by `src/emit_wgsl/validate.rs`). |
| 8 | Deliver: shared layout generation | **passed** | `tests/gpu_layout.rs` 8/8 (`computed_layouts_equal_the_hand_maintained_goldens`), `tests/js_writers.rs`, `tests/wgsl_blocks.rs`; on hardware `bridge/probe.spec.ts` 42/42 (every layout fixture read back bit-exactly through its typed WGSL path), `bridge/instances.spec.ts` 14/14, `bridge/counters.spec.ts` 14/14. |
| 9 | Deliver: source mappings | **passed** | `tests/js_source_map.rs` (`app_js_maps_every_emitted_statement_and_expression`), `shader_lowering.rs::span_map_entries_resolve_to_the_source_they_come_from`, `the_pulse_span_map_points_at_each_piece_of_the_material`; `m2/failures.spec.ts` shows both maps in the browser (criterion 14). |
| 10 | Deliver: the implemented grammar subset is frozen with positive and negative fixtures | **passed** | `tools/grammar-coverage/tests/coverage.rs` 5/5, in `cargo test --workspace` (run 4): 73 productions, 116 alternatives and 11 rules covered, the counts pinned; fixtures `tests/syntax/pass` (95), `tests/syntax/fail` (200), `tests/semantics/pass` (68 projects), `tests/semantics/fail` (212 projects). The frozen subset is recorded in `spec/grammar-notes.md`; [0042](../../spec/decisions/0042-grammar-coverage-and-freeze.md). |
| 11 | Exit: the `Pulse` material runs with a changing parameter | **passed** | `m2/pulse.spec.ts` on hardware: seven writes through `app.debug.setParam` (0.5, π/2, 2.0, π, 4.0, 5.5, 0.0), four interior pixels per frame match the CPU expectation (phase 0.5: expected `rgb(97,83,233)`, actual `rgb(97,84,233)`), the corners stay the clear colour, `pipelinesCreated` and `shaderModulesCreated` stay at 1, no bind group is created, every write is exactly one upload. `bind` is M3, so the parameter is changed through the test hook of [0046](../../spec/decisions/0046-runtime-materials-set-param-and-failed-materials.md). |
| 12 | Exit: invalid captures and CPU-only function calls from shader code are rejected | **passed**, with one note | `m2/rejections.spec.ts` 10/10: `mtek check --format json` exits 1 with one schema-valid report whose codes, byte spans, line/columns, messages and notes equal the fixtures' `expected.diag.json`, and `mtek build --mode test` refuses and writes nothing, for `E4040` (a fragment captures scene state, `frame.time`, an entity field, `self`, or calls a `cpu fn`) and `E4002` (shader code or a pure `fn` reaches a `cpu fn` directly, through a chain, through a pure `fn` or through an import). **Note:** `E4013` (a GPU-only built-in from CPU code) cannot be produced by any program this build accepts, because every GPU-only built-in is planned for M4; a `cpu fn` that calls `sample` is rejected as `E9010` (asserted), and the `E4013` rule itself is covered by `src/types/effects_tests.rs` (listed as unreachable in `tests/fixtures.rs`). See remaining item 1. |
| 13 | Exit: mixed-layout round trips pass | **passed** | `m2/mixed-layout.spec.ts` 2/2 on hardware: the built manifest's layout of the material equals `tests/gpu-layout/mixed.layout.json` (size 64, align 16, every member); in a real scene the fragment reads `f32`, `vec3`, `u32`, `vec2`, `bool`, `color` through their typed paths and compares them with the exact constants the CPU wrote (`Match` white, `Mutated` black), and fourteen run-time writes (including `b.z` by one binary32 step and `c` by one) turn exactly the matching channel black and back. Plus the M0 layout probes of criterion 8. |
| 14 | Exit: browser shader failures identify the originating declaration | **passed** | `m2/failures.spec.ts` 3/3 on hardware: a non-WGSL line appended to the `Pulse` shader rejects `mountMtek` with `shader-failed` (`E8051`) and the diagnostic is the `material Pulse` declaration (file, line and column read from the source); a misspelled `sin(` inside the Mtek function `pulse` is reported on the `0.65 + 0.35 * sin(t)` expression of `src/main.mtek` with a "generated from" note; the overlay shows the location in both; `mount.spec.ts` adds the other mount failures. |
| 15 | Guardrail: do not represent ordinary shader logic as untyped strings | **passed** | `lowering/shader_ir.rs` defines the shader as typed nodes (`ShaderType`, `ExprKind` with literals, locals, fields, swizzles, constructors, binary and unary operators, indexing, bitcasts, calls and intrinsics from a closed `Intrinsic` list, statements); `lowering/shader.rs` and `shader/helpers.rs` build only those nodes; the only code that produces text is `emit_wgsl/printer.rs`, from the IR. A scan of `lowering/` for `format!`, `push_str` and `write!` finds only generated identifiers (`mtek_each_<name>`, `mtek_mix_<shape>`, `<hash8>_<name>`) and error messages; no user expression, statement or built-in call is assembled from a string. The probe's argument decoding (`emit_wgsl/blocks.rs`, `raw_bits_expr`) is test infrastructure for the layout probes and never reaches a user material. A test-only broken emission is mapped back to its Mtek span (`src/lowering/shader/tests.rs`). |
| 16 | The temporary Unlit path (decision 0013) is gone | **passed** | `crates/mtek-compiler/src/lowering/builtin_unlit.rs` no longer exists and `lowering/mod.rs` has no `TEMPORARY` marker; `tests/temporary_unlit_is_gone.rs::no_file_or_symbol_of_the_temporary_unlit_path_remains` passes: no file or symbol of it in `crates/`, `packages/`, `tests/`, `scripts/`, `tools/` or `spec/*.md`. `Unlit` is compiled from the embedded prelude `std/materials.mtek` like any material (`tests/unlit_shader.rs`). |
| 17 | Owner decision of 2026-10-04 (M2-13): assignable struct fields and array elements, write indices clamped on CPU and GPU | **passed** | M2-13 row; [0045](../../spec/decisions/0045-assignable-struct-fields-and-array-elements.md); the `assignable_places` WGSL golden is validated by Naga in `shader_lowering.rs` and its CPU form executes in `tests/codegen/exec.test.ts`. |
| 18 | Owner decisions of 2026-10-05 (M2-14): WGSL conversion clamp everywhere, CPU-order helpers; hardware conformance shows 0 spec-disagreement rows and no `mix` known deviation | **passed** | [`numeric-conformance-gate-hardware.json`](numeric-conformance-gate-hardware.json): `specDisagreement: 0`, `knownDeviation: 0`, `failed: 0`; `mix_f32#7` is bit-identical. Before → after on hardware: bit-exact 307 → 330, tolerance 234 → 220, known deviations 1 → 0, spec disagreements 4 → 0. SwiftShader (informational): 330 exact, 220 within, 0 failures. No tolerance was widened. |

**Code-quality spot check across M2:**
- **No panics in the robustness suites.** `function_robustness.rs` (random function programs, a chain of 50 000 calls on a 1 MiB stack), `material_robustness.rs`, `scene_robustness.rs`, `consteval_robustness.rs` and the 50 000-case `robustness::fifty_thousand_cases` (run 6) pass.
- **No `unwrap`/`expect`/`panic!`/`todo!` outside tests.** The workspace lints deny them (`[lints] workspace = true` in every crate, including `tools/grammar-coverage`) and clippy runs with `--all-targets -D warnings` in `npm run check` (run 3).
- **Determinism.** `tests/determinism.rs`, `build.rs::builds_are_reproducible_including_with_shuffled_listings`, `ir_goldens.rs`, `inspect_views.rs::every_pass_fixture_gives_deterministic_views` and `shader_lowering.rs::every_material_of_every_fixture_lowers_validates_and_is_deterministic` pass.
- **TypeScript.** `tsc -b` and eslint pass with `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.

## Deviations from the spec

Each deviation is recorded in a decision record:

- [0035](../../spec/decisions/0035-complete-type-system-details.md) to [0041](../../spec/decisions/0041-shader-lowering-details.md) (M2-01 to M2-05): type-system, module, `rt`, function, material, CPU-emitter and shader-lowering details the specification left open.
- [0042](../../spec/decisions/0042-grammar-coverage-and-freeze.md) (M2-11): the grammar-coverage tool lives in `tools/grammar-coverage` (an amendment of the layout in `spec/compiler-architecture.md` §1) and the freeze counts are pinned.
- [0043](../../spec/decisions/0043-numeric-conformance-details.md) (M2-08): how WGSL's accuracy rules are read. Items 8 and 9 were answered by 0047.
- [0044](../../spec/decisions/0044-prelude-materials-resource-plan-and-inspect-views.md) (M2-09): prelude materials, the resource plan, the inspect views.
- [0045](../../spec/decisions/0045-assignable-struct-fields-and-array-elements.md) (M2-13, owner decision): amends decision 0038 item 4 (struct fields and array elements are assignable places).
- [0046](../../spec/decisions/0046-runtime-materials-set-param-and-failed-materials.md) (M2-10): `debug.setParam` and materials that fail after mount; adds the counter `failedMaterials`.
- [0047](../../spec/decisions/0047-numeric-agreement-conversion-clamp-and-cpu-order-helpers.md) (M2-14, owner decision): amends 0037 item 6 (the conversion clamp targets and `normalize` portability) and answers 0043 items 8 and 9.
- [0048](../../spec/decisions/0048-m2-gate-browser-tests.md) (M2-12): the gate fixtures and what stands for `E4013`.

## Unsupported / remaining

1. **`E4013` is untested by a program.** No program this build accepts can produce it (every GPU-only built-in is M4). The M2 gate asserts the observable behaviour (`E9010`) and the unit tests assert the rule. M4 turns the unit test into a fixture.
2. **`bind`, `state`, lifecycle handlers, input, hot reload** are M3. The M2 gate changes parameters through `app.debug.setParam`; `E9010` rejects `state` and `bind` until then. `pressKey` and `releaseKey` throw until M3.
3. **A material that fails after mount has no caller yet.** `Renderer.failMaterial` and `MountedApp.handleMaterialFailure` (decision 0046) are covered by unit tests only; hot reload (M3-07) and device-loss recovery (M4-09) are their first callers. Device loss is still terminal (`W8060`) until M4-09.
4. **Where CPU and GPU still differ** (decision 0047, each inside the WGSL bound, none hidden): division and everything built on it (`normalize` apart from its zero, underflow and overflow rows is one binary32 step away on the hardware), `%` (`x - y * trunc(x / y)` on the GPU), `fract(-1e-10)`, subnormal flushing and zero sign, and the transcendental functions and what calls them (`sin`, `cos`, `pow`, `exp`, `quat.axis_angle`, `quat.euler`, `color.srgb`), within WGSL's own accuracy. NaN and infinite inputs stay non-portable (123 rows listed in [`gpu-not-compared.json`](../../tests/semantics/numeric/gpu-not-compared.json), plus 33 outside a WGSL accuracy domain).
5. **`mix` and `normalize` helpers cost more than the built-ins** (a division instead of a reciprocal multiply in `normalize`). The runtime benchmark (M7-04) measures it.
6. **Nothing here was pushed.** The gate ran on a clone of the local `main`; there is no CI run of `d5d18ff`, and the Linux and software-adapter CI jobs have not run on M2.
7. **Node version on the development machine.** `PATH` finds Node 22 (`hermes`) before Node 24 while `package.json` declares `engines.node ">=24 <25"`; npm does not enforce `engines`. The gate put Node 24.18.1 first explicitly. Development runs before the gate (including the M2-12 evidence run) used Node 22.23.2, which also passed. Recommendation: `engine-strict=true` in `.npmrc` or a version preflight.
8. **Single hardware machine.** All hardware evidence comes from one Windows 11 machine with an AMD RX 7900 XTX (D3D12). SwiftShader results (117/117 browser, 330 exact, 220 within) are informational and no criterion rests on them. Other drivers may fuse, flush or divide differently within WGSL's bounds; the exact classes of decision 0047 (`mix`, the nine `normalize` rows) are verified on these two adapters only.
9. **One skipped unit test:** `benchmarks/tools/hash-holdout.test.ts` "rejects symbolic links" (creating a symbolic link needs a Windows privilege). No criterion depends on it.
10. **Deferred by design:** textures, PBR and lights (M4), assets (M4), frustum culling and instancing (M4), prefabs, spawn/destroy and physics (M5), formatter, LSP and context export (M6), the release (M7).
11. **Holdout exposure.** Chore `836dc4c` (merge `3262b48`) records that one holdout reference file was exposed; it recommends replacing that holdout task before M6.
