# 0199: Authored deformation bounds

Status: accepted, 2026-10-26. Extends decisions 0197 and 0198.

## Source contract

Entities and prefabs have two writable, bindable fields:

- `bounds_center: vec3 = vec3(0.0)`: finite center in final deformed mesh-local space.
- `bounds_radius: f32 = 0.0`: finite, nonnegative radius in that space.

A positive radius explicitly promises that this sphere encloses every final
vertex after skinning and authored vertex deformation, before object/parent
transforms. It replaces the automatic mesh/skin sphere. The author must include
every pose, material displacement and texture-driven displacement, or update the
bounds in the same frame as those inputs. The compiler cannot prove an arbitrary
shader's geometric enclosure. An undersized sphere may hide visible geometry.

```mtek
entity Moving {
    position: vec3(10.0, 0.0, 0.0);
    bounds_center: bind(vec3(shift_x, shift_y, 0.0));
    bounds_radius: 0.87;
    mesh: Box { size: vec3(1.0) };
    material: Shifted { offset: bind(Moving.bounds_center) };
}
```

The example presumes `Shifted` translates a unit box by `offset`. Its radius
exceeds the half diagonal, and binding dependency ordering keeps bounds and
material input consistent. Rotation about the box center preserves the sphere.

Zero selects automatic mesh/skin bounds for ordinary shaders and conservative
camera visibility for authored vertex shaders. A zero-radius point sphere is not
exposed. The center is ignored in this mode. Existing source emits no extra
initialization or IR fields when neither bounds field is declared.

Constant range violations use `E5006`. Runtime writes validate shape and numeric
range. Non-finite components or a negative/non-finite radius report `E8091` and
preserve the previous value; repeated diagnostics follow existing deduplication.
Center writes copy values. Direct subcomponent writes pass through the validated
setter. Bounds affect mesh rendering only, not physics shapes or particle billboards.
Generic `entity_ref` field access retains its existing four-field contract;
named entities and prefab `self` support the new fields.

## Runtime, lifecycle and inspection

`ctx.setBounds(entity, "bounds_center" | "bounds_radius", value)` handles initial
and imperative writes. A new manifest binding target `kind: "bounds"` names an
entity and one of those fields. They are also valid entity-field dependencies.
The compiler's emitted runtime accompanies these additive ABI-1 members; older
validators reject new binding targets. No new GPU binding or shader ABI is needed.

The runtime transforms the chosen center by the full world matrix and expands
the radius by a conservative upper bound on its largest singular value, including
inherited nonuniform scale/shear. Bounds changes invalidate culling independently
of transform changes. Clearing a sphere restores the original mesh/skin center.
Instancing operates on the culled list. Transparent depth ordering uses the
selected sphere center, retaining the existing per-object sorting limitations.

Camera culling never removes an entity from the directional shadow caster list:
an off-camera object can cast a visible shadow. The shadow vertex path still uses
the authored geometry. Skin deformation follows the established render order.

Bounds live in CPU entity records and survive GPU device recovery. Program
replacement applies the new program's bounds initialization and bindings rather
than carrying an old enclosure across a possibly different shader. Imperative
bounds writes must be reestablished by the new program. Static and spawned prefab
initialization use the same setters.

Extension API 1 snapshots optionally expose a fresh copied local `bounds` sphere.
The inspector displays its center/radius. No mutable renderer state crosses this
boundary; no world-space wireframe overlay is claimed by this addition.

## Required evidence and remaining scope

Verify source typing, range failures, binding dependencies, imperative/subcomponent
writes, static/dynamic prefab code, compatibility of old generated outputs,
camera exits/reentries without matrix changes, zero-radius fallback, transparent
sorting, copied inspection values, shadow correctness, recovery and replacement.
Short hardware/software image probes remain separate from sustained benchmarks.

Combined skinned/deformed production assets, wider physical-device evidence,
world-space diagnostic overlays and Mtek-authored compute remain required work.
