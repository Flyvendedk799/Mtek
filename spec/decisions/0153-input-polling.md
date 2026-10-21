# 0153. Input polling: edges and the pointer

- Status: Accepted
- Date: 2026-10-21

## Context

Handlers (`on key_down`, `on pointer_move`) report transitions, and `is_key_down` reports whether a key was down at the end of phase 1 (`spec/scenes.md` §7). A game also asks "did this key go down this frame" without a handler per key, and "where is the pointer" without storing the last move.

## Decision

1. **Edges.** `key_pressed(key) -> bool` and `key_released(key) -> bool` are true when that transition was delivered this frame. A key that goes down and up in one frame makes both true, and `is_key_down` false. The sets are cleared at the start of the next `deliver`.
2. **Pointer.** `pointer_position() -> vec2` is the last delivered pointer position, in the same NDC as `PointerEvent` (`x` right, `y` up). It is `(0, 0)` until a move or a button change. `is_pointer_down(button: i32) -> bool` is true for button 0, 1 or 2 when that button was down at the end of phase 1. Any other button is false, with no diagnostic.
3. **Same rules as `is_key_down`.** CPU only. Legal in handlers, lifecycle functions and `cpu fn`s. `E4002` in a `fn`, `E5005` in a `bind`. The game pause does not stop input delivery (`spec/scenes.md` §15.4): polling sees the keys and the pointer while `update` is held.
4. **ABI.** `ctx.keyPressed`, `ctx.keyReleased`, `ctx.pointerPosition`, `ctx.isPointerDown`.

## Verification

- `tests/semantics/pass/input_polling`.
- `packages/runtime-web/src/input/input.test.ts` (edges cleared on the next deliver, pointer copy, unknown button).
