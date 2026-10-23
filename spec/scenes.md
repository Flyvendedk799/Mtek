# Mtek Language Reference — Scenes, Entities and Behaviour (v0.1)

- Repository path: `spec/scenes.md`
- Status: Normative for v0.1.
- Depends on: `spec/language.md` (core), `spec/stdlib.md` (schemas, events, keys), `spec/runtime-abi.md` (how the runtime executes this), `spec/physics.md` (bodies and colliders).

---

## 1. Model in one paragraph

A **scene** declares what exists (state, a camera, entities) and how it changes (lifecycle functions and event handlers). An **entity** is a named node with a transform and optional components (mesh, material, light, body, collider) drawn from typed registry schemas. A **prefab** is a reusable single-entity template. **State** is explicitly declared, typed, initialised data owned by a scene or an entity. A field's value comes from exactly one writer: its initialiser plus imperative handler writes, a live `bind(...)`, or the physics subsystem. The compiler checks all of this statically; the runtime executes it in one documented frame order (§10).

An application mounts **one scene at a time**. A program may declare several scenes; `mtek.toml` `project.scene` names the one that starts (`E9006` without it), and `go_to(Scene)` switches to another, carrying its `shared state` over (§15, decision 0141). `reset()` restarts the scene that runs (decision 0140).

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
| `exposure` | `f32` (EV100) | `-log2(1.2 · π)` ≈ `-1.9145305` | no (constant) | no |

- If `target` is declared, orientation is a look-at from `position` to `target` with up `+Y`; `rotation` must then not be declared (`E5010`). With `f = normalize(target − position)`, if `|dot(f, +Y)| > 1 − 1e-6` the up vector `−Z` is used instead (documented, tested). The exact view-matrix construction is normative in `spec/runtime-abi.md` §8.3. `position == target` at run time is `E8011` (write ignored).
- Without `target`, the camera looks along its local `-Z` rotated by `rotation`.
- Projection formulas (right-handed, view looks down `-Z`, clip depth `[0, 1]`) are normative and defined in `spec/runtime-abi.md` §8.3. `fov_y` is the full vertical field of view in radians. `near > 0`, `far > near`, `fov_y` in `(0, π)`, `height > 0`; constant violations are `E5011`, run-time violations from writes are `E8011` (write ignored).
- **Exposure** (decision 0081): the camera's exposure value at ISO 100. Lit materials (`lighting.pbr`) multiply their result by `1 / (1.2 · 2^exposure)` (`spec/materials.md` §8 rule 9); Unlit and other materials are not affected. The default makes a white Lambertian surface under the default 1 lux `DirectionalLight` render white; real-world values work as on a camera (a sunny day of about 100 000 lux is about `15`, an office of about 500 lux about `7`). One EV more halves the brightness. A constant (`E3090` otherwise); writing and binding it is not in v0.1.
- **Exactly one active camera at the start.** A scene with no camera is `E5012` (an unexplained black canvas is not acceptable). With several cameras, exactly one must declare `active: true` (`E5013`). That camera draws first.
- **Switching** (decision 0154). `set_camera(Name)` — in a lifecycle function or an event handler (`E5080` elsewhere) — makes `Name` the camera that draws. The argument is the name of a camera of this scene, written where `set_camera` is called (`E5015` for anything else). The other cameras keep their values. A binding that writes a camera field names that camera. Exposure stays a constant of each camera.

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
| `material` | material instance (`Unlit {…}`, `Pbr {…}`, user material `{…}`) | `Unlit {}` if `mesh` is set | instance identity construction-only; params readable, writable and bindable by name (`Cube.material.color`), for the built-in `Unlit` and `Pbr` (also the default `Unlit {}`) as for user materials (decision 0087; `spec/materials.md` §4) |
| `light` | `DirectionalLight {…}` / `PointLight {…}` | none | `spec/materials.md` §7 |
| `body` | `Static {}` / `Dynamic {…}` / `Kinematic {}` | none | `spec/physics.md` |
| `collider` | `BoxCollider {…}` / `SphereCollider {…}` | none | `spec/physics.md` |
| `tag` | `string` constant | none | §17 |
| `particles` | `Emitter { … }` | none | construction-only; §4.6 |
| `clip` | `string` constant | none | construction-only; the name of a glTF clip (§4.7) |

