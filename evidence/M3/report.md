# M3 progress report (M3-08 scaffold — not the M3 gate)

- Milestone: **M3 — Make the program interactive**
- Work item: **M3-08** `mtek new`, `examples/pulse-cube`, M3 behaviour browser specs
- Tip at authorship: see git history on `plan/blueprint`
- Decision: **partial**. Scaffold and specs landed. The complete Demo **does not yet check/build** on this branch because M3-01..M3-05 (bind, lifecycle, handlers, `self`, runtime phases 2–5, `debug.pressKey`) are marked done on the board but **absent from `plan/blueprint` / `main`**. Only M3-06 and M3-07 commits exist after the M2 merge.

## Implemented behaviour (this work item)

| Item | Status | Proved by |
|---|---|---|
| `mtek new NAME` scaffolds `mtek.toml` + `[host.inputs] tint`, Demo `src/main.mtek`, `.gitignore` | landed | `crates/mtek-cli` unit + `tests/cli.rs` (`new_scaffolds_the_demo_project`, …) |
| `examples/pulse-cube/` = scaffold output + README | landed | committed tree; `new_matches_examples_pulse_cube_aside_from_the_name` |
| Browser behaviour specs (rotation, Space, bind time, setInput, pause/resume, reload pointers) | written | `tests/browser/specs/m3/pulse-cube.spec.ts` (+ existing `hot-reload.spec.ts`) |
| Demo `mtek check` / `mtek build` | **blocked** | `scaffold_check_reports_e9010_until_m3_gates_open` (expects `MTEK-E9010`) |
| Hardware GPU behaviour run | **not executed here** | no WebGPU adapter in this environment |

## Tests run

Agent environment (Europe/Copenhagen, 2026-10-06, no WebGPU adapter):

| Command | Result |
|---|---|
| `cargo test -p mtek-cli --locked` | **85 passed** (56 bin unit + 24 cli integration + 5 dev), including `new_*` and `scaffold_check_reports_e9010_until_m3_gates_open` |
| `cargo clippy -p mtek-cli --all-targets --locked -- -D warnings` | passed (also fixed pre-existing `collapsible_if` in `mtek-compiler` check.rs from M3-06) |
| `npm run check:ts` | passed |
| `MTEK_REQUIRE_GPU=1 npm run test:browser:hardware -- specs/m3/` | **not executed** — no WebGPU adapter |

Preferred hardware command:

```bash
npm run build
MTEK_REQUIRE_GPU=1 npm run test:browser:hardware -- specs/m3/
```

## Exit gate checklist (M3)

| Criterion | Evidence |
|---|---|
| Demo rotates and responds to Space | specs written; **NOT runnable** until M3-01..05 + GPU |
| Colour edit updates material without pipeline rebuild | `specs/m3/hot-reload.spec.ts` (unit + browser); GPU NOT-RUN here |
| Pause/resume no simulation jump | pulse-cube spec written; blocked on Demo build |
| Failed shader edit keeps last valid scene | hot-reload.spec.ts |
| Compatible state survives reload; incompatible → W8070 | hot-reload.spec.ts |

## Deviations

- M3-01..M3-05 board status says `done`, but no corresponding commits/branches on GitHub. `CURRENT_MILESTONE` remains `M1`. Non-blocking question filed on M3-08.

## Unsupported / remaining

- Open M3 language gates and wire runtime phases 2–5 + `debug.pressKey` / `releaseKey` / `setParam`.
- Re-run `mtek check` / `mtek build` on `examples/pulse-cube` until green.
- Produce hardware evidence under this directory with `MTEK_REQUIRE_GPU=1`.
- M3-GATE completion report replaces this partial note.
