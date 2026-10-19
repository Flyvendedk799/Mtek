# AI/token benchmark: PILOT of phase 1 (not the M7-05 result)

**This is a pilot, not the M7-05 result.** Two runs on 2026-10-19 (`pilot-2026-10-19`: 4 tasks, Mtek with the compiler context and the three.js baseline, 2 trials each; `pilot-guide-2026-10-19`: 3 of those tasks, Mtek with docs/language-guide.md added, 2 trials each), one model, temperature 1, to measure cost, wall time and failure causes before the full run is scoped. It is far below the protocol (5 trials per task per condition, 34 tasks plus the holdout); every verdict in it is provisional or inconclusive by construction.

Generated from the stored `records.jsonl` by `tools/ai-eval/src/report.ts` (decision 0108); the same records give the same text. Every attempt is listed in the last section, failures included. The original "about 80 % fewer tokens" claim is an unverified hypothesis and is not tested by the 30 % research target below.

## Runs and recorded settings

| run | started | status | provider / model | settings | spend |
| --- | --- | --- | --- | --- | --- |
| pilot-2026-10-19 | 2026-10-19T08:53:13.408Z | complete | anthropic / claude-haiku-4-5-20251001 | temperature 1, prompt caching true, test feedback messages, max repairs per task | cap $0.6, this run $0.2704, ledger after $0.2973, 35 calls, 0 refused |
| pilot-guide-2026-10-19 | 2026-10-19T09:00:58.582Z | complete | anthropic / claude-haiku-4-5-20251001 | temperature 1, prompt caching true, test feedback messages, max repairs per task | cap $0.8, this run $0.1473, ledger after $0.4446, 18 calls, 0 refused |

Date of the runs: 2026-10-19T08:53:13.408Z to 2026-10-19T09:00:58.582Z. Models: claude-haiku-4-5-20251001.

## Model claude-haiku-4-5-20251001

### Conclusion on H4 (agent-facing contract), decision 0001 by the rule of decision 0108

**Mtek unconstrained against the baseline: INCONCLUSIVE (provisional).** 4 task(s) are too few for an interval of the token ratio (at least 5 are needed): the point estimate is reported, no direction is concluded.

|  | attempts | completed | completion rate | tokens per completed task | cost per completed task |
| --- | --- | --- | --- | --- | --- |
| Mtek | 8 | 3 | 37.5 % | 77,083 | $0.0701 |
| baseline | 8 | 8 | 100.0 % | 5,471 | $0.0075 |

Over 4 task(s): token ratio Mtek / baseline 14.090 (no interval); completion difference -62.5 points (success lower, tokens undefined). Research target of 30 % fewer tokens: not met.

Provisional because: some task has only 2 trial(s) on a side; the protocol asks for 5.

**Mtek unconstrained with the document guide added against the baseline: INCONCLUSIVE (provisional).** 3 task(s) are too few for an interval of the token ratio (at least 5 are needed): the point estimate is reported, no direction is concluded.

|  | attempts | completed | completion rate | tokens per completed task | cost per completed task |
| --- | --- | --- | --- | --- | --- |
| Mtek | 6 | 5 | 83.3 % | 43,394 | $0.0295 |
| baseline | 6 | 6 | 100.0 % | 5,807 | $0.0079 |

Over 3 task(s): token ratio Mtek / baseline 7.472 (no interval); completion difference -16.7 points (success lower, tokens undefined). Research target of 30 % fewer tokens: not met.

Provisional because: some task has only 2 trial(s) on a side; the protocol asks for 5; 1 task(s) have attempts on one side only.

Tasks with attempts on one side only (left out of the comparison): maintenance-01.

### Aggregates per condition

