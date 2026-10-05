# 0050. Running generated code: input delivery, `random`, `print` and the scene object check: details the specification leaves open

- Status: Accepted
- Date: 2026-10-05
- Blueprint origin: M3 (blueprint §11), task M3-03; `spec/scenes.md` §§7, 10; `spec/runtime-abi.md` §§4.2, 7, 10.2; decisions 0031 (the runtime context), 0049 (state, lifecycle functions, handlers).
- Supersedes: nothing.

## Context

The frame scheduler of `spec/runtime-abi.md` §7 has existed since M1 with phases 1–5 empty. M3-03 makes it run generated code. The specification fixes the order and the input guarantees but not the data structures, which events share a frame, what `preventDefault` covers, or how `random` is seeded from a number. Every choice below is a **proposal**.

## Decision

1. **Phases.** The scheduler is unchanged. Phase 1 sets `ctx.frame`, then delivers the queued input transitions; phase 2 calls `fixedUpdate` once per tick; phase 3 calls `update`; phases 4–5 stay empty until M5 and M3-05. Lifecycle functions receive `dt` and the fixed step rounded to binary32.
2. **Order** comes only from arrays: the scene's function, then `entityUpdate[i]`/`entityFixedUpdate[i]` by index. Handlers for one event are ordered by owner (the scene, then entities by index, a stable sort) and keep declaration order within an owner, whatever order the program lists them in. No object whose keys a program chose is ever iterated; state objects have no prototype, so a state named `constructor` or `__proto__` is an ordinary entry.
3. **Two views of every key.** The *arrival* view (what the browser has done) decides whether an event is news, so auto-repeat and a second `keydown` are dropped; the *delivered* view (what generated code has been told) is what `is_key_down` reads, i.e. the state as of the end of phase 1. A press and a release in one frame deliver both, in arrival order.
4. **Pointer.** Only the primary pointer counts; buttons 0, 1, 2 only; positions are NDC (`y` up) clamped to `[-1, 1]` and rounded to binary32. `pointer_move` is coalesced to **one event per frame with the latest position, delivered after the frame's other transitions** (the alternative, delivering the coalesced move at the position of the first move, would show a handler a position older than a later press). A recognised press captures the pointer so its release is not lost outside the canvas; `pointercancel` releases the held buttons only.
5. **Focus.** Window `blur` and a hidden document queue a release for every held key and button, delivered at the next frame. A paused app discards transitions that arrive while paused and those not yet delivered; `resume` releases whatever generated code believed held (the same re-synchronisation as focus loss). A key still physically held after resume is not pressed again, because its auto-repeat events carry `repeat`.
6. **`preventDefault`** is called only for `Key` codes some `key_down`/`key_up` handler names. A key that is only *polled* with `is_key_down` keeps its browser default (page scrolling for arrows); the manifest does not list polled keys yet. Known limitation, revisited with M3-06.
7. **`random()`** is xoshiro128**; the 32-bit seed (`mountMtek` `seed`, else derived from the clock) is expanded with splitmix32, and a value is the top 24 bits over 2²⁴, an f32 in `[0, 1)`. The generator exists before `init`, so a state initialiser may call it. The test compares against an independent BigInt implementation.
8. **`ctx`** gains `s` (scene state), `random`, `isKeyDown(code)` (a DOM code, as `Key` members compile to) and `print(message, spanId)`; entity records' `state` and `ctx.s` are pre-created with every declared name at its zero value. `print` writes through `HostEnvironment.log` (`console.log` in a browser); release builds compile it out.
9. **The scene object is validated** at mount: `update`/`fixedUpdate` are functions or `null`, `entityUpdate`/`entityFixedUpdate` have one slot per static entity, and every `events` entry has a function, an owner in `[-1, entities)` and, for key events only, a string `key`. Anything else is `E8003`, with the field named.
10. **Test control.** `debug.pressKey`/`releaseKey` take a DOM code of a `Key` member (anything else throws `RangeError`) and go through the same queue as the DOM listeners; `debug.scene().state` is a copy of the scene state. `HostEnvironment` gains optional `window` and `log`.

## Consequences

- `liveListeners` of a mounted app is 8: the document's `visibilitychange`, `keydown`, `keyup`; the window's `blur`; the canvas's four pointer events. `dispose()` removes all of them.
- The golden program loader of the runtime tests bundles the real `rt` math with esbuild, so lifecycle functions of compiler output run in Node.

## Verification

`src/input/*.test.ts`, `src/random/xoshiro.test.ts`, `src/scene/program.test.ts` and `src/host/behavior.test.ts` (frame order, f32 `dt`, catch-up and discarded steps, frame values, adversarial names, deterministic `random`, `is_key_down`, press and release in one frame, DOM events, blur, hidden document, pause/resume, the compiler's `state_and_handlers` program end to end): `npm run test:unit`.
