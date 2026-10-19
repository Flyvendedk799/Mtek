# M7.1: the AI/token benchmark re-run of the Mtek conditions on the main set (provisional)

This page summarises `benchmarks/results/ai/report-m7-1.md` and `benchmarks/results/ai/compare-m7-1.md`, which `node tools/ai-eval/src/report-cli.ts` and `node tools/ai-eval/src/compare-cli.ts` generate from the stored records only (`benchmarks/results/ai/m7-1-rerun-main/records.jsonl`; the earlier runs `m7-05-main` and `m7-05-guide`; the holdout re-run is stored outside the repository and only its ids and outcomes are in `benchmarks/results/ai/holdout-summary-m7-1.jsonl`). It adds nothing that is not in those files. It does not replace `evidence/M7/ai-benchmark.md`, the summary of the M7-05 result. The decision that explains how the lost attempts are read, and what the harness does now, is [0124](../../spec/decisions/0124-attempts-the-harness-could-not-judge.md).

**Status: provisional. 57 of the 340 attempts of the re-run were never answered by the model (the network failed), no retry was run, the baseline was not re-run, and no holdout result exists for the new documentation.**

## What was re-run and why

- After the M7-05 result (Mtek worse than the three.js baseline for this model) the agent-facing documentation was changed: the compiler's context for cold-start projects, which now holds generated schemas, enums and signatures (K-01); the diagnostics, which now say what to write instead (K-02); and the documentation, including the compact agent guide that is the guide condition's document (K-03). The re-run asks what those changes did to the same measurement.
- The same 34 tasks, 5 trials each, `claude-haiku-4-5-20251001`, temperature 1, prompt caching on, the same repair loop and budgets. Two Mtek conditions, as in M7-05: the compiler's context alone, and the context with `docs/language-guide.md` added (the guide now has another hash; the largest documentation given to the model grew from 12,802 to 22,638 bytes for the context alone and from 26,178 to 37,182 with the guide, both in `compare-m7-1.md`). The baseline was not re-run: the baseline row below is the one of `m7-05-main`.
- The run `m7-1-rerun-main` started 2026-10-19T15:48:40Z and ended 17:19:28Z with the status `complete`. At list prices it cost 8.10 USD (cap 20.60 on the ledger).
- A holdout re-run (8 tasks, 5 trials, the same two Mtek conditions: 80 attempts) was started right after, at 17:19:32Z.

## What was lost, and why

- From 17:18:27Z to 17:19:28Z every model call of the main re-run failed: 57 calls, each the only call of its attempt, 52 with the error `Connection error.` and 5 with `Request timed out.`, none with a response or a token. The last call that was answered started at 17:18:18Z. These are the last 57 of the 68 attempts of trial index 4 (the run is ordered trial by trial), so the lost cells are the later tasks of trial 4: 28 of the context-only condition and 29 of the guide condition. The records say `failure` / `generation-error`; the report now reads them as `error` / `transport-error`, not judged (decision 0124), and they are out of every completion rate and of tokens per completed task.
- The holdout re-run lost all 80 attempts: 63 to the same two errors (17:19:32Z to 17:20:04Z; 61 `Connection error.` and 2 `Request timed out.`) and 17 that the spend cap refused (`unfinished` / `budget-spend`). **No holdout attempt was judged, so no holdout result exists for the new documentation.** The holdout figures of M7-05 (`holdout-summary.jsonl`) are for the old documentation and say nothing about the new.
- Money: the spend guard charged each of the 120 failed calls its worst case, 3.96 USD together (1.89 USD in the main re-run, 2.07 USD in the holdout re-run), which is what filled the ledger to 21.98 USD of the cap of 22.00 and made the guard refuse the last 17 holdout attempts. The service most likely billed none of these calls, so the real API spend is unknown and lower than the ledger shows; the ledger was not corrected.
- The owner stopped spending, so the lost attempts were not run again. The harness has since been changed (decision 0124: a call without a response is retried and, if it stays without one, ends `error` / `transport-error`, and a connection error is not charged); that change has been tested with fake transports and has not met the service.

## The comparison with the M7-05 runs (all numbers are in `compare-m7-1.md`)

All attempts of each run, as published (the 57 attempts that were not judged are attempts, and in neither the completed count nor the rate):

| Condition | Run | Attempts | Completed / judged | Completion rate | Tokens per completed task |
| --- | --- | --- | --- | --- | --- |
| context only | M7-05 | 170 | 103 / 170 | 60.6 % | 40,535 |
| context only | M7.1 | 170 | 97 / 142 | 68.3 % | 33,659 |
| context + guide | M7-05 | 170 | 134 / 170 | 78.8 % | 32,842 |
| context + guide | M7.1 | 170 | 119 / 141 | 84.4 % | 31,166 |
| three.js baseline (M7-05, not re-run) | M7-05 | 170 | 156 / 170 | 91.8 % | 9,388 |

