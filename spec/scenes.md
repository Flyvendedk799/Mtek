# Mtek Language Reference — Scenes, Entities and Behaviour (v0.1)

- Repository path: `spec/scenes.md`
- Status: Normative for v0.1.
- Depends on: `spec/language.md` (core), `spec/stdlib.md` (schemas, events, keys), `spec/runtime-abi.md` (how the runtime executes this), `spec/physics.md` (bodies and colliders).

---

## 1. Model in one paragraph

A **scene** declares what exists (state, a camera, entities) and how it changes (lifecycle functions and event handlers). An **entity** is a named node with a transform and optional components (mesh, material, light, body, collider) drawn from typed registry schemas. A **prefab** is a reusable single-entity template. **State** is explicitly declared, typed, initialised data owned by a scene or an entity. A field's value comes from exactly one writer: its initialiser plus imperative handler writes, a live `bind(...)`, or the physics subsystem. The compiler checks all of this statically; the runtime executes it in one documented frame order (§10).

v0.1 mounts **one scene** per application. Scene switching is not in v0.1 (`E5901`).

## 2. Scene declaration

```mtek
scene Demo {
    clear_color: #101418;          // scene field (schema `Scene`)
    state speed: f32 = 0.7;        // scene state
    camera Main { … }              // scene object
    entity Cube { … }              // entity
    update(dt: f32) { … }          // lifecycle function
    on key_down(Key.Space) { … }   // event handler
}
```

Members may appear in any order except that **initialisation order follows declaration order** (§11). Allowed members: scene fields, `const`, `state`, `camera` objects, `entity` declarations, lifecycle functions, `on` handlers. Anything else is `E1040`.

**Scene fields** come from the registry schema `Scene` (`spec/stdlib.md` §3): `clear_color: color` (default `#000000`), `ambient_color: color` (default `#ffffff`), `ambient_intensity: f32` (default `0.0`), `gravity: vec3` (default `vec3(0.0, -9.81, 0.0)`, used only when physics is present). Scene fields are construction-only in v0.1 and their values must be **constant expressions** (`E3090`); they are transported as data in the manifest (`spec/runtime-abi.md` §5.2). The renderer uses only the RGB channels of `clear_color` and `ambient_color`.

## 3. Cameras

`camera Name { … }` declares a camera scene object. `camera` is contextual (`spec/language.md` §2.4); any other word in that position is `E5014` ("unknown scene object kind"). Fields (schema `Camera`):

| Field | Type | Default | Writable | Bindable |
|---|---|---|---|---|
| `position` | `vec3` | `vec3(0.0, 0.0, 5.0)` | yes | yes |
| `target` | `vec3` | none (optional) | yes | yes |
| `rotation` | `quat` | `quat.identity()` | yes | yes |
| `projection` | `Perspective { fov_y: f32 = 0.9; near: f32 = 0.1; far: f32 = 1000.0 }` or `Orthographic { height: f32 = 10.0; near: f32 = 0.1; far: f32 = 1000.0 }` | `Perspective {}` | fields writable | fields bindable |
| `active` | `bool` | see below | no | no |

- If `target` is declared, orientation is a look-at from `position` to `target` with up `+Y`; `rotation` must then not be declared (`E5010`). With `f = normalize(target − position)`, if `|dot(f, +Y)| > 1 − 1e-6` the up vector `−Z` is used instead (documented, tested). The exact view-matrix construction is normative in `spec/runtime-abi.md` §8.3. `position == target` at run time is `E8011` (write ignored).
- Without `target`, the camera looks along its local `-Z` rotated by `rotation`.
- Projection formulas (right-handed, view looks down `-Z`, clip depth `[0, 1]`) are normative and defined in `spec/runtime-abi.md` §8.3. `fov_y` is the full vertical field of view in radians. `near > 0`, `far > near`, `fov_y` in `(0, π)`, `height > 0`; constant violations are `E5011`, run-time violations from writes are `E8011` (write ignored).
- **Exactly one active camera.** A scene with no camera is `E5012` (an unexplained black canvas is not acceptable). With several cameras, exactly one must declare `active: true` (`E5013`). Camera switching at run time is not in v0.1.

## 4. Entities