| cell | attempts | completed / failed / not judged | completion rate | tokens per completed task | tokens per attempt, median [IQR] | tokens per completed attempt, median [IQR] | repairs per completed, median [IQR] | seconds per attempt, median [IQR] | cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mtek unconstrained | 8 | 3 / 5 / 0 | 37.5 % | 77,083 | 34,662 [18,927, 40,717] | 5,091 [5,090, 25,831] | 0.0 [0.0, 1.5] | 17.6 [10.9, 26.7] | $0.2103 |
| mtek unconstrained+guide | 6 | 5 / 1 / 0 | 83.3 % | 43,394 | 40,885 [22,958, 45,292] | 40,801 [17,010, 40,968] | 2.0 [1.0, 2.0] | 17.2 [12.8, 30.8] | $0.1473 |
| baseline unconstrained | 8 | 8 / 0 / 0 | 100.0 % | 5,471 | 4,739 [4,277, 4,964] | 4,739 [4,277, 4,964] | 0.0 [0.0, 0.0] | 8.5 [5.8, 11.5] | $0.0601 |

Tokens are input plus output of every call of every attempt (cached reads and writes are input). "Not judged" counts not-run, error, unavailable and unfinished-by-budget attempts: they are in the token sums, not in the completion rate.

### Tokens, separately

| cell | input | of which cache reads | of which cache writes | of which uncached | output | total | attempts with unknown usage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mtek unconstrained | 214,251 | 120,408 | 77,530 | 16,313 | 16,999 | 231,250 | 0 |
| mtek unconstrained+guide | 204,069 | 149,789 | 54,226 | 54 | 12,899 | 216,968 | 0 |
| baseline unconstrained | 38,216 | 8,216 | 6,065 | 23,935 | 5,551 | 43,767 | 0 |

### First-attempt success (the first candidate that was validated)

| cell | candidates | parse | check | start | tests | everything |
| --- | --- | --- | --- | --- | --- | --- |
| mtek unconstrained | 8 | 3 / 8 (37.5 %) | 2 / 8 (25.0 %) | 2 / 8 (25.0 %) | 2 / 8 (25.0 %) | 2 / 8 (25.0 %) |
| mtek unconstrained+guide | 6 | 3 / 6 (50.0 %) | 0 / 6 (0.0 %) | 0 / 6 (0.0 %) | 0 / 6 (0.0 %) | 0 / 6 (0.0 %) |
| baseline unconstrained | 8 | 8 / 8 (100.0 %) | 7 / 8 (87.5 %) | 7 / 8 (87.5 %) | 7 / 8 (87.5 %) | 7 / 8 (87.5 %) |

### Where the input tokens went (by each part's share of the request's characters)

| cell | instructions | task | documentation | project files | diagnostics | tool results | repair context | generated code | other | output (generated code) | input in repair rounds | output in repair rounds |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mtek unconstrained | 13,273 (6.2 %) | 8,788 (4.1 %) | 82,761 (38.6 %) | 3,410 (1.6 %) | 65,766 (30.7 %) | 5,557 (2.6 %) | 12,921 (6.0 %) | 21,776 (10.2 %) | 0 (0.0 %) | 16,999 | 181,971 | 12,323 |
| mtek unconstrained+guide | 8,798 (4.3 %) | 6,550 (3.2 %) | 134,833 (66.1 %) | 2,181 (1.1 %) | 19,240 (9.4 %) | 3,662 (1.8 %) | 9,581 (4.7 %) | 19,224 (9.4 %) | 0 (0.0 %) | 12,899 | 155,483 | 6,645 |
| baseline unconstrained | 4,467 (11.7 %) | 2,739 (7.2 %) | 27,711 (72.5 %) | 1,642 (4.3 %) | 217 (0.6 %) | 122 (0.3 %) | 500 (1.3 %) | 816 (2.1 %) | 0 (0.0 %) | 5,551 | 6,068 | 355 |

The provider counts tokens per request, not per part of a request: each request's input tokens are split by the share of its characters (system prompt, each message's sections, the model's earlier replies). "documentation" is the compiler context export on the Mtek side (its examples are inside it and are not counted apart) and the reference document on the baseline side. These are estimates of attribution, the totals are exact.

### Per category

