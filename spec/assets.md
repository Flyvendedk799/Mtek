# Assets: Declarations, the Static GLB Profile, Packaging and Loading (v0.1, M4)

- Repository path: `spec/assets.md`
- Status: Normative for v0.1; implemented in M4. Implements blueprint §7.3 and the "explicit static GLB subset" of decision 0004.
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
- **Paths** resolve relative to the declaring module, use `/`, must stay inside the project root (`E7021`), and must match file-system case exactly (`E7023`). Remote URLs are not supported in v0.1 (`E7901`; blueprint: remote loading is opt-in, and v0.1 does not offer the option).

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

An unknown name is `E7024`, listing the available names of that kind (up to 20) and, if exactly one is within edit distance 2, a validated rename edit. Unnamed glTF objects cannot be referenced in v0.1 (the message says so and suggests naming them in the authoring tool).

Instantiating a whole node hierarchy (`model: CHAIR`) is not in v0.1 (`E7902`); entities reference meshes individually, which keeps every drawn object a named, inspectable entity.

## 3. The static GLB profile (v0.1)

| Area | Supported | Otherwise |
|---|---|---|
| Container | binary `.glb`, version 2, one JSON chunk, at most one BIN chunk; buffers without `uri` (the BIN chunk) | `.gltf`, external or data URIs: `E7001` / `E7003` |
| Size | file ≤ `[assets] max_file_bytes` (default 64 MiB); JSON chunk ≤ 16 MiB; validated **before** any large allocation | `E7002` |
| Extensions | none; `extensionsRequired` must be empty and `extensionsUsed` must be empty | `E7004` (required) / `E7005` (used), listing the extensions; the note suggests re-exporting without them |
| Primitive mode | 4 (TRIANGLES; default) | `E7006` |
| Attributes | `POSITION` (FLOAT VEC3, required), `NORMAL` (FLOAT VEC3), `TEXCOORD_0` (FLOAT VEC2) | normalised-integer or non-float formats `E7007`; `JOINTS_n`/`WEIGHTS_n`/morph targets (skinning) `E7008`; `COLOR_0`, `TANGENT`, `TEXCOORD_1+` `E7009` |
| Indices | `UNSIGNED_SHORT`, `UNSIGNED_INT`; `UNSIGNED_BYTE` converted to `uint16` (**recorded preprocessing**); non-indexed primitives get sequential indices (**recorded preprocessing**) | index ≥ vertex count `E7014` |
| Accessors | bounds within buffer views and buffers; `byteStride` valid; finite `POSITION` values | sparse accessors `E7011`; out-of-bounds `E7025` |
| Materials | `pbrMetallicRoughness.baseColorFactor` (alpha 1), `baseColorTexture` (`texCoord` 0), `metallicFactor`, `roughnessFactor`; `alphaMode` OPAQUE | `alphaMode` ≠ OPAQUE or base alpha ≠ 1 `E7015`; `metallicRoughnessTexture`, `normalTexture`, `occlusionTexture`, `emissiveTexture`, non-zero `emissiveFactor`, `doubleSided: true` → `E7016` listing each feature |
| Images | embedded in a buffer view, `image/png` or `image/jpeg`, each dimension ≤ 8 192 | external images `E7003`; other formats or larger `E7017` |
| Samplers | `wrapS`/`wrapT` REPEAT or CLAMP_TO_EDGE; mag/min filter LINEAR or NEAREST; mip-map min filters use the base level (no mips are generated in v0.1 — **recorded**) | MIRRORED_REPEAT `E7018` |
| Node transforms | TRS or matrix | (decomposition rules in §2.1) |
| Animations, skins | — | present in the file: `E7019` |
| Cameras, `extras`, unreferenced scenes | not inspected | — |

A referenced mesh lacking an attribute the chosen material reads (`uv`, `world_normal`) is `E7010` (`spec/materials.md` §3.1). Missing normals are **not** generated in v0.1.

Validation uses the `gltf` crate (1.4.x, `Gltf::from_slice` with validation) for structure, followed by Mtek's own profile checks above. Image headers are checked with `imagesize` (format and dimensions); full decoding happens in the browser (§5).

## 4. Packaging (`mtek build`)

