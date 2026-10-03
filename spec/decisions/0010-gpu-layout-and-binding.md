# 0010. GPU layout and binding strategy

- Status: Accepted
- Date: 2026-10-03
- Blueprint origin: §6.1–§6.3.

## Decision

- All v0.1 blocks are in the WGSL `uniform` address space and use the **conservative uniform layout rules**. The `uniform_buffer_standard_layout` language extension (Chrome 144+ [S14]) is not used: it needs feature detection and **Naga does not implement it**, so our validator could not check such layouts.
- Members are laid out in **declaration order** (no reordering) — predictable, inspectable, stable across edits. Packing optimisations wait for counter evidence.
- One Mtek type maps to one WGSL type in every context; `bool` inside structs/arrays/blocks is stored as `u32`; scalar/`vec2`/small-struct array elements are wrapped in 16-byte-stride wrapper structs.
- Fixed bind-group plan: group 0 frame/view (runtime), group 1 material params + resources, group 2 object (dynamic offset).
- Material params are **never folded into shaders**: value edits never rebuild shaders or pipelines.
- Uniform arenas with slot stride from the **queried** `minUniformBufferOffsetAlignment`; conservative per-slot uploads; growth by re-creation with deferred `destroy()` (safe for submitted work [S12]).

## Verification

Golden layouts, Naga oracle (`ValidationFlags::all()` includes struct-layout checks), independent JS encoder, bit-exact GPU probe (`spec/gpu-layout.md` §9).
