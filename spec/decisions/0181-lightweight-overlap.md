# 0181. Lightweight world-space overlap checks

- Status: Accepted
- Date: 2026-10-24

`overlap_spheres(a, radius_a, b, radius_b)` and
`overlap_boxes(a, size_a, rotation_a, b, size_b, rotation_b)` return whether
closed shapes touch or intersect. They run without mounting physics.

Centers are world positions, box sizes are full world dimensions (the same
convention as BoxCollider), and rotations are unit quaternions. Callers apply
entity scale to their dimensions before querying, as the physics path does.
Negative or nonfinite dimensions return false. Sphere checks use squared distance;
boxes use the 15 separating axes of two oriented boxes. A game can implement
trigger enter/exit behavior by remembering the previous result in state.

The runtime tests compare both shared shapes directly with Rapier, including
rotated thin boxes and touching spheres. Lane Runner uses the sphere check and
does not declare bodies or colliders, so it does not package physics.js.
