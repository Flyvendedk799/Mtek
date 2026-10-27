# Authored character cohorts

Build the current runtime/CLI, then run this from the repository root:

```sh
npm run build -w @mtek/runtime-web
cargo build -p mtek-cli --locked -j 2
node examples/vertex-deformation/cohorts/serve.mjs
```

Open [the demo](http://127.0.0.1:5188/). Choose Fox or CesiumMan, 1/10/50 actors,
pose groups, shared/independent animation data, proportions, directional shadow
quality and authored/ordinary-transform rendering. Pause freezes the entire
application. Changing population or rendering rebuilds the mount and releases
the previous one. The first source update creates the selected single-entity
prefabs, after initial host inputs are applied. Nested prefab assemblies remain
static-only under the current language contract.

Within a cohort, evaluation/palette/deformed geometry is shared. Each actor keeps
its world transform, authored final-local sphere and material stage. Fox has no
authored normals and uses an unlit textured stage; CesiumMan also stretches normals
by the inverse local scale before ordinary model normal transforms. Both remap UVs
and pass a typed mask to their fragment stage. The reference uses fragment-only
materials and equivalent object transforms. Source bounds promise an enclosure;
they are not compiler proofs for arbitrary future shader arithmetic.

The demo's draw counters are observations, not whole-frame timing evidence. Shared
pose groups reduce compatible colour draws. The current directional shadow pass
still submits individual casters; this example does not claim shadow instancing.
Separate independent animation benchmark definitions and original assets stay frozen.

## Correctness checks

```sh
npx tsc --noEmit -p examples/vertex-deformation/tsconfig.json
node examples/vertex-deformation/verify-cohorts.mjs hardware target/cohort-check
node examples/vertex-deformation/verify-cohorts.mjs software target/cohort-check
```

Reports are exclusive: use a fresh directory rather than overwriting prior runs.
Each backend checks both assets at 1/10/50 actors with 1/1/5 distinct sampled pose
groups, with and without low-quality shadows. It compares independent players,
shared individual draws, shared instanced draws, ordinary-transform GPU references
and CPU-skinned fragment-only references. Each CPU pose group has its own immutable
baked geometry; the reference harness routes the compiled scene's reference spawns
to those meshes. It reads sampled animation palettes, never GPU-skinned output.
The example itself uses only the public host/extension API and ordinary source builds.

Checks require visible character pixels against a floor-only control, distinct
pose-group palettes, sampled containment in authored spheres, expected draw-count
reductions, held detach/rejoin equality, resource plateaus, exact recovery and
zero ownership counters at disposal. The verifier also exercises the live demo's
population/group/character selectors, pause and reference rebuild. These are small
correctness targets and bounded sampled poses; broader animation compositions,
performance and wider physical-device tiers require their own evidence.

## Original assets and attribution

Preparation verifies and copies the unmodified originals from
KhronosGroup/glTF-Sample-Assets commit `8f492390ddc7a2ae221a1369ef560589cf8c70fb`.
[Pinned provenance](../../../benchmarks/runtime/animation/assets/provenance.json)
and upstream licences remain alongside them:

- Fox model: PixelMannen, CC0. Rigging/animation: tomkranis, CC BY 4.0.
  glTF conversion: @AsoboStudio and @scurest, CC BY 4.0.
  [Fox licence](../../../benchmarks/runtime/animation/assets/Fox/LICENSE.md).
- CesiumMan: Cesium, CC BY 4.0, with retained mark notice.
  [Model licence](../../../benchmarks/runtime/animation/assets/CesiumMan/LICENSE.md)
  and [mark notice](../../../benchmarks/runtime/animation/assets/licenses/LicenseRef-LegalMark-Cesium.txt).

[CC BY 4.0](../../../benchmarks/runtime/animation/assets/licenses/CC-BY-4.0.txt) and
[CC0](../../../benchmarks/runtime/animation/assets/licenses/CC0-1.0.txt) full texts
are retained. GPU/CPU deformation shown here does not edit the upstream GLBs.
