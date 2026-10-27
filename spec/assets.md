# Assets: Declarations, the Static GLB Profile, Packaging and Loading (v0.1, M4)

- Repository path: `spec/assets.md`
- Status: Normative for v0.1; implemented in M4. Implements blueprint §7.3 and the "explicit static GLB subset" of decision 0004. The compiler side (declarations, validation, packaging, `inspect --assets`) is task M4-05 and its details are decision 0058; the runtime side (§5) is task M4-06 and its details are decision 0060.
- Source facts: glTF 2.0 specification (https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html), verified 2026-10-03: GLB header = magic `0x46546C67`, version `2`, total length (little-endian `u32`s); chunks: JSON (`0x4E4F534A`, exactly once, first), BIN (`0x004E4942`, at most once); primitive `mode` defaults to 4 (TRIANGLES); `extensionsRequired` ⊆ `extensionsUsed`.

---

## 1. Principles

Assets are **explicit, typed, compile-time dependencies**. The compiler opens and validates every referenced file during `check`/`build`, so a misspelled mesh name or an unsupported feature is a compile error with a source span, not a black canvas. Nothing unsupported is partially ignored: a feature that would change what the referenced data looks like is an error; data the program does not reference (extra scenes, names, `extras`) is not inspected beyond structural validity.

## 2. Declaring assets

```mtek
const CHAIR = asset.glb("models/chair.glb");
const WOOD  = asset.texture("textures/wood.png");          // sRGB colour texture
const MASK  = asset.linear_texture("textures/mask.png");   // linear data texture

scene Configurator {
    state seat_color: color = #c0392b;
    camera Main { position: vec3(0.0, 1.2, 3.0); target: vec3(0.0, 0.6, 0.0); }
    entity Sun { light: DirectionalLight { intensity: 3.0 }; rotation: quat.euler(-0.9, 0.4, 0.0); }
    entity Seat {
        mesh: CHAIR.mesh("Seat");
        position: CHAIR.node_position("Seat");
        rotation: CHAIR.node_rotation("Seat");
        material: Pbr {
            base_color: bind(seat_color);
            roughness: CHAIR.material_roughness("Fabric");
            base_color_texture: CHAIR.material_texture("Fabric");
        };
    }
    entity Frame { mesh: CHAIR.mesh("Frame"); material: CHAIR.material("Oak"); }
}
```

- `asset.glb(path)`, `asset.texture(path)`, `asset.linear_texture(path)` are const-eligible built-ins whose argument must be a string literal. They produce opaque compile-time values of type `glb_asset` / `texture`. A `glb_asset` value may only be stored in a `const` and used through its accessors (`E7022` otherwise).
- **Paths** resolve relative to the declaring module, use `/`, must stay inside the project root (`E7021`), and must match file-system case exactly (`E7023`); a file that does not exist is `E7020`. Remote URLs are not supported in v0.1 (`E7901`; blueprint: remote loading is opt-in, and v0.1 does not offer the option). The path must be a string literal: the compiler opens the file while it checks the program (`E7022` otherwise).
- A file is read once per project path. Its problems are reported at the path literal of every declaration that names it.

### 2.1 `glb_asset` accessors (all const-eligible; names are checked against the file)

| Accessor | Result | Rules |
|---|---|---|
| `.mesh(name)` | `mesh` | glTF mesh by `name`; must have exactly one primitive (`E7012`, which lists the primitive count and suggests `.primitive`) |
| `.primitive(name, index)` | `mesh` | primitive `index` (integer literal) of the named mesh |
| `.material(name)` | `Pbr` instance (all params from the file) | glTF material by `name` |
| `.material_base_color(name)` | `color` | `baseColorFactor` (linear in glTF; alpha must be 1, `E7015`) |
| `.material_metallic(name)`, `.material_roughness(name)` | `f32` | factors |
| `.material_texture(name)` | `texture` | the material's `baseColorTexture` (`texture.white()` if absent) |
| `.node_position(name)`, `.node_rotation(name)`, `.node_scale(name)` | `vec3` / `quat` / `vec3` | the node's **world** transform in the default scene, decomposed into TRS; `E7013` if the world matrix has shear or non-positive scale (cannot be represented by an Mtek entity transform) |

