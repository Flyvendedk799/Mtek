# Mtek improvements: final paired pilot

Generated from the stored `records.jsonl` by `tools/ai-eval/src/report.ts` (decision 0108); the same records give the same text. Every attempt is listed in the last section, failures included. The original "about 80 % fewer tokens" claim is an unverified hypothesis and is not tested by the 30 % research target below.

## Runs and recorded settings

| run | started | status | provider / model | settings | spend |
| --- | --- | --- | --- | --- | --- |
| improvements-final-paired-pilot-2026-10-24 | 2026-10-23T23:11:16.085Z | complete | anthropic / claude-haiku-4-5-20251001 | temperature 0, prompt caching true, test feedback messages, max repairs per task | cap $5, this run $0.0803, ledger after $0.1514, 14 calls, 0 refused |

Date of the runs: 2026-10-23T23:11:16.085Z to 2026-10-23T23:11:16.085Z. Models: claude-haiku-4-5-20251001.

## Model claude-haiku-4-5-20251001

### Conclusion on H4 (agent-facing contract), decision 0001 by the rule of decision 0108

**Mtek unconstrained against the baseline: INCONCLUSIVE (provisional).** 3 task(s) are too few for an interval of the token ratio (at least 5 are needed): the point estimate is reported, no direction is concluded.

|  | attempts | completed | completion rate | tokens per completed task | cost per completed task |
| --- | --- | --- | --- | --- | --- |
| Mtek | 6 | 6 | 100.0 % | 9,516 | $0.0068 |
| baseline | 6 | 6 | 100.0 % | 4,478 | $0.0066 |

Over 3 task(s): token ratio Mtek / baseline 2.125 (no interval); completion difference 0.0 points (success matched, tokens undefined). Research target of 30 % fewer tokens: not met.

Provisional because: some task has only 2 trial(s) on a side; the protocol asks for 5.

### Aggregates per condition

| cell | attempts | completed / failed / not judged | completion rate | tokens per completed task | tokens per attempt, median [IQR] | tokens per completed attempt, median [IQR] | repairs per completed, median [IQR] | seconds per attempt, median [IQR] | cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mtek unconstrained | 6 | 6 / 0 / 0 | 100.0 % | 9,516 | 10,334 [6,906, 11,923] | 10,334 [6,906, 11,923] | 0.0 [0.0, 0.8] | 5.3 [5.1, 8.1] | $0.0408 |
| baseline unconstrained | 6 | 6 / 0 / 0 | 100.0 % | 4,478 | 4,391 [4,348, 4,631] | 4,391 [4,348, 4,631] | 0.0 [0.0, 0.0] | 8.9 [7.8, 10.0] | $0.0394 |

Tokens are input plus output of every call of every attempt (cached reads and writes are input). "Not judged" counts not-run, error, unavailable and unfinished-by-budget attempts: they are in the token sums, not in the completion rate.

### Tokens, separately

| cell | input | of which cache reads | of which cache writes | of which uncached | output | total | attempts with unknown usage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mtek unconstrained | 55,122 | 32,986 | 22,112 | 24 | 1,976 | 57,098 | 0 |
| baseline unconstrained | 23,734 | 0 | 0 | 23,734 | 3,136 | 26,870 | 0 |

### First-attempt success (the first candidate that was validated)

| cell | candidates | parse | check | start | tests | everything |
| --- | --- | --- | --- | --- | --- | --- |
| mtek unconstrained | 6 | 6 / 6 (100.0 %) | 4 / 6 (66.7 %) | 4 / 6 (66.7 %) | 4 / 6 (66.7 %) | 4 / 6 (66.7 %) |
| baseline unconstrained | 6 | 6 / 6 (100.0 %) | 6 / 6 (100.0 %) | 6 / 6 (100.0 %) | 6 / 6 (100.0 %) | 6 / 6 (100.0 %) |

### Where the input tokens went (by each part's share of the request's characters)

| cell | instructions | task | documentation | project files | diagnostics | tool results | repair context | generated code | other | output (generated code) | input in repair rounds | output in repair rounds |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mtek unconstrained | 3,968 (7.2 %) | 1,605 (2.9 %) | 45,752 (83.0 %) | 1,599 (2.9 %) | 766 (1.4 %) | 273 (0.5 %) | 542 (1.0 %) | 617 (1.1 %) | 0 (0.0 %) | 1,976 | 13,198 | 248 |
| baseline unconstrained | 2,971 (12.5 %) | 1,222 (5.2 %) | 18,347 (77.3 %) | 1,193 (5.0 %) | 0 (0.0 %) | 0 (0.0 %) | 0 (0.0 %) | 0 (0.0 %) | 0 (0.0 %) | 3,136 | 0 | 0 |

