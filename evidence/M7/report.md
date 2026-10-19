# M7 gate report: the release decision for v0.1, and the measured baseline

- Task: M7-GATE (decision 0126), 2026-10-19. Written after M7-01 to M7-07 and the follow-up section K (M7.1: K-01 to K-06).
- Clean-clone suite run at commit `76bec07515ecc4d706148b8763630063514bdc22`; the machine-readable form of this report is [`baseline.json`](baseline.json), generated from the stored results by `scripts/gen-m7-baseline.mjs` (which also fills the tables below; `--check` fails if either drifts).
- **No tag, release or publication has been made.** That is the owner's decision (section 7).

## 1. Decision

**The exit criteria of M7 are met, and what v0.1 does not do is written down. The hypotheses the project set out to test are not.**

| | Result |
|---|---|
| A clean install builds all reference applications without undocumented manual edits | Yes (section 2) |
| Every advertised feature has a positive fixture and appropriate negative tests; manifest, ABI, compiler and documentation agree | Yes, checked automatically |
| Unsupported or unfinished behaviour is excluded explicitly or blocks the release | Excluded explicitly: [`docs/limitations.md`](../../docs/limitations.md), section 5 |
| H4: agents spend fewer tokens on Mtek than on three.js at matched success | **Not supported.** Mtek is WORSE than the baseline by the rule of decision 0108, before and after M7.1; the 30 % target is not met (section 3) |
| The runtime stays within 20 % of hand-written WebGPU (investigation threshold) | **Not met** in any of the seven workloads, before or after M7.1 (section 3) |

**Recommendation.** If v0.1 is released, release it as a pre-alpha toolchain that works and is tested, and say nothing about token efficiency or speed: the earlier claim of about 80 % fewer tokens is contradicted by measurement and must not appear in release copy, and no performance claim is supported. Releasing is not blocked by the M7 exit criteria; whether the unproven hypotheses justify releasing now is the owner's call. This report does not take that decision.

## 2. Exit criteria and the evidence

| Criterion (blueprint M7) | Evidence |
|---|---|
| Three reference applications | [`examples/material-configurator`](../../examples/material-configurator), [`examples/physics-playground`](../../examples/physics-playground), [`examples/modular-scene`](../../examples/modular-scene) (M7-01, [decision 0092](../../spec/decisions/0092-modular-scene-example.md)); `pulse-cube` is a fourth, named positive program. Each demonstration exercises features no other does ([coverage matrix](../../docs/coverage-matrix.md), decision 0093) |
| Reproducible builds | [`reproducible-builds.md`](reproducible-builds.md) and [`gate/reproducible-builds-final.json`](gate/reproducible-builds-final.json): two clean clones of one commit in different directories give 331 byte-identical output files; one machine and one operating system, so cross-machine reproducibility is **not** claimed; `mtek.exe` itself differs in 24 bytes (linker timestamp and PDB signature) |
| A tested environment matrix | [`docs/supported-environments.md`](../../docs/supported-environments.md), [`environment-matrix.md`](environment-matrix.md): Chromium, Chrome and Edge on the Windows machine pass; Firefox has 6 failures; WebKit and headless Firefox were not run; Linux is only what GitHub Actions reported |
| Device-loss handling | M4-09: recovery with at most three attempts per loss, allocation failure, resize and zero size ([M4 report](../M4/report.md), [decision 0056](../../spec/decisions/0056-resilience.md), `resilience-device.spec.ts`, `host/recovery.test.ts`); in the clean-clone browser run |
| Resource-lifetime tests | M5: spawn/destroy waves return live resources to a bounded plateau and twenty mount/dispose cycles return bodies, colliders and buffers to zero ([M5 report](../M5/report.md)); M7-04: after every dispose the GPU and registry resources are exactly zero in 50 and 800 cycles, the JavaScript heap grows in steps in all three implementations ([decision 0098](../../spec/decisions/0098-runtime-benchmark-results-and-report.md), [0099](../../spec/decisions/0099-runtime-benchmark-findings.md)); the heap growth is attributed to compiled code and DevTools bookkeeping, which is a hypothesis |
| Release documentation | [`docs/`](../../docs/README.md): index, concepts, tutorial, language guide, reference, limitations (M7-06, K-03); every code block is compiled by a test; release notes in [`docs/release-notes-v0.1.md`](../../docs/release-notes-v0.1.md) |
| Benchmark results including failures | Runtime and AI, below; every attempt and every failing workload is published |
| Every advertised feature has positive and negative fixtures | [Coverage matrix](../../docs/coverage-matrix.md): 303 features, 154 positive programs, 201 diagnostic codes, none without a negative test (a few are reserved or marked, with the reason, in [`tests/semantics/code-coverage-exceptions.json`](../../tests/semantics/code-coverage-exceptions.json)) |
| Manifest, runtime ABI, compiler and documentation agree | `npm run check:release` (168 features, 201 diagnostic codes, ABI 1, language 0.1); it fails when any pair disagrees, shown by 18 corruptions of the stored sources ([decision 0101](../../spec/decisions/0101-capability-consistency-check.md)) |

