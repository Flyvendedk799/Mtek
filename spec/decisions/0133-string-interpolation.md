# 0133. String interpolation: `"${expr}"`, `\$`, the `.N` format spec, `E3501` and `E3502`

- Status: Accepted
- Date: 2026-10-21
- Specification: `spec/language.md` §5.8, §2 (the String row), `spec/grammar.ebnf` (`Escape`, the comment on `String`).
- Small-game plan: phase 1 (text, strings and HUD), step 1.

## Context

A game shows scores, timers and lives. v0.1 had strings but no way to build one from a value: `+` on
`string` is `E3014` and §11 listed "string formatting/concatenation" as not in v0.1. A HUD (phase 1)
needs text made from state.

## Decision

1. **Syntax `"text ${expr} text"`** (proposal). `{…}` alone was rejected: `"{x}"` is a valid string
   today (`tests/syntax/pass/StringChar.mtek` contains `"c{d}"`), so it would silently change meaning.
   `${` was not an escape and `\$` was `E0023`, so `${…}` interpolation plus the `\$` escape is
   backward compatible for every program without `${` in a string.
2. **Lexing.** The lexer finds `${`, scans to the matching `}` (braces nest) and records the byte range
   of the expression; a `"` or the end of the line before the `}` is `E0024` with an interpolation
   message. An interpolated expression therefore cannot contain a string literal. The token is a
   `String` token with the value `Interpolated(pieces)`.
3. **Parsing.** Each range is lexed and parsed as an `Expr` by its own parser over the file text
   blanked before the range (so spans are file spans) and the closing `}`; node ids continue the
   outer parser's. `${}` and a missing operand are `E1001`. The AST node is `ExprKind::Interp`.
4. **Types** (proposal). The literal is a `string`. A part must be `string`, `bool`, `i32`, `u32`,
   `f32`, `vec2`, `vec3` or `vec4`: `E3501` otherwise (quat, matrices, colors, handles, structs, enums,
   arrays: show a field or component). The only format spec is `.N` (one digit) on `f32` and vectors:
   any other spec, or `.N` on another type, is `E3502`.
5. **Not constant.** An interpolated string is formatted at run time and is never a constant
   expression (`E3090` in a `const`), even when every part is constant. This keeps the compiler free
   of a second float formatter that would have to agree with the runtime's to the digit.
6. **Lowering and code.** The IR has no new node: `interp(text, fmt(value, precision), …)` with the
   IR-only builtins `interp` and `fmt`. JavaScript is `"text" + rt.fmt(value, "f32", 2) + …`;
   `rt.fmt` is a structural runtime helper (`packages/runtime-web/src/math/format.ts`).
7. **Text forms** (proposal): strings as they are, `true`/`false`, integers in decimal, `f32` as the
   shortest decimal that round-trips through binary32 with `.0` on whole numbers (`3.0`), `NaN`,
   `inf`, `-inf`; `.N` uses `toFixed(N)`; vectors as `(x, y, z)`.
8. **Formatter.** `mtek fmt` prints an interpolated string as written, expressions included.

## Consequences

- New codes: `E3501`, `E3502` (codey2's block `E35xx`). `E0024` and `E1001` gain interpolation messages.
- `+` on strings stays `E3014`; interpolation is the one way to build strings.
- Strings are still CPU only, so interpolation is unavailable in GPU code like every string.
- The GBNF and EBNF grammars describe the token only (`${…}` is `StringChar`s there); the expression
  inside is checked by the compiler, not by grammar-constrained generation.

## Verification

- Fixtures: `tests/syntax/lex/interpolation`, `tests/syntax/lex/fail_interpolation`,
  `tests/syntax/ast/interpolation`, `tests/syntax/pass/StringInterpolation.mtek`,
  `tests/syntax/fail/e1001_empty_interpolation`, `tests/syntax/fail/e0024_unclosed_interpolation`,
  `tests/semantics/pass/string_interpolation`, `tests/semantics/fail/e3501_value_not_interpolatable`,
  `tests/semantics/fail/e3502_invalid_format_spec`, `tests/semantics/fail/e3502_precision_on_integer`.
- Runtime unit test `packages/runtime-web/src/math/format.test.ts`.
- What to run by hand: `TESTING-codey2.md`, section "Phase 1.1".
