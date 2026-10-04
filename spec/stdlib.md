# Standard Library Registry (v0.1)

- Repository path: `spec/stdlib.md` (this document) and `spec/stdlib-schema.json` (generated from the registry; checked in; a test fails when it is stale).
- Status: Normative for v0.1.
- Implemented by: `crates/mtek-compiler/src/stdlib/` (registry data + embedded prelude sources), `packages/runtime-web/src/math/` (CPU intrinsics), `packages/runtime-web/src/mesh/` (primitive generation).

---

## 1. One registry, many products

Every prelude name is defined **once**, in the Rust registry. From it the toolchain generates: name resolution of prelude symbols, field/argument checking, `spec/stdlib-schema.json`, LSP completion and hover, the generated schema reference, and the AI context export (blueprint §3.4). Unknown fields are errors, duplicate fields are errors, unsupported fields are never ignored.

### 1.1 Registry data model (Rust)

```rust
pub struct Registry { pub types: Vec<TypeDef>, pub schemas: Vec<SchemaDef>, pub scene_objects: Vec<SceneObjectKind>,
                      pub events: Vec<EventDef>, pub enums: Vec<EnumDef>, pub intrinsics: Vec<IntrinsicDef>,
                      pub namespaces: Vec<NamespaceDef>, pub prelude_sources: Vec<(&'static str, &'static str)> }

pub struct SchemaDef { pub name: &'static str, pub category: SchemaCategory /* Mesh | Material | Light | Body | Collider | Projection | Object */,
                       pub fields: Vec<FieldDef>, pub since: Milestone, pub doc: &'static str }

pub struct FieldDef { pub name: &'static str, pub ty: TypeRef, pub default: Option<ConstValue>,
                      pub flags: FieldFlags /* REQUIRED | WRITABLE | BINDABLE | CONSTRUCTION_ONLY */,
                      pub range: Option<ValueRange>, pub doc: &'static str }
```
The implementation adds `since` and `default_when_set` to `FieldDef`, `body_commands` / `body_properties` to `Registry`, and type-class signatures (`T`, `I`, `V`, §6); see decision 0024 for these additions and the milestone assignments the tables below leave implicit. Decision 0027 adds the scene rules as data: `declaration_schemas` (the schemas of scene and entity bodies), `SchemaDef.rules` (`material` requires `mesh`, `rotation` is excluded by `target`), `FieldDef.range_code` and the active-object selection of scene-object kinds.

`since` records the milestone in which the compiler implements the item. Items whose milestone has not been reached in the running build are still resolvable but produce `E9010` when used — so the registry is complete from M1 while semantics land per milestone.

### 1.2 `stdlib-schema.json` format

```json
{ "registryVersion": 1, "languageVersion": "0.1",
  "schemas": [ { "name": "Box", "category": "mesh", "doc": "…", "fields": [
      { "name": "size", "type": "vec3", "default": "vec3(1.0, 1.0, 1.0)", "required": false,
        "writable": false, "bindable": false, "range": "every component > 0" } ] } ],
  "events": [ … ], "enums": [ … ], "intrinsics": [ … ], "namespaces": [ … ], "types": [ … ] }
```
Sorted by name within each array. Each `FieldDef` stores its default twice: as a `ConstValue` (used by the checker and code generation) and as **canonical source text** (used for documentation, completion and this JSON). Canonical text expands vector shorthands to every component (`vec3(1.0)` in the tables below is printed `vec3(1.0, 1.0, 1.0)`), prints floats with at least one fractional digit using the shortest decimal that round-trips the binary32 value, prints colours as the lowercase `#rrggbb` literal they were declared with, and prints namespace calls as written (`quat.identity()`, `texture.white()`). A test asserts that every canonical text re-parses and const-evaluates to the stored `ConstValue`.

The generated file contains more than the sketch above (field `constructionOnly` / `since` / `doc`, the arrays `sceneObjects`, `bodyCommands`, `bodyProperties`, `typeClasses`, `preludeSources`); the exact shape is decision 0024 item 4. It is regenerated with `MTEK_BLESS=1 cargo test -p mtek-compiler --test stdlib_schema` and never edited by hand.

## 2. Types and namespaces

Types: `bool i32 u32 f32 string vec2 vec3 vec4 mat4 quat color mesh material texture sampler entity_ref` and the generic `array<T, N>`; structured built-ins `SurfaceInput` (`spec/materials.md` §3.1) and `PointerEvent { position: vec2; button: i32 }`.

