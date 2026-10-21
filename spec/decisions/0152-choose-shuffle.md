# 0152. choose and shuffle

- Status: Accepted
- Date: 2026-10-21

## Context

A small game picks a lane, a colour or an order. `random`, `random_range`, `random_int` and `chance` (decision 0149) draw numbers. They do not pick from a list the program already has. Arrays are fixed-length, `array<T, N>` with `N` from 1 to 65 536, so a picker can take `T` and `N` from the argument.

## Decision

1. **`choose(items: array<T, N>) -> T`.** One draw of `random()`, index `floor(random() * N)`. CPU only, not const-eligible.
2. **`shuffle(items: array<T, N>) -> array<T, N>`.** Fisher-Yates into a new array. `N - 1` draws, and none when `N` is below 2. The argument is not modified.
3. **Not overloads.** The signature is the form `array<T, N>` and `T`. The checker reads the element and the length from the argument (`E3001` when it is not an array) instead of matching an overload. An empty array cannot be written: `E3031` already requires `N` of at least 1.
4. **ABI.** `ctx.choose(items)` and `ctx.shuffle(items)`, each drawing through the scene's `random`.

## Verification

- `tests/semantics/pass/choose_shuffle`.
- `tests/semantics/fail/e3001_choose_needs_an_array`.
- `chooseItem` and `shuffled` in `packages/runtime-web/src/scene/world.test.ts`.
