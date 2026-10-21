# 0148. A cold-start context names each function once: no `function:*` in `supported.features`

- Status: Accepted
- Date: 2026-10-21
- Amends: decision 0147 (the 600-byte room goes back to 1 000) and decision 0110 (what `supported.features` lists in a cold start). The budget of 24 000 bytes (decision 0112) does not move.

## Context

Decision 0147 item 3 left the next growth of the library to a structural choice. In a cold-start context (decision 0110), every function of the standard library appears twice:

- in `supported.features` as `function:<name>` or `function:<namespace>.<member>`;
- in `reference.builtins` as its signature, with its domain, restrictions and documentation.

The first list says nothing the second does not. It cost 1 502 bytes for 72 functions, and every new intrinsic adds about 20 bytes to it. The game, input, audio and HUD functions of the small-game work add dozens.

## Decision

1. **In a cold-start context, `supported.features` has no `function:*` entry.** This covers global intrinsics (`function:abs`) and namespace functions (`function:mat4.identity`). `namespace:<name>`, `value:*`, `schema:*`, `type:*`, `event:*` and every other kind stay. A function is supported exactly when `reference.builtins` gives its signature.
2. **When the budget drops `reference.builtins`** (`--max-bytes` too small, decision 0112 item 4), the `function:*` entries come back into `supported.features`. A context then never omits a function entirely. The fit stays monotonic: the section is about 3.8 kB and the entries are about 1.5 kB.
3. **A warm context (a project with code of its own) is unchanged.** It has no `reference`, so it still lists `function:*`. The coverage matrix reads `supported.features` from `examples/pulse-cube`, which is warm, so its rows do not change.
4. `supported.notSupported` is unchanged. A planned function is still named there.
5. The room the test `a_stub_scene_gets_the_library_and_its_own_symbols_within_the_budget` keeps for the project goes back to **1 000 bytes**.

Measured with `mtek context --entry src/main.mtek` on an empty entry module: 23 195 bytes before and **21 261** after (−1 934 bytes). That leaves 2 739 bytes of the 24 000.

## What changed (for branches that rebase)

- `crates/mtek-compiler/src/context/mod.rs`: a cold context filters `function:*` out of `capabilities.features` and keeps the full list in the new field `Draft::full_features`.
- `crates/mtek-compiler/src/context/fit.rs`:
  - `Draft` has the new field `full_features: Option<Vec<String>>`, so a `Draft { .. }` literal needs `full_features: None`;
  - dropping the reference section `builtins` restores the full list.
- `crates/mtek-compiler/tests/context_cold_start.rs`: the new test `a_cold_start_names_the_functions_once`, and the 1 000-byte room again.
- Goldens: only `tests/context/golden/empty.default.json` and `scene-stub.default.json` change, because their `supported.features` loses the `function:*` lines. The warm goldens are unchanged.
- A branch that adds intrinsics re-blesses those two goldens: `MTEK_BLESS=1 cargo test -p mtek-compiler --test context_cold_start`. Each new intrinsic now costs only its `reference.builtins` line.

## Alternatives considered

- **Shorten `[handlers and lifecycle functions only]`.** About 14 bytes per handler-only function. That is smaller, and it changes a label that benchmark records and the documentation quote.
- **Drop `function:*` from every context.** A warm context has no `reference`, so the functions would not be named at all.

## Verification

`crates/mtek-compiler/tests/context_cold_start.rs` (`a_cold_start_names_the_functions_once`, `a_stub_scene_gets_the_library_and_its_own_symbols_within_the_budget`, `cold_start_goldens`); `tests/context/golden/`.
