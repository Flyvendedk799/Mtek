# 0012. Browser test environment and evidence policy

- Status: Accepted
- Date: 2026-10-03
- Blueprint origin: §12.1, §15.

## Decision

Browser tests use Playwright with Chromium. Two projects: `hardware` (Chromium new headless via `channel: "chromium"`, or headed when needed, with `--enable-unsafe-webgpu --ignore-gpu-blocklist`) and `software` (SwiftShader via `--use-webgpu-adapter=swiftshader`; correctness only). Assertions read back pixels from fixed-format offscreen targets — never screenshots of the page. Every run writes an environment record (`adapter.info`, including `isFallbackAdapter` [S14]). Tests without a WebGPU adapter are reported **NOT-RUN**, never passed; gate evidence requires `MTEK_REQUIRE_GPU=1` on a hardware adapter.
**Open item (resolved by task M0-07):** the exact working configuration on the development machine is recorded in the amendment below, with the environment record path. Headless Chromium does expose a hardware adapter on Windows.

## Amendment (M0-07, 2026-10-03): working hardware configuration on the development machine

The open item above is resolved. **Headless Chromium exposes a hardware WebGPU adapter on this Windows machine**, with no special configuration beyond the documented flags.

### Machine

| | |
|---|---|
| OS | Windows 11 Pro 10.0.26200, x64 |
| GPU | AMD Radeon RX 7900 XTX (driver 32.0.31036.15) |
| Adapter reported | `vendor: "amd"`, `architecture: "rdna-3"`, `device: "0x744c"`, `description: "AMD Radeon RX 7900 XTX"`, `isFallbackAdapter: false` |
| Node / npm | 24.18.1 / 11.16.0 |
| Playwright | 1.63.0 |
| Browsers | Playwright Chromium (Chrome for Testing) 153.0.8010.12; installed Google Chrome 154.0.8037.93 |

Environment record of the run that was committed with this amendment: [`evidence/environments/2026-10-03-windows11-rx7900xtx.json`](../../evidence/environments/2026-10-03-windows11-rx7900xtx.json) (produced by `MTEK_REQUIRE_GPU=1 npm run test:browser:hardware`; clean working tree, commit `ae8bf10`; it validates against `tests/browser/environment.schema.json`).

### Working configuration (the default of the `hardware` project)

- Channel: `chromium` (`MTEK_BROWSER_CHANNEL` unset). Playwright launches the full Chromium binary in the **new headless mode**.
- Headless (`MTEK_HEADED` unset).
- Launch arguments: `--enable-unsafe-webgpu --ignore-gpu-blocklist --enable-webgpu-developer-features` (on Linux, additionally `--use-angle=vulkan --enable-features=Vulkan --disable-vulkan-surface`; the Linux flags are unverified because no Linux machine was available).
- Command: `MTEK_REQUIRE_GPU=1 npm run test:browser:hardware`; result 3 passed / 0 failed / 0 not-run, adapter hardware.

**Deviation from SPEC `spec/testing.md` section 6.1:** the flag `--enable-webgpu-developer-features` is added to both projects. Without it Chromium reports empty `adapter.info.device` and `adapter.info.description` (only `vendor` and `architecture`), so the record would not name the GPU. The flag does not change which adapter is selected (verified below). It does not alter `isFallbackAdapter`.

### Configurations tried and outcomes

All attempts used a secure context (`http://127.0.0.1:<port>`; `about:blank` has no `navigator.gpu`). "Hardware" means `isFallbackAdapter === false` with an AMD adapter.

| # | Channel | Mode | Arguments | Result |
|---|---|---|---|---|
| a | `chromium` 153 | new headless | `--enable-unsafe-webgpu --ignore-gpu-blocklist` | hardware adapter; `device` and `description` empty |
| a2 | `chromium` 153 | new headless | `--enable-unsafe-webgpu --ignore-gpu-blocklist --enable-webgpu-developer-features` | **hardware adapter, named GPU** (chosen) |
| a3 | `chromium` 153 | new headless | no WebGPU flags at all | hardware adapter (WebGPU is on by default in this build; empty `device`/`description`) |
| a4 | `chromium` 153 | new headless | `--enable-unsafe-webgpu` only | hardware adapter (empty `device`/`description`) |
| b | `chromium` 153 | headed (`MTEK_HEADED=1`) | harness defaults | hardware adapter, named GPU, 3 passed |
| c | `chrome` 154 | new headless | harness defaults | hardware adapter, named GPU, 3 passed |
| d | `chrome` 154 | headed | harness defaults | hardware adapter, named GPU, 3 passed |
| e | `chromium` 153 | new headless | `software` project (`--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader --enable-webgpu-developer-features`) | software adapter: `vendor: "google"`, `architecture: "swiftshader"`, `description: "SwiftShader Device (Subzero)"`, `isFallbackAdapter: true`; 3 passed. Correctness only. |
| f | `chromium` 153 | new headless | `--disable-gpu` (via `MTEK_BROWSER_ARGS`) | `navigator.gpu` exists, `requestAdapter()` resolves to `null`: all 3 tests reported **NOT-RUN**; exit code 0 without `MTEK_REQUIRE_GPU`, exit code 1 with `MTEK_REQUIRE_GPU=1` |

Runs a2 to d ran through the harness (smoke spec: render pass clear of a 4x4 `rgba8unorm` texture, copy to a buffer with `bytesPerRow` 256, map, compare). Runs a, a3 and a4 were direct adapter probes (`requestAdapter` plus `adapter.info`) outside the smoke spec. Nothing needed an adapter fallback flag, a Vulkan flag or ANGLE selection on Windows (Chromium used its default backend).

### Notes

- `--disable-features=WebGPU` and `--disable-webgpu` do **not** disable WebGPU in this Chromium; `--disable-gpu` does (adapter `null`). `MTEK_BROWSER_ARGS=--disable-gpu` is therefore the supported way to test the NOT-RUN path.
- The reporter applies the `isFallbackAdapter === true` check to the `hardware` project only; the `software` project is a software adapter by design and is never hardware evidence.
- Browser installation: `npx playwright install chromium`. On the development machine the Playwright downloader repeatedly timed out against `cdn.playwright.dev` (the same URL downloaded fine with `curl`); the Chrome for Testing archive was extracted manually into `%LOCALAPPDATA%\ms-playwright\chromium-1243`. This is a local network quirk, not a project requirement.
