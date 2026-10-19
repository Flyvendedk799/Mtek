# 0105. The generated runtime benchmark programs are not held to `mtek fmt`

- Status: Accepted
- Date: 2026-10-19
- Blueprint origin: M7 (blueprint §11), found when the M7-04 branch was merged into `main`; decisions 0070 item 11 (what CI holds to the canonical form), 0096 and 0097 (the runtime benchmark workloads and their freeze).
- Supersedes: nothing.

## Context

Decision 0070 makes CI check that the examples, the CLI templates and every Mtek source of the benchmarks are canonical (`crates/mtek-cli/tests/fmt.rs`, `the_repository_sources_that_ci_checks_are_canonical`). That test walks every directory named `mtek` below `benchmarks/`, so it found the seven programs of `benchmarks/runtime/<workload>/mtek/` that M7-04 added, and failed on all of them. The programs are printed by `benchmarks/runtime/tools/gen-mtek.ts` (one entity per line, so that the three implementations of a workload cannot drift apart) and they are part of the frozen definitions: their file hashes are in `FROZEN.json` and the tree hash was recorded before any reported number (decision 0097). Formatted with `mtek fmt` they change by 20 087 added and 4 317 removed lines (every entity literal on several lines, about 15 800 lines more in total) and the hashes of the frozen definitions would change.

## Decision

1. The test skips the directories below `benchmarks/runtime/` (`GENERATED_AND_FROZEN`). Nothing else changes: the benchmark tasks, the holdout, the examples and the templates are held to the canonical form as before.
2. `gen-mtek.ts --check` still fails when a committed program differs from what the generator prints, and the freeze check fails when one changes without a recorded rationale. What is given up is only the formatting guarantee, for generated files whose form is part of the frozen measurement input.
3. The frozen definitions are **not** re-recorded: no benchmark file changed.

## Consequences

- A hand-written Mtek source added anywhere below `benchmarks/runtime/` would also escape the check. There is none; if one is added, the exception should become a list of the generated files.

## Verification

`cargo test -p mtek-cli --test fmt` on the merged `main`.
