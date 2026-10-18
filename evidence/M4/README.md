# M4 evidence: task M4-10 (the material configurator and the gate specs)

This directory holds the run records of task M4-10 only. It is **not** the gate report (`report.md` is written by the gate task) and it does not cover the other M4 work items' own runs.

- Commit under test: `88c2ef8` (branch `task/m4-10-configurator`, `gitDirty: false` in both environment records). Windows 11, Node 24.18.1, Chromium through Playwright 1.63.
- Hardware adapter: AMD Radeon RX 7900 XTX (`isFallbackAdapter: false`), see `environment-m4-10-hardware.json`. The software records are informational only (SwiftShader) and are not hardware evidence.
- `npm run evidence:sanitize` made the paths of the two Playwright reports repo-relative; the cargo and unit logs keep only their summary lines; the environment records and the two counter records are the files the specs wrote, unchanged.

| File | Command | Result |
|---|---|---|
| `test-results-m4-10-hardware-full.json`, `environment-m4-10-hardware.json` | `MTEK_REQUIRE_GPU=1 npm run test:browser:hardware` | **192 passed, 0 failed, 0 not-run** (every earlier spec and the 13 new ones) |
| `test-results-m4-10-configurator-software.json`, `environment-m4-10-software.json` | `npm run test:browser -- --project=software specs/m4/configurator` | 13 passed (informational) |
| `m4-configurator-counters-hardware.json`, `m4-configurator-variants-hardware.json` | written by `specs/m4/configurator.spec.ts` and `configurator-variants.spec.ts` in the hardware run | counters, digests and comparison figures quoted below |
| `cargo-test-m4-10.txt` | `cargo test --workspace --locked` | **1204 passed, 0 failed** |
| `unit-tests-m4-10.txt` | `npm run test:unit` | 1019 + 214 + 1004 + 74 (+1 skipped, as before) + 8 passed, 0 failed |
| (not kept) | `npm run check` | passed: `cargo fmt --check`, clippy `-D warnings`, `tsc -b`, eslint, naming, tasks, `check:assets` |

Cargo ran with `CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0` because the disk was nearly full; this only drops debug information.

## What the 13 specs measured (hardware)

All pixel figures compare the 8-bit `rgba8unorm-srgb` readback with the CPU model of `tests/browser/support/configurator-scene.ts` (a ray tracer over the GLB's own geometry and the PBR oracle), over the pixels whose one-pixel footprint is uniform. Tolerance 3/255; **the largest difference measured anywhere was 1/255.**

| Exit-gate sentence | Spec | Measured |
|---|---|---|
| loads a supported model | `configurator.spec.ts` "loads the model" | 1 mesh file `ready` before mount resolved; 10 entities at the hand-derived node transforms (to 5 decimal places); 74 717 of 76 800 pixels compared, max 1/255; every entity owns at least 60 stable pixels; `liveEntities` 12, `drawCalls` 7, `instancedDraws` 1 (the four legs), `sharedParamBlocks` 1, `ownedParamBlocks` 5, `pipelinesCreated` 3 |
| changes material inputs | "changing host inputs ...", "rejected inputs ..." | the defaults and six input changes (seat colour/metal/roughness, rail colour, stripe colours, sun off, sun 8) each equal the model (74 717 px, max 1/255); only the driven entity's pixels change and more than 90 % of them do; `pipelinesCreated`, `shaderModulesCreated`, `bindGroupsCreated`, `texturesAllocated`, `liveBuffers`, `liveTextures` constant; wrong type, translucent colour and unknown name are rejected (`E8041`, `E8100`, `E8040`) and change nothing |
| survives resize | "survives resize ...", "a change of the pixel ratio ..." | 320x240, 480x240, 240x480, 200x200, 400x300, 96x72 and 320x240 again, each equal to the model at its size (6 350 to 117 358 px, max 1/255); the first and last 320x240 frames are byte-identical; pixel ratio 1, 2, 1 equal to the model at 200x150 and 400x300; no diagnostics, no pipeline created, `framesSkipped` 0 |
| repeatable test captures | "captures are repeatable ..." | two mounts in separate browser contexts: identical SHA-256 at all three steps (`dc7c8513...`, `6b617f01...`, `003942bd...`); a different input sequence gives a different second digest. The same digests (and the same input-step digests) came out of three separate Playwright runs on this machine (one dedicated run of the configurator specs and two full hardware runs); software and hardware bytes differ, both within 1/255 of the model |
| host page | "the host page drives the program with setInput" | its real controls change the picture to the model's (74 717 px, max 1/255) |
| an unsupported required asset feature fails explicitly | `configurator-variants.spec.ts` | the example with a normal-texture GLB: `mtek check` and `mtek build` exit 1 with `MTEK-E7016` only ("The material 'Fabric' (materials[1]) uses normalTexture ...") at `src/model.mtek:4:32`, nothing written; with a required-extension GLB: `MTEK-E7004` naming `KHR_draco_mesh_compression`; the human-readable report names both |
| instancing demonstrated by counters and equivalent output | "80 copies need 5 draw calls instead of 80" | 80 copies with non-uniform scale and rotation: `drawCalls` 80 -> 5, `instancedDraws` 4, +1 pipeline, +1 buffer; **0 of 172 800 pixels differ** between instanced and individual; both within 1/255 of the model over 162 896 pixels and 80 entities; the model with model-matrix normals disagrees with the GPU on more than 500 pixels, so the agreement is not vacuous |

## Not covered

- Only this machine's adapter and driver; cross-adapter equality of captures is not claimed.
- Manual-clock frames into offscreen targets; the on-screen presentation and the `requestAnimationFrame` loop are not asserted by pixels here.
- The chair has no texture; two profile violations (normal texture, required extension) are built end to end, the other rows of the profile rest on `tests/assets/fail/` and `cargo test`.
- No broad glTF support is claimed: `tests/browser/support/assets-profile.test.ts` only checks that every row of the documented profile has a failing fixture.
- The runtime mutation that proves the instancing spec's sensitivity (the instance record's normal matrix replaced by the model matrix: 1 076 pixels off by more than 3/255, worst 32 levels) was run once by hand and reverted; it is not a committed test.

## Defect found and fixed

The packager gave every colour host input the codec `color-hex` instead of `color-hex-opaque` (spec/runtime-abi.md section 6.3), so `setInput("seat_color", "#11223344")` was accepted. Fixed in `crates/mtek-compiler/src/package/builder.rs` with the regression test `a_colour_state_bound_into_a_material_colour_gets_the_opaque_host_input_codec`; decision 0061 item 8.
