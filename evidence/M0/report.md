# M0 completion report

- Milestone: **M0 — Prove the risky boundary** (blueprint §11, M0)
- Gate task: M0-GATE
- Gate run: clean clone of `main` at commit `9f847ab` (`git status` clean), 2026-10-03
- Decision: **passed**. Every exit criterion below links to evidence from a real run on a hardware WebGPU adapter.

## Implemented behaviour

| Work item | What now works | Proved by |
|---|---|---|
| M0-01 | Repository skeleton and the specification set (`spec/`, decision records 0001–0017) | `spec/`, `spec/decisions/` |
| M0-02 | Pinned toolchains: Rust workspace, npm workspaces and runtime package; `npm run check` (fmt, clippy `-D warnings`, `tsc -b`, eslint, naming check) | `npm run check` in the gate run; decision 0007 |
| M0-03 | Layout engine for the uniform address space, with layout records for 14 fixtures | `crates/mtek-compiler/tests/gpu_layout.rs`, `tests/gpu-layout/*.layout.json`, `tests/codegen/layout.test.ts` |
| M0-04 | WGSL block emission, with Naga as an independent layout oracle | `crates/mtek-compiler/tests/wgsl_blocks.rs`, `crates/mtek-compiler/tests/naga_oracle.rs`, `tests/codegen/wgsl-blocks/` |
| M0-05 | JavaScript writer emission, cross-checked against an independent encoder | `crates/mtek-compiler/tests/js_writers.rs`, `tests/codegen/writers/` |
| M0-06 | Runtime GPU foundation: device acquisition, resource registry, uniform arena | `packages/runtime-web/src/gpu/{device,registry,uniform-arena}.test.ts` |
| M0-07 | Browser test harness: hardware and software projects, environment records, honest NOT-RUN reporting | `tests/browser/specs/env.spec.ts`; decision 0012 and its amendment; `evidence/environments/2026-10-03-windows11-rx7900xtx.json` |
| M0-08 | CPU/GPU bridge spike. Values written by the **generated** JS writers into a **production** uniform arena are read through typed paths by **generated** WGSL, bit-exactly, for all 14 layout fixtures. Also: two instances in one arena, no pipeline rebuild on value change, and a rendered colour | `tests/browser/specs/bridge/{probe,instances,counters,color}.spec.ts`; `evidence/M0/*-bridge.json` |
| M0-09 | Baseline: the same scenario in TypeScript with three.js r186 WebGPU and TSL, measured | `tests/browser/specs/baselines/m0-bridge.spec.ts`; [`benchmarks/baselines/m0-bridge/RESULTS.md`](../../benchmarks/baselines/m0-bridge/RESULTS.md) |
| M0-10 | Benchmark task format, four tasks and one holdout, task validator, holdout hash | `benchmarks/tools/validate-tasks.mjs` (part of `npm run check`); `benchmarks/tasks/*/baseline-tests`; decision 0021 |

## Tests run

Gate run on 2026-10-03, from a clean `git clone` of `main` at `9f847ab` into a temporary directory. Toolchain: node v24.18.1, npm 11.16.0, cargo and rustc 1.99.0.

| # | Command | Duration | Result |
|---|---|---|---|
| 1 | `npm ci` | 5 s | exit 0 |
| 2 | `npm run build` | 20 s | exit 0 |
| 3 | `npm test` | 184 s | exit 0 (details below) |
| 4 | `cargo test --workspace --locked` | — | **422 passed, 0 failed**: [`cargo-test-gate.txt`](cargo-test-gate.txt) |
| 5 | `MTEK_REQUIRE_GPU=1 npm run test:browser:hardware` | 33 s | **88 passed / 0 failed / 0 not-run** on the hardware adapter: [`test-results-gate.json`](test-results-gate.json) |

`npm test` runs `npm run check && cargo test --workspace --locked && npm run test:unit && npm run test:browser`:

- **`npm run check`:** passed, including the naming check (496 files) and `validate-tasks: OK` (4 tasks, 1 holdout task).
- **`cargo test`:** 422 passed, 0 failed.
- **`npm run test:unit`:**
  - runtime-web: 467 passed
  - browser harness: 56 passed
  - codegen: 87 passed
  - benchmarks: 74 passed, 1 skipped (see Unsupported)
  - baseline: 8 passed
- **`npm run test:browser`:** 183 passed / 0 failed / 0 not-run ([`test-results-gate-full.json`](test-results-gate-full.json)):
  - benchmarks: 7 on the hardware adapter
  - hardware: 88
  - software: 88

Breakdown of run 5 (hardware project):

| Spec | Passed |
|---|---|
| `bridge/probe.spec.ts` | 42 (14 fixtures × random values, the other boolean phase, edge values) |
| `bridge/instances.spec.ts` | 14 |
| `bridge/counters.spec.ts` | 14 |
| `bridge/color.spec.ts` | 1 |
| `baselines/m0-bridge.spec.ts` | 3 |
| `env.spec.ts` | 3 |
| `mount.spec.ts` (M1-14, merged before the gate) | 11 |

Path names in the committed reports were made repo-relative with `npm run evidence:sanitize`; nothing else was changed.

## Environments

| Record | Adapter | `isFallbackAdapter` | Commit |
|---|---|---|---|
| [`environment-gate.json`](environment-gate.json) (run 5) | AMD Radeon RX 7900 XTX (rdna-3) | **false** | `9f847ab`, clean |
| [`environment-gate-full-hardware.json`](environment-gate-full-hardware.json) (run 3) | AMD Radeon RX 7900 XTX | **false** | `9f847ab`, clean |
| [`environment-gate-full-benchmarks.json`](environment-gate-full-benchmarks.json) (run 3) | AMD Radeon RX 7900 XTX | **false** | `9f847ab`, clean |
| [`environment-gate-full-software.json`](environment-gate-full-software.json) (run 3) | SwiftShader (software) | true: informational only, no criterion relies on it | `9f847ab`, clean |
| [`environment-bridge.json`](environment-bridge.json) (M0-08 run) | AMD Radeon RX 7900 XTX | false | M0-08 branch, clean |

All hardware records share the same setup: Windows 11 Pro 10.0.26200 x64, Chromium for Testing 153.0.8010.12 in new headless mode with `--enable-unsafe-webgpu --ignore-gpu-blocklist --enable-webgpu-developer-features`, and Playwright 1.63.0. This is the configuration recorded in decision 0012 (amendment).

## Exit gate checklist

