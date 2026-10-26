# 0058. The asset compiler: declarations, the static GLB profile, packaging and `inspect --assets`

Mixed min/mag sampler restrictions are superseded by [decision 0200](0200-independent-gltf-sampler-filters.md).
- Status: Accepted
- Date: 2026-10-18
- Blueprint origin: §7.3 (assets are explicit, typed, compile-time dependencies; nothing unsupported is partially ignored), §9.4 (diagnostics with validated edits), §13 (dependency policy); `spec/assets.md` (the whole document), `spec/materials.md` §3.1 and §5, `spec/manifest.schema.json` (`assets`, `meshes`, `resourceValue`), `spec/runtime-abi.md` §2 and §5, `spec/diagnostics.md` §5.7, `spec/tooling.md` §1 and §3; decisions 0007, 0015, 0030, 0054 (the pattern of lifting a gate ahead of the milestone gate).
- Amended by: decision 0082 (its proposed codes are final; EXIF-oriented JPEGs are `E7017`).

## Context

Task M4-05 is the compiler and command-line side of assets. `spec/assets.md` fixes the declarations, the profile table (§3), the packaging (§4) and the codes (§8). It leaves open how a file is read when the type checker meets `asset.glb("…")`, which problem has which code where the table has no row, what exactly is packaged and under which names, how a name in a GLB is looked up, and what the next task (M4-06, the runtime loader) can rely on. The guardrail of milestone M4 applies: **no broad glTF support is claimed from one file**. The profile is exactly the table of `spec/assets.md` §3, every row has a failing project, and every feature outside it is an error that names it.

Everything below is a **proposal** (design choice) unless it repeats the specification.

## Decision

### 1. Dependencies (decision 0007 table)

`gltf` **=1.4.1** with `default-features = false` and features `names` and `extras` (no `import`, so no `image`, `base64` or `urlencoding`; no `utils`; no `KHR_*` extension features), and `imagesize` **=0.15.0**, both normal dependencies of `mtek-compiler`, pinned with `=` like the other crates. New crates in `Cargo.lock`: `gltf`, `gltf-json`, `gltf-derive`, `imagesize`, `byteorder`, `inflections`, `lazy_static`. The compiler uses `gltf::json` (the typed JSON model and `Document::from_json`, which validates indices and enumerations) for the structure of the JSON chunk and `imagesize` for image headers; the container, the profile checks and everything after them are Mtek's own. The `extras` feature is on so that a custom attribute (`_BATCHID`) parses and is reported as `E7009` rather than as a malformed file. `cargo test --workspace --locked` and `--locked` builds pass.

### 2. Gate

As textures and samplers did (decision 0054), the rows are marked implemented by the current build (`since` `M1`; `CURRENT_MILESTONE` does not move): the namespace `asset` with `glb`, `texture`, `linear_texture`, the type `glb_asset` and its ten accessors. `lighting` and `Pbr` stay `M4` (task M4-03). `spec/stdlib-schema.json` was regenerated. The fixture `semantics/fail/gate_builtin_type` and the generator of `material_robustness.rs`, which used `glb_asset` as their example of a gated type, use `entity_ref` (M5).

### 3. Declarations

