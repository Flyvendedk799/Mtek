# 0200: Independent glTF sampler filters

Status: accepted, 2026-10-26. Amends the sampler restrictions of 0058 and 0194.

## Contract

Imported glTF samplers preserve separate NEAREST/LINEAR magnification and
minification filters. All six minification choices retain their requested
nearest/linear mip filter, or clamp to level zero when no mip filter is requested.
REPEAT and CLAMP_TO_EDGE remain supported with the same U/V address mode.
MIRRORED_REPEAT and differing U/V modes remain `E7018`.

Existing default behavior is unchanged: an omitted mag/min filter inherits the
other specified base filter, or linear when both are absent. Missing minification
does not request a mip chain. The implementation chooses these permitted defaults
deterministically; it does not approximate a specified mixed-filter sampler.
The [glTF sampler specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#_samplers)
allows implementation defaults for unspecified filtering settings.

The existing twelve source sampler constructors retain their names and behavior.
Twelve additional internal manifest resources describe mixed filters:
`sampler.mag_<linear|nearest>_min_<nearest|linear>_<repeat|clamp>_<level0|mip_nearest|mip_linear>`.
These are compiler-generated resource identifiers, not new source constructors.
The compiler, strict manifest schema and runtime descriptor table agree on them.
An emitted runtime supporting these additive ABI-1 names must accompany packages
using them; older validators reject the unfamiliar names.

This permits the unmodified pinned CesiumMan sample to import with its authored
sampler. The asset corpus promotes that import and adds explicit mesh, material
and clip checks. The formerly rejected mixed-filter fixture is now a positive
material-use fixture, preserving its model bytes. Existing evidence records and
the frozen animation benchmark suite are not rewritten.

## Validation

Compiler checks cover both explicit magnification filters, all six minification
filters and both supported address modes. Runtime tests check the descriptor
fields. Hardware/software probes compare all twelve mixed resources to explicit
WebGPU descriptors at 2-, 3- and 17-pixel render targets, with asymmetric image
data and mip levels. Control draws prove that both magnification and minification
affect the pixels. These are correctness checks, not timing benchmarks.

The character vertex example additionally combines imported skins, typed authored
deformation, finite bounds, textures, directional shadows and device recovery.
Fox lacks authored normals and remains textured/unlit; CesiumMan exercises lit
normal deformation. No normals or modified original assets are fabricated.
