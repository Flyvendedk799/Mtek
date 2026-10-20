# Compiler and generated-binding performance audit, 2026-10-20

Baseline: PR #3 head `b8b0255cafcb03f6a0f47d8de85ae91dc0d45f17`. This audit adds to the earlier correctness audit and preserves that head's changes. It makes no best-in-class claim.

## Findings and retained changes

1. Binding graph construction compared every binding against every target, scanning its dependency list for each comparison. Topological ordering then scanned all read lists for each ready binding. An index of borrowed, variant-tagged target keys now finds matching writers; reverse adjacency visits only affected readers. The source-index `BTreeSet` ready queue, sorted/deduplicated edges, duplicate writers on invalid input, numbering, cycle reporting and recovery are preserved. Cycle reporting itself was not rewritten.
2. Resource planning linearly searched all distinct meshes for each entity or spawned prefab. Each box/plane comparison allocated two temporary vectors. A descriptor-key index now maps to the first insertion index beside the original ordered vector. Keys use float bits, including signed zero and NaN payloads, and the complete asset file/mesh/primitive identity. Map traversal never determines resource order. Material planning and generated runtime semantics were not changed.

The exploratory baseline localized the costs before implementation: at 8,192 items, independent-binding analysis was around 226 ms and unique-box planning around 2.21 s. These initial samples are retained separately from the alternating measurements. Historical M7/K04 results are not used as a current baseline; K04's upload coalescing and change tracking already exist in this source tree.

## Protocol and reproducibility

### Retained synthetic results

Nine samples per cell; medians in milliseconds. [Every size, observed range and raw sample](performance-2026-10-20/synthetic-results.md) is retained, including slower results.

| 8,192-item case | Isolated operation, before → after | Full build, before → after |
| --- | ---: | ---: |
| Independent bindings | analysis 226.894 → 55.944 | 360.952 → 189.144 |
| Chain | analysis 330.102 → 52.763 | 463.877 → 197.386 |
| Fan-out | analysis 319.425 → 50.556 | 460.694 → 196.940 |
| Diamond DAG | analysis 391.867 → 71.857 | 560.204 → 245.956 |
| Width-16 dense DAG | analysis 1,687.719 → 328.814 | 2,314.500 → 980.882 |
| Identical meshes | planning 3.519 → 3.016 | 205.498 → 207.764 |
| Cyclic mesh reuse | planning 7.926 → 3.067 | 216.277 → 208.907 |
| Unique meshes | planning 2,237.756 → 4.522 | 2,489.685 → 217.590 |

These are scaling improvements, not a universal speedup: 128 independent bindings take 0.941 → 0.996 ms for analysis and 3.248 → 3.446 ms for a full build. Small index setup costs and timing variation can outweigh the savings. Full builds with one shared mesh show no meaningful benefit. The approximately 495× ratio for unique-mesh **planning** must not be presented as a compiler-wide or application-runtime speedup; its full-build ratio is 11.44× on this synthetic stress case.

### Existing projects

[The same alternating protocol on five examples and three frozen runtime workloads](performance-2026-10-20/project-results.md) shows little change. Full-build medians (ms) are: pulse-cube 1.047 → 1.085; modular-scene 2.149 → 2.206; material-configurator 4.495 → 4.491; physics-playground 3.076 → 2.973; product-configurator 3.480 → 3.390; changing-transforms 67.355 → 67.870; changing-material-params 41.041 → 41.483; repeated-meshes 70.246 → 67.362. All observed ranges overlap. There is no demonstrated broad speedup for these current projects. The changes remove scaling costs exposed by large graphs and many distinct resources, rather than accelerating every existing small scene. In particular, the frozen moving-box workload shares a small prefab binding definition during checking and one mesh descriptor, so it does not stress either large-graph construction or unique-mesh planning.

Pass `projects` as the final argument to `performance-audit.mjs` to reproduce this suite. Source loading into `MemFs` remains outside the timer. Both revisions use identical runtime/physics stubs, so these compiler measurements do not include browser startup or runtime-bundle production.