```mtek
entity Cube {
    position: vec3(0.0, 0.5, 0.0);
    mesh: Box { size: vec3(1.0, 1.0, 1.0) };
    material: Unlit { color: #6b5cff };
    state hits: i32 = 0;
    entity Badge { position: vec3(0.0, 0.6, 0.0); mesh: Sphere { radius: 0.1 }; material: Unlit { color: #ffffff }; }
    update(dt: f32) { … }
    on collision_enter(other: entity_ref) { … }
}
```

4.1 **Fields** come from the registry schema `Entity` (`spec/stdlib.md` §3):

| Field | Type | Default | Notes |
|---|---|---|---|
| `position` | `vec3` | `vec3(0.0)` | local to the parent, metres |
| `rotation` | `quat` | `quat.identity()` | local |
| `scale` | `vec3` | `vec3(1.0)` | local; every component finite and `> 0` (§12) |
| `visible` | `bool` | `true` | hides the mesh draw only; behaviour still runs |
| `mesh` | mesh descriptor (`Box`, `Sphere`, `Plane`, asset mesh) | none | construction-only |
| `material` | material instance (`Unlit {…}`, `Pbr {…}`, user material `{…}`) | `Unlit {}` if `mesh` is set | instance identity construction-only; params writable/bindable (`spec/materials.md` §4) |
| `light` | `DirectionalLight {…}` / `PointLight {…}` | none | `spec/materials.md` §7 |
| `body` | `Static {}` / `Dynamic {…}` / `Kinematic {}` | none | `spec/physics.md` |
| `collider` | `BoxCollider {…}` / `SphereCollider {…}` | none | `spec/physics.md` |

A `material` without a `mesh` is `E5020`. Unknown, duplicate and mistyped fields are `E5001`/`E5002`/`E3102`. All values inside `mesh`, `body` and `collider` descriptors must be **constant expressions** (`E3090`) — they are construction-only data transported in the manifest.

4.2 **Names.** Entity names are `PascalCase` by convention and **unique within the scene**, including nested entities (`E2002`). A named entity is referenced by its bare name anywhere in the scene (`Cube.position`). Entity names share the scene scope with state and cameras.

4.3 **Nesting is parenting.** An `entity` declared inside another entity is its child; the child's transform is relative to the parent (§12). Parenting is a transform relationship, not inheritance: children do not inherit fields, state or handlers. Cyclic parenting is impossible syntactically. Re-parenting at run time is not in v0.1.

4.4 **Entity state.** `state name: T = expr;` inside an entity (or prefab) is per-instance state, accessed as `self.name` from the entity's own functions and as `EntityName.name` from elsewhere in the scene. Entity state may not use the name of an `Entity` schema field (`state position: …` would make `self.position` ambiguous) — `E2002`, with a note naming the field.

4.5 **Lifetime.** Statically declared (named) entities live exactly as long as the scene. They cannot be destroyed in v0.1 (`destroy(Cube)` is `E5030`; at run time, destroying a named entity through an `entity_ref` is `E8030`, a no-op). Hide them with `visible: false`. This makes every static entity reference permanently valid.

## 5. Prefabs

```mtek
prefab Crate {
    param origin: vec3 = vec3(0.0, 2.0, 0.0);
    param tint: color = #6b5cff;
    position: origin;
    mesh: Box { size: vec3(1.0, 1.0, 1.0) };
    material: Unlit { color: tint };
    body: Dynamic { mass: 1.0 };
    collider: BoxCollider { size: vec3(1.0, 1.0, 1.0) };
    state bounces: i32 = 0;
    on collision_enter(other: entity_ref) { self.bounces += 1; }
}
```

