# 0004. Release boundaries

- Status: Accepted
- Date: 2026-10-03
- Blueprint origin: §2.1.

## Decision

The blueprint's release table is adopted verbatim (v0.1: typed values, pure and CPU functions, modules, state, entities, single-entity prefabs; cameras, transforms, primitive meshes, opaque unlit/PBR, textures, custom fragment logic, frustum culling, compatible instancing; static GLB subset; optional rigid-body adapter; typed params, generated layouts, CPU→GPU snapshots; CLI, formatter, structured diagnostics, inspection, hot reload, basic LSP; context export, repair loop, one validated constrained-decoding adapter; JavaScript runtime on browser WebGPU — v0.2 and later columns as in the blueprint). Two rules: (1) **no silent approximation** — anything outside v0.1 produces a diagnostic, and each area has a negative fixture for its nearest unsupported neighbour; (2) **the table is the claim** — a feature is "supported" only with a passing feature-level fixture, and later-column features never appear as available in docs, context export or examples. Qualifiers are defined in the specs before implementation: "compatible instancing" (`spec/runtime-abi.md` §8.4 and the M4 instancing task), "static GLB subset" (`spec/assets.md` §3).
