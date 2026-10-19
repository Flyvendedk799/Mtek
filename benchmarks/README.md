# Benchmarks

This directory holds the benchmark infrastructure of Mtek: the task format of the AI/token benchmark
(`spec/ai-and-benchmarks.md` section 6), its 34 tasks and 8 holdout tasks, the tools that keep the task set honest,
and the three.js baselines. Task M0-10 created everything except `baselines/m0-bridge` (task M0-09).
The runtime benchmark (`benchmarks/runtime/`, spec section 7, M7-04; decisions 0095 to 0099) is its own workspace package with its own README; its published results are in `benchmarks/results/runtime/`. The AI/token benchmark's results are in `benchmarks/results/ai/` (its README says what is where; decisions 0108 and 0109).

**Nothing here is a model result.** The Mtek files of a task (starter, reference, expected diagnostics)
were written by hand from the specification. Task M6-07 (`tools/ai-eval`, decision 0077) compiled and
ran them: the Mtek side of the four tasks in `tasks/` is **verified** (`mtek_side_status = "verified"`,
evidence in `evidence/M6/ai-eval/`). The holdout task was not opened for this and keeps
`mtek_side_status = "unverified-until-M6"`; while a task is unverified the validator requires an
`// UNVERIFIED` comment on its Mtek reference sources.

## Status

| Part | Status |
|---|---|
| Task format, validator, holdout hash | done; `npm run check:tasks` (part of `npm run check`) and `npm run test:unit` verify it |
| The 34 tasks in `tasks/` (11 scene-rendering, 11 interaction, 6 shader-bridge, 6 maintenance) | all written with Mtek and three.js starters, fixtures and reference solutions; decisions 0078, 0079, 0083, 0084, 0088, 0089 (the first four tasks are from M0-10, decision 0021) |
| The 8 holdout tasks in `holdout/` (3 scene-rendering, 2 interaction, 1 shader-bridge, 2 maintenance) | written and re-hashed (`holdout.sha256`); decision 0085 (no task content there). The author of 7 of them had the full specification and compiler, so the holdout is not blind to its author |
| Mtek references (34 + 8) | **verified** on 2026-10-18 on a hardware adapter (AMD Radeon RX 7900 XTX): every layer passes (parse, check, build, start, fixtures) and every required symbol is declared; evidence in `evidence/M6/ai-eval/` and `evidence/M6/benchmark-*/` (holdout: ids and counts only) |
| Mtek starters | **verified to fail as intended** on the same adapter (cold stubs fail `check` with `MTEK-E9006`; edit starters fail at least one fixture and pass their retention fixtures; `maintenance-01`, `maintenance-03` and `holdout-08` fail `check` with exactly their `starter_diagnostics`) |
| three.js baseline references and starters | references **verified** (all fixtures pass on a hardware adapter); starters verified to fail as intended, the passes being retention fixtures. The type checks are `benchmarks/baselines/support/test/starters.test.ts` (it enumerates the task directories) |
| Mutation checks | wrong-but-plausible solutions were run against the fixtures of most new tasks; the few that pass are differences no pixel or required symbol can show, listed in the evidence and the decisions |
| `mtek test` and the `set_input` step | implemented (M6-09, decision 0074) |
| The harness | `tools/ai-eval` (M6-07, decision 0077; the benchmark run, the spend guard and the report of M7-05 phase 1, decision 0108): a pilot of 22 attempts against Claude Haiku 4.5 is stored in `results/ai/` (decision 0109); it is not the M7-05 result and concludes nothing on H4 |
| Known benchmark gaps | the extra tasks of decisions 0088 and 0089 (`interaction-09` to `-11`, `scene-rendering-11`) close the key-release, held-key, fixed-tick and texture gaps, so the set is **34 tasks**, four more than the blueprint's 30 (§12.2: 10/8/6/6); no `fixed_update` physics, lit-texture, mip-map or GLB-texture task; the three.js side has a manual-render-loop colour-upload quirk found by `interaction-09` (decision 0088); no model runs and no token counts (the runtime benchmark exists since M7-04, see `runtime/README.md`) |

## Layout

```
benchmarks/
  README.md
  package.json            workspace package @mtek/benchmarks
  tasks/<id>/             task id = <category>-NN, equal to the directory name
  holdout/<id>/           holdout tasks, same layout; never used while designing syntax, docs or context
  holdout.sha256          tree hash of benchmarks/holdout/ (below)
  baselines/
    m0-bridge/            M0-09: the bridge scenario in three.js WebGPU + TSL (own package)
    support/              the baseline support module (src/) and the Playwright side (test/); `test/run-candidate.ts` validates a model's baseline candidate
    docs/reference.md     the documentation the AI benchmark gives the model on the three.js side (decision 0108 item 3)
  tools/
    validate-tasks.mjs    the task validator
    hash-holdout.mjs      the holdout tree hash
    toml-subset.mjs       the strict TOML subset parser both use
  evidence/               environment record and results of the baseline runs (below)
```

A task directory (`spec/ai-and-benchmarks.md` section 6.1, details in decision 0021):

