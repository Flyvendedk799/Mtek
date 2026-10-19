# Supported environments (v0.1, measured)

This page lists the environments in which the Mtek browser test suite was run for the v0.1 draft, what passed, what failed and what was not run. Every row links to the stored result it comes from; an environment without a stored result is not on this page and nothing is claimed about it. The summary of the whole matrix is [`evidence/M7/environment-matrix.md`](../evidence/M7/environment-matrix.md); the decision behind it is [0107](../spec/decisions/0107-environment-matrix.md).

## How to read this page

- **Environment.** One operating system, one browser build, one way of launching it (a Playwright project, or a probe), on one machine. All local runs were made on one Windows 11 machine with an AMD Radeon RX 7900 XTX on 2026-10-19, from a clean clone of commit `7cf7ce9` (Firefox: a later commit of the same task, `8fbba0e`, which adds the opt-in Firefox project).
- **Projects.** `hardware` runs the specs on a real GPU adapter; `benchmarks` runs the three.js baselines of the benchmark tasks on a real GPU adapter; `software` runs the specs on SwiftShader, a software adapter, and is **informational only, never hardware evidence** (`spec/testing.md`). A hardware result counts only with `MTEK_REQUIRE_GPU=1`, which these runs used: a NOT-RUN test or a fallback adapter would have failed the run.
- **Passed, failed, NOT-RUN, skipped.** NOT-RUN means the test could not run (no adapter) and is never counted as passed. Skipped tests are skipped by design, with the reason in the linked summary.
- **As reported.** A row marked "as reported by GitHub Actions" was not reproduced locally: it is what the GitHub Actions run reported and uploaded, stored unchanged apart from path sanitisation.
- **Reproduce.** `MTEK_BROWSER_CHANNEL=chrome|msedge MTEK_REQUIRE_GPU=1 npm run test:browser` for the installed Chrome or Edge, `MTEK_EXPERIMENTAL_BROWSER=firefox MTEK_REQUIRE_GPU=1 npm run test:browser -- --project=firefox` for Firefox (needs `npx playwright install firefox`), `node tests/browser/support/probe-browser.ts --browser firefox|webkit|chromium --name NAME --out DIR` for a probe, `node tests/browser/support/summarize-run.ts DIR` for the summary.

## 1. Passed