A `material` without a `mesh` is `E5020`. Unknown, duplicate and mistyped fields are `E5001`/`E5002`/`E3102`. All values inside `mesh`, `body`, `collider` and `particles` descriptors must be **constant expressions** (`E3090`) — they are construction-only data transported in the manifest.

4.2 **Names.** Entity names are `PascalCase` by convention and **unique within the scene**, including nested entities (`E2002`). A named entity is referenced by its bare name anywhere in the scene (`Cube.position`). Entity names share the scene scope with state and cameras.

4.3 **Nesting is parenting.** An `entity` declared inside another entity is its child; the child's transform is relative to the parent (§12). Parenting is a transform relationship, not inheritance: children do not inherit fields, state or handlers. Cyclic parenting is impossible syntactically. Re-parenting at run time is not in v0.1.

4.4 **Entity state.** `state name: T = expr;` inside an entity (or prefab) is per-instance state, accessed as `self.name` from the entity's own functions and as `EntityName.name` from elsewhere in the scene. Entity state may not use the name of an `Entity` schema field (`state position: …` would make `self.position` ambiguous) — `E2002`, with a note naming the field.

4.5 **Lifetime.** Statically declared (named) entities live exactly as long as the scene. They cannot be destroyed in v0.1 (`destroy(Cube)` is `E5030`; at run time, destroying a named entity through an `entity_ref` is `E8030`, a no-op). Hide them with `visible: false`. This makes every static entity reference permanently valid.

4.6 **Particles** (decision 0155). `particles: Emitter { rate: 24.0; lifetime: 0.8; speed: 1.6; size: 0.12; gravity: 3.0 }` keeps at most 64 particles. Each frame spawns `floor(rate · dt)` of them (a fraction waits for the next frame) on the upper hemisphere around the entity's world position, at `speed` metres per second, and `gravity` pulls them down. They are drawn as camera-facing copies of this entity's mesh, in the colour of its material, between the opaque and the translucent draws; a translucent material (`Sprite`, a colour alpha below 1) blends and writes no depth (`spec/materials.md` §3.4, decision 0173). Without a mesh they are still simulated. At most 256 particles are drawn in a frame: past that the rest are not drawn and `W8210` is reported once. Particles draw their random numbers from a stream of their own, so an emitter does not move the sequence `random()` gives to the program in a seeded run. `particle_count() -> i32` is how many are alive. The pool advances at the start of phase 3, so `pause()` stops it and `update` reads the new count.

4.7 **Clips** (decision 0156). `clip: "Spin"` plays that animation of the GLB this entity's `mesh` was loaded from. The clip's pose is composed with the entity's own transform, `base · clip` (decision 0174): the entity's `position`, `rotation` and `scale` (its construction value, a spawn parameter, a binding or a write) are the base, and the clip's channels move it relative to that base; a channel the clip does not have is the identity. A prefab placed with `position: origin` and given a translation clip plays the clip around `origin`. `E5016` is reported when the mesh is not from that file, when the name is missing, or when a scale keyframe is not positive. A skin is `E7019` where the file is declared; an animation the profile cannot play (a morph-weight channel, cubic-spline or another interpolation) is `E7019` where a `clip` names it. The pose at time 0 is applied after `init`; phase 3 then advances the clip before particles, timers and `update`. Time wraps after the duration.

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

