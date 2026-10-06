# 0046 — Host inputs and scene state (task M3-06)

- Status: accepted
- Date: 2026-10-06
- Blueprint origin: §5.4 (narrow host interface); `spec/runtime-abi.md` §6.2–§6.4; `spec/tooling.md` §3; `spec/diagnostics.md` (E9020, E9021, E8040, E8041, E8100)
- Related: decision 0018 (project file validation), 0021 (benchmark `set_input`)

## Context

Host inputs must expose only declared scene state, validate JS values with generated codecs, queue changes to the frame boundary, and keep TypeScript `Inputs` in `app.d.ts` aligned with those codecs.

## Decision

1. **`state` declarations** are implemented ahead of the M3 gate (same pattern as M2 constructs): the construct table marks them `M1` so this build types and packages scene (and entity) state. Host inputs may still target **only scene state**.
2. **`[host.inputs]`** is no longer reported as `E9010`. After type-checking, targets of the form `Scene.state` are checked against the entry scene: unknown targets are `E9021`; non-scene-state or unsupported types are `E9020`.
3. **Codecs** follow `spec/runtime-abi.md` §6.3. `color-hex-opaque` is chosen when a bare name bound into a material param matches the state and the state type is `color` (AST walk at check time). Packaging rebuilds entries from config + IR state types.
4. **Runtime** `setInput` never throws: codecs return `MTEK-E8040` / `E8041` / `E8100`; valid values are queued and applied in phase 1. `mountMtek` `inputs` uses the same path. Scene state lives on `World.state`.
5. **`app.d.ts`** emits `Inputs` fields from the resolved host inputs (`tint: \`#${string}\``, `speed: number`, …).

## Consequences

- Bind evaluation and lifecycle still await later M3 tasks; opaque codec selection for successful packages that use `bind` follows when bind is ungated.
- Fixture `gate_state` becomes a pass; fixtures that only expected `E9010` for state were retired or updated.