- For each referenced `glb_asset`, the compiler writes **one** `assets/<h16>.bin` containing only the referenced primitives, re-laid out for the runtime: per primitive, tightly packed `position` (f32×3), then `normal` (f32×3) and `uv` (f32×2) if present, then indices (`uint16` if the vertex count ≤ 65 535, else `uint32`); each section 4-byte aligned.
- Referenced images are copied byte-for-byte as `assets/<h16>.png|jpg`. Standalone `asset.texture` files likewise.
- The manifest `assets` table records for each file: `url`, full `sha256`, byte length, kind (`mesh-data` | `image`), colour space for images, and, for mesh data, per primitive: offsets, counts, index format, attribute set, local bounding sphere, the source (`file`, glTF mesh name, primitive index) and the list of **preprocessing decisions** applied (e.g. `"u8 indices widened to u16"`, `"sequential indices generated"`, `"mipmaps not generated"`).
- `mtek inspect --assets` (M4) prints this table. Asset bytes are part of the build identity (`spec/runtime-abi.md` §5.3).

## 5. Runtime loading (blueprint §7.3)

- Each asset has an observable state `pending → ready | failed`. `mountMtek` resolves only when every asset needed by the startup scene is `ready`.
- Fetch from `baseUrl` (same origin as `app.js`); verify byte length, and SHA-256 when `crypto.subtle` is available (secure contexts) — mismatch is a failure (`E7030`), never a silent use of stale bytes.
- Images: `createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" })`, then `copyExternalImageToTexture` into a texture of format `rgba8unorm-srgb` (colour textures) or `rgba8unorm` (linear textures) created with usage `TEXTURE_BINDING | COPY_DST | RENDER_ATTACHMENT` (the last two are required by `copyExternalImageToTexture`). Decode failure is `E7031` with the asset's declaring span.
- Mesh data: one buffer upload per `.bin` region (vertex buffers per attribute, index buffer), created inside an `out-of-memory` error scope (`E8063` on failure).
- Any failure rejects `mountMtek` with `kind: "asset-failed"` and the overlay names the file and the source declaration. A missing file, invalid image or failed allocation never produces an unexplained black canvas.
- Production bundles reference only files in `dist/`; core runtime code never comes from a third-party CDN.

## 6. Limits (`mtek.toml [assets]`)

| Key | Default | Meaning |
|---|---|---|
| `max_file_bytes` | 67 108 864 | per asset file |
| `max_total_bytes` | 268 435 456 | all packaged assets |
| `max_texture_dimension` | 8 192 | per image side (≤ device `maxTextureDimension2D`, re-checked at mount: `E8002`) |
| `max_vertices_per_primitive` | 4 194 304 | |

Exceeding a limit is `E7002` (size) or `E7017` (texture) or `E7026` (vertices/total), always before allocating the data.

## 7. Required tests

`tests/assets/` (compiler): a supported multi-mesh GLB (generated by a checked-in script from explicit vertex data — **not** a hand-picked download, so the expected values are known), plus one malformed or unsupported file per row of §3 (truncated header, wrong magic, JSON chunk not first, external URI, required extension, used extension, mode 1 lines, skin, sparse accessor, index out of range, normalised texcoords, non-opaque material, normal texture, double-sided, oversized image, animation), each with its exact diagnostic. `tests/browser/specs/assets/`: the supported file renders correctly (pixel assertions against known geometry and colours); a missing file and a corrupted image fail mount visibly with the documented diagnostics. Do not declare broad glTF support from one file (blueprint M4 guardrail): the documentation lists exactly the profile above.

## 8. Asset diagnostic codes (added to `spec/diagnostics.md` §5.7 in M4)

`E7001` unsupported container (`.gltf`) · `E7002` asset too large · `E7003` external or data URI · `E7004` required extension · `E7005` used extension · `E7006` unsupported primitive mode · `E7007` unsupported attribute format · `E7008` skinning or morph targets · `E7009` unsupported vertex attribute · `E7010` mesh lacks required attribute · `E7011` sparse accessor · `E7012` mesh has several primitives · `E7013` node transform not representable · `E7014` index out of range · `E7015` transparency in material · `E7016` unsupported material feature · `E7017` unsupported or oversized image · `E7018` unsupported sampler mode · `E7019` animation present · `E7021` asset path outside project · `E7022` invalid use of asset value · `E7023` asset path case mismatch · `E7024` unknown name in asset · `E7025` accessor out of bounds · `E7026` asset limit exceeded · `E7030` asset fetch or integrity failure (runtime) · `E7031` image decode failure (runtime) · `E7901` remote assets not supported · `E7902` node hierarchy instancing not supported.
