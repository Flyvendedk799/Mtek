# M2 exit-gate browser specs (task M2-12)

Real-WebGPU evidence for the four M2 exit criteria. Run on a hardware adapter (`isFallbackAdapter: false`,
see [`environment-m2-specs.json`](environment-m2-specs.json)) with
`MTEK_REQUIRE_GPU=1 npx playwright test --project=hardware specs/m2` (the same specs also run, informationally,
on the software project): **16 passed, 0 failed, 0 not-run** ([`test-results-m2-specs.json`](test-results-m2-specs.json),
sanitised with `npm run evidence:sanitize`). The milestone report that cites this evidence is the M2-GATE task's.

| Exit criterion | Spec | What it asserts |
|---|---|---|
| The `Pulse` material runs with a changing parameter | `specs/m2/pulse.spec.ts` | The fixture `fixtures/m2/pulse` is the blueprint's `Pulse` with a pure `pulse(t) = 0.65 + 0.35 * sin(t)`. `phase` is changed through `app.debug.setParam` over seven frames (0.5, π/2, 2.0, π, 4.0, 5.5, 0.0); the centre of the box and three more interior points match `tint * pulse(phase)` computed on the CPU (sRGB-encoded, within 3/255; the first frame is exact), the corners stay the clear colour, `pipelinesCreated`, `shaderModulesCreated`, `bindGroupsCreated`, `livePipelines` and `liveBindGroups` are constant, every write is exactly one upload, and the only buffer allocated per frame is the `readPixels` staging buffer. |
| Invalid captures and CPU-only function calls from shader code are rejected | `specs/m2/rejections.spec.ts` | Nine checked-in fail fixtures through `mtek check --format json` (exit 1, one schema-valid report, exactly the expected codes, byte spans, line/columns, messages and notes) and `mtek build --mode test` (refused, no output): `E4040` for a fragment that captures scene state, `frame.time`, an entity field or `self` or calls a `cpu fn`; `E4002` for shader code (or a pure `fn`) that reaches a `cpu fn` directly, through a chain, through a pure `fn` or through an import. A GPU-only built-in called from CPU code is rejected as `E9010` (see "Not reachable" below). |
| Mixed-layout round trip passes | `specs/m2/mixed-layout.spec.ts` | The built manifest's layout of `Mixed` equals `tests/gpu-layout/mixed.layout.json` (size 64, align 16, every member). In the scene the fragment reads `a: f32`, `b: vec3`, `c: u32`, `d: vec2`, `e: bool`, `f: color` through their typed WGSL paths and compares each with the exact constant the CPU wrote: the `Match` entity is white, the `Mutated` entity black. Fourteen run-time writes through `debug.setParam` change each member alone (including `b.z` by one binary32 step and `c` by one) and restore it: exactly the matching channel goes black and returns, the other entity is untouched. |
| Browser shader failures identify the originating declaration | `specs/m2/failures.spec.ts` | Two test-only post-build corruptions of the `pulse` WGSL. A non-WGSL line appended: `mountMtek` rejects with `shader-failed` (`E8051`), the diagnostic's source is the `material Pulse` declaration (file, line and column read from the fixture source), and the overlay shows it. `sin(` misspelled inside the Mtek function `pulse`: `shader-failed`, the diagnostic names the `0.65 + 0.35 * sin(t)` expression (its line of `src/main.mtek`, a byte range inside it), with a "generated from" note. The uncorrupted program mounts. |

Pixel values read back (annotations of the run): the initial `Pulse` frame is `rgb(87,75,211)` expected and actual;
at phase 0.5 expected `rgb(97,83,233)`, actual `rgb(97,84,233)`. The mixed-layout run reads
`Match rgb(255,255,255)` and `Mutated rgb(0,0,0)` initially, and `rgb(0,255,255)`, `rgb(255,0,255)` and
`rgb(255,255,0)` after the single-member changes.

## Not reachable: E4013

The task names `E4013` ("GPU-only intrinsic in CPU code") next to `E4040` and `E4002`. No program this compiler build
accepts can produce it: every GPU-only built-in function (`sample`, `lighting.pbr`) is planned for M4, so a program that
calls one is rejected earlier, as `E9010` ("specified for v0.1 but not implemented by this compiler build yet (planned
for M4)"). The spec asserts that rejection on a `cpu fn` that calls `sample` (exit 1, one error, `E9010`, no output).
The `E4013` rule itself is covered by `crates/mtek-compiler/src/types/effects_tests.rs`, which makes a built-in GPU-only
in a test registry and checks the diagnostics; `tests/fixtures.rs` lists `E4013` as unreachable in this build for that
reason. M4 turns the unit test into a fixture.