The `performance_audit` release example generates deterministic valid programs before timing. An initial untimed analysis and IR lowering validate each input and prepare the planner input; the timed operation then gets one additional untimed warm-up. `analyze` calls `analyze_without_edits` on a prebuilt `MemFs`; `plan` calls `plan_program` on prebuilt IR; `build` calls the complete public build API, including analysis, lowering, planning, shader validation, emission and packaging, with fixed test runtime/physics bundles. Timers exclude result destruction, source generation and filesystem writes. This is compiler latency, not Rust build time or CLI process startup. `project:<directory>` loads an existing project into `MemFs` before timing.

Synthetic shapes are independent bindings, a chain, a fan-out from the first entity, an overlapping two-predecessor diamond DAG, and a bounded dense DAG reading the previous 16 entities. The last is explicitly not an all-to-all graph. Mesh cases use identical boxes, cyclic reuse of 16 sizes, and all-unique sizes. Counts are 128, 512, 2,048 and 8,192. No compiler limits were increased.

Build the same example source against each revision, retaining the two executables:

```text
cargo build -p mtek-compiler --example performance_audit --release --locked
node scripts/performance-audit.mjs samples.csv <before-executable> <after-executable>
node scripts/report-performance-audit.mjs samples.csv summary.json
node scripts/compare-performance-artifacts.mjs <before-executable> <after-executable> <scratch-directory>
```

Copy this audit's example source into the baseline checkout too (the baseline predates the harness). Build each executable independently using the pinned Rust 1.99.0 MSVC release profile. The runner alternates before/after, after/before, before/after in three rounds. Each process does one untimed warm-up and retains three timed samples: nine observations per revision/case. No builds, tests or other audit workloads run concurrently with the retained comparison. Raw samples, environment, summaries and artifact comparisons are in [`performance-2026-10-20/`](performance-2026-10-20/). Median and observed min/max are reported; nine samples on one workstation do not establish a population tail-latency distribution or significance. Background system load and thermal effects remain possible. This machine is a 20-logical-processor Intel i5-13600K, Windows build 26200; the JS tools use Node 24.18.1/npm 11.16.0.

## Generated bindings and runtime scope

The CPU probe uses freshly compiled, unchanged frozen `changing-transforms` (1,000 entities / 2,000 bindings) and `changing-material-params` (500 bindings) workloads. It executes the actual generated functions, retains their returned aggregates, consumes all components in a checksum, and checks repeatability. The final protocol warms 12,000 frames, then records nine 1,200-frame batches. A separate instrumented run records V8 CPU samples through `node:inspector` after warm-up; instrumented timings are not substituted for uninstrumented timings. The script sanitizes source paths while retaining raw samples/call graph. Earlier 1,200-frame-warm-up results are separately labelled exploratory: late JIT tiering visibly reduced their final batch times.

```text
mtek build benchmarks/runtime/changing-transforms/mtek --out <transforms-dist>
mtek build benchmarks/runtime/changing-material-params/mtek --out <materials-dist>
node scripts/profile-generated-bindings.mjs <dist>
node scripts/profile-generated-bindings.mjs <dist> <profile.json>
```

This isolates generated binding evaluation and helper math. It excludes setters, hierarchy propagation, GPU encoding/uploads, presentation, physics and browser scheduling. It cannot establish renderer frame-rate or GPU performance. No hardware/browser benchmark result is claimed by this audit. The frozen hardware benchmark definitions and existing historical reports remain unchanged.

With the longer warm-up, the unchanged transform evaluator's median batch time divided by frames is **0.293 ms/frame** (observed 0.258–0.328), and the material evaluator's is **0.067 ms/frame** (0.067–0.099). These are averages over batches, not per-frame latency percentiles. The transform CPU profile has 1,797 samples: 826 in generated binding functions, 586 in `qaxisAngle`, 203 in `sin`, 32 in garbage collection; the material profile has 497 samples, including 257 in `sin` and 206 in generated binding functions. Inlining and sampling resolution limit attribution. [Summary and checksums](performance-2026-10-20/runtime-summary.json); losslessly compressed `.cpuprofile.gz` files retain the sanitized raw V8 call graph and samples (gunzip before loading in DevTools). No runtime code was changed, and no runtime speedup is claimed.

