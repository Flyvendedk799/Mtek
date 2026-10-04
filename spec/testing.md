# Testing, Verification and Evidence (v0.1)

- Repository path: `spec/testing.md`
- Status: Normative. Implements blueprint §12.1 and the execution rules of blueprint §15.
- The single rule behind everything here: **a feature is supported only when a test that would fail without it passes, in an environment that is recorded.** No skipped failing tests reported as success, no fabricated numbers, no screenshots as proof of behaviour.

---

## 1. Commands

| Command | Runs | Needs GPU |
|---|---|---|
| `cargo test --workspace --locked` | compiler unit tests, fixture suites, Naga oracle, determinism, robustness (§3) | no |
| `npm run test:unit` | Vitest: `packages/runtime-web` unit tests, `tests/codegen` execution tests (§4) | no |
| `npm run test:browser` | Playwright browser suites (§6); builds fixtures first with the freshly built `mtek` CLI | yes (reports NOT-RUN without) |
| `npm run check` | `cargo fmt --check`, `cargo clippy … -D warnings`, `npm run check:ts` (`tsc -b` over all TS projects), `npm run lint` (ESLint) | no |
| `npm test` | `check` + all of the above | yes |

All commands work from a clean checkout after `npm ci && npm run build` (`build` bundles the runtime, then builds the CLI with it embedded; there are no install-time lifecycle scripts). The root `README.md` lists them, and the M7 gate re-runs them from a fresh clone.

## 2. Test layers (blueprint §12.1) and where they live

| Layer | Location | Kind |
|---|---|---|
| Lexer/parser | `tests/syntax/`, `crates/mtek-compiler/src/syntax/**/tests` | corpus, AST goldens, recovery spans, robustness |
| Semantics | `tests/semantics/` | pass/fail fixtures with exact diagnostics |
| Code generation | `tests/codegen/` | golden outputs **plus** execution (Node) — snapshots alone are insufficient |
| CPU/GPU ABI | `tests/gpu-layout/`, `tests/browser/specs/bridge/` | layout goldens, Naga oracle, JS encoder cross-check, GPU probe |
| Runtime | `packages/runtime-web/test/`, `tests/browser/specs/runtime/` | unit (scheduler, arenas, codecs, math), behaviour with manual clock |
| Rendering | `tests/browser/specs/render/` | readback pixel assertions, error capture |
| Assets | `tests/assets/` (compiler), `tests/browser/specs/assets/` | supported, malformed, missing, oversized, unsupported features |
| Physics | `tests/browser/specs/physics/` | contacts, impulses, sensors, authority, destruction/restart |
| Tooling | `crates/mtek-cli/tests/`, `tests/tooling/` | formatter idempotence, source maps, JSON diagnostics, clean install |
| AI workflow | `tools/ai-eval/test/` | harness logic with recorded transcripts (M6) |

## 3. Compiler fixtures

### 3.1 Formats
- `tests/syntax/pass/<name>.mtek` — must lex and parse with **zero** diagnostics.
- `tests/syntax/ast/<name>.mtek` + `<name>.ast` — expected AST as an indented S-expression dump (`(binary + (lit 1) (binary * (lit 2) (lit 3)))`). Precedence and associativity are tested here. Expression fixtures hold one expression per case, cases separated by `---` lines (`--- no-desc` parses the case as `ExprNoDesc`); the `.ast` file shows each case's source, its dump, and the diagnostics (code, byte span, message) that parsing it produced, so error cases live here too and are named `fail_*`. The format is documented in `crates/mtek-compiler/tests/ast_fixtures.rs`.
- `tests/syntax/fail/<name>.mtek` + `<name>.diag.json`, and `tests/semantics/fail/<name>/` (a directory with `mtek.toml` and sources when multi-file) + `expected.diag.json`:
  ```json
  [ { "code": "MTEK-E5001", "file": "src/main.mtek", "startByte": 120, "endByte": 128,
      "message": "Unknown field 'colour' on Unlit. Valid fields: color." } ]
  ```
  The compiler's diagnostics must match the list **exactly** (codes, primary spans, messages, order). Related spans and notes are matched when present in the expected file.