- A prefab is a module item describing a root entity and optional ordinary child entities. It has the same members as an entity body plus root `param` declarations. Prefabs with children are **static assemblies**: `spawn` and nested prefab instances inside them are rejected with `E5040` (decision 0128).
- `param name: T [= default];` — immutable construction input. A param without default is required at every instantiation (`E5041`). Params are readable in the prefab's field initialisers, state initialisers, `bind` expressions and functions.
- **Static instance:** `entity First: Crate { origin: vec3(0.0, 3.0, 0.0); }` — the body may set **only params** (`E5042` for anything else, with a note listing the prefab's params). Static instances are named entities (§4.5).
- **Dynamic instance:** `spawn(Crate { origin: p })` (§9), for single-entity prefabs only.
- **Static assembly:** every child is copied beneath each instance, in depth-first declaration order. `self` refers to the current part; bare root params, constants and state remain visible in descendants. Child names are unique within the prefab and private to it; instance-qualified symbols such as `Demo.Left.Seat` distinguish copies. The scene accesses the root state as `Left.seat_color`; bindings on children can read that state. Root transforms move all descendants. Each part has independent state, bindings, lifecycle functions and material parameters. Visibility still hides only that entity’s mesh. Static parts live until scene disposal and cannot be destroyed. Lights remain disallowed throughout a prefab, and bodies remain root-only.
- A prefab has no access to scene state (it is not inside a scene); its handlers use `self`, its params, its state, constants and functions. Referencing a scene name from a prefab is `E2003`.
- A field value, a state initialiser or a material param of a prefab may read its params, constants and state (§11) and call functions; it is computed when an instance is created. Construction-only values (`mesh`, `body`, `collider`) are constants (`E3090`). A prefab's `bind` follows §8.4 with `self` for the entity. An instance's fields, state and material params are read and written from the scene like those of any named entity (§4.4, §8), except that what the prefab binds cannot be assigned (`E5070`).
- The params of a **static** instance are constant expressions (`E3090`); a run-time value is what `spawn` passes (§9). A prefab may declare a `body`, a `collider` and collision handlers (the entity it describes is checked like a scene entity, `spec/physics.md` section 2; a static instance of a prefab with a body must be a root entity, `E5091`); `light` in a prefab is `E5110`. Decisions `spec/decisions/0062-prefabs.md` and `0065-physics-schemas-and-ownership.md` record the details this section leaves open.

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

7.3 **Polling.** These are CPU intrinsics. They read the state as of the end of phase 1 of the current frame (decision 0153).

| Built-in | Meaning |
|---|---|
| `is_key_down(Key.W) -> bool` | the key was down |
| `key_pressed(Key.W) -> bool` | the key went down in the transitions delivered this frame |
| `key_released(Key.W) -> bool` | the key went up in the transitions delivered this frame |
| `pointer_position() -> vec2` | the pointer, in the same coordinates as `PointerEvent.position`; `(0, 0)` until the pointer moves or a button changes |
| `is_pointer_down(button: i32) -> bool` | button 0, 1 or 2 was down; any other button is false |

A key that goes down and up in one frame makes both `key_pressed` and `key_released` true, and `is_key_down` false. The edges last until the next frame's phase 1.

**Edges are per frame, not per tick** (decision 0177). The transitions are delivered once per frame, in phase 1, and `key_pressed` and `key_released` answer for the whole frame. In `update` that is the frame the key changed in. In `fixed_update` the same answer is given on every tick of that frame, so a frame that runs two ticks sees the edge twice and a frame that runs none (the accumulator had less than a step) never shows it to `fixed_update` at all. The edge is not rewound to a tick. Use `is_key_down` for a held key in `fixed_update`; for "once per press" use an `on key_down` handler, or read the edge in `update` and keep it in a `state` that `fixed_update` consumes.

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
- call `cpu fn`s, pure functions and CPU intrinsics (`spawn`, `destroy`, `alive`, `random`, `print`, `is_key_down`, `key_pressed`, `key_released`, `pointer_position`, `is_pointer_down`, `choose`, `shuffle`, `particle_count`, `set_camera`, body commands from `spec/physics.md`);
- read `frame.*`.

8.2 **Single writer.** Every writable field of every entity, camera, light and material instance has exactly one writer, decided statically:

| Writer | Established by | Consequence |
|---|---|---|
| **Imperative** | default | handlers may assign it (if the schema marks it `writable`) |
| **Binding** | the field's value is `bind(expr)` | any assignment to it anywhere is `E5070`, with a related span at the `bind` — "update its source instead" |
| **Physics** | the entity has any `body`: `Dynamic` (solver owns `position`, `rotation`), `Kinematic` (pose set only through `set_kinematic_target`/`teleport`), `Static` (pose fixed at creation) | assignment to `position`/`rotation` is `E5071` with a note naming the allowed operation (`apply_impulse`, `set_kinematic_target`, `teleport`, or "static bodies cannot move"); a `bind` on those fields is `E5072` |
| **Clip** | the entity's `clip` has a channel for the field (`translation` moves `position`, `rotation` turns `rotation`, `scale` scales `scale`) | none: the clip composes with the field's value, `base · clip` (decision 0174; decision 0156 had made it `E5016`) |

Fields the schema marks construction-only (e.g. `mesh`, `body`, `scale` of bodies) cannot be assigned at all (`E5073`). The physics rules hold for every entity with a body, also an instance of a prefab that declares one and `self` inside such a prefab; decision `spec/decisions/0065-physics-schemas-and-ownership.md` records where each is reported.

8.3 **`entity_ref` access** (decision 0151). Through an `entity_ref` you may: compare (`==`, `!=`), test `alive(r)`, `destroy(r)`, issue body commands (`r.body.apply_impulse(v)`, …, `spec/physics.md` §3), and **read** `position`, `rotation`, `scale` and `visible`. A write of any field, and a read of any other field or of state, is `E5074`. A reference that is not alive reads as zero: `position` and `scale` are `(0, 0, 0)`, `rotation` is the identity and `visible` is false. A named entity used where an `entity_ref` is expected converts implicitly (`other == Floor`). A `bind` cannot read these fields through a reference (`E5005`: no dependency kind covers a reference that might change entity).

8.4 **`bind` rules** (blueprint §3.2).
- `bind(expr)` may appear only as the whole value of a field the schema marks **bindable** (`spec/stdlib.md` §3), or of a value param in a material instance descriptor; anywhere else it is `E5004`. It is not a value: it cannot be stored, passed or returned.
- The expression must be **pure**: it may read constants, scene state, `frame.*`, named entities' fields and state, material/prefab params, and — inside a prefab or entity — `self` fields, `self` state and the prefab's params; it may call pure functions and pure intrinsics. Calling a `cpu fn` or a CPU intrinsic (`random`, `is_key_down`, …) is `E5005`.
- Its type must equal the field's type exactly (after literal resolution), `E3102` otherwise.
- **Dependencies** are the set of state slots, entity fields/state, params, light colours and intensities and `frame` values the expression reads; they are recorded in the IR and the manifest and shown by `mtek inspect --bindings`. A binding may read `Name.light.color` and `Name.light.intensity` (decision 0067; `Name.light.range` is fixed at construction and is no dependency); it may not read a camera field or a body property (`E5005`: no dependency kind covers them).
- **Cycles.** If binding A reads a field whose value is itself bound by binding B, A depends on B. A cycle is `E5075`, reported at one binding with every binding of the cycle as related spans, in order.
- Bound fields are evaluated in phase 5 (§10) in topological order; reading a bound field from a handler returns the value computed in the previous evaluation (bindings are also evaluated once during initialisation, §11).

## 9. Dynamic lifecycle: spawn and destroy

- `spawn(Prefab { params… }) -> entity_ref` — CPU intrinsic, allowed only in lifecycle functions and handlers (`E5080` in initialisers). It **queues** creation; the new entity is created at the next lifecycle flush point (§10), as a root entity of the scene. The returned reference is valid immediately: `alive(r)` is `false` until the flush and `true` after it.
- `destroy(r: entity_ref)` — queues removal. From the moment of the call the entity is **pending removal**: `alive(r)` returns `false`, its handlers are not invoked for the rest of the frame, body commands against it are dropped with warning `W8031`, and no further collision events involving it are delivered. It is removed (with its children, its body, its resources released) at the next flush point. Destroying an already-dead or pending entity is a no-op with `W8032`.
- `alive(r) -> bool`.
- **References are generation-checked.** An `entity_ref` is `(slot, generation)`. Slots are reused; generations are not, so a reference to a destroyed entity can never reach a later entity in the same slot.
- A newly created entity never joins an iteration already in progress: it first runs in the next phase that starts after its flush.
- The maximum number of live entities is a runtime limit (`mtek.toml` `[runtime] max_entities`, default 16 384). Exceeding it makes `spawn` return a dead reference and report `E8033`.
- **Details fixed by decision 0064.** The flush points are the start of each fixed tick and the end of the frame after `update`; removals are applied before creations, creations in spawn order. A spawn that is destroyed before its flush is cancelled: nothing is created and `init` does not run. The limit counts named entities, alive ones, pending spawns and pending removals. The argument of `spawn` is a prefab literal whose params may be run-time values; `destroy` of a named entity is `E5030` (`E8030` through a reference). A spawned entity's GPU resources are released when it is removed; reloading a running program re-creates the spawned entities in the same slots (`spec/runtime-abi.md` §11.3).

## 10. Frame order (normative summary)

The runtime's scheduler (`spec/runtime-abi.md` §7 is the implementation contract) runs, per rendered frame:

1. **Input.** Apply queued host-input changes in arrival order; apply input transitions; dispatch input handlers in event-arrival order. For each event: scene handlers first, then entity handlers in **stable instance order** (§10.1).
2. **Fixed ticks** (0 to `max_catch_up_steps` of them, default 4, step `1/60` s). For each tick: (a) flush the lifecycle queue; (b) apply pending physics commands once; (c) run `fixed_update` (scene, then entities in instance order); (d) step physics; (e) write authoritative poses back; (f) deliver collision events in a deterministic order (`spec/physics.md` §6). Commands issued in (f) apply in the next tick. Backlog beyond the catch-up limit is discarded and reported in the runtime counter `discardedSteps`. The physics half of a tick, its command categories, write-back, velocities and event delivery are decision `spec/decisions/0066-physics-integration.md`.
3. **Update.** Advance clips (§4.7), then particles (§4.6), then the timers that fall due (`after`/`every`, §15.3), then `update(dt)` — scene first, then entities in instance order — with `dt` = the clamped frame delta (§10.2). While the game is paused (`pause()`, §15.4) phases 2 and 3 do not run; input, the flush, bindings, transforms and rendering go on.
4. **Lifecycle flush.**
5. **Bindings.** Evaluate every live binding against the now-consistent state, in dependency (topological) order; ties broken by declaration order.
6. **Transforms.** Propagate local transforms to world matrices, parents before children. v0.1 renders the latest authoritative physics pose; render interpolation is not in v0.1.
7. **Render.** Prepare frame/view data, cull, build the draw list, upload changed data, encode and submit.

10.1 **Stable instance order.** Static entities in declaration order (depth-first pre-order over nesting), followed by spawned entities in spawn order. Never JavaScript object-key enumeration order.

10.2 **Time policy.** Frame delta is clamped to `max_frame_delta` (default 0.1 s). The host's `app.pause()` (`spec/runtime-abi.md` §6.2; not the program's `pause()` of §15.4) stops clocks and the fixed-step accumulator; `resume()` continues without simulating the paused interval. Hidden documents are paused automatically and resumed when visible, unless the host opts out. All three constants are configurable in `mtek.toml` `[runtime]` and recorded in the manifest.