The provider counts tokens per request, not per part of a request: each request's input tokens are split by the share of its characters (system prompt, each message's sections, the model's earlier replies). "documentation" is the compiler context export on the Mtek side (its examples are inside it and are not counted apart) and the reference document on the baseline side. These are estimates of attribution, the totals are exact.

### Per category

| cell | attempts | completed / failed / not judged | completion rate | tokens per completed task | tokens per attempt, median [IQR] | tokens per completed attempt, median [IQR] | repairs per completed, median [IQR] | seconds per attempt, median [IQR] | cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| interaction: mtek unconstrained | 2 | 2 / 0 / 0 | 100.0 % | 12,452 | 12,452 [12,452, 12,452] | 12,452 [12,452, 12,452] | 1.0 [1.0, 1.0] | 9.3 [9.1, 9.5] | $0.0141 |
| interaction: baseline unconstrained | 2 | 2 / 0 / 0 | 100.0 % | 4,711 | 4,711 [4,711, 4,711] | 4,711 [4,711, 4,711] | 0.0 [0.0, 0.0] | 10.0 [10.0, 10.0] | $0.0153 |
| maintenance: mtek unconstrained | 2 | 2 / 0 / 0 | 100.0 % | 5,763 | 5,763 [5,763, 5,763] | 5,763 [5,763, 5,763] | 0.0 [0.0, 0.0] | 5.3 [5.2, 5.4] | $0.0102 |
| maintenance: baseline unconstrained | 2 | 2 / 0 / 0 | 100.0 % | 4,333 | 4,333 [4,333, 4,333] | 4,333 [4,333, 4,333] | 0.0 [0.0, 0.0] | 8.7 [7.3, 10.0] | $0.0113 |
| scene-rendering: mtek unconstrained | 2 | 2 / 0 / 0 | 100.0 % | 10,334 | 10,334 [10,334, 10,334] | 10,334 [10,334, 10,334] | 0.0 [0.0, 0.0] | 5.1 [5.0, 5.1] | $0.0165 |
| scene-rendering: baseline unconstrained | 2 | 2 / 0 / 0 | 100.0 % | 4,391 | 4,391 [4,391, 4,391] | 4,391 [4,391, 4,391] | 0.0 [0.0, 0.0] | 7.8 [7.8, 7.8] | $0.0129 |

### Per mode (cold authoring, edit)

| cell | attempts | completed / failed / not judged | completion rate | tokens per completed task | tokens per attempt, median [IQR] | tokens per completed attempt, median [IQR] | repairs per completed, median [IQR] | seconds per attempt, median [IQR] | cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cold: mtek unconstrained | 2 | 2 / 0 / 0 | 100.0 % | 10,334 | 10,334 [10,334, 10,334] | 10,334 [10,334, 10,334] | 0.0 [0.0, 0.0] | 5.1 [5.0, 5.1] | $0.0165 |
| cold: baseline unconstrained | 2 | 2 / 0 / 0 | 100.0 % | 4,391 | 4,391 [4,391, 4,391] | 4,391 [4,391, 4,391] | 0.0 [0.0, 0.0] | 7.8 [7.8, 7.8] | $0.0129 |
| edit: mtek unconstrained | 4 | 4 / 0 / 0 | 100.0 % | 9,108 | 9,108 [5,763, 12,452] | 9,108 [5,763, 12,452] | 0.5 [0.0, 1.0] | 7.2 [5.4, 9.1] | $0.0244 |
| edit: baseline unconstrained | 4 | 4 / 0 / 0 | 100.0 % | 4,522 | 4,522 [4,333, 4,711] | 4,522 [4,333, 4,711] | 0.0 [0.0, 0.0] | 10.0 [8.9, 10.4] | $0.0265 |

### Per task