```
task.toml             id, category, mode, title, prompt, required_symbols, mtek_side_status, [budgets]
mtek/                 Mtek starter project: mtek.toml, src/main.mtek (a stub for cold tasks)
mtek-tests/           *.test.toml fixtures (spec/tooling.md section 6); they define success for both sides
baseline/             TypeScript + three/webgpu starter: src/main.ts, tsconfig.json
baseline-tests/       one Playwright spec that runs the fixtures against the baseline
reference/mtek/       a solution of the task in Mtek (verified by M6-07 for the tasks in tasks/)
reference/baseline/   a solution of the task in three.js (verified)
```

`task.toml` keys, the fixture steps and the holdout hash are fixed by
[decision 0021](../spec/decisions/0021-benchmark-task-format.md). The validator rejects any other key.

### The seed tasks

| Task | Category | Mode | What the model must do | How the baseline starter fails |
|---|---|---|---|---|
| `scene-rendering-01` | scene-rendering | cold | a camera, a green box at the origin, a blue sphere to its right, dark grey clear colour | it renders an empty black scene |
| `interaction-01` | interaction | edit | Space reverses the rotation of a cube (a red marker child makes the direction visible in pixels) | the cube never reverses; the fixture fails at the first pixel check after Space. The second fixture (rotation continues at 0.7 rad/s without input) passes: it guards against breaking the starter's behaviour |
| `shader-bridge-01` | shader-bridge | edit | a colour parameter on the material, bound to state set by the host input `tint` | the host input does not exist (`unknown-input`); the fixture "stays #808080 without input" passes (retention check) |
| `maintenance-01` | maintenance | edit | repair a wrong vector dimension and an unknown field | the right cube is not drawn (a `Vector2` copied into a position gives `z = undefined`) and `tsc` reports exactly two errors (checked by `baselines/support/test/starters.test.ts`) |
| a holdout task | scene-rendering | cold | an orthographic camera, three boxes, a child sphere | it renders an empty black scene |

The Mtek side of `maintenance-01` is predicted to fail with `MTEK-E3102` (a `vec2` where `position`
needs a `vec3`) and `MTEK-E5001` (unknown field `colour` on `Unlit`), listed in `starter_diagnostics`.
That list is a prediction from `spec/diagnostics.md`, not compiler output.

## Integrity rules

1. **All attempts are reported.** Every model attempt, including failures, is published in
   `benchmarks/results/<run-id>/` (`spec/ai-and-benchmarks.md` section 6.4). No attempt is dropped and
   no task is removed after a failing result. "Tokens per completed task" is undefined, not zero, when
   nothing completes. The "about 80 % fewer tokens" figure is an unverified hypothesis and stays out of
   release material.
2. **The holdout is never used for design.** `validate-tasks.mjs` fails if any file under `spec/`,
   `tools/`, `packages/`, `crates/`, `scripts/`, `docs/` or `benchmarks/tools/` contains the id of a
   holdout task, and fails if the tree of `benchmarks/holdout/` no longer hashes to `holdout.sha256`.
   Anyone designing syntax, documentation or the context export must not read `benchmarks/holdout/`.
3. **Definitions are frozen before release comparisons.** Once a release comparison is made, a task,
   fixture or baseline changes only with a recorded rationale (spec section 7), and a failing task is
   never removed retroactively. The holdout hash makes a silent edit of the holdout detectable;
   the other tasks are protected by review and by the fixed commit of every comparison.
4. **Mtek results are claimed only after a real run.** Until M6-07, every statement about the Mtek
   side is a statement about what was written, not about what happens.

### Integrity log

Every known exposure of the holdout is recorded here, so that whoever runs the M6/M7 evaluations can
judge whether to replace an exposed task first.

| Date | What happened | Assessment |
|---|---|---|
| 2026-10-03 | While implementing the parser (M1-05), a worker agent printed one file of the holdout task's reference solution (a plain scene) while exploring the repository. | No effect on the parser, the corpus or any spec text. The parser tests do not read `benchmarks/holdout/`, and the agent reported the exposure itself. The holdout task counts as **exposed to one development agent**: consider replacing it before the first model evaluation (M6). Since then, the work-item guide tells every agent not to read `benchmarks/holdout/`. |

### The holdout tree hash

`node benchmarks/tools/hash-holdout.mjs` prints it (`--check` compares, `--write` records). Every file
below `benchmarks/holdout/` is listed as `<sha256 of its bytes>  <path relative to holdout/, "/" separators>`
(two spaces), sorted by the UTF-8 bytes of the path; the hash is the SHA-256 of those lines
(`\n`-terminated). It is therefore identical on Windows and POSIX. Bytes are hashed as stored:
`.gitattributes` forces LF checkouts for `benchmarks/holdout/`, and the script **fails** on a carriage
return in a text file instead of normalising it. If the holdout must change on purpose, run
`--write` in the same commit and say why in the commit message.

## Running things

