# 0143. `pause()`, `resume()` and `paused()`: the game pause

- Status: Accepted
- Date: 2026-10-21
- Supersedes: nothing. Distinct from the host's `app.pause()` (`spec/runtime-abi.md` §6.2).

## Contract

A pause menu stops the game but not the menu. `pause()` holds the game; input, bindings and rendering keep running so that a handler can show, navigate and close the menu.

- `pause()`, `resume()`: `() -> ()`, allowed in lifecycle functions (`update`, `fixed_update`) and event handlers, `E5080` anywhere else (a `fn`, a `cpu fn`, an initialiser). The first version of this text said "handler-only"; decision 0177 corrects it to what the checker has always done and what `spec/language.md` says of timers, because a game over detected in `update` has to pause from there. `paused()`: `() -> bool`, CPU, usable anywhere on the CPU.
- While paused: no fixed tick (no `fixed_update`, physics step or collision events), no phase 3 (no timers, no `update`), the fixed-step accumulator and the game clock stand still. Input handlers, the spawn/destroy flush, bindings, transforms and rendering go on; `frame.time` and `frame.delta` keep counting active time.
- The pause is a flag of the scheduler (`gamePaused`, `pauseGame()`, `resumeGame()`), visible to the host and to the UI runtime. A scene change clears it.
- The host's `app.pause()` stops everything and is independent: `app.resume()` does not resume a paused game.

**HUD/UI hook** (for the text and UI work of Phase 1): UI that must stay live while the game is paused is driven by input handlers and bindings, which run; it must not depend on `update` or timers. A UI runtime that needs its own per-frame work reads `scheduler.gamePaused` and runs regardless.

## Alternatives considered

- **`frame.time_scale = 0`.** One knob for slow motion and pause, but a zero scale still runs `update` with `dt = 0`, which programs that divide by `dt` or count frames get wrong, and physics would need special handling anyway.
- **Pause stops input too.** Then no handler could unpause; the menu would need a separate input path.

## Verification

`tests/semantics/pass/game_flow`; `packages/runtime-web/src/host/game.test.ts` (no update or tick while paused, input handled, timers hold, resume).