An unknown name is `E7024`, listing the available names of that kind (up to 20) and, if exactly one is within edit distance 2, a validated rename edit: it is attached only if the accessor works with that name. Unnamed glTF objects cannot be referenced in v0.1 (the message counts them and suggests naming them in the authoring tool). A name that two objects of the same kind share is `E7024` too (it does not identify one object). Node names are looked up among the nodes of the default scene (`scene`, or the first scene). A primitive index outside the mesh is `E7024`. `E7013` is reported when the world matrix is not affine, has a column of zero length, has shear (columns not perpendicular within `1e-4`) or mirrors the model (negative determinant); the rotation is a unit quaternion with `w ≥ 0`.

`.material(name)` is a `Pbr` instance (task M4-03's built-in); its `base_color_sampler` is the preset that expresses the glTF sampler (§3, "Samplers").

Instantiating a whole node hierarchy (`model: CHAIR`) is not in v0.1 (`E7902`); entities reference meshes individually, which keeps every drawn object a named, inspectable entity.

## 3. The static GLB profile (v0.1)

| Area | Supported | Otherwise |
|---|---|---|
| Container | binary `.glb`, version 2, one JSON chunk, at most one BIN chunk; buffers without `uri` (the BIN chunk) | `.gltf`, external or data URIs: `E7001` / `E7003` |
| Size | file ≤ `[assets] max_file_bytes` (default 64 MiB); JSON chunk ≤ 16 MiB; validated **before** any large allocation | `E7002` |
| Extensions | none; `extensionsRequired` must be empty and `extensionsUsed` must be empty | `E7004` (required) / `E7005` (used), listing the extensions; the note suggests re-exporting without them |
| Primitive mode | 4 (TRIANGLES; default) | `E7006` |
| Attributes | `POSITION` (FLOAT VEC3, required), `NORMAL` (FLOAT VEC3), `TEXCOORD_0` (FLOAT VEC2), optional `TANGENT` (FLOAT VEC4, requires NORMAL, normalized xyz within 0.001 squared-length error, w exactly ±1) | invalid tangent frame `E7027`; normalised-integer or non-float formats `E7007`; `JOINTS_0`/`WEIGHTS_0` supported for validated skins (decision 0191); extra influence sets and morph targets `E7008`; `COLOR_0`, `TEXCOORD_1+` `E7009` |
| Indices | `UNSIGNED_SHORT`, `UNSIGNED_INT`; `UNSIGNED_BYTE` converted to `uint16` (**recorded preprocessing**); non-indexed primitives get sequential indices (**recorded preprocessing**) | index ≥ vertex count `E7014` |
| Accessors | bounds within buffer views and buffers; `byteStride` valid; finite `POSITION` values | sparse accessors `E7011`; out-of-bounds `E7025` |
| Materials | Core opaque metallic-roughness: base colour, metallic-roughness, normal, occlusion and emissive maps on UV0, with factors; decision 0194 | Non-OPAQUE alpha modes or base alpha ≠ 1 → `E7015`; `doubleSided: true` → `E7016`; nonzero texture UV set → `E7009` |
| Images | embedded in a buffer view, `image/png` or `image/jpeg`, each dimension ≤ 8 192; a JPEG without an EXIF orientation other than 1 | external images `E7003`; other formats, larger, or a JPEG with an EXIF orientation ≠ 1 (re-save it without the tag) `E7017` (decision 0082) |
| Samplers | `wrapS`/`wrapT` REPEAT or CLAMP_TO_EDGE; independent LINEAR or NEAREST mag/min filters, with the requested nearest/linear mip filter; non-mip filters clamp to level zero | MIRRORED_REPEAT or differing U/V wrap modes `E7018` |
| Node transforms | TRS or matrix | (decomposition rules in §2.1) |
| Animations, skins | LINEAR and STEP `translation`, `rotation` and `scale` channels, played by `clip` (decision 0156); skeletal hierarchies, four vertex influences and named clip transitions (decision 0191). An animation with no name is `animation_N` | invalid skin data or a duplicate name: `E7019` where the file is declared. A morph-weight channel, cubic spline, another path or interpolation, or a keyframe count outside 1…4096 makes that animation unplayable but does not fail the file: `E7019` is reported where a `clip` names it (decision 0174). Rotation outputs may be FLOAT or normalised BYTE/SHORT (dequantised as glTF specifies); translation, scale and times are FLOAT only (`E7025` otherwise) |
| Cameras, `extras`, unreferenced scenes | not inspected | — |

A referenced mesh lacking an attribute the chosen material reads (`uv`, `world_normal`) is `E7010` (`spec/materials.md` §3.1). Missing normals are **not** generated in v0.1.

Validation uses the `gltf` crate (1.4.x, its typed JSON model and `Document::from_json` validation) for structure, preceded by Mtek's own container checks and followed by Mtek's own profile checks above. Image headers are checked with `imagesize` (format and dimensions); full decoding happens in the browser (§5).

**How the table is applied (decision 0058).** The whole file is validated when it is declared: everything that is not listed as "not inspected" is inspected, whether or not the program uses it, and a violation names the mesh, material, image or sampler. Rows are checked in table order, each reports all its violations (at most 24 per file), and a container, buffer-URI or extension problem ends the validation (nothing after it can be interpreted). Details the table leaves open: an unknown chunk type, a second JSON or BIN chunk or a total length that differs from the file's is `E7001`; a primitive without `POSITION`, and a mesh that lacks an attribute its material reads, is `E7010`; an accessor without a buffer view is `E7011`; a non-finite value, a misaligned or out-of-range accessor, a bad `byteStride`, an attribute whose count differs from `POSITION`'s and a BIN chunk shorter than buffer 0 declares are `E7025`; a base colour texture that reads `TEXCOORD_1` or higher is `E7009`; a sampler whose `wrapS` and `wrapT` differ is `E7018`; specified min/mag filters are independent (decision 0200); a custom `_NAME` attribute is `E7009`; any `extensions` object, declared or not, is `E7005`.

## 4. Packaging (`mtek build`)

- For each referenced `glb_asset`, the compiler writes **one** `assets/<h16>.bin` containing only the referenced primitives, re-laid out for the runtime: per primitive, tightly packed `position` (f32×3), then `normal` (f32×3), `uv` (f32×2) and `tangent` (f32×4) if present, then indices (`uint16` if the vertex count ≤ 65 535, else `uint32`); each section 4-byte aligned. Numbers are little-endian; primitives are ordered by glTF mesh index and primitive index; the exact manifest shape and the file naming are in `spec/runtime-abi.md` §5.5 and decision 0058.
- Referenced images are copied byte-for-byte as `assets/<h16>.png|jpg`. Standalone `asset.texture` files likewise.
- The manifest `assets` table records for each file: `url`, full `sha256`, byte length, kind (`mesh-data` | `image`), colour space for images and, optionally, the author's file `source` (a project path, or `<glb path>#images[N]`; decision 0082), and, for mesh data, per primitive: offsets, counts, index format, attribute set, local bounding sphere, the source (`file`, glTF mesh name, primitive index) and the list of **preprocessing decisions** applied (e.g. `"u8 indices widened to u16"`, `"sequential indices generated"`, `"mipmaps generated at runtime"`).
- `mtek inspect --assets` prints this table with the declaring location of every file, and the meshes of the manifest that use them. Asset bytes are part of the build identity (`spec/runtime-abi.md` §5.3). Assets that no entity of the entry scene uses are not packaged.

## 5. Runtime loading (blueprint §7.3)

- Each asset has an observable state `pending → ready | failed`. `mountMtek` resolves only when every asset needed by the startup scene is `ready`.
- Fetch from `baseUrl` (same origin as `app.js`); verify byte length, and SHA-256 when `crypto.subtle` is available (secure contexts) — mismatch is a failure (`E7030`), never a silent use of stale bytes.
- Images: `createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" })`, then `copyExternalImageToTexture` into a texture of format `rgba8unorm-srgb` (colour textures) or `rgba8unorm` (linear textures) created with usage `TEXTURE_BINDING | COPY_DST | RENDER_ATTACHMENT` (the last two are required by `copyExternalImageToTexture`). Decode failure is `E7031` with the asset's declaring span.
- Mesh data: one buffer upload per `.bin` region (vertex buffers per attribute, index buffer), created inside an `out-of-memory` error scope (`E8063` on failure).
- Any failure rejects `mountMtek` with `kind: "asset-failed"` and the overlay names the file, the author's file for an image (`source`) and the source declaration. A missing file, invalid image or failed allocation never produces an unexplained black canvas.
- The size of every decoded image is re-checked against the device's `maxTextureDimension2D` (`E8002`, kind `device-failed`), and a mesh region against `maxBufferSize` (`E8063`), because the compiler could only check the configured limits (§6).
- The verified bytes stay with the application: the buffers and textures lost with a GPU device are rebuilt from them (images are decoded again) without a request, and a hot reload does not fetch an unchanged file again. How the loader, the diagnostics (which name the packaged file and the declaring `asset.*` path literal), the culling sphere of an asset mesh and the test hooks (`options.test.onAssetState`, `debug.assets()`) work is decision 0060.
- Production bundles reference only files in `dist/`; core runtime code never comes from a third-party CDN.

## 6. Limits (`mtek.toml [assets]`)

| Key | Default | Meaning |
|---|---|---|
| `max_file_bytes` | 67 108 864 | per asset file |
| `max_total_bytes` | 268 435 456 | all packaged assets |
| `max_texture_dimension` | 8 192 | per image side (≤ device `maxTextureDimension2D`, re-checked at mount: `E8002`) |
| `max_vertices_per_primitive` | 4 194 304 | |

Exceeding a limit is `E7002` (size) or `E7017` (texture) or `E7026` (vertices/total), always before allocating the data. `E7026` for the total is reported by `build` (it needs the referenced set), not by `check`.

## 7. Required tests

`tests/assets/` (compiler; `tests/assets/tools/make-glb.mjs` writes it, `--check` verifies it): a supported multi-mesh GLB (generated by a checked-in script from explicit vertex data — **not** a hand-picked download, so the expected values are known), a supported LINEAR translation clip (`pass/animated_clip`, decision 0156), plus one malformed or unsupported file per rejected row of §3 (truncated header, wrong magic, JSON chunk not first, external URI, required extension, used extension, mode 1 lines, skin, sparse accessor, index out of range, normalised texcoords, non-opaque material, invalid texture UV set, double-sided, oversized image), each with its exact diagnostic. `tests/browser/specs/m4/assets.spec.ts` (fixtures `tests/browser/fixtures/m4/assets_scene` and `assets_corrupt`, also written by `make-glb.mjs`): the supported file renders correctly (pixel assertions against known geometry and colours), a missing file, a changed file, a truncated file and a corrupted image fail mount visibly with the documented diagnostics, and a lost device recovers with its assets. Do not declare broad glTF support from one file (blueprint M4 guardrail): the documentation lists exactly the profile above.

## 8. Asset diagnostic codes (added to `spec/diagnostics.md` §5.7 in M4)

`E7001` unsupported container (`.gltf`) · `E7002` asset too large · `E7003` external or data URI · `E7004` required extension · `E7005` used extension · `E7006` unsupported primitive mode · `E7007` unsupported attribute format · `E7008` unsupported influence sets or morph targets · `E7009` unsupported vertex attribute · `E7010` mesh lacks required attribute · `E7011` sparse accessor · `E7012` mesh has several primitives · `E7013` node transform not representable · `E7014` index out of range · `E7015` transparency in material · `E7016` unsupported material feature · `E7017` unsupported or oversized image · `E7018` unsupported sampler mode · `E7019` invalid skin or unsupported animation · `E7020` asset file not found · `E7021` asset path outside project · `E7022` invalid use of asset value · `E7023` asset path case mismatch · `E7024` unknown name in asset · `E7025` accessor out of bounds · `E7026` asset limit exceeded · `E7027` invalid tangent frame · `E7028` clips_from cannot supply clips (decision 0223) · `E7030` asset fetch or integrity failure (runtime) · `E7031` image decode failure (runtime) · `E7901` remote assets not supported · `E7902` node hierarchy instancing not supported.

### Textures used by spawned prefabs

The runtime uploads textures referenced only by prefab materials during scene
startup, before the host closes decoded image bitmaps. Subsequent spawns reuse
the scene texture cache, including after a prefab is destroyed and spawned again.
The scene owns these GPU textures and releases them on disposal; device recovery
recreates them from verified asset bytes through the normal startup path.