| cell | attempts | completed / failed / not judged | completion rate | tokens per completed task | tokens per attempt, median [IQR] | tokens per completed attempt, median [IQR] | repairs per completed, median [IQR] | seconds per attempt, median [IQR] | cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| interaction: mtek unconstrained | 2 | 1 / 1 / 0 | 50.0 % | 87,591 | 43,796 [42,408, 45,183] | 46,571 [46,571, 46,571] | 3.0 [3.0, 3.0] | 30.1 [25.9, 34.2] | $0.0752 |
| interaction: mtek unconstrained+guide | 2 | 2 / 0 / 0 | 100.0 % | 40,885 | 40,885 [40,843, 40,926] | 40,885 [40,843, 40,926] | 2.0 [2.0, 2.0] | 17.2 [17.1, 17.2] | $0.0558 |
| interaction: baseline unconstrained | 2 | 2 / 0 / 0 | 100.0 % | 8,352 | 8,352 [6,784, 9,921] | 8,352 [6,784, 9,921] | 0.5 [0.3, 0.8] | 16.9 [16.2, 17.6] | $0.0205 |
| maintenance: mtek unconstrained | 2 | 2 / 0 / 0 | 100.0 % | 5,090 | 5,090 [5,090, 5,091] | 5,090 [5,090, 5,091] | 0.0 [0.0, 0.0] | 5.0 [5.0, 5.0] | $0.0092 |
| maintenance: mtek unconstrained+guide | 0 | 0 / 0 / 0 | undefined | UNDEFINED | n/a | n/a | n/a | n/a | $0.0000 |
| maintenance: baseline unconstrained | 2 | 2 / 0 / 0 | 100.0 % | 4,462 | 4,462 [4,359, 4,564] | 4,462 [4,359, 4,564] | 0.0 [0.0, 0.0] | 6.4 [5.8, 7.1] | $0.0126 |
| scene-rendering: mtek unconstrained | 2 | 0 / 2 / 0 | 0.0 % | UNDEFINED | 27,595 [25,567, 29,622] | n/a | n/a | 13.1 [12.9, 13.2] | $0.0519 |
| scene-rendering: mtek unconstrained+guide | 2 | 2 / 0 / 0 | 100.0 % | 16,574 | 16,574 [16,356, 16,792] | 16,574 [16,356, 16,792] | 1.0 [1.0, 1.0] | 9.3 [8.3, 10.4] | $0.0205 |
| scene-rendering: baseline unconstrained | 2 | 2 / 0 / 0 | 100.0 % | 4,225 | 4,225 [4,195, 4,254] | 4,225 [4,195, 4,254] | 0.0 [0.0, 0.0] | 5.4 [5.1, 5.7] | $0.0112 |
| shader-bridge: mtek unconstrained | 2 | 0 / 2 / 0 | 0.0 % | UNDEFINED | 39,145 [38,410, 39,881] | n/a | n/a | 28.2 [26.7, 29.7] | $0.0740 |
| shader-bridge: mtek unconstrained+guide | 2 | 1 / 1 / 0 | 50.0 % | 102,051 | 51,026 [48,879, 53,172] | 46,733 [46,733, 46,733] | 3.0 [3.0, 3.0] | 37.0 [36.1, 37.8] | $0.0710 |
| shader-bridge: baseline unconstrained | 2 | 2 / 0 / 0 | 100.0 % | 4,846 | 4,846 [4,828, 4,863] | 4,846 [4,828, 4,863] | 0.0 [0.0, 0.0] | 9.7 [9.5, 10.0] | $0.0158 |

### Per mode (cold authoring, edit)

| cell | attempts | completed / failed / not judged | completion rate | tokens per completed task | tokens per attempt, median [IQR] | tokens per completed attempt, median [IQR] | repairs per completed, median [IQR] | seconds per attempt, median [IQR] | cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cold: mtek unconstrained | 4 | 0 / 4 / 0 | 0.0 % | UNDEFINED | 34,662 [29,622, 38,410] | n/a | n/a | 19.3 [13.2, 26.7] | $0.1259 |
| cold: mtek unconstrained+guide | 4 | 3 / 1 / 0 | 75.0 % | 45,066 | 31,872 [16,792, 48,879] | 17,010 [16,574, 31,872] | 1.0 [1.0, 2.0] | 23.4 [10.4, 36.1] | $0.0915 |
| cold: baseline unconstrained | 4 | 4 / 0 / 0 | 100.0 % | 4,535 | 4,548 [4,254, 4,828] | 4,548 [4,254, 4,828] | 0.0 [0.0, 0.0] | 7.6 [5.7, 9.5] | $0.0271 |
| edit: mtek unconstrained | 4 | 3 / 1 / 0 | 75.0 % | 32,590 | 23,056 [5,091, 42,408] | 5,091 [5,090, 25,831] | 0.0 [0.0, 1.5] | 13.4 [5.0, 25.9] | $0.0843 |
| edit: mtek unconstrained+guide | 2 | 2 / 0 / 0 | 100.0 % | 40,885 | 40,885 [40,843, 40,926] | 40,885 [40,843, 40,926] | 2.0 [2.0, 2.0] | 17.2 [17.1, 17.2] | $0.0558 |
| edit: baseline unconstrained | 4 | 4 / 0 / 0 | 100.0 % | 6,407 | 4,941 [4,564, 6,784] | 4,941 [4,564, 6,784] | 0.0 [0.0, 0.3] | 11.6 [7.1, 16.2] | $0.0330 |

