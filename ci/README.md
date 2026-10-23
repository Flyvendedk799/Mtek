# CI notes

The workflow is `.github/workflows/ci.yml`. The small-game jobs of decision 0137 are part of it:
- `game-budgets`: Linux, no GPU, runs on every push; fails when an example is over its budget in `budgets/small-games.json` or has none;
- `frame-evidence`: self-hosted GPU runners, started by hand (`workflow_dispatch` with `frame_evidence: true`). No runner is registered yet, so it has never produced evidence.

`ci/small-games-ci.patch`, which carried these jobs while the push token had no `workflow` scope, was applied on 2026-10-23 and removed.

Two checks guard the runtime that `mtek` embeds (decision 0131):
- the `node` job runs `npm run check:prebuilt`: a change under `packages/runtime-web` or `packages/physics-rapier` without a refreshed `crates/mtek-cli/prebuilt` fails;
- the `rust` job runs the `mtek-cli` tests a second time with `MTEK_NO_EMBEDDED_RUNTIME=1` (read by `crates/mtek-cli/build.rs`), which builds `mtek` without a runtime so that the `#[cfg(not(mtek_runtime_embedded))]` tests, the `E9030` path, run.
