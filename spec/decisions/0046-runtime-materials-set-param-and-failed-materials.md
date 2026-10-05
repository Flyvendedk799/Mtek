# 0046. Runtime materials: arenas by layout id, `debug.setParam` and materials that fail after mount

- Status: Accepted
- Date: 2026-10-05
- Blueprint origin: §6.1 (params are never folded into shaders), §6.3 (update semantics), §7.4–§7.5 (resource lifetime, shader failure); `spec/runtime-abi.md` §8, §10.2, §12; `spec/gpu-layout.md` §8; `spec/materials.md` §3.3, §4; decisions 0031, 0039, 0044.
- Supersedes: nothing. It fills the "later failures" gap that `spec/runtime-abi.md` §12 leaves open and replaces the "arrives with M3" stub of `debug.setParam` in decision 0031.

## Context

Task M2-10 asks that the runtime support any compiled material. Most of that was built with the M1 renderer (decision 0031) and did not need to change: the code already keeps one arena per layout id, looks writers up by layout id, gives every instance a static-offset bind group, creates one pipeline per shader and binds each shader's vertex attributes. What was missing is evidence (the material store had no tests of its own), `debug.setParam` (the M2 gate's way to change a param without `bind`, which still threw "arrives with M3") and a defined behaviour for a material that fails after the mount.

Everything here is a **proposal** (a design choice); there is no owner decision behind it.

## Decision

1. **The generic path is as M1 built it** (no change): `MaterialStore` makes one `UniformArena` per material layout id, sized for every instance of that layout (so a static scene never grows it), finds the generated writers in `program.writers` by layout id, and gives each instance one bind group with a static offset (`{ buffer, offset: slot × slotStride, size: layout.size }`), cached by its arena. Materials with different shaders and one layout id share the arena; a material without value params uses the one shared empty group 1. Pipelines are keyed as `spec/runtime-abi.md` §8.4 says; the vertex buffers set for a draw are the shader's `vertexAttributes` in slot order, taken from the mesh's per-attribute buffers. `materials.test.ts` and the two-material scene of `renderer.test.ts` are the evidence.

2. **`debug.setParam(entityName, param, value)`.**
   - The entity is found by its name, or by its qualified symbol when several entities share the name (an ambiguous name is an error that lists the symbols). The param must be declared by the entity's material.
   - The write takes the path of `ctx.setParam` (`World.setParamByName`): the value is checked against the param's type (`paramValueProblem`: finite numbers, integer ranges, vector keys, a 16-element `Float32Array` for `mat4`), a `color` must be opaque (**`E8100`**: reported at the entity, the previous value stays, nothing is written), then the generated field writer fills the slot's scratch block, the slot becomes dirty only if its bytes changed and the instance's mirror `mat.p` is updated.
   - The bytes reach the GPU in the **next frame's render phase** like every param write. The call creates no shader module, pipeline or bind group; the `pipelinesCreated`, `shaderModulesCreated`, `bindGroupsCreated` and `buffersAllocated` counters are the proof, and a repeated identical value uploads nothing.
   - A mistake of the caller (unknown entity, no material, undeclared param, a value of the wrong shape) throws a `RangeError` or `TypeError` naming what exists; it is not a runtime diagnostic, because no program caused it. The call throws on a disposed or failed application.

3. **Failures.**
   - **At mount** nothing changes: a shader that does not compile (`getCompilationInfo` messages, each mapped through the span map to the Mtek span) or a pipeline that cannot be created (mapped to the material's declaration) is **`E8051`**, `mountMtek` rejects with `shader-failed`, and nothing is left alive.
   - **After mount** (the callers are hot reload, M3-07, and device recovery, M4-09) the same loaders are used with `phase: "runtime:reload"` or `"runtime:device"` and, for a partial load, `shaders: [...]`, so the diagnostics do not claim the mount. A material whose shader or pipeline fails is handed to `MountedApp.handleMaterialFailure(materialId, diagnostic)`, which calls `Renderer.failMaterial`: the diagnostic is reported (once per code and span, as for every runtime diagnostic; errors also show in the overlay), the material's entities **are no longer drawn** (the draw list skips them; other materials keep drawing in the same order), and the application keeps running. Its entities still exist, their transforms and params stay writable, and the `failedMaterials` counter says how many materials are out. A failed material stays out until the program is replaced; this record defines no way back.
   - No M2 code path produces a later failure, so `failMaterial` is exercised by unit tests only; M3-07 decides, for hot reload, that a failed candidate is discarded before anything is swapped (`spec/runtime-abi.md` §11.2), so it never reaches this path, and M4-09's rebuild after a device loss is the first real caller.
   - A validation error no error scope captured stays **`E8050`** without a material: the runtime does not guess a material from the text of a browser message.

## Consequences

- `debug.setParam` leaves the "not yet" list; `pressKey` and `releaseKey` remain M3. `host/types.ts` documents it.
- New counter `failedMaterials` (an addition to `spec/runtime-abi.md` §10.1's list, always 0 until a later failure exists).
- `loadStartupShaders` keeps its name and gains optional `phase` and `shaders`; `PipelineRequest` gains an optional `phase`. Defaults reproduce the M1 behaviour exactly.
- M2-12 drives `debug.setParam` from the browser (the `Pulse` material changing a param), M2-GATE cites this record and the counters.

## Verification

- `packages/runtime-web/src/render/materials.test.ts`: arenas and bind groups by layout id, writers found by layout id (an internal error names a layout without writers), one slot per instance, unchanged bytes upload nothing, the shared empty group, no bind group created by a write.
- `packages/runtime-web/src/render/renderer.test.ts`: `debug.setParam` on a two-material scene (bytes at the right slot only, uploaded next frame, no pipeline/module/bind group/buffer created, unchanged value uploads nothing, `E8100` keeps the previous value, errors name what exists, disposed), and a material failing after mount (reported once, its entities skipped, the others drawn in order, the application running, params still writable).
- `packages/runtime-web/src/host/shaders.test.ts`: the `E8051` mapping through the span map from a fake `getCompilationInfo` message at mount and with `phase: "runtime:reload"`; `src/render/pipelines.test.ts`: the phase of a pipeline failure; `src/scene/values.test.ts`: `paramValueProblem`.
