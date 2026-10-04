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

3. **Intrinsics and `mat4`.**
   - **Overloads** come from the registry (decision 0024 item 8), with one addition: a call whose arguments are *all* literals takes the scalar type its context expects when an overload with that result accepts them (`const N: u32 = max(1, 2);` is the `u32` overload, not `i32` and then `E3001`). No overload is `E3001` ("No signature of `max` accepts (vec3, f32).", the signatures as `expected`); a single signature of concrete types checks each argument (`E3001` naming the argument); the wrong arity is `E3002`.
   - **Folding** (`types/intrinsics.rs`), each a fixed sequence of binary32 operations, component-wise for `T`, an `f32` weight standing for every component: `abs` (`i32::MIN` stays `MIN`); `min(a, b)` is `b < a ? b : a` and `max(a, b)` is `b > a ? b : a` (the first operand wins a tie, so `±0.0` never depends on the platform); `clamp(x, lo, hi) = min(max(x, lo), hi)`; `saturate(x) = min(max(x, 0), 1)`; `mix(a, b, t) = a * (1 - t) + b * t`; `step(edge, x) = x >= edge ? 1 : 0`; `smoothstep`: `t = clamp((x - e0) / (e1 - e0), 0, 1)`, then `t * t * (3 - 2 * t)`; `sqrt` is `f32::sqrt` (correctly rounded); `inverse_sqrt(x) = 1 / sqrt(x)`; `pow exp exp2 log log2 sin cos tan asin acos atan atan2 floor ceil trunc` are the `libm` binary32 functions (`powf`, …, `atan2f(y, x)`); `round` is `libm::rintf` (halves to even); `fract(x) = x - floor(x)`; `sign` is `1`, `-1` or `0.0` (also for `-0.0`); `radians(x) = x * f32(π/180)`, `degrees(x) = x * f32(180/π)` (one multiplication by the binary32 constant); `dot` sums the products left to right; `length(v) = sqrt(dot(v, v))` (of a scalar: its magnitude); `distance(a, b) = length(a - b)`; `cross` as for `quat * vec3`; `normalize(v) = v / length(v)` component-wise, the zero vector giving the zero vector (`spec/stdlib.md` §6); `reflect(i, n)`: `s = 2 * dot(n, i)`, then `i - s * n` component-wise; `transpose` swaps rows and columns. A non-finite result is `E3040` ("sqrt(-1.0) is not finite").
   - `mat4.identity`, `translation(v)` (last column `(v, 1)`), `scale(v)` (diagonal `(v, 1)`), `columns(c0, c1, c2, c3)` and `rotation(q)` with the products `xx = x*x`, `xy = x*y`, `wz = w*z`, … and columns `(1 - 2*(yy + zz), 2*(xy + wz), 2*(xz - wy), 0)`, `(2*(xy - wz), 1 - 2*(xx + zz), 2*(yz + wx), 0)`, `(2*(xz + wy), 2*(yz - wx), 1 - 2*(xx + yy), 0)`, `(0, 0, 0, 1)` — the formula of the runtime's `math/mat4.ts`, evaluated in binary32.
   - Run-time evaluation (`rt`, M2-06) agrees within the tolerances of `spec/testing.md` §5; folded constants are emitted, so both domains see the folded bits.

## Consequences

- When M2-02, M2-03 and M2-04 land they mark their own rows and registry items the same way; the M2 gate raises `CURRENT_MILESTONE`.
- `spec/compiler-architecture.md` §4.7 points here.

## Verification

`crates/mtek-compiler/src/types/` unit tests (`ops.rs`, `value.rs`, `tests.rs`); `tests/consteval_goldens.rs`; `tests/semantics/pass/types/op_*` (one fixture per row of §6.2) and `tests/semantics/fail/types/` (one fixture per code); `resolve/gate.rs` tests.