- `tests/semantics/pass/<name>/` — must check with zero errors (warnings listed in `expected.diag.json` if any).
- `tests/semantics/gpu/<name>/` — like a fail fixture, checked with the functions listed in `gpu-roots.txt` (one symbol per line) as GPU roots: the GPU-reachability rules before material stage functions exist (decision 0038).
- `tests/codegen/<name>/` — a codegen fixture is **any directory directly under `tests/codegen/` that contains `mtek.toml`**; every other directory there (`support/`, `.out/`, `writers/`, `wgsl/`, `wgsl-blocks/`, `ir/`, …) is ignored by the fixture runner. Contents: `mtek.toml`, sources, `expected/` (the `dist/` tree built with the fixed stub runtime bundle of `spec/compiler-architecture.md` §4.12, minus the bundle file itself), and `exec.json` (§4.1).
- `tests/gpu-layout/<name>.type.json` + `<name>.layout.json` — §4.2.

Runner: `crates/mtek-compiler/tests/fixtures.rs` discovers fixtures in sorted order and runs them with the in-memory `Fs`. `MTEK_BLESS=1` rewrites expected files; blessed diffs are reviewed like code.

### 3.2 Requirements
- Every grammar production: ≥ 1 pass fixture. Every `[S: …]` rule and every diagnostic code: ≥ 1 fail fixture. `tools/grammar-coverage` measures the productions (with their top-level alternatives) and the rules on what the parser builds (decision 0042); for the codes, a test lists codes from `codes.rs` that no fixture produces (M7 requires the list to be empty, earlier milestones require it for codes of implemented features; the lists and their categories are decision 0027 item 11).
- Recovery: fail fixtures with several independent errors assert that all are reported and nothing after the first error is a cascade.

### 3.3 Robustness (fuzz-style, stable Rust, runs in CI)
A deterministic generator (fixed seeds) produces each run: 5 000 random byte strings (including invalid UTF-8, lone `\r`, huge numbers, deep nesting), 5 000 random token sequences, and 5 000 mutations of corpus files (delete/duplicate/swap tokens, truncate at every 7th byte). For each: `check` returns, never panics, every span lies within its file, every diagnostic has a catalogue code. Optional `cargo fuzz` targets exist for longer local runs (nightly, not required by CI).

## 4. Code generation and ABI tests without a GPU

### 4.1 Execution tests (`tests/codegen`, Vitest)
`exec.json` lists calls into the generated module and expected results, e.g.
```json
[ { "fn": "pulse", "args": [0.0], "expect": { "f32": 0.65 } },
  { "fn": "idiv_demo", "args": [-7, 0], "expect": { "i32": -7 } } ]
```
`"fn"` names the Mtek function by its source name; the test looks it up in the generated `functions` table by symbol (`src/main.mtek::pulse`) and calls it with a test `ctx` as first argument. The test imports the fixture's generated `app.js` (built for this purpose with the **real** runtime bundle from the workspace, unlike the stub-bundle goldens of §3.1) and asserts results bit-exactly for `+ - * /`, integer operations and conversions, and within tolerance (§5) for transcendental functions. Handlers are executed with a test `ctx` implementation (`tests/codegen/support/fake-ctx.ts`) that records setter calls, so lowering of state writes, ownership-checked setters and lifecycle calls is tested without a browser. The full row format (typed arguments and results, tolerances, repeated calls, expected run-time warnings) is decision 0040.

