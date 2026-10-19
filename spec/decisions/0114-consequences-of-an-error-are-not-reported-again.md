# 0114. A consequence of a reported error is not reported again: the filter of `Key.Up`, the local of `texture.white()`, the blocks of an `if` used as a value, the `while`

- Status: Accepted
- Date: 2026-10-19
- Blueprint origin: task K-02; `spec/testing.md` §3.2 ("nothing after the first error of a construct is a cascade"); decision 0109 item 5; decisions 0022 (recovery), 0054 (textures and samplers).
- Supersedes: nothing.

## Context

Four constructs gave two or three diagnostics for one mistake, the later ones only consequences of the first. An agent that repairs from the list repairs the wrong one, or repairs the first and sees the others change shape.

| mistake | before | after |
|---|---|---|
| `on key_down(Key.Up)` | `E2003` no member `Up`, and `E5061` "filter must be a constant Key member" on the same token | `E2003` only |
| `let t = texture.white();` in a stage | `E4012` for the call and `E4011` for the local `t` ("has type texture, which does not exist on the GPU") | `E4012` only |
| `let x = if c { a } else { b };` | `E1001` at `if`, then the blocks read as statements: two `E1003` "missing `;`" for `{ a }` and `{ b }` | `E1001` only |
| `while i < 3 { i += 1; }` | `E0013` for the word, `E2003` "Unknown name 'while'", and `E1001` for the next token | `E0013` only |

## Decision

1. **`E5061` is reported only for a filter whose type is not already an error.** The resolver's `E2003` (or `E3001`, for `on key_down(Key)`) is the diagnostic of an unresolved filter; a filter that resolves and is not constant (a named constant: `E3090` then `E5061`) still gets `E5061`, which now says in a note why and in a help what to write.
2. **`E4011` is not reported for a local whose initialiser is itself the `E4012` call.** `CpuOnlySite` records the initialiser span of a local; the effect analysis skips the site when a CPU-only built-in call (the ones `E4012` reports) has exactly that span. A local of a CPU-only type that is initialised some other way (a parameter, a constant, a loop variable, a call of a user function) is reported as before.
3. **An `if` where an expression is required is skipped as a whole.** After `E1001` the parser skips the `if` with its `else` chain without recursion (`skip_nested`, the routine used for the nesting limit), so the blocks are not read as statements. Nothing inside the skipped text is checked; the program is rejected either way.
4. **`while` and `loop` at the start of a statement are `E0013` once and are read as an `if` (with the condition) or a block.** The body is parsed, so errors inside it are still found; `break` and `continue` in it are inside a loop. The resolver does not report a reserved word as an unknown name: the parser has already reported it (`resolve/mod.rs` states that the resolver does not report `E0013` again; it now also does not report `E2003` for the same token).
5. **Nothing is accepted that was rejected, and nothing rejected that was accepted.** Each case above is a program that failed before and fails now; only which diagnostics are listed changed. The recovery shapes are fixtures.

## Consequences

- `crates/mtek-compiler/tests/fixtures.rs` (`a_single_mistake_is_a_single_error`) now covers the `if` case: a fail fixture that is one mistake gives one error.
- Reading a program with `while` as an `if` can add warnings (`W2010`) that a real `while` would not; the program is already rejected.
- The `E4011` cascade rule is narrow on purpose. `let t = some_user_fn();` where the function returns a texture is two different faults (a function with a CPU-only result, and a local) and both stay.

## Verification

Fixtures `edits_e2003_key_member_by_part`, `e2003_key_member_ambiguous` (no `E5061`), `materials/e4012_texture_made_in_stage` (two `E4012`, no `E4011`), `e0013_while_loop` (one error), `tests/syntax/fail/e1001_if_as_expression` (one error), `e5061_filter_is_a_named_constant`, and the existing `recovery_*` fixtures unchanged in code and span.
