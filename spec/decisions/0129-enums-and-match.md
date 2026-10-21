# 0129. Enums and `match`

- Status: Accepted
- Date: 2026-10-21
- Supersedes: the reservation of `enum` and `match` for a future version (`spec/language.md` §2.3) and the entries "enums" and "pattern matching" of §11.

## Contract

Small games are state machines (menu, playing, paused, game over). Without enums an agent writes `i32` constants and `if … else if` chains that nothing checks: a new state silently falls through every chain. v0.1 gains a closed, data-free `enum` and an exhaustive `match`.

**Syntax.** `enum` and `match` become keywords. `enum Name { A, B, C }` is a module item (exportable, importable), with at least one variant and an optional trailing comma. A variant is written `Name.A`. `match` has a statement form, `match v { P => { … } … }`, whose arms are blocks with an optional comma after each, and an expression form, `match v { P => e, … }`, whose arms are expressions separated by commas. A `match` that starts a statement is the statement form. A pattern is `Name.Variant` or `_`, and several join with `|`. The scrutinee is an `ExprNoDesc`, as is the condition of `if`.

**Types.** An enum is a nominal type, `Ty::UserEnum`, keyed by its declaration like a struct, and it crosses imports with its identity (decision 0035 item 5). `Name.Variant` is a constant of that type. `==`/`!=` compare two values of the same enum. There is no ordering, no arithmetic and no conversion. A `match` expression has the single type of its arms after literal resolution against the context type.

**Checks, with stable codes** (in the CODEy range E32xx):

| Code | Rule |
|---|---|
| `E3201` | non-exhaustive `match`: the missing variants are named, and the help adds them or `_` |
| `E3202` | unreachable arm: a pattern already covered, or anything after `_` (related span at the earlier pattern) |
| `E3203` | `match` on a value that is not of an enum type |
| `E3204` | a pattern that is not `_` or a variant of the scrutinee's enum |
| `E3205` | `Name.Variant` where `Name` has no such variant (did-you-mean, the variant list, a related span at the enum) |
| `E3206` | arms of a `match` expression with different types (related span at the first arm) |

A duplicate variant reuses `E2002` (two declarations of one name in one scope), and `_` as a variant reuses `E0012`. An empty enum and an empty `match` are `E1001`. No new feature reaches `E9999`: every malformed program is stopped by a parser or checker diagnostic before lowering.

**Exit analysis.** A `match` statement leaves its function when it is exhaustive and every arm leaves it, so `E3080` accepts a function that ends in such a `match`.

**Representation.** Enums are CPU-only in v0.1. They are not GPU-representable, so `E4011` applies through the usual reachability rule, and material params reject them with `E4030`. At the IR boundary an enum value is erased to `u32`, the index of its variant in declaration order. The IR, the program manifest (state types), the bindings and the JS runtime need no new type. A variant folds to `ConstValue::U32`. A `match` statement lowers to `{ let match = scrutinee; if match == k1 || … { … } else if … else { … } }`, with the scrutinee evaluated once. When no arm is `_`, the last arm is the `else`. A `match` expression is the new IR node `ExprKind::Match { scrutinee, arms: [{ values, value }], else }`, which the JS emitter writes as `(($match) => $match === 0 ? a : … : z)(scrutinee)`. The constant evaluator folds a `match` whose scrutinee is constant. Shader lowering never sees one; it reports a defect if it does.

**Tooling.** The grammar model and `spec/grammar.ebnf` gain `EnumDecl`, `MatchStmt`, `MatchStmtArm`, `MatchExpr`, `MatchExprArm`, `Patterns` and `Pattern`, with the semantic rules `enum-variants`, `match-patterns` and `match-arm-types`. The formatter, the AST dump and walker, hover, semantic tokens, completion keywords, the TextMate grammar, `mtek context` (features `enums` and `match`, symbol kind `enum`) and the coverage matrix (area `enums`) know both forms.

## Verification

- Syntax: `tests/syntax/pass/{EnumDecl,MatchStmt,MatchExpr,Pattern}.mtek`; `tests/syntax/fail/e1001_{empty_enum,empty_match,match_arm_without_arrow}`; the reserved-word fixtures without `enum`/`match`; `tests/syntax/lex/keywords`.
- Semantics: `tests/semantics/pass/enums_and_match` (a game-state machine) and `enums_imported`. `tests/semantics/fail/enums/` has one fixture for each of `E2002` (duplicate variant), `E3201`–`E3206` and `E4011` (an enum in GPU code).
- How to run all of it: `TESTING.md` at the repository root.

## Deliberate limits

No data-carrying variants, explicit discriminants, enum-to-number conversion, ordering, or methods. No literal, binding, range or guard patterns, and no destructuring. No GPU enums: a later version can lower them to `u32` in WGSL, since the IR already erases them that way. The host IO layer sees an enum state by its enum name, while the IR and manifest say `u32`. A host input or output of an enum type is not specified in v0.1.
