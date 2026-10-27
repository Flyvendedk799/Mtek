# 0204: Compute packaging and mounted handles

Status: accepted, 2026-10-26; temporary public gate superseded by [0207](0207-source-compute-acceptance-and-capabilities.md). Extends 0203. Development integration only;
ordinary source analysis/build still rejects compute declarations with E4901.

## Package and inspection contract

The package builder now includes checked compute items instead of rejecting them
in the planner. Each optional `computePrograms` entry has its own `api: 1`, the
validated artifact definition, WGSL/hash/map, parameter names/types/default flags,
packed uniform defaults and declaration/parameter spans. Compute declarations
join the symbol table. Uniform layouts join the existing generated JavaScript
writer table; default bytes use those same compiler layout offsets and strides.
Required parameters have zero placeholder bytes and must be supplied at creation.

The closed manifest schema validates the new records, including the fixed dispatch
layout. Runtime structural/device checks remain necessary: schema validity alone
does not establish coherent layouts, binding limits or dispatch capacity.
Inspection bindings/shaders include compute resource slots, validated WGSL and
source-resolved locations from the same artifact path. Empty compute lists are
omitted, preserving ordinary package/inspection goldens.

This is an additive development snapshot of manifestSchema/runtimeAbi 1. Matching
compiler and runtime files must travel together, as existing packages already
require. Older runtimes reject the new closed-schema field; there is no downgrade
or silent omission. The entry API rejects an unknown compute contract version.
This does not promise stable compatibility with an older development runtime or
advertise compute in the language capability context before acceptance.

## Mounted API and ownership

`app.createCompute(qualifiedId, params?)` asynchronously creates one owned instance.
Unknown/missing parameters fail before allocation. `setParam` validates and copies
structured values and calls the compiler-generated field writer; invalid edits
cannot partially overwrite uniform bytes. Scalars use finite f32/bounded integer/
boolean values, vectors accept exact tuples or component objects, colors use
linear rgba components, matrices use 16 column-major values, and arrays/structs
require their declared shape. This is distinct from scene-input hex color codecs.

Handles provide full packed-input `upload`, logical-domain `dispatch`, independent
packed-output `readback`, copied `inspect` metadata and idempotent `dispose`.
Layouts/strides are inspectable; GPU resources are not exposed. Running and paused
applications accept compute calls. One dispatch and four readbacks may be pending
per instance. Ordering, snapshot capture, tail clearing and device limits follow
0203. GPU failures report E8050 at the compute declaration; shader compilation
uses E8051 and its independently hashed compute source map.

The mounted app owns the store. Failed program candidates preserve live handles;
committed replacement disposes them and starts a fresh store. Scene changes retain
program-owned compute handles. App disposal/failure cancels pending work and frees
resources. Device loss marks the store lost before registry retirement. Recovery
rebuilds shared shaders, replays completed instance snapshots, restores later
staged edits and rolls back compute resources if the mounted recovery fails.
Identical WGSL shares one module; each declaration retains its own map. Reload
caches changed map URLs even when the WGSL module is reused, for offline recovery.

## Size and evidence boundaries

Generated Ajv validators omit schema documentation annotations and retain only
statically read schema-data subtrees in standalone constants. Ajv otherwise keeps
whole schemas merely to read one enum. A TypeScript AST pass finds constant
property reads, preserving whole literal/array leaves. Bare, dynamic or unfamiliar
access keeps the original constant. Validation/error expressions are untouched.
The source schema remains unchanged for consumers, and constant values/property
names are preserved. Acceptance and ordered public errors are compared with
unmodified inline Ajv across the shared valid/invalid corpus and malformed compute
records. Ajv and TypeScript remain build dependencies. Existing package size
budgets must still hold.

The shared compiler fixture now packages scalar/vector/matrix/array/composite
resources and source defaults. Mounted lifecycle checks import its actual
generated app/writers/shaders/manifest. Their fake GPU executes an injected CPU
callback, not WGSL. These checks prove packaging and ownership integration, not
GPU arithmetic. E4901 remains until source-authored numerical GPU readback and
the compute-to-render/resource-lifetime path have acceptance evidence. Sustained
benchmarks, animation optimization and physical-device testing remain open.
