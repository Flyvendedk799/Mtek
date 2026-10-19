# 0121. Allocation-free per-frame paths: in-place matrices, resolved setters, closure-free arena writes (K-04, step 3)

- Status: Accepted
- Date: 2026-10-19
- Blueprint origin: §12.3; decisions 0095 (how allocation is measured), 0099 item 3(c) (the sites named there).
- Supersedes: nothing.

## Context

Decision 0099 item 3(c) measured 1.77 MiB of JavaScript allocation per frame for 1,000 changing transforms (`propagate`, `setTransform`, `normalMatrix`, `writeObjectBlocks`, `qaxisAngle`), 35 KiB for a constant scene (23 KiB of it `Float32Array.prototype.subarray` views) and 157 KiB for 2,000 repeated meshes, against 0.6 to 184 KiB for the direct reference. Step 3 of K-04 asks for the avoidable per-frame allocations to go.

## Decision

Every change below leaves the arithmetic as it was; each is checked by the test named with it.

1. **In-place matrix functions** (`math/mat4.ts`): `rotationInto`, `fromRotationTranslationScaleInto`, `multiplyInto`, `normalMatrixInto(out, offset, model)`. The allocating functions call them on fresh arrays, so there is one implementation. The rotation matrix is still rounded to binary32 before the scale is applied. `World.propagate` writes the world matrix into the array the slot already owns (a root straight into it, a child through one scratch array), and the renderer writes the normal matrix straight into `entityMatrices`. `math/mat4-inplace.test.ts` compares every element, as a string so that -0 differs from +0, with the formulas of the allocating functions as they were (copied into the test), over 300 random inputs including zeros, -0, 1e-30, 1e30 and singular matrices, into output arrays that are not zero.
2. **Resolved setters for the bindings** (`World.transformSetter`, `World.paramSetter`): a binding's entity, field, material instance and param declaration are looked up once, at construction, and the function the binding calls does what `ctx.setTransform` / `ctx.setParam` do after their lookups (`applyTransform`, `applyParam`: the same checks, diagnostics `E8090` and `E8100`, mirror writes and dirty flags). An argument the context's setter would reject gets a function that calls the context's setter, so the error is the same error at the same time. The function reads the world's current parameter store each call, so device recovery (`rebindParams`) is followed. `scene/world-tracking.test.ts` runs the same sequences (valid, repeated, wrong type, unknown field or param, invalid scale, non-opaque colour) through both and compares records, diagnostics, errors, parameter writes and dirty flags.
3. **Closure-free arena writes**: `UniformArena.stage` works on the mirror's existing `Uint32Array` view and no longer builds a view per call; `writeFieldIfChanged(slot, writer, value)` takes a generated field writer and its value instead of a closure per call; `MaterialStore.writeParam` uses it (the rare copy-on-write branch keeps its closure). `gpu/uniform-arena.test.ts` covers equivalence with `writeIfChanged`, growth, repeated values, and a writer that throws.
4. **Shape checks without key arrays** (`scene/values.ts`): `isVec3`, `isQuat`, `isColor` (called for every transform and param write) no longer build an array of key names and a closure per call.
5. **Smaller things on the frame path**: no `subarray` per instanced entity (decision 0120); `batchDraws` rewrites the batch objects of the list it is given; `encode` reuses one array for the dynamic offset of group 2 and a plain loop for the vertex buffers; `packLights` and `qaxisAngle` no longer build a temporary array or closure; the world keeps its `recomputed` scratch and its change lists; the proxy of `ctx` answers a read of a known member from a set instead of `Object.hasOwn` and `Reflect.get` (the error for an unknown member is the same).
6. **`worldBoundingSphere` computes the radius as the square root of the largest squared basis column** instead of the largest of three `Math.hypot` calls (a call that allocates and was the largest single cost of preparing a moved entity). The inputs are binary32 values in binary64, so the two differ by about 1e-16 relative, far below anything the frustum test resolves; `render/frustum.test.ts` and the culling tests pass unchanged. This is the only place where a computed number changes at all, and only in its last binary64 digits.
7. **Observation: what is left, and who owns it.** The remaining JavaScript allocation of the 1,000 moving boxes is the object literals and numbers that the compiler's generated binding code builds (`{ x, y, z }` values, `fround` results boxed as heap numbers; `evaluate` in the profile) and the results of `rt.v3` and `rt.qaxisAngle`, which are the values themselves; the physics scene's is Rapier's `readPose`/`readVelocities` in `packages/physics-rapier`, the frozen vectors and quaternions of `PhysicsSystem.writeBack` and the force commands. Those are compiler and physics-adapter work, outside this package, and are not claimed here.

## Consequences

- World matrices are live arrays (decision 0120 item 1).
- `UniformArena.writeIfChanged` keeps its signature; `writeFieldIfChanged` and the two setter factories are new internal API.

## Verification

- The tests named above, `render/change-tracking.test.ts` (which also runs the bindings-free paths and compares the world matrices with a recompute that uses the allocating functions), the whole runtime unit suite, and the allocation column of the frozen benchmark (decision 0122).