- `asset.glb`, `asset.texture` and `asset.linear_texture` are typed like any registry function and then handed to an **asset host** (`assets::AssetHost`, implemented by `AssetLoader`): `declare(module path, kind, string literal, span, sink)`. The path literal is resolved against the declaring module and read through the compiler's `Fs` trait, so the library still performs no I/O of its own (`tests/no_direct_io.rs`). `Fs` gained `len(path)` (the size of a file without reading it) with a default that reads; `MemFs`, `ProjectFs` and the CLI's `RealFs` override it.
- **A path that is not a string literal** (a `const` of type `string`, a parameter, an expression) is `E7022` at the argument: the file is opened while the program is checked.
- **Path rules**, in this order: a URL scheme (`http:`, `https:`, `data:`, any `scheme:` of two or more characters; a single letter is a drive) is `E7901`; an empty path, a backslash, an absolute path (`/…`, `C:…`), a control character, an empty segment or a path that climbs above the project root is `E7021`; for a `.glb` declaration an extension other than `.glb` (compared ignoring case) is `E7001` (`.gltf` says so in words); a file that exists only under another case is `E7023` and names the real spelling; a missing file, a directory or a read error is **`E7020`**.
- **`E7020` is a code this record adds** (title "asset file not found"). `spec/assets.md` §8 lists no code for a missing file, and the nearest ones (`E7021`, `E7023`) describe other problems; E7020 is the free number between `E7019` and `E7021`. `spec/assets.md` §8 and `spec/diagnostics.md` §5.7 list it. (A question about this was filed on the board.)
- A file is **read once per project path**, however many declarations name it. If it failed, the same issues are reported at **every** declaration that names it, each at its own path literal, so fixing the first does not hide the second.
- Diagnostics about a file are reported at the **span of the path literal** (the string with its quotes) of the declaration that first loaded it, with notes naming the file and the JSON location (`meshes[2].primitives[0]`).
- **`glb_asset` values** (`E7022`): a `glb_asset` may be the initialiser of a `const` (also an imported one) and the receiver of an accessor, directly (`asset.glb("a.glb").mesh("X")`) or through a constant. Anywhere else (a local, an argument, a field, a struct member, an operand, a parameter or field *type*) is `E7022`. A `model:` field of an entity is **`E7902`** instead of the unknown-field error (the value is not also reported).
- `texture`-typed asset values are ordinary constants. `asset.texture(path)` is sampled as sRGB, `asset.linear_texture(path)` as linear data.
- **Accessors.** `CHAIR.mesh("Seat")` is typed from the registry (`glb_asset` methods), checks its arguments like any registry function, and is evaluated while constants are folded, against the validated file. The result of each: `.mesh`/`.primitive` an asset mesh (`ConstValue::AssetMesh`), `.material_base_color` the **linear** `baseColorFactor`, `.material_metallic`/`.material_roughness` the factors, `.material_texture` the embedded base colour image (or `texture.white()`), `.node_*` the world transform, `.material` a `Pbr` instance with `base_color`, `metallic`, `roughness`, `base_color_texture` and `base_color_sampler`.
- **Names are looked up exactly** (case-sensitive) among the objects that have one. Unnamed objects cannot be referenced; the message counts them and says to name them in the authoring tool. A name used by **two or more** objects of its kind is `E7024` ("does not identify one"). Node names are looked up among the nodes of the **default scene** (`scene`, or the first scene when the file names none); a node that exists elsewhere is `E7024` with a note saying so.
- **`E7024`** lists up to 20 names of that kind, sorted, and "(and N more)". When exactly one name is within edit distance 2 the help says "did you mean"; a **suggested edit** replacing the string literal is attached only if the accessor, evaluated with that name, **succeeds** (so a rename to a mesh with several primitives, or to a node with a shear, is a hint but never an edit), and only if the argument is a string literal and the name needs no escape. A primitive index that is out of range is also `E7024` ("has 2 primitives, but primitive 2 was requested") and offers no rename.
- **`E7012`** (`.mesh` on a mesh whose primitive count is not one) names the count and suggests `.primitive("Name", 0)` to `.primitive("Name", n-1)`. A mesh with no primitives says so.
- **`E7013`** (node transforms). The world matrix of a node is the product of the local matrices from its scene root, computed in `f64` (a node with `matrix` uses it; one with translation, rotation and scale composes `T·R·S` with the quaternion normalised; a node with both `matrix` and TRS has no transform). It is decomposed into translation, a unit rotation quaternion with `w ≥ 0` and the three column lengths as scale. It is **not representable** (`E7013`, with the reason in the message) when: the last row is not `0 0 0 1` (tolerance `1e-6`); a column has length below `1e-9` (zero scale); two columns are not perpendicular (`|a·b| > 1e-4·|a||b|`, a shear, usually a non-uniform scale below a rotated parent); or the rotation has determinant −1 (a negative scale, a mirror). The tolerances exist because exporters round matrices to about seven digits.
- **`.material(name)`** produces a `Pbr` instance, so it needs the built-in `Pbr` (task M4-03). Until `Pbr` is implemented the call is `E9010` (the same message as writing `Pbr {}`); once it is, the call produces the instance with no change here (`tests/assets.rs` accepts both states, so merging M4-03 does not break it).

