# Asset import and usage audit

Audit outcome: **passed** (corpus-expectations). Compiler unchanged: true. Corpus-expectation success includes expected rejections; it is not a claim that every asset is supported.

This report uses an existing compiler binary. It does not build the compiler, convert source assets, fetch remote resources or render a scene. Inventory is descriptive metadata; compiler diagnostics determine each requested check.

A passed declaration import is not full compatibility: unsupported clips can be ignored until used. Named mesh/material/clip probes are reported separately. No-probe entries leave usage untested. Build-time packed totals, runtime/device limits and visual quality remain untested.

| Asset | Declaration import | Usage probes | Input unchanged |
|---|---|---|---|
| fox-original | passed | survey: passed; walk: passed; run: passed | true |
| cesium-man-original | rejected (MTEK-E7018) | not requested | true |
| pbr-all-maps | passed | mesh-and-material: passed | true |
| emissive-factor | passed | mesh-and-material: passed | true |
| normal-map | passed | mesh-and-material: passed | true |
| linear-animation | passed | clip: passed | true |
| cubic-animation-use | passed | cubic-clip: rejected | true |
| multiple-primitives | passed | ambiguous-mesh: rejected; explicit-primitive: passed | true |
| morph-targets | rejected (MTEK-E7008) | not requested | true |
| sparse-accessor | rejected (MTEK-E7011) | not requested | true |
| used-extension | rejected (MTEK-E7005) | not requested | true |
| required-extensions | rejected (MTEK-E7004, MTEK-E7005) | not requested | true |
| external-buffer | rejected (MTEK-E7003) | not requested | true |
| data-uri | rejected (MTEK-E7003) | not requested | true |
| mixed-filters | rejected (MTEK-E7018) | not requested | true |
| truncated-header | rejected (MTEK-E7001) | not requested | true |

## fox-original

Source: ../../benchmarks/runtime/animation/assets/Fox/Fox.glb. SHA-256: d97044e701822bac5a62696459b27d7b375aada5de8574ed4362edbba94771f7.
Provenance: KhronosGroup/glTF-Sample-Assets @ 8f492390ddc7a2ae221a1369ef560589cf8c70fb; original Fox authors/licenses in benchmarks/runtime/animation/assets/Fox/.
Metadata: meshes=1, primitives=1, skins=1, joints=24, animations=3, materials=1, images=1, morphPrimitives=0, sparseAccessors=0, externalReferences=0.
attributes: JOINTS\_0, POSITION, TEXCOORD\_0, WEIGHTS\_0.
interpolations: LINEAR.
- No build, packaged-byte budget, rendered pixels or runtime/device validation was performed.

## cesium-man-original

Source: ../../benchmarks/runtime/animation/assets/CesiumMan/CesiumMan.glb. SHA-256: b7001eaeea8254bd44773bcd247e78696d94169388fbb2a1800fc69434e777d9.
Provenance: KhronosGroup/glTF-Sample-Assets @ 8f492390ddc7a2ae221a1369ef560589cf8c70fb; Cesium CC BY 4.0 and retained mark notice.
Metadata: meshes=1, primitives=1, skins=1, joints=19, animations=1, materials=1, images=1, morphPrimitives=0, sparseAccessors=0, externalReferences=0.
attributes: JOINTS\_0, NORMAL, POSITION, TEXCOORD\_0, WEIGHTS\_0.
interpolations: LINEAR.
- declaration · MTEK-E7018: The sampler at samplers\[0\] filters magnification LINEAR and minification NEAREST; the sampler presets use one filter for both.
  - the problem is in the file 'models/model.glb'
- No mesh/material/clip use was requested. Import success alone is not full asset compatibility.
- No build, packaged-byte budget, rendered pixels or runtime/device validation was performed.

## pbr-all-maps

Source: ../../tests/assets/pass/pbr\_all\_maps/models/model.glb. SHA-256: 61022506daffb2226c4f21f9327d6f2d77222506446e5dda53c32e44abea73ae.
Provenance: Repository-generated fixture; tests/assets/tools/make-glb.mjs.
Metadata: meshes=1, primitives=1, skins=0, joints=0, animations=0, materials=1, images=2, morphPrimitives=0, sparseAccessors=0, externalReferences=0.
attributes: NORMAL, POSITION, TEXCOORD\_0.
- No build, packaged-byte budget, rendered pixels or runtime/device validation was performed.

