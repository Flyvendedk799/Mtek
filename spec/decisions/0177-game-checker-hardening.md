# 0177. Game checker hardening: named cameras, enum state, entity_ref reads, timers

- Status: Accepted
- Date: 2026-10-23
- Specification: `spec/runtime-abi.md` §4.2, §5 and §11.3; `spec/scenes.md` §7.3; `spec/diagnostics.md` (`W5301`, `W8205`, `E3203`).
- Audit: `docs/audits/2026-10-23-game-audit.md`, findings C1, C2, C3, C5, C6 and R10.

## Decision

1. **A named camera is addressed by name (C1, R10).** `Wide.position = v` emits `ctx.setCameraOn("Wide", "position", v)`, and a read `Wide.position` emits `ctx.cameraOn("Wide").position`. Before, both went to `ctx.cam`, the active camera, so they moved or read the wrong camera whenever the scene had more than one. `setCameraOn` is also what bindings use. An unknown camera name is an internal error (`RuntimeInternalError`), like `selectCamera`; it used to write the active camera silently.
2. **Enum-typed host inputs stay rejected (C2).** The audit said an enum state could be a host input with the plain `u32` codec. It cannot: the checker types the state as `Level` (not `u32`), so `[host.inputs]` is `E9020` before the build packages anything. A fixture now pins that (`e9020_host_input_enum`). A range-checked codec would be possible, but a host that writes an enum has to know the variant order, which the language does not promise (decision 0129); a `u32` input plus a `match` in the program says the same thing explicitly.
3. **A reload or `go_to` carries state by its structural type (C6).** A user enum is the `u32` index of its variant, so two builds with different variant lists have the same `type` and the old index was carried over, naming another variant or none. The manifest's `storedType` (decision 0145) spells the variants out. It is now written for every state whose description differs from its `type` (an enum, a struct), not only for `saved` and `setting` state, and hot reload and the shared state of `go_to` compare it (`stateIdentity`) before they carry a value. A changed type drops the carry: the new `init` value stays, as for any other changed type. Persistent state is unchanged.
4. **Reading a field through an `entity_ref` is an ambient CPU read (C3).** Which entity a reference names, and where it is, is known only at run time. It now counts like `frame.time`: a pure `fn` that reads one is `E4002`, so it cannot be called from a `bind` and hide the read from the dependency order (`E5075` was blind to it). A binding that reads one directly was already `E5005`.
5. **Timers started unconditionally in `update` or `fixed_update` warn (C5).** `W5301` is reported at an `after` or `every` that stands directly in the body (or a plain block in it), not under an `if`, `match` or loop. The frequent shape that guards the start with a state flag is not flagged. The audit also named bindings: a binding is an expression and cannot contain a timer, so there is nothing to flag there. The runtime caps live timers at 4096; a timer started beyond the cap is not started and `W8205` is reported once per call site.
6. **`match` on a registry enum says so (C6).** `E3203` for `Key` and the other registry enums reads "needs a user enum".
7. **A constant `match` folds only the selected arm (C6).** An arm that cannot run no longer reports an overflow or a division by zero.
8. **Decisions 0143 and 0149 are corrected to the checker (C6).** `pause()` and `resume()` are allowed in `update`, `fixed_update` and handlers (not "handler-only"): a game over found in `update` has to be able to pause. The random helpers are usable in `cpu fn`s, not in a pure `fn`: a draw changes the generator, so it is an effect.
9. **`key_pressed` and `key_released` are per frame (C6).** They are delivered once per frame in phase 1. In `fixed_update` every tick of that frame sees the same answer, and a frame without a tick never shows the edge to `fixed_update`. This is documented (`spec/scenes.md` §7.3) instead of forbidden: forbidding it would need the transitive effect pass to know which `fn` runs from `fixed_update`, and `is_key_down` or an `on key_down` handler already cover the cases that need exactness.

## Alternatives considered

- **Keep `ctx.cam` for a single-camera scene.** It would keep the emitted text of one-camera programs, but which camera is active is a run-time property (`set_camera`), so the name is always passed.
- **A cancelling timer handle for C5.** A handle is a language feature (gap 9 of the audit), not a checker fix.
- **Warn on every timer in `update`.** `lane-runner` and the examples start timers from `update` behind a flag; the warning would fire on correct code.

## Verification

- `tests/browser/fixtures/m6/camera_named` and `tests/browser/specs/m6/camera-named.spec.ts` (Wide moves, Main does not); `packages/runtime-web/src/scene/world.test.ts` (named read and write, unknown name throws).
- `packages/runtime-web/src/host/reload-state.test.ts` (enum variants changed: the value is dropped).
- `tests/semantics/fail/e9020_host_input_enum`, `e5005_bind_reads_entity_ref_field`, `functions/e4002_reads_entity_ref_field`, `functions/e4002_calls_choose`, `functions/e4002_calls_key_pressed`, `functions/e4002_calls_tag_query`, `e5080_{go_to,reset,pause,set_camera}_in_function`, `enums/e3203_match_on_registry_enum`, `enums/e3202_*`; `tests/semantics/pass/w5301_timer_started_every_frame`, `timers_started_once`, `match_dead_arm_not_folded`.
- `packages/runtime-web/src/scene/timers-cap.test.ts` (the cap).
