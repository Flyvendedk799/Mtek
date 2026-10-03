# 0018. M1 runtime: interim behaviour where the manifest or a later task is not ready

- Status: Accepted
- Date: 2026-10-03
- Blueprint origin: §7.3 (failure visibility), §7.4 (device loss); `spec/diagnostics.md` §2.1 and §2.3; `spec/runtime-abi.md` §5, §9.4 and §12.

## Context

Two statements of the specification cannot be met by the M1 runtime (task M1-14) as written:

1. `spec/diagnostics.md` §2.3 requires runtime diagnostics to carry the full `source` object of §2.1, whose `startLine`, `startColumn`, `endLine` and `endColumn` are 1-based, and the overlay of `spec/runtime-abi.md` §6.1 shows `file:line:column`. The manifest `spans` table, however, holds only byte offsets (`file`, `start`, `end`), and `dist/` ships no `.mtek` source text and no line table (`spec/runtime-abi.md` §2). The runtime therefore cannot compute a line or a column.
2. `spec/runtime-abi.md` §9.4 specifies bounded recovery from device loss (`state = recovering`, three rebuild attempts, `W8061`, `E8062`). That is task M4-09; M1 has nothing to rebuild yet but the surface and the startup shader modules.

## Decision

1. **Unresolved lines are `0`. (proposal)** A runtime diagnostic whose span resolves through the manifest carries `source = { file, startByte, endByte, startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 }`. `0` means "line and column unresolved"; it is never a valid 1-based value, so a consumer cannot mistake it for a location. A diagnostic whose span cannot be resolved (unknown span id or file), and every pure device or platform diagnostic, has `source: null`. The overlay prints `file:line:column` when the line is known and `file (bytes a-b)` when it is not. `src/runtime.d.ts` documents the sentinel on `MtekSourceSpan`.
2. **Device loss is terminal until M4-09. (proposal)** On `device.lost` with a reason other than `"destroyed"` the M1 runtime reports `W8060` (phase `runtime:device`, with a note that recovery arrives with M4-09), sets `state = "failed"`, stops the frame loop and shows the overlay. `dispose()` still works. The `recovering` state, `W8061` and `E8062` are never produced in M1.

## Consequences

- Runtime `source` objects with line `0` do not satisfy the `minimum: 1` of `spec/diagnostic.schema.json`. That schema validates compiler reports (every golden fixture); no runtime test validates runtime diagnostics against it.
- Removing the sentinel needs a manifest change, which belongs to the manifest and compiler owners: either a per-source `lineStarts` array in the manifest (schema, M1-13, and the packager, M1-17) or a dev server that ships the sources. A new record supersedes item 1 when that is decided; the runtime change is then limited to `resolveSpan` in `src/host/failures.ts`.
- Item 2 is superseded by the record that accompanies M4-09.

## Verification

`src/host/failures.test.ts` (`resolveSpan` yields `0` lines, `null` for unknown ids), `src/host/overlay.test.ts` (both location formats), `src/host/app.test.ts` (device loss: `W8060`, state `failed`, overlay, loop stopped, still disposable).
