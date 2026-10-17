# M3 progress report (M3-08 — not the M3 gate)

- Milestone: **M3 — Make the program interactive**
- Work item: **M3-08** `mtek new`, `examples/pulse-cube`, M3 behaviour browser specs
- Base: `1b90922` (`main` ≡ `plan/blueprint`), plus the M3-08 completion commit
- Decision: **M3-08 complete.** The complete `Demo` checks, builds and runs; all 11 M3 browser specs pass on a hardware WebGPU adapter (AMD Radeon RX 7900 XTX, `isFallbackAdapter: false`); none is NOT-RUN. The M3 exit gate itself is decided by **M3-GATE**, not by this report.

This report replaces an earlier partial note, written while M3-01..M3-05 were missing from the branch. They have since landed (merges `c650cdc`, `e238e19`, `b9223fa`, `66074a5`), so `examples/pulse-cube` is no longer gated by `E9010`.

## What M3-08 delivers

| Item | Proved by |
|---|---|
| `mtek new NAME` scaffolds `mtek.toml` (with `[host.inputs] tint`), the Demo `src/main.mtek`, `.gitignore`; the scaffold checks and builds | `crates/mtek-cli` unit tests and `tests/cli.rs` (`new_*`, `new_matches_examples_pulse_cube_aside_from_the_name`) |
| `examples/pulse-cube/` is the scaffold output with a README | committed tree; `mtek check` reports 0 errors, 0 warnings; `mtek build` builds it |
| Rotation equals `speed·t` about +Y within 1e-5 rad after N fixed steps | `specs/m3/pulse-cube.spec.ts`, hardware |
| Space reverses direction | same |
| Material `phase` follows `bind(frame.time)` | same |
| `setInput("tint", "#f04f72")` changes the colour at the next frame | same |
| Pause, wait, resume: rotation advances only by stepped time | same |
| Colour edit through reload updates the existing material; `pipelinesCreated` unchanged | same; a real compiled variant of the Demo (`bind(tint)` replaced by a literal) is the reload candidate |
| Failed shader edit keeps the last valid scene (`MTEK-E8051`, scene still running, same pipelines and entities) | same, against the Demo's own manifest |
| Compatible state survives reload (toggled `speed` and rotation kept, no `W8070`); an added entity restarts with `MTEK-W8070` naming `Demo.Extra` | same; the candidate is a real compiled variant with a second entity |
| Same criteria on the fixture program | `specs/m3/hot-reload.spec.ts`, hardware |

## Defect found and fixed while writing the reload specs

`copyValue` in `packages/runtime-web/src/host/reload.ts` tested `isVec3` before `isQuat`. A quaternion also satisfies `isVec3`, so state migration copied rotations as `{x, y, z}` and dropped `w`. After any state-preserving reload the next frame threw `RangeError: normal matrix of a singular transform is undefined`. The fixture-based reload specs never stepped a frame after a migrated rotation, so they did not catch it. Fix: test `isQuat` first. Regression tests: `copyValue` in `src/host/reload.test.ts`, and the Demo reload specs above (which step after the swap).

## Tests run (this work item)

Windows 11, Node 24.18.1, hardware project, `MTEK_REQUIRE_GPU=1`:

| Command | Result |
|---|---|
| `MTEK_REQUIRE_GPU=1 npm run test:browser:hardware -- specs/m3/` | **11 passed, 0 failed, 0 not-run** (`test-results-m3-specs.json`, `environment-m3-specs.json`) |
| `npm run check` (fmt, clippy `-D warnings`, tsc, eslint, naming, tasks) | passed |
| `npm run test:unit` | passed (runtime-web 781, plus the other workspaces) |
| `cargo test --workspace --locked` | passed |

The full browser suite and a clean-clone run are M3-GATE's job.

`npm run evidence:sanitize` made the paths in the JSON records repo-relative. Nothing else was changed.

## Remaining for the M3 gate

- Clean-clone run of every suite, and the full `MTEK_REQUIRE_GPU=1 npm run test:browser`.
- Record the measured upload counters for the Demo (input to hypothesis H3).
- Map each M3 exit criterion and the `E5070` guardrail fixtures to evidence in the gate report.
