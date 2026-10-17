# M3 completion report

- Milestone: **M3 — Make the program interactive** (blueprint §11, M3)
- Gate task: M3-GATE
- Gate run: clean `git clone` of the local `main` into a new directory at commit `87717b6` (`gitCommit` in every gate environment record, `gitDirty: false`), 2026-10-17, Node 24.18.1, Windows 11. **The commit has not been pushed**, so no CI run of it exists and none is cited.
- Decision: **passed**. Each exit criterion and the guardrail below links to evidence from this gate run. Every rendering and behaviour criterion was proved on a hardware WebGPU adapter (`isFallbackAdapter: false`, AMD Radeon RX 7900 XTX). None rests on a NOT-RUN result or a software-adapter result.

## Implemented behaviour

| Work item | What now works | Proved by |
|---|---|---|
| M3-01 | Scene and entity `state`, assignable places, construction-only fields, the single-writer analysis with two-span conflict diagnostics, the imperative update class for written params | `tests/semantics/{pass,fail}` fixtures (for example `e5073_write_to_construction_only_field`), `tests/codegen/state_and_handlers/` |
| M3-02 | Lifecycle functions (`init`, `update`, `fixed_update`, …) and event handlers (`on key_down(Key.Space)`) checked and lowered; `is_key_down`, `random`, `print` | `tests/semantics/fail/e5050`–`e5061` fixtures, `tests/codegen/state_and_handlers/`, `tests/codegen/behaviors.test.ts`; [decision 0049](../../spec/decisions/0049-state-lifecycle-and-handlers.md) |
| M3-03 | The runtime runs generated code through seven scheduler phases: fixed-step accumulator with clamps and a discarded-step counter, keyboard and pointer input with ordering and focus resync, pause and resume, seeded PRNG | `packages/runtime-web/src/schedule/` and `src/input/` unit tests, `src/host/behavior.test.ts`; [decision 0050](../../spec/decisions/0050-scheduler-input-and-cpu-services.md) |
| M3-04 | Dirty-tracked transforms, parent-before-child propagation, normal matrices, object uploads only on change | `src/scene/world.test.ts` (including upload counters); `specs/m3/upload-counters.spec.ts` on hardware |
| M3-05 | `bind()`: checks (`E5004`, `E5005`, `E5070`, `E5075` with cycle paths), dependency graph, topological order, lowering, phase-5 evaluation with `writeIfChanged` | `tests/semantics/fail/e5004_*`, `e5005_*`, `e5070_*`, `e5075_*`, `tests/codegen/bindings/`; [decision 0051](../../spec/decisions/0051-bind.md) |
| M3-06 | `[host.inputs]` in `mtek.toml`, codecs, generated `Inputs` declarations in `app.d.ts`, `setInput` queue with typed results applied at the frame boundary | `src/host/codecs.test.ts`, the Rust CLI tests; `specs/m3/pulse-cube.spec.ts`; [decision 0052](../../spec/decisions/0052-host-inputs-and-scene-state.md) |
| M3-07 | `replaceProgram`: candidate loaded and validated in full before an atomic swap, state migration by identity and type, pipeline reuse, `W8070` restarts with an explanation, overlay | `src/host/reload.test.ts`; `specs/m3/hot-reload.spec.ts` and `specs/m3/pulse-cube.spec.ts` on hardware |
| M3-08 | `mtek new` scaffolds the blueprint `Demo`; `examples/pulse-cube` is the scaffold output; behaviour specs for every exit criterion on the Demo itself | `crates/mtek-cli` tests (`new_*`), `specs/m3/pulse-cube.spec.ts` |

## Tests run

Gate run on 2026-10-17 from a clean `git clone` of the local `main` into a new directory, at `87717b6`, with the logs kept outside the clone. Every stage ran after a fresh `npm ci`.

