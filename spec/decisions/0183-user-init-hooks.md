# 0183. User init hooks

- Status: Accepted
- Date: 2026-10-24

Scenes, entities and prefabs may declare `init() { ... }` with no parameters.
This is distinct from the generated initializer that writes defaults and fields.
Scene and static-entity hooks run once, in that order, before the first input,
fixed update, update or UI callback. Shared and saved state is already restored.
This lets timers and setup code use stored settings without `state started` guards.

Spawned prefab hooks run after the prefab's defaults, fields and bindings have
been initialized at its creation flush. The hook can use its own params and state.
Device recovery retains the same world and does not repeat hooks. A new scene
gets fresh hooks. The ABI stores hooks as `init` entries in the events table;
this is internal and does not introduce a source-level `on init` event.
