# 0080. PBR lighting aligned with glTF: diffuse, range window, ambient, stable GGX and the no-NaN rule

- Status: Accepted
- Date: 2026-10-18
- Blueprint origin: M4 (blueprint §11), follow-up task M4-11 of the M4-01 formula review; `spec/materials.md` §8; decision 0057.
- Supersedes: decision 0057 item 4, last bullet (the five review questions "implemented as the specification is written") and its first and "not guarded" bullets as far as `L = −V` is concerned. Everything else in 0057 stands.
- Numbering note: 0064–0079 are left free for the M5 work that runs in parallel on another branch, so the two branches cannot collide on a record number.

## Context

The M4-01 review of the CPU oracle (`tests/browser/support/reference-shading.test.ts`) recorded where `spec/materials.md` §8 differed from the glTF Sample Renderer and `KHR_lights_punctual`, and two numerical notes. Decision 0057 implemented the specification as written and left the questions open. The owner answered them (Boared plan, M4-01 review questions 1/2 and 2/2): follow glTF, keep physical light units (lux, candela), and add camera exposure (task M4-12, decision 0081) so the units do not make scenes dark.

## Decision (owner decision, implemented as a proposal for the details)

1. **Diffuse** (rule 5): `(1 − m)(1 − F_d) c / π` with the dielectric Schlick Fresnel `F_d = 0.04 + 0.96 (1 − VH)⁵`. Specular stays `D · Vis · F` with `F0 = mix(0.04, c, m)`; because Schlick is linear in `F0`, the two together equal glTF's `mix(dielectric_brdf, metal_brdf, m)` exactly. Values at `m = 0` and `m = 1` are unchanged.
2. **Range window** (rule 6): `w = clamp(1 − (d / range)⁴, 0, 1)`, glTF's `getRangeAttenuation` (not squared as in Filament). The `1e-4` floor of `d²` is kept; glTF leaves `d = 0` undefined.
3. **Ambient** (rule 7): `(1 − m) · c · ambient`. A metal gets no diffuse ambient (there is no specular ambient without image-based lighting).
4. **Stable GGX** (rule 2): `f = (1 − NH²) + NH² α²`, the same value as `NH² (α² − 1) + 1` without its cancellation at `NH ≈ 1`: at `NH = 1` it is exactly `α²` in binary32 as well. This removes 0057's 1.4 % uncertainty of the peak at the roughness floor.
5. **Zero denominator** (rule 3): documented as unreachable (the denominator is at least `NV · α ≥ 1e-4 · 0.002025`); the `select` guard stays in the helper, harmless and cheap.
6. **No NaN** (new rule 8): a light term is 0 when `NL ≤ 0` and when `L + V = 0`. The helper tests `NL > 0`, then `dot(L + V, L + V) > 0`, before `normalize(L + V)`. The oracle returns 0 for that case instead of throwing.

## Consequences

- Lit images change where `0 < m < 1` (more diffuse light), for metals under ambient light (darker), and inside a point light's range (brighter near the edge). Unlit and custom materials are not affected.
- `spec/materials.md` §8, the oracle (`reference-shading.ts`), its tests (the "formula review pins" now pin the glTF expressions), the helper (`lowering/shader/helpers.rs`), its assertions (`tests/shader_lowering.rs`), the WGSL and inspect goldens, and the GPU spec `tests/browser/specs/m4/pbr.spec.ts` (ambient case: a metal is black) are updated.
- 0057's measured table is a measurement of the previous formulas. It is **not** re-measured here (no GPU on the machine that made this change); see Verification.

## Verification

- Without a GPU (done): `npm run test:unit` (oracle tests, including the pins of items 1–6), `cargo test --workspace` (helper text assertions; every golden validates with Naga), `npm run check`.
- On a GPU (pending, like M3-08): `MTEK_REQUIRE_GPU=1 npm run test:browser:hardware -- specs/m4/pbr.spec.ts`, all cases within 3/255 of the oracle; record the new max-error table as evidence under `evidence/M4/`.
