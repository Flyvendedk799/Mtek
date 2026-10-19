# 0097. Runtime benchmark: freezing the workload definitions with a recorded tree hash

- Status: Accepted
- Date: 2026-10-19
- Blueprint origin: §12.3, M7; `spec/ai-and-benchmarks.md` section 7: "Benchmark definitions are frozen (tree hash recorded) before a release comparison; changing them requires a recorded rationale, and a failing workload is never removed retroactively."
- Supersedes: nothing. Related: decision 0021 (the AI benchmark's task format and its holdout hash, `benchmarks/holdout.sha256`).

## Context

A benchmark can be made to pass by editing what it measures after seeing the result. The spec asks for the definitions to be frozen by a tree hash before a comparison is reported and for any later change to carry a recorded rationale. It does not say what "the definitions" are, how the hash is computed, or how a change is recorded.

## Decision

1. **What is frozen** (`tools/freeze.ts`, `definitionFiles()`): the protocol (`protocol.json`: target size, frame delta, warm-up and measured frames, runs, counts, threshold), the scene formulas (`common/`), every workload directory (`workload.json`, the committed Mtek program, the direct and three.js implementations), the shared kits the implementations are written on (`harness/kit/`), the Mtek adapter and the floor application (`harness/mtek-adapter.ts`, `harness/floor.ts`), the generators of the Mtek programs and of the assets (`tools/gen-mtek.ts`, `tools/assets.ts`), and the recorded asset hashes. **Not frozen:** tests, generated files (`.out/`, the generated GLB and PNG files), the measurement page, instrument and statistics (`harness/page.ts`, `instrument.ts`, `stats.ts`), the runner and the report generator. A fix to the measurement tools is a normal commit (and every raw result records the commit that produced it); a change to anything that says *what* is measured is a change of the definitions.
2. **The tree hash.** SHA-256 over the lines `<path>\0<sha256 of the file with CRLF turned into LF>\n`, the files sorted bytewise by their path relative to `benchmarks/runtime` (forward slashes). Line endings are normalised so that the hash is the same in a Windows checkout and a Linux one.
3. **The record** is `benchmarks/runtime/FROZEN.json`: an append-only list of entries, each with the tree hash, the time, the **rationale** (at least 12 characters; the first says it is the initial freeze) and the hash of every file in the tree at that point, so that a mismatch can name the files that changed. `node tools/freeze.ts --record "<why>"` appends an entry for the current tree; `--check` exits 1 unless the current tree equals the last entry and prints which files were added, changed or removed.
4. **Order of work.** The definitions were frozen after the three implementations of every workload ran on the hardware and showed the same picture (smoke runs, not reported), and **before** any reported number was produced. The runner refuses to produce a result (exit code 4) when the current tree is not the last recorded one, and stores both hashes in `run.json`; a smoke run may differ and is never a result.
5. **A test that fails when the definitions change without a recorded rationale** (`tools/freeze.test.ts`, "the workload definitions of this checkout are the frozen ones"): it recomputes the tree hash and compares it with the last entry of `FROZEN.json`. It also checks that the chain of entries is well formed (every entry has a rationale and a tree hash that follows from its file hashes; no entry repeats the one before). It cannot stop someone from recording a new entry; what it does is make every change visible in the diff of `FROZEN.json` with its reason, in the same commit.
6. **Results are tied to a freeze.** Every raw run stores the tree hash it ran under, and the report prints it. A result produced under a hash that is no longer the last recorded one is stale: after a recorded change the affected workload must be run again. The report prints the hash, headlines a run whose hash was not the recorded one, and `tools/report.test.ts` requires the published run's hash to match.
7. **A failing workload is never removed.** There is no mechanism to remove a workload: the workload list is part of the frozen files, the report generator iterates the workload list, and a workload that errors or has no raw result is printed as such. Changing a definition after a failure is a recorded change with a rationale like any other; the entry stays in the history.

## Consequences

- Adding an eighth workload, or tuning a reference implementation, is a recorded change and invalidates earlier results.
- The hash does not prove that the numbers were measured under it; the raw results carry the hash and the commit.

## Verification

- `tools/freeze.test.ts`: the hash depends on every path and file hash; which files are and are not covered; a changed, added or removed file is named; a recorded rationale makes the check pass again and only for the current tree; a forged hash, a missing rationale and a repeated entry are rejected; and the checkout's own definitions equal the last recorded entry.
