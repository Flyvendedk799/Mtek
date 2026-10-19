# Decision records

The blueprint is the design baseline. Any implementation decision that alters or extends it is
recorded here before code depends on it (blueprint §15).

- One decision per file, `NNNN-short-slug.md`, numbered in acceptance order.
- Records are never rewritten to hide history. To change a decision, add a record that supersedes
  it and set the old record's status to `Superseded by NNNN`.
- Every claim is labelled: **proposal** (design choice), **hypothesis** (needs evidence),
  **constraint** (external fact, with a source reference from `sources.md`).
- Template:

    # NNNN. Title
    - Status: Proposed | Accepted | Superseded by NNNN
    - Date: YYYY-MM-DD
    - Blueprint origin: <section, or "none">
    ## Context
    ## Decision
    ## Consequences
    ## Verification

| # | Title |
|---|---|
| 0001 | Why a new language is worthwhile |
| 0002 | The initial use case |
| 0003 | What "AI-native" means |
| 0004 | Release boundaries |
| 0005 | Architecture decisions |
| 0006 | Deliberate exclusions |
| 0007 | Repository, toolchain and dependency policy |
| 0008 | Syntax decisions beyond the blueprint |
| 0009 | Numeric semantics and indexing |
| 0010 | GPU layout and binding strategy |
| 0011 | Program format and CPU value representation |
| 0012 | Browser test environment and evidence policy |
| 0013 | Implementation sequencing |
| 0014 | Scene model decisions |
| 0015 | Asset strictness |
| 0016 | v0.1 restrictions beyond the blueprint |
| 0017 | Language name: Mtek |
| 0018 | `mtek.toml` validation rules the specification leaves open |
| 0019 | Manifest spans carry line and column ranges |
| 0020 | M1 runtime: interim behaviour where a later task is not ready |
| 0021 | Benchmark task format: details fixed at M0 |
| 0022 | The parser's nesting limit also bounds the height of the expression tree |
| 0023 | Parser conventions for the full grammar |
| 0024 | Standard library registry: details the specification leaves open |
| 0025 | Name resolution and milestone gating: details the specification leaves open |
| 0026 | Types and constant evaluation: details the specification leaves open |
| 0027 | Scene and schema checks: details the specification leaves open |
| 0028 | Typed IR and the public `check`/`inspect` API: details the specification leaves open |
| 0029 | Shader IR, standard stage and shader artifact: details the specification leaves open |
| 0030 | Code generation and packaging: details the specification leaves open |
| 0031 | Runtime scene rendering: details the specification leaves open |
| 0032 | The `mtek` command line tool: details the specification leaves open |
| 0033 | The development server `mtek dev`: details the specification leaves open |
| 0034 | M1 exit-gate browser tests: details the specification leaves open |
| 0035 | The complete type system: details the specification leaves open |
| 0036 | Modules: details the specification leaves open |
| 0037 | Runtime math library `rt`: details the specification leaves open |
| 0038 | Functions, statements and effects: details the specification leaves open |
| 0039 | Materials in the checker: details the specification leaves open |
| 0040 | The CPU emitter: details the specification leaves open |
| 0041 | Shader lowering: details the specification leaves open |
| 0042 | Grammar coverage and the M2 grammar freeze: details the specification leaves open |
| 0043 | CPU/GPU numeric conformance: details the specification leaves open |
| 0044 | Prelude materials, the resource plan and the inspect views: details the specification leaves open |
| 0045 | Assignable places: struct fields and array elements (owner decision) |
| 0046 | Runtime materials: arenas by layout id, `debug.setParam` and materials that fail after mount: details the specification leaves open |
| 0047 | CPU/GPU numeric agreement: WGSL's conversion clamp everywhere and CPU-order helpers (owner decision) |
| 0048 | M2 exit-gate browser tests: details the specification leaves open |
| 0049 | `state`, lifecycle functions, handlers and writes: details the specification leaves open |
| 0050 | Running generated code: input delivery, `random`, `print` and the scene object check: details the specification leaves open |
| 0051 | `bind`: checks, dependency graph and per-frame evaluation: details the specification leaves open |
| 0052 | Host inputs and scene state: codecs, queue-to-frame-boundary apply, and `app.d.ts` Inputs |
| 0053 | Lights: components, limits, frame-block packing and bindable colour and intensity: details the specification leaves open |
| 0054 | Textures and samplers: params, built-ins, `sample` and the test texture |
| 0055 | Frustum culling, renderer counters and the development overlay: planes, bounding spheres, `culledObjects`, GPU time, release/development runtime flavours, overlay keys |
| 0056 | Resilience: resize and pixel ratio, device loss recovery, allocation failure and their test hooks |
| 0057 | PBR lighting: the `Pbr` material, `lighting.pbr` as a generated helper, the stage-input reads and validation against the CPU oracle |
| 0058 | The asset compiler: declarations, the static GLB profile, packaging and `inspect --assets` |
| 0059 | Compatible instancing: shared parameter blocks, the instanced vertex entry and pipeline variant, the instance buffer, grouping, counters and `test.disableInstancing` |
| 0060 | Runtime assets: the loader and its states, integrity, image decoding and texture uploads, mesh buffers, device limits, recovery, reload and visible failures |
| 0061 | The material configurator: the example, its CPU model, the variants of the M4 gate, and the host-input codec defect found on the way |
| 0062 | Prefabs: declarations, params, static instances as entities, instantiation in the IR, the `prefabs` table and what stays gated until M5-02 and M5-03 |
| 0063 | The physics backend: the adapter types, the Rapier adapter and its engine behaviours, the lazily loaded `physics/<h16>.js` bundle and when the compiler emits it |
| 0064 | `entity_ref`, `spawn` and `destroy`: the entity table with generations, the flush points and the limit, the `prefabs` manifest table, the physics lifecycle hook, and what reload and device recovery do to spawned entities |
| 0065 | Physics schemas and ownership checks: gates lifted, pairing and root rules, one pose authority, body commands and velocities, the IR and manifest data, and when `subsystems.physics` is true |
| 0066 | Physics integration: the module named by `subsystems.physicsModule`, the fixed tick, command categories, pose write-back, deterministic collision delivery, `ctx.body(target, spanId)`, `E8101`–`E8104`, time, reload and dispose |
| 0067 | Bindings that read light fields and hot reload of light colour and intensity: the `light` dependency kind, update classes of light fields (`scene.lights[].classes`) and the migration rule |
| 0068 | Physics and lifecycle behaviour evidence on the engine: sensor counts, the measured high-speed limitation (window `t/2 + r + 20 mm`, 7.2 m/s at 1/60 s, static walls never tunnelled), removal and creation inside collision callbacks, pause without a jump, the same-frame combinations, twenty mount/dispose cycles and the resource plateau of 1 000 spawns in waves |
| 0069 | The physics playground: the example, its seed and geometry, the model the spec derives its numbers from, the ownership fixture and the examples-check test |
| 0070 | The canonical formatter `mtek fmt`: comment attachment by span, blank-line and width rules (100 columns, items one blank line apart, imports grouped), literals as written, the CLI and its exit codes, the self-check, the corpus and comment-mutation properties |
| 0071 | Validated suggested edits and the diagnostics audit: one validator that re-checks the front end on an in-memory copy, edits for `E0022`, `E1003`, `E1011`, `E2003`, `E7024`, absence as a tested result, related spans and message rules enforced by `diagnostics_audit.rs` |
| 0072 | The context export `mtek context`: `supported`/`notSupported` derived from the construct table, the registry, the hard gates, reserved words and unsupported codes; the neighbourhood, the computed-tag example library, the truncation order with a bounded `truncated` record, and the failure modes |
| 0073 | The grammar model and `mtek grammar export --format ebnf\|gbnf` (EBNF byte-equal, GBNF by token-class rule variants, identifier trie, `ExprNoDesc` duplicated, nested comments recursive), the corrected `BlockComment`, and the first constrained-decoding adapter: llama.cpp b11719 with its validator built from source and Qwen2.5-Coder-1.5B-Instruct Q4_K_M, the capability check `grammar-adapter check`, the conformance suite and its known differences |
| 0074 | `mtek test`: the fixture file (seven steps, `seed`, the forms of `expect_state`, `expect_counter`), execution in a fresh page on the manual clock, runtime errors fail a fixture, NOT-RUN and its reasons, exit codes and `--allow-not-run`, the JSON report and its schema, and the fixtures of the three examples |
| 0075 | Untrusted preview mode: the loop budget checked at the head of every CPU loop iteration (`ctx.budget`, default 10 million per frame, the host's `--loop-budget`), `E8080` at the loop with the scene stopped and the overlay, the manifest `preview` object, the runtime's network guard, the policy page and external `bootstrap.js`, the 10 s compile limit (`E9032`), the hosting guidance |
| 0076 | The language server `mtek lsp`: stdio framing that survives garbage, UTF-8 or UTF-16 positions, a debounced single-threaded state machine over unsaved buffers, diagnostics with validated quick fixes, hover, definition and completion read from the compiler, the standard library as `mtek-prelude:` virtual documents |
| 0077 | The repair harness `tools/ai-eval`: the layers derived from `mtek check`/`build`/`test`/`context` and NOT-RUN as never-success, required symbols as compiler names, the exact-match edit format details (atomic replies, `>>>END`, whole files only in cold tasks), truncated and refused generations as failures, budgets, the JSONL record schema and conditions, the model clients (replay, anthropic, openai-compatible, llama-cpp), the `GrammarCapability` boundary with M6-06 and the dependency-boundary check |
| 0078 | The scene/rendering benchmark tasks 02 to 10: what each tests, expected pixels derived from the prompt by an independent ray caster (never from a reference), observable calibration of the lit tasks and the measured tolerance (6), the ambient-exposure finding, what the shared harness cannot show, verification of both sides on hardware |
| 0079 | The interaction benchmark tasks 02 to 08: what each tests, one pixel-exact orthographic geometry, fixtures derived by an independent oracle, timing (1/16 s frames) and same-frame key rules, the language and harness gaps found (`Unlit` parameter writes, no dead `entity_ref` literal, no key-up or held-key hooks in the baseline, the input order of the baseline), and the mutation and alternate-solution checks |
| 0080 | PBR lighting aligned with glTF: dielectric-Fresnel diffuse, un-squared range window, `(1 − m)` ambient, stable GGX form, no-NaN rule (0064–0079 left free for parallel M5 work) |
| 0081 | Camera exposure (EV100): `Camera.exposure`, the scale `1 / (1.2 · 2^EV100)` applied by `lighting.pbr`, `MtekFrame.exposure`, default `-log2(1.2π)` |
| 0082 | Asset diagnostics follow-ups: the optional image `source` in the manifest and overlay, EXIF-oriented JPEGs rejected with `E7017`, the E70xx codes of 0058 made final |
| 0083 | Benchmark tasks `shader-bridge-02` to `-06`: the five tasks and what each tests, derived expected pixels, what the fixtures can and cannot observe (output clipping, object versus world x), the mutation check, measured agreement at tolerance 0 on one adapter, the texture task left out, language findings (`dt = 0`, `E9010`) and the shared test list to update |
| 0084 | The benchmark maintenance tasks `maintenance-02` to `-06`: an off-by-one in a loop, four diagnostics of four kinds at once (three with a validated edit) and their TypeScript counterparts, wrong units and direction, a rename of the page-facing input with retention, an extension with retention; the derivations, the fairness differences, the mutant check that found two undetectable differences, the ContextBuilder limit for required symbols the starter lacks, and the shared files that need a change |
| 0085 | The benchmark holdout set completed to eight tasks (3 scene-rendering, 2 interaction, 1 shader-bridge, 2 maintenance; categories and skill areas only), derived from the task statements by independent models, re-hashed, its Mtek side verified through the harness, and what was not verified |
| 0086 | Honest wording of two diagnostics (`E5001` for the params of a built-in material, `E9010` for non-constant initial values and its note) and the frame order of the benchmark baseline (host inputs before key transitions, `onKeyUp`, `isKeyDown`, `fixedUpdate`, tested without a GPU) |
| 0087 | The params of the built-in `Unlit` and `Pbr` (also the default `Unlit {}`) read, assigned and bound by name like a user material's: the registry schema instance gets the param table, the same rules (`E5001`, `E3001`, `E5070`, `E5073`) and update classes, no IR, manifest or runtime change, and hot reload keeps a param only when it is `imperative` in both programs (the rule of 0067) |
| 0088 | The benchmark tasks that use the input and tick hooks (`interaction-09` key release, `-10` held keys, `-11` the fixed tick): derivations by independent models, tick robustness against the two values of the step, mutation checks, two fixes of the baseline frame clock, and a three.js r186.1 colour-upload finding |
| 0089 | The benchmark task `scene-rendering-11` (textured surfaces): three floor squares showing a shared 4 x 4 PNG hard-edged, tiled and bilinearly smoothed, the task asset kept byte-identical in four projects, expected pixels from an independent ray model and the CPU sampler (171 pixels), the baseline support extension (an asynchronous `build`, `loadTexture`/`configureTexture`, `assets/` served beside the page), fairness (no clamped scaled panel: the libraries' `v` conventions differ), ten mutants failing on both stacks, and the README changes needed |
| 0090 | The VS Code extension: a thin client of `mtek lsp` (the extension spawns the server to know its exit status, no content provider of its own for `mtek-prelude:`, the server's file watchers, a missing executable is an error message), a TextMate grammar generated from `spec/grammar.ebnf` with drift tests against the compiler, a language configuration whose indentation rules are tested against `mtek fmt`, a `.vsix` packaged with `@vscode/vsce` in CI, and a ten-test integration suite in a real VS Code (what was not run) |
| 0091 | The getting-started walkthrough: `docs/getting-started.md` is executed by a test (its `console` blocks are run with the real `mtek`, its `diff` blocks applied, its diagnostic, overlay and files compared exactly, the suggested edit proven equal to the documented fix), what counts as install (building from a checkout; no registry), what the document claims and does not, NOT-RUN without the runtime bundle, a browser spec for hot reload and the overlay, the findings on the new user's path (a README that said nothing worked, the suggested edit not shown in the human output, no way to serve a release build), no human tester available and the checklist for one |
| 0095 | Runtime benchmark measurement: frame time is the CPU time of one frame (update plus render preparation to `queue.submit`, nearest-rank p50/p95/p99, median across three timing runs) driven from a manual loop into an offscreen target, the wait for GPU completion reported as latency and not used for the threshold, GPU time only from `timestamp-query` timestamps put on every render pass by the instrument (else unavailable), counters from one instrument that wraps the WebGPU API (draw calls, upload bytes, pipelines, object creations) cross-checked against Mtek's own counters, allocations as GPU objects per steady frame plus sampled JavaScript heap bytes per frame, startup as navigation to first frame complete over 15 fresh loads, bundle sizes, one pass per page load in a recorded random order, the hardware-only refusal (NOT-RUN, exit code 3) and the GPU lock and host-load record |
| 0096 | Runtime benchmark workloads: the seven definitions, unlit materials so the pictures can be pixel-identical, generated Mtek programs, the direct reference as the design a competent engineer would write (instancing where the scene is boxes, Rapier used directly) and the three.js baseline in its own idiom, "same visible result" measured by a pixel comparison with a tolerance, the 20 % threshold applied to p95 frame time, p95 startup latency (asset-heavy) and p95 lifecycle time (cycles), reload that is not like for like, and the failure rule |
| 0097 | Freezing the runtime benchmark definitions: what is frozen (protocol, formulas, workload directories, kits, generators, recorded asset hashes) and what is not (measurement tools), the tree hash over CRLF-normalised file hashes, `FROZEN.json` with a rationale per entry and the file hashes, `freeze.ts --check` and `--record`, the runner refusing to produce a result under an unrecorded change, and the test that fails when definitions change without a recorded rationale |
| 0098 | Runtime benchmark results: the raw-result layout under `benchmarks/results/runtime/raw/<run-id>/`, the report generated from it by `tools/report.ts` and the test that regenerates it byte for byte, how failing and errored workloads are listed, the plateau rule (slope over the last half of the cycles, 1 % growth, zero) with a 50-cycle workload and an 800-cycle supplementary run, and what the page must not retain |
| 0099 | What the first runtime benchmark showed about Mtek: six of seven workloads exceed the 20 % threshold against the direct reference (CPU cost per changed entity, per-frame passes over unchanged entities, per-frame allocation, an unminified runtime; GPU time is a few microseconds), no correctness defect, nothing in the runtime or compiler changed, the follow-up candidates, and what the mount/reload/dispose plateaus consist of (GPU and registry resources exactly zero after every dispose; a JavaScript heap that grows in steps in all three implementations, shown by a heap-snapshot comparison to be compiled code and DevTools bookkeeping, not retained JavaScript objects) |
