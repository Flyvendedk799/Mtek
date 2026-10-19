# Before and after: the Mtek conditions, the M7-05 runs against the M7.1 re-run with its retry runs (main set, final) and the exploratory holdout

Before: `m7-05-main` (the compiler context alone, and the three.js baseline) and `m7-05-guide` (the context with `docs/language-guide.md`). After: `m7-1-rerun-main`, the same 34 tasks, 5 trials, model and temperature, with the compiler context and the guide changed in between (tasks K-01 to K-03), and the retry runs `m7-1-retry-ctx` and `m7-1-retry-guide` (decision 0125), whose 28 and 29 attempts replace the 57 attempts of trial index 4 that an API outage cost the first run. The failures that those changes address were diagnosed on this main set, so the gains below are optimistic. The baseline was not re-run. The last section is the holdout, exploratory and computed from the summary files only.

Generated from the stored `records.jsonl` files by `tools/ai-eval/src/compare-cli.ts` (decisions 0124 and 0125); the same records give the same text. Nothing here is read from a running process, a ledger or a hand computation. The completion rate is completed / attempts that ended by themselves (completed or failed); an attempt the harness could not judge (not-run, error, unavailable, unfinished by budget) is counted as an attempt and as neither. Tokens per completed task is all tokens of all attempts / completed tasks. This document compares two states of the same conditions, and ends with the verdict of each condition after against the baseline of the runs before by the rule of decision 0108 (the report of the same runs gives the same verdict).

## What is compared

Runs before:

| run | started | status | provider / model | settings |
| --- | --- | --- | --- | --- |
| m7-05-main | 2026-10-19T09:23:16.558Z | complete | anthropic / claude-haiku-4-5-20251001 | temperature 1, prompt caching true, test feedback messages |
| m7-05-guide | 2026-10-19T11:44:58.777Z | complete | anthropic / claude-haiku-4-5-20251001 | temperature 1, prompt caching true, test feedback messages |

Runs after:

| run | started | status | provider / model | settings |
| --- | --- | --- | --- | --- |
| m7-1-rerun-main | 2026-10-19T15:48:40.781Z | complete | anthropic / claude-haiku-4-5-20251001 | temperature 1, prompt caching true, test feedback messages |
| m7-1-retry-ctx (retry run) | 2026-10-19T19:12:22.079Z | complete | anthropic / claude-haiku-4-5-20251001 | temperature 1, prompt caching true, test feedback messages |
| m7-1-retry-guide (retry run) | 2026-10-19T19:21:17.783Z | complete | anthropic / claude-haiku-4-5-20251001 | temperature 1, prompt caching true, test feedback messages |

Model of every compared attempt: claude-haiku-4-5-20251001.

| condition | condition id before | condition id after | largest documentation before (bytes) | largest documentation after (bytes) |
| --- | --- | --- | --- | --- |
| context only | f87b1b0089b9 | f87b1b0089b9 | 12,802 | 22,638 |
| context + guide | 079c8015df7d | bd059ee8a1d6 | 26,178 | 37,182 |