10.3 **Same-frame combinations** that must have conformance tests: spawn then destroy in the same handler; destroy then a collision involving the entity in the same tick; key down and up within one frame (both delivered, in order); input during pause (transitions that occur while paused are discarded; the held-key state is re-synchronised on resume exactly as on focus loss, §7.4). The unit tests are `host/spawn.test.ts` and `scene/slots.test.ts`; the browser conformance tests, with a real physics engine under them (destroy before, in and after the tick of a collision, key down and up in one frame, input during a pause, and spawn, destroy, input and a collision in one frame of three ticks), are `tests/browser/specs/m5/physics-combinations.spec.ts` (decision 0068 item 6).

## 11. Initialisation order

1. Module constants (compile time).
2. Scene fields, then scene `state` in declaration order. A state initialiser may read constants, earlier scene state, and call pure and `cpu` functions (e.g. `random()`); it may not spawn (`E5080`) or read entity fields (`E5081`).
3. Cameras and entities in declaration order (depth-first pre-order). For each entity: params (for prefab instances), then entity `state` in declaration order, then fields in declaration order. Field and state initialisers may read constants, scene state, own params and own earlier state; they may not read entity fields, including `self.x` fields (`E5081`).
4. All bindings are evaluated once (so bound fields have values before the first frame). Clips then sample time 0 (§4.7). Transforms are propagated.
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