| Environment | Browser | Project and adapter | Result | Evidence |
|---|---|---|---|---|
| Windows 11 | Playwright Chromium 153.0.8010.12 | `hardware`, AMD Radeon RX 7900 XTX | 251 passed, 0 failed, 0 NOT-RUN | [summary](../evidence/M7/environments/windows11-rx7900xtx-chromium-153/summary.md), [record](../evidence/M7/environments/windows11-rx7900xtx-chromium-153/environment-hardware.json) |
| Windows 11 | Playwright Chromium 153.0.8010.12 | `benchmarks`, AMD Radeon RX 7900 XTX | 104 passed, 0 failed, 0 NOT-RUN | [summary](../evidence/M7/environments/windows11-rx7900xtx-chromium-153/summary.md), [record](../evidence/M7/environments/windows11-rx7900xtx-chromium-153/environment-benchmarks.json) |
| Windows 11 | Playwright Chromium 153.0.8010.12 | `software`, SwiftShader (informational) | 236 passed, 0 failed, 15 skipped | [summary](../evidence/M7/environments/windows11-rx7900xtx-chromium-153/summary.md), [record](../evidence/M7/environments/windows11-rx7900xtx-chromium-153/environment-software.json) |
| Windows 11 | Google Chrome 155.0.8059.80 (installed, channel `chrome`) | `hardware`, AMD Radeon RX 7900 XTX | 251 passed, 0 failed, 0 NOT-RUN | [summary](../evidence/M7/environments/windows11-rx7900xtx-chrome-155/summary.md), [record](../evidence/M7/environments/windows11-rx7900xtx-chrome-155/environment-hardware.json) |
| Windows 11 | Google Chrome 155.0.8059.80 | `benchmarks`, AMD Radeon RX 7900 XTX | 104 passed, 0 failed, 0 NOT-RUN | [summary](../evidence/M7/environments/windows11-rx7900xtx-chrome-155/summary.md), [record](../evidence/M7/environments/windows11-rx7900xtx-chrome-155/environment-benchmarks.json) |
| Windows 11 | Google Chrome 155.0.8059.80 | `software`, SwiftShader (informational) | 236 passed, 0 failed, 15 skipped | [summary](../evidence/M7/environments/windows11-rx7900xtx-chrome-155/summary.md), [record](../evidence/M7/environments/windows11-rx7900xtx-chrome-155/environment-software.json) |
| Windows 11 | Microsoft Edge 155.0.4283.62 (installed, channel `msedge`) | `hardware`, AMD Radeon RX 7900 XTX | 251 passed, 0 failed, 0 NOT-RUN | [summary](../evidence/M7/environments/windows11-rx7900xtx-msedge-155/summary.md), [record](../evidence/M7/environments/windows11-rx7900xtx-msedge-155/environment-hardware.json) |
| Windows 11 | Microsoft Edge 155.0.4283.62 | `benchmarks`, AMD Radeon RX 7900 XTX | 104 passed, 0 failed, 0 NOT-RUN | [summary](../evidence/M7/environments/windows11-rx7900xtx-msedge-155/summary.md), [record](../evidence/M7/environments/windows11-rx7900xtx-msedge-155/environment-benchmarks.json) |
| Windows 11 | Microsoft Edge 155.0.4283.62 | `software`, SwiftShader (informational) | 236 passed, 0 failed, 15 skipped | [summary](../evidence/M7/environments/windows11-rx7900xtx-msedge-155/summary.md), [record](../evidence/M7/environments/windows11-rx7900xtx-msedge-155/environment-software.json) |

Each of the three Chromium-based browsers ran 606 tests (hardware 251, benchmarks 104, software 251 of which 15 were skipped by design) with the same counts; each has its own raw report, [Chromium](../evidence/M7/environments/windows11-rx7900xtx-chromium-153/test-results.json), [Chrome](../evidence/M7/environments/windows11-rx7900xtx-chrome-155/test-results.json) and [Edge](../evidence/M7/environments/windows11-rx7900xtx-msedge-155/test-results.json).

## 2. Ran, with failures

| Environment | Browser | Project and adapter | Result | Evidence |
|---|---|---|---|---|
| Windows 11 | Playwright Firefox 155.0, headed, with the WebGPU preferences `dom.webgpu.enabled` and `gfx.webgpu.ignore-blocklist` | `firefox`, an adapter whose identity Firefox does not expose (`isFallbackAdapter` false) | 230 passed, 6 failed, 0 NOT-RUN, 15 skipped | [summary](../evidence/M7/environments/windows11-rx7900xtx-firefox-155/summary.md), [record](../evidence/M7/environments/windows11-rx7900xtx-firefox-155/environment-firefox.json) |
| GitHub Actions, Ubuntu (Linux 6.17, x64) | Playwright Chromium 153.0.8010.12 | `software`, SwiftShader, as reported by GitHub Actions, not reproduced locally | 231 passed, 2 failed, 0 NOT-RUN, 13 skipped | [summary](../evidence/M7/environments/github-actions-ubuntu-swiftshader-run-39185877322/summary.md), [record](../evidence/M7/environments/github-actions-ubuntu-swiftshader-run-39185877322/environment-software.json), [run](../evidence/M7/environments/github-actions-ubuntu-swiftshader-run-39185877322/run.json) |

What failed:

