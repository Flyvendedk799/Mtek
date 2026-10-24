# Grammar-validator follow-up

Decision [0188](../../spec/decisions/0188-grammar-parser-conformance.md) resolves
the 54 mismatches reproduced on the original main revision. Changes are confined
to the GBNF adapter, conformance regression cases and documentation; source
parsing and semantic diagnostics are unchanged.

- Postfix pattern values accepted by the parser reach semantic checking (E3204).
- A leading `match` selects statement syntax; expression matches remain available
  after operators and inside parentheses and arguments.
- String dollar/text states recognize `${`; interpolations require a parsed
  expression on one quote-free line. Format validity remains a semantic check.
- The existing two documented validator differences remain unchanged. No new
  exceptions, disabled tests or filtered cases are part of the final suite.

The focused validator run passed **338 inputs**: all 54 previous failures, all
109 positive syntax fixtures and 175 edge cases, including **27 new regressions**.
All seven GBNF structural unit tests, workspace Clippy with warnings denied,
`npm run build`, prebuilt-versus-dist verification and release-document checks pass.

`cargo test --workspace --locked` now **passes in full**, including:

- **43,181 validator inputs, zero unexpected mismatches**;
- the local pinned Qwen constrained-generation smoke;
- the full compiler/CLI, grammar-coverage, coverage-use and doc-test suites.

`npm run check` also passes. Detailed counts and the exported grammar hash are in
[grammar-fixed-validation.json](grammar-fixed-validation.json). The original
baseline reproduction remains preserved in [grammar-conformance.json](grammar-conformance.json).
