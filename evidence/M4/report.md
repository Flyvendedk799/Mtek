# M4 completion report

- Milestone: **M4 — Build the usable rendering and asset subset** (blueprint §11, M4)
- Gate task: M4-GATE
- Gate run: clean `git clone` of the local `main` into a new directory at commit `720c302` (`gitCommit` in every gate environment record, `gitDirty: false`), 2026-10-18, Node 24.18.1, Windows 11, after a fresh `npm ci`. Every M4 work item was merged and re-tested on its own before this run (see the merge commits). The commits before `720c302` are on GitHub (`origin/main`, `origin/plan/blueprint` at `904fa6e`); `720c302` itself is pushed together with this report, so no CI run of the gate commit exists and none is cited.
- Decision: **passed**, with the limits listed under "Unsupported / remaining". Every rendering criterion was proved on a hardware WebGPU adapter (`isFallbackAdapter: false`, AMD Radeon RX 7900 XTX). None rests on a NOT-RUN result or a software-adapter result.

## Implemented behaviour

| Work item | What now works | Proved by |
|---|---|---|
| M4-01 | The CPU PBR oracle: an `f64` implementation of `spec/materials.md` §8 and the exact sRGB encode | `tests/browser/support/reference-shading.test.ts` (every expectation derived by hand in a comment; three deliberate mutations make it fail) |
| M4-02 | Directional and point lights as entity components, at most 4 per scene (`E5111`), `E5110` in prefabs, bindable `color` and `intensity`, packing into `MtekFrame.lights` | `tests/semantics/{pass,fail}` fixtures, `tests/codegen/lights`, `render/lights.test.ts` (direction from rotation, premultiplied colour); [decision 0053](../../spec/decisions/0053-lights.md) |
| M4-03 | **Real PBR on the GPU**: `lighting.pbr` as a generated WGSL helper over the frame block, the prelude `Pbr` material | `specs/m4/pbr.spec.ts`: every case within 1/255 of the oracle against a 3/255 tolerance; [0057](../../spec/decisions/0057-pbr-lighting.md) |
| M4-04 | `texture` and `sampler` params in group 1, built-in 1×1 textures and four sampler presets, the `sample` intrinsic, `E4041`, `E6002` | `specs/m4/textures.spec.ts` (a 2×2 sRGB texture sampled at exact texel centres; fails if the texture is stored as `rgba8unorm`); [0054](../../spec/decisions/0054-textures-and-samplers.md) |
| M4-05 | The asset compiler: `asset.*` declarations, `glb_asset` accessors, the static GLB profile in the documented order with size checks first, packaging, `mtek inspect --assets` | `tests/assets/` (85 failing and 2 passing projects), `tests/assets.rs`; [0058](../../spec/decisions/0058-asset-compiler.md) |
| M4-06 | Runtime asset loading: `pending → ready | failed`, length and SHA-256 checks, image decode into the declared colour space, per-attribute mesh buffers, `asset-failed` with the overlay naming file and declaration | `specs/m4/assets.spec.ts` (pixels derived by hand from the generated GLB; seven failure cases; recovery without network); [0060](../../spec/decisions/0060-runtime-assets.md) |
| M4-07 | Frustum culling, the full counter set, an opt-in development overlay that is absent from release bundles | `specs/m4/culling.spec.ts`, `dev-overlay.spec.ts`, `src/release-bundle.test.ts`, the CLI release-output test; [0055](../../spec/decisions/0055-culling-counters-and-overlay.md) |
| M4-08 | Compatible instancing: shared parameter blocks, an instanced vertex entry, an instance buffer, grouping after culling, real `drawCalls` and `instancedDraws` | `specs/m4/instancing.spec.ts`; [0059](../../spec/decisions/0059-instancing.md) |
| M4-09 | Resize, pixel ratio, zero size, device-loss recovery (at most 3 attempts), allocation failure | `specs/m4/resilience-device.spec.ts`, `resilience-resize.spec.ts`, `host/recovery.test.ts`; [0056](../../spec/decisions/0056-resilience.md) |
| M4-10 | `examples/material-configurator` (three modules, a generated chair GLB, ten host inputs, a custom fragment material, a host page) and the gate specs | `specs/m4/configurator.spec.ts`, `configurator-variants.spec.ts`; [0061](../../spec/decisions/0061-material-configurator.md) |

## Tests run

Gate run on 2026-10-18 from a clean `git clone` of the local `main` at `720c302`, with the logs kept outside the clone.