Several scenes at once (one runs at a time, §15); run-time re-parenting; spawned prefabs with children; prefab instances nested within prefabs; writing fields through `entity_ref`, and reading any field but `position`, `rotation`, `scale` and `visible` (§8.3); user-defined components and systems (v0.2); render interpolation; text in the 3D world, UI layout and text input.

Audio is no longer in this list: `spec/audio.md` (decision 0130).

Screen-space text and buttons are no longer in this list: `spec/hud.md` (decision 0134) adds the immediate-mode HUD and `spec/language.md` §5.8 (decision 0133) interpolated strings.

Tweens are covered by easing curves in bindings: `spec/tweens.md` (decision 0135) adds the `easing` namespace; a tween is progress state plus `bind(mix(a, b, easing.curve(t)))`. There is still no tween object or timeline.

Camera switching is `set_camera` (decision 0154). A particle emitter is `particles: Emitter` (decision 0155). A glTF node clip plays with `clip` (decision 0156); skins, morphs and cubic spline stay out.

## 15. Game flow: scenes, reset, pause and timers

Decisions 0140 (`reset`), 0141 (scenes and `go_to`), 0142 (timers), 0143 (`pause`) and 0144 (`while`, `spec/language.md` §7.10).

15.1 **Several scenes.** A program may declare any number of scenes in its entry module. With more than one, `mtek.toml` `project.scene` names the scene that runs first (`E9006` otherwise). `mtek build` packages every scene: the entry scene into `app.js` and `program.manifest.json`, every other scene `S` into `app.S.js` and `program.S.manifest.json`, sharing the content-addressed shaders, assets and bundles. Every manifest lists the scenes in `game.scenes` (`spec/runtime-abi.md` §5.2). A single-scene program is packaged exactly as before. Host inputs and outputs (`mtek.toml` `[host]`) are declared for the entry scene; another scene uses the ones whose state it also declares.