The matched cells (a task with a trial index, judged in both runs, so both sides cover the same 142 and 141 cells):

| Condition | Cells | Completed before / after | Completion rate before / after | Tokens per completed task before / after |
| --- | --- | --- | --- | --- |
| context only | 142 | 86 / 97 | 60.6 % / 68.3 % | 40,270 / 33,659 |
| context + guide | 141 | 112 / 119 | 79.4 % / 84.4 % | 33,000 / 31,166 |

By mode, on the matched cells (completion rate and tokens per completed task, before / after): cold authoring, context only, 29.5 % (118,567) / 56.8 % (55,042) over 44 cells; cold authoring with the guide, 56.8 % (62,662) / 68.2 % (51,678) over 44 cells; edit tasks, context only, 74.5 % (26,327) / 73.5 % (26,234) over 98 cells; edit tasks with the guide, 89.7 % (24,477) / 91.8 % (24,252) over 97 cells. The per-category figures are in `compare-m7-1.md`; scene-rendering with the context alone (47.7 % to 65.9 %) and shader-bridge with the guide (83.3 % to 100 %) moved most, and maintenance did not move (context only 24 of 24 both times; with the guide 24 of 24 before and 23 of 24 after).

## The verdict by the rule of decision 0108 (from `report-m7-1.md`)

The rule compares each Mtek condition with the baseline; the baseline attempts are those of `m7-05-main`, so the baseline was not re-run, and the earlier Mtek attempts are not in that report. Both conditions are still **worse** than the baseline, and both verdicts are provisional because 16.8 % of the attempts could not be judged (the limit of the rule is 10 %):

- context only: completion 68.3 % against 91.8 % (23.5 points lower), tokens per completed task 33,659 against 9,388, ratio 3.585 with a 95 % interval of 2.508 to 5.192 (M7-05: 4.318); the research target of 30 % fewer tokens is not met.
- context and guide: completion 84.4 % against 91.8 % (7.4 points lower, which the rule calls matched), 31,166 against 9,388, ratio 3.320 with an interval of 2.686 to 4.118 (M7-05: 3.498); the target is not met.

## What it shows and does not show

- On the cells judged in both runs the completion rate rose by 7.7 points (context only) and 5.0 points (with the guide) and the tokens per completed task fell by 16.4 % and 5.6 %. The change is modest. It sits in the cold-authoring tasks; the edit tasks moved by -1.0 and +2.1 points.
- The three.js baseline is still well ahead: 91.8 % completion and 9,388 tokens per completed task, against 68.3 % and 33,659 (context only) and 84.4 % and 31,166 (with the guide). The M7.1 re-run does not change the conclusion that Mtek is worse than the baseline for this model.
- **The gains on the main set are optimistic.** The failures that K-01 to K-03 address were diagnosed on this main set, so the documentation was shaped by these tasks. The holdout set, which was not used for any design, was not measured for the new documentation (see above).
- It is one run of each cell at temperature 1, with no repeat, and no confidence interval was computed for the differences above; a difference of a few points on 142 cells is not shown to be more than the variation between runs. The 57 lost cells are all of trial index 4 and are the later tasks of that trial, so which cells were lost is not random; the matched comparison is the one that does not depend on that.
- One model, one machine; the cost figures are list prices, not an invoice. Nothing here supports release copy about the share of tokens saved: the "about 80 % fewer tokens" claim is still unverified and must not appear (decision 0104).

## How to regenerate

```
node tools/ai-eval/src/report-cli.ts --run benchmarks/results/ai/m7-1-rerun-main --baseline-run benchmarks/results/ai/m7-05-main --out benchmarks/results/ai/report-m7-1.md --title <the first line of the file> --note <its third line>
node tools/ai-eval/src/compare-cli.ts --before benchmarks/results/ai/m7-05-main,benchmarks/results/ai/m7-05-guide --after benchmarks/results/ai/m7-1-rerun-main --out benchmarks/results/ai/compare-m7-1.md --title <...> --note <...>
node tools/ai-eval/src/report-cli.ts --run <the holdout run directory, outside the repository> --out <anywhere outside the repository> --holdout-summary benchmarks/results/ai/holdout-summary-m7-1.jsonl
```

`tools/ai-eval/test/m7-1-evidence.test.ts` regenerates the report and the comparison from the stored records byte for byte, and checks the figures above. It cannot regenerate the holdout summary (the holdout run directory is outside the repository); it checks that the file holds 80 attempts, 63 `error` / `transport-error` and 17 `unfinished` / `budget-spend`, none judged, and only ids, outcomes and layer outcomes.