| Namespace | Members |
|---|---|
| `quat` | `identity()`, `axis_angle(axis: vec3, angle: f32)`, `euler(x: f32, y: f32, z: f32)` |
| `mat4` | `identity()`, `translation(v: vec3)`, `rotation(q: quat)`, `scale(v: vec3)`, `columns(c0, c1, c2, c3: vec4)` |
| `color` | `linear(rgb: vec3, a: f32)`, `srgb(rgb: vec3, a: f32)` |
| `texture` | `white()`, `black()` (1×1 built-ins) |
| `sampler` | `linear_repeat()`, `linear_clamp()`, `nearest_repeat()`, `nearest_clamp()` |
| `frame` | `time: f32`, `delta: f32`, `index: u32` (`spec/scenes.md` §7.5) |
| `asset` | `glb(path: string) -> glb_asset`, `texture(path: string) -> texture`, `linear_texture(path: string) -> texture` (M4, `spec/assets.md` §2; `glb_asset` accessors in §2.1 there) |
| `lighting` | `pbr(surface: SurfaceInput, base_color: color, metallic: f32, roughness: f32) -> color` — GPU only (M4) |
| `Key` | enum constants (§5.2) |

## 3. Schemas

Flags: **R** required · **W** writable from handlers · **B** bindable · **C** construction-only. Defaults are constant expressions.

### 3.1 `Scene` (scene fields)
| Field | Type | Default | Flags |
|---|---|---|---|
| `clear_color` | `color` | `#000000` | C |
| `ambient_color` | `color` | `#ffffff` | C |
| `ambient_intensity` | `f32` (≥ 0) | `0.0` | C |
| `gravity` | `vec3` | `vec3(0.0, -9.81, 0.0)` | C (physics only) |

### 3.2 `Entity`
| Field | Type | Default | Flags |
|---|---|---|---|
| `position` | `vec3` | `vec3(0.0)` | W B |
| `rotation` | `quat` | `quat.identity()` | W B |
| `scale` | `vec3` (> 0) | `vec3(1.0)` | W B (C if the entity has a body) |
| `visible` | `bool` | `true` | W B |
| `mesh` | mesh schema | — | C |
| `material` | material instance | `Unlit {}` when `mesh` is set | C (params W B) |
| `light` | light schema | — | C (fields W B) |
| `body` | body schema | — | C |
| `collider` | collider schema | — | C |

### 3.3 `Camera` (scene-object kind `camera`), `Perspective`, `Orthographic`
As in `spec/scenes.md` §3. `Perspective { fov_y: f32 = 0.9 (0, π); near: f32 = 0.1 (> 0); far: f32 = 1000.0 (> near) }`, `Orthographic { height: f32 = 10.0 (> 0); near: f32 = 0.1; far: f32 = 1000.0 }`; all projection fields W B.

### 3.4 Meshes (category `mesh`, all fields C)
| Schema | Fields |
|---|---|
| `Box` | `size: vec3 = vec3(1.0)` (full extents, every component > 0) |
| `Sphere` | `radius: f32 = 0.5` (> 0), `segments: u32 = 32` (3…256), `rings: u32 = 16` (2…256) |
| `Plane` | `size: vec2 = vec2(1.0)` (extent along X and Z; > 0) |

Out-of-range constants are `E5006` ("field value out of range"). Asset meshes come from `asset.glb(…)` (`spec/assets.md`).

### 3.5 Materials
`Unlit` and `Pbr` are prelude Mtek source (`spec/materials.md` §9); user materials are added by declaration. The registry records them as schemas with category `material` (their fields are their params, flags W B for value params, C for resources).

### 3.6 Lights (category `light`)
`DirectionalLight { color: color = #ffffff; intensity: f32 = 1.0 }`, `PointLight { color: color = #ffffff; intensity: f32 = 1.0; range: f32 = 0.0 }` — `color`, `intensity` W B; `range` C. (`spec/materials.md` §7.)

### 3.7 Bodies and colliders (category `body`/`collider`, all C) — semantics in `spec/physics.md`
`Static {}`, `Kinematic {}`, `Dynamic { mass: f32 = 1.0 (> 0, finite); linear_damping: f32 = 0.0 (≥ 0); angular_damping: f32 = 0.05 (≥ 0) }`,
`BoxCollider { size: vec3 (R, > 0); sensor: bool = false; friction: f32 = 0.5 (≥ 0); restitution: f32 = 0.0 (0…1) }`,
`SphereCollider { radius: f32 (R, > 0); sensor: bool = false; friction: f32 = 0.5; restitution: f32 = 0.0 }`.

