# HUD: Text, Rectangles and Buttons over the Canvas (v0.1 extension)

- Repository path: `spec/hud.md`
- Status: Normative for the small-game extension (decision 0134). Lifts "text and UI" from `spec/scenes.md` section 14 for screen-space HUDs.
- Depends on: `spec/stdlib.md` section 2 (the `hud` namespace), `spec/language.md` section 5.8 (interpolated strings), `spec/runtime-abi.md` (the `ctx` contract).

---

## 1. Model

The HUD is **immediate mode**. A frame draws it by calling `hud.text`, `hud.rect` and `hud.button`. What a frame draws is shown over the canvas until the next frame. The list is cleared at the start of every frame (phase 1, `spec/scenes.md` §10) and shown after rendering (phase 7). Draw the HUD from `update`:

- What a handler draws is shown for that frame only.
- What `fixed_update` draws is drawn once per tick.

The HUD is not part of the scene graph. It has no entities, no state and no bindings; the program's state is the HUD's state.

```mtek
scene Hud {
    state points: i32 = 0;
    camera Cam { position: vec3(0.0, 0.0, 5.0); }
    update(dt: f32) {
        hud.text("Score: ${points}", vec2(-0.95, 0.9), 28.0, #ffffff, 0.0);
        hud.rect(vec2(-0.95, 0.8), vec2(4.0 * f32(points), 12.0), #40d070, 0.0);
        if hud.button("Add a point", vec2(0.0, -0.8)) {
            points += 1;
        }
    }
}
```

## 2. Calls

| Call | Draws |
|---|---|
| `hud.text(content: string, at: vec2[, size: f32[, tint: color[, align: f32]]])` | One line of text. `size` is in CSS pixels (default `24.0`) and `tint` defaults to white. `align` places the text horizontally relative to `at`: `0.0` puts the left edge at `at`, `0.5` the centre (the default) and `1.0` the right edge. The line is centred vertically on `at`. Newlines in `content` start new lines. |
| `hud.rect(at: vec2, size: vec2, tint: color[, align: f32])` | A filled rectangle of `size` CSS pixels, centred vertically on `at` and aligned horizontally like `hud.text`. Panels and bars. |
| `hud.button(label: string, at: vec2[, size: f32]) -> bool` | A button centred on `at` (`size` is the label's size, default `24.0`). Returns `true` in the frame after the button was clicked, once per click (§4). |

- `at` is a point in the **normalised device coordinates of the canvas**, the same as `PointerEvent.position`: `x` goes right and `y` goes up, both from `-1` to `1`, so `vec2(-1.0, 1.0)` is the top-left corner. A HUD placed this way follows the canvas size.
- The calls are CPU only and **handlers-only**, like the audio calls: they may be called in lifecycle functions and event handlers, not in a function (`E5080`, also for a `cpu fn`), a `bind` or a constant. A helper function can compute the text, as a `string`, for the handler to draw.
- `tint` is a linear `color` (`spec/language.md` §5.4), shown as sRGB with its alpha.
- Text is shown as text, never parsed as HTML.

## 3. Sizes

Sizes are CSS pixels:

- Text and button sizes are `1.0 … 512.0`.
- Each rectangle side is `0.0 … 8192.0`.
- A constant outside its range is `E5601`.
- A value computed at run time is clamped to the range, and a value that is not finite becomes the default.

## 4. Buttons

- A click is queued and claimed by the first `hud.button` call of a later frame with the same `label` at the same position among this frame's buttons with that label. Two buttons with different labels never share clicks; two "OK" buttons are told apart by their order.
- A click that no call claims in the next frame is dropped. When the button is not drawn that frame, nothing reports it.
- A click on a button does not reach the canvas (no `pointer_down` for it). The rest of the HUD lets pointer events through to the canvas.
- Pressing a button does not focus it, so `Space` and `Enter` keep reaching the program's key handlers.

## 5. Runtime

- The runtime keeps a DOM layer over the canvas (`[data-mtek-hud]`), positioned like the failure overlay. The list maps onto reused elements, and a property is written only when it changed.
- At most 512 items are shown per frame. Further items are not shown, and `W8203` is reported once per call site.
- Without a document (a worker, a test without a DOM) the calls do nothing and `hud.button` returns `false`.
- Release, dev, test and preview builds behave the same (no inline HTML, so preview CSPs allow it).

## 6. Not in this extension

- Text in the 3D world (labels that follow an entity).
- Fonts other than the system UI font, and rich text.
- Layout (rows, columns, wrapping to a width).
- Text input fields.
- Images in the HUD.
- Gamepad or keyboard navigation between buttons.
- HUD state in `mtek test` fixtures: a fixture cannot click a HUD button or read the HUD.
