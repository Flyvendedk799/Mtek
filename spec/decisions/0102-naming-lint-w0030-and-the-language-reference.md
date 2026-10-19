# 0102. The naming lint `W0030` is not part of v0.1, and two promises of the language reference are corrected

- Status: Accepted
- Date: 2026-10-19
- Blueprint origin: M7 (blueprint §11), task M7-06; `spec/language.md` §3.3 and §11; decisions 0070 item 11 (the formatter does not implement the lint), 0094 items 3 and 4 (the divergence, left to the M7 gate), 0027 item 11 (the allow-lists).
- Supersedes: nothing. The sentence of `spec/language.md` §3.3 that promised the lint is amended, and the heading of §11 is corrected, by this record; no earlier record is rewritten.

## Context

`spec/language.md` §3.3 said that the formatter's lint `W0030` "warns when" a name does not follow the naming conventions. Decision 0070 item 11 records that the lint is not part of `spec/tooling.md` §5 and is not implemented. The catalogue listed the code with a plain title, and decision 0094 item 4 put the divergence to the M7 gate with two honest options: implement the lint in `mtek fmt` (and give it a fixture), or amend §3.3. M7-06 was asked to resolve it without implementing the lint and without deleting the code.

The audit of the same task found a second promise that the compiler does not meet. The heading of §11, "What is not in v0.1 (each has a dedicated "unsupported" diagnostic)", is true of three of its items (the reserved words, `E0013`; the bitwise operators, `E1901`; the vertex and compute stages, `E4901`). The other items are rejected by the general rules: an unknown type (`mat3`, `ivec3`, `f16`) is `E3003`, a numeric suffix or a hexadecimal literal is `E0021`, `+` on strings is `E3014`, a closure's `|` is read as the bitwise operator (`E1901`) and then an unknown name (`E2003`), a generic parameter list is a syntax error (`E1001`), and `while` is a reserved word (`E0013`). These were observed by compiling a program that contains each of them with the build of this commit.

## Decision

1. **`W0030` is not part of v0.1.** `spec/language.md` §3.3 now reads: the naming conventions are conventions only; a lint for them, `W0030`, is not part of v0.1; neither the compiler nor `mtek fmt` implements it; the code stays in the catalogue, marked "Not implemented", so that the number is not reused; whether a later version adds the lint is undecided. The lint is **not implemented** by this record and the code is **not removed** from the catalogue (`spec/diagnostics.md` §5.0, `crates/mtek-compiler/src/diagnostics/codes.rs`).
2. **The catalogue row and the exceptions file say the same.** The Trigger column of `W0030` in `spec/diagnostics.md` and the reason in `tests/semantics/code-coverage-exceptions.json` no longer call the lint "specified" and no longer leave the choice to the M7 gate; the code remains on the list of reserved codes, which the Rust test `every_catalogue_code_has_a_fixture_or_a_listed_reason` and `tools/coverage-matrix` check (no code changed, so no test needed to change). `docs/coverage-matrix.md` was regenerated because it quotes the reason.
3. **§11 no longer claims a dedicated diagnostic for every item.** Its heading is "What is not in v0.1", and a lead sentence says that each item is rejected with a diagnostic, that only three of them have an unsupported-feature code of their own, and that `docs/limitations.md` gives the code of each. The compiler's behaviour is unchanged. Giving every item a dedicated code would be a language change; this record documents what the build does.
4. **The check that keeps this honest.** `tools/release-docs` (decision 0101) compares four statements about `W0030`: the catalogue mark, the exceptions file, `spec/language.md` §3.3 and `docs/limitations.md`. A document that promises the lint again, or a catalogue row that loses its mark, fails `npm run check:release` naming both sides.

## Consequences

- A reader of the language reference is no longer promised a warning that no build produces. The conventions remain; nothing checks them.
- If a later version implements the lint, it gives `W0030` a fixture, removes it from the list of reserved codes and from the mark in the catalogue, and amends §3.3 by a new record; the check fails until all of that is done.
- The limitations page lists, for each item of §11, the diagnostic a program really gets.

## Verification

`npm run check:release` (the `naming-lint/w0030` comparison and `limitations/*`); `cargo test --workspace --locked` (the specification corpus tests read `spec/language.md` and `spec/diagnostics.md`); `npm run check:coverage` (the regenerated matrix). Recorded in the completion report of M7-06.
