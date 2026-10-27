# 0210 — Preserve PBR colour alpha

Status: Accepted. Date: 2026-10-27. Amends 0057, 0138 and 0194.

The material/lighting comparison found that a `Pbr` instance with a colour alpha
below one entered the translucent pass but rendered opaque. Both the built-in
albedo construction and the shared PBR lighting helper replaced alpha with one.
This contradicted source-authored PBR fades under decision 0138.

The built-in `Pbr` material preserves `base_color.a` when combining RGB with its
base texture. Both `lighting.pbr` and `lighting.pbr_mapped` preserve the supplied
base colour's alpha in their result. Lighting, occlusion, emission, shadows,
environment lighting and exposure modify RGB only. The result is straight alpha;
the existing pipeline applies the source-alpha blend once. Opaque alpha-one
programs retain their output. Pass classification and ordering are unchanged.

Base texture alpha remains outside the built-in PBR opacity contract. This
preserves the current glTF OPAQUE import semantics, including an image containing
alpha. It does not enable GLB BLEND/MASK imports, transmission, per-triangle
sorting or opacity shadow maps. A custom material can explicitly use sampled
alpha while following the existing colour-parameter pass-classification rule.

Validation covers the built-in material and both authored lighting entry points
against independent linear-light straight-alpha composition at five opacity
values, including zero and one, on hardware and software backends. The matched
transparent-panel workload retains its predeclared visual gate and rejected
opaque candidate. Existing opaque PBR/map/light references remain required.
No manifest, runtime ABI, shader binding layout or public host API version changes.
