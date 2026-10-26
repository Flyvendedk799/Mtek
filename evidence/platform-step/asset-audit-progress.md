# Asset import and use compatibility reports

Historical initial audit. [The character increment](shader-authoring-characters-progress.md) adds original CesiumMan and mixed-filter acceptance with a retained 30-check audit.
Date: 2026-10-26. Continues roadmap area 5 while animation performance
optimization and heavy CPU/GPU testing remain deferred, not cancelled.

## Delivered

[`@mtek/asset-audit`](../../tools/asset-audit/README.md) adds a bounded, local,
serial preflight command. It invokes the existing compiler's JSON check interface;
it does not build a compiler, convert an asset or use a GPU. Declaration import
and explicit mesh/primitive/material/clip uses have separate outcomes. Metadata
inventory is descriptive and never substitutes for compiler validation.

The command supports individual files or a pinned corpus, exact expected error
codes, unchanged-source/compiler checks, raw diagnostics, exact probe source,
source/tool/binary hashes and Markdown/JSON output. Missing/timed-out/malformed
compiler responses remain **not-run**. A blocked use probe never counts as passed.
Existing reports are preserved by requiring a fresh output directory.

The starter corpus contains 16 explicit inputs: the two original authored
characters, supported PBR/animation fixtures and representative rejected files.
It does not discover directories, scan the frozen AI archive or add converted
third-party model copies. Character authorship/licenses remain in the existing
pinned asset provenance.

## Recorded results

The [checked report](asset-audit/checked-2026-10-26/report.md) and
[complete JSON](asset-audit/checked-2026-10-26/report.json) match every expectation:

- 16 declaration-import checks: **7 passed, 9 rejected as expected**.
- 10 explicit usage checks: **8 passed, 2 rejected as expected**.
- No not-run or blocked checks; all 16 source snapshots stayed unchanged and the
  compiler binary hash remained constant.
- Fox imports and its three original clips pass their requested use checks.
  Original Cesium Man is rejected for mixed min/mag filtering; no implicit
  sampler replacement occurs.
- The cubic-spline fixture imports but its clip fails playback selection. The
  report retains the interpolation inventory and exact compiler diagnostics.
- The multi-primitive mesh imports, rejects ambiguous `.mesh` access and accepts
  the explicit primitive probe.

Corpus-expectation success means known outcomes match, **not** that all sixteen
assets are supported. Earlier development reports remain retained separately.

Eleven focused tests pass with one worker, alongside TypeScript and lint. They
cover bounded parsing, Mtek-specific escaping, corpus validation, import/use
separation, blocked probes, wrong/missing compilers, checksums/source drift,
unexpected additional diagnostic codes and escaped report text. The direct-file
CLI was checked with a passing named Fox clip and the deliberately incomplete
import-only case. Checks run serially with one compiler thread; no Cargo build,
real GPU operation, benchmark or broad workspace suite was run.

The compiler, corpus and tool inputs are recorded so this report does not imply
validation against a later compiler build. `mtek check` also does not test packed
total-byte budgets, real shader/pipeline execution, runtime/device limits or pixels.
The existing animation benchmark and runtime artifact bytes remain unchanged.

## Remaining roadmap scope

This delivers a starter compatibility/reporting workflow. Morph targets,
cubic-spline playback, compressed asset support, integrated asynchronous scene
streaming, LOD, runtime unloading/plateau evidence and a broader production corpus
remain implementation/validation work. The independent AssetPool does not make
those compiler/runtime capabilities available automatically.

The separately requested [Mtek vertex/compute shader track](shader-authoring-plan.md)
is now explicitly part of the scorecard. Both stages remain planned/unimplemented.
Its language/resource design and implementation are separate from this audit tool;
heavy compiler/GPU validation remains deferred during the user's heavy work.