| Command | What it does |
|---|---|
| `npm run check:tasks` | runs the validator (task.toml keys, the six parts of each task, fixture syntax, `UNVERIFIED` headers, required symbols, holdout ids, holdout hash) |
| `npm run test:unit` | unit tests of the validator, the hash, the TOML parser, the fixture parser, the projection and the starters' types |
| `npm run test:benchmarks` | the `benchmarks` Playwright project: each task's fixtures against its baseline **reference**, on the hardware configuration; use `MTEK_REQUIRE_GPU=1` for evidence (a missing adapter is then a failure, not a pass) |
| `node tools/ai-eval/src/cli.ts validate --task benchmarks/tasks/<id> [--project benchmarks/tasks/<id>/reference/mtek]` | the Mtek side: every layer of the outcome taxonomy for the starter or a project, with the task's own fixtures (`tools/ai-eval/README.md`; the start and test layers need a hardware adapter, otherwise they are reported NOT-RUN and the verdict is `not-run`, never `pass`) |
| `MTEK_BASELINE_SOURCE=starter npm run test:benchmarks` | the same against the baseline **starters** (most fixtures must fail) |
| `MTEK_BASELINE_DIR=<dir> npm run test:benchmarks` | against any project directory with `src/main.ts`, for example a model's candidate |

`npm run test:browser` also runs the `benchmarks` project (add `--project=hardware` to avoid it).

### How the baseline tests work

A baseline is a TypeScript module that calls `startTask` from `@mtek/benchmarks/baseline-support`
(`baselines/support/src`). `startTask` plays the part of Mtek's runtime in test mode: a 128 x 128
`RGBA8` sRGB render target with a depth buffer, a manual clock, key transitions and host inputs applied
at the start of the next frame, then `update(dt)`, then a render, and pixel readback through
`window.mtekTask` (`hooks.ts`). The helpers next to it (`srgb`, `unlit`, `boxMesh`, `sphereMesh`,
`lookAtCamera`, `orthographicCamera`) correspond to Mtek's standard library, as the fairness rule of
spec section 6.3 asks; their size is part of the baseline's documentation cost.

`baseline-tests/fixtures.spec.ts` of each task is one line, `defineFixtureSuite(import.meta.dirname)`.
It builds the baseline with esbuild (no type checking, so a starter with type errors still runs), serves
it from a static server, and runs every `mtek-tests/*.test.toml` fixture: `step`, `press`, `release`
and `set_input` drive the application and every `expect_pixel` compares a pixel of the readback with a
colour. `expect_state` is Mtek-only and rejected, so the seed fixtures use pixels only. A test also fails
on any console error or warning. The pixel coordinates in the fixtures come from a CPU projection
(`baselines/support/test/projection.ts`, f64, independent of three.js); the fixtures state the
numbers they come from in comments.

## Baseline results

Source: the files in [`evidence/`](evidence/), produced by `MTEK_REQUIRE_GPU=1 npm run test:benchmarks`
on a clean working tree at commit `a7655626eaf5500164c1720ad9d0fc7c0c000183`. The environment record is
[`evidence/environment-benchmarks.json`](evidence/environment-benchmarks.json) (it validates against
`tests/browser/environment.schema.json`); the machine and configuration are those of
[decision 0012](../spec/decisions/0012-browser-test-environment.md).

| Item | Value |
|---|---|
| OS | Windows 11 Pro 10.0.26200, x64 |
| Adapter | AMD Radeon RX 7900 XTX (`vendor` amd, `architecture` rdna-3), `isFallbackAdapter` false |
| Browser | Chromium 153.0.8010.12, new headless (`channel: "chromium"`), flags `--enable-unsafe-webgpu --ignore-gpu-blocklist --enable-webgpu-developer-features` |
| Node / Playwright | v24.18.1 / 1.63.0; three 0.186.1 |

**Reference solutions** ([`evidence/baseline-reference-results.json`](evidence/baseline-reference-results.json)):
7 passed, 0 failed, 0 not-run, hardware adapter (one test per fixture: `scene-rendering-01` 1,
`interaction-01` 2, `shader-bridge-01` 2, `maintenance-01` 1, the holdout task 1).

**Starters** ([`evidence/baseline-starter-results.json`](evidence/baseline-starter-results.json)):
5 failed, 2 passed. The first failing pixel check of each failing test is recorded in the file. The two
passing fixtures are the retention checks ("rotation continues without input", "stays #808080 without
input"): they pass on the starter on purpose, because they detect an edit that breaks existing behaviour.

The Playwright JSON reports themselves are not committed (they contain absolute paths); the files in
`evidence/` were extracted from them with the paths removed.

## Known limits

- The fixtures are validated only against three.js. Colours are flat (unlit) and the sampled points lie inside
  shapes, away from silhouettes, or at the centre of a sphere, so the different tessellation of the two
  sides does not matter; whether Mtek's renderer produces the same pixels is
  unknown until M6-07.
- `startTask` approximates Mtek's frame order (input, update, render); it has no fixed-step ticks or
  physics, which none of the seed tasks needs.
- The Mtek `set_input` step is a decision of this task (0021), not yet part of any implementation.
- `hash-holdout.test.ts` skips its symbolic-link test where the platform refuses to create symbolic links
  (this Windows machine does): that case is then untested here.
- The validator checks that `required_symbols` occur as identifiers in the Mtek sources; it cannot check
  that they are declared correctly. That needs the compiler.
