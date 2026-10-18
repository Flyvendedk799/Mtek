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
| 0071 | Validated suggested edits and the diagnostics audit: one validator that re-checks the front end on an in-memory copy, edits for `E0022`, `E1003`, `E1011`, `E2003`, `E7024`, absence as a tested result, related spans and message rules enforced by `diagnostics_audit.rs` |
| 0072 | The context export `mtek context`: `supported`/`notSupported` derived from the construct table, the registry, the hard gates, reserved words and unsupported codes; the neighbourhood, the computed-tag example library, the truncation order with a bounded `truncated` record, and the failure modes |
| 0074 | `mtek test`: the fixture file (seven steps, `seed`, the forms of `expect_state`, `expect_counter`), execution in a fresh page on the manual clock, runtime errors fail a fixture, NOT-RUN and its reasons, exit codes and `--allow-not-run`, the JSON report and its schema, and the fixtures of the three examples |
| 0080 | PBR lighting aligned with glTF: dielectric-Fresnel diffuse, un-squared range window, `(1 − m)` ambient, stable GGX form, no-NaN rule (0064–0079 left free for parallel M5 work) |
| 0081 | Camera exposure (EV100): `Camera.exposure`, the scale `1 / (1.2 · 2^EV100)` applied by `lighting.pbr`, `MtekFrame.exposure`, default `-log2(1.2π)` |
| 0082 | Asset diagnostics follow-ups: the optional image `source` in the manifest and overlay, EXIF-oriented JPEGs rejected with `E7017`, the E70xx codes of 0058 made final |
| 0075 | Untrusted preview mode: the loop budget checked at the head of every CPU loop iteration (`ctx.budget`, default 10 million per frame, the host's `--loop-budget`), `E8080` at the loop with the scene stopped and the overlay, the manifest `preview` object, the runtime's network guard, the policy page and external `bootstrap.js`, the 10 s compile limit (`E9032`), the hosting guidance |
| 0077 | The repair harness `tools/ai-eval`: the layers derived from `mtek check`/`build`/`test`/`context` and NOT-RUN as never-success, required symbols as compiler names, the exact-match edit format details (atomic replies, `>>>END`, whole files only in cold tasks), truncated and refused generations as failures, budgets, the JSONL record schema and conditions, the model clients (replay, anthropic, openai-compatible, llama-cpp), the `GrammarCapability` boundary with M6-06 and the dependency-boundary check |