Tests of the final clean-clone run (all stages exit 0; generated from [`gate/suite-summary.txt`](gate/suite-summary.txt)):

<!-- baseline:tests:begin -->
| Stage | Result |
| --- | --- |
| cargo test --workspace --locked (without grammar backend) | 1613 passed, 0 failed, 1 ignored |
| cargo test --workspace --locked (backend required) | 1613 passed, 0 failed, 1 ignored |
| grammar conformance (pinned llama.cpp backend) | 38410 inputs pass |
| npm run test:unit | 4590 passed, 2 skipped, 11 workspaces |
| browser, all projects (MTEK_REQUIRE_GPU=1) | 591 passed, 0 failed, 0 not run, 15 skipped by design |
| VS Code integration | 10 of 10 passed |
| coverage matrix | 303 features, 154 positive programs, 201 diagnostic codes, 0 without a negative test |
<!-- baseline:tests:end -->

## 3. The numbers

All of it is one Windows 11 machine with an AMD Radeon RX 7900 XTX (`isFallbackAdapter` false), Chromium 153, Node 24.18, rustc 1.99.0; see `runtime.environment` in `baseline.json`. Nothing here is a speed or token guarantee.

### 3.1 Runtime benchmark (decisions 0095 to 0099, 0119 to 0123)

Seven workloads, each as an Mtek program, a hand-written direct-WebGPU reference and a three.js baseline; definitions frozen by tree hash before any reported number (`benchmarks/runtime/FROZEN.json`). Metric: p95 frame time on the CPU (update, render preparation, submit), 1200 frames after 120 warm-up frames, median of three timing runs; startup and cycle rows use the metric named. The first run is [`report.md`](../../benchmarks/results/runtime/report.md); the quiet run (median CPU load before a pass 10 %, run `20261019T180811Z`) is [`report-after-quiet.md`](../../benchmarks/results/runtime/report-after-quiet.md). A run in between, [`report-after-k04.md`](../../benchmarks/results/runtime/report-after-k04.md), was disturbed by other work on the machine (70 repeated passes) and is kept, not used.

<!-- baseline:runtime:begin -->
| Workload | Metric | First run Mtek | Quiet run Mtek | Quiet run direct WebGPU | Quiet run three.js | Quiet run Mtek over direct | Threshold (20 %) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| constant-scene | p95 frame time | 0.115 ms | 0.085 ms | 0.04 ms | 0.53 ms | +112.5 % | exceeds |
| changing-transforms | p95 frame time | 1.36 ms | 0.855 ms | 0.155 ms | 2.735 ms | +451.6 % | exceeds |
| changing-material-params | p95 frame time | 0.67 ms | 0.61 ms | 0.11 ms | 1.475 ms | +454.5 % | exceeds |
| repeated-meshes | p95 frame time | 0.245 ms | 0.085 ms | 0.05 ms | 0.16 ms | +70.0 % | exceeds |
| asset-heavy-startup | p95 startup latency | 223.915 ms | 225.66 ms | 174.94 ms | 239.765 ms | +29.0 % | exceeds |
| physics-bodies | p95 frame time | 1.83 ms | 1.85 ms | 1.495 ms | 2.365 ms | +23.7 % | exceeds |
| mount-reload-dispose | p95 of mount + reload + dispose time per cycle | 23.445 ms | 23.56 ms | 8.475 ms | 9.86 ms | +178.0 % | exceeds |
<!-- baseline:runtime:end -->

What moved with K-04 (writes per frame for 1,000 changing transforms went from 1,001 to 1): the four frame-time workloads got faster; physics, mount/reload/dispose and startup did not. The direct reference itself varied between the runs (startup 204 ms to 175 ms), so differences below that are noise. All seven workloads still exceed the 20 % threshold; the remaining cost and what was not tried are in [decision 0123](../../spec/decisions/0123-what-k04-did-not-do.md).

### 3.2 AI/token benchmark (decisions 0108, 0109, 0124, 0125)