| task | category | mode | mtek unconstrained | baseline unconstrained |
| --- | --- | --- | --- | --- |
| interaction-01 | interaction | edit | 2/2 done, 12,452 tok/done, $0.0141 | 2/2 done, 4,711 tok/done, $0.0153 |
| maintenance-01 | maintenance | edit | 2/2 done, 5,763 tok/done, $0.0102 | 2/2 done, 4,333 tok/done, $0.0113 |
| scene-rendering-01 | scene-rendering | cold | 2/2 done, 10,334 tok/done, $0.0165 | 2/2 done, 4,391 tok/done, $0.0129 |

## Documentation given to the model

| side | largest documentation in bytes |
| --- | --- |
| baseline | 9,803 |
| mtek | 28,963 |

## Attempts that could not be judged

None: every attempt ended in success or failure.

## Holdout (reported apart, by ids and layer outcomes only)

No holdout attempt is in these records.

## All attempts

| attempt | task | category | mode | side | kind | outcome | reason | calls | repairs | input | cache read | cache write | output | cost | seconds | first attempt parse/check/build/start/tests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| interaction-01--unconstrained--00 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 12,039 | 5,437 | 6,596 | 413 | $0.0109 | 9.7 | pass/fail/not-run/not-run/not-run |
| interaction-01--baseline-unconstrained--00 | interaction-01 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 3,980 | 0 | 0 | 731 | $0.0076 | 10.0 | pass/pass/pass/pass/pass |
| scene-rendering-01--unconstrained--00 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 10,042 | 0 | 10,039 | 292 | $0.0140 | 4.9 | pass/pass/pass/pass/pass |
| scene-rendering-01--baseline-unconstrained--00 | scene-rendering-01 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,879 | 0 | 0 | 512 | $0.0064 | 7.8 | pass/pass/pass/pass/pass |
| maintenance-01--unconstrained--00 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,480 | 0 | 5,477 | 283 | $0.0083 | 5.1 | pass/pass/pass/pass/pass |
| maintenance-01--baseline-unconstrained--00 | maintenance-01 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,008 | 0 | 0 | 325 | $0.0056 | 11.4 | pass/pass/pass/pass/pass |
| interaction-01--unconstrained--01 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 12,039 | 12,033 | 0 | 413 | $0.0033 | 8.9 | pass/fail/not-run/not-run/not-run |
| interaction-01--baseline-unconstrained--01 | interaction-01 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 3,980 | 0 | 0 | 731 | $0.0076 | 9.9 | pass/pass/pass/pass/pass |
| scene-rendering-01--unconstrained--01 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 10,042 | 10,039 | 0 | 292 | $0.0025 | 5.2 | pass/pass/pass/pass/pass |
| scene-rendering-01--baseline-unconstrained--01 | scene-rendering-01 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,879 | 0 | 0 | 512 | $0.0064 | 7.8 | pass/pass/pass/pass/pass |
| maintenance-01--unconstrained--01 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,480 | 5,477 | 0 | 283 | $0.0020 | 5.4 | pass/pass/pass/pass/pass |
| maintenance-01--baseline-unconstrained--01 | maintenance-01 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,008 | 0 | 0 | 325 | $0.0056 | 5.9 | pass/pass/pass/pass/pass |

## How the conclusion is reached

The rule (decision 0108, applying decision 0001 and `spec/ai-and-benchmarks.md` section 6.4) compares the Mtek condition with the baseline over the tasks both have attempts at, on two axes:

- success: completion rate = completed / attempts that ended by themselves (completed or failed); "matched" when the two differ by at most 10 points, "higher" or "lower" otherwise;
- tokens per completed task = all tokens of all attempts (successes, failures, unfinished) / completed tasks; the ratio Mtek / baseline with a 95 % percentile interval from a bootstrap over tasks (4 000 resamples, fixed seed); "fewer" when the whole interval is below 1, "more" when above 1, "same" otherwise.

better = success matched or higher and tokens fewer, or success higher and tokens the same; worse = success matched or lower and tokens more, or success lower and tokens the same; equivalent = success matched and tokens the same; inconclusive = nothing completes on either side, the axes oppose each other, or no task has attempts on both sides. If only one side completes anything it is better; the other is worse. No comparison is tuned to turn "equivalent" into a win.

The research target (proposed, not a result): at matched success, at least 30 % fewer tokens per completed task than the baseline (ratio at most 0.70 and the verdict better). Missing it triggers the investigation of spec 6.4, not a cryptic syntax. A verdict is provisional when a task has fewer than 5 trials on a side, when more than 10 % of the attempts could not be judged, or when token counts are unknown.
