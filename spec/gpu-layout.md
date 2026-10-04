# GPU Data Layout and Transport (v0.1)

- Repository path: `spec/gpu-layout.md`
- Status: Normative for v0.1. This is the "core engineering contract" of blueprint §6 turned into an algorithm.
- Implemented by: `crates/mtek-compiler/src/layout/` (layout engine), `src/emit_wgsl/` (struct and accessor emission), `src/emit_js/` (writer emission), `packages/runtime-web/src/gpu/` (arenas, uploads).
- Sources: WGSL memory layout and address-space constraints [S5] (https://www.w3.org/TR/WGSL/#alignment-and-size, #address-space-layout-constraints, #host-shareable-types); WebGPU limits and `writeBuffer` rules (https://www.w3.org/TR/webgpu/#limits). Facts below were verified against those texts on 2026-10-03.

---

## 1. Principle

For every block of data that crosses from the CPU to the GPU, the compiler computes **one authoritative layout record**. Three consumers are generated from that record and nothing else:

1. the WGSL struct declarations and typed field reads (GPU side),
2. the JavaScript writer functions that serialise CPU values into the block (CPU side),
3. the manifest/inspection description (humans, agents, the runtime's allocator).

No consumer may compute offsets on its own. A test oracle (§9) checks the record against an independent implementation (Naga) and against real GPU reads.

## 2. Address space and rule set

All v0.1 blocks live in the WGSL **`uniform` address space** (material parameter blocks, the frame/view block, the object block). Storage buffers are a v0.2 feature (blueprint §6.4).

We apply the **conservative uniform rules** — the ones that hold when the WGSL language extension `uniform_buffer_standard_layout` is *not* available. Reasons (decision 0010): the extension only exists in recent browsers (Chrome 144+), it must be feature-detected, and **Naga does not implement it** — so a layout using it could not be validated by our pinned validator. The conservative rules are accepted everywhere. Revisit only through a superseding decision with evidence of benefit.

## 3. Type representation (one Mtek type → one WGSL type, everywhere)

The same mapping is used in every WGSL context (buffers, locals, function parameters), so no conversions are ever needed between "buffer form" and "value form".

| Mtek type | WGSL type | Notes |
|---|---|---|
| `f32` | `f32` | |
| `i32` | `i32` | |
| `u32` | `u32` | |
| `bool` (top-level local, parameter, expression) | `bool` | |
| `bool` (field of a struct, element of an array, field of a block) | `u32` | `bool` is **not host-shareable** in WGSL. Stored as `0u`/`1u`; reads lower to `(x != 0u)`, constructions to `select(0u, 1u, b)`. |
| `vec2` / `vec3` / `vec4` | `vec2<f32>` / `vec3<f32>` / `vec4<f32>` | |
| `color` | `vec4<f32>` | linear RGBA; `.r .g .b .a .rgb` map to WGSL swizzles |
| `quat` | `vec4<f32>` | `(x, y, z, w)`; operations lower to generated helper functions (`mtek_quat_mul`, `mtek_quat_rotate`) |
| `mat4` | `mat4x4<f32>` | column-major (WGSL native) |
| `struct S` | `struct S_<mangled>` | one declaration, with explicit `@align`/`@size` attributes from §4. **Member names** of every Mtek-declared struct and parameter block are emitted as `u_<name>` (e.g. `u_tint`), because Mtek field names such as `target`, `filter`, `layout` or `type` are WGSL reserved words; the layout record and all diagnostics keep the Mtek names. Built-in blocks (`MtekFrame`, `MtekLight`, `MtekObject`) and padded-element wrappers (`value`) use their fixed generated member names. |
| `array<T, N>` | `array<T', N>` where `T'` = WGSL type of `T`, or `MtekPad16_<T'>` when padding is required (§4.4) | |

Type distinctions that WGSL lacks (`color` vs `quat` vs `vec4`) are enforced by Mtek's type checker before lowering.

## 4. The layout algorithm

### 4.1 Base metrics (WGSL natural rules)

| WGSL type | `Align` | `Size` |
|---|---|---|
| `f32`, `i32`, `u32` | 4 | 4 |
| `vec2<f32>` | 8 | 8 |
| `vec3<f32>` | 16 | 12 |
| `vec4<f32>` | 16 | 16 |
| `mat4x4<f32>` | 16 | 64 |

### 4.2 Uniform-required alignment, size and stride

Define for every Mtek type `T` (after the mapping in §3):

```
UAlign(T):
    scalar (incl. bool stored as u32)   -> 4
    vec2                                -> 8
    vec3, vec4, color, quat, mat4       -> 16
    struct S                            -> roundUp(16, max_i UAlign(member_i))
    array<E, N>                         -> roundUp(16, UAlign(E))

USize(T):
    scalar 4 · vec2 8 · vec3 12 · vec4/color/quat 16 · mat4 64
    struct S      -> layoutStruct(S).size            (§4.3)
    array<E, N>   -> N * UStride(E)

UStride(E) = roundUp(16, roundUp(UAlign(E), USize(E)))     // always a multiple of 16
```

### 4.3 Struct (and block) member placement

Members are placed **in declaration order** — no reordering (decision 0010: predictable, inspectable, stable across edits; packing optimisations wait until counters show block size matters).

```
layoutStruct(members):
    cursor  = 0      // first byte not yet occupied
    minNext = 0      // lower bound for the next member's offset
    for m in members:
        a        = UAlign(m.type)
        m.offset = roundUp(a, max(cursor, minNext))
        m.size   = USize(m.type)
        cursor   = m.offset + m.size
        if m.type is a struct:
            // WGSL uniform rule: bytes between a struct-typed member and the next
            // member must be at least roundUp(16, SizeOf(S)).
            minNext = m.offset + roundUp(16, m.size)
        else:
            minNext = cursor
    align = max_m UAlign(m.type)                // ≥ 4
    size  = roundUp(align, max(cursor, minNext))
    return { members, align, size }
```

A **block** (material parameter block, frame block, object block) is laid out exactly as a struct whose members are its fields.

### 4.4 Emitting WGSL that reproduces the layout

WGSL computes offsets itself from *natural* alignment and then **checks** the uniform constraints (it does not adjust offsets). The emitter therefore adds attributes so that WGSL's own computation lands exactly on our offsets:

1. `@align(16)` on every member whose type is a struct or an array (their `UAlign` is 16-rounded, their natural alignment may not be).
2. `@size(roundUp(16, size))` on every struct-typed member whose `minNext` exceeds `offset + size` (the struct-followed-by-member rule), and more generally `@size(next.offset − m.offset)` on any member where the gap to the next member is larger than the member's natural size. (By construction, after rules 1–2 WGSL's natural placement equals ours; the Naga oracle in §9.2 proves it per fixture.)
3. **Padded array elements.** If the natural WGSL stride of an element type, `roundUp(Align(E'), Size(E'))`, is not a multiple of 16, the element type is wrapped:
   ```wgsl
   struct MtekPad16_f32 { @size(16) value: f32 }
   ```
   with `@size(UStride(E))`. Reads lower to `a[i].value`, array construction to `array<MtekPad16_f32, N>(MtekPad16_f32(x0), …)`. Because the mapping in §3 is used everywhere, `array<f32, 4>` is `array<MtekPad16_f32, 4>` in locals too; no conversions exist. `vec3`, `vec4`, `mat4` and 16-byte-multiple structs need no wrapper.

### 4.5 Worked examples (these are required unit-test fixtures)

**A. vec3 followed by f32** (blueprint §6.2)

```mtek
struct A { position: vec3; intensity: f32; }
```
`position` @0 size 12 · `intensity` @12 size 4 · align 16 · **size 16**.

**B. The M0 mixed record**

```mtek
struct Mixed { a: f32; b: vec3; c: u32; d: vec2; e: bool; f: color; }
```
| Field | Offset | Size | Encoding |
|---|---|---|---|
| a | 0 | 4 | f32 |
| b | 16 | 12 | f32×3 |
| c | 28 | 4 | u32 |
| d | 32 | 8 | f32×2 |
| e | 40 | 4 | bool as u32 |
| f | 48 | 16 | f32×4 (linear RGBA) |

align 16 · **size 64** (bytes 4–15 and 44–47 are padding).

**C. Struct-typed member followed by a scalar**

```mtek
struct Inner { k: f32; }
struct Outer { inner: Inner; after: f32; }
```
`Inner`: align 4 → `UAlign` 16, size 4. In `Outer`: `inner` @0 (emitted `@align(16) @size(16)`), `after` @16, align 16, **size 32**. Without the `@size(16)`, WGSL would place `after` at 4 and shader creation would fail — this fixture exists to prove the emitter handles it.

**D. Array of scalars**

```mtek
struct W { weights: array<f32, 3>; bias: f32; }
```
`weights`: element wrapped (`MtekPad16_f32`), stride 16, size 48, @0 (`@align(16)`); `bias` @48; align 16; **size 64**.

**E. Nested arrays of structs, bool arrays, mat4**, and a block containing every scalar/vector type at least once — further fixtures listed in `spec/testing.md` §4.2.

## 5. The layout record (data format)

The record is produced by `layout::compute` and serialised (`serde`) into the manifest and `mtek inspect --bindings`. Example for the material `Pulse` declared in `src/main.mtek` (module hash `1f3a9c2e` — an illustrative value):

```json
{
  "id": "material:src/main.mtek::Pulse",
  "wgslStruct": "MtekParams_1f3a9c2e_Pulse",
  "size": 32,
  "align": 16,
  "root": {
    "kind": "struct", "offset": 0, "size": 32, "align": 16,
    "members": [
      { "name": "tint",  "mtekType": "color", "node": { "kind": "vector", "offset": 0,  "size": 16, "align": 16, "scalar": "f32", "components": 4 } },
      { "name": "phase", "mtekType": "f32",   "node": { "kind": "scalar", "offset": 16, "size": 4,  "align": 4,  "scalar": "f32" } }
    ]
  }
}
```

**Identity and naming (normative).** `<hash8>` is the first 8 lowercase hex digits of SHA-256 of the normalised module path (e.g. `src/main.mtek`). Material blocks: id `material:<module path>::<Name>`, WGSL struct `MtekParams_<hash8>_<Name>`. User structs: `S_<hash8>_<Name>`. Built-in blocks: ids `builtin:frame`, `builtin:object`, WGSL structs `MtekFrame`, `MtekLight`, `MtekObject` (the `Mtek` prefix is reserved for generated code). Test fixtures (`tests/gpu-layout/`, before modules exist): id `fixture:<name>`, WGSL struct `MtekFixture_<name>`, nested structs `S_<Name>`. These rules make names unique across modules, so two materials called `Pulse` in different files never collide.

**Key order (normative, so goldens are stable).** Record: `id, wgslStruct, size, align, root`. Member: `name, mtekType, node`. Node keys appear in this order, omitting those that do not apply to the kind: `kind, name, offset, size, align, scalar, components, columns, rows, columnStride, length, stride, padded, element, members`. The `<name>.layout.json` fixture goldens of `spec/testing.md` §4.2 are exactly this format.

Node kinds: `scalar` (`scalar` ∈ `f32 | i32 | u32 | bool32`), `vector` (`components` 2–4, `f32`), `matrix` (`columns: 4, rows: 4, columnStride: 16`), `struct` (`name`, `members`), `array` (`length`, `stride`, `padded: bool`, `element` — a node whose offsets are relative to the element start). Offsets of members are absolute within the block. All numbers are bytes.

## 6. The fixed binding plan (v0.1)

| Group | Binding | Content | Visibility | Owner |
|---|---|---|---|---|
| 0 | 0 | `MtekFrame` (§6.1) | vertex + fragment | runtime, written once per frame |
| 1 | 0 | `MtekParams_<hash8>_<Material>` — present only if the material has value params | fragment | per material instance |
| 1 | 1… | one binding per `texture` or `sampler` param, in param declaration order | fragment | per material instance |
| 2 | 0 | `MtekObject` (§6.2), **dynamic offset** | vertex | per drawn object |

WGSL declarations are always:

```wgsl
@group(0) @binding(0) var<uniform> mtek_frame: MtekFrame;
@group(1) @binding(0) var<uniform> mtek_params: MtekParams_1f3a9c2e_Pulse;   // if present
@group(2) @binding(0) var<uniform> mtek_object: MtekObject;
```

A material with no params and no resources still gets an empty group-1 layout, so group numbering never shifts. 3 of the 4 default bind groups are used.

### 6.1 `MtekFrame` (runtime-owned, laid out by the same engine)

```mtek
struct MtekLight {
    color: vec3;       // linear rgb × intensity
    kind: u32;         // 0 = directional, 1 = point
    position: vec3;    // world position (point)
    range: f32;        // 0 = unlimited (point)
    direction: vec3;   // world unit vector the light travels along (directional)
    reserved: f32;
}                      // size 48, align 16
struct MtekFrame {
    view_proj: mat4;            // @0
    camera_position: vec3;      // @64
    light_count: u32;           // @76
    ambient: vec3;              // @80  (ambient_color.rgb × ambient_intensity)
    reserved0: f32;             // @92
    lights: array<MtekLight, 4>;// @96, stride 48
}                               // size 288
```

### 6.2 `MtekObject`

```mtek
struct MtekObject {
    model: mat4;           // @0
    normal_matrix: mat4;   // @64: inverse-transpose of the upper 3×3 of model, in the upper 3×3; last row/column (0,0,0,1)
}                          // size 128
```

The frame and object layouts are defined in the compiler (`layout::builtin_blocks()`), emitted into WGSL like any other block, included in the manifest, and written by **generated** writers like any other block — the runtime never hand-codes their offsets.

## 7. Generated JavaScript writers

For each block the compiler emits, into `app.js`, one writer per top-level field plus a whole-block writer. The CPU value representation they accept is defined in `spec/runtime-abi.md` §4 (vectors `{x,y,z}`, colours `{r,g,b,a}`, quaternions `{x,y,z,w}`, `mat4` as a 16-element `Float32Array` in column-major order, structs as plain objects, arrays as JS arrays, `bool` as `boolean`).

```js
// Generated from layout material:src/main.mtek::Pulse (size 32). Do not edit.
function w_1f3a9c2e_Pulse_tint(m, base, v) {   // m = { f32: Float32Array, u32: Uint32Array, i32: Int32Array } over one ArrayBuffer
  const w = base >>> 2;                          // base is a byte offset, multiple of 4
  m.f32[w + 0] = v.r; m.f32[w + 1] = v.g; m.f32[w + 2] = v.b; m.f32[w + 3] = v.a;
}
function w_1f3a9c2e_Pulse_phase(m, base, v) {
  m.f32[(base >>> 2) + 4] = v;
}
function w_1f3a9c2e_Pulse(m, base, v) {
  w_1f3a9c2e_Pulse_tint(m, base, v.tint);
  w_1f3a9c2e_Pulse_phase(m, base, v.phase);
}
```

Writer functions are **module-private** in `app.js` (no `export`); the runtime reaches them only through the exported `writers` table, keyed by layout id (`spec/runtime-abi.md` §3). Naming: `w_<hash8>_<Name>` for the block and `w_<hash8>_<Name>_<field>` per top-level field; built-in blocks use `w_builtin_MtekFrame…`/`w_builtin_MtekObject…`; layout fixtures use `w_fixture_<name>…`. The `emit_writers` API returns the function texts plus the table entry; a standalone test artifact (the M0 fixture dump) may wrap them with `export` statements — that wrapper is test-only.

Rules:
- Writers only ever write field bytes. **Padding bytes are never written** and are therefore zero (mirrors are zero-initialised and zero-filled on slot release) — this makes byte-wise comparison and hashing of blocks deterministic (blueprint §6.2).
- `bool` writes `v ? 1 : 0` into the `u32` view. `i32` into the `i32` view, `u32` into `u32`. Every `f32` write goes through the `Float32Array`, which rounds to binary32.
- The runtime verifies once at startup that the platform is little-endian (WebGPU buffer contents are interpreted little-endian); on a big-endian platform `mountMtek` fails with `E8001`. Typed-array views are then exact.
- Writers are straight-line code (loops only for arrays with `length > 16`), generated from the record, with the record id in a leading comment.

## 8. Runtime transport

### 8.1 Uniform arenas

`packages/runtime-web/src/gpu/uniform-arena.ts`. One arena per block layout (one per material type, one for objects).

- `slotStride = roundUp(device.limits.minUniformBufferOffsetAlignment, roundUp(16, layout.size))` — record layout and binding-offset alignment are separate concerns (blueprint §6.2): the layout comes from the record, the stride from the **queried** device limit (default 256).
- Capacity starts at 16 slots and doubles. Buffer usage `UNIFORM | COPY_DST`. A CPU **mirror** (`ArrayBuffer` of `capacity × slotStride` bytes, with `f32`/`u32`/`i32` views) holds the authoritative CPU copy.
- `allocate()` returns a slot index (free-list, lowest index first for determinism); `release(slot)` zero-fills the slot in the mirror and returns it to the free list.
- Each slot has a dirty flag. `flush(queue)` uploads every dirty slot's `[slot × slotStride, + layout.size)` range with one `queue.writeBuffer` each (offsets and sizes are multiples of 4, as `writeBuffer` requires), clears the flags and adds the bytes to the `uploadBytes` counter. This conservative policy is the v0.1 baseline; finer dirty ranges are an optimisation that may be added only with a test proving no stale bytes remain (blueprint §6.3).
- **Growth** allocates a new buffer, uploads the whole mirror, rebuilds every bind group that referenced the old buffer, then calls `destroy()` on the old buffer. WebGPU defers reclamation until previously submitted work completes, so in-flight frames are unaffected; growth happens before the current frame's encoding begins, so no new command references the old buffer.
- Material instances get one bind group each with a static offset (`{ buffer, offset: slot × slotStride, size: layout.size }`). Objects use one bind group per arena buffer with `hasDynamicOffset: true`, and `setBindGroup(2, bg, [slot × slotStride])` per draw.

### 8.2 Update semantics (blueprint §6.3)

- Writes from handlers and binding evaluation go to the mirror through the generated writers and mark the slot dirty. A binding whose new bytes equal the mirror's current bytes does **not** mark the slot dirty (compare the written range before writing — implemented as "write to a scratch block, compare, copy if different").
- All uploads for a frame happen in render phase 7, before `queue.submit` of that frame's command buffer. Nothing writes GPU memory during command encoding.
- Identical immutable instances (every param class `initial`, same material, byte-identical block) **may** share a slot, keyed by `(layout id, hash(bytes))` with full byte comparison on hash hit. Mutable instances never share. Counters report `sharedParamBlocks` and `ownedParamBlocks`.
- Changing a parameter value never creates a pipeline, shader module or bind group. Replacing a texture (v0.2) changes the bind group. Changing a layout means a different program (hot reload, `spec/runtime-abi.md` §11).

### 8.3 Limits checked at compile time

Against the target profile's limits (v0.1 profile `webgpu-core-2026` = WebGPU default limits): block `size ≤ maxUniformBufferBindingSize` (65 536) — else `E6001`; texture+sampler params per material ≤ 8 — else `E6002`; vertex outputs used ≤ `maxInterStageShaderVariables` (16) — else `E6003`. The runtime re-checks against the actual device and fails mount with `E8002` if the device is smaller than the profile.

## 9. Verification (the oracles)

9.1 **Golden layout tables.** Every fixture in §4.5 has a hand-checked expected table in `tests/gpu-layout/*.layout.json`. The engine's output must match exactly.

9.2 **Naga oracle (Rust test, no GPU).** For each fixture: emit the WGSL struct(s) plus a dummy `var<uniform>` and an entry point that reads every leaf; parse with the pinned Naga (`naga::front::wgsl::parse_str`), validate with `ValidationFlags::all()` (which includes `STRUCT_LAYOUTS`, the flag that enforces uniform layout rules); then read Naga's computed `StructMember.offset` for every member and the struct `span`, and assert they equal the record. A uniform-rule violation surfaces as `GlobalVariableError::Alignment` and fails the test.

9.3 **Independent JS encoder (Node, no GPU).** A test-only, data-driven encoder in `tests/codegen/` serialises sample values using only the layout record. For each fixture the generated writer and the independent encoder must produce byte-identical buffers, including zero padding.

9.4 **GPU probe (browser, real WebGPU).** For each fixture the generator also emits a **probe shader**: a full-viewport triangle into an `rgba32uint` target of width `ceil(leafWords / 4)` and height 1, whose fragment shader reads every leaf **through its typed WGSL path** (`mtek_params.b.y`, `mtek_params.weights[2].value`, …), converts it to bits (`bitcast<u32>(f32)`, `bitcast<u32>(i32)`, `u32`, bool as `select(0u, 1u, …)`), and writes the words in leaf order (pixel `p` holds words `4p … 4p+3`). The test uploads distinctive values (unique bit patterns, no NaN) through the generated writer, renders, copies the texture to a buffer (`bytesPerRow` padded to a multiple of 256), maps it and compares **bit-exactly** with the expected leaf values. A writer/reader offset disagreement cannot pass this test. This is the M0 exit-gate evidence (`spec/testing.md` §6.2).

## 10. Inspectability (`mtek inspect --bindings`)

For each material instance and built-in block: the source param (name, declared type, originating span), the logical slot (`group`, `binding`, field path), the physical layout (offset, size, WGSL representation, padding), stage visibility, update class (`initial | imperative | bound | resource`) with the binding's dependency list, and whether the instance's storage may be shared. JSON (`--format json`) uses the record format of §5 plus these fields; the human format is a table (field names, order and the human layout are decision 0044). The development overlay shows per-frame `uploadBytes`, `uploads`, `pipelinesCreated`, `bindGroupsCreated`, `buffersAllocated` and live resource counts (`spec/runtime-abi.md` §10).
