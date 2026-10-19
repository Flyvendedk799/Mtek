# Before and after: the Mtek conditions, the M7-05 runs against the M7.1 re-run (main set)

Before: `m7-05-main` (the compiler context alone, and the three.js baseline) and `m7-05-guide` (the context with `docs/language-guide.md`). After: `m7-1-rerun-main`, the same 34 tasks, 5 trials, model and temperature, with the compiler context and the guide changed in between (tasks K-01 to K-03). The failures that those changes address were diagnosed on this main set, so the gains below are optimistic; no holdout result exists for the new documentation. 57 of the 340 attempts after were lost to connection errors and timeouts and are not judged; the 'matched cells' sections compare only the cells judged in both runs. The baseline was not re-run.

Generated from the stored `records.jsonl` files by `tools/ai-eval/src/compare-cli.ts` (decision 0124); the same records give the same text. Nothing here is read from a running process, a ledger or a hand computation. The completion rate is completed / attempts that ended by themselves (completed or failed); an attempt the harness could not judge (not-run, error, unavailable, unfinished by budget) is counted as an attempt and as neither. Tokens per completed task is all tokens of all attempts / completed tasks. This document compares two states of the same conditions; the verdict against the baseline by the rule of decision 0108 is in the report.

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

Model of every compared attempt: claude-haiku-4-5-20251001.

| condition | condition id before | condition id after | largest documentation before (bytes) | largest documentation after (bytes) |
| --- | --- | --- | --- | --- |
| context only | f87b1b0089b9 | f87b1b0089b9 | 12,802 | 22,638 |
| context + guide | 079c8015df7d | bd059ee8a1d6 | 26,178 | 37,182 |

