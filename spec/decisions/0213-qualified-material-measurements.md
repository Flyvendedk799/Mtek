# 0213 — Qualified material and lighting measurements

Status: Implemented runner; full-run acceptance pending. Date: 2026-10-27.
Extends 0095, 0210 and 0212. Platform scorecard areas 3 and 9 remain open.

The material comparison must establish the work being rendered before accepting
timing. Protocol 3 retains the original pinned WaterBottle and native reference
renderer, visual gates and normal-map contribution controls. Release packages
must exactly match a complete passing hardware visual matrix. SwiftShader's
failed native-reference product controls remain a separate failed gate.

Each of ten workload/profile pairs runs in Mtek and Three WebGPU with separate
CPU submission, all-pass GPU timestamps, resource counts and native presentation
passes. Three rotated/counterbalanced repeats produce 240 accepted passes, each
with 120 warmup frames and 600 samples. Fresh contexts isolate instruments;
completion waits occur outside CPU intervals and outside the native frame loop.
GPU sums and first-to-last spans disclose their boundaries, and pass/encoder
counts must match the independently observed counter stream at every frame.

The common resource instrument counts RG16Float, all mips, fixed array layers and
shrinking volume depth. These are logical descriptor bytes, not a claim about
driver allocation, compressed depth storage or JS heap. Frozen animation evidence
is preserved rather than retroactively changing its reported values.

On Windows, pinned signed PresentMon 2.6.0 captures ETW display events for the
isolated browser GPU process. Exact-session readiness/cleanup avoids interfering
with other capture tools. A RAF-only negative control must not produce displayed
evidence. One unambiguous swapchain, no reported ETW loss, bounded QPC/browser
clock alignment, a focused unclipped native canvas and a matching same-engine
offscreen image are required. The browser display profile is explicitly sRGB for
both engines. Three's readback uses public `setOutputRenderTarget` so it retains
the native output buffer/conversion pass; ordinary `setRenderTarget` bypassed it.
OS security settings and monitor profiles are unchanged. Cadence
does not establish input latency, physical photons or individual JS-frame drops.

CPU and external GPU interference are observed before and during each pass;
unavailable counters and noisy passes are retained and rejected. Repeated noise
does not cancel unrelated roadmap work or waive the limits. A resumable run uses
an exclusive live-process lock, immutable source snapshots, exact built packages
and separate attempt directories. An independent report re-reads and verifies
raw artifacts instead of trusting a stored success flag.

Budgets can be established only by a complete qualified run. A comparison must
use the same protocol, measurement sources, assets, reference and physical/browser
environment. Relative/absolute timing tolerances, logical byte allowances and
draw/upload count limits are declared in the protocol before measurement. This
increment does not supply a second maintained reference, varied long-session
streaming workloads or additional physical-device tiers.

Primary tool documentation:

- [PresentMon console and metrics](https://github.com/GameTechDev/PresentMon/blob/v2.6.0/README-ConsoleApplication.md)
- [Chrome automation display-profile flag](https://github.com/GoogleChrome/chrome-launcher/blob/main/docs/chrome-flags-for-tools.md)
