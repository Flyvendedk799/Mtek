# Pending CI change (decision 0137)

`small-games-ci.patch` adds two jobs to `.github/workflows/ci.yml`:
- `game-budgets`: Linux, no GPU, runs on every push;
- `frame-evidence`: self-hosted GPU runners, started by hand.

It also adds the `workflow_dispatch` trigger.

It is not applied on this branch because the push token has no `workflow` scope: GitHub refuses any push that changes `.github/workflows/`. Apply it with a token or account that has that scope:

    git apply ci/small-games-ci.patch && git rm -r ci && git commit -m "ci: small-game budgets (decision 0137)"

Until then the size check runs locally with `npm run check:budgets`.