`claude-haiku-4-5-20251001`, temperature 1, prompt caching on, 34 tasks with 5 trials each per condition, unconstrained generation (the constrained condition was not run), the same repair loop, budgets and token accounting on both sides. Tokens are input plus output of every call of every attempt. The three.js baseline was measured once, before M7.1, and not re-run.

<!-- baseline:aiMain:begin -->
| Condition | Attempts | Completed | Completion | Tokens per completed task | Cost (USD) |
| --- | --- | --- | --- | --- | --- |
| three.js baseline (M7-05, not re-run) | 170 | 156 | 91.8 % | 9,388 | 2.05 |
| context only, before M7.1 | 170 | 103 | 60.6 % | 40,535 | 4.11 |
| context only, after M7.1 | 170 | 116 | 68.2 % | 33,648 | 3.52 |
| context + guide, before M7.1 | 170 | 134 | 78.8 % | 32,842 | 3.95 |
| context + guide, after M7.1 | 170 | 145 | 85.3 % | 29,872 | 3.90 |
<!-- baseline:aiMain:end -->

By the rule of decision 0108 both Mtek conditions are WORSE than the baseline before and after M7.1. After M7.1: context only has a token ratio of 3.58 to the baseline and completes 23.5 points fewer; with the guide the ratio is 3.18 and completion is 6.5 points lower, which the rule calls matched. The 30 % token target is not met. Cold authoring improved most (context only 17/55 to 32/55 completed; with the guide 30/55 to 39/55); edit tasks did not move for context only (86/115 to 84/115). Detail, by category and mode: [`report-m7-1.md`](../../benchmarks/results/ai/report-m7-1.md), [`compare-m7-1.md`](../../benchmarks/results/ai/compare-m7-1.md), [`ai-benchmark-m7-1.md`](ai-benchmark-m7-1.md), the first run [`report.md`](../../benchmarks/results/ai/report.md).

Holdout (8 tasks, 5 trials, **exploratory**: one model, one run, 40 attempts per condition; its tasks were not used for any design, and the repository check forbids holdout ids in `tools/`, `spec/` and `docs/`, but they may be easier than the main set). Numbers only, from [`holdout-summary.jsonl`](../../benchmarks/results/ai/holdout-summary.jsonl) and [`holdout-summary-m7-1.jsonl`](../../benchmarks/results/ai/holdout-summary-m7-1.jsonl):

<!-- baseline:aiHoldout:begin -->
| Condition | Set | Attempts | Completed | Completion | Tokens per completed task | Verdict against the earlier baseline |
| --- | --- | --- | --- | --- | --- | --- |
| Mtek, context only | earlier | 40 | 25 | 62.5 % | 38,845 | worse |
| three.js baseline | earlier | 40 | 39 | 97.5 % | 7,737 | reference |
| Mtek, context only | new | 40 | 34 | 85.0 % | 17,629 | worse |
| Mtek, context + guide | new | 40 | 39 | 97.5 % | 16,112 | worse |
<!-- baseline:aiHoldout:end -->

On the holdout, Mtek with the guide completes as many attempts as the baseline (39 of 40) and needs about twice the tokens per completed task; the context-only condition moved from 62.5 % to 85.0 %.

## 4. Using this as the baseline

**Pinned.** The commit of the suite run is above. The AI records are in `benchmarks/results/ai/` (main set; SHA-256 of each file in [`ai-baseline.json`](ai-baseline.json)); the holdout records are kept outside the repository because a record holds prompts and candidates (SHA-256 on [`ai-benchmark-m7-1.md`](ai-benchmark-m7-1.md)). The runtime benchmark's tree hash and the holdout's tree hash (`benchmarks/holdout.sha256`) are in `baseline.json`.

**Re-measure.** The commands are in `baseline.json` under `rerun`: the clean-clone suite (`scripts/verify-reproducible-build.mjs --suite`), the runtime benchmark (`prepare`, `run --publish`, `report --after`), and the AI benchmark (`benchmark-run`, `report-cli`, `compare-cli`). Run the runtime benchmark on an idle machine and keep other CPU work off it while it runs; the AI benchmark needs an API key and a spend cap (the ledger lives outside the repository).

**Must stay constant for a comparison to mean anything:** the tasks and holdout, the runtime workload definitions, the model, settings, budgets and trial counts, the price table, the three.js baseline and its documentation, and the machine (`mustStayConstant` in `baseline.json`). Changing any of them starts a new baseline; say so in a decision record.

**Reading differences.** The noise floor of these numbers is **not measured**: no unchanged setup was repeated. As a guide only, a completion rate over 170 attempts has a standard error of roughly 3.5 points and over 40 attempts about 7; the direct runtime reference moved by up to 25 % between two runs of the same code. The M7.1 comparison is on the same tasks and trial numbers, but the failures were diagnosed on the main set, so its gain there is optimistic.