## 4. Primitive mesh generation (normative, runtime `src/mesh/`)

The runtime generates primitive geometry from descriptor values with exactly these algorithms, so tests can predict vertices and pixels. All primitives provide `position`, `normal` and `uv` (glTF convention: `uv` origin top-left, `v` grows downward). Triangles are counter-clockwise when seen from outside. Index format: `uint16` if the vertex count ≤ 65 535, else `uint32`.

**Box** `size = (sx, sy, sz)`, half extents `h = size / 2`. 24 vertices (4 per face, flat normals), 36 indices. Faces in this order, each with normal `n`, in-face axes `u`, `v` chosen so that `u × v = n`:

| Face | `n` | `u` | `v` | half extent along `u`, `v` |
|---|---|---|---|---|
| +X | (1,0,0) | (0,0,−1) | (0,1,0) | `hz`, `hy` |
| −X | (−1,0,0) | (0,0,1) | (0,1,0) | `hz`, `hy` |
| +Y | (0,1,0) | (1,0,0) | (0,0,−1) | `hx`, `hz` |
| −Y | (0,−1,0) | (1,0,0) | (0,0,1) | `hx`, `hz` |
| +Z | (0,0,1) | (1,0,0) | (0,1,0) | `hx`, `hy` |
| −Z | (0,0,−1) | (−1,0,0) | (0,1,0) | `hx`, `hy` |

