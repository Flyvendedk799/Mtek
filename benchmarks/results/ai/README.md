# AI/token benchmark results

Results of the AI/token benchmark of `spec/ai-and-benchmarks.md` section 6.4 (task M7-05; decisions 0108 and 0109).
Every directory below is one run written by `tools/ai-eval/src/benchmark-run.ts`; every `report.md` is computed from the
stored `records.jsonl` only by `tools/ai-eval/src/report-cli.ts`.

| Directory | What it is |
|---|---|
| `pilot-2026-10-19/` | **Pilot of phase 1, not the M7-05 result.** 4 tasks, Mtek with the compiler context and the three.js baseline, 2 trials each, Claude Haiku 4.5, temperature 1. `report.md` covers this run and `pilot-guide-2026-10-19/` together; `projection.md` is the cost projection of the full run. |
| `pilot-guide-2026-10-19/` | The second pilot run: 3 of those tasks with `docs/language-guide.md` added to the Mtek context (decision 0108 item 4). |
| `m7-05-main/`, `m7-05-guide/` | The M7-05 runs on the main set (Mtek with the compiler context, the three.js baseline; Mtek with the guide). `report.md` and `holdout-summary.jsonl` are their report and the ids and outcomes of the holdout run; the summary is `evidence/M7/ai-benchmark.md`. |
| `m7-1-rerun-main/` | **The M7.1 re-run** of the two Mtek conditions on the main set after the context, the diagnostics and the guide changed (the baseline was not re-run). 57 of its 340 attempts were lost to connection errors and timeouts and are not judged (decision 0124). |
| `m7-1-retry-ctx/`, `m7-1-retry-guide/` | **Retry runs** (decision 0125) of exactly the 28 and 29 lost cells of `m7-1-rerun-main` (trial index 4), with the harness as decision 0124 changed it. All 57 attempts were judged; in the report and the comparison they replace the lost attempts, which stay listed. |
| `report-m7-1.md`, `compare-m7-1.md`, `holdout-summary.jsonl`, `holdout-summary-m7-1.jsonl` | The final M7.1 documents. `report-m7-1.md`: the report of `m7-1-rerun-main` with the two retry runs (the baseline attempts are those of `m7-05-main`). `compare-m7-1.md`: the before/after comparison with the M7-05 runs on all 170 cells of each condition, the verdicts, and the exploratory holdout section. The holdout summaries hold ids, outcomes, tokens and cost only (the holdout run directories are outside the repository): `holdout-summary.jsonl` for the M7-05 holdout run, `holdout-summary-m7-1.jsonl` for the M7.1 holdout (160 rows: the 80 attempts lost to the outage, each `supersededBy` the retry run, and the 80 attempts of the retry run). The summary is `evidence/M7/ai-benchmark-m7-1.md`, the machine-readable baseline `evidence/M7/ai-baseline.json`; `tools/ai-eval/test/m7-1-evidence.test.ts` regenerates the report, the comparison and the baseline file byte for byte. |

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
