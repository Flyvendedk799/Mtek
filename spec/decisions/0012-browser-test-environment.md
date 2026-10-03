# 0012. Browser test environment and evidence policy

- Status: Accepted
- Date: 2026-10-03
- Blueprint origin: §12.1, §15.

## Decision

Browser tests use Playwright with Chromium. Two projects: `hardware` (Chromium new headless via `channel: "chromium"`, or headed when needed, with `--enable-unsafe-webgpu --ignore-gpu-blocklist`) and `software` (SwiftShader via `--use-webgpu-adapter=swiftshader`; correctness only). Assertions read back pixels from fixed-format offscreen targets — never screenshots of the page. Every run writes an environment record (`adapter.info`, including `isFallbackAdapter` [S14]). Tests without a WebGPU adapter are reported **NOT-RUN**, never passed; gate evidence requires `MTEK_REQUIRE_GPU=1` on a hardware adapter.
**Open item (filled by task M0-07):** the exact working configuration on the development machine (OS, GPU, browser channel, headless or headed, flags) — appended here as an amendment with the environment record path. Whether headless Chromium exposes a hardware adapter on Windows is currently **unverified**.