## emissive-factor

Source: ../../tests/assets/pass/pbr\_emissive\_factor/models/model.glb. SHA-256: d9ca23883f0a0f01bf5d40be2bbe71b96608fabe009e23ac5d78703aa68bf4db.
Provenance: Repository-generated fixture; tests/assets/tools/make-glb.mjs.
Metadata: meshes=1, primitives=1, skins=0, joints=0, animations=0, materials=1, images=0, morphPrimitives=0, sparseAccessors=0, externalReferences=0.
attributes: NORMAL, POSITION, TEXCOORD\_0.
- No build, packaged-byte budget, rendered pixels or runtime/device validation was performed.

## normal-map

Source: ../../tests/assets/pass/pbr\_normal\_texture/models/model.glb. SHA-256: aa2c238eb5c376e5f7e8af337a5f4a81b02ae14eb248c9fddf36764b5be3e012.
Provenance: Repository-generated fixture; tests/assets/tools/make-glb.mjs.
Metadata: meshes=1, primitives=1, skins=0, joints=0, animations=0, materials=1, images=1, morphPrimitives=0, sparseAccessors=0, externalReferences=0.
attributes: NORMAL, POSITION, TEXCOORD\_0.
- No build, packaged-byte budget, rendered pixels or runtime/device validation was performed.

## linear-animation

Source: ../../tests/assets/pass/animated\_clip/models/model.glb. SHA-256: 3bba29147952abb3a355373178b86a9d2b3350d20a94980c77fc6fe27121ad00.
Provenance: Repository-generated fixture; tests/assets/tools/make-glb.mjs.
Metadata: meshes=1, primitives=1, skins=0, joints=0, animations=1, materials=1, images=0, morphPrimitives=0, sparseAccessors=0, externalReferences=0.
attributes: NORMAL, POSITION, TEXCOORD\_0.
interpolations: LINEAR.
- No build, packaged-byte budget, rendered pixels or runtime/device validation was performed.

## cubic-animation-use

Source: ../../tests/assets/pass/animation\_unused\_cubic/models/model.glb. SHA-256: b7e22e72013cc73b6b8475ebf110f63f311366f7efb52582c36cd40ab8331917.
Provenance: Repository-generated fixture; tests/assets/tools/make-glb.mjs.
Metadata: meshes=1, primitives=1, skins=0, joints=0, animations=1, materials=1, images=0, morphPrimitives=0, sparseAccessors=0, externalReferences=0.
attributes: NORMAL, POSITION, TEXCOORD\_0.
interpolations: CUBICSPLINE.
- cubic-clip · MTEK-E5016: The clip 'animation\_0' cannot play on the mesh 'Tri' of 'models/model.glb'.
  - help: 'models/model.glb' has no animation a clip can play
- No build, packaged-byte budget, rendered pixels or runtime/device validation was performed.

## multiple-primitives

