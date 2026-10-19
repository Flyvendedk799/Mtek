# AI/token benchmark results

Results of the AI/token benchmark of `spec/ai-and-benchmarks.md` section 6.4 (task M7-05; decisions 0108 and 0109).
Every directory below is one run written by `tools/ai-eval/src/benchmark-run.ts`; every `report.md` is computed from the
stored `records.jsonl` only by `tools/ai-eval/src/report-cli.ts`.

| Directory | What it is |
|---|---|
| `pilot-2026-10-19/` | **Pilot of phase 1, not the M7-05 result.** 4 tasks, Mtek with the compiler context and the three.js baseline, 2 trials each, Claude Haiku 4.5, temperature 1. `report.md` covers this run and `pilot-guide-2026-10-19/` together; `projection.md` is the cost projection of the full run. |
| `pilot-guide-2026-10-19/` | The second pilot run: 3 of those tasks with `docs/language-guide.md` added to the Mtek context (decision 0108 item 4). |

The first pilot run was written by the harness one commit before the second (commit `af1b5d3`, before `condition.documentation` and
`run-start.settings.order` existed): its conditions have no `documentation` key, which the schema allows and the report reads as the
compiler context (Mtek) or the baseline reference. Both runs validate against `spec/ai-eval-record.schema.json`
(`tools/ai-eval/test/pilot-evidence.test.ts` checks that, and that the stored report and projection are reproduced from the records).

A run directory holds `records.jsonl` (the settings of the run, every model call with its full prompt, reply, token
usage and cost, every edit, every validation of every layer, the end of every attempt, the end of the run) and
`trials/<attempt>/project/` (the final candidate of every attempt, failures included). Nothing of a run is removed
afterwards; a failing attempt is never dropped.

The pilot's numbers are provisional by construction (2 trials per task and condition, 4 tasks): the report's verdicts are
inconclusive, and no release text may quote them as a result (decision 0104). The final run's report will be
`benchmarks/results/ai/report.md` with its raw runs beside it. **No holdout attempt is stored here**: a holdout run
holds prompts and candidates and lives outside the repository; only `holdout-summary.jsonl` (ids, outcomes and layer
outcomes) may be stored.

The money of every run is on a ledger outside the repository (`<home>/gate-m7/ai-spend.json`); the cost figures in the
records are the provider's usage at list prices, not an invoice.
