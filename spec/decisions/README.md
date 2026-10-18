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
