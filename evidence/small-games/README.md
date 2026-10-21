# Small-game evidence (decision 0137)

| Evidence | How it is produced | Status |
|---|---|---|
| Bundle size of every example's game package | `node scripts/game-budgets.mjs size` (CI job `game-budgets`, Linux, no GPU, in `ci/small-games-ci.patch` until applied) | checked locally with `npm run check:budgets`; in CI once the patch is applied; budgets in `budgets/small-games.json` |
| Frame time, NVIDIA | `node scripts/record-frame-evidence.mjs frame-evidence-nvidia.json` on an NVIDIA machine, then `node scripts/game-budgets.mjs frames frame-evidence-nvidia.json` | **not recorded: needs Abe's hardware** |
| Frame time, Intel | the same on an Intel GPU | **not recorded: needs Abe's hardware** |
| Frame time, Apple | the same on an Apple-silicon Mac | **not recorded: needs Abe's hardware** |

No frame-time file is in this directory yet. None may be written by hand or recorded on a software adapter. `game-budgets.mjs frames` refuses a fallback adapter or an unidentified one.

To add one, record it on the machine, check it, and commit the JSON here as `<yyyy-mm-dd>-<os>-<gpu>.json`, the naming of `evidence/environments/`. The CI job `frame-evidence` does the same on self-hosted runners labelled `mtek-gpu` plus `nvidia`, `intel` or `apple`. It runs only when started by hand (`workflow_dispatch`, `frame_evidence: true`).
