# 0142. Timers: `after(seconds) { }` and `every(seconds) { }` on the game clock

- Status: Accepted
- Date: 2026-10-21
- Supersedes: nothing.

## Contract

Games spawn waves every few seconds, end a power-up after five, show a message for two. Counting `dt` in a state per timer is error-prone and clutters `update`.

- `after(t) { … }` runs its block once, `t` seconds of game time from now; `every(t) { … }` every `t` seconds until the scene ends or its entity is destroyed. Statements, not expressions: there is no handle and no cancel in v0.1 (a state flag checked in the block cancels).
- `t` is `f32` seconds (`E3001`). A constant `t` must be ≥ 0 for `after` and > 0 for `every` (`E3211`); a run-time value is clamped (negative or NaN → 0; a period ≤ 0 → once per frame).
- Handler-only (`E5080`): scene, entity and prefab lifecycle functions and handlers.
- The block captures the values of the `let` locals, parameters and loop variables around it when the timer starts; a `var` of the surrounding body cannot be used (`E3210`, the variable no longer exists). `return;` leaves the block; `break`/`continue` cannot cross it (`E1030`).
- **Game clock.** Timers advance with the frame delta of the frames in which the game is not paused, at the start of phase 3, before `update`; ordered by due time, then start order. A timer started while timers run waits for the next frame. `every` runs at most once per frame and never in a burst after a long frame. A timer of an entity is dropped when the entity dies.
- `after` and `every` are contextual words: `after(` … `)` followed by a block is the statement; `let after = 2.0;` remains a name.

## Alternatives considered

- **Timer functions with closures** (`after(2.0, fn() { })`). Mtek has no closures; a block statement needs none and is checked like any block.
- **Timers on `frame.time`.** They would fire during a game pause and after a scene change would count from mount; the game clock is what a game means.
- **Handles and cancellation.** Need a new value type; deferred.

## Consequences

The IR gains `Stmt::Timer { every, seconds, body }`; the JS emitter lowers it to a local function handed to the runtime, `{ function t_0() { … } ctx.after(seconds, t_0, self, id); }` (the owner is `self` in an entity's or prefab's bodies, `null` in a scene's); `let` locals and parameters are immutable, so the closure sees the values they had when the timer started. The runtime's `TimerList` lives in the world and is cleared by a scene change.

## Verification

`tests/syntax/pass/TimerStmt.mtek`, `tests/syntax/fail/e1001_timer_two_arguments`, `e1030_break_in_timer`; `tests/semantics/fail/game/e3210_*`, `e3211_*`, `e3001_timer_time_not_f32`, `e5080_timer_in_function`; `packages/runtime-web/src/host/game.test.ts` (ordering, paused time, owner death).
