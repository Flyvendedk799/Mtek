# 0211 — Tangent-frame deformation foundation

Status: Accepted for the internal deformation path. Date: 2026-10-27.
Extends 0193/0194; public tangent import and shading remain incomplete.

The unchanged WaterBottle product preflight exposes the missing authored tangent
path. Removing its tangents would change the asset and the normal-map basis.
Implement the full path in increments, starting with deformation; keep the
current E7009 import rejection until the material/mesh integration is implemented
and verified. Passing this internal kernel does not advertise GLB tangent support.

The [glTF specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#meshes-overview)
defines a normalized xyz tangent with a handedness sign in w, and reconstructs
the bitangent as `cross(normal, tangent.xyz) * tangent.w`. The internal frame
transformation is:

1. Form the existing linear-blend matrix from joint palettes and weights.
2. Transform the normal by its inverse transpose, retaining the existing singular
   normal fallback. Transform tangent xyz by the matrix's linear part, without
   translation. Using the normal matrix for the tangent is incorrect under
   nonuniform scale.
3. Remove the tangent's component along the final normalized normal and normalize
   the result. Multiply source handedness by the sign of the linear determinant.
4. An explicitly unavailable input frame (w=0), a collapsed tangent (length at
   most 1e-10) or a zero determinant produces the all-zero tangent sentinel.
   The sentinel is internal metadata, not a valid imported glTF tangent. The
   eventual material path must use its documented fallback rather than normalize
   this undefined direction.

CPU deformation accepts paired optional packed vec4 tangent input/output and
requires normal input. Existing position/normal calls retain their behavior.
The GPU adds one optional variant using eight storage bindings: positions,
normals, influences, palette, output positions, output normals, tangents and
output tangents, at bindings 0 through 7 respectively. Binding 6 is read-only;
4, 5 and 7 are writable. Existing position-only and position/normal variants
remain separate. No per-frame tangent uploads are introduced: joint palettes
remain the only animated transfer for this path.

Input positions/normals/tangents and output vertex buffers are borrowed. The
deformation engine owns influences, instance palettes, groups and its three
pipeline/module variants. Disposing it must leave borrowed tangent input usable.
Reject incomplete tangent requests before creating a pipeline or instance
resource. Shader arithmetic, pipeline switching, byte counts and ownership are
tested on real hardware/software backends against an independently inverted
matrix reference, with raw binary32 buffers retained. Singular and nonuniform
cases are bounded correctness tests, not performance claims.

The remaining integration must preserve this behavior for static and skinned
imported meshes, model/instance transforms, authored vertex results, normal-map
sampling, culling/shadows and device recovery. It needs packed asset/schema and
attribute validation, an explicit no-tangent fallback, a tangent stream and
surface field, authored-output rules, tooling/capability alignment, independent
render references and the unchanged production-product workload. Those items
are still required by the platform plan and are not closed by this record.