For a face with centre `c = n ⊙ h` (component-wise) and half extents `(a, b)`: vertices `c − a·u − b·v` (uv `(0,1)`), `c + a·u − b·v` (`(1,1)`), `c + a·u + b·v` (`(1,0)`), `c − a·u + b·v` (`(0,0)`); indices (relative to the face's first vertex) `0,1,2, 0,2,3`. Bounding sphere radius `|h|`.

**Sphere** radius `r`, `S = segments`, `R = rings`. Vertices for `i = 0…R`, `j = 0…S` (index `k = i·(S+1) + j`): `θ = π·i/R`, `φ = 2π·j/S`, unit direction `d = (sin θ · sin φ, cos θ, sin θ · cos φ)`, position `r·d`, normal `d`, uv `(j/S, i/R)`. (At `j = S` the seam duplicates `j = 0` with `u = 1`.) For each `i = 0…R−1`, `j = 0…S−1` with `a = k(i,j)`, `b = k(i+1,j)`, `c = k(i+1,j+1)`, `d = k(i,j+1)`: emit triangle `a,b,c` unless `i = R−1`, and triangle `a,c,d` unless `i = 0` (the skipped triangles are degenerate at the poles). Index count `S·(2R−2)·3`. Bounding sphere radius `r`. Trigonometry is evaluated in `f64` (JavaScript `Math.sin`/`Math.cos`) and stored as `f32`.

**Plane** `size = (sx, sz)`: the +Y face of a box with half extents `(sx/2, ·, sz/2)` placed at `y = 0`: 4 vertices, 6 indices, normal `(0,1,0)`. Single-sided (back-face culled from below). Bounding sphere radius `|(sx, sz)|/2`.

Generated meshes with identical descriptor values are shared (immutable), keyed by the canonical descriptor.

## 5. Events and input

### 5.1 Events
| Event | Arguments | Allowed bodies | Since |
|---|---|---|---|
| `key_down`, `key_up` | filter: `Key` constant | scene, entity, prefab | M3 |
| `pointer_down`, `pointer_up`, `pointer_move` | parameter `(name: PointerEvent)` | scene, entity, prefab | M3 |
| `collision_enter`, `collision_exit` | parameter `(name: entity_ref)` | entity, prefab with collider | M5 |

### 5.2 `Key` (maps to `KeyboardEvent.code`)
| Mtek | `code` |
|---|---|
| `Key.A` … `Key.Z` | `"KeyA"` … `"KeyZ"` |
| `Key.Digit0` … `Key.Digit9` | `"Digit0"` … `"Digit9"` |
| `Key.Space`, `Key.Enter`, `Key.Escape`, `Key.Tab`, `Key.Backspace` | `"Space"`, `"Enter"`, `"Escape"`, `"Tab"`, `"Backspace"` |
| `Key.ShiftLeft`, `Key.ShiftRight`, `Key.ControlLeft`, `Key.ControlRight`, `Key.AltLeft`, `Key.AltRight` | same names |
| `Key.ArrowUp`, `Key.ArrowDown`, `Key.ArrowLeft`, `Key.ArrowRight` | same names |

Events with a `code` outside this table are ignored by the runtime. Browser default actions are prevented only for keys a program handles (so `Space` does not scroll the page in a mounted canvas that handles it) and only while the canvas has focus.

## 6. Intrinsic functions

Notation: `T` ranges over `f32, vec2, vec3, vec4` (component-wise), `I` over `i32, u32`, `V` over `vec2, vec3, vec4` (decision 0024). **D** = domains: `both`, `cpu`, `gpu`. **K** = const-eligible (usable in constant expressions). CPU semantics must equal the WGSL definition [S5] except where stated; the runtime math library (`rt`) implements them with per-operation `f32` rounding.

| Function | Signatures | D | K | CPU semantics notes |
|---|---|---|---|---|
| `abs` | `T → T`, `I → I` | both | ✓ | `abs(i32 MIN) = MIN` |
| `min`, `max` | `(T, T) → T`, `(I, I) → I` | both | ✓ | NaN handling non-portable |
| `clamp` | `(T, T, T) → T`, `(I, I, I) → I` | both | ✓ | `min(max(x, lo), hi)` |
| `saturate` | `T → T` | both | ✓ | `clamp(x, 0, 1)` |
| `mix` | `(T, T, f32) → T`, `(T, T, T) → T` | both | ✓ | `a·(1−t) + b·t` |
| `step` | `(T, T) → T` | both | ✓ | `x >= edge ? 1 : 0` per component (WGSL order: `step(edge, x)`) |
| `smoothstep` | `(T, T, T) → T` | both | ✓ | Hermite, `t = clamp((x−e0)/(e1−e0), 0, 1)` |
| `sqrt`, `inverse_sqrt` | `T → T` | both | ✓ | `sqrt` correctly rounded on CPU |
| `pow`, `exp`, `exp2`, `log`, `log2` | `T → T` (`pow`: `(T, T) → T`) | both | ✓ | tolerance-based CPU/GPU agreement |
| `sin`, `cos`, `tan`, `asin`, `acos`, `atan` | `T → T` | both | ✓ | |
| `atan2` | `(T, T) → T` (`atan2(y, x)`) | both | ✓ | |
| `floor`, `ceil`, `trunc`, `fract`, `sign` | `T → T` | both | ✓ | `fract(x) = x − floor(x)`; `sign(0) = 0` |
| `round` | `T → T` | both | ✓ | **ties to even** (not JS `Math.round`) |
| `radians`, `degrees` | `T → T` | both | ✓ | |
| `length` | `T → f32` | both | ✓ | |
| `distance` | `(T, T) → f32` | both | ✓ | |
| `dot` | `(V, V) → f32` | both | ✓ | |
| `cross` | `(vec3, vec3) → vec3` | both | ✓ | |
| `normalize` | `V → V` | both | ✓ | zero vector → zero vector on CPU; non-portable on GPU |
| `reflect` | `(V, V) → V` | both | ✓ | `i − 2·dot(n, i)·n` |
| `transpose` | `mat4 → mat4` | both | ✓ | |
| `sample` | `(texture, sampler, vec2) → vec4` | gpu | — | `spec/materials.md` §5 |
| `random` | `() → f32` | cpu | — | `[0, 1)`, seeded PRNG (xoshiro128**, seed from mount options) — deterministic under a fixed seed |
| `print` | `(string) → ()` | cpu | — | dev console; no-op in release builds |
| `is_key_down` | `(Key) → bool` | cpu | — | |
| `spawn` | `(prefab descriptor) → entity_ref` | cpu (handlers only) | — | |
| `destroy` | `(entity_ref) → ()` | cpu (handlers only) | — | |
| `alive` | `(entity_ref) → bool` | cpu | — | |

Conformance: `tests/semantics/intrinsics/` holds a table of inputs and expected CPU results for every row, and the GPU conformance test (`spec/testing.md` §5) evaluates the same inputs on the GPU through a probe shader and compares with the per-function tolerances.
