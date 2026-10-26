# Compute packaging and mounted host checkpoint

Date: 2026-10-26. Implements [decision 0204](../../../../spec/decisions/0204-compute-packaging-and-mounted-handles.md).
This supersedes the integration boundaries of the preceding internal-ownership
checkpoint; its old validation hashes remain historical.

Checked compute declarations now package WGSL, separately content-addressed maps,
resource definitions, source/default parameter metadata and packed default bytes.
Their uniform layouts use existing generated JavaScript writers. Inspection
exposes the same validated shaders and resource binding slots. The closed optional
`computePrograms` manifest entries carry compute API 1; ordinary manifests and
inspection outputs retain their previous bytes.

The mounted `createCompute` API supplies owned handles for full packed uploads,
checked structured parameter edits, bounded logical dispatch, independent output
readback, copied resource inspection and disposal. The host wires shader failures,
program replacement, app disposal/failure and device recovery. Failed candidates
preserve live state; committed replacement invalidates old handles. Recovery
replays completed snapshots while preserving later staged edits. Shared WGSL has
one module owner and distinct source maps; reload caches map changes even when
reusing WGSL. The shared fixture loads the actual compiler-produced app and writers
through `mountMtek`.

The fake GPU executes an injected CPU callback. **It does not execute WGSL.**
Ordinary source analysis/build still emits E4901. Only the compiler test harness
bypasses that gate after proving it is the sole error. The obsolete planner guard
is removed. The source-authored numerical GPU reference checks, generated-position
render bridge and physical-device acceptance remain required. No language-context
capability advertisement or general performance claim follows from this work.

All eleven package budgets pass unchanged, including both folder and stored ZIP
limits. The first eager bundle exceeded six examples' limits; its measurements
are retained in `rejected-size-eager-runtime.json`. Removing unused Ajv schema
documentation and projecting standalone schema constants to their statically read
subtrees reduced the minified bundle by 35,785 bytes. The validator's acceptance
and ordered public errors match unmodified inline Ajv over shared fixtures and
malformed compute records. Unknown/dynamic schema reads retain whole constants.
The final minified runtime is 688,174 bytes, 2,786 bytes above the previous checked-in
runtime; declarations are 20,682 bytes, up 2,274. This is a feature cost, not runtime
execution performance evidence. `package-sizes.json` retains all final sizes.

The broader CPU regression run exposed missing procedural-draw/mip-view support
in the test GPU. Its fake now records non-indexed fullscreen draws, separates mip
storage from base texels, and accepts depthless pipelines. The asset test checks
the mip target/draw and unchanged base image. This does not simulate shader pixels.

Validation commands, counts and source hashes are recorded in `validation.json`.
Heavy CPU/GPU benchmarks and animation optimization remain deferred. No GPU or
browser process was launched. The user requested a pause and push at this checkpoint.