### 4.2 Layout fixtures (M0 onward; the "tiny typed representation")
Before the parser exists, block types are described in JSON:
```json
{ "name": "Mixed", "kind": "struct", "members": [
  { "name": "a", "type": "f32" }, { "name": "b", "type": "vec3" }, { "name": "c", "type": "u32" },
  { "name": "d", "type": "vec2" }, { "name": "e", "type": "bool" }, { "name": "f", "type": "color" } ] }
```
Types: scalar/vector names as strings; `{ "kind": "struct", "name": …, "members": […] }`; `{ "kind": "array", "element": <type>, "length": N }`. The expected `<name>.layout.json` is exactly a layout record in the format and key order of `spec/gpu-layout.md` §5, with `id = "fixture:<name>"` and `wgslStruct = "MtekFixture_<name>"`. Required fixtures: `scalar_f32`, `vec3`, `mixed` (gpu-layout §4.5 B), `vec3_then_f32` (A), `struct_then_scalar` (C), `array_f32` (D), `array_vec2`, `array_bool`, `array_of_structs`, `nested_struct_in_array`, `mat4_and_quat`, `all_types`, `builtin_frame`, `builtin_object`. Each has a hand-checked `<name>.layout.json`. The same files drive: the Rust layout test, the Naga oracle, the JS encoder cross-check (`tests/codegen/layout.test.ts`) and the GPU probe generator. From M2 on, equivalent `.mtek` struct fixtures assert that the parser/checker produces identical layout records.

### 4.3 Generated-code hygiene
A test scans every generated `app.js` for forbidden identifiers (`globalThis`, `window`, `document`, `navigator`, `fetch`, `XMLHttpRequest`, `eval`, `Function(`, `setTimeout`, `setInterval`, `Math.random`, `import(`) outside the runtime import line.

## 5. Numerical conformance and tolerances

- **CPU table.** `tests/semantics/numeric/cpu.json`: for each operator, conversion and intrinsic, inputs and the exact expected binary32/i32/u32 result per `spec/language.md` §6 and `spec/stdlib.md` §6 — including division by zero, `i32` MIN cases, wrapping, NaN/±inf for `f32` CPU behaviour, `round` ties, out-of-range conversions. Executed by Vitest against `rt` and against generated code.
- **GPU comparison.** `tests/browser/specs/numeric/` evaluates the same inputs on the GPU (probe shader writing `bitcast<u32>` results to an `rgba32uint` target) for every case marked portable, and compares with the CPU result:
  - integer operations, conversions of in-range values, `+ - *` of finite `f32`: **bit-exact**;
  - everything else: within the tolerance recorded in `tests/semantics/numeric/tolerances.json`, where each function's tolerance is **transcribed from the WGSL "Floating Point Accuracy" section** of [S5] for `f32` (absolute or ULP bound, with its input domain), plus 1 ULP for CPU rounding. Each entry cites the spec section it came from. Inputs outside the stated domain are not compared (non-portable by definition).
- Non-portable cases (NaN, infinity, division by zero for `f32`, `normalize(0)`) are tested on the CPU only and listed as non-portable in the language reference.
- Tolerances are never widened to make a failing test pass without a decision record explaining the measured cause (blueprint §14: "do not weaken tests casually").
- How the WGSL bounds are read and evaluated (interval arithmetic over inherited expressions, the rounding, reassociation, fusion, flush-to-zero and zero-sign rules, one binary32 step for CPU rounding), how the probe is generated from the compiler's own WGSL, the generated list of uncompared cases `tests/semantics/numeric/gpu-not-compared.json`, measured known deviations and the per-run report `numeric-conformance-<project>.json` are decision 0043.

## 6. Browser tests

