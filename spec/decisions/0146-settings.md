# 0146. Settings: `setting state` saves itself

- Status: Accepted
- Date: 2026-10-21
- Builds on: decision 0145 (saved state, the store, the checks and codes).

## Contract

A setting (volume, a control scheme, a difficulty) is chosen once and expected to stick, without a "save" step.

- `setting state name: T = value;` in a scene (also `shared setting state`) is persistent like `saved state` (decision 0145). The checks are `E5210`, `E5211` and `E5212`; a name is either `saved` or `setting` in every scene. It is restored when a scene starts, written by `save()`, read by `load()` and deleted by `clear_saved()`.
- **Autosave.** At the end of every frame (after rendering is submitted and host outputs are published), the runtime compares the settings of the running scene with their values when last read or written. If one changed, it writes the settings. A `saved state` is never written by autosave.
- A value set in a handler and set back before the end of the frame is not written. A change in a paused game is written, because the end of the frame comes while paused.

## Why

- **Settings and progress differ in when they should be written.** Progress at a checkpoint the game chooses; a setting the moment it changes, or a player who closes the tab after changing the volume loses it. One keyword per kind keeps the program free of save calls in every menu handler.
- **End of frame, on change.** Comparing a few small values once per frame is cheap. The program text has no way to say "a setting changed" without a hook on every assignment. Writing only on change keeps `localStorage` writes, which are synchronous, rare.

## Alternatives considered

- **Write on every assignment.** It would need a hook in generated code for every assignment to a setting, and a loop that slides a value would write once per iteration.
- **Settings in `mtek.toml` or the host.** Then they would not be values of the program, and handlers could not change them.

## Verification

`packages/runtime-web/src/scene/saves.test.ts` ("autosave of settings") and `src/host/game.test.ts` (written at the end of the frame it changed in, a saved state only on `save()`); `tests/semantics/pass/saved_state`; `examples/lane-runner` (the spin setting).