### Per task

| task | category | mode | mtek unconstrained | mtek unconstrained+guide | baseline unconstrained |
| --- | --- | --- | --- | --- | --- |
| interaction-03 | interaction | edit | 1/2 done, 87,591 tok/done, $0.0752 | 2/2 done, 40,885 tok/done, $0.0558 | 2/2 done, 8,352 tok/done, $0.0205 |
| maintenance-01 | maintenance | edit | 2/2 done, 5,090 tok/done, $0.0092 | - | 2/2 done, 4,462 tok/done, $0.0126 |
| scene-rendering-01 | scene-rendering | cold | 0/2 done, UNDEFINED tok/done, $0.0519 | 2/2 done, 16,574 tok/done, $0.0205 | 2/2 done, 4,225 tok/done, $0.0112 |
| shader-bridge-03 | shader-bridge | cold | 0/2 done, UNDEFINED tok/done, $0.0740 | 1/2 done, 102,051 tok/done, $0.0710 | 2/2 done, 4,846 tok/done, $0.0158 |

## Documentation given to the model

| side | largest documentation in bytes |
| --- | --- |
| baseline | 9,803 |
| mtek+guide | 25,099 |
| mtek | 11,723 |

## Attempts that could not be judged

None: every attempt ended in success or failure.

## Holdout (reported apart, by ids and layer outcomes only)

No holdout attempt is in these records.

## All attempts