Source: ../../tests/assets/fail/e7012\_several\_primitives/models/chair.glb. SHA-256: b4cdc64a8f322599fdb414b80c592a3b176ce1abca60aa91eb2713f8b73a65d4.
Provenance: Repository-generated fixture; tests/assets/tools/make-glb.mjs.
Metadata: meshes=5, primitives=6, skins=0, joints=0, animations=0, materials=3, images=2, morphPrimitives=0, sparseAccessors=0, externalReferences=0.
attributes: NORMAL, POSITION, TEXCOORD\_0.
- ambiguous-mesh · MTEK-E7012: The mesh 'Twin' of 'models/model.glb' has 2 primitives; \`.mesh\` needs exactly one.
  - a glTF primitive has one material; v0.1 draws each primitive as its own entity
  - help: pick one with \`.primitive("Twin", 0)\` to \`.primitive("Twin", 1)\`
- No build, packaged-byte budget, rendered pixels or runtime/device validation was performed.

## morph-targets

Source: ../../tests/assets/fail/e7008\_morph\_targets/models/model.glb. SHA-256: b4dedbc4f799daf2c7bb0898de9d909aecf77f475596b4e9ac249d11bdd6c433.
Provenance: Repository-generated fixture; tests/assets/tools/make-glb.mjs.
Metadata: meshes=1, primitives=1, skins=0, joints=0, animations=0, materials=1, images=0, morphPrimitives=1, sparseAccessors=0, externalReferences=0.
attributes: NORMAL, POSITION, TEXCOORD\_0.
- declaration · MTEK-E7008: The mesh 'Tri' (meshes\[0\]) has default morph target weights; the profile does not support morph targets.
  - the problem is in the file 'models/model.glb'
- declaration · MTEK-E7008: The mesh 'Tri' (meshes\[0\]), primitive 0 has morph targets; the profile does not support them.
  - the problem is in the file 'models/model.glb'
- No mesh/material/clip use was requested. Import success alone is not full asset compatibility.
- No build, packaged-byte budget, rendered pixels or runtime/device validation was performed.

## sparse-accessor

Source: ../../tests/assets/fail/e7011\_sparse\_accessor/models/model.glb. SHA-256: 9f70b89031dc91b779c34dc9da0cb0f9211162d1f4a7f5bfeedcc82c215c171c.
Provenance: Repository-generated fixture; tests/assets/tools/make-glb.mjs.
Metadata: meshes=1, primitives=1, skins=0, joints=0, animations=0, materials=1, images=0, morphPrimitives=0, sparseAccessors=1, externalReferences=0.
attributes: NORMAL, POSITION, TEXCOORD\_0.
- declaration · MTEK-E7011: The accessor accessors\[4\] is sparse; the profile does not support sparse accessors.
  - the problem is in the file 'models/model.glb'
  - help: re-export the model without sparse accessors (for example without morph targets)
- No mesh/material/clip use was requested. Import success alone is not full asset compatibility.
- No build, packaged-byte budget, rendered pixels or runtime/device validation was performed.

## used-extension

Source: ../../tests/assets/fail/e7005\_used\_extension/models/model.glb. SHA-256: 328379bf2f85e8c4534a79d2ebd5df7a604f458172edcee5cf8278324e93759c.
Provenance: Repository-generated fixture; tests/assets/tools/make-glb.mjs.
Metadata: meshes=1, primitives=1, skins=0, joints=0, animations=0, materials=1, images=0, morphPrimitives=0, sparseAccessors=0, externalReferences=0.
attributes: NORMAL, POSITION, TEXCOORD\_0.
extensionsUsed: KHR\_materials\_unlit.
- declaration · MTEK-E7005: The file uses the glTF extensions KHR\_materials\_unlit; the v0.1 profile supports none.
  - the problem is in the file 'models/model.glb'
  - first use: 'KHR\_materials\_unlit' at materials\[0\].extensions
  - help: re-export the model without extensions
- No mesh/material/clip use was requested. Import success alone is not full asset compatibility.
- No build, packaged-byte budget, rendered pixels or runtime/device validation was performed.

## required-extensions

Source: ../../tests/assets/fail/e7004\_required\_extension/models/model.glb. SHA-256: d49a84514cfcc1fedf765b9a9f4504820813d5f44e3d8fc9849deffa28d742dd.
Provenance: Repository-generated fixture; tests/assets/tools/make-glb.mjs.
Metadata: meshes=1, primitives=1, skins=0, joints=0, animations=0, materials=1, images=0, morphPrimitives=0, sparseAccessors=0, externalReferences=0.
attributes: NORMAL, POSITION, TEXCOORD\_0.
extensionsUsed: KHR\_draco\_mesh\_compression, EXT\_meshopt\_compression.
extensionsRequired: KHR\_draco\_mesh\_compression.
- declaration · MTEK-E7004: The file requires the glTF extensions KHR\_draco\_mesh\_compression; the v0.1 profile supports none.
  - the problem is in the file 'models/model.glb'
  - help: re-export the model without extensions (for example without Draco or meshopt compression)
- declaration · MTEK-E7005: The file uses the glTF extensions EXT\_meshopt\_compression; the v0.1 profile supports none.
  - the problem is in the file 'models/model.glb'
  - help: re-export the model without extensions
- No mesh/material/clip use was requested. Import success alone is not full asset compatibility.
- No build, packaged-byte budget, rendered pixels or runtime/device validation was performed.

## external-buffer

Source: ../../tests/assets/fail/e7003\_external\_buffer/models/model.glb. SHA-256: 55555fe58307d111c16cdd3600d03b5b5c0e64dd5a28e116d2d657b76d739a4b.
Provenance: Repository-generated fixture; tests/assets/tools/make-glb.mjs.
Metadata: meshes=1, primitives=1, skins=0, joints=0, animations=0, materials=1, images=0, morphPrimitives=0, sparseAccessors=0, externalReferences=1.
attributes: NORMAL, POSITION, TEXCOORD\_0.
- declaration · MTEK-E7003: Buffer 0 is an external file; the profile reads only the BIN chunk of a \`.glb\`.
  - the problem is in the file 'models/model.glb'
  - help: export a single binary \`.glb\` with the data embedded
- No mesh/material/clip use was requested. Import success alone is not full asset compatibility.
- No build, packaged-byte budget, rendered pixels or runtime/device validation was performed.

## data-uri

Source: ../../tests/assets/fail/e7003\_data\_uri\_buffer/models/model.glb. SHA-256: 629c580d486eded398b1622a8543c9d4a9944113b9a7794a958e3e063bff7b09.
Provenance: Repository-generated fixture; tests/assets/tools/make-glb.mjs.
Metadata: meshes=1, primitives=1, skins=0, joints=0, animations=0, materials=1, images=0, morphPrimitives=0, sparseAccessors=0, externalReferences=1.
attributes: NORMAL, POSITION, TEXCOORD\_0.
- declaration · MTEK-E7003: Buffer 0 is a data URI; the profile reads only the BIN chunk of a \`.glb\`.
  - the problem is in the file 'models/model.glb'
  - help: export a single binary \`.glb\` with the data embedded
- No mesh/material/clip use was requested. Import success alone is not full asset compatibility.
- No build, packaged-byte budget, rendered pixels or runtime/device validation was performed.

## mixed-filters

Source: ../../tests/assets/fail/e7018\_filters\_differ/models/model.glb. SHA-256: 7f4e22162a7e4e5c1cb9dab848b4c51178804d01f8321ff471eb7f329dc6ac68.
Provenance: Repository-generated fixture; tests/assets/tools/make-glb.mjs.
Metadata: meshes=1, primitives=1, skins=0, joints=0, animations=0, materials=1, images=1, morphPrimitives=0, sparseAccessors=0, externalReferences=0.
attributes: NORMAL, POSITION, TEXCOORD\_0.
- declaration · MTEK-E7018: The sampler at samplers\[0\] filters magnification NEAREST and minification LINEAR; the sampler presets use one filter for both.
  - the problem is in the file 'models/model.glb'
- No mesh/material/clip use was requested. Import success alone is not full asset compatibility.
- No build, packaged-byte budget, rendered pixels or runtime/device validation was performed.

## truncated-header

Source: ../../tests/assets/fail/e7001\_truncated\_header/models/model.glb. SHA-256: e6e4bd92d32681560de2f20faf66a01732f43bfd862f2bf4ac7c86b6faed14e1.
Provenance: Repository-generated fixture; tests/assets/tools/make-glb.mjs.
Metadata inventory unavailable: Not a GLB 2 container. Compiler results remain separate.
- declaration · MTEK-E7001: The file is 9 bytes; a binary glTF starts with a 12-byte header.
  - the problem is in the file 'models/model.glb'
- No mesh/material/clip use was requested. Import success alone is not full asset compatibility.
- No build, packaged-byte budget, rendered pixels or runtime/device validation was performed.

Compiler identity and complete diagnostics are retained in report.json. Existing-binary identity:

```json
{
  "available": true,
  "file": "mtek.exe",
  "sha256": "8360bc732851cf94b47cedbb61b48255a2ff6009522f9432796542ce8c6e47b1",
  "version": "mtek 0.1.0-dev (language 0.1, runtime ABI 1)"
}
```
