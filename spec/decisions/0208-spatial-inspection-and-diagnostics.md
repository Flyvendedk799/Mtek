# 0208 — Spatial inspection and animation diagnostics

Status: Accepted. Date: 2026-10-27. Extends extension/animation API 1.

The optional inspector must consume copied public scene/camera and animation
diagnostics to draw world-space skeleton, IK, authored-bounds and collider
overlays. Parent transforms, node animation and nonuniform scale must be retained;
local positions alone are insufficient. Unsupported data is shown as unavailable.
No mutable world, physics or renderer records cross the extension boundary.

Inspection is explicit and lazy. Existing transform reads and animation evaluation
retain their behavior. Overlay drawing belongs to the separately packaged inspector,
with clipping, viewport alignment and deterministic disposal. Selection/lifetime
uses the existing scene-generation and spawn-generation IDs.

Compiled-app declarations additionally remove redundant whitespace. A token-aware
compactor preserves literal/template contents and lexical boundaries, then parses
and reprints the result to prove identical declarations before emitting it.
Maintained SDK sources remain readable. This extends decision 0206 without
removing public types or increasing existing package budgets.

The generated standalone manifest validator also pools repeated immutable
diagnostic message/schemaPath/keyword values in private constants. Property names,
directives, validation logic and schema values are retained. Exact ordered errors,
including schema paths, are compared with the same unpooled validator. Ajv remains
a build-only dependency; the browser receives no compiler or Ajv import.

Verification requires independent transformed-coordinate checks, actual mounted
lifetime/scene reset coverage, public-package type checks and rendered overlays
on both available backends. Wider devices and the full platform plan remain open.
