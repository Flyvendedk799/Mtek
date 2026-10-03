# 0022. The parser's nesting limit also bounds the height of the expression tree

- Status: Accepted
- Date: 2026-10-03
- Blueprint origin: none; `spec/compiler-architecture.md` §4.3 and §9 (recursion depth limit 256, `E1050`).

## Context

The specification limits the parser's *recursion depth* to 256 (`E1050`) so that the parser cannot overflow its stack, and the CLI runs compilation on a 16 MiB thread because a debug build needs more than the 1 MiB main thread of Windows at that depth.

A recursion counter does not bound the *shape* of the tree. Left-associative operators and postfix operators are parsed by a loop, not by recursion, and each one nests one more level in the tree: `a + a + … + a` with a million operators, or `a.b.b.b…`, is parsed at recursion depth 1 and produces a tree a million levels deep. Dropping that tree (Rust's `Box<Expr>` drop is recursive) overflows the stack, and so would every later pass that walks the AST recursively (resolver, type checker, lowering). `spec/compiler-architecture.md` §3 promises that the compiler never panics on any input, and that a 4 MiB source file is accepted.

## Decision

**(proposal)** `E1050` also applies to the height of an expression tree. The parser builds no expression node taller than 257 levels (one more than the nesting limit, so that the `Error` node standing in for a nesting that hit the recursion limit fits in the tree under the construct that was being nested). The node that would be too tall is replaced by an `Error` node (its children are dropped) and `E1050` is reported once per outermost expression. All other limits stay as specified: more than 256 nested levels are still `E1050`, and an expression with up to 256 nested parentheses, brackets, arguments, field values or prefix operators still parses.

Consequence for users: a chain of more than 257 binary operators, calls or field accesses in one expression is rejected with the advice to split it with `let`. No realistic program is affected.

Items, members and statements (M1-05) must apply the same rule to anything built by a loop that nests in the tree (an `else if` chain nests one `IfStmt` per branch).

## Consequences

- Dropping, dumping and walking an AST is safe on the 16 MiB compilation thread, and the expression parts of it on a 1 MiB thread at the limit (measured: about 0.6 MiB of debug stack for the worst nesting shape at depth 256).
- `spec/compiler-architecture.md` §9 and `spec/diagnostics.md` carry a pointer to this record.

## Verification

`src/syntax/parser/expr_tests.rs`: `nesting_to_the_limit_parses_on_a_one_mebibyte_stack` (eleven nesting shapes at depth 256 on a 1 MiB thread, including dumping and walking the result), `ten_thousand_nested_parentheses_are_e1050_without_crashing`, `long_operator_chains_are_bounded_by_the_height_of_the_tree`, `a_chain_of_a_million_operators_parses_and_drops_without_overflowing`.
