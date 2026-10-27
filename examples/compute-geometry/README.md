# Compute geometry and directional shadows

Run `node examples/compute-geometry/dev.mjs` from the repository root, then open
http://127.0.0.1:5185/. The script builds the ordinary runtime and CLI with two
Cargo jobs, compiles the source scene and serves this host page locally. No
diagnostic bypass or handwritten shader replaces the compiler output.

The `Translate` source kernel adds a vec3 offset to a packed 72-f32 stream (24
box vertices). The host uploads once, dispatches on slider changes and borrows
completed positions through `attachPositions`. Normals/UVs/indices stay valid
under translation. Bounds conservatively enclose every slider value; an actual
deformation must supply bounds enclosing its final geometry.

The caster starts outside the camera while its shadow lands on the visible
floor. The shared twin stays unchanged. Switch view, adjust the Z offset, detach
the geometry or release/recreate compute resources. App disposal releases all
owners. This is a small API demonstration, not a performance benchmark.

The [GPU acceptance suite](../../tests/browser/COMPUTE-ACCEPTANCE.md) separately
checks tight final bounds, ordinary CPU-transform references, culling enabled /
disabled, all shadow quality levels, pending-output suppression, device recovery,
detach and tracked resource disposal. The [compute contract](../../spec/compute.md)
states the API 1 limits, formats and unsupported operations.