| Stage | Command | Result |
|---|---|---|
| Install and build | `npm ci`, `npm run build` | passed |
| Format, lint, types, naming, tasks, assets | `npm run check` | passed |
| Rust | `cargo test --workspace --locked` | **1204 passed, 0 failed, 1 ignored** ([`cargo-test-gate.txt`](cargo-test-gate.txt)) |
| TypeScript unit | `npm run test:unit` | 1019 + 214 + 1004 + 74 (+1 skipped, see below) + 8 passed, 0 failed |
| Browser, all projects | `MTEK_REQUIRE_GPU=1 npm run test:browser` | **391 passed, 0 failed, 0 not-run**: hardware 192, software 192 (informational), benchmarks 7 ([`test-results-gate-full.json`](test-results-gate-full.json); environment records `environment-gate-full-*.json`) |
| Browser, M4 on hardware | `MTEK_REQUIRE_GPU=1 npm run test:browser:hardware -- specs/m4/` | **63 passed, 0 failed, 0 not-run** ([`test-results-gate-m4-hardware.json`](test-results-gate-m4-hardware.json)) |

`npm run evidence:sanitize` made the paths in the JSON reports repo-relative. In the cargo log only the summary lines were kept, with the clone's absolute path replaced by `<repo>` and terminal colour codes removed. Nothing else was changed. The per-item runs of M4-10 are kept in this directory as well (`*-m4-10-*`, see `README.md`).

## Exit criteria

