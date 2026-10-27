# Source compute GPU acceptance checkpoint

Date: 2026-10-27. The user explicitly re-enabled CPU/GPU testing and animation
optimization, including while doing other work. Earlier scheduling deferrals no
longer apply. This supersedes the NOT-RUN execution boundary in the historical
[preflight](../compute-acceptance-preflight-2026-10-27/checkpoint.md).

The compiler-produced development package executes on the AMD Radeon RX 7900 XTX
without a fallback adapter and separately on SwiftShader. Each backend passes
both focused acceptance tests. Package hashes, compiler/runtime provenance,
environment, raw little-endian buffers, reference pixels and Playwright records
are retained in `hardware/` and `software/`; selected outcomes and report hashes
are in [summary.json](summary.json).

- Four scalar position domains (1, 71, 72 and 3×4×6), typed scalar parameters,
  nonzero-offset upload views and output tails match independent CPU and
  direct-WGSL references exactly.
- All fourteen invocation fields match exactly over a 5×3×3 domain with 4×2×2
  workgroups and capacity 257. The reference independently packs 56-byte records.
- Borrowed geometry has zero differing pixels against both independent rendered
  references and differs from the original by 840 pixels. Recovery restores the
  completed output despite a later staged parameter edit. Detach restores the
  original image exactly.
- Scene reset preserves the compute handle and retires its attachment. Program
  replacement invalidates both. All seven registry ownership counters are zero
  after disposal. CPU scene snapshots are not GPU ownership counters.

The initial hardware attempt is retained under `rejected-initial/`: numerical,
pixel and lifetime behavior passed, but a harness assertion incorrectly included
the retained `liveEntities` CPU snapshot count among GPU resources. The assertion
now names the seven registry counters explicitly. No arithmetic, pixel or
resource threshold was relaxed.

The initial screenshot framed the disposed main canvas, with the captured
preview below the viewport. It is not visual geometry evidence. The preview
capture is corrected in the harness; numeric/pixel buffers in these records are
the actual acceptance evidence.

This is bounded correctness evidence on one physical desktop plus a software
backend, not performance or additional physical-device coverage. At this initial
scalar checkpoint, composite kernel arithmetic, compute geometry shadow
references and remaining release / capability alignment still needed acceptance.
The composite follow-up below records subsequent progress. Public source analysis retains
**E4901**; only the existing development fixture bypasses that gate.

The animation candidate runtime also passes both tests on both backends, retained
under `candidate-hardware/` and `candidate-software/`. Their captured preview
screenshots show the computed quad and were visually inspected. These copied
JSON reports are sanitized; earlier original records and hashes are preserved.

## Composite follow-up

The final `composite-hardware/` and `composite-software/` runs each pass both
acceptance tests. All eight packaged kernels now execute over 13 numerical cases,
with zero CPU/direct-reference mismatches for every defined value and tail word.
The retained raw reports include scalar/vector/matrix copies, padded nested
arrays, nested record fields, nondefault vector/scalar/array parameters, boolean
false/true updates, required parameters and shrinking 3D domains. The four-input
Transform package binds its matrix input too, although that source kernel does
not read it. It does not establish arithmetic on unused matrix/settings uniforms.

The independent direct-WGSL transform uses a different 48-byte parameter layout
and word-addressed storage, rather than the generated 144-byte uniforms and
struct wrappers. Uploaded ABI padding is poisoned; comparisons skip padding in
active records because WGSL value assignments do not specify those bytes. All
bytes in undispatched output slots must still be zero. Fixed stride/field masks
are retained with each case; negative CPU controls detect corrupted fields and
nonzero tail padding without treating active padding as a value.

All four reference shaders pass Naga validation; all 11 compute-lowering tests,
314 browser-harness unit tests, browser TypeScript/lint, Rust formatting and
focused Clippy pass. Reference preparation still does not acquire a GPU. Raw
records and hashes are added to [summary.json](summary.json). Compute geometry
shadow references, capability/release alignment and wider physical-device
evidence remain; public E4901 is retained.