| # | Criterion (blueprint M0) | Status | Evidence |
|---|---|---|---|
| 1 | Values uploaded by generated code produce the expected rendered/tested output on a recorded real WebGPU environment | **passed** | The bit-exact probe passes for all 14 fixtures, 42/42: generated writers → production arena → generated WGSL reading each leaf through its typed path. The rendered colour (`mixed`: sRGB of `f.rgb * a`, ±1/255) passes 1/1. Both are on the hardware adapter: [`test-results-gate.json`](test-results-gate.json), [`environment-gate.json`](environment-gate.json). M0-08 also confirmed the test is sensitive: shifting one writer word index makes the probe, instances and colour specs fail per leaf. |
| 2 | A changed value updates without rebuilding its pipeline | **passed** | `bridge/counters.spec.ts` 14/14 on hardware. `pipelinesCreated` and `shaderModulesCreated` stay unchanged across value updates; only `uploads`/`uploadBytes` grow, and an identical rewrite uploads nothing. |
| 3 | A second material instance does not corrupt the first | **passed** | `bridge/instances.spec.ts` 14/14 on hardware: A and B share one arena, only B is changed, A is bit-identical and B is updated. |
| 4 | Record at least one baseline implementation using TypeScript/Three.js or TSL | **passed** | [`benchmarks/baselines/m0-bridge/RESULTS.md`](../../benchmarks/baselines/m0-bridge/RESULTS.md) (three.js 0.186.1 WebGPU + TSL, measured numbers only), backed by `baselines/m0-bridge.spec.ts` 3/3 on hardware in this gate run. |
| 5 | An architecture decision record | **passed** | [`spec/decisions/`](../../spec/decisions/) 0001–0017, plus the 0012 amendment with the working hardware configuration. Records 0018–0022 were added by later work items. |
| 6 | Initial benchmark tasks | **passed** | Five tasks (`benchmarks/tasks/{scene-rendering-01,interaction-01,shader-bridge-01,maintenance-01}`, plus one holdout) and `validate-tasks: OK` in `npm run check`. The baseline reference solutions pass 7/7 on the hardware adapter ([`test-results-gate-full.json`](test-results-gate-full.json), project `benchmarks`, [`environment-gate-full-benchmarks.json`](environment-gate-full-benchmarks.json)). `holdout.sha256` matches. |
| 7 | Guardrail: no throwaway spike code becomes accidental public architecture | **passed** | Probe generation lives only in `crates/mtek-compiler/examples/bridge_spike.rs` (test-only, `[[example]]`) and in test directories (`tests/browser/pages/bridge.ts`, `tests/browser/support/bridge-*`). `mtek-compiler`'s public modules contain nothing probe-specific: `emit_wgsl::leaf_accessors` is the general leaf-order API of `spec/gpu-layout.md` §9.4. `@mtek/runtime-web`'s entry point (`packages/runtime-web/src/index.ts`) exports only production modules (`gpu/*`, `abi`, `host`, `diagnostics`). |

**Code-quality spot check across M0:**
- Clippy denies `unwrap_used`, `expect_used`, `panic`, `todo` and `unimplemented` workspace-wide, and `unsafe_code` is forbidden. A scan of non-test Rust sources finds no exceptions.
- No `any` in the TypeScript sources.
- Determinism: `crates/mtek-compiler/tests/determinism.rs` forbids `HashMap`/`HashSet` in every output-producing module.
- Tests are shown to fail without the feature: the M0-08 mutation check.

## Deviations from the spec

- [Decision 0012](../../spec/decisions/0012-browser-test-environment.md) amendment (M0-07): the working hardware configuration on the development machine is recorded rather than assumed.
- [Decision 0021](../../spec/decisions/0021-benchmark-task-format.md) (M0-10) fixes details of the benchmark task format the spec left open:
  - a `set_input` step for `mtek test` fixtures;
  - a 128×128 target with top-left origin and default tolerance 2;
  - fixtures in `mtek-tests/`;
  - the holdout hash algorithm.
- Toolchain pins: all recorded in [decision 0007](../../spec/decisions/0007-toolchain.md), including `three` 0.186.1 and `@types/three` 0.186.0 for the baseline only, and TypeScript 6.0.3 held back for typescript-eslint.

## Unsupported / remaining

- **Mtek side of the benchmark tasks:** the starters, references and `mtek-tests` fixtures are written by hand from the spec and have never been compiled. No Mtek result is claimed. M6-07 verifies them.
- **The bridge spike works below the language level.** Layout records come from the M0 fixtures, not from Mtek source; compiling materials from source is M1/M2. The writers and WGSL blocks are the production emitters. The probe generator is disposable test code.
- **One skipped unit test:** `benchmarks/tools/hash-holdout.test.ts` "rejects a symbolic link". The OS refused to create a symbolic link without the Windows privilege, so it did not run in the gate environment. No criterion depends on it.
- **Open baseline observations** (stated in RESULTS.md, not investigated):
  - three.js made one `createBuffer` call per render;
  - three.js `Color` has no alpha channel.
- **Software adapter results** (SwiftShader, 88/88) are informational; no criterion is passed on them.