| attempt | task | category | mode | side | kind | outcome | reason | calls | repairs | input | cache read | cache write | output | cost | seconds | first attempt parse/check/build/start/tests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| scene-rendering-01--unconstrained--00 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 30,170 | 15,533 | 11,556 | 1,480 | $0.0265 | 13.4 | pass/fail/not-run/not-run/not-run |
| scene-rendering-01--baseline-unconstrained--00 | scene-rendering-01 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,879 | 0 | 0 | 286 | $0.0053 | 4.8 | pass/pass/pass/pass/pass |
| interaction-03--unconstrained--00 | interaction-03 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 36,350 | 23,531 | 12,807 | 4,670 | $0.0417 | 38.4 | fail/fail/not-run/not-run/not-run |
| interaction-03--baseline-unconstrained--00 | interaction-03 | interaction | edit | baseline | unconstrained | success |  | 2 | 1 | 10,179 | 4,108 | 6,065 | 1,310 | $0.0145 | 18.4 | pass/fail/not-run/not-run/not-run |
| shader-bridge-03--unconstrained--00 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 35,447 | 18,013 | 14,158 | 2,227 | $0.0339 | 25.2 | fail/fail/not-run/not-run/not-run |
| shader-bridge-03--baseline-unconstrained--00 | shader-bridge-03 | shader-bridge | cold | baseline | unconstrained | success |  | 1 | 0 | 4,076 | 0 | 0 | 804 | $0.0081 | 10.2 | pass/pass/pass/pass/pass |
| maintenance-01--unconstrained--00 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 4,825 | 0 | 4,822 | 266 | $0.0074 | 5.1 | pass/pass/pass/pass/pass |
| maintenance-01--baseline-unconstrained--00 | maintenance-01 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,008 | 0 | 0 | 248 | $0.0052 | 5.2 | pass/pass/pass/pass/pass |
| scene-rendering-01--unconstrained--01 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 22,030 | 6,960 | 8,420 | 1,509 | $0.0254 | 12.8 | none/none/none/none/none |
| scene-rendering-01--baseline-unconstrained--01 | scene-rendering-01 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,879 | 0 | 0 | 405 | $0.0059 | 6.0 | pass/pass/pass/pass/pass |
| interaction-03--unconstrained--01 | interaction-03 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 43,378 | 31,961 | 11,405 | 3,193 | $0.0334 | 21.8 | fail/fail/not-run/not-run/not-run |
| interaction-03--baseline-unconstrained--01 | interaction-03 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,111 | 4,108 | 0 | 1,104 | $0.0059 | 15.4 | pass/pass/pass/pass/pass |
| shader-bridge-03--unconstrained--01 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 37,226 | 19,588 | 14,362 | 3,390 | $0.0401 | 31.2 | fail/fail/not-run/not-run/not-run |
| shader-bridge-03--baseline-unconstrained--01 | shader-bridge-03 | shader-bridge | cold | baseline | unconstrained | success |  | 1 | 0 | 4,076 | 0 | 0 | 735 | $0.0078 | 9.3 | pass/pass/pass/pass/pass |
| maintenance-01--unconstrained--01 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 4,825 | 4,822 | 0 | 264 | $0.0018 | 4.9 | pass/pass/pass/pass/pass |
| maintenance-01--baseline-unconstrained--01 | maintenance-01 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,008 | 0 | 0 | 659 | $0.0073 | 7.7 | pass/pass/pass/pass/pass |
| scene-rendering-01--mtek-guide-unconstrained--00 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 2 | 1 | 16,194 | 7,395 | 8,793 | 816 | $0.0158 | 11.4 | pass/fail/not-run/not-run/not-run |
| interaction-03--mtek-guide-unconstrained--00 | interaction-03 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 38,624 | 22,778 | 15,837 | 2,177 | $0.0330 | 17.0 | fail/fail/not-run/not-run/not-run |
| shader-bridge-03--mtek-guide-unconstrained--00 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 51,169 | 35,138 | 16,019 | 4,149 | $0.0443 | 38.7 | fail/fail/not-run/not-run/not-run |
| scene-rendering-01--mtek-guide-unconstrained--01 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 2 | 1 | 15,727 | 14,790 | 931 | 411 | $0.0047 | 7.2 | pass/fail/not-run/not-run/not-run |
| interaction-03--mtek-guide-unconstrained--01 | interaction-03 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 38,698 | 32,086 | 6,603 | 2,270 | $0.0228 | 17.3 | fail/fail/not-run/not-run/not-run |
| shader-bridge-03--mtek-guide-unconstrained--01 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | success |  | 4 | 3 | 43,657 | 37,602 | 6,043 | 3,076 | $0.0267 | 35.3 | pass/fail/not-run/not-run/not-run |

## How the conclusion is reached

The rule (decision 0108, applying decision 0001 and `spec/ai-and-benchmarks.md` section 6.4) compares the Mtek condition with the baseline over the tasks both have attempts at, on two axes:

- success: completion rate = completed / attempts that ended by themselves (completed or failed); "matched" when the two differ by at most 10 points, "higher" or "lower" otherwise;
- tokens per completed task = all tokens of all attempts (successes, failures, unfinished) / completed tasks; the ratio Mtek / baseline with a 95 % percentile interval from a bootstrap over tasks (4 000 resamples, fixed seed); "fewer" when the whole interval is below 1, "more" when above 1, "same" otherwise.

better = success matched or higher and tokens fewer, or success higher and tokens the same; worse = success matched or lower and tokens more, or success lower and tokens the same; equivalent = success matched and tokens the same; inconclusive = nothing completes on either side, the axes oppose each other, or no task has attempts on both sides. If only one side completes anything it is better; the other is worse. No comparison is tuned to turn "equivalent" into a win.

The research target (proposed, not a result): at matched success, at least 30 % fewer tokens per completed task than the baseline (ratio at most 0.70 and the verdict better). Missing it triggers the investigation of spec 6.4, not a cryptic syntax. A verdict is provisional when a task has fewer than 5 trials on a side, when more than 10 % of the attempts could not be judged, or when token counts are unknown.
