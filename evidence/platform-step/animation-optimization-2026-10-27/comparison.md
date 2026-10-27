# Animation optimization: matched before/after

Both complete runs use identical frozen definitions, protocol, browser, adapter, OS and package lock. Each passes all 210 gates. All rows include Three.js controls so changes in the unchanged engine remain visible.

| Asset | Actors | Engine | CPU p95 ms before → after | CPU change | GPU pass-sum p95 ms before → after | GPU change | GPU buffer MiB before → after |
|---|---:|---|---:|---:|---:|---:|---:|
| Fox | 1 | mtek | 0.235 → 0.210 | -10.6% | 0.006 → 0.006 | -4.6% | 0.151 → 0.111 |
| Fox | 1 | three | 0.195 → 0.200 | +2.6% | 0.005 → 0.005 | +0.8% | 0.074 → 0.074 |
| Fox | 10 | mtek | 0.425 → 0.425 | 0.0% | 0.023 → 0.021 | -8.1% | 0.526 → 0.308 |
| Fox | 10 | three | 0.300 → 0.375 | +25.0% | 0.006 → 0.006 | +7.9% | 0.089 → 0.089 |
| Fox | 50 | mtek | 1.365 → 1.850 | +35.5% | 0.097 → 0.088 | -9.1% | 2.191 → 1.182 |
| Fox | 50 | three | 0.910 → 1.760 | +93.4% | 0.009 → 0.009 | -0.9% | 0.156 → 0.156 |
| CesiumMan | 1 | mtek | 0.195 → 0.210 | +7.7% | 0.007 → 0.007 | -1.2% | 0.304 → 0.266 |
| CesiumMan | 1 | three | 0.140 → 0.195 | +39.3% | 0.006 → 0.006 | 0.0% | 0.230 → 0.230 |
| CesiumMan | 10 | mtek | 0.385 → 0.425 | +10.4% | 0.025 → 0.023 | -8.4% | 0.994 → 0.619 |
| CesiumMan | 10 | three | 0.255 → 0.325 | +27.5% | 0.009 → 0.009 | +1.4% | 0.242 → 0.242 |
| CesiumMan | 50 | mtek | 1.180 → 1.150 | -2.5% | 0.110 → 0.101 | -8.0% | 4.061 → 2.188 |
| CesiumMan | 50 | three | 0.805 → 1.165 | +44.7% | 0.022 → 0.023 | +0.7% | 0.296 → 0.296 |

Values are the median of three per-run p95s, not confidence intervals. Negative changes mean less time or memory. CPU near the recorded clock quantum is precision-limited. GPU sums compute and render passes; transfers, queue gaps and presentation are excluded. RAF callback intervals are not presented-frame timing. Buffer bytes are logical allocations, not physical VRAM; JS heap and transfer/draw counts are in comparison.json and both full reports.

CPU interpretation: Mtek's whole-frame CPU results are mixed, including a regression for 50 Fox actors. The unchanged Three.js control also changes substantially. These measurements do not establish a whole-frame CPU reduction or isolate the cause of every change. The separate alternating pose-only diagnostic in pose-only.json measures a narrower Node workload and must not replace these browser results.

This flat opaque workload intentionally disables primary culling, pose sharing and throttling. The candidate skips unused normal deformation and unneeded opaque bounds work; materials reading normals retain inverse-transpose deformation. Culling-edge gates still run with culling enabled. These results cover two assets on one physical desktop, not PBR quality, all animation compositions, other devices or general engine superiority.

Compatibility correction: the frozen report template still describes CesiumMan's original mixed-filter sampler as rejected. That text is historical. Both fresh build-inputs.json records show original import exit code 0 for Fox and CesiumMan; the importer fix predates both runs. The frozen workload still explicitly replaces materials identically on both sides. The template is retained unchanged to preserve the definition hash.
