# 0128. Static prefab assemblies

- Status: Accepted
- Date: 2026-10-19
- Supersedes: the single-entity restriction for static instances in decisions 0014 and 0062. The single-entity dynamic ABI in 0064 stays unchanged.

## Contract

A prefab may contain ordinary `entity` descendants, at any nesting depth. Static instances expand the root and descendants into ordinary scene entities in depth-first pre-order. Each part has its own transform, state, material parameters, handlers and lifecycle functions. Scene behavior runs first, then each root and its descendants. Existing transform propagation, batching, material writers, diagnostics, hot reload and disposal handle the resulting entities without a new runtime ABI.

`self` is the current part. Root params, constants and state are lexically visible to descendants. Child names are unique within the prefab and can be referenced by sibling or root code; they do not enter the importing scene scope. Qualified symbols such as `src/main.mtek::Demo.Left.Seat` distinguish two instances. The scene accesses root state as `Left.seat_color`, and child material bindings may read bare `seat_color`. Child state initializers can read the already initialized root state. Root position, rotation and scale affect every descendant; `visible` retains its existing per-mesh meaning.

The checker types all descendants, collects their CPU roots and binding dependencies, applies single-writer and cycle checks across the whole assembly, and counts every expanded part against the static entity limit. Instantiation substitutes params and remaps entity references, parent indices, states, assignments, body targets, binding targets and dependencies. Existing scene references are remapped after expansion. Initializers run in instance order, never by comparing a template's source offsets with offsets in an importing file.

`spawn` of an assembly and a prefab instance nested inside a prefab are `E5040`, including imported and forward-declared prefabs. The handler-only `spawn`/`destroy` restriction is unchanged: helper functions do not gain lifecycle authority. Every static part lives with the scene and cannot be destroyed. Lights remain `E5110` throughout a prefab; bodies remain root-only (`E5091`). The generated dynamic `prefabs` table includes only single-entity templates; assemblies remain in typed IR and expand into the ordinary static scene manifest.

## Verification

- `ir::prefab_tests`: imported two-instance nesting, symbols, independent params and state, child and scene references, bindings and stable lifecycle ownership; forward-declared spawn rejection.
- Semantic pass/codegen `compound_prefabs`; fail fixtures for nested prefab instances, assembly spawn, bound-child writes, child binding cycles and child lights.
- Runtime golden integration: generated assembly init, lifecycle and events, root color propagation into child material blocks, parent world transforms and disposal.

## Deliberate limits

No dynamic assembly spawn or recursive prefab composition. Instance bodies remain constant-param-only. Child entities are private to the prefab; expose root state for host or scene control. Existing single-entity prefab programs keep their generated JavaScript and manifest unchanged.