### 6.1 Harness
- Package `tests/browser` (`@mtek/browser-tests`), Playwright Test. A static file server (`tests/browser/support/serve.ts`, Node `http`, no third-party server) serves built fixtures from `tests/browser/.out/`.
- Global setup builds the CLI (`cargo build -p mtek-cli --locked`) and every browser fixture into `.out/` with `mtek build --mode test`.
- **Projects:**
  - `hardware` — Chromium with `channel: process.env.MTEK_BROWSER_CHANNEL ?? "chromium"` (`"chromium"` selects Chromium's *new* headless mode; Playwright's default headless shell is the old mode), `headless: process.env.MTEK_HEADED !== "1"`, args `["--enable-unsafe-webgpu", "--ignore-gpu-blocklist"]` (plus `--use-angle=vulkan --enable-features=Vulkan --disable-vulkan-surface` on Linux). Whether headless Chromium exposes a hardware adapter on Windows is **unverified**; the M0 harness task determines a working configuration on the development machine (headed is acceptable) and records it in decision 0012.
  - `software` — Chromium with `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader` (Linux CI also adds `--enable-features=Vulkan --use-vulkan=swiftshader` if required). Correctness only; never used for performance numbers.
- **Results directory.** `playwright.config.ts` sets `process.env.MTEK_RESULTS_DIR ??= tests/browser/results/<timestamp>` once, so the main and worker processes share it. **Environment record.** Every run writes `$MTEK_RESULTS_DIR/environment-<project>.json` (one per Playwright project, written by a worker-scoped fixture): OS and version, browser name and version (`browser.version()`), launch args and headless mode, `navigator.userAgent`, `adapter.info` (`vendor`, `architecture`, `device`, `description`, `isFallbackAdapter`), enabled features, the limits Mtek relies on, `navigator.gpu.wgslLanguageFeatures`, device pixel ratio, render-target size, git commit, and the resolved versions of the Rust toolchain, Naga, Node, Playwright and the runtime package. It is validated against `tests/browser/environment.schema.json`.
- **NOT-RUN is not PASS.** A setup probe checks for `navigator.gpu` and an adapter. GPU tests in an environment without one are skipped with the reason `NOT-RUN: no WebGPU adapter`, and the custom reporter prints `passed / failed / not-run` separately. With `MTEK_REQUIRE_GPU=1` (required for gate evidence) any NOT-RUN fails the run. Gate evidence additionally requires `isFallbackAdapter === false` unless the gate explicitly accepts software evidence.

### 6.2 The M0 bridge tests (`specs/bridge/`)
For each layout fixture: (1) **bit-exact probe** (`spec/gpu-layout.md` §9.4); (2) **two instances, one arena**: write distinct values to slots A and B, draw the probe for each into separate rows, read back, then change B only and redraw — A's words are unchanged and B's equal the new values; (3) **no pipeline rebuild**: `pipelinesCreated` and `shaderModulesCreated` counters are unchanged across value updates; (4) **rendered output**: a quad whose fragment colour is computed from the mixed block (e.g. `color.rgb * a`) renders into `rgba8unorm-srgb`; the centre pixel equals the CPU-computed sRGB-encoded value within ±1/255 per channel.

### 6.3 Pixel assertions
- Tests render through `options.test.renderTarget` (`rgba8unorm-srgb`, fixed size, typically 128×128) and use `app.debug.readPixels()`.
- **Feature-specific assertions first:** sample points whose expected content is derived from the scene (project the entity centre with the same view/projection formulas on the CPU; the pixel there must be the material colour; points outside the silhouette must be the clear colour). Default tolerance ±2/255 per channel for unlit colours, ±3/255 for lit colours compared with the CPU reference.
- **Reference images** (PNG under `tests/browser/references/`) are allowed for regression only: they must be produced by a real run (the environment record is stored next to them), compared with per-pixel tolerance 2/255 and at most 0.5 % of pixels differing, and never be the only evidence for a feature. Generated or hand-edited images are forbidden as evidence.
- The M1 gate specs (`tests/browser/specs/m1/`) choose sample points with an independent CPU reference and assert only pixels whose expectation is robust to a 1.5 px shift; the fixtures, target sizes and failure variants are fixed in `spec/decisions/0034-m1-gate-browser-tests.md`.