## Rejected attempts and limitations

- The initial 32-predecessor dense source at 8,192 bindings was 4,673,028 bytes and correctly failed the existing 4,194,304-byte source-file limit (`E0004`). That attempt produced no timing result. The final width-16 definition was then frozen for both revisions; the earlier width-32 samples at smaller sizes remain labelled exploratory.
- The first exploratory dense measurements overlapped dependency installation and showed substantial variation. They are not used for before/after claims.
- An interrupted clone was preserved. Work resumed in a separate verified checkout of the exact PR head. npm initially failed sandbox DNS; the approved installation of locked dependencies succeeded. Neither condition was addressed by changing repository checks.
- The first full check failed Clippy's `items_after_test_module` rule for the new binding test module. The module was moved to the end of the file and the check rerun; the lint was not disabled. The failed attempt's exit status is retained in `checks-attempt-1.json`.
- The initial sandboxed Rust run failed seven existing CLI output-directory tests with Windows `Access Denied`. The initial sandboxed JavaScript run encountered missing temporary Vite modules and denied execution of the built CLI; fresh sandbox commands also failed to create their process security environment. Both unchanged full suites passed in the approved native execution context. Failed attempts remain recorded in `checks-attempt-2.json` and `checks-attempt-3.json`; assertions, timeouts and skips were not changed to accommodate the environment.
- An isolated prototype skipped normalization for exact unit ±Y quaternion axes, preserving signed-zero components and the existing transcendental/multiply rounding. It passed 352 component comparisons, including non-finite angles. An initial three-round alternating generated-transform probe suggested a small improvement, but had visible late JIT tiering. A separate generic-axis probe was slightly slower (200,000 calls: median 9.177 → 9.282 ms). This narrow optimization is **not retained**: the evidence is insufficient to justify the runtime branch and its tradeoff. Prototype source and raw observations are preserved; they are not a shipped speedup.
- Changes to generated quaternion math, aggregate storage, material batching, cycle diagnostics and other speculative indexes were not included. Remaining runtime costs require separate measured work.

## Correctness and verification

The binding regression compares indexed edges to an independent all-pairs `BindDep::reads` oracle across every dependency kind, owner/name combinations, duplicate writers and duplicate reads. The mesh regression compares keys to independent bitwise equality across all descriptor variants, signed zero, distinct NaN payloads and full asset identities, then verifies first-use IDs under repeated/reversed reuse. Existing artifact goldens, prefab coverage and diagnostic fixtures remain intact.

The separately built compilers produced byte-identical complete packaged output in **32 cases / 264 files / 136,362,851 compared bytes**: all eight synthetic shapes at 128/512/8,192 items, all five examples, and three frozen runtime projects. This includes manifests, generated JS, source maps, declarations, shaders and any packaged assets present in each case. [Synthetic comparison](performance-2026-10-20/artifact-comparison.json), [existing-project comparison](performance-2026-10-20/project-artifact-comparison.json). These builds use the same fixed stubs. The comparison includes the full output, not only resource counts or normalized text.

Final local Windows verification:

- `npm run build` and `npm run check` pass: format, workspace/all-target Clippy with warnings denied, TypeScript, all workspace lint, naming, task and asset checks.
- `cargo test --workspace --locked`: **1,642 passed, 0 failed, 1 existing ignored**, in the approved native context.
- `npm run test:unit --workspaces --if-present -- --maxWorkers=2`: **4,680 passed, 0 failed, 2 existing skipped tests** in this Windows run, in the approved native context. [The eleven-workspace subtotal breakdown](performance-2026-10-20/test-counts.json) is retained. The known missing release `runtime.js.map` loader warning remains non-failing.
- Coverage (304 features, 157 positive fixtures, 201 diagnostic codes), release documentation, M7 baseline, frozen runtime definitions and `git diff --check` pass. [Gate records](performance-2026-10-20/checks.json) include the final results and execution contexts.
- No assertions were relaxed, timeouts increased, or new skips/ignores introduced. Exact-head CI results are recorded on the draft PR separately; hardware GPU/browser performance remains unmeasured by this audit.