15.2 **`go_to(Scene)` and `shared state`.** `go_to(Level)` — in a lifecycle function or an event handler (`E5080` elsewhere) — switches to the scene `Level`. The argument is the name of a scene of the program, written where `go_to` is called (`E5201` for anything else). The switch is not immediate: the current frame finishes, the runtime loads and initialises the new scene in the background (its module, manifest, shaders and assets, then `init`, §11), and the new scene becomes the live one at the start of a later frame, as a whole. Until then the current scene keeps running. Only the first `go_to` or `reset()` counts until it has been applied or has failed; later calls are ignored. `go_to` to the scene that runs restarts it like `reset()` but keeps the shared state.

What carries over: nothing but **shared state**. A scene state declared `shared state score: i32 = 0;` is copied into the new scene when the new scene declares a shared state of the same name (with the same type, which the compiler guarantees: `E5204`); the copy is made before the first frame of the new scene, after its `init`, so its bindings see the carried value but its initialisers saw their own. Every other state, every entity (named or spawned), every timer, every body and every queued command ends with the old scene; the new scene starts from its initial values. Only scene state can be shared (`E5202`), and only plain data: `bool`, the numeric, vector and matrix types, `quat`, `color`, `string`, enums, and arrays and structs of these, no `entity_ref`, resource or descriptor (`E5203`). Held keys and the pointer state stay as they are: input is the application's, not the scene's. A scene starts with the game running (§15.4).

If the new scene cannot be loaded or started (a file is missing, its manifest or module is invalid, its `init` fails), the runtime reports `E5401` with the underlying diagnostics as notes and the current scene keeps running. A program cannot observe the failure.

15.3 **Timers.** `after(seconds) { … }` and `every(seconds) { … }` (`spec/language.md` §7.11) put a block on the scene's timer list. The timers run on the **game clock**: the sum of the frame deltas of the frames in which the game is not paused, counted from the start of the scene. At the start of phase 3 of every such frame, the timers whose time has come run, in order of their due time and then of the order they were started, before any `update`.

