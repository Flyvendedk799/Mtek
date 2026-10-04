# 0034. M1 exit-gate browser tests: details the specification leaves open

- Status: Accepted
- Date: 2026-10-04
- Blueprint origin: §11 M1 (exit gate and guardrail), §12.1, §15; `spec/testing.md` §6.1, §6.3, §6.7, §8; `spec/runtime-abi.md` §6.5, §8.3, §10.2; decisions 0012, 0031, 0032.

## Context

Task M1-21 produces the browser evidence for the M1 exit gate: checked-in fixtures built from source by the CLI render through WebGPU, a transform change changes the output, unknown fields and wrong vector dimensions fail before launch with spans, failures are visible, at least two structurally different fixtures, no name-dependent paths. The specification fixes the harness, the pixel tolerance, the failure kinds and the evidence names. It does not fix where the fixtures live and how they stay in step with the semantic fixtures, how "points outside every silhouette" are chosen, how big the targets are, how the failure fixtures are made, or how the guardrail is tested. They are fixed here so that they are visible, testable and changeable by a later record.

## Decision

All of the following are **proposals** (design choices), not external constraints.

1. **Fixtures.** `tests/browser/fixtures/m1/<name>/` holds Mtek projects; global setup builds every one with `mtek build --mode test --format json --out .out/m1/<name>` from a CLI it builds with `cargo build -p mtek-cli --locked` (the executable is located from Cargo's JSON messages, so any target directory works). Scenes A and B are **byte-identical copies** of `tests/semantics/pass/scene_a_target_camera_box` and `scene_b_orthographic_nested` (`mtek.toml` and `src/main.mtek`), checked by `support/m1-fixtures.test.ts` as the codegen copies are by `crates/mtek-compiler/tests/build.rs`. **A-moved** differs from A in the entity's `position` line only (`vec3(1.5, 1.25, 0.0)`); **A-renamed** in the scene, camera and entity names only. Both restrictions are unit-tested line by line.
2. **Pre-launch fail fixtures are referenced in place**, not copied: `tests/semantics/fail/e5001_unknown_entity_field` and `e3102_wrong_vector_dimension`, compared with their own `expected.diag.json`. They cannot live under `fixtures/m1/`, which global setup must build successfully.
3. **Failure variants are post-build copies** of built A, made by global setup: `<A>.abi-99/` (manifest `runtimeAbi` rewritten to 99) and `<A>.bad-shader/` (the line `this line is not WGSL;` appended to every WGSL file). Appending keeps the span map valid for every original line, so the compilation error falls on a line no entry covers and the runtime reports it at the material declaration; the spec reads that declaration (symbol → span → source) from the built manifest instead of hard-coding it.
4. **CPU reference.** `support/m1-reference.ts` is a test-side `f64` implementation, sharing no code with the runtime, of `spec/runtime-abi.md` §8.3 (view with and without a target, perspective and orthographic projection), `quat.euler`, `parent · T · R · S`, the sRGB transfer functions, and analytic ray casts against Box, single-sided Plane and Sphere. `support/m1-scenes.ts` transcribes each fixture (source values, not the compiler's `f32` roundings; registry defaults where the source is silent); every stated value is listed as a literal that a unit test finds in the source.
5. **Which pixels are asserted.** A pixel's expectation is the front-most entity (or the clear colour) on the ray through its centre. It is asserted only when the rays through its centre and the eight points 1.5 px around it agree, no ray passes a Sphere between its inscribed radius `r · cos(π/segments) · cos(π/rings)` and `r`, and no two surfaces are within `1e-4` of each other in depth. The entity-centre pixel must be robust (the test fails otherwise); grid points (every 4 px) that are not robust are counted and skipped. Colours: the Unlit literal decoded with the sRGB EOTF and re-encoded to 8 bits, ±2/255 per channel (§6.3). An entity whose centre is hidden (B's ground under the fountain) is asserted to show the hiding entity; the grid asserts the ground elsewhere. At least 50 robust clear-colour grid points per scene are required.
6. **Targets.** A renders at 128 × 128. B renders at **256 × 160** (aspect 1.6): its 20 × 20 plane exactly fills a square orthographic view, which would leave no clear-colour point; the wider target leaves bands on both sides and also exercises the aspect ratio.
7. **Transform change.** The footprint is every pixel within ±2/255 of the box colour. A vs A-moved passes when both footprints exceed 100 px, the centroid moves with the sign of the CPU-predicted centre shift on both axes (each predicted component larger than 10 px), the centroid shift is within 20 % of the predicted shift's length, and the old centre is clear while the new centre shows the box.
8. **Guardrail.** "No hard-coded entity names" is tested behaviourally: A-renamed must read back byte-identically to A, and the two scenes use different names for everything. A source grep is not used, because inline Rust tests and doc comments legitimately mention names such as `Cube`.
9. **Projects.** The render and shader-failure specs use the `gpu` fixture (NOT-RUN without an adapter). The pre-launch specs, the ABI-99 spec (rejected before any device work) and the missing-WebGPU spec need no adapter and do not use it, so they run, and count, everywhere.
10. **Evidence.** The cited run is `MTEK_REQUIRE_GPU=1 npm run test:browser:hardware` (all hardware specs, including M1's), committed after `npm run evidence:sanitize` as `evidence/M1/test-results-m1-specs.json` and `evidence/M1/environment-m1-specs.json`. The computed sample positions and colours are recorded as `m1-pixel` annotations in the report.

## Consequences

- No new dependency, no new diagnostic code, no change to the compiler, the CLI or the runtime.
- A later change of fixture A or B in `tests/semantics/pass` must be copied here (the unit test fails until it is), and `support/m1-scenes.ts` updated (its literal check fails until it is).
- M1-GATE cites `evidence/M1/*-m1-specs.json` for the gate criteria covered here.

## Verification

`tests/browser/support/m1-fixtures.test.ts` (copies, A-moved and A-renamed diffs, transcriptions), `tests/browser/support/m1-reference.test.ts` (matrices, `quat.euler` against the compiler's folded value, colours, expected pixels and edge ambiguity), `tests/browser/specs/m1/render.spec.ts`, `pre-launch.spec.ts`, `failures.spec.ts`. Sensitivity was checked by mutating the runtime's orthographic `x` scale (`2 / height` instead of `2 / width`): the B spec fails at the lamp's centre.
