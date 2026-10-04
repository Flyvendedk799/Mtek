# Sources

Consulted for existing-tool and platform constraints. They do not validate Mtek's design or targets.
Facts marked "verified 2026-10-03" were checked against these primary sources on that date.

| Ref | Source |
|---|---|
| U1 | Original user-provided `aura_language_blueprint.md`, "The Aura Language: Architectural Blueprint & Roadmap" — original intent; its token-efficiency and compilation claims are unverified. |
| S1 | Three.js TSL — https://threejs.org/docs/pages/TSL.html (three.js r186 current, verified 2026-10-03) |
| S2 | Tree-sitter Grammar DSL — https://tree-sitter.github.io/tree-sitter/creating-parsers/2-the-grammar-dsl.html |
| S3 | wgpu — https://docs.rs/wgpu/latest/wgpu/ |
| S4 | Naga — https://docs.rs/naga/latest/naga/ (30.0.1 current, verified 2026-10-03) |
| S5 | W3C WGSL — https://www.w3.org/TR/WGSL/ (layout, uniform constraints, integer semantics, conversions, accuracy; verified 2026-10-03; the accuracy section (15.7) re-verified 2026-10-04 against the Candidate Recommendation Draft of 2026-09-21, quotes in `tests/semantics/numeric/tolerances.json`, decision 0043) |
| S6 | MDN GPUBuffer.mapAsync() — https://developer.mozilla.org/en-US/docs/Web/API/GPUBuffer/mapAsync |
| S7 | MDN GPUDevice.lost — https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/lost |
| S8 | Rapier JS — https://rapier.rs/docs/user_guides/javascript/getting_started_js/ (@dimforge/rapier3d-compat 0.21.0, verified 2026-10-03) |
| S9 | llama.cpp GBNF — https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md |
| S10 | Outlines output types — https://dottxt-ai.github.io/outlines/latest/features/core/output_types/ |
| S11 | Outlines backends — https://dottxt-ai.github.io/outlines/latest/features/advanced/backends/ |
| S12 | W3C WebGPU — https://www.w3.org/TR/webgpu/ (default limits, copy alignment, canvas view formats, destroy semantics; verified 2026-10-03) |
| S13 | Khronos glTF 2.0 — https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html (verified 2026-10-03) |
| S14 | Chrome WebGPU release notes — https://developer.chrome.com/blog/new-in-webgpu-144 (`uniform_buffer_standard_layout`), https://developer.chrome.com/blog/new-in-webgpu-140 (`GPUAdapterInfo.isFallbackAdapter`) |
