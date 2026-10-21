# Browser Support: WebGPU Only, the Browsers It Covers, and the Unsupported-Browser Screen (v0.1 extension)

- Repository path: `spec/browser-support.md`
- Status: Normative for the small-game extensions (decision 0132).

---

## 1. The stance: WebGPU only, no WebGL2

Mtek draws with WebGPU and nothing else. There is no WebGL2 backend and none is planned for v0.1: the compiler's GPU target is WGSL (`spec/materials.md`), the runtime's resource model is WebGPU's bind groups, storage buffers and render pipelines (`spec/gpu-layout.md`), and a second backend would need a second shader language, a second layout and a second test matrix for every feature. Decision 0132 records the trade-off. A browser without WebGPU gets a clear screen (section 3), not a degraded game.

## 2. Browsers

What WebGPU covers today (gpuweb implementation status, October 2026), and what Mtek has evidence for:

| Browser | Where WebGPU is on by default | Mtek evidence |
|---|---|---|
| Chrome, Edge | 113+ on Windows, macOS, ChromeOS; 121+ on Android 12+; Linux only on some GPUs (others: `chrome://flags`, "Unsafe WebGPU Support" and "Vulkan") | the browser suite (`docs/supported-environments.md`) |
| Firefox | 141+ on Windows, 147+ on macOS (Apple silicon); Linux, Intel Macs and Android behind `dom.webgpu.enabled` | one Windows run of the suite, opt-in project `firefox` (decision 0107; 230 passed, 6 failed); the zero-sized-canvas failure is addressed in section 4 |
| Safari | 26+ on macOS 26, iOS 26, iPadOS 26, visionOS 26 | **none yet**: Playwright's WebKit on Windows has no `navigator.gpu` (decision 0107); a manual check in Safari 26 is listed in `TESTING-codey2.md` |

A row without evidence is an expectation, not a claim. `docs/supported-environments.md` lists only what was run (decision 0107) and is not changed by this specification.

Capabilities are decided by WebGPU queries only (adapter features and limits, `spec/runtime-abi.md` section 8.1), never by the user agent.

## 3. The unsupported-browser screen

When the mount fails with `E8004` (no `navigator.gpu`) or `E8005` (no adapter), the failure overlay (`spec/runtime-abi.md` section 6.1) starts with a plain-language panel, `[data-mtek-unsupported-browser="MTEK-E8004"]` (or `E8005`):

- the title **"This browser cannot show this game"** and one sentence on why;
- steps for the browser in use, chosen from the user agent (`packages/runtime-web/src/host/browser-support.ts`): update to the version that has WebGPU, the flag or preference that switches it on (Chrome on Linux, Firefox on Linux, older Safari), hardware acceleration and drivers for `E8005`, and https for a page that is not a secure context;
- the list of browsers that work.

The diagnostics follow below it unchanged, under the usual heading "Mtek could not run this program", so a developer still sees the code. With `failureDisplay: "none"` nothing is shown, as before. The user agent only selects text; it never decides whether the game runs.

## 4. Browser differences the runtime handles

- **A zero-sized canvas** (Firefox): a configured canvas context whose canvas becomes 0 pixels wide or high makes Firefox create a zero-sized texture, an uncaptured validation error. The surface unconfigures the context while the canvas has no pixels and configures it again when it has; nothing is drawn meanwhile in any browser.
- **Audio** (Safari): `webkitAudioContext` is used when `AudioContext` is missing (`spec/audio.md`).
- **Adapter information** (older Firefox and Safari): `adapter.info` may be absent and `isFallbackAdapter` omitted; the runtime records `null` (`packages/runtime-web/src/gpu/device.ts`).

## 5. Testing

- Unit: `packages/runtime-web/src/host/browser-support.test.ts` (user-agent guesses and advice), `overlay.test.ts` (the panel comes first and only for `E8004`/`E8005`), `app.test.ts` (the context is unconfigured while the canvas is zero-sized).
- Browser: `tests/browser/specs/m1/failures.spec.ts` checks the panel in Chromium with `navigator.gpu` removed.
- Opt-in projects: `MTEK_EXPERIMENTAL_BROWSER=firefox` and `MTEK_EXPERIMENTAL_BROWSER=webkit` (or `firefox,webkit`) add the `firefox` and `webkit` Playwright projects (`tests/browser/playwright.config.ts`).
- Manual: Safari 26 and Firefox on macOS have no automated run; `TESTING-codey2.md` lists the checks.
