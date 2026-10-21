# 0132. Browser support: WebGPU only, Firefox and Safari as WebGPU browsers, and an unsupported-browser screen

- Status: Accepted
- Date: 2026-10-21
- Specification: `spec/browser-support.md`.
- Small-game plan: phase 8, step 2.

## Context

Players open games in whatever browser they have. Mtek's only evidence is Chromium (and one Firefox run on Windows, decision 0107). A browser without WebGPU showed "Mtek could not run this program" and `MTEK-E8004`, which is right for a developer and opaque for a player.

## Decision

1. **WebGPU only; no WebGL2 backend.** The GPU target is WGSL with WebGPU bind groups and storage buffers; a WebGL2 path would be a second shader language (GLSL ES 3.0 without storage buffers), a second layout and a second test matrix for every feature, for browsers that are shrinking. WebGPU is on by default in Chrome and Edge (desktop and Android), Safari 26 and Firefox on Windows and Apple-silicon Macs. This is revisited only with evidence that a target audience lacks WebGPU.
2. **An unsupported-browser screen.** For `E8004` and `E8005` the failure overlay starts with a panel in plain words: what happened, steps for this browser (update, a flag, drivers, https), and the browsers that work. The diagnostics stay below it. The user agent chooses the text only; the decision to run is still WebGPU's (decision 0012's rule that capabilities come from feature and limit queries is unchanged).
3. **Firefox.** The zero-sized-canvas failure of the Firefox run (`Dimension X is zero`, an uncaptured validation error) is fixed by unconfiguring the canvas context while the canvas has no pixels. The other Firefox failures of that run are test-side (CDP sessions are Chromium-only, the three.js baseline's console warnings) or not investigated (`m4/assets.spec.ts`, an undecodable image, which Firefox decodes differently); they are left as they are.
4. **WebKit/Safari.** An opt-in Playwright project `webkit` exists (`MTEK_EXPERIMENTAL_BROWSER=webkit`), like `firefox`. Playwright's WebKit is not Safari and had no `navigator.gpu` on Windows; Safari 26 is checked by hand.
5. **No claim without a run.** `docs/supported-environments.md` is unchanged; `spec/browser-support.md` marks which rows are expectations.

## Consequences

- No new diagnostic code; `E8004`/`E8005` keep their meaning and their place in the overlay.
- Manual checks for Safari 26 and Firefox (macOS, Linux with the preference) are in `TESTING-codey2.md`; they need hardware this work did not have.
