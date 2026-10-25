# PR 3 against the first M7 measurement

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
| pr3-main-mtek | 2026-10-20T07:27:26.692Z | complete | anthropic / claude-haiku-4-5-20251001 | temperature 1, prompt caching true, test feedback messages |

Model of every compared attempt: claude-haiku-4-5-20251001.

| condition | condition id before | condition id after | largest documentation before (bytes) | largest documentation after (bytes) |
| --- | --- | --- | --- | --- |
| context only | f87b1b0089b9 | f87b1b0089b9 | 12,802 | 22,638 |
| context + guide | 079c8015df7d | c41741eaae09 | 26,178 | 37,513 |

A condition id covers the settings of the run and the KIND of documentation (the compiler's context export, or the context plus a named document with the hash of that document); it does not cover the text of the compiler's context export, which the compiler produces. The same id before and after therefore does not mean the same text was given to the model.

## What was lost

| condition | attempts before | not judged before | attempts after | not judged after |
| --- | --- | --- | --- | --- |
| context only | 170 | 0 (none) | 170 | 0 (none) |
| context + guide | 170 | 0 (none) | 170 | 0 (none) |

No attempt of the runs after was lost: every one ended in success or failure.

## All attempts of each run, as published

Every attempt of each run, including the attempts that were not judged (they count as attempts, not in the rate). The two sides do not cover the same cells when attempts were lost.

| condition | side | attempts | completed | failed | not judged | completion rate | tokens per completed task |
| --- | --- | --- | --- | --- | --- | --- | --- |
| context only | before | 170 | 103 | 67 | 0 | 60.6 % | 40,535 |
| context only | after | 170 | 119 | 51 | 0 | 70.0 % | 30,908 |
| context + guide | before | 170 | 134 | 36 | 0 | 78.8 % | 32,842 |
| context + guide | after | 170 | 144 | 26 | 0 | 84.7 % | 29,428 |
| baseline (three.js), copied from the runs before | before | 170 | 156 | 14 | 0 | 91.8 % | 9,388 |

The baseline was not re-run: its row is the baseline of the runs before, repeated for reference only.

| scope | before: attempts | before: completed / judged | before: completion rate | before: tokens per completed task | after: attempts | after: completed / judged | after: completion rate | after: tokens per completed task | completion rate, change | tokens per completed task, change |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| context only: all | 170 | 103 / 170 | 60.6 % | 40,535 | 170 | 119 / 170 | 70.0 % | 30,908 | 9.4 points | -23.7 % |
| context only: mode cold | 55 | 17 / 55 | 30.9 % | 112,711 | 55 | 33 / 55 | 60.0 % | 44,437 | 29.1 points | -60.6 % |
| context only: mode edit | 115 | 86 / 115 | 74.8 % | 26,268 | 115 | 86 / 115 | 74.8 % | 25,717 | 0.0 points | -2.1 % |
| context only: category interaction | 55 | 33 / 55 | 60.0 % | 49,608 | 55 | 37 / 55 | 67.3 % | 43,150 | 7.3 points | -13.0 % |
| context only: category maintenance | 30 | 30 / 30 | 100.0 % | 7,760 | 30 | 30 / 30 | 100.0 % | 6,891 | 0.0 points | -11.2 % |
| context only: category scene-rendering | 55 | 27 / 55 | 49.1 % | 60,017 | 55 | 37 / 55 | 67.3 % | 32,493 | 18.2 points | -45.9 % |
| context only: category shader-bridge | 30 | 13 / 30 | 43.3 % | 52,679 | 30 | 15 / 30 | 50.0 % | 44,838 | 6.7 points | -14.9 % |
| context + guide: all | 170 | 134 / 170 | 78.8 % | 32,842 | 170 | 144 / 170 | 84.7 % | 29,428 | 5.9 points | -10.4 % |
| context + guide: mode cold | 55 | 30 / 55 | 54.5 % | 64,631 | 55 | 39 / 55 | 70.9 % | 45,093 | 16.4 points | -30.2 % |
| context + guide: mode edit | 115 | 104 / 115 | 90.4 % | 23,672 | 115 | 105 / 115 | 91.3 % | 23,610 | 0.9 points | -0.3 % |
| context + guide: category interaction | 55 | 44 / 55 | 80.0 % | 38,853 | 55 | 45 / 55 | 81.8 % | 35,794 | 1.8 points | -7.9 % |
| context + guide: category maintenance | 30 | 30 / 30 | 100.0 % | 12,369 | 30 | 30 / 30 | 100.0 % | 13,264 | 0.0 points | +7.2 % |
| context + guide: category scene-rendering | 55 | 35 / 55 | 63.6 % | 50,143 | 55 | 39 / 55 | 70.9 % | 45,711 | 7.3 points | -8.8 % |
| context + guide: category shader-bridge | 30 | 25 / 30 | 83.3 % | 22,610 | 30 | 30 / 30 | 100.0 % | 14,876 | 16.7 points | -34.2 % |

## Matched cells (judged in both runs)

A cell is a task with a trial index. The matched cells of a condition are those judged in BOTH runs, so before and after cover exactly the same cells; the attempts that were lost are out of both sides. Tokens per completed task is computed over the matched cells only.

| condition | cells judged after | cells judged in both (matched) | judged after without a judged attempt before |
| --- | --- | --- | --- |
| context only | 170 | 170 | 0 |
| context + guide | 170 | 170 | 0 |

Every cell of every condition is judged in both runs, so the matched cells are all the cells and the table below equals the table of all attempts above.

| scope | before: attempts | before: completed / judged | before: completion rate | before: tokens per completed task | after: attempts | after: completed / judged | after: completion rate | after: tokens per completed task | completion rate, change | tokens per completed task, change |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| context only: all | 170 | 103 / 170 | 60.6 % | 40,535 | 170 | 119 / 170 | 70.0 % | 30,908 | 9.4 points | -23.7 % |
| context only: mode cold | 55 | 17 / 55 | 30.9 % | 112,711 | 55 | 33 / 55 | 60.0 % | 44,437 | 29.1 points | -60.6 % |
| context only: mode edit | 115 | 86 / 115 | 74.8 % | 26,268 | 115 | 86 / 115 | 74.8 % | 25,717 | 0.0 points | -2.1 % |
| context only: category interaction | 55 | 33 / 55 | 60.0 % | 49,608 | 55 | 37 / 55 | 67.3 % | 43,150 | 7.3 points | -13.0 % |
| context only: category maintenance | 30 | 30 / 30 | 100.0 % | 7,760 | 30 | 30 / 30 | 100.0 % | 6,891 | 0.0 points | -11.2 % |
| context only: category scene-rendering | 55 | 27 / 55 | 49.1 % | 60,017 | 55 | 37 / 55 | 67.3 % | 32,493 | 18.2 points | -45.9 % |
| context only: category shader-bridge | 30 | 13 / 30 | 43.3 % | 52,679 | 30 | 15 / 30 | 50.0 % | 44,838 | 6.7 points | -14.9 % |
| context + guide: all | 170 | 134 / 170 | 78.8 % | 32,842 | 170 | 144 / 170 | 84.7 % | 29,428 | 5.9 points | -10.4 % |
| context + guide: mode cold | 55 | 30 / 55 | 54.5 % | 64,631 | 55 | 39 / 55 | 70.9 % | 45,093 | 16.4 points | -30.2 % |
| context + guide: mode edit | 115 | 104 / 115 | 90.4 % | 23,672 | 115 | 105 / 115 | 91.3 % | 23,610 | 0.9 points | -0.3 % |
| context + guide: category interaction | 55 | 44 / 55 | 80.0 % | 38,853 | 55 | 45 / 55 | 81.8 % | 35,794 | 1.8 points | -7.9 % |
| context + guide: category maintenance | 30 | 30 / 30 | 100.0 % | 12,369 | 30 | 30 / 30 | 100.0 % | 13,264 | 0.0 points | +7.2 % |
| context + guide: category scene-rendering | 55 | 35 / 55 | 63.6 % | 50,143 | 55 | 39 / 55 | 70.9 % | 45,711 | 7.3 points | -8.8 % |
| context + guide: category shader-bridge | 30 | 25 / 30 | 83.3 % | 22,610 | 30 | 30 / 30 | 100.0 % | 14,876 | 16.7 points | -34.2 % |

The baseline row for reference: see the table of all attempts above; it covers every cell and is not restricted to the matched cells.

## The verdict against the baseline (rule of decision 0108)

Each condition after, over all attempts that count (the retry attempts in the place of the lost ones), against the 170 baseline attempts of the runs before, which were not re-run. Success is matched when the completion rates differ by at most 10 points; tokens per completed task are `fewer` or `more` only when the 95 % bootstrap interval over tasks of the ratio Mtek / baseline excludes 1; the research target is a ratio of at most 0.70 with the verdict better. The rule, in full, is in the report of the same runs.

**Mtek context only against the baseline: WORSE.** completion lower and tokens per completed task significantly more.

|  | attempts | completed | completion rate | tokens per completed task | cost per completed task |
| --- | --- | --- | --- | --- | --- |
| Mtek | 170 | 119 | 70.0 % | 30,908 | $0.0290 |
| baseline | 170 | 156 | 91.8 % | 9,388 | $0.0131 |

Over 34 task(s): token ratio Mtek / baseline 3.292, 95 % interval [2.344, 4.839]; completion difference -21.8 points (success lower, tokens more). Research target of 30 % fewer tokens: not met.

**Mtek context + guide against the baseline: WORSE.** completion matched and tokens per completed task significantly more.

|  | attempts | completed | completion rate | tokens per completed task | cost per completed task |
| --- | --- | --- | --- | --- | --- |
| Mtek | 170 | 144 | 84.7 % | 29,428 | $0.0264 |
| baseline | 170 | 156 | 91.8 % | 9,388 | $0.0131 |

Over 34 task(s): token ratio Mtek / baseline 3.135, 95 % interval [2.538, 3.932]; completion difference -7.1 points (success matched, tokens more). Research target of 30 % fewer tokens: not met.

No verdict is provisional by the rule: every task has at least 5 trials on each side, the largest share of attempts that could not be judged is 0.0 % (the limit is 10 %), and no token count is unknown.
