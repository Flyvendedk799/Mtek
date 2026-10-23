# 0175. `ui(dt)`: a scene lifecycle function that runs while the game is paused

- Status: Accepted
- Date: 2026-10-23
- Supersedes: nothing. Builds on 0143 (the game pause) and 0134 (the HUD).

## Context

Decision 0143 says that UI which must stay live while the game is paused is "driven by input handlers and bindings", and that a UI runtime with its own per-frame work "reads `scheduler.gamePaused` and runs regardless". The HUD (0134) is immediate mode, though: `beginFrame` clears the list at the start of every frame, and a frame draws it from `update`. While the game is paused `update` does not run, so a paused game showed no HUD at all, and `hud.button` returns `true` only in a frame that calls it, so a "Resume" or "Restart" button could never be pressed. A pause menu and a "Play again" overlay, the two UI screens every game has, were not writable (game audit 2026-10-23, finding G1).

Options considered:

- **Keep the previous frame's HUD list while paused.** The buttons would be visible, but nothing runs to hear the click: `hud.button` is a call, and a click can only be claimed by a call. A key handler cannot stand in for it.
- **A handler for HUD clicks** (`on hud_click(label)`). Works while paused, but it splits one screen's drawing and its reactions over two members and needs the button identity to be a string match.
- **A lifecycle function that runs in every frame.** The screen is drawn and its buttons are asked in one place, as the HUD model already says (§1: "draw the HUD from `update`"). Existing programs do not change.

## Decision

1. **`ui(dt: f32) { … }`** is a lifecycle function of a **scene** (not of an entity or a prefab: `E5052`). At most one per scene (`E5051`); the parameter rules of `update` apply (`E5050`). Its effect level is `cpu`, like `update`: it may read and write state and call the handler-only intrinsics (`hud.*`, `play`, `go_to`, `reset`, `pause`, `resume`, `spawn`, `save`, ...).
2. **When.** Phase 3 of every rendered frame runs `ui(dt)` **after** `update` and the timers, with `dt` the clamped frame delta. Unlike `update` it runs also while the game is paused (`pause()`, 0143), and it is the only program function that does. It does not run while the application itself is paused (`app.pause()`, a hidden page), because no frame runs then.
3. **What stays held.** Everything 0143 holds still stands still: fixed ticks, physics, clips, particles, timers and `update`. `ui` is not a way to run game logic during a pause; it is the place to draw the pause menu, the title screen or the game-over overlay, and to hear their buttons.
4. **Order within a frame.** HUD items drawn by `update` come before those drawn by `ui` (the HUD list is cleared once per frame, in phase 1).
5. **Program ABI.** A scene object of `scenes` has an optional `ui: (ctx, dt) => void` member next to `update`. The compiler writes the key only for a scene that declares `ui`, so the output of every other program is unchanged. A runtime that meets a program without the key runs no UI phase. The ABI version stays 1.
6. **Not in the manifest.** There is no flag: the scene object is the program's, not the manifest's, and nothing in the manifest depends on it.
7. **Source compatibility.** `ui` is a contextual word like `update`: a program that named something `ui` (a state, a function, an entity) is unaffected, because a lifecycle function is recognised only as `ui(` at the start of a scene member. An entity or a prefab that declares one gets `E5052`.

## Examples

```mtek
ui(dt: f32) {
    if paused() {
        hud.rect(vec2(0.0, 0.0), vec2(320.0, 220.0), #000000a0);
        hud.text("Paused", vec2(0.0, 0.3), 40.0);
        if hud.button("Resume", vec2(0.0, 0.0)) { resume(); }
        if hud.button("Restart", vec2(0.0, -0.2)) { reset(); }
    }
}
```

## Verification

- `tests/semantics/pass/ui_lifecycle`; `tests/semantics/fail/e5052_ui_in_entity`, `e5052_ui_in_prefab`.
- `packages/runtime-web/src/schedule/scheduler.test.ts` (phase 3b), `host/game.test.ts` (the pause menu: HUD on screen while paused, a click on Resume resumes, Restart).
- `tests/browser/specs/m6/pause-menu.spec.ts` (pause, the HUD stays visible, clicking Resume resumes, in a real browser).
- `examples/small-game`, `examples/lane-runner`, `examples/hud-score`.