| Stage | Command | Result |
|---|---|---|
| Format, lint, types, naming, tasks | `npm run check` | passed |
| Rust | `cargo test --workspace --locked` | **1129 passed, 0 failed** ([`cargo-test-gate.txt`](cargo-test-gate.txt)) |
| TypeScript unit | `npm run test:unit` | 781 + 102 + 998 + 74 (+1 skipped, see below) + 8 passed, 0 failed |
| Browser, all projects | `MTEK_REQUIRE_GPU=1 npm run test:browser` | **265 passed, 0 failed, 0 not-run**: hardware 129, software 129 (informational), benchmarks 7 ([`test-results-gate-full.json`](test-results-gate-full.json); environment records `environment-gate-full-*.json`) |
| Browser, M3 on hardware | `MTEK_REQUIRE_GPU=1 npm run test:browser:hardware -- specs/m3/` | **12 passed, 0 failed, 0 not-run** ([`test-results-gate-m3-hardware.json`](test-results-gate-m3-hardware.json)) |

The 12 M3 specs: 3 in `hot-reload.spec.ts` (the fixture program), 8 in `pulse-cube.spec.ts` (the Demo), 1 in `upload-counters.spec.ts`.

`npm run evidence:sanitize` made the paths in the JSON reports repo-relative. In the cargo log, only the summary lines were kept, with the clone's absolute path replaced by `<repo>` and terminal colour codes removed. Nothing else was changed.

## Exit criteria

| Criterion | Evidence |
|---|---|
| The complete `Demo` rotates | `pulse-cube.spec.ts` "after N fixed steps rotation equals speed·t about +Y within 1e-5 rad": 60 steps of 1/60 s at speed 0.7 |
| …and responds to Space | "pressing Space reverses direction": `speed` goes from 0.7 to -0.7 |
| Material colour follows `bind(frame.time)` and a host input | "material colour follows bind(frame.time) through pulse"; "setInput(\"tint\", \"#f04f72\") changes the colour at the next frame" |
| A colour edit updates the existing material without a pipeline rebuild | "colour edit: the existing material is updated and pipelinesCreated is unchanged": a real compiled variant of the Demo is the reload candidate; the tint turns from blue-dominant to red-dominant while `pipelinesCreated` stays equal. Also `hot-reload.spec.ts` on the fixture program |
| Pause and resume cause no simulation jump | "pause → wait → resume: rotation advances only by stepped time": rotation is unchanged while paused and advances by exactly `speed·5·dt` after resume (1e-5 rad) |
| A failed shader edit leaves the last valid scene running | "failed shader edit keeps the last valid scene": the candidate's shader is corrupted; `replaceProgram` returns `MTEK-E8051`, the app stays `running`, pipelines and entities are unchanged, `speed` is intact |
| Compatible state survives reload | "compatible state survives reload; …": after Space the `speed` is -0.7; after reloading a compiled variant the speed and the rotation are the same and there is no `W8070` |
| Incompatible changes restart with an explanation | same spec, second half: a compiled variant with an added entity restarts the scene and reports `MTEK-W8070` naming `Demo.Extra`; `speed` is back at 0.7 |
| Persistent state, input events, lifecycle handlers, `bind`, stable scheduling, transform propagation, host inputs, candidate-based reload | the work-item table above; all suites in the table above passed from the clean clone |

**Guardrail — a reactive field and an imperative handler cannot silently compete for ownership.** `tests/semantics/fail/e5070_write_to_bound_field` and `e5070_write_to_bound_param` assign a bound entity field and a bound material parameter from `update`. Each assignment is `MTEK-E5070` with a related span at the `bind`, and `every_fail_fixture_has_exactly_the_expected_diagnostics` (`crates/mtek-compiler/tests/fixtures.rs`, part of `cargo test --workspace`, 1129 passed) requires exactly the diagnostics in `expected.diag.json`. The Demo itself passes `mtek check` with 0 errors and 0 warnings: `Cube.rotation` is written only by `update`, and `tint`/`phase` only by their bindings.