A condition id covers the settings of the run and the KIND of documentation (the compiler's context export, or the context plus a named document with the hash of that document); it does not cover the text of the compiler's context export, which the compiler produces. The same id before and after therefore does not mean the same text was given to the model.

## What was lost

| condition | attempts before | not judged before | attempts after | not judged after |
| --- | --- | --- | --- | --- |
| context only | 170 | 0 (none) | 170 | 28 (28 error/transport-error) |
| context + guide | 170 | 0 (none) | 170 | 29 (29 error/transport-error) |

Of 340 attempts of the runs after, 57 (16.8 %) were not judged and are in no completion rate, all of them because the model could not be reached (reason `transport-error`: a connection error or a timeout, no response at all). Nothing is imputed for them: they are not counted as failures and not as successes, and the cells they occupy are left out of the matched comparison below.

Trial index of the attempts not judged after (index: attempts): 4: 57.

## All attempts of each run, as published

Every attempt of each run, including the attempts that were not judged (they count as attempts, not in the rate). The two sides do not cover the same cells when attempts were lost.

| condition | side | attempts | completed | failed | not judged | completion rate | tokens per completed task |
| --- | --- | --- | --- | --- | --- | --- | --- |
| context only | before | 170 | 103 | 67 | 0 | 60.6 % | 40,535 |
| context only | after | 170 | 97 | 45 | 28 | 68.3 % | 33,659 |
| context + guide | before | 170 | 134 | 36 | 0 | 78.8 % | 32,842 |
| context + guide | after | 170 | 119 | 22 | 29 | 84.4 % | 31,166 |
| baseline (three.js), copied from the runs before | before | 170 | 156 | 14 | 0 | 91.8 % | 9,388 |

The baseline was not re-run: its row is the baseline of the runs before, repeated for reference only.

| scope | before: attempts | before: completed / judged | before: completion rate | before: tokens per completed task | after: attempts | after: completed / judged | after: completion rate | after: tokens per completed task | completion rate, change | tokens per completed task, change |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| context only: all | 170 | 103 / 170 | 60.6 % | 40,535 | 170 | 97 / 142 | 68.3 % | 33,659 | 7.7 points | -17.0 % |
| context only: mode cold | 55 | 17 / 55 | 30.9 % | 112,711 | 55 | 25 / 44 | 56.8 % | 55,042 | 25.9 points | -51.2 % |
| context only: mode edit | 115 | 86 / 115 | 74.8 % | 26,268 | 115 | 72 / 98 | 73.5 % | 26,234 | -1.3 points | -0.1 % |
| context only: category interaction | 55 | 33 / 55 | 60.0 % | 49,608 | 55 | 32 / 50 | 64.0 % | 44,813 | 4.0 points | -9.7 % |
| context only: category maintenance | 30 | 30 / 30 | 100.0 % | 7,760 | 30 | 24 / 24 | 100.0 % | 6,988 | 0.0 points | -9.9 % |
| context only: category scene-rendering | 55 | 27 / 55 | 49.1 % | 60,017 | 55 | 29 / 44 | 65.9 % | 38,269 | 16.8 points | -36.2 % |
| context only: category shader-bridge | 30 | 13 / 30 | 43.3 % | 52,679 | 30 | 12 / 24 | 50.0 % | 46,116 | 6.7 points | -12.5 % |
| context + guide: all | 170 | 134 / 170 | 78.8 % | 32,842 | 170 | 119 / 141 | 84.4 % | 31,166 | 5.6 points | -5.1 % |
| context + guide: mode cold | 55 | 30 / 55 | 54.5 % | 64,631 | 55 | 30 / 44 | 68.2 % | 51,678 | 13.6 points | -20.0 % |
| context + guide: mode edit | 115 | 104 / 115 | 90.4 % | 23,672 | 115 | 89 / 97 | 91.8 % | 24,252 | 1.3 points | +2.4 % |
| context + guide: category interaction | 55 | 44 / 55 | 80.0 % | 38,853 | 55 | 42 / 49 | 85.7 % | 35,625 | 5.7 points | -8.3 % |
| context + guide: category maintenance | 30 | 30 / 30 | 100.0 % | 12,369 | 30 | 23 / 24 | 95.8 % | 14,465 | -4.2 points | +16.9 % |
| context + guide: category scene-rendering | 55 | 35 / 55 | 63.6 % | 50,143 | 55 | 30 / 44 | 68.2 % | 48,671 | 4.5 points | -2.9 % |
| context + guide: category shader-bridge | 30 | 25 / 30 | 83.3 % | 22,610 | 30 | 24 / 24 | 100.0 % | 17,487 | 16.7 points | -22.7 % |

## Matched cells (judged in both runs)

A cell is a task with a trial index. The matched cells of a condition are those judged in BOTH runs, so before and after cover exactly the same cells; the attempts that were lost are out of both sides. Tokens per completed task is computed over the matched cells only.

| condition | cells judged after | cells judged in both (matched) | judged after without a judged attempt before |
| --- | --- | --- | --- |
| context only | 142 | 142 | 0 |
| context + guide | 141 | 141 | 0 |

| scope | before: attempts | before: completed / judged | before: completion rate | before: tokens per completed task | after: attempts | after: completed / judged | after: completion rate | after: tokens per completed task | completion rate, change | tokens per completed task, change |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| context only: all | 142 | 86 / 142 | 60.6 % | 40,270 | 142 | 97 / 142 | 68.3 % | 33,659 | 7.7 points | -16.4 % |
| context only: mode cold | 44 | 13 / 44 | 29.5 % | 118,567 | 44 | 25 / 44 | 56.8 % | 55,042 | 27.3 points | -53.6 % |
| context only: mode edit | 98 | 73 / 98 | 74.5 % | 26,327 | 98 | 72 / 98 | 73.5 % | 26,234 | -1.0 points | -0.4 % |
| context only: category interaction | 50 | 31 / 50 | 62.0 % | 45,829 | 50 | 32 / 50 | 64.0 % | 44,813 | 2.0 points | -2.2 % |
| context only: category maintenance | 24 | 24 / 24 | 100.0 % | 7,729 | 24 | 24 / 24 | 100.0 % | 6,988 | 0.0 points | -9.6 % |
| context only: category scene-rendering | 44 | 21 / 44 | 47.7 % | 62,203 | 44 | 29 / 44 | 65.9 % | 38,269 | 18.2 points | -38.5 % |
| context only: category shader-bridge | 24 | 10 / 24 | 41.7 % | 55,076 | 24 | 12 / 24 | 50.0 % | 46,116 | 8.3 points | -16.3 % |
| context + guide: all | 141 | 112 / 141 | 79.4 % | 33,000 | 141 | 119 / 141 | 84.4 % | 31,166 | 5.0 points | -5.6 % |
| context + guide: mode cold | 44 | 25 / 44 | 56.8 % | 62,662 | 44 | 30 / 44 | 68.2 % | 51,678 | 11.4 points | -17.5 % |
| context + guide: mode edit | 97 | 87 / 97 | 89.7 % | 24,477 | 97 | 89 / 97 | 91.8 % | 24,252 | 2.1 points | -0.9 % |
| context + guide: category interaction | 49 | 39 / 49 | 79.6 % | 38,768 | 49 | 42 / 49 | 85.7 % | 35,625 | 6.1 points | -8.1 % |
| context + guide: category maintenance | 24 | 24 / 24 | 100.0 % | 12,479 | 24 | 23 / 24 | 95.8 % | 14,465 | -4.2 points | +15.9 % |
| context + guide: category scene-rendering | 44 | 29 / 44 | 65.9 % | 48,753 | 44 | 30 / 44 | 68.2 % | 48,671 | 2.3 points | -0.2 % |
| context + guide: category shader-bridge | 24 | 20 / 24 | 83.3 % | 23,538 | 24 | 24 / 24 | 100.0 % | 17,487 | 16.7 points | -25.7 % |

The baseline row for reference: see the table of all attempts above; it covers every cell and is not restricted to the matched cells.
