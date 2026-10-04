# 0035. The complete type system: details the specification leaves open

- Status: Accepted
- Date: 2026-10-04
- Blueprint origin: §4.1 (numeric semantics), §9.4 (diagnostics); `spec/language.md` §5, §6, §8.1; `spec/stdlib.md` §6; `spec/diagnostics.md` §5.3; decisions 0009, 0024, 0025, 0026.

## Context

Task M2-01 completes `crates/mtek-compiler/src/types/`: every operator row of `spec/language.md` §6.2, the global intrinsics and `mat4` constructors of the registry, strings, arrays, structs, and constant folding of all of it. Decision 0026 fixed the M1 subset. The specification states the rules but not every choice an implementation has to make: how work of a milestone in progress is ungated, the operation order of the folded remainder and intrinsics, how literals meet the new operators, which code reports which struct and array mistake, and how the new values reach the typed IR. They are fixed here so that they are visible, testable and changeable by a later record.

## Decision

All of the following are **proposals** (design choices), not external constraints.

1. **Landing work of a milestone in progress.** The build stays an M1 build (`CURRENT_MILESTONE` is M1) until the M2 gate, because `fn`, materials and imports (M2-02, M2-03, M2-04) are not implemented yet. A work item of M2 that lands before the gate marks exactly what it implements as `M1` — the construct-table rows of decision 0025 item 2 and the registry `since` of decision 0024 item 5 — so that the gating logic, the `E9010` messages and their note ("implements the language up to milestone M1") stay as they are. M2-01 marks: the rows `struct`, string literals, array literals, indexing, `%`, comparison, equality and logical operators; the registry types `string`, `mat4`, `array`, the `mat4` namespace and its five functions, and the 35 math intrinsics. The M2 gate task, when it raises `CURRENT_MILESTONE` to M2, may move these back to `M2` (only documentation changes then).
2. **Operators.**
   - `%` is an arithmetic operator for literal resolution (decision 0026 item 4): `const N: u32 = 7 % 2;` is `u32`, and the expected type flows into both operands as for `+` and `-`.
   - `%` on `f32` folds as `x - y * trunc(x / y)`, four binary32 operations in that order (`libm::truncf`); `x % 0.0` is NaN and so `E3040` (decision 0026 item 5). Integer `x % 0` and `i32::MIN % -1` during folding are `E3040`, as `x / 0` and `i32::MIN / -1` are: WGSL rejects both in const-expressions. (Run time follows §6.3.)
   - The operands of `< <= > >= == !=` must have one type: a literal operand adopts the numeric scalar type of the other operand (a float literal next to an integer is `E3041`, as for arithmetic); two literal operands are `f32` if either is a float literal and `i32` otherwise. `f32` compares as IEEE 754 (`-0.0 == 0.0`).
   - `==`/`!=` on two vectors is `E3012`; on any other pair without a row (`color`, `quat`, `mat4`, `string`, mixed types) `E3014`. `!`, `&&`, `||` on anything but `bool` are `E3014`.
   - Both operands of `&&` and `||` are folded and checked: each is a constant expression in its own right (§6.3), so `false && 2147483647 + 1 > 0` is `E3040`.

## Consequences

- When M2-02, M2-03 and M2-04 land they mark their own rows and registry items the same way; the M2 gate raises `CURRENT_MILESTONE`.
- `spec/compiler-architecture.md` §4.7 points here.

## Verification

`crates/mtek-compiler/src/types/` unit tests (`ops.rs`, `value.rs`, `tests.rs`); `tests/consteval_goldens.rs`; `tests/semantics/pass/types/op_*` (one fixture per row of §6.2) and `tests/semantics/fail/types/` (one fixture per code); `resolve/gate.rs` tests.
