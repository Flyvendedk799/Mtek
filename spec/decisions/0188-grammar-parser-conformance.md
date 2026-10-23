# 0188. Export the parser's match and interpolation syntax

- Status: Accepted
- Date: 2026-10-24
- Amends: 0073 (grammar translation), 0129 (enum matches), 0133 (interpolation)

The installed pinned llama.cpp validator found 54 disagreements with the parser:
51 pattern cases, one match expression used as a statement, and two malformed
interpolations. The same inputs reproduce on the earlier main revision.

The GBNF adapter now follows the handwritten parser in these cases:

1. Patterns admit the parser's postfix values, including bare names, literals,
   `self` and field access. The type checker still reports E3204 unless the value
   is a variant of the matched enum. The reference grammar describes the valid
   pattern forms; the adapter also accepts the syntax used for semantic diagnostics.
2. A `match` at the start of a statement selects MatchStmt. A copied expression
   prefix excludes MatchExpr only at that position, preserving matches inside
   parentheses, arguments, unary operands and right-hand operands.
3. Strings recognize `${` using separate dollar/text states. An interpolation
   requires a complete Expr, then optional whitespace and a format spec, and `}`.
   Its expression grammar is intersected with the lexer's single-line, quote-free
   character domain. Unproductive branches (including nested String literals)
   and unreachable copies are removed. Escaped dollars and runs of dollars retain
   their lexical behavior. Format-spec validity remains E3502 in semantic checking.

This replaces decision 0133's token-only GBNF treatment of interpolation. It does
not change the source parser, valid source programs, typing rules, ABI, context
budget or the two existing documented conformance differences. No validator
exceptions are added. New conformance edge cases cover these boundaries in
addition to the existing complete fixture/mutation corpus.
