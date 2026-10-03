# 0021. Benchmark task format: details fixed at M0

- Status: Accepted
- Date: 2026-10-03
- Blueprint origin: §12.1 and §12.2 (through `spec/tooling.md` section 6 and `spec/ai-and-benchmarks.md` section 6).

## Context

Task M0-10 writes the first five benchmark tasks (four seed tasks and one holdout task). While doing so, `spec/ai-and-benchmarks.md` section 6 and `spec/tooling.md` section 6 turned out to leave eight details open or in conflict. Each is a **proposal** (a design choice; nothing external constrains it). None of them has been exercised against a Mtek compiler, because none exists yet; the Mtek side of every task is unverified until M6-07.

1. The `mtek test` fixture format (`spec/tooling.md` section 6) has no step that gives a host input a value. The seed task `shader-bridge` cannot be tested without one.
2. The fixture format does not say how large the render target is, where the pixel origin is, what `tolerance` counts, or what happens when it is omitted.
3. `spec/tooling.md` section 6 puts fixtures in `tests/*.test.toml` **inside the project**, while `spec/ai-and-benchmarks.md` section 6.1 puts them in `mtek-tests/` **beside** the project (`mtek/`), so that a model editing the project never sees or changes the tests.
4. `task.toml` is specified only by an example. The work item adds the key `mtek_side_status`; a validator needs the exact key set to reject typos.
5. `spec/ai-and-benchmarks.md` section 6.2 says the holdout tree hash is recorded in `benchmarks/holdout.sha256`, but not how it is computed. The hash is only useful if it is identical on Windows and POSIX.
6. Section 6.3 says the baseline gets equivalent helper modules, but not what the baseline's test hooks look like.
7. The scan for holdout identifiers (section 6.2) names `tools/` and `spec/`; the work item adds `packages/`.
8. Fixtures describe observable behaviour for the Mtek side, and `baseline-tests/` must assert "the same observable behaviour". Two hand-written copies of the same expectations drift apart.

## Decision

### 1. Fixture step `set_input`

```toml
{ set_input = { tint = "#ff8800" } }
```
Exactly one entry. It calls `app.setInput(name, value)` (`spec/runtime-abi.md` section 6.2) with the value converted by the host codec of the input's type (`spec/runtime-abi.md` section 6.3: a colour is a hex string). The call is queued and applied in phase 1 of the **next** frame, so a fixture follows it with a `step`. If `setInput` returns `{ ok: false }` the fixture fails and reports the error code. `spec/tooling.md` section 6 carries a one-line pointer to this record.

### 2. Fixture semantics that `spec/tooling.md` section 6 left open

- The render target of `mtek test` is **128 x 128** (`rgba8unorm-srgb`, `spec/testing.md` section 6.3). Fixtures cannot change it in v0.1.
- `expect_pixel.x` and `.y` are integer pixel indices into the `readPixels()` result; `(0, 0)` is the top-left pixel, `y` grows downwards.
- `expect_pixel.color` is `"#rrggbb"`, compared with the red, green and blue bytes of that pixel as stored in the sRGB-encoded target (a colour literal in source, `spec/language.md` section 5.4, therefore reads back as the same hex digits, up to rounding). Alpha is not compared.
- `tolerance` is an integer, the largest allowed absolute difference per channel in bytes (0 to 255). When omitted it is **2**, the default of `spec/testing.md` section 6.3 for unlit colours.
- A step names a key by its `KeyboardEvent.code` string (`"Space"`, `"KeyA"`, ...), the right-hand column of `spec/stdlib.md` section 5.2.

### 3. Where the fixtures live

In a benchmark task the fixtures are in `mtek-tests/*.test.toml` next to the project, as in `spec/ai-and-benchmarks.md` section 6.1. To run them the harness copies them to `tests/` inside a scratch copy of the candidate project and runs `mtek test` there. The format is the one of `spec/tooling.md` section 6; nothing else differs.

### 4. `task.toml` keys

Required: `id`, `category`, `mode`, `title`, `prompt`, `required_symbols`, `mtek_side_status`, and a table `[budgets]` with `max_repairs`, `max_output_tokens`, `max_wall_seconds`. Optional: `starter_diagnostics`, a list of diagnostic codes in envelope form (`"MTEK-E3102"`) that the Mtek starter is expected to produce, for tasks whose starter does not compile (maintenance). No other keys are allowed; the validator rejects unknown keys. `mtek_side_status` is `"unverified-until-M6"` until task M6-07 compiles and tests the Mtek reference and starter, then `"verified"`. Both `required_symbols` and `starter_diagnostics` are predictions written from the specification, not compiler output.

The `id` of a task under `benchmarks/tasks/` is `<category>-NN` (two digits) and equals its directory name; the `id` of a holdout task is `holdout-NN`. Ids are unique across both directories.

