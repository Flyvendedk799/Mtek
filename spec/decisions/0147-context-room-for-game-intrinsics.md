# 0147. The cold-start context keeps 600 bytes for the project, not 1 000

- Status: Accepted
- Date: 2026-10-21
- Amends: decision 0112 item 1 (the room a test keeps for the project's own section and symbols). The budget of 24 000 bytes does not move.

## Context

Decision 0112 item 5 says that when the registry outgrows the cold-start budget, the choice is made again in a decision rather than by quietly dropping a row. The game intrinsics of decisions 0140 to 0146 are such growth:

| state | empty project (bytes) | room left of 24 000 |
|---|---|---|
| decision 0112 | 22 638 | 1 362 |
| after decisions 0140 to 0144 (`go_to`, `reset`, `pause`, `resume`, `paused`) | 22 995 | 1 005 |
| after decisions 0145 and 0146 (`save`, `load`, `clear_saved`) | 23 195 | 805 |

The game-flow rows were already made as small as the generator allows. Zero-argument functions with one signature share one line without documentation (`reset|pause|resume|save|clear_saved() -> ()`, the rule decision 0112 item 3 uses for presets), and the documentation of the others has at most six words.

## Decision

1. The test `a_stub_scene_gets_the_library_and_its_own_symbols_within_the_budget` keeps **600** bytes of the 24 000 for the project's own section and symbols, not 1 000. A stub scene with one camera costs about 300 bytes (decision 0112 item 1), so a cold start is still never truncated. That is the requirement of decision 0112, and the test asserts it as well.
2. Nothing of the library is dropped. The rows of `save`, `load` and `clear_saved` are in the reference like every other function.
3. **The next growth makes the choice again.** The input functions and the gameplay helpers that are planned would not fit 600 bytes either. That choice is probably structural, not another margin:
   - `supported.features` lists every function a second time as `function:<name>`, which is about 1.1 kB the `reference` already carries;
   - or the label `[handlers and lifecycle functions only]` could be shortened.

   Both change the context format or its goldens and are left to that decision.

## Alternatives considered

- **Raise the default budget.** Decision 0112: 24 000 is the number the benchmark records for both conditions, so a larger one for Mtek alone changes the comparison.
- **Leave the new functions out of the reference.** A model that is never told about `save()` cannot use it; decision 0112 item 5 rules this out.
- **Shorten other rows' documentation.** Those rows belong to other features. The few bytes are not worth an unreviewed change to their wording.

## Verification

`crates/mtek-compiler/tests/context_cold_start.rs` (`a_stub_scene_gets_the_library_and_its_own_symbols_within_the_budget`, `an_empty_project_lists_every_schema_field_and_every_enum_member`); the goldens `tests/context/golden/*.json`.