- A prefab is a module item describing **one entity** (no nested entities in v0.1: `E5040`). It has the same members as an entity body plus `param` declarations.
- `param name: T [= default];` — immutable construction input. A param without default is required at every instantiation (`E5041`). Params are readable in the prefab's field initialisers, state initialisers, `bind` expressions and functions.
- **Static instance:** `entity First: Crate { origin: vec3(0.0, 3.0, 0.0); }` — the body may set **only params** (`E5042` for anything else, with a note listing the prefab's params). Static instances are named entities (§4.5).
- **Dynamic instance:** `spawn(Crate { origin: p })` (§9).
- A prefab has no access to scene state (it is not inside a scene); its handlers use `self`, its params, its state, constants and functions. Referencing a scene name from a prefab is `E2003`.

## 6. Lifecycle functions

| Name | Signature | Where | When |
|---|---|---|---|
| `update` | `update(dt: f32) { … }` | scene, entity, prefab | once per rendered frame, after fixed ticks (§10) |
| `fixed_update` | `fixed_update(dt: f32) { … }` | scene, entity, prefab | once per fixed simulation tick; `dt` is the fixed step |

The parameter name is free; its type must be `f32`, and there must be exactly one parameter (`E5050`). At most one of each per body (`E5051`). Any other `name(…) { … }` member is `E5052` ("`start` is not a lifecycle function; v0.1 lifecycle functions are `update` and `fixed_update`"). Lifecycle functions have effect level `cpu`, return unit, and may read and write as described in §8.

## 7. Events, input and frame values

7.1 **Handlers.** `on event_name(args) { … }`. The event name is resolved against the registry (`spec/stdlib.md` §5); unknown names are `E5060`. Each event declares either a **filter** argument (a constant expression the event must match) or **parameters** (`name: Type`). Arity and types are checked (`E5061`).

| Event | Form | Allowed in | Delivered |
|---|---|---|---|
| `key_down` | `on key_down(Key.Space)` (filter) | scene, entity, prefab | phase 1, when the key transitions to pressed. Auto-repeat is ignored. |
| `key_up` | `on key_up(Key.Space)` (filter) | scene, entity, prefab | phase 1, on release |
| `pointer_down`, `pointer_up` | `on pointer_down(event: PointerEvent)` | scene, entity, prefab | phase 1 |
| `pointer_move` | `on pointer_move(event: PointerEvent)` | scene, entity, prefab | phase 1, at most once per frame with the latest position (coalesced) |
| `collision_enter`, `collision_exit` | `on collision_enter(other: entity_ref)` | entity, prefab with a `collider` (`E5062` otherwise) | after each physics step (§10) |

`PointerEvent { position: vec2; button: i32 }` — `position` in normalised device coordinates of the canvas (`x` right, `y` up, both in `[-1, 1]`); `button` 0 = primary, 1 = middle, 2 = secondary (`pointer_move` reports the primary button state as 0). Several handlers for the same event in one body run in declaration order.

7.2 **Keys** are the registry enum `Key`, mapped from the DOM `KeyboardEvent.code` (physical key, layout-independent): `Key.A`–`Key.Z`, `Key.Digit0`–`Key.Digit9`, `Key.Space`, `Key.Enter`, `Key.Escape`, `Key.Tab`, `Key.Backspace`, `Key.ShiftLeft`, `Key.ShiftRight`, `Key.ControlLeft`, `Key.ControlRight`, `Key.AltLeft`, `Key.AltRight`, `Key.ArrowUp`, `Key.ArrowDown`, `Key.ArrowLeft`, `Key.ArrowRight`. The complete mapping table is in `spec/stdlib.md` §5.

7.3 **Polling.** `is_key_down(Key.W) -> bool` (CPU intrinsic) returns the key state as of the end of phase 1 of the current frame.

7.4 **Focus loss.** When the canvas's document loses focus or becomes hidden, the runtime records `key_up` transitions for every held key and a release for held pointer buttons; they are delivered at the start of the next frame. Input is therefore re-synchronised, never stuck.

7.5 **Frame values** (namespace `frame`, readable in CPU contexts and in `bind` expressions; not readable from GPU stage code — route them through material params):

| Name | Type | Meaning |
|---|---|---|
| `frame.time` | `f32` | Active application time in seconds since mount, excluding paused time. Advances by the clamped frame delta. |
| `frame.delta` | `f32` | The clamped variable delta of the current rendered frame (same value passed to `update`). |
| `frame.index` | `u32` | Rendered frame counter since mount, wrapping. |

**Precision of `frame.time`.** It is accumulated in `f64` by the runtime and converted to `f32` when read. The `f32` spacing (one ULP) is about 0.24 ms at 1 hour, 0.98 ms at 3 hours, 3.9 ms at 12 hours and 7.8 ms at 24 hours of active time. Material effects that need smooth periodic motion over long sessions should bind a wrapped value (e.g. `bind(fract(frame.time / 10.0) * 10.0)` computed on the CPU in `f32`) — the reference documents this example.

## 8. Reading, writing and single ownership

8.1 **What handlers may access.** Inside lifecycle functions and handlers (effect level `cpu`):
- read and write scene state (bare name) — scene bodies and entities inside the scene;
- read and write own entity state (`self.x`) and named entities' state (`Name.x`) — within the scene;
- read entity fields (`self.position`, `Cube.rotation`, `Cube.material.tint`), and write them subject to §8.2;
- call `cpu fn`s, pure functions and CPU intrinsics (`spawn`, `destroy`, `alive`, `random`, `print`, `is_key_down`, body commands from `spec/physics.md`);
- read `frame.*`.

8.2 **Single writer.** Every writable field of every entity, camera, light and material instance has exactly one writer, decided statically:

| Writer | Established by | Consequence |
|---|---|---|
| **Imperative** | default | handlers may assign it (if the schema marks it `writable`) |
| **Binding** | the field's value is `bind(expr)` | any assignment to it anywhere is `E5070`, with a related span at the `bind` — "update its source instead" |
| **Physics** | the entity has any `body`: `Dynamic` (solver owns `position`, `rotation`), `Kinematic` (pose set only through `set_kinematic_target`/`teleport`), `Static` (pose fixed at creation) | assignment to `position`/`rotation` is `E5071` with a note naming the allowed operation (`apply_impulse`, `set_kinematic_target`, `teleport`, or "static bodies cannot move"); a `bind` on those fields is `E5072` |

Fields the schema marks construction-only (e.g. `mesh`, `body`, `scale` of bodies) cannot be assigned at all (`E5073`).

8.3 **`entity_ref` access is limited in v0.1.** Through an `entity_ref` you may only: compare (`==`, `!=`), test `alive(r)`, `destroy(r)`, and issue body commands (`r.body.apply_impulse(v)`, …, `spec/physics.md` §3). Field reads and writes through an `entity_ref` are `E5074` in v0.1. A named entity used where an `entity_ref` is expected converts implicitly (`other == Floor`). These limits keep all field access statically checkable.

8.4 **`bind` rules** (blueprint §3.2).
- `bind(expr)` may appear only as the whole value of a field the schema marks **bindable** (`spec/stdlib.md` §3), or of a value param in a material instance descriptor; anywhere else it is `E5004`. It is not a value: it cannot be stored, passed or returned.
- The expression must be **pure**: it may read constants, scene state, `frame.*`, named entities' fields and state, material/prefab params, and — inside a prefab or entity — `self` fields, `self` state and the prefab's params; it may call pure functions and pure intrinsics. Calling a `cpu fn` or a CPU intrinsic (`random`, `is_key_down`, …) is `E5005`.
- Its type must equal the field's type exactly (after literal resolution), `E3102` otherwise.
- **Dependencies** are the set of state slots, entity fields/state, params and `frame` values the expression reads; they are recorded in the IR and the manifest and shown by `mtek inspect --bindings`.
- **Cycles.** If binding A reads a field whose value is itself bound by binding B, A depends on B. A cycle is `E5075`, reported at one binding with every binding of the cycle as related spans, in order.
- Bound fields are evaluated in phase 5 (§10) in topological order; reading a bound field from a handler returns the value computed in the previous evaluation (bindings are also evaluated once during initialisation, §11).

## 9. Dynamic lifecycle: spawn and destroy

- `spawn(Prefab { params… }) -> entity_ref` — CPU intrinsic, allowed only in lifecycle functions and handlers (`E5080` in initialisers). It **queues** creation; the new entity is created at the next lifecycle flush point (§10), as a root entity of the scene. The returned reference is valid immediately: `alive(r)` is `false` until the flush and `true` after it.
- `destroy(r: entity_ref)` — queues removal. From the moment of the call the entity is **pending removal**: `alive(r)` returns `false`, its handlers are not invoked for the rest of the frame, body commands against it are dropped with warning `W8031`, and no further collision events involving it are delivered. It is removed (with its children, its body, its resources released) at the next flush point. Destroying an already-dead or pending entity is a no-op with `W8032`.
- `alive(r) -> bool`.
- **References are generation-checked.** An `entity_ref` is `(slot, generation)`. Slots are reused; generations are not, so a reference to a destroyed entity can never reach a later entity in the same slot.
- A newly created entity never joins an iteration already in progress: it first runs in the next phase that starts after its flush.
- The maximum number of live entities is a runtime limit (`mtek.toml` `[runtime] max_entities`, default 16 384). Exceeding it makes `spawn` return a dead reference and report `E8033`.

## 10. Frame order (normative summary)

The runtime's scheduler (`spec/runtime-abi.md` §7 is the implementation contract) runs, per rendered frame:

1. **Input.** Apply queued host-input changes in arrival order; apply input transitions; dispatch input handlers in event-arrival order. For each event: scene handlers first, then entity handlers in **stable instance order** (§10.1).
2. **Fixed ticks** (0 to `max_catch_up_steps` of them, default 4, step `1/60` s). For each tick: (a) flush the lifecycle queue; (b) apply pending physics commands once; (c) run `fixed_update` (scene, then entities in instance order); (d) step physics; (e) write authoritative poses back; (f) deliver collision events in a deterministic order (`spec/physics.md` §6). Commands issued in (f) apply in the next tick. Backlog beyond the catch-up limit is discarded and reported in the runtime counter `discardedSteps`.
3. **Update.** Run `update(dt)` — scene first, then entities in instance order — with `dt` = the clamped frame delta (§10.2).
4. **Lifecycle flush.**
5. **Bindings.** Evaluate every live binding against the now-consistent state, in dependency (topological) order; ties broken by declaration order.
6. **Transforms.** Propagate local transforms to world matrices, parents before children. v0.1 renders the latest authoritative physics pose; render interpolation is not in v0.1.
7. **Render.** Prepare frame/view data, cull, build the draw list, upload changed data, encode and submit.

10.1 **Stable instance order.** Static entities in declaration order (depth-first pre-order over nesting), followed by spawned entities in spawn order. Never JavaScript object-key enumeration order.

10.2 **Time policy.** Frame delta is clamped to `max_frame_delta` (default 0.1 s). `pause()` stops clocks and the fixed-step accumulator; `resume()` continues without simulating the paused interval. Hidden documents are paused automatically and resumed when visible, unless the host opts out. All three constants are configurable in `mtek.toml` `[runtime]` and recorded in the manifest.

10.3 **Same-frame combinations** that must have conformance tests: spawn then destroy in the same handler; destroy then a collision involving the entity in the same tick; key down and up within one frame (both delivered, in order); input during pause (transitions that occur while paused are discarded; the held-key state is re-synchronised on resume exactly as on focus loss, §7.4).

## 11. Initialisation order

1. Module constants (compile time).
2. Scene fields, then scene `state` in declaration order. A state initialiser may read constants, earlier scene state, and call pure and `cpu` functions (e.g. `random()`); it may not spawn (`E5080`) or read entity fields (`E5081`).
3. Cameras and entities in declaration order (depth-first pre-order). For each entity: params (for prefab instances), then entity `state` in declaration order, then fields in declaration order. Field and state initialisers may read constants, scene state, own params and own earlier state; they may not read entity fields, including `self.x` fields (`E5081`).
4. All bindings are evaluated once (so bound fields have values before the first frame), then transforms are propagated.
5. Physics bodies are created (if any).
6. Resources required at startup are loaded; `mountMtek` resolves (`spec/runtime-abi.md` §6).

## 12. Coordinates, units and transforms

- Right-handed world, `+Y` up, camera forward along local `-Z`. Units: metres, seconds, radians, kilograms (blueprint §4.2).
- Local transform: `L = T(position) · R(rotation) · S(scale)`. World transform: `W = W_parent · L` (roots: `W = L`).
- `scale` components must be finite and `> 0`. Constant violations are `E5090`; a run-time write of an invalid scale is `E8090` and is ignored (the previous value stays). This keeps normal matrices valid: the runtime computes the normal matrix as the inverse-transpose of the upper 3×3 of `W` and uploads it with the object data (`spec/gpu-layout.md` §7).
- Bodies are allowed only on root entities (`E5091`): physics poses are world poses. A body entity may have visual children.
- Colliders and meshes use **full extents** (`Box.size`, `BoxCollider.size`); adapters convert to backend conventions.

## 13. Ownership and lifetime (summary of blueprint §4.3)

The mounted application owns the scene; the scene owns entity instances; entities hold references to shared immutable resources (meshes, textures) and own their mutable state and their material instances' parameter storage. Value types copy on assignment. Handles never copy the resource. `dispose()` releases every GPU resource, physics object and event listener synchronously (`spec/runtime-abi.md` §9).

## 14. Not in v0.1

Multiple or switchable scenes; run-time re-parenting; prefabs with children; reading/writing fields through `entity_ref`; user-defined components, queries and systems (v0.2); render interpolation; camera switching; text and UI; audio.