## Upload counters for the Demo (input to hypothesis H3)

Measured on hardware by `specs/m3/upload-counters.spec.ts` with the manual clock at dt = 1/60 (registry counters `uploads` and `uploadBytes`; full record [`m3-upload-counters-gate.json`](m3-upload-counters-gate.json)):

| Scenario | Frames | Uploads | Bytes |
|---|---|---|---|
| Mount (before the first frame) | – | 4 | 840 |
| First frame (every block written once) | 1 | 3 | 448 |
| Rotating cube, `phase` bound to `frame.time` | 60 | 120 (2 per frame) | 9600 (160 per frame) |
| `dt = 0`: nothing changes | 60 | **0** | **0** |
| Space pressed, one frame at `dt = 0` | 1 | **0** | **0** |
| `setInput("tint")`, one frame at `dt = 0` | 1 | **1** | **32** |
| `dt = 0` again after the edits | 60 | **0** | **0** |

Reading for H3: the volume is attributable. The two per-frame uploads of a rotating frame are the object block (the cube's transform) and the bound material block (`phase`). A frame in which nothing changed uploads nothing. A host-input edit costs exactly one 32-byte write of the material parameter block. These are one scene and one machine; the number says the mechanism works, not how it scales. The M3-GATE assertions pin only the shape (0 when nothing changed, at most 4 uploads and 512 bytes per changing frame, exactly one write per input edit), not these exact byte counts.

## Defect found and fixed on the way

`copyValue` in `packages/runtime-web/src/host/reload.ts` tested `isVec3` before `isQuat`. A quaternion also satisfies `isVec3`, so state migration dropped `w` from every migrated rotation, and the next frame after a state-preserving reload threw `RangeError: normal matrix of a singular transform is undefined`. The fixture-based reload specs never stepped a frame after migrating a rotation. Fixed in M3-08 (commit `773e779`); regression tests are `copyValue` in `reload.test.ts` and the Demo reload specs, which step after the swap.

## Environments

| Record | Adapter |
|---|---|
| [`environment-gate-full-hardware.json`](environment-gate-full-hardware.json) | AMD Radeon RX 7900 XTX, `isFallbackAdapter: false` |
| [`environment-gate-full-software.json`](environment-gate-full-software.json) | SwiftShader software adapter (informational) |
| [`environment-gate-full-benchmarks.json`](environment-gate-full-benchmarks.json) | the hardware configuration, benchmark baselines |

## Deviations

1. **The M3 board history.** M3-01 to M3-05 were first marked done without their code reaching `main`; they were re-landed (merges `c650cdc`, `e238e19`, `b9223fa`, `66074a5`) before M3-06 to M3-08. The earlier partial M3-08 note that said the Demo did not build is replaced by this report. The gate was run on the re-landed code only.
2. **`CURRENT_MILESTONE` still reads `M1`** in `crates/mtek-compiler/src/stdlib/model.rs:46`, although M3 behaviour ships and the Demo compiles. It did not block any M3 criterion, but it is stale and appears in the `Pbr is M4; this build is M1` check in `prelude.rs`. Moving it belongs with the M4 gating work; not changed here.

## Unsupported / remaining

1. **Single hardware machine.** All hardware evidence comes from one Windows 11 machine with an AMD RX 7900 XTX (D3D12). SwiftShader results (129/129) are informational and no criterion rests on them.
2. **Not pushed, no CI.** The gate ran locally on an unpushed commit.
3. **Reload is exercised through `replaceProgram`.** The M3 specs hand real compiled variants of the Demo to `replaceProgram`. No browser spec runs `mtek dev`, edits a source file on disk and watches the page reload.
4. **One skipped unit test.** `benchmarks/tools/hash-holdout.test.ts` "rejects symbolic links" (creating a symbolic link needs a Windows privilege). No criterion depends on it.
5. **Upload counters are for one scene.** See the H3 note above.