| Criterion | Evidence |
|---|---|
| A multi-file material configurator loads a supported model | `configurator.spec.ts` "loads the model": the mesh file is `ready` before mount resolves; ten entities at the hand-derived node transforms; 74 717 of 76 800 pixels compared with an independent CPU model (a ray tracer over the GLB's own geometry plus the M4-01 oracle), largest difference 1/255 against a tolerance of 3. The example has three modules (`model.mtek`, `materials.mtek`, `main.mtek`) |
| …changes material inputs | "changing host inputs …": the defaults and six input changes (seat colour, metallic, roughness, rail colour, stripe colours, sun off, sun 8) each equal the model; the changes create no pipelines or bind groups; rejected inputs return typed errors. The host page's own controls produce the same pictures |
| …survives resize | "survives resize …" and "a change of the pixel ratio …": seven sizes and aspects, each equal to the model at its size (max 1/255); recovery and resize specs in `specs/m4/resilience-*.spec.ts` |
| …produces repeatable test captures | "captures are repeatable …": two mounts in separate browser contexts give identical SHA-256 digests at all three steps; a different input sequence gives different digests. The digests were also identical across separate Playwright runs on this machine ([`m4-configurator-counters-gate.json`](m4-configurator-counters-gate.json)) |
| An unsupported required asset feature fails explicitly | `configurator-variants.spec.ts`: the example with a normal-texture GLB fails `mtek check` and `mtek build` with `MTEK-E7016` at the `asset.glb(…)` path literal, and a GLB requiring an extension fails with `MTEK-E7004`; each message names the feature and nothing is built ([`m4-configurator-variants-gate.json`](m4-configurator-variants-gate.json)). The other profile rows fail at compile time too: `tests/assets/fail/` has 85 projects and `cargo test` asserts the exact diagnostics. A damaged or missing file at run time rejects mount with `asset-failed` (`assets.spec.ts`) |
| A repeated-object scene demonstrates the claimed instancing path through counters and equivalent output | `instancing.spec.ts`: 500 identical boxes give `drawCalls` 500 → 1, with an image identical to `test.disableInstancing`; a mixed 17-entity scene gives 17 → 5. `configurator.spec.ts` "80 copies need 5 draw calls instead of 80": copies of the chair with non-uniform scale and rotation under `Pbr`, `drawCalls` 80 → 5, `instancedDraws` 4, and 0 of 172 800 pixels differ from the non-instanced image. A deliberate break of the instance normal matrix made that spec fail with 1 076 pixels off by more than 3/255 (run once by hand, not a committed test) |
| The documented opaque PBR subset, texture parameters, culling, counters | `pbr.spec.ts`, `textures.spec.ts`, `culling.spec.ts` (nine spheres, camera moved away: `culledObjects` 0, 5, 9 and `drawCalls` 9, 4, 0, culled frames pixel-identical to `disableCulling` frames), the counter set in `m4-configurator-counters-gate.json` |

**Guardrail 1 — an unlit approximation is not a passing PBR implementation.** `lighting.pbr` is a generated WGSL helper that evaluates the spec's §8 over the frame block's lights, and it is compared against the independent `f64` oracle, not against itself. Measured on the hardware adapter (10 pixels per case, 256×256 target): the largest error is 1/255 in every case — metallic 0 and 1 × roughness 0.2 and 0.8 under a sun; a ranged point light inside the window, across its edge and outside it; an unlimited point light at two distances; three ambient-only variants; three lights with a coloured sun; saturation at 12 and 5000 lux (red clips to 255 while green and blue keep their unclipped values, so there is no tone mapping). The "outside the range window" image is byte-identical to the ambient-only image. Sensitivity was checked: dropping the square of the point-light window fails the spec with a 4-byte error. The configurator's Pbr pixels are compared with the same oracle.

**Guardrail 2 — do not declare broad glTF support from one hand-picked file.** `spec/assets.md` §3 lists exactly the v0.1 profile; the asset fixtures are generated from explicit data by `tests/assets/tools/make-glb.mjs` (not downloaded); `tests/browser/support/assets-profile.test.ts` fails if a row of the documented profile lacks a failing fixture. The consistency test is not a support claim. This report makes no glTF support claim beyond that profile.

## Defects found and fixed during M4

- `World.rebindParams` wrote texture and sampler params through the uniform-block writers, so device recovery of any textured material failed all attempts with `E8062` (found by M4-06; covered by the recovery-with-assets spec in `assets.spec.ts`).
- `resolve_host_inputs` in the packager passed an empty set to the validator, so every colour host input got the `color-hex` codec instead of `color-hex-opaque`, and `setInput("…", "#11223344")` was accepted (found by M4-10, regression test `a_colour_state_bound_into_a_material_colour_gets_the_opaque_host_input_codec`).
- Merge integration: the development GPU timer stayed bound to the lost device after a recovery, and the test-texture override was dropped on recovery (both found while merging M4-07 and M4-04; regression tests added).
- M3, found earlier: `copyValue` dropped `w` from migrated rotations (see `evidence/M3/report.md`).

## Environments

| Record | Adapter |
|---|---|
| [`environment-gate-full-hardware.json`](environment-gate-full-hardware.json) | AMD Radeon RX 7900 XTX, `isFallbackAdapter: false` |
| [`environment-gate-full-software.json`](environment-gate-full-software.json) | SwiftShader software adapter (informational) |
| [`environment-gate-full-benchmarks.json`](environment-gate-full-benchmarks.json) | the hardware configuration, benchmark baselines |

## Deviations

1. **The shared parameter block rule.** The M4-08 definition of compatible instancing needs "the same shared parameter block", which could never hold while every entity owned its block. Identical `shareable` instances now share one block (decision 0059); a write that would change it gives that instance its own copy.
2. **Provisional asset code mappings.** The spec has no code for a missing asset file; M4-05 added `E7020`. Malformed containers map to `E7001`, a primitive without `POSITION` to `E7010`, an accessor without a buffer view to `E7011`, differing sampler wraps or filters to `E7018`. Validation is eager and stricter than the spec's wording (the whole file is rejected even if a program only uses a clean mesh). Open operator question on the board.
3. **`CURRENT_MILESTONE` still reads `M1`** in `crates/mtek-compiler/src/stdlib/model.rs:46`. The M4 features were opened per item (as in M3) and not through this constant. It blocked no criterion.
4. **Test hooks.** Several behaviours are exercised through `options.test` (`canvasRenderTarget`, `recovery`, `disableCulling`, `disableInstancing`, `textures`, `onAssetState`) and `devOverlay`; none exists in a production mount without it, and the release bundle has no overlay code (checked on the real bundle).

## Unsupported / remaining

1. **One hardware machine.** All hardware evidence comes from one Windows 11 machine with an AMD RX 7900 XTX (D3D12). SwiftShader results (192/192) are informational; cross-adapter equality of captures is not claimed.
2. **Not pushed at gate time.** The gate ran on the local clone; no CI run exists for it.
3. **f32 near the roughness floor.** The WGSL evaluates the GGX denominator in `f32`; near the clamp at roughness 0.045 the peak of `D` can be about 1.4% off the `f64` oracle by analysis. The PBR specs use roughness 0.2 and 0.8 only, so this is not measured on the GPU.
4. **Open spec questions about the PBR formulas** (diffuse `(1-F)` with the metal-mixed Fresnel, the squared range window, ambient not scaled by `(1-m)`, cancellation at the roughness floor, `L = -V` half-vector NaN). The implementation follows the spec as written; the questions are on the board and unanswered. `L = -V` with `NL > 0`, a point light exactly at the surface and zero-length normal or view vectors give NaN in the shader and the oracle alike (the spec defines no value).
5. **Not exercised on hardware:** the `E8002` device-limit check and meshes that need 32-bit indices (more than 65 535 vertices) are covered by fake-GPU unit tests only. The chair in the configurator has no texture; textured models are covered by `assets.spec.ts`.
6. **On-screen presentation.** The configurator specs run with the manual clock into offscreen targets; the `requestAnimationFrame` loop and the canvas presentation path are not asserted by pixels in M4.
7. **Without `crypto.subtle`** only the byte length of an asset is verified (the spec allows it); a JPEG with EXIF orientation would be rotated by the browser (`imageOrientation` is the default). Both are non-blocking questions on the board.
8. **Repeated device loss.** A device that is lost again after each successful recovery gets a fresh budget of three attempts each time; every cycle is reported, there is no overall cap (decision 0056).
9. **One skipped unit test.** `benchmarks/tools/hash-holdout.test.ts` "rejects symbolic links" (creating a symbolic link needs a Windows privilege). No criterion depends on it.
