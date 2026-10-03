# 0009. Numeric semantics and indexing

- Status: Accepted
- Date: 2026-10-03
- Blueprint origin: §4.1.

## Context

CPU (JavaScript) and GPU (WGSL) must not silently disagree; JavaScript numbers are `f64` and its integer coercions differ from WGSL.

## Decision

- Integer semantics in **both** domains equal WGSL's run-time semantics [S5]: wrapping arithmetic; `x / 0 = x`; `MIN / -1 = MIN`; `x % 0 = 0`; `MIN % -1 = 0`; truncating division. Constant expressions instead error on overflow/division by zero (as WGSL const-evaluation does).
- `f32` on the CPU: every operation rounded with `Math.fround`, which yields correctly rounded binary32 for `+ - * /` and `sqrt`. CPU/GPU agreement is promised only within per-function tolerances transcribed from WGSL's accuracy section; NaN/infinity/division-by-zero behaviour is CPU-specified and GPU-non-portable.
- `f32 → int` conversions clamp then truncate (WGSL rule); NaN → 0 on the CPU (indeterminate on the GPU, non-portable).
- Dynamic array indices are **clamped** in both domains by emitted code, because WGSL guarantees only indeterminate values for out-of-bounds run-time indices; dev builds warn (`W8030`).
- `round` is ties-to-even on both sides (WGSL definition; JavaScript `Math.round` is not used).

## Verification

CPU conformance table and GPU comparison tests (`spec/testing.md` §5).
