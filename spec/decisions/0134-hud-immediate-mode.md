# 0134. HUD: an immediate-mode `hud` namespace drawn as a DOM layer over the canvas

- Status: Accepted
- Date: 2026-10-21
- Specification: `spec/hud.md`, `spec/stdlib.md` §2 (`hud`), `spec/scenes.md` §14.
- Small-game plan: phase 1 (text, strings and HUD), step 2.

## Context

Small games show a score, a timer, lives, a health bar and a few buttons (start, retry, mute). v0.1 had no text and no UI (`spec/scenes.md` §14). Interpolated strings (decision 0133) make the text; this decision is how it reaches the screen.

## Decision

1. **Immediate mode** (proposal). Three CPU, handlers-only calls in a namespace: `hud.text`, `hud.rect`, `hud.button`. A frame draws the HUD again; the runtime clears the list in phase 1 and shows it after rendering. This was preferred to a retained `text: Text {..}` entity component because:
   - There is no new schema category, manifest section, IR place or binding target. A component would mirror the `light` path through the checker, the IR, the manifest, the runtime records and the bindings.
   - Program state is the only state. There is nothing to keep in sync, and `if` decides what is shown.
   - Buttons fit naturally as `if hud.button(..) { .. }`.
   The cost is that a HUD drawn from a handler shows for one frame (documented; draw from `update`).
2. **Namespace, not bare intrinsics.** `hud.text` cannot collide with a user's `text` state or function, and the namespace groups the HUD in the reference.
3. **Coordinates.** Positions are canvas NDC with y up, the same as `PointerEvent.position`, so pointer logic and HUD placement share one space and follow resizes. Sizes are CSS pixels, so text is readable at any canvas size. `align` (0 left, 0.5 centre, 1 right) is the only layout.
4. **DOM, not GPU text** (proposal). The runtime draws the HUD as DOM elements in a layer over the canvas, positioned like the failure overlay. This gives crisp text at every DPI, the system font with every script and emoji, no glyph atlas and no shader. Clicks come from real `<button>`s. Text is set through `textContent` only. Elements are reused by list position and properties are written only when they change. GPU text (SDF atlas) would be needed for text in the 3D world and is not part of this decision.
5. **Buttons.** A click is queued and claimed by the next frame's call with the same label and order among same-label buttons, once. Unclaimed clicks are dropped at the end of that frame. A button press does not take focus, so the game keeps its keys, and it does not reach the canvas's pointer handlers.
6. **Limits and codes.**
   - `E5601`: a constant size outside text 1-512 px, rectangle 0-8192 px.
   - Run-time sizes are clamped silently.
   - `W8203`: more than 512 items in a frame, once per call site.
7. **No document, no HUD.** Without a DOM the calls do nothing and buttons return `false`.

## Consequences

- New codes `E5601`, `W8203`.
- New runtime module `packages/runtime-web/src/hud/hud.ts`, `ctx.hud`, hooks in phase 1 and phase 7 of the app.
- `mtek test` fixtures cannot observe or click the HUD (state-only fixtures still run `update`).
- Handlers-only means a `cpu fn` cannot draw (`E5080`). Helper functions return strings instead.

## Verification

- Compiler: `tests/semantics/pass/hud_text_rect_button`, `tests/semantics/fail/e5601_hud_size_out_of_range`, `tests/syntax/pass/HudCalls.mtek`, `crates/mtek-compiler/tests/stdlib_registry.rs` (`the_hud_namespace_has_its_overloads`).
- Runtime: `packages/runtime-web/src/hud/hud.test.ts` (reuse, removal, click once, unclaimed click dropped, cap and `W8203`, clamping, sRGB, dispose).
- Example `examples/hud-score` with the fixture `space-scores-r-resets`.
- In a browser: `TESTING-codey2.md`, section "Phase 1.2". Not run here.
