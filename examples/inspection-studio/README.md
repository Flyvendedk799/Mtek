# Inspection studio

Run `node examples/inspection-studio/dev.mjs` from the repository root and open
http://127.0.0.1:5186/. Preparation verifies and copies the original pinned Fox;
the frozen animation benchmark and original asset are never edited.

Select Fox, switch its base clip, add an upper-body override/additive action,
adjust the procedural neck lift and enable a hand IK target. The diagnostic panel
shows the actual transition, ordered masks/weights, root-motion ownership and IK
reach error. Rotate its nonuniformly scaled parent to inspect inherited transforms.

World overlays draw skeletons, IK targets, final-enclosure bounds, actual physics
shapes and contact normals. Select Crate after it lands, then open **World and
collisions** to inspect its contacts. Mesh scale is not reapplied to physics shapes.
Disable or select individual overlays; the panel and overlay are optional SDK
consumers with separate lifetimes. R resets through the source scene; the reset
button remounts the full application. Pause stops the scene's clock.

Skeleton/IK coordinates describe the evaluated skeletal pose before material
vertex deformation. Bounds are conservative enclosures, not a proof of tightness.
Unavailable contacts or finite bounds are labelled explicitly. CSS translations
and positive axis scaling are supported; rotated/skewed/perspective DOM ancestors
are reported as unsupported rather than drawing misaligned geometry.

Fox: PixelMannen (CC0); rigging/animation: tomkranis (CC BY 4.0); glTF conversion:
@AsoboStudio and @scurest. The model comes from KhronosGroup/glTF-Sample-Assets
commit `8f492390ddc7a2ae221a1369ef560589cf8c70fb`; the pinned
[provenance and upstream license metadata](../../benchmarks/runtime/animation/assets/provenance.json)
are retained alongside the original file.