A condition id covers the settings of the run and the KIND of documentation (the compiler's context export, or the context plus a named document with the hash of that document); it does not cover the text of the compiler's context export, which the compiler produces. The same id before and after therefore does not mean the same text was given to the model.

## What was lost

| condition | attempts before | not judged before | attempts after | not judged after |
| --- | --- | --- | --- | --- |
| context only | 170 | 0 (none) | 170 | 0 (none) |
| context + guide | 170 | 0 (none) | 170 | 0 (none) |

No attempt that counts after was lost: every one ended in success or failure. 57 attempts of the runs after were not judged and were replaced by the attempt of the same cell in the retry runs (below); the lost attempts are in no table of this document except the one below.

## Retries of the lost attempts

A retry run supplies an attempt for a cell (task, condition, trial index) whose attempt in the other runs was NOT judged. In every table of this document the retry attempt stands in the place of the lost one; the lost attempt stays in the records and is listed here. A retry attempt for a cell that was judged would have been refused.

| condition | retry run | lost attempts replaced | what they were | trial index | retry attempts | completed | failed | not judged | completed share of the retry attempts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| context only | m7-1-retry-ctx | 28 | 28 error/transport-error | 4 | 28 | 19 | 9 | 0 | 67.9 % |
| context + guide | m7-1-retry-guide | 29 | 29 error/transport-error | 4 | 29 | 26 | 3 | 0 | 89.7 % |

Every lost cell has a judged retry attempt.

## All attempts of each run, as published

Every attempt that counts, with the retry attempts in the place of the attempts they replaced (the lost attempts are not in these tables; they are listed above). Attempts that were not judged would count as attempts, not in the rate.

| condition | side | attempts | completed | failed | not judged | completion rate | tokens per completed task |
| --- | --- | --- | --- | --- | --- | --- | --- |
| context only | before | 170 | 103 | 67 | 0 | 60.6 % | 40,535 |
| context only | after | 170 | 116 | 54 | 0 | 68.2 % | 33,648 |
| context + guide | before | 170 | 134 | 36 | 0 | 78.8 % | 32,842 |
| context + guide | after | 170 | 145 | 25 | 0 | 85.3 % | 29,872 |
| baseline (three.js), copied from the runs before | before | 170 | 156 | 14 | 0 | 91.8 % | 9,388 |

The baseline was not re-run: its row is the baseline of the runs before, repeated for reference only.

| scope | before: attempts | before: completed / judged | before: completion rate | before: tokens per completed task | after: attempts | after: completed / judged | after: completion rate | after: tokens per completed task | completion rate, change | tokens per completed task, change |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| context only: all | 170 | 103 / 170 | 60.6 % | 40,535 | 170 | 116 / 170 | 68.2 % | 33,648 | 7.6 points | -17.0 % |
| context only: mode cold | 55 | 17 / 55 | 30.9 % | 112,711 | 55 | 32 / 55 | 58.2 % | 53,878 | 27.3 points | -52.2 % |
| context only: mode edit | 115 | 86 / 115 | 74.8 % | 26,268 | 115 | 84 / 115 | 73.0 % | 25,942 | -1.7 points | -1.2 % |
| context only: category interaction | 55 | 33 / 55 | 60.0 % | 49,608 | 55 | 34 / 55 | 61.8 % | 47,516 | 1.8 points | -4.2 % |
| context only: category maintenance | 30 | 30 / 30 | 100.0 % | 7,760 | 30 | 30 / 30 | 100.0 % | 6,910 | 0.0 points | -10.9 % |
| context only: category scene-rendering | 55 | 27 / 55 | 49.1 % | 60,017 | 55 | 37 / 55 | 67.3 % | 37,804 | 18.2 points | -37.0 % |
| context only: category shader-bridge | 30 | 13 / 30 | 43.3 % | 52,679 | 30 | 15 / 30 | 50.0 % | 45,440 | 6.7 points | -13.7 % |
| context + guide: all | 170 | 134 / 170 | 78.8 % | 32,842 | 170 | 145 / 170 | 85.3 % | 29,872 | 6.5 points | -9.0 % |
| context + guide: mode cold | 55 | 30 / 55 | 54.5 % | 64,631 | 55 | 39 / 55 | 70.9 % | 48,243 | 16.4 points | -25.4 % |
| context + guide: mode edit | 115 | 104 / 115 | 90.4 % | 23,672 | 115 | 106 / 115 | 92.2 % | 23,114 | 1.7 points | -2.4 % |
| context + guide: category interaction | 55 | 44 / 55 | 80.0 % | 38,853 | 55 | 47 / 55 | 85.5 % | 35,112 | 5.5 points | -9.6 % |
| context + guide: category maintenance | 30 | 30 / 30 | 100.0 % | 12,369 | 30 | 29 / 30 | 96.7 % | 13,708 | -3.3 points | +10.8 % |
| context + guide: category scene-rendering | 55 | 35 / 55 | 63.6 % | 50,143 | 55 | 39 / 55 | 70.9 % | 46,056 | 7.3 points | -8.2 % |
| context + guide: category shader-bridge | 30 | 25 / 30 | 83.3 % | 22,610 | 30 | 30 / 30 | 100.0 % | 16,251 | 16.7 points | -28.1 % |

## Matched cells (judged in both runs)

A cell is a task with a trial index. The matched cells of a condition are those judged in BOTH runs, so before and after cover exactly the same cells; the attempts that were lost are out of both sides. Tokens per completed task is computed over the matched cells only.

| condition | cells judged after | cells judged in both (matched) | judged after without a judged attempt before |
| --- | --- | --- | --- |
| context only | 170 | 170 | 0 |
| context + guide | 170 | 170 | 0 |

Every cell of every condition is judged in both runs, so the matched cells are all the cells and the table below equals the table of all attempts above.

| scope | before: attempts | before: completed / judged | before: completion rate | before: tokens per completed task | after: attempts | after: completed / judged | after: completion rate | after: tokens per completed task | completion rate, change | tokens per completed task, change |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| context only: all | 170 | 103 / 170 | 60.6 % | 40,535 | 170 | 116 / 170 | 68.2 % | 33,648 | 7.6 points | -17.0 % |
| context only: mode cold | 55 | 17 / 55 | 30.9 % | 112,711 | 55 | 32 / 55 | 58.2 % | 53,878 | 27.3 points | -52.2 % |
| context only: mode edit | 115 | 86 / 115 | 74.8 % | 26,268 | 115 | 84 / 115 | 73.0 % | 25,942 | -1.7 points | -1.2 % |
| context only: category interaction | 55 | 33 / 55 | 60.0 % | 49,608 | 55 | 34 / 55 | 61.8 % | 47,516 | 1.8 points | -4.2 % |
| context only: category maintenance | 30 | 30 / 30 | 100.0 % | 7,760 | 30 | 30 / 30 | 100.0 % | 6,910 | 0.0 points | -10.9 % |
| context only: category scene-rendering | 55 | 27 / 55 | 49.1 % | 60,017 | 55 | 37 / 55 | 67.3 % | 37,804 | 18.2 points | -37.0 % |
| context only: category shader-bridge | 30 | 13 / 30 | 43.3 % | 52,679 | 30 | 15 / 30 | 50.0 % | 45,440 | 6.7 points | -13.7 % |
| context + guide: all | 170 | 134 / 170 | 78.8 % | 32,842 | 170 | 145 / 170 | 85.3 % | 29,872 | 6.5 points | -9.0 % |
| context + guide: mode cold | 55 | 30 / 55 | 54.5 % | 64,631 | 55 | 39 / 55 | 70.9 % | 48,243 | 16.4 points | -25.4 % |
| context + guide: mode edit | 115 | 104 / 115 | 90.4 % | 23,672 | 115 | 106 / 115 | 92.2 % | 23,114 | 1.7 points | -2.4 % |
| context + guide: category interaction | 55 | 44 / 55 | 80.0 % | 38,853 | 55 | 47 / 55 | 85.5 % | 35,112 | 5.5 points | -9.6 % |
| context + guide: category maintenance | 30 | 30 / 30 | 100.0 % | 12,369 | 30 | 29 / 30 | 96.7 % | 13,708 | -3.3 points | +10.8 % |
| context + guide: category scene-rendering | 55 | 35 / 55 | 63.6 % | 50,143 | 55 | 39 / 55 | 70.9 % | 46,056 | 7.3 points | -8.2 % |
| context + guide: category shader-bridge | 30 | 25 / 30 | 83.3 % | 22,610 | 30 | 30 / 30 | 100.0 % | 16,251 | 16.7 points | -28.1 % |

The baseline row for reference: see the table of all attempts above; it covers every cell and is not restricted to the matched cells.

## The verdict against the baseline (rule of decision 0108)

Each condition after, over all attempts that count (the retry attempts in the place of the lost ones), against the 170 baseline attempts of the runs before, which were not re-run. Success is matched when the completion rates differ by at most 10 points; tokens per completed task are `fewer` or `more` only when the 95 % bootstrap interval over tasks of the ratio Mtek / baseline excludes 1; the research target is a ratio of at most 0.70 with the verdict better. The rule, in full, is in the report of the same runs.

**Mtek context only against the baseline: WORSE.** completion lower and tokens per completed task significantly more.

|  | attempts | completed | completion rate | tokens per completed task | cost per completed task |
| --- | --- | --- | --- | --- | --- |
| Mtek | 170 | 116 | 68.2 % | 33,648 | $0.0304 |
| baseline | 170 | 156 | 91.8 % | 9,388 | $0.0131 |

Over 34 task(s): token ratio Mtek / baseline 3.584, 95 % interval [2.505, 5.245]; completion difference -23.5 points (success lower, tokens more). Research target of 30 % fewer tokens: not met.

**Mtek context + guide against the baseline: WORSE.** completion matched and tokens per completed task significantly more.

|  | attempts | completed | completion rate | tokens per completed task | cost per completed task |
| --- | --- | --- | --- | --- | --- |
| Mtek | 170 | 145 | 85.3 % | 29,872 | $0.0269 |
| baseline | 170 | 156 | 91.8 % | 9,388 | $0.0131 |

Over 34 task(s): token ratio Mtek / baseline 3.182, 95 % interval [2.565, 3.978]; completion difference -6.5 points (success matched, tokens more). Research target of 30 % fewer tokens: not met.

No verdict is provisional by the rule: every task has at least 5 trials on each side, the largest share of attempts that could not be judged is 0.0 % (the limit is 10 %), and no token count is unknown.

## Holdout (exploratory, numbers only)

Computed from the holdout summary files only (ids, outcomes, tokens and cost; `holdout-summary.jsonl` for the earlier run and `holdout-summary-m7-1.jsonl` for the new one). 8 holdout tasks, 5 trials per task and condition, one model, one run of each condition: **exploratory**, not a result of the benchmark protocol. The holdout was not used for design (the repository check forbids holdout ids in tools, spec and docs), but its tasks may be easier or harder than the main set, so these rates are not comparable with the main set's. The holdout baseline was not re-run: the earlier baseline stands for both Mtek rows. Tokens per completed task is input plus output of all attempts / completed tasks.

| set | condition | attempts | completed | failed | not judged | completion rate | tokens per completed task | cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| earlier (M7-05, old documentation) | Mtek, context only | 40 | 25 | 15 | 0 | 62.5 % | 38,845 | $0.8365 |
| earlier (M7-05, old documentation) | three.js baseline | 40 | 39 | 1 | 0 | 97.5 % | 7,737 | $0.4170 |
| new (M7.1 documentation) | Mtek, context only | 40 | 34 | 6 | 0 | 85.0 % | 17,629 | $0.4292 |
| new (M7.1 documentation) | Mtek, context + guide | 40 | 39 | 1 | 0 | 97.5 % | 16,112 | $0.3326 |

80 rows of the new summary file are attempts that were lost to the network or the spend cap (not judged) and are replaced by the attempt of the same cell in the retry run; they are in no row above.

Verdict by the rule of decision 0108 against the earlier holdout baseline (the holdout has at least 5 tasks, so a verdict is allowed; all of them are exploratory):

| set | condition | verdict | completion difference | token ratio Mtek / baseline | 95 % interval | provisional by the rule | reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| earlier | Mtek, context only | WORSE (exploratory) | -35.0 points | 5.021 | [2.479, 12.073] | no | completion lower and tokens per completed task significantly more |
| new | Mtek, context only | WORSE (exploratory) | -12.5 points | 2.279 | [1.253, 4.866] | no | completion lower and tokens per completed task significantly more |
| new | Mtek, context + guide | WORSE (exploratory) | 0.0 points | 2.083 | [1.444, 3.005] | no | completion matched and tokens per completed task significantly more |
