# Asset import and usage audit

A local, serial preflight tool for the current Mtek asset profile. It calls an
**existing** compiler binary with `check --format json`; it never builds that
binary, renders, changes source assets or follows external asset URIs. The small
metadata reader is an inventory, not a second glTF validator.

From the repository root:

```sh
npm run audit:assets -- --file=benchmarks/runtime/animation/assets/Fox/Fox.glb --mesh=fox1 --clip=Walk
npm run audit:assets -- --corpus=tools/asset-audit/corpus.json --out=target/asset-corpus-run --check
```

Use `--compiler=<local-binary>` to select an existing Mtek build. The default is
`target/debug/mtek.exe` on Windows and `target/debug/mtek` elsewhere. A missing,
timed-out or malformed compiler response is **not-run**, never an asset rejection
or success. Relative command arguments are resolved from the invoking directory,
including npm workspace invocation. Corpus file paths are relative to that JSON.

## Import is different from use

The first check declares the original file with `asset.glb`. Each requested usage
probe then checks one mesh/primitive and optionally a material or clip. Examples:

- A GLB with an unused cubic-spline animation can import, while a clip using that
  animation is rejected. The inventory records `CUBICSPLINE`; the real compiler
  decides what can play.
- A multi-primitive mesh can import, fail `.mesh(name)` and pass an explicit
  `.primitive(name, index)` probe.
- Original Cesium Man and WaterBottle pass their named mesh/material probes;
  the latter retains its authored tangents. The audit performs no implicit
  sampler or tangent conversion. Invalid tangent direction/handedness and a
  tangent without normals retain explicit negative import checks.

For a single file, add `--mesh=<name>` and optional `--primitive=<index>`,
`--material=<name>`, `--clip=<name>`. Without a usage probe the report deliberately
stays incomplete for readiness, even when declaration import passes. A probe does
not establish compatibility for every other name/material/clip in the file.

```json
{
  "schemaVersion": 1,
  "entries": [{
    "id": "character",
    "file": "models/character.glb",
    "sha256": "<64 hexadecimal digits for a pinned corpus>",
    "expectedImport": {"status": "passed"},
    "probes": [{
      "id": "walk",
      "mesh": "Body",
      "clip": "Walk",
      "expected": {"status": "passed"}
    }]
  }]
}
```

`--check` requires pinned input hashes and explicit expected import/probe outcomes.
It checks exact error-code sets when supplied. **Success in corpus-expectation
mode means the expected outcomes match, including known rejections; it does not
mean every corpus asset is supported.** An import rejection blocks later probes;
blocked work never counts as an expected passed/rejected usage result.

## Output and limits

The default output is a fresh ignored directory under `target/asset-audit/`.
`--out` selects another fresh directory; an existing `report.json` is never
overwritten. Reports retain source/binary hashes, tool source hashes, corpus
expectations, exact generated probe source, complete compiler diagnostics and
metadata. Scratch projects under `target/asset-audit-work/` keep byte-for-byte
snapshots; originals are hashed again after their checks.

Reads are bounded before allocation: assets 64 MiB, corpus/GLB JSON 16 MiB,
64 entries and 128 probes per entry. Checks run serially with one Rayon thread,
a ten-second process deadline and bounded diagnostic output. An input/binary
change invalidates the run. Local URL/UNC inputs are refused. Explicit local
filesystem paths can still refer to caller-managed mounts; no HTTP/resource
fetcher is used by this tool. No directory discovery or frozen AI archive scan
is performed.

Ordinary readiness mode exits zero only when imports and at least one requested
usage per input pass with unchanged inputs/compiler. Corpus `--check` instead
exits zero when all pinned expectations match. Reports are written for rejected
or incomplete cases too; usage/configuration errors fail early.

## What this evidence does not establish

`mtek check` does not prove packaged total-byte budgets, shader/pipeline execution,
runtime/device limits, decoded GPU image appearance, frame timing or long-session
resource behavior. Morph targets, cubic-spline playback, compressed assets, LOD
and integrated scene streaming remain separate implementation work.

The [recorded corpus report](../../evidence/platform-step/asset-audit/checked-2026-10-26/report.md)
covers 16 explicit inputs: two original authored characters and generated
supported/unsupported fixtures. Original character licenses/provenance remain in
[`benchmarks/runtime/animation/assets/`](../../benchmarks/runtime/animation/assets/README.md).
No new third-party asset copies or conversions are distributed by this tool.

Focused checks:

```sh
npm run check:types -w @mtek/asset-audit
npm run lint -w @mtek/asset-audit
npm run test:unit -w @mtek/asset-audit
```
