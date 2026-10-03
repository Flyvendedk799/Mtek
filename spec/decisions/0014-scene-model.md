# 0014. Scene model decisions

- Status: Accepted
- Date: 2026-10-03
- Blueprint origin: §3, §4.3, §7, §8 (extensions).

## Decision

- `camera` is a contextual scene-object kind (as in the blueprint example); exactly one active camera, chosen statically; a scene without a camera is an error.
- Lights are components (`light: DirectionalLight {…}`) on **named** entities only, at most 4 per scene, so the frame block is fixed-size.
- Nested entity declarations are static parenting; bodies only on root entities.
- **Named entities are indestructible** in v0.1, so every static reference stays valid; spawned entities are reached only through generation-checked `entity_ref`s, which support only comparison, `alive`, `destroy` and body commands (no field access) — keeping all field access statically checkable.
- Prefabs are single-entity templates without access to scene state; static instances may set only params.
- Single-writer rule per field: imperative, binding or physics, decided statically.
- Frame order exactly as `spec/scenes.md` §10, with bindings evaluated after updates and before transform propagation.
