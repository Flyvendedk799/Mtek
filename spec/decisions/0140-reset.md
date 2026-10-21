# 0140. `reset()`: restarting the scene that runs

- Status: Accepted
- Date: 2026-10-21
- Supersedes: nothing. Relies on decision 0141 (the scene change it reuses).

## Contract

A small game restarts: after a game over, on a key, after a level. Without `reset()` a program resets every state, destroys every spawned entity and teleports every body by hand, and forgets one. `reset()` restarts the scene that runs as if it had just been mounted.

- `reset()` is an intrinsic `() -> ()`, handler-only like `spawn` (`E5080` in a function or an initialiser).
- It requests a scene change to the scene that runs. The change is prepared like any other (`spec/runtime-abi.md` §11.4): the program module is reused, the manifest, shaders, assets and physics are prepared afresh, `init` runs, and the fresh scene replaces the old one at the start of a later frame. The rest of the frame of the call runs as usual.
- Everything restarts from its initial values: state, **shared state included**, named and spawned entities, bodies, timers, the game pause. To keep the shared state, `go_to(ThisScene)` restarts the scene and carries it (decision 0141).
- Only the first `reset()` or `go_to` counts until it is applied or fails; later calls are ignored. A failure reports `E5401` and the scene keeps running.
- Input state (held keys, pointer) and the application's clock belong to the application and are not reset; `frame.time` keeps counting.

## Alternatives considered

- **Reset in place** (re-run the initialisers into the live world). It would keep GPU resources, but every subsystem (physics, spawned entities, bindings, timers) would need a reset path of its own, and a half-reset world is worse than a fresh one. The fresh prepare already exists for hot reload; reusing it makes `reset()` cost one code path.
- **Reset keeps shared state.** Rejected: "reset" reads as a full restart; a high score is kept by switching to the same scene with `go_to`, which says so.
- **Immediate reset** (inside the handler). Rejected for the same reason as an immediate `go_to`: the handler's remaining statements would run against a world that no longer exists.

## Consequences

- `reset`, `pause`, `resume`, `paused` and `go_to` become prelude function names. A local, parameter, `state` or `param` may still reuse them (`spec/language.md` §4.2); a module item (`fn reset()`) may not (`E2001`), which is a source break for a program that had such an item. No example, fixture or test project of the repository has one.
- The context export lists `reset|pause|resume() -> ()` on one line without documentation, the preset rule of decision 0112 item 3 extended to global functions (the cold-start budget).

## Verification

`tests/semantics/pass/game_flow` (checks and builds), `packages/runtime-web/src/host/game.test.ts` (`reset` restarts state and clears shared state), `crates/mtek-compiler/tests/stdlib_registry.rs` (the row).
