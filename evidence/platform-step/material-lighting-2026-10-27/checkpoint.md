# Material/lighting calibration and PBR opacity

2026-10-27. A rendering and comparison increment for scorecard areas 3 and 9.
**Full material performance and production-product acceptance remain incomplete.**

## Delivered

Source-authored PBR opacity now survives both the built-in albedo calculation and
the `lighting.pbr` / `lighting.pbr_mapped` helpers. Previously these paths replaced
alpha with one, so transparent PBR entities entered the correct pass but rendered
opaque. [Decision 0210](../../../spec/decisions/0210-pbr-colour-alpha.md) records
straight-alpha semantics and the unchanged OPAQUE GLB profile. RGB lighting and
texture-alpha import semantics are unchanged. Tests compare three material paths
at five opacity values, including invisible and fully opaque, against independent
linear-light blending and sRGB conversion on both desktop backends.

The new [comparison workspace](../../../benchmarks/material-lighting/README.md)
provides five procedural calibration categories at low and standard quality:
product shapes, indoor/outdoor lighting, transparent panels and particle effects.
Mtek and pinned Three.js WebGPU consume byte-identical generated geometry/maps,
camera/material/light definitions and linear panorama input. Their native PBR
and environment preprocessors remain distinct. Three uses public opaque
instancing and an explicit public shadow filter matching the declared square
tap pattern. Engine chunks load separately; network records check isolation.

All ten category/profile pairs pass on Radeon RX 7900 XTX and SwiftShader on
the same PC. Fixed whole-foreground, object-region and particle-region gates
are retained. Particle structure and same-engine no-emitter controls prevent
static scenery from masking a missing effect. The accepted reports and 64 PNGs
retain exact image hashes. No colour fitting, registration or per-engine
tolerance is applied. Devices are destroyed; Mtek's seven tracked resource
counters return to zero. These are correctness results, not timing results.

The all-pass timestamp instrument sums render and compute intervals across
every frame encoder. CPU fake tests and a 16-sample hardware preflight validate
its mechanics, including a two-encoder Three frame. This is not a qualified
performance run. A preflight caught skipped shadow updates when manually
submitting several Three frames within one RAF frame; frames now pace through
RAF outside the CPU interval and include both passes.

## Remaining acceptance

The unchanged pinned Khronos WaterBottle GLB has authored `TANGENT` data and
currently receives E7009. The retained product preflight is an explicit failed
import, not a compatibility success. Its SHA-256 and Git blob identity match
the pinned upstream file; author/license metadata and the actual diagnostic are
retained. Implementing and validating authored tangents, then adding this
unchanged textured product to both engines, remains required. The procedural
checker box and spheres do not satisfy that production-product requirement.

A complete CPU/GPU/count/presentation runner, host-load qualification, repeated
measurement ordering, raw reports and regression budgets also remain open.
Current reports explicitly set `performanceEligible: false`; older candidates
used that field for visual prerequisites only and contained no performance
acceptance. No speed or memory advantage is claimed. Broader asset/streaming/
long-session workloads, other physical-device tiers and the rest of the
platform scorecard remain open.

## Validation and rejected work

The independent PBR/math/map browser selection passes 26 tests and the broader
animation/lighting/material/sprite selection passes 98 across both backends.
Runtime units pass 1,661 tests. The ordinary Rust workspace excluding grammar
adapters passes 1,740 tests with one existing ignored test; adapter library/binary
units add 10 passes. The 45,000-input grammar corpus was not rerun in this
increment. Formatting, warning-denying Clippy, TypeScript, targeted lint, release
consistency and feature coverage pass. All eleven existing folder/zip budgets
hold without increases; stage-show's zip is 713,307 / 740,000 bytes.

Rejected/intermediate reports are preserved separately: opaque PBR panes; the
wrong XY particle mesh; rapid manual frames omitting a shadow pass; unbatched
reference and shared-bundle candidates; stale goldens/spec sample; and Windows
executable/prebuilt locks. The successful final compiler run is retained
separately and does not relabel those earlier failures. The particle mesh now
uses the normative local XZ plane with +Y normal, and stronger contribution/
structure gates were added without relaxing any tolerance. Generated shader,
manifest, source-map and IR goldens were refreshed for the PBR alpha correction.

See [validation.json](validation.json) for source snapshots, evidence hashes,
commands, current reports and retained intermediate records. The frozen AI and
animation workload definitions/evidence are unchanged.