**Targets to beat.** Three.js baseline: 91.8 % completion and 9,388 tokens per completed task on the main set; 97.5 % and 7,737 on the holdout. The research target of decision 0001 and spec 6.4: at matched success at least 30 % fewer tokens per completed task (a ratio of at most 0.70). Runtime: p95 within 20 % of the direct-WebGPU reference in every workload.

## 5. Findings and open items

Documented, not fixed (none blocks the exit criteria):

1. **CI.** The Ubuntu `browser-software` job fails on most runs: `specs/m4/dev-overlay.spec.ts:239` and `specs/m6/getting-started.spec.ts:128`; both pass locally on the software project, in the clean-clone run too. Cause not found. The five other jobs pass.
2. **Environments.** Firefox 155 (headed, with WebGPU preferences) fails 6 of 251 specs, including a zero-sized canvas that makes the runtime report `MTEK-E8050` on Firefox only; WebKit and headless Firefox expose no adapter; there is no macOS machine and no Linux machine with a GPU.
3. **Spec versus compiler** ([decisions 0102, 0103, 0116](../../spec/decisions/README.md)): `W0030` (the naming lint) is not part of v0.1 and the spec says so; the `E9010` gate is narrower than the spec text; seven further divergences found while writing the documentation (for example `scenes.md` §11 against `E9010`; an `entity_ref` state needs an initial value, so "none" is modelled with a flag).
4. **Agent contract.** The compiler context for a cold-start project was empty of schemas, key names and conventions; K-01 fixed that (22.6 kB of a 24 kB budget, so examples for cold projects, `glb_asset` signatures and body-command docs were left out, decision 0112). Diagnostics that did not say what to write instead were improved without changing what is accepted (K-02). Still without a hint: `i++` and a comma between descriptor fields.
5. **Runtime.** Skipping bindings by dependency, render bundles, bind-group caching, and the allocations that remain in compiler-generated code and the physics adapter were not done (decision 0123).
6. **Reproducible builds** cover one machine; the grammar backend conformance ran on Windows only (the Linux backend was verified by checksum).
7. **Not run:** constrained decoding trials, any model other than Haiku 4.5, a human new-user test of the walkthrough, Linux or macOS with a GPU.

## 6. How this was produced, and what went wrong on the way

- **Money.** The spend ledger (a file outside the repository, not committed) ends at 23.96 USD. 3.96 USD of that is the worst-case charge the spend guard made for 120 API calls that failed with a connection error; real spend is therefore about 20 USD at list prices, not reconciled with an invoice. Decision 0124 stops charging connection errors.
- **The outage.** Between 17:18:27 and 17:20:04 UTC on 2026-10-19 the machine's connection to the API failed; 57 main-set attempts (all trial 4) and the first 63 holdout attempts were lost and counted by the harness as model failures. After the harness fix (decision 0124) and the owner's approval they were re-run with the same settings (decision 0125); the original records stay published and marked as superseded. The retry is a second draw for those cells, not a recovery of the lost draws.
- **Corrections to my own statements during the work:** the old guide was 13.4 kB, not 26 kB (the 26 kB was guide plus context); the outage lasted about 97 seconds, not an hour.
- **Two defects caught by the clean-clone runs, not by the working tree:** the grammar conformance test scanned the stored model candidates (fixed by skipping `results` directories), and generated documentation pages were left out of one merge commit (fixed in `ac9aebf`). The conformance classification of two new fixtures was confirmed against the real validator.
- **Benchmark integrity.** The K-01 to K-03 workers were told not to read the holdout, the reference solutions or the task prompts, and their content is derived from the spec, the registry and the compiler; the failures that motivated the work were diagnosed by the orchestrator on the main set, which is why main-set gains are optimistic and the holdout is the cleaner read.
- **The API key** was supplied in conversation, kept in a session file outside the repository, passed to the harness by file and never recorded; the repository holds no key. It should be rotated.

## 7. Questions for the owner

1. Tag or publish v0.1, and with what wording (section 1 recommends none about tokens or speed)? Nothing has been tagged or published.
2. Which gap to close first: the agent contract (tokens per completed task is still 3.2 to 3.6 times the baseline), or the runtime (all seven workloads above the threshold)? The benchmarks to re-run are built; a repeat costs about 5 USD of API and 40 minutes of an idle machine.
3. Whether to investigate the Ubuntu CI job before a release.
4. M7-08 (Tree-sitter grammar) stays post-v0.1 in the backlog.
