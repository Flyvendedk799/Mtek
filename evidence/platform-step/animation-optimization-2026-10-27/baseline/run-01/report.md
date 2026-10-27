# Matched animation benchmark
Run: evidence/platform-step/animation-optimization-2026-10-27/baseline/run-01. Definitions: 0897d7e5d5e7aa19ccf6cd49faf640e4001762b10faa9baa24e2db23590d0c6a.

Both engines use WebGPU, independent actors, original geometry/joint/clip data, opaque flat color, identical cameras and a 640 × 360 sRGB target. Mtek uses the production release runtime; Three.js is pinned to 0.186.1. Source material replacement is explicit on both sides. All four pose phases and edge-culling comparisons must pass before timings are accepted.

Numbers below are the median of three per-run p95 values. CPU time brackets the complete synchronous update/render/submit call; queue completion is awaited outside that interval. GPU time sums every compute and render pass across all submissions, including Mtek skinning. It excludes queue gaps, transfers outside passes, presentation and instrument readback. RAF is callback interval in headless Chromium, not presented-frame cadence.

| Asset | Actors | Engine | CPU p95 ms | GPU pass-sum p95 ms | RAF interval p95 ms | writeBuffer B/frame | Live GPU buffer MiB | Live JS heap MiB |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| Fox | 1 | mtek | 0.235 | 0.006 | 3.475 | 1536 | 0.15 | 3.32 |
| Fox | 1 | three | 0.195 | 0.005 | 3.465 | 1536 | 0.07 | 4.90 |
| Fox | 10 | mtek | 0.425 | 0.023 | 3.400 | 15360 | 0.53 | 3.87 |
| Fox | 10 | three | 0.300 | 0.006 | 3.410 | 15360 | 0.09 | 5.61 |
| Fox | 50 | mtek | 1.365 | 0.097 | 3.410 | 76800 | 2.19 | 4.93 |
| Fox | 50 | three | 0.910 | 0.009 | 3.410 | 76800 | 0.16 | 7.68 |
| CesiumMan | 1 | mtek | 0.195 | 0.007 | 3.415 | 1216 | 0.30 | 3.45 |
| CesiumMan | 1 | three | 0.140 | 0.006 | 3.430 | 1216 | 0.23 | 4.94 |
| CesiumMan | 10 | mtek | 0.385 | 0.025 | 3.410 | 12160 | 0.99 | 3.97 |
| CesiumMan | 10 | three | 0.255 | 0.009 | 3.400 | 12160 | 0.24 | 5.74 |
| CesiumMan | 50 | mtek | 1.180 | 0.110 | 3.400 | 60800 | 4.06 | 4.91 |
| CesiumMan | 50 | three | 0.805 | 0.022 | 3.400 | 60800 | 0.30 | 8.16 |

Memory is observed logical GPU buffer allocation and GC-controlled JS heap while the application is alive. It is not physical VRAM, driver memory or process RSS. Engine-specific pages prevent Three.js code from being loaded in the Mtek page. JS includes engine/harness code and application representation; backing storage and post-disposal heap are retained in raw results. Source GLB image payload remains in the common material-free derivative; compiler packing and GLTFLoader retention differ.

CPU results near the recorded performance.now quantum are precision-limited. Instrumented counting/GPU/memory passes are separate from CPU timing. Raw samples, per-pass compute/render counts, host load, source/asset/build hashes, application adapter identities, PNG parity images and original import compatibility diagnostics are retained.

These results cover two externally authored characters and one recorded physical computer. They do not establish general rendering superiority, mobile/integrated-GPU support, production PBR material parity or a second maintained baseline runtime. Cesium Man's original mixed min/mag sampler is rejected by the current importer; the original is preserved and that limitation is recorded. The benchmark and textured demo use explicit material replacement.
