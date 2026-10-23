# Repository search

`benchmarks/results/ai/` is a frozen evidence archive. It includes rejected candidates
and programs written for older compiler versions. Exclude it from source searches,
language examples, code counts and `.mtek` metrics. Normal `rg` searches respect
the repository `.ignore`; when using `git grep`, add
`-- . ':!benchmarks/results/ai/**'`. Search the archive explicitly only when working
on benchmark evidence. Preserve its contents and do not use it as a coding reference.

Use `examples/`, `crates/mtek-compiler/src/context/examples/` and passing fixtures
under `tests/` for current language examples.