- **Firefox, two three.js baseline specs** (`baselines/m0-bridge.spec.ts`): they assert that the page logs no console message, and Firefox logs a warning that three.js asks for a `compatibility` feature level, which Firefox does not support yet. Not Mtek code ([summary](../evidence/M7/environments/windows11-rx7900xtx-firefox-155/summary.md)).
- **Firefox, two specs that use the Chrome DevTools Protocol** (`m4/configurator.spec.ts`, `m4/resilience-resize.spec.ts`, pixel-ratio changes): `newCDPSession` exists in Chromium only. The test harness, not the runtime, is Chromium-specific here ([summary](../evidence/M7/environments/windows11-rx7900xtx-firefox-155/summary.md)).
- **Firefox, `m4/assets.spec.ts`** (a deliberately corrupt PNG must be rejected as `E7031`): Firefox decoded the file, so the runtime reported success. Which of the two decoders is stricter was not investigated ([summary](../evidence/M7/environments/windows11-rx7900xtx-firefox-155/summary.md)).
- **Firefox, `m4/resilience-resize.spec.ts`** (a zero-sized canvas must render nothing without an error): Firefox reports an uncaptured GPU validation error, `MTEK-E8050`, "Dimension X is zero". This is a difference in the runtime's behaviour on Firefox that no Chromium run shows; the cause was not investigated ([summary](../evidence/M7/environments/windows11-rx7900xtx-firefox-155/summary.md), [report](../evidence/M7/environments/windows11-rx7900xtx-firefox-155/test-results.json)).
- **GitHub Actions, `m4/dev-overlay.spec.ts` and `m6/getting-started.spec.ts`**: "A valid external Instance reference no longer exists" in the dev-overlay spec (the known intermittent failure of the M6 report) and "the cube is on the page" in the getting-started spec (the real page showed none of the cube's pixels). The run belongs to commit `c588dd3`, the head pushed at that time, not to the commit of the local runs; the job `browser-software (ubuntu-latest)` failed and the other five jobs of that run succeeded ([run](../evidence/M7/environments/github-actions-ubuntu-swiftshader-run-39185877322/run.json), [summary](../evidence/M7/environments/github-actions-ubuntu-swiftshader-run-39185877322/summary.md)). The `browser-software` job failed in seven of the ten latest runs on `main` that the same file lists, as reported.

## 3. Not run

| Environment | Browser | Launch configuration | Why | Evidence |
|---|---|---|---|---|
| Windows 11 | Playwright Firefox 155.0, headless | default; `dom.webgpu.enabled`; `dom.webgpu.enabled` with `gfx.webgpu.ignore-blocklist` | `navigator.gpu` exists but `requestAdapter()` resolves to null in all three headless configurations, so the suite would be NOT-RUN; only the probe ran | [summary](../evidence/M7/environments/windows11-firefox-155-probes/summary.md), [record](../evidence/M7/environments/windows11-firefox-155-probes/environment-firefox-default.json), [record](../evidence/M7/environments/windows11-firefox-155-probes/environment-firefox-webgpu-pref.json), [record](../evidence/M7/environments/windows11-firefox-155-probes/environment-firefox-blocklist-ignored.json), [record](../evidence/M7/environments/windows11-firefox-155-probes/environment-firefox-headed.json) |
| Windows 11 | Playwright WebKit 26.6 | default | `navigator.gpu` is undefined, so there is no WebGPU to test; only the probe ran | [summary](../evidence/M7/environments/windows11-webkit-26-probe/summary.md), [record](../evidence/M7/environments/windows11-webkit-26-probe/environment-webkit-default.json) |

The headed Firefox probe with both preferences is the one that obtained an adapter; its record is the evidence that the Firefox row of section 2 had an adapter to run on.

## Not covered

This page has no row for macOS, for Linux with a hardware GPU, for other GPUs or vendors, for Safari, for mobile browsers or for any browser version other than those above, because no run exists for them. That is the absence of a measurement, not a statement that they fail or that they work. The only Linux evidence is the software-adapter job of GitHub Actions, and it is software evidence.
