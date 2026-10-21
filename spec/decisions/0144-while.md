# 0144. Bounded `while`

- Status: Accepted
- Date: 2026-10-21
- Supersedes: the reservation of `while` (`spec/language.md` §2.3); `while` becomes a keyword. `loop` stays reserved.

## Contract

Games search (find a free cell, retry a random position until it is valid). `for` needs a bound known before the loop; `while cond { … }` does not.

- `while cond { … }`: `cond` is `bool` (`E3070`), checked before each iteration, cannot start with a descriptor literal (like `if`). `break`/`continue` work as in `for`.
- CPU only: in GPU-reachable code it is `E4010` (no loop without a constant bound on the GPU).
- **Bounded at run time**: one execution of a `while` statement runs at most 1 000 000 iterations (`WHILE_ITERATION_CAP`); the next fails the frame with `E8080` at the loop, so an endless loop is a reported error, not a hung tab. The preview loop budget (decision 0075) counts its iterations too.
- For the exit analysis (`E3080`) a `while` never leaves its function, even `while true`.

## Alternatives considered

- **`loop { }` with `break`.** `while true` says the same with one keyword fewer to learn; `loop` stays reserved.
- **Compile-time bound (`while cond max 100`).** Unfamiliar syntax for the rare loop that needs it; the run-time cap catches the bug a bound would.
- **No cap.** An endless loop would freeze the page with no diagnostic.

## Consequences

`while` became a keyword: a program that used `while` as a name already failed with `E0013` (it was reserved), so no valid program changes meaning. The IR gains `Stmt::While`; the JS emitter writes `{ let t_0 = 0; while (cond) { if (++t_0 > 1000000) { rt.whileLimit(id); } … } }`, where `rt.whileLimit` throws the budget error that the host reports as `E8080`.

## Verification

`tests/syntax/pass/WhileStmt.mtek`, `tests/syntax/fail/e1001_while_without_block`; `tests/semantics/fail/game/e3070_while_condition_not_bool`, `e4010_while_in_material`; `tests/semantics/fail/e0013_loop_loop`; `packages/runtime-web/src/host/game.test.ts` (the cap reports `E8080`).
