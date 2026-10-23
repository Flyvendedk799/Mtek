# 0137. CI for small games: size budgets on Linux, frame-time evidence only from real GPUs

- Status: Accepted
- Date: 2026-10-21
- Specification: `spec/tooling.md` §2.2; `budgets/small-games.json`; `evidence/small-games/README.md`.
- Small-game plan: phase 8 (shipping), steps 3 (CI and the evidence harness) and 5 (performance budgets).

## Context

The repository's CI already builds, lints and unit-tests on Linux and Windows, and runs the browser suite on SwiftShader, which is correctness only and never hardware evidence. Small games add two promises: a game package stays small enough to load quickly on itch.io, and it runs at frame rate. The first can be checked anywhere. The second needs a real GPU, and no CI runner has one.

## Decision

1. **Size budgets in CI.** The `game-budgets` job, on Ubuntu with no GPU, builds the CLI (with the prebuilt runtime, decision 0131) and runs `scripts/game-budgets.mjs size`. It packages every example listed in `budgets/small-games.json` with `mtek build --release --itch` (decision 0136) and fails when a folder or zip is over its budget. The size report is an artifact. The first budgets are the sizes measured on 2026-10-21 plus 10 %, rounded up to 10 kB. A budget is raised only in a reviewed commit that says why.
2. **Frame-time evidence from hardware only.**
   - `scripts/record-frame-evidence.mjs` packages each example, serves it locally and opens it in Chromium with the hardware WebGPU flags.
   - After the loading screen goes, it skips 60 frames and times 600 `requestAnimationFrame` intervals.
   - It records p50, p95 and the maximum, the adapter (`GPUAdapterInfo` and `isFallbackAdapter`), the browser and the machine.
   - The interval is what a player sees, so it is capped by the display refresh rate.
3. **Budget: p95 ≤ 20 ms over at least 300 frames.** 20 ms is 60 Hz with headroom. `game-budgets.mjs frames` checks this.
4. **Software is refused, not skipped.** A file whose adapter is a fallback adapter, or is not identified, fails the frame check. A SwiftShader run therefore cannot become evidence, even by mistake. A missing file also fails: there is no silent pass.
5. **The GPU job is manual.** `frame-evidence` runs only on `workflow_dispatch` with `frame_evidence: true`, on self-hosted runners labelled `mtek-gpu` plus `nvidia`, `intel` or `apple`. None is registered. Until Abe records evidence on his machines, `evidence/small-games/README.md` says "not recorded" for all three.

## Consequences

- `npm run check:budgets` runs the size check locally.
- No frame-time evidence exists yet. This is stated in the evidence README and in `TESTING-codey2.md` §8, and nothing claims otherwise.
- The recorder has not been run, because this machine has no GPU and no Chromium. The checker was exercised here against a software-adapter file (refused) and against no file (refused).
- The workflow change is in `ci/small-games-ci.patch`, not in `.github/workflows/ci.yml`. The branch push token has no `workflow` scope, and GitHub refused the push. Abe applies the patch (`ci/README.md`). The YAML was edited by hand and was not parsed here (no YAML parser on the box).

## Update, 2026-10-23

- The patch is applied in `.github/workflows/ci.yml` and `ci/small-games-ci.patch` is gone.
- The size budgets were re-baselined (measured plus 10 %) and the four game examples were added. `scripts/game-budgets.mjs size` now also fails when a directory under `examples/` has no budget entry.
- `game-budgets.mjs frames` also refuses an adapter that does not say whether it is a fallback, a SwiftShader, llvmpipe or Basic Render description, and an example whose `failure` is set. The recorder keeps an unknown `isFallbackAdapter` as `null` and opens a headed window by default.

## Verification

- `node scripts/game-budgets.mjs size` (run here: all seven examples within budget).
- `node scripts/game-budgets.mjs frames` with a fallback-adapter file and with no file: both exit 1 with the reason (run here).
- Hardware: `TESTING-codey2.md` §8.