### 6.4 CPU reference renderer for shading
`tests/browser/support/reference-shading.ts` implements `spec/materials.md` §8 formulas in `f64`. PBR tests place a sphere at a known position with a known light and camera, compute expected colours at chosen pixels (normal and view from the analytic sphere), and compare within ±3/255.

### 6.5 Behaviour tests (manual clock)
Mount with `test: { manualClock: true, renderTarget }`, drive with `app.debug.step(n, dt)`, inject input with `pressKey`/`releaseKey`, read state with `app.debug.scene()` and counters with `app.debug.counters()`. Required examples (by milestone): rotation equals `speed · t` within 1e-5 rad after N fixed steps (M3); Space toggles direction (M3); pause/resume produces no jump: `frame.time` and rotation advance by exactly the stepped time, not the wall-clock gap (M3); colour edit through hot reload leaves `pipelinesCreated` unchanged (M3); same-frame spawn/destroy/input/collision combinations from `spec/scenes.md` §10.3 (M5).

### 6.6 Resource lifetime
Mount/dispose 50 times: after each `dispose()` every live counter is 0 and no listener remains (spied `addEventListener`/`removeEventListener`). Spawn/destroy 1 000 entities in waves: live buffer, bind group and body counts return to a bounded plateau (documented cache sizes) — M5/M7.

### 6.7 Failure visibility
Fixtures that must fail to mount (incompatible ABI, invalid manifest, shader failure via a test-only corrupted shader file, missing asset) assert that `mountMtek` rejects with the documented `kind`, that the overlay is present in the DOM with the diagnostic code, and that nothing renders silently black.

## 7. Determinism and reproducibility
- **Reproducible build:** building every codegen fixture twice, and once with the in-memory `Fs` returning directory listings shuffled, yields byte-identical outputs (Rust test). M7 adds: two clean clones built on the same machine produce identical `dist/` trees.
- **No hash-map iteration in outputs:** a grep test over `emit_*`, `package`, `plan`, `layout` (`spec/compiler-architecture.md` §5).
- **Seeds:** every randomised test prints its seed and accepts `MTEK_TEST_SEED` to reproduce.

## 8. Evidence and completion reports

Every milestone gate produces `evidence/M<n>/`:
- `report.md` — the completion report (template below),
- `environment-<run>.json` — environment record of each cited run,
- `test-results-<run>.json` — Playwright JSON reporter output (and `cargo-test-<run>.txt` for `cargo test` summaries) of each cited run,

where `<run>` names the run (`bridge`, `m1-specs`, `gate`, …) so later runs never overwrite earlier evidence.
- for benchmarks: raw results files (M6/M7).

Completion report template (blueprint §15):

```markdown
# M<n> completion report
## Implemented behaviour      (what now works, each item linked to the tests proving it)
## Tests run                  (exact commands, pass/fail/not-run counts, dates)
## Environments               (links to environment records; hardware vs software adapter)
## Exit gate checklist        (each gate criterion → evidence)
## Deviations from the spec   (with decision-record links; "none" if none)
## Unsupported / remaining    (explicit list; nothing hidden behind a success message)
```

A gate is passed only when every exit criterion links to evidence produced by a real run. When a test cannot run in the current environment, the report says so and the gate is **not** passed on that criterion.

## 9. Continuous integration
`.github/workflows/ci.yml`, triggered on pushes and pull requests:
- `rust` (ubuntu-latest and windows-latest): `cargo fmt --check`, `cargo clippy --workspace --all-targets --locked -- -D warnings`, `cargo test --workspace --locked`.
- `node` (ubuntu-latest): `npm ci`, `npm run build`, `npm run check:ts`, `npm run test:unit`.
- `browser-software` (ubuntu-latest): install Playwright Chromium, `npm run test:browser -- --project=software`; uploads `tests/browser/results/`. If no software adapter can be obtained the job reports NOT-RUN (it does not fail CI, and it is never cited as gate evidence of hardware behaviour).
Hardware-GPU evidence is produced on a recorded developer machine and committed under `evidence/`.
