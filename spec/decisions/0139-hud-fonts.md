# 0139. HUD fonts: font assets and a built-in pixel font

- Status: Accepted
- Date: 2026-10-21
- Specification: `spec/hud.md` §2, §6; `spec/diagnostics.md` (`E7105`, `E7106`, `W8204`); `spec/manifest.schema.json` (`fontAsset`).
- Small-game plan: phase 1 (fonts).

## Decision

1. **Font assets are validated like GLBs.**
   - `asset.font(path)` checks the extension (`E7105`) and the header bytes (`E7106`) when the program is checked.
   - The file is packed byte for byte, under a hash name with its own extension.
   - The manifest entry has kind `font`, with `format`, `mime`, `source` (the declaring project path, by which generated code names it) and `span`.
   - The compiler does not parse glyph tables: a font with a valid header that the browser still rejects is the run-time warning `W8204`, and the text falls back to the default family.
2. **One built-in default font.** `hud.pixel_font()` is a 5×8 pixel bitmap of printable ASCII, stored in the runtime as 475 bytes of columns.
   - It is drawn as an SVG background with `shape-rendering: crispEdges` and is exactly `size` CSS pixels tall. It is therefore identical in every browser, which is the point of a game font.
   - The text is kept in `aria-label`.
   - It was chosen over an SDF atlas: the HUD is DOM-based (decision 0134), and an SDF atlas only pays off for text drawn by the GPU.
3. **`hud.text` takes an optional sixth argument `font`.** Omitting it keeps the previous default (the page's sans-serif UI font), so existing programs do not change.
4. **`font` is a CPU-only resource type.** It cannot be carried by `go_to`, used as a material param or a body value, or used in GPU code.

## Consequences

- There are no new compile-time checks of glyph coverage. A character missing from an asset font is drawn by the browser's fallback.
- Fixtures:
  - `tests/assets/pass/hud_fonts` (Russo One, SIL OFL 1.1, licence file beside it);
  - `tests/assets/fail/e7105_unsupported_font`;
  - `tests/assets/fail/e7106_malformed_font`.
- Tests:
  - `assets/font.rs` (unit tests for the four formats and each failure);
  - `hud/fonts.test.ts` (registration, `W8204`, the family in the DOM, the pixel SVG, glyph lookup).