### 4. The static profile (`assets::read_glb`)

The file is validated **in full when it is declared**, not when a name is used: the profile table lists exactly what is not inspected (cameras, `extras`, unreferenced scenes), so everything else in the file is. A file with one unsupported mesh is rejected even if the program references another mesh; the message names the mesh. The checks run **in the order of the table** and every row reports all its violations; the issues are sorted by row. Rows 1 to 3 are *fatal*: nothing after a container, buffer or extension problem is interpreted (an extension changes what the data means).

| Row (spec/assets.md §3) | Check | Code |
|---|---|---|
| Container | file shorter than 12 bytes, wrong magic, version ≠ 2, total length ≠ file length, a chunk header or chunk cut off, a chunk length not a multiple of 4, first chunk not JSON, second JSON or BIN chunk, **any other chunk type** (stricter than glTF, which says to ignore unknown chunks: "nothing unsupported is partially ignored"), no JSON chunk, JSON that does not parse or is not glTF, `asset.version` not 2.x or `minVersion` above 2.0, an index or enumeration the `gltf` crate rejects (the message names the JSON path) | `E7001` |
| Container | a buffer or image with a `uri` (file or `data:`) | `E7003` |
| Container | a buffer other than 0 without a `uri`; buffer 0 without a `uri` and no BIN chunk | `E7001` |
| Size | file over `max_file_bytes` (checked with `Fs::len` **before** the file is read) | `E7002` |
| Size | JSON chunk over 16 MiB (checked on the chunk header, **before** the chunk is sliced or parsed) | `E7002` |
| Extensions | `extensionsRequired` not empty (lists them); `extensionsUsed` not empty **or any `extensions` object anywhere in the JSON** (lists those not already reported as required, and the first place) | `E7004`, `E7005` |
| Primitive mode | `mode` ≠ 4 | `E7006` |
| Attributes | `POSITION`, `NORMAL`, `TEXCOORD_0` not `FLOAT` `VEC3`/`VEC3`/`VEC2` or `normalized` | `E7007` |
| Attributes | `JOINTS_n`, `WEIGHTS_n`, morph `targets`, mesh `weights` | `E7008` |
| Attributes | `COLOR_n`, `TANGENT`, `TEXCOORD_n` with n ≥ 1, any custom `_NAME` attribute | `E7009` |
| Attributes | a primitive without `POSITION` | `E7010` (the title says "mesh lacks required attribute") |
| Limits | vertices of a primitive over `max_vertices_per_primitive` (checked from the `POSITION` accessor's count **before** any vertex is read) | `E7026` |
| Indices | accessor not `SCALAR` of `UNSIGNED_BYTE`/`SHORT`/`INT`, or normalised | `E7007` |
| Indices | an index at or above the vertex count (this includes the primitive-restart value 65535 on a small mesh), a count that is not a multiple of 3, a non-indexed primitive whose vertex count is not | `E7014` |
| Accessors | any sparse accessor of the file | `E7011` |
| Accessors | an accessor without a buffer view (zero-filled) | `E7011` |
| Accessors | a buffer view or accessor outside its buffer, a `byteStride` that is smaller than the element or not a multiple of 4 (or on an index view), an offset that is not a multiple of the component size, zero elements, an attribute whose count differs from `POSITION`'s, a non-finite value in `POSITION`, `NORMAL` or `TEXCOORD_0`, buffer 0 declaring more bytes than the BIN chunk holds | `E7025` |
| Materials | `alphaMode` ≠ OPAQUE; `baseColorFactor` alpha ≠ 1 | `E7015` |
| Materials | `metallicRoughnessTexture`, `normalTexture`, `occlusionTexture`, `emissiveTexture`, `emissiveFactor` ≠ 0, `doubleSided` (one message lists every feature found) | `E7016` |
| Materials | the base colour texture reads `texCoord` ≥ 1 | `E7009` |
| Images | no embedded bytes (`uri` is row 1's `E7003`); MIME type not `image/png`/`image/jpeg`; bytes that are not that format (header read with `imagesize`); a side of 0 or above `max_texture_dimension` | `E7017` |
| Images | a buffer view outside the BIN buffer | `E7025` |
| Samplers | `wrapS` or `wrapT` MIRRORED_REPEAT | `E7018` |
| Samplers | `wrapS` ≠ `wrapT`; magnification and minification filters (mip-map variants count as their base filter) that differ: **no sampler preset can express them** | `E7018` |
| Node transforms | per accessor, §3 item "`E7013`" above | `E7013` |
| Animations, skins | `animations` or `skins` not empty (one message gives the counts) | `E7019` |

At most 24 issues are reported per file; the last carries the note "N more problems in this file are not shown". The values the validator keeps are offsets into the BIN chunk, never copies of vertex data; the BIN chunk is kept (up to the declared length of buffer 0) for packaging.

Non-obvious consequences, all deliberate: a file with `JOINTS_0` and a `skins` array reports `E7008` for each attribute and `E7019` for the skin; `alphaCutoff` with OPAQUE is ignored by glTF itself and not an error; `metallicFactor`, `roughnessFactor` and the `baseColorFactor` components are taken as written (their ranges are not checked); a texture that is not referenced by any material is still checked as an image.

### 5. Mesh attributes against materials (`E7010`)

After type checking, every entity whose `mesh` is a GLB mesh is checked against its material (a user material, the built-in `Unlit`, or `Pbr` once it exists): the fragment stage's recorded `SurfaceInput` reads decide whether `TEXCOORD_0` (`uv`) and `NORMAL` (`world_normal`) are needed. A missing one is `E7010` at the entity's `mesh` member, with the material's declaration as a related span. Nothing is substituted: no zeros, no computed normals. `check` and `build` report it alike.

### 6. Packaging (`assets::pack`), the contract of M4-06

`mtek build` writes, for the entry scene, only what is referenced:

- **One `assets/<name>.bin` per referenced GLB**, with only the referenced primitives, in the order of glTF mesh index then primitive index (not the order of use, so reordering entities does not change the file). Per primitive, in this order, each section starting at a multiple of 4 bytes of the file: `position` (`f32 × 3` per vertex, tightly packed), `normal` (`f32 × 3`) if present, `uv` (`f32 × 2`) if present, then the indices: **`uint16` if the vertex count is at most 65 535, otherwise `uint32`**, padded at the end to a multiple of 4. All numbers are little-endian. Interleaved or strided sources are de-interleaved; `UNSIGNED_BYTE` indices are widened, `UNSIGNED_INT` indices on a small mesh are narrowed, a non-indexed primitive gets `0, 1, 2, …`. glTF conventions (right-handed, +Y up, counter-clockwise front faces, uv origin top-left) are Mtek's; **no conversion is applied**.
- **Images copied byte-for-byte** as `assets/<name>.png` or `.jpg`: the image of a referenced material's base colour texture, and every standalone `asset.texture`/`asset.linear_texture` that is used as a material param.
- **Nothing for an asset the scene does not reference.** A declared `glb_asset` whose meshes no entity draws, a texture no instance uses, produce no file and no entry.
- **The manifest.** `assets` has one entry per file, in this order: the `mesh-data` entries sorted by the project path of their GLB, then the `image` entries sorted by `url`.
  - `url` (`assets/<name>.<ext>`, relative to the program like `shaders[].url`), `sha256` (64 lowercase hex digits of the file's bytes), `bytes` (its length), `span` (the declaring `asset.*` call: the first declaration that named the file).
  - `mesh-data`: `primitives[]`, in file order, each with `source` (`file` the GLB's project path, `mesh` the glTF mesh name, `primitive` its index there), `vertexCount`, `indexCount`, `indexFormat` (`"uint16"` | `"uint32"`), `attributes` (a subset of `["position", "normal", "uv"]`, in that order), `offsets` (`position`, `normal`?, `uv`?, `indices`: **byte offsets from the start of the file**), `boundingSphere` (`center` and `radius`, **in the mesh's local space**; the center is the middle of the bounding box, the radius is rounded up to the next `f32` so that no vertex lies outside). `preprocessing`: one string per decision, each naming its primitive: `mesh 'Wedge' primitive 0: u8 indices widened to u16`, `… u32 indices narrowed to u16 (at most 65535 vertices)`, `… sequential indices generated`.
  - `image`: `colorSpace` (`"srgb"` for `asset.texture` and a material's base colour texture, `"linear"` for `asset.linear_texture`), `preprocessing` (`["mipmaps not generated"]` when the file's sampler asked for a mip-mapped minification filter, else `[]`).
  - **`meshes[]`** gains entries of kind `asset`: `{ "id": "mesh:N", "kind": "asset", "asset": <url of the mesh-data entry>, "primitive": <index into that entry's primitives> }`. Identical meshes share one id, as for built-in shapes. An entity's `mesh` is that id.
  - **Image resources.** A material instance's `texture` param whose value is an asset is `{ "name", "class": "resource", "value": { "kind": "asset", "asset": <url of the image entry> } }`. Its `sampler` param stays a built-in preset (`value.kind` `builtin`): a glTF sampler is mapped to the preset that expresses it (REPEAT/CLAMP_TO_EDGE and NEAREST/LINEAR, mip-map filters as their base filter, no sampler = `sampler.linear_repeat`), and anything that cannot be mapped is `E7018`.
- **File names are opaque.** `<name>` is the first 16 hex digits of the SHA-256 of: for a `.bin`, the GLB's project path, a zero byte and the file's bytes; for an image, the colour space name (`srgb`/`linear`), a zero byte and the image bytes. The same bytes in the other colour space are therefore a second file with its own entry (the manifest keeps the colour space per file), and two GLBs with equal packed bytes never share a name. The runtime must use `url` as given and verify `sha256` and `bytes`; it must not parse the name.
- **The build identity** (`buildId`) includes `(project path, sha256)` of every **source** asset file that was packaged (the GLBs and standalone images), next to the sources and `mtek.toml`, so a changed asset changes the id (`spec/runtime-abi.md` §5.3).
- **Limits.** The sizes of everything are computed before anything is copied; the sum of the packaged files over `max_total_bytes` is `E7026` at the declaration of the asset that crosses it. `build` computes it (it needs the referenced set); `check` does not.
- The vertex layout needed by a material is already in the manifest (`shaders[].vertexAttributes`, a subset of `position`, `normal`, `uv`); the compiler has proved (§5) that every asset mesh drawn with a material provides them.

### 7. `mtek inspect --assets`

`inspect --assets [--format human|json] [PATH]` packages the entry scene's assets with the same function as `build` and prints: per file the `url`, `sha256`, `bytes`, kind, colour space, the project files it comes from, **where it was declared** (`file:line:column`), the recorded preprocessing and, for mesh data, the primitives table (source, counts, index format, attributes, offsets); then the asset meshes of the manifest (`mesh:N` → `url`, primitive). JSON has the same content (keys in `camelCase`, the primitives exactly as the manifest has them). It reports `E7026` if the packaged assets are over the limit, and the errors of `check` otherwise.

### 8. Configuration (`mtek.toml [assets]`)

`max_file_bytes` (default 67 108 864, range 1 to 4 294 967 295), `max_total_bytes` (268 435 456; 1 to 17 179 869 184), `max_texture_dimension` (8 192; 1 to 8 192, the WebGPU default `maxTextureDimension2D` of the only target profile), `max_vertices_per_primitive` (4 194 304; 1 to 4 294 967 295). Out-of-range or mistyped values are `E9001` with the key path, as for the other tables.

### 9. Tests and fixtures

`tests/assets/tools/make-glb.mjs` writes every fixture from explicit data (vertex arrays, transforms, a 2×2 PNG with known texels, an 8×8 flat-grey JPEG, deflate level 9): `pass/assets_supported` (the multi-mesh `chair.glb`: interleaved, `u8`, `u32`, non-indexed and two-primitive meshes, nodes with TRS and a matrix, three materials, two standalone textures), `pass/assets_imported` (assets exported from one module and used in another), and 85 `fail/*` projects, one per row of the table (the table above names the fixture of each in `tests/assets/fail/e70xx_*`), per declaration rule and per limit, each with `expected.diag.json`. `node tests/assets/tools/make-glb.mjs --check` (part of `npm run check`) fails if a generated file differs from the script. `crates/mtek-compiler/tests/assets.rs` asserts the exact diagnostics (codes, spans, messages, notes, suggested edits), builds the supported project and checks the manifest against `spec/manifest.schema.json`, the layout byte by byte, the copied images, determinism under shuffled directory order, the build identity, the goldens of `inspect --assets` (`tests/assets/inspect/`) and that a suggested rename removes its diagnostic and adds none; `tests/assets_api.rs` covers the accessors, the host and the packer; `src/assets/glb/tests.rs` the reader. `tests/fixtures.rs` counts the asset fixtures for its "every catalogue code has a fixture" rule; `E7030` and `E7031` (produced by the runtime, task M4-06) are in its not-yet-implemented list.

### 10. Not in this record

Runtime loading, upload, hash verification and the observable asset state (`spec/assets.md` §5, task M4-06; the browser spec `tests/browser/specs/assets/` with it). The mesh-attribute check of materials that only exist at run time (none in v0.1). Draco, meshopt, KTX2/Basis, sparse accessors, morph targets, skins, animations, cameras, lights and KHR_materials_* are not supported and are reported, not skipped; supporting any of them is a new record.

## Consequences

- `spec/assets.md` §2, §3, §4, §6, §8, `spec/diagnostics.md` §5.7 (all new codes, plus the reserved range `E7032–E7099`), `spec/tooling.md` (`inspect --assets`, the `[assets]` keys), `spec/runtime-abi.md` §2 and §5 (the `assets/` files and the shape of the entries), `spec/manifest.schema.json` (descriptions only: the schema already allowed these shapes), `spec/stdlib.md` and `spec/testing.md` point here. `spec/decisions/0007-toolchain.md` lists the two crates.
- M4-06 implements §6 as written: fetch `url` with the program as base, check `bytes` and `sha256` (`E7030`), upload `mesh-data` regions as vertex and index buffers by the offsets given, create image textures in the colour space given from `image` entries (`E7031` on a decode failure), and attach the textures to instances whose param is `{ kind: "asset" }`. It may rely on every drawn asset mesh having the attributes its material reads (§5), on indices in the format named by `indexFormat`, and on the file names being opaque.
- When M4-03 merges, `glb_asset.material` starts to work; its test accepts either state. The `Pbr` material then also reads `uv` and `world_normal` (it passes the whole surface to `lighting.pbr`), so a GLB mesh without UVs or normals drawn with `Pbr` is `E7010`.
- A file that needs re-export (extensions, vertex colours, double-sided or blended materials, skins, animations) is rejected with the feature named. That limitation is documented rather than hidden (decision 0015).