- `after` runs once, in the first frame whose game time reaches its due time.
- `every` runs at most once per frame. Its next due time is one period after the previous one; when the game fell behind (a long frame), one period after now, so it never runs a backlog in a burst.
- A timer started while timers run waits for the next frame.
- A timer started in an entity's or a prefab's handler belongs to that entity: it is dropped, without running, when the entity is destroyed (also when it is pending removal). The timers of a scene end with the scene (`go_to`, `reset()`).
- A block that fails the frame (the `while` cap or the loop budget, `E8080`) stops the scene like any frame failure.

15.4 **`pause()`, `resume()` and `paused()`.** `pause()` stops the **game**: from the next phase on, no fixed tick runs (no `fixed_update`, no physics step, no collision events), phase 3 does not run (no timers, no `update`), and the game clock and the fixed-step accumulator stand still. Everything else goes on: input handlers (`on key_down`, `on pointer_down`, …) are delivered, spawn and destroy are flushed, bindings are evaluated, transforms propagated, the scene is rendered, and `frame.time` and `frame.delta` keep counting real (active) time. `resume()` starts the game again; the paused interval is never simulated. `paused()` answers whether the game is paused. A pause in an input handler already holds the ticks and the update of that frame.

This is the hook for pause menus and other UI: a handler that reacts to a key or a pointer while paused runs as usual, and a binding on a state the handler sets keeps the display current, because bindings and rendering keep running. UI elements (text, HUD) that must update while the game is paused should therefore be driven by input handlers and bindings, not by `update` or timers, which do not run. The runtime exposes the pause as `ctx.paused()` to generated code and the scheduler's `gamePaused` flag to the host (`spec/runtime-abi.md` §4.2).

The game pause is the program's; the host's `app.pause()` (`spec/runtime-abi.md` §6.2) is different: it stops the whole application, input and rendering included, and is what a hidden page does (§10.2). The two are independent: `app.resume()` does not resume a paused game, and `paused()` reports only the game pause.

15.5 **`reset()`.** `reset()` restarts the scene that runs: like `go_to` (§15.2) it prepares the scene afresh, from its initial values, and swaps it in at the start of a later frame. Unlike `go_to`, shared state does not carry over: `reset()` is a full restart of the scene, shared state included. To keep a value across a reset, switch with `go_to(ThisScene)` instead, which keeps the shared state.

## 16. Saved state and settings

Decisions 0145 (saved state, `save()`, `load()`, `clear_saved()`) and 0146 (settings).

16.1 **Declaring persistent state.** A scene state may be declared `saved state` or `setting state`, after `shared` when it is shared as well:

```mtek
scene Title {
    shared saved state best: i32 = 0;     // a high score: written by save()
    setting state volume: f32 = 0.8;      // a setting: written whenever it changes
    saved state unlocked: array<bool, 3> = [true, false, false];
    camera Main {}
}
```

The value of a persistent state is kept in the browser's storage and outlives the page. Only scene state can be persistent (`E5210` in an entity or a prefab). Only plain data can be stored, the types `shared state` allows (§15.2): `bool`, the numeric, vector and matrix types, `quat`, `color`, `string`, enums, and arrays and structs of these, no `entity_ref`, resource or descriptor (`E5211`). The words `saved` and `setting` are contextual (`spec/language.md` §2.4): `let saved = true;` is an ordinary name.

16.2 **One store for the program.** All scenes of a program share one store (`spec/runtime-abi.md` §5, `game.storage`: the project name, or `<name>.<id>` with a project `id`, decision 0179), keyed by the state's name. A state of one name is the same stored value in every scene that declares it persistent. So two scenes that both declare `best` read and write one high score. They must agree on its type and on whether it is `saved` or `setting` (`E5212`). A scene that does not declare a name leaves its stored value alone.

16.3 **When values are read and written.**

