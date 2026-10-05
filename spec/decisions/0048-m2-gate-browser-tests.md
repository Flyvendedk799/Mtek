# 0048. M2 exit-gate browser tests: details the specification leaves open

- Status: Accepted
- Date: 2026-10-05
- Blueprint origin: M2 exit gate (blueprint §11); `spec/testing.md` §6; `spec/runtime-abi.md` §10.2 and §12; decisions 0034 (the M1 gate tests this extends), 0043, 0046.
- Supersedes: nothing.

## Context

Task M2-12 asks for real-WebGPU evidence of the four M2 exit criteria. `spec/testing.md` says what to show, not how the fixtures are built, what is sampled, which existing fixtures stand for the compile-time rejections, or what to do about a criterion the compiler cannot yet exercise. Every choice here is a **proposal**.

## Decision

1. **Fixtures** live in `tests/browser/fixtures/m2/<name>/` and are built by global setup with `mtek build --mode test` into `.out/m2/<name>/` next to the M1 fixtures (`support/m2-fixtures.ts`): `pulse` (the blueprint material with a pure `pulse` function, a box that fills the middle of the view) and `mixed_layout` (a self-checking material whose params are the `mixed` layout of `spec/gpu-layout.md` §4.5 B, two entities of it, an orthographic camera so pixel positions are exact). The post-build corruptions of the `pulse` WGSL are derived in the same place: a non-WGSL line appended, and `sin(` misspelled to `sinn(`.
2. **Pixels are read back, never screenshotted**, from the offscreen `rgba8unorm-srgb` target through `app.debug.readPixels` (as M1). `pulse` is compared with a CPU expectation (declared tint, sRGB transfer of `spec/language.md` §5.4, the pure function) within 3/255; the mixed-layout material needs no tolerance because its fragment compares each param with the constant the CPU wrote and outputs 0 or 1 per channel, so the sRGB-encoded bytes are exactly 0 or 255.
3. **Parameters change through `debug.setParam`** (decision 0046) because `bind` is M3. The counters that must not move are `pipelinesCreated`, `shaderModulesCreated`, `bindGroupsCreated`, `livePipelines` and `liveBindGroups`; `buffersAllocated` rises by exactly one per frame because every `readPixels` allocates its staging buffer, which is asserted instead of ignored.
4. **Compile-time rejections reuse the checked-in fail fixtures** of `tests/semantics/fail/` (nine for `E4040` and `E4002`) and compare the whole `mtek check --format json` report with the fixture's `expected.diag.json` (code, span, message, notes), plus the refusal of `mtek build --mode test`. A capture of scene state also reports `E9010` for the `state` declaration (gated to M3), as the fixture expects.
5. **`E4013` cannot be produced by any program of this build** (every GPU-only built-in is planned for M4; `tests/fixtures.rs` lists it as unreachable). The gate shows what the build does: a `cpu fn` calling `sample` is rejected as `E9010`, and the rule itself stays covered by `effects_tests.rs`. The criterion "CPU-only function calls from shader code" is `E4002`/`E4040`, which are reachable and asserted.
6. **Shader failures** are shown twice: an appended non-WGSL line has no span-map entry, so the diagnostic falls back to the `material` declaration (its file, line and column are read from the fixture source, not hard-coded); a misspelled call inside `pulse` is reported inside a mapped expression, so the diagnostic names that expression. In both the mount rejects with `shader-failed` and the overlay carries the location.
7. **Evidence** is saved under `evidence/M2/`: the sanitised run record and environment record of the M2 specs, and `m2-specs.md`, which maps each criterion to its spec. The gate report of M2-GATE cites them.

## Consequences

- `npm run test:browser` and `test:browser:hardware` run 16 more specs per project (117 on hardware); global setup builds two more fixtures.
- When M3 adds `bind` and `state`, the `pulse` fixture can drive `phase` from `bind(frame.time)`; when M4 adds a GPU-only built-in, a fail fixture for `E4013` replaces item 5's unit-test coverage.

## Verification

`tests/browser/specs/m2/{pulse,rejections,mixed-layout,failures}.spec.ts`: 16 passed on the hardware adapter (`evidence/M2/test-results-m2-specs.json`), and the full `MTEK_REQUIRE_GPU=1 npm run test:browser:hardware` run: 117 passed, 0 failed, 0 not-run.
