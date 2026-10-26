# Authored vertex translation

`scene/src/main.mtek` writes a real Mtek `vertex(input: VertexInput) -> vec3`
stage. It translates mesh-local positions and reads a level-zero texture. The
mesh origins lie outside the camera. The runtime keeps the authored geometry
visible, renders its matching directional shadow and can instance the two static
boxes. Translation preserves the existing normals.

Build the current runtime and compiler, then open the example:

```powershell
npm run build -w @mtek/runtime-web
cargo build -p mtek-cli --locked -j 2
node examples/vertex-deformation/serve.mjs
```

The server prints its local URL (port 5187). Controls render one frame per change;
the example has no continuous GPU loop. The reference checkbox substitutes ordinary
object transforms with the same fragment lighting.

Small correctness checks (97 × 97 pixels, 12 cases per backend, serial):

```powershell
node examples/vertex-deformation/verify.mjs hardware target/vertex-check
node examples/vertex-deformation/verify.mjs software target/vertex-check
```

Each report refuses to overwrite prior evidence. Cases compare authored/reference
pixels, prove geometry and shadows affect the image, check the instanced entry,
retain off-camera source bounds and release tracked resources. These are
correctness checks, with no performance claims or sustained benchmark load.

The compatible first example returns only local position. The [structured example](structured/src/main.mtek) also updates normals/UVs and carries typed payloads. The [bounded example](bounds/src/main.mtek) supplies final local spheres. Mtek compute stages and broader skin/device evidence remain outstanding in the
[shader-authoring plan](../../evidence/platform-step/shader-authoring-plan.md).

## Structured output and payload checks

The structured source rotates vertices and normals, changes UVs, interpolates
float/color data and carries flat signed/unsigned/boolean/quaternion fields.
Values differ between triangle vertices, testing first-vertex behavior against
an ordinary rotation reference as well as geometry, lighting and shadows.

```powershell
node examples/vertex-deformation/verify.mjs hardware target/structured-check structured
node examples/vertex-deformation/verify.mjs software target/structured-check structured
```

The checks build `structured/` into ignored `.structured-out/`. With the example
server running, its generated page is at `/.structured-out/index.html`.
The full type/linkage contract is [decision 0198](../../spec/decisions/0198-typed-vertex-outputs-and-varyings.md).

## Authored finite bounds

The `bounds/` source binds `bounds_center` to the same displacement as its material
and supplies a radius enclosing the rotated unit box. The separate verifier checks
camera exits/reentries with fixed object transforms, radius-zero fallback,
instancing, shadows, nondefault-input recovery and program replacement:

```powershell
node examples/vertex-deformation/verify-bounds.mjs hardware target/bounds-check
node examples/vertex-deformation/verify-bounds.mjs software target/bounds-check
```

It builds ignored `.bounds-out/`. Each backend runs 12 image cases, 20 bounds
transitions, four recovery cases and 24 replacements. These are small correctness
checks, not performance measurements. Bounds are an explicit enclosure promise;
include every skin pose and displacement. See [decision 0199](../../spec/decisions/0199-authored-deformation-bounds.md).

## Authored characters

The [character example](characters/README.md) reuses the original pinned Fox and
CesiumMan assets. It compares authored deformation after skinning to ordinary
object transforms and CPU-skinned static meshes, including shadows, finite bounds,
recovery and replacement. It also checks CesiumMan's native material and imported
mixed-filter samplers. Run the small manual-clock correctness matrix with:

```powershell
node examples/vertex-deformation/verify-characters.mjs hardware target/character-check
node examples/vertex-deformation/verify-characters.mjs software target/character-check
npx tsc -p examples/vertex-deformation/tsconfig.json
```
