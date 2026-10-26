# Vertex deformation on authored characters

This correctness example reuses the repository's original pinned Fox and CesiumMan
GLBs. Preparation verifies their recorded SHA-256 hashes and copies them into the
ignored `models/` folder. It never changes the originals or the frozen animation
benchmark sources. From the repository root:

```powershell
node examples/vertex-deformation/verify-characters.mjs hardware target/character-check
node examples/vertex-deformation/verify-characters.mjs software target/character-check
```

Use a new output directory for each run: existing reports are never overwritten.
The compiler binary must already be built. `prepare-characters.mjs` can separately
build this source into ignored `.characters-out/`.

Each backend runs 32 image cases: Fox's Survey/Walk/Run and CesiumMan's animation_0,
two paused times, ordinary/stretched geometry, and shadows on/off. The authored
position/normal/UV output is compared to an ordinary object transform and a
separately mounted static mesh with CPU-skinned positions/normals. The latter
executes no GPU skinning or authored vertex stage for the reference character.
Fox has no authored normals, so it is textured/unlit; CesiumMan uses lit normals.
The images also prove animation and shadows change pixels. Every sampled final
CPU vertex must lie inside its declared local sphere.

Two additional native-material cases per backend render CesiumMan through its
original imported Pbr material and mixed min/mag sampler, again matching CPU
reference images.

Sixteen culling transitions, four device recoveries and twelve program
replacements per backend exercise lifecycle behavior. Replacements explicitly
reselect a paused pose; they do not claim animation-controller migration. Three
short replacement cycles include one warm-up and two observed resource counts.
Disposal must return tracked live GPU resources/listeners to zero.

A separate 36-case GPU probe compares imported mixed min/mag sampler resources
against explicit WebGPU settings, including controls that distinguish both
filters. All targets are small; there is no frame loop, sustained workload or
performance claim. This is one view and a bounded set of sampled poses, not
proof for every pose, rig, device or animation composition.

## Attribution

Originals come from KhronosGroup/glTF-Sample-Assets at commit
`8f492390ddc7a2ae221a1369ef560589cf8c70fb`. The existing
[provenance record](../../../benchmarks/runtime/animation/assets/provenance.json)
and upstream metadata/licenses are retained in the repository:

- Fox model: PixelMannen, CC0. Rigging/animation: tomkranis, CC BY 4.0.
  glTF conversion: @AsoboStudio and @scurest, CC BY 4.0.
  [Fox license](../../../benchmarks/runtime/animation/assets/Fox/LICENSE.md).
- CesiumMan: Cesium, CC BY 4.0; the Cesium mark notice is retained.
  [Model license](../../../benchmarks/runtime/animation/assets/CesiumMan/LICENSE.md)
  and [mark notice](../../../benchmarks/runtime/animation/assets/licenses/LicenseRef-LegalMark-Cesium.txt).

Full [CC BY 4.0](../../../benchmarks/runtime/animation/assets/licenses/CC-BY-4.0.txt)
and [CC0](../../../benchmarks/runtime/animation/assets/licenses/CC0-1.0.txt) texts
are available alongside those originals. Runtime skinning/stretching and UV
remapping are demonstrated here; the source GLB bytes remain unchanged.
