# M7-03 Environment matrix

- Work item: M7-03 (blueprint §11, M7). Decision: [0107](../../spec/decisions/0107-environment-matrix.md). The page that lists the result for readers is [`docs/supported-environments.md`](../../docs/supported-environments.md); it is checked against the files below by `npm run check:release`.
- Every run is stored under [`environments/`](environments/): the environment record(s) written by the test harness (`environment-<project>.json`), the Playwright report with its paths made machine-neutral (`test-results.json`) and a `summary.md` generated from both by `tests/browser/support/summarize-run.ts`.
- All local runs: one Windows 11 machine (10.0.26200, x64) with an AMD Radeon RX 7900 XTX, 2026-10-19. The Chromium run is the browser step of the clean-install run of [M7-07](reproducible-builds.md), from a clean clone of commit `7cf7ce9`; the Chrome and Edge runs are the same command with `MTEK_BROWSER_CHANNEL` set, in the same clone. The Firefox run was made from the task branch at `8fbba0e` (it adds the opt-in Firefox project). All used `MTEK_REQUIRE_GPU=1` and the machine's GPU lock.

## What ran, and the result

| Environment | Result | Stored run |
|---|---|---|
| Windows 11, Playwright Chromium 153.0.8010.12, RX 7900 XTX | passed: hardware 251, benchmarks 104, software (SwiftShader, informational) 236 with 15 skipped; 0 failed, 0 NOT-RUN | [`windows11-rx7900xtx-chromium-153`](environments/windows11-rx7900xtx-chromium-153/summary.md) |
| Windows 11, installed Google Chrome 155.0.8059.80, RX 7900 XTX | passed: the same counts | [`windows11-rx7900xtx-chrome-155`](environments/windows11-rx7900xtx-chrome-155/summary.md) |
| Windows 11, installed Microsoft Edge 155.0.4283.62, RX 7900 XTX | passed: the same counts | [`windows11-rx7900xtx-msedge-155`](environments/windows11-rx7900xtx-msedge-155/summary.md) |
| Windows 11, Playwright Firefox 155.0 (headed, WebGPU preferences) | ran, **6 failed**: 230 passed, 15 skipped, 0 NOT-RUN. Two three.js baseline specs (a console warning of Firefox about three.js), two specs that use the Chrome DevTools Protocol, one decoder difference (a corrupt PNG is accepted) and one difference of the runtime (a zero-sized canvas gives `MTEK-E8050` on Firefox) | [`windows11-rx7900xtx-firefox-155`](environments/windows11-rx7900xtx-firefox-155/summary.md) |
| GitHub Actions, Ubuntu, Playwright Chromium 153.0.8010.12, SwiftShader (**as reported by GitHub Actions, not reproduced locally**) | ran, **2 failed**: 231 passed, 13 skipped, 0 NOT-RUN; run 39185877322 on commit `c588dd3` | [`github-actions-ubuntu-swiftshader-run-39185877322`](environments/github-actions-ubuntu-swiftshader-run-39185877322/summary.md) |
| Windows 11, Playwright Firefox 155.0, headless (three configurations) | **not run**: `navigator.gpu` present, `requestAdapter()` resolves to null | [`windows11-firefox-155-probes`](environments/windows11-firefox-155-probes/summary.md) |
| Windows 11, Playwright WebKit 26.6 | **not run**: `navigator.gpu` is undefined | [`windows11-webkit-26-probe`](environments/windows11-webkit-26-probe/summary.md) |

## Findings

- **The three Chromium-based browsers behave alike on this machine.** Chromium 153, Chrome 155 and Edge 155 each ran 606 tests with 591 passed, 0 failed, 0 NOT-RUN and 15 skipped by design (the pixel-exact `mtek test` specs, hardware-only). Chrome and Edge are two versions newer than Playwright's Chromium.
- **Firefox 155 runs Mtek on a real adapter, but only headed and only with `dom.webgpu.enabled` and `gfx.webgpu.ignore-blocklist` set**; headless it returns no adapter in the three configurations tried. It passes 230 of 251 hardware-project tests. Of the six failures two are the test harness (the DevTools Protocol exists in Chromium only), two are the three.js baselines logging a Firefox warning, one is a decoder difference, and one is a runtime difference worth a look: with a zero-sized canvas the runtime on Firefox reports an uncaptured GPU validation error ("Dimension X is zero", `MTEK-E8050`), which no Chromium run shows. It was not investigated or changed.
- **The adapter identity of Firefox is empty** (vendor and description are ""), so these results cannot say which GPU Firefox used; the machine has only the RX 7900 XTX, which is an inference, not a measurement. `isFallbackAdapter` is false.
- **The Linux evidence is software-adapter evidence only**, and it is red: the latest run on `main` at the time (39185877322, commit `c588dd3`) failed in `browser-software` with the known intermittent `dev-overlay` failure and a second failure, `m6/getting-started.spec.ts` ("the cube is on the page"), which the M6 report does not list. The job failed in seven of the ten latest runs on `main` ([`run.json`](environments/github-actions-ubuntu-swiftshader-run-39185877322/run.json)). The local `main` at the start of this task (`b05991a`) was not among the runs `gh run list` showed, so no CI result for it is stored.
- **No Linux or macOS machine with a hardware GPU** was available; nothing is claimed for them.

## Not done

- The `benchmarks` project (the three.js baselines of the benchmark tasks) was not run on Firefox or on any CI environment; the `firefox` project runs the same 251 specs as the `hardware` project.
- No Windows run with the software adapter as the only adapter, and no GPU other than the RX 7900 XTX.
- Playwright cannot start Safari; WebKit is the only WebKit-engine browser that could be tried, and it has no `navigator.gpu` here.
