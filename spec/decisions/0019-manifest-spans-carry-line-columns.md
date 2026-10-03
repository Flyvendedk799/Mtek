# 0019. Manifest spans carry line and column ranges

- Status: Accepted
- Date: 2026-10-03
- Blueprint origin: §7.3 (failure visibility), §9.4 (diagnostics); `spec/diagnostics.md` §2.1 and §2.3; `spec/runtime-abi.md` §5 and §12.

## Context

`spec/diagnostics.md` §2.1 requires every diagnostic `source` to carry 1-based `startLine`, `startColumn`, `endLine` and `endColumn`, and §2.3 requires runtime diagnostics to have exactly that shape, resolved through the manifest `spans` table. That table held byte offsets only (`file`, `start`, `end`), and `dist/` ships no `.mtek` source text (`spec/runtime-abi.md` §2). The runtime therefore could not produce a valid `source`, nor the `file:line:column` the failure overlay must show. This was raised while implementing M1-14.

## Decision

1. **Every `spans` entry is `{ file, start, end, startLine, startColumn, endLine, endColumn }`.** `start` and `end` are half-open byte offsets into the file as stored on disk. The four line and column fields are 1-based, columns count Unicode scalar values, and the compiler's source manager computes them exactly as it does for compiler diagnostics. (proposal)
2. **The runtime copies the fields verbatim.** It never ships, fetches or reads source text. (proposal)
3. `manifestSchema` stays `1`: the project is pre-release and no manifest has shipped.

Rejected alternatives:

- A per-source `lineStarts` array: it costs more manifest bytes and more runtime code, and columns in Unicode scalar values still need the source text.
- Shipping the sources next to the program: it leaks source text into production builds.

## Consequences

- The manifest schema (`spec/manifest.schema.json`, `$defs.span`) requires the four fields, each an integer of at least 1. Manifest fixtures under `tests/abi/manifests/` carry them.
- M1-17 (the packager) fills the fields from the source map when it writes `spans`.
- Runtime diagnostics validate against `spec/diagnostic.schema.json`; there is no "unresolved" value.

## Verification

`packages/runtime-web/src/abi/abi.test.ts` (valid fixtures accepted; `invalid/span-start-line-zero.json` and `invalid/span-missing-end-column.json` rejected, registered in `tests/abi/manifests/expectations.json`), `packages/runtime-web/src/host/failures.test.ts` (span resolution copies the range), `packages/runtime-web/src/host/diagnostics-schema.test.ts` (every runtime diagnostic of the mount failure paths validates against `spec/diagnostic.schema.json`).