### 5. Holdout tree hash

`benchmarks/tools/hash-holdout.mjs` computes it; `benchmarks/holdout.sha256` stores it as one line of 64 lowercase hex digits and a newline.

1. Take every regular file below `benchmarks/holdout/` (any depth). Skip the file names `.DS_Store`, `Thumbs.db` and `desktop.ini`. A symbolic link or other non-regular entry is an error.
2. Path of a file: relative to `benchmarks/holdout/`, `/` as separator on every platform.
3. Sort by the UTF-8 bytes of the path (not by locale).
4. For each file, in that order, form the line `<sha256 of the raw file bytes, lowercase hex>␠␠<path>\n` (two spaces; the format of `sha256sum`).
5. The hash is the SHA-256 of the UTF-8 bytes of all lines concatenated, in lowercase hex.

**Line endings.** File bytes are hashed as stored. `.gitattributes` already sets `* text=auto eol=lf` and this record adds an explicit `benchmarks/holdout/** text eol=lf`, so a checkout has LF line endings on every platform regardless of `core.autocrlf`. For text files (extensions `.toml .ts .mtek .md .json .html .txt .wgsl .js .mjs .css`) the script **fails** when it finds a carriage return, instead of silently normalising: a CRLF file means the checkout rules were bypassed, and a changed file must be detectable. The validator recomputes the hash on every `npm run check` and fails when it differs from `holdout.sha256`; an intended edit of the holdout set is a recorded change (a new hash in the same commit, with the reason in the commit message and, once release comparisons exist, a recorded rationale as required by `spec/ai-and-benchmarks.md` section 7).

### 6. Baseline test hooks

The three.js baseline of every task is a TypeScript module `src/main.ts` that calls `startTask` from the baseline support module (`benchmarks/baselines/support`). `startTask` is the equivalent of Mtek's runtime in test mode: a 128 x 128 `rgba8unorm-srgb` render target with a depth buffer, a manual clock (`step(frames, dt)`: queued input, then `update(dt)`, then render), key transitions, host inputs applied at the start of the next frame, and pixel readback. The support module also holds the helpers that correspond to Mtek's standard library (primitive meshes, look-at cameras, sRGB colour literals, unlit materials), which is the equivalent helper module of `spec/ai-and-benchmarks.md` section 6.3. Its size and contents are part of the baseline's documentation cost and are counted as such when the harness measures tokens.

### 7. Holdout identifier scan

The validator fails if any file below `spec/`, `tools/`, `packages/`, `crates/`, `scripts/`, `docs/` or `benchmarks/tools/` contains the id of a holdout task (a substring match on the directory names found in `benchmarks/holdout/`). The scan skips `node_modules`, `dist`, `target` and `.out`, and binary files. (`spec/ai-and-benchmarks.md` section 6.2 lists `tools/` and `spec/`; the other directories are the same idea applied to the rest of the code that the language design touches.)

### 8. One definition of success for both sides

`baseline-tests/*.spec.ts` run the task's own `mtek-tests/*.test.toml` fixtures against the baseline application: a small interpreter in the baseline support module performs each step (`step`, `press`, `release`, `set_input`) through the baseline's test hooks and compares each `expect_pixel` with a readback of the render target. The expectations therefore exist once. `expect_state` is a Mtek-only step (the baseline has no declared scene state) and tasks that use it are rejected by the baseline interpreter, so seed tasks use pixel expectations only. Because the baseline reference must pass these fixtures in a real browser, the expected pixel coordinates and colours are checked against an independent renderer, which is evidence about the fixtures even while the Mtek side cannot run.

## Consequences

- `spec/tooling.md` section 6 and `spec/ai-and-benchmarks.md` sections 6.1 and 6.2 each carry a one-line pointer to this record; the rest of both sections is unchanged.
- The Mtek compiler task that implements `mtek test` (M6) must implement the `set_input` step and the semantics of section 2 above.
- The M6 harness must copy `mtek-tests/` to `tests/` as described, and must run the baseline fixtures through `startTask`'s hooks.
- Everything here concerns benchmark infrastructure. No language, runtime or compiler behaviour changes.

## Verification

- `npm run check` runs `benchmarks/tools/validate-tasks.mjs`: task keys, directory structure, fixture syntax and step vocabulary, holdout identifier scan and the holdout hash.
- `npm run test:unit` runs unit tests of the validator and the hash script (including a fixed-bytes test vector, so the hash is stable across platforms).
- `npm run test:benchmarks` (with `MTEK_REQUIRE_GPU=1` on a hardware adapter) runs the fixtures against the baseline reference solutions.
- Not verified: anything on the Mtek side (references, starters, expected starter diagnostics). Task M6-07 does that.