- **Scene start.** When a scene starts (at mount, after `go_to` and after `reset()`), every persistent state that has a stored value takes it. This happens after `init` and before shared state is carried over (§15.2). `init` and the initialisers see the declared initial values. The first frame and the bindings see the stored ones, and a carried `shared` value wins over a stored one, because it is newer.
- **`save()`** (lifecycle functions and handlers, `E5080` elsewhere) writes every `saved` and `setting` state of the running scene at once. Stored values of names this scene does not declare are kept.
- **`load()`** (lifecycle functions and handlers) sets every persistent state of the running scene that has a stored value to it again, and returns whether there was at least one. It undoes the changes made since the last save.
- **`clear_saved()`** (lifecycle functions and handlers) deletes everything the program stored, for every scene. The states of the running scene keep their current values: follow it with `reset()` to start over from the initial values.
- **Settings save themselves** (decision 0146). At the end of every frame in which the value of a `setting state` changed, the settings of the running scene are written. A `saved state` is written only by `save()`.

16.4 **What can go wrong.** Nothing about storage stops the program or reaches it as an error. A stored value of another type than the state now has (the program changed), of another shape, or unreadable, is ignored, and the state keeps its value. The runtime warns once per state with `W5402`. A write the browser refuses (the storage is full or disabled) warns with `W5403`. On a page with no usable `localStorage` (a sandboxed frame, a privacy mode) the values are kept in memory until the page closes, and the first write warns with `W5403`. An enum is stored as its variant index: reordering an enum's variants changes what an old save means, and removing variants makes an index out of range, which is then ignored (`W5402`).

16.5 **Tests and hosts.** `mtek test` and any mount with test options start with an empty in-memory store, so tests do not depend on what an earlier run saved. A host may pass its own store, or `storage: null` for memory only (`spec/runtime-abi.md` §6.1).

## 17. Tags

Decision 0150.

17.1 **Declaring a tag.** An entity or a prefab may name the group it belongs to with the construction-only field `tag`:

```mtek
prefab Rock {
    param lane: i32 = 0;
    tag: "rock";
    mesh: Box {};
}

scene Run {
    camera Main {}
    entity Player {
        tag: "player";
        mesh: Sphere {};
    }
    on key_down(Key.Space) {
        spawn(Rock { lane: random_int(0, 3) });
    }
    update(dt: f32) {
        if count_tagged("rock") > 8 {
            destroy_tagged("rock");
        }
        // Keep only the rock nearest the player.
        let near = nearest_tagged("rock", Player.position);
        for r in tagged("rock") {
            if r != near && !has_tag(r, "player") {
                destroy(r);
            }
        }
    }
}
```

A tag is a string constant of 1 to 32 lowercase letters, digits and `_`, starting with a letter (`E5220`). An entity has at most one tag. Every instance of a prefab has the prefab's tag, placed or spawned. An instance cannot set `tag` (`E5042`), and a prefab's tag cannot read a param (`E3090`).

17.2 **Finding entities by tag.** `count_tagged(tag)`, `first_tagged(tag)`, `nearest_tagged(tag, point)`, `has_tag(r, tag)`, `tagged(tag)` and `destroy_tagged(tag)` (`spec/stdlib.md` §6) look at the entities for which `alive` is true, in stable instance order (§10.1): the named entities, then the spawned ones in spawn order. A spawned entity pending removal is not found. One spawned in the current frame is found after the next flush (§9).

- The tag argument is a string constant (`E5221`) that some entity or prefab of the program declares (`E5222`, with the closest declared tag as a suggestion). A misspelt tag is a build error, not an empty result.
- `first_tagged` and `nearest_tagged` give a dead reference (`alive(r)` is false) when no entity has the tag. `nearest_tagged` measures the world position (§12). A tie goes to the first in instance order.
- `tagged(tag)` is only the iterable of a `for` loop (`E5224`). The loop visits the named entities and the spawned entities that existed when it started. It skips one destroyed before its turn.
- `destroy_tagged(tag)` (lifecycle functions and handlers, `E5080` elsewhere) queues the removal of every live spawned entity with the tag, as `destroy` does for each. Named entities cannot be destroyed, so a tag that a named entity has (its own, or its prefab's for a placed instance) is `E5223`.

17.3 **Run time.** The manifest carries the tag of each entity and prefab (`spec/runtime-abi.md` §5), and the generated code calls `ctx.countTagged(tag)` and its siblings (§4.2).
