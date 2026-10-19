# AI/token benchmark report

Generated from the stored `records.jsonl` by `tools/ai-eval/src/report.ts` (decision 0108); the same records give the same text. Every attempt is listed in the last section, failures included. The original "about 80 % fewer tokens" claim is an unverified hypothesis and is not tested by the 30 % research target below.

## Runs and recorded settings

| run | started | status | provider / model | settings | spend |
| --- | --- | --- | --- | --- | --- |
| m7-05-main | 2026-10-19T09:23:16.558Z | complete | anthropic / claude-haiku-4-5-20251001 | temperature 1, prompt caching true, test feedback messages, max repairs per task | cap $7.8, this run $6.1594, ledger after $6.6040, 731 calls, 0 refused |
| m7-05-guide | 2026-10-19T11:44:58.777Z | complete | anthropic / claude-haiku-4-5-20251001 | temperature 1, prompt caching true, test feedback messages, max repairs per task | cap $13, this run $3.9472, ledger after $11.8048, 388 calls, 0 refused |
| m7-05-holdout | 2026-10-19T11:23:37.762Z | complete | anthropic / claude-haiku-4-5-20251001 | temperature 1, prompt caching true, test feedback messages, max repairs per task | cap $8.2, this run $1.2536, ledger after $7.8575, 171 calls, 0 refused |

Date of the runs: 2026-10-19T09:23:16.558Z to 2026-10-19T11:44:58.777Z. Models: claude-haiku-4-5-20251001.

## Model claude-haiku-4-5-20251001

### Conclusion on H4 (agent-facing contract), decision 0001 by the rule of decision 0108

**Mtek unconstrained against the baseline: WORSE.** completion lower and tokens per completed task significantly more.

|  | attempts | completed | completion rate | tokens per completed task | cost per completed task |
| --- | --- | --- | --- | --- | --- |
| Mtek | 170 | 103 | 60.6 % | 40,535 | $0.0399 |
| baseline | 170 | 156 | 91.8 % | 9,388 | $0.0131 |

Over 34 task(s): token ratio Mtek / baseline 4.318, 95 % interval [3.068, 6.227]; completion difference -31.2 points (success lower, tokens more). Research target of 30 % fewer tokens: not met.

**Mtek unconstrained with the document guide added against the baseline: WORSE.** completion lower and tokens per completed task significantly more.

|  | attempts | completed | completion rate | tokens per completed task | cost per completed task |
| --- | --- | --- | --- | --- | --- |
| Mtek | 170 | 134 | 78.8 % | 32,842 | $0.0295 |
| baseline | 170 | 156 | 91.8 % | 9,388 | $0.0131 |

Over 34 task(s): token ratio Mtek / baseline 3.498, 95 % interval [2.684, 4.650]; completion difference -12.9 points (success lower, tokens more). Research target of 30 % fewer tokens: not met.

### Aggregates per condition

| cell | attempts | completed / failed / not judged | completion rate | tokens per completed task | tokens per attempt, median [IQR] | tokens per completed attempt, median [IQR] | repairs per completed, median [IQR] | seconds per attempt, median [IQR] | cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mtek unconstrained | 170 | 103 / 67 / 0 | 60.6 % | 40,535 | 26,068 [11,250, 36,962] | 12,268 [5,825, 23,908] | 1.0 [0.0, 2.0] | 18.7 [9.3, 26.6] | $4.1118 |
| mtek unconstrained+guide | 170 | 134 / 36 / 0 | 78.8 % | 32,842 | 21,522 [10,151, 39,696] | 17,066 [9,987, 26,116] | 1.0 [0.0, 2.0] | 12.5 [8.2, 23.0] | $3.9472 |
| baseline unconstrained | 170 | 156 / 14 / 0 | 91.8 % | 9,388 | 5,052 [4,707, 9,819] | 5,008 [4,692, 5,472] | 0.0 [0.0, 0.0] | 11.1 [8.2, 15.3] | $2.0476 |

Tokens are input plus output of every call of every attempt (cached reads and writes are input). "Not judged" counts not-run, error, unavailable and unfinished-by-budget attempts: they are in the token sums, not in the completion rate.

### Tokens, separately

| cell | input | of which cache reads | of which cache writes | of which uncached | output | total | attempts with unknown usage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mtek unconstrained | 3,847,700 | 1,990,381 | 1,673,066 | 184,253 | 327,427 | 4,175,127 | 0 |
| mtek unconstrained+guide | 4,141,669 | 2,196,146 | 1,944,359 | 1,164 | 259,201 | 4,400,870 | 0 |
| baseline unconstrained | 1,272,681 | 384,464 | 646,397 | 241,820 | 191,871 | 1,464,552 | 0 |

### First-attempt success (the first candidate that was validated)

| cell | candidates | parse | check | start | tests | everything |
| --- | --- | --- | --- | --- | --- | --- |
| mtek unconstrained | 170 | 87 / 170 (51.2 %) | 52 / 170 (30.6 %) | 52 / 170 (30.6 %) | 40 / 170 (23.5 %) | 40 / 170 (23.5 %) |
| mtek unconstrained+guide | 170 | 142 / 170 (83.5 %) | 75 / 170 (44.1 %) | 75 / 170 (44.1 %) | 63 / 170 (37.1 %) | 63 / 170 (37.1 %) |
| baseline unconstrained | 170 | 152 / 170 (89.4 %) | 144 / 170 (84.7 %) | 144 / 170 (84.7 %) | 126 / 170 (74.1 %) | 126 / 170 (74.1 %) |

### Where the input tokens went (by each part's share of the request's characters)

| cell | instructions | task | documentation | project files | diagnostics | tool results | repair context | generated code | other | output (generated code) | input in repair rounds | output in repair rounds |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mtek unconstrained | 244,398 (6.4 %) | 209,446 (5.4 %) | 1,662,214 (43.2 %) | 80,338 (2.1 %) | 890,874 (23.2 %) | 95,029 (2.5 %) | 234,396 (6.1 %) | 431,004 (11.2 %) | 0 (0.0 %) | 327,427 | 3,076,535 | 193,408 |
| mtek unconstrained+guide | 189,577 (4.6 %) | 172,876 (4.2 %) | 2,994,227 (72.3 %) | 61,455 (1.5 %) | 230,275 (5.6 %) | 55,886 (1.3 %) | 151,547 (3.7 %) | 285,827 (6.9 %) | 0 (0.0 %) | 259,201 | 2,635,084 | 127,479 |
| baseline unconstrained | 126,531 (9.9 %) | 110,077 (8.6 %) | 775,322 (60.9 %) | 51,601 (4.1 %) | 7,705 (0.6 %) | 16,616 (1.3 %) | 70,886 (5.6 %) | 113,943 (9.0 %) | 0 (0.0 %) | 191,871 | 567,766 | 47,067 |

The provider counts tokens per request, not per part of a request: each request's input tokens are split by the share of its characters (system prompt, each message's sections, the model's earlier replies). "documentation" is the compiler context export on the Mtek side (its examples are inside it and are not counted apart) and the reference document on the baseline side. These are estimates of attribution, the totals are exact.

### Per category

| cell | attempts | completed / failed / not judged | completion rate | tokens per completed task | tokens per attempt, median [IQR] | tokens per completed attempt, median [IQR] | repairs per completed, median [IQR] | seconds per attempt, median [IQR] | cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| interaction: mtek unconstrained | 55 | 33 / 22 / 0 | 60.0 % | 49,608 | 30,007 [22,071, 38,974] | 23,529 [13,779, 30,007] | 2.0 [1.0, 2.0] | 21.5 [17.0, 26.8] | $1.5518 |
| interaction: mtek unconstrained+guide | 55 | 44 / 11 / 0 | 80.0 % | 38,853 | 27,016 [13,544, 40,817] | 24,469 [10,212, 38,331] | 1.0 [0.0, 2.0] | 17.0 [12.0, 26.7] | $1.5282 |
| interaction: baseline unconstrained | 55 | 53 / 2 / 0 | 96.4 % | 7,540 | 5,170 [4,979, 5,615] | 5,156 [4,974, 5,505] | 0.0 [0.0, 0.0] | 13.6 [11.8, 17.5] | $0.6391 |
| maintenance: mtek unconstrained | 30 | 30 / 0 / 0 | 100.0 % | 7,760 | 6,012 [5,805, 6,344] | 6,012 [5,805, 6,344] | 0.0 [0.0, 0.0] | 7.6 [6.8, 8.4] | $0.2957 |
| maintenance: mtek unconstrained+guide | 30 | 30 / 0 / 0 | 100.0 % | 12,369 | 10,479 [9,847, 10,691] | 10,479 [9,847, 10,691] | 0.0 [0.0, 0.0] | 8.0 [6.2, 9.3] | $0.4550 |
| maintenance: baseline unconstrained | 30 | 30 / 0 / 0 | 100.0 % | 5,329 | 4,818 [4,464, 5,129] | 4,818 [4,464, 5,129] | 0.0 [0.0, 0.0] | 7.0 [6.5, 10.4] | $0.2468 |
| scene-rendering: mtek unconstrained | 55 | 27 / 28 / 0 | 49.1 % | 60,017 | 30,930 [13,035, 42,138] | 12,978 [11,163, 24,470] | 1.0 [1.0, 2.0] | 23.1 [13.2, 31.3] | $1.6434 |
| scene-rendering: mtek unconstrained+guide | 55 | 35 / 20 / 0 | 63.6 % | 50,143 | 29,013 [20,067, 42,209] | 21,147 [17,536, 27,827] | 1.0 [1.0, 2.0] | 14.9 [10.6, 26.2] | $1.3929 |
| scene-rendering: baseline unconstrained | 55 | 44 / 11 / 0 | 80.0 % | 15,160 | 5,220 [4,801, 13,548] | 5,032 [4,694, 5,705] | 0.0 [0.0, 0.0] | 10.0 [8.2, 26.2] | $0.8350 |
| shader-bridge: mtek unconstrained | 30 | 13 / 17 / 0 | 43.3 % | 52,679 | 26,335 [12,148, 29,643] | 5,916 [5,629, 12,748] | 0.0 [0.0, 1.0] | 19.6 [10.2, 21.4] | $0.6209 |
| shader-bridge: mtek unconstrained+guide | 30 | 25 / 5 / 0 | 83.3 % | 22,610 | 10,012 [9,918, 21,607] | 9,986 [9,911, 10,155] | 0.0 [0.0, 0.0] | 8.1 [6.9, 14.3] | $0.5711 |
| shader-bridge: baseline unconstrained | 30 | 29 / 1 / 0 | 96.7 % | 8,207 | 4,806 [4,610, 10,585] | 4,770 [4,609, 10,046] | 0.0 [0.0, 1.0] | 9.9 [8.7, 12.9] | $0.3267 |

### Per mode (cold authoring, edit)

| cell | attempts | completed / failed / not judged | completion rate | tokens per completed task | tokens per attempt, median [IQR] | tokens per completed attempt, median [IQR] | repairs per completed, median [IQR] | seconds per attempt, median [IQR] | cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cold: mtek unconstrained | 55 | 17 / 38 / 0 | 30.9 % | 112,711 | 37,889 [27,682, 43,172] | 17,048 [11,786, 25,756] | 2.0 [1.0, 2.0] | 26.8 [19.7, 31.7] | $1.9307 |
| cold: mtek unconstrained+guide | 55 | 30 / 25 / 0 | 54.5 % | 64,631 | 34,086 [26,241, 45,049] | 26,321 [17,683, 29,258] | 2.0 [1.0, 2.0] | 17.7 [12.7, 27.4] | $1.4823 |
| cold: baseline unconstrained | 55 | 43 / 12 / 0 | 78.2 % | 16,243 | 5,317 [4,844, 18,891] | 5,066 [4,730, 6,449] | 0.0 [0.0, 0.0] | 11.6 [9.5, 29.4] | $0.8754 |
| edit: mtek unconstrained | 115 | 86 / 29 / 0 | 74.8 % | 26,268 | 14,356 [5,897, 29,356] | 12,117 [5,801, 22,287] | 1.0 [0.0, 2.0] | 14.5 [7.7, 21.0] | $2.1811 |
| edit: mtek unconstrained+guide | 115 | 104 / 11 / 0 | 90.4 % | 23,672 | 10,581 [9,933, 25,205] | 10,334 [9,913, 22,077] | 0.0 [0.0, 1.0] | 9.8 [7.1, 17.0] | $2.4649 |
| edit: baseline unconstrained | 115 | 113 / 2 / 0 | 98.3 % | 6,780 | 5,006 [4,689, 5,412] | 4,994 [4,688, 5,354] | 0.0 [0.0, 0.0] | 11.0 [7.5, 14.0] | $1.1722 |

### Per task

| task | category | mode | mtek unconstrained | mtek unconstrained+guide | baseline unconstrained |
| --- | --- | --- | --- | --- | --- |
| interaction-01 | interaction | edit | 5/5 done, 24,563 tok/done, $0.0888 | 5/5 done, 10,063 tok/done, $0.0742 | 5/5 done, 4,658 tok/done, $0.0369 |
| interaction-02 | interaction | edit | 2/5 done, 80,845 tok/done, $0.1432 | 5/5 done, 36,520 tok/done, $0.1537 | 5/5 done, 6,175 tok/done, $0.0512 |
| interaction-03 | interaction | edit | 5/5 done, 35,449 tok/done, $0.1668 | 5/5 done, 39,970 tok/done, $0.1636 | 5/5 done, 10,847 tok/done, $0.0686 |
| interaction-04 | interaction | edit | 4/5 done, 26,308 tok/done, $0.1034 | 3/5 done, 60,871 tok/done, $0.1426 | 5/5 done, 7,325 tok/done, $0.0592 |
| interaction-05 | interaction | edit | 0/5 done, UNDEFINED tok/done, $0.1112 | 5/5 done, 14,839 tok/done, $0.0919 | 4/5 done, 11,183 tok/done, $0.0621 |
| interaction-06 | interaction | edit | 5/5 done, 5,470 tok/done, $0.0433 | 5/5 done, 9,895 tok/done, $0.0729 | 5/5 done, 9,234 tok/done, $0.0822 |
| interaction-07 | interaction | edit | 1/5 done, 223,423 tok/done, $0.2371 | 2/5 done, 119,392 tok/done, $0.1967 | 5/5 done, 6,570 tok/done, $0.0574 |
| interaction-08 | interaction | cold | 0/5 done, UNDEFINED tok/done, $0.2063 | 5/5 done, 23,108 tok/done, $0.0824 | 5/5 done, 4,943 tok/done, $0.0426 |
| interaction-09 | interaction | edit | 4/5 done, 32,942 tok/done, $0.1299 | 3/5 done, 73,335 tok/done, $0.1764 | 5/5 done, 5,545 tok/done, $0.0575 |
| interaction-10 | interaction | edit | 5/5 done, 25,960 tok/done, $0.1382 | 5/5 done, 24,930 tok/done, $0.1331 | 4/5 done, 13,332 tok/done, $0.0756 |
| interaction-11 | interaction | edit | 2/5 done, 94,176 tok/done, $0.1835 | 1/5 done, 271,483 tok/done, $0.2409 | 5/5 done, 5,019 tok/done, $0.0458 |
| maintenance-01 | maintenance | edit | 5/5 done, 5,105 tok/done, $0.0371 | 5/5 done, 9,445 tok/done, $0.0540 | 5/5 done, 4,309 tok/done, $0.0276 |
| maintenance-02 | maintenance | edit | 5/5 done, 6,045 tok/done, $0.0474 | 5/5 done, 10,606 tok/done, $0.0803 | 5/5 done, 4,720 tok/done, $0.0384 |
| maintenance-03 | maintenance | edit | 5/5 done, 14,776 tok/done, $0.0610 | 5/5 done, 13,977 tok/done, $0.0735 | 5/5 done, 4,464 tok/done, $0.0347 |
| maintenance-04 | maintenance | edit | 5/5 done, 8,548 tok/done, $0.0553 | 5/5 done, 17,118 tok/done, $0.0929 | 5/5 done, 8,365 tok/done, $0.0540 |
| maintenance-05 | maintenance | edit | 5/5 done, 5,812 tok/done, $0.0469 | 5/5 done, 12,483 tok/done, $0.0795 | 5/5 done, 4,971 tok/done, $0.0432 |
| maintenance-06 | maintenance | edit | 5/5 done, 6,273 tok/done, $0.0480 | 5/5 done, 10,588 tok/done, $0.0747 | 5/5 done, 5,146 tok/done, $0.0490 |
| scene-rendering-01 | scene-rendering | cold | 3/5 done, 32,997 tok/done, $0.0990 | 5/5 done, 25,924 tok/done, $0.0874 | 5/5 done, 4,261 tok/done, $0.0289 |
| scene-rendering-02 | scene-rendering | cold | 3/5 done, 41,953 tok/done, $0.1158 | 5/5 done, 22,570 tok/done, $0.0814 | 5/5 done, 5,646 tok/done, $0.0431 |
| scene-rendering-03 | scene-rendering | cold | 5/5 done, 22,169 tok/done, $0.1308 | 4/5 done, 35,516 tok/done, $0.1224 | 5/5 done, 5,101 tok/done, $0.0488 |
| scene-rendering-04 | scene-rendering | cold | 3/5 done, 45,682 tok/done, $0.1386 | 5/5 done, 26,445 tok/done, $0.0965 | 5/5 done, 4,898 tok/done, $0.0411 |
| scene-rendering-05 | scene-rendering | edit | 5/5 done, 15,625 tok/done, $0.0700 | 5/5 done, 21,223 tok/done, $0.0927 | 5/5 done, 6,200 tok/done, $0.0526 |
| scene-rendering-06 | scene-rendering | cold | 0/5 done, UNDEFINED tok/done, $0.1840 | 0/5 done, UNDEFINED tok/done, $0.1318 | 4/5 done, 25,153 tok/done, $0.1255 |
| scene-rendering-07 | scene-rendering | cold | 0/5 done, UNDEFINED tok/done, $0.2101 | 0/5 done, UNDEFINED tok/done, $0.1584 | 0/5 done, UNDEFINED tok/done, $0.1405 |
| scene-rendering-08 | scene-rendering | edit | 5/5 done, 5,329 tok/done, $0.0396 | 5/5 done, 9,680 tok/done, $0.0673 | 5/5 done, 5,710 tok/done, $0.0401 |
| scene-rendering-09 | scene-rendering | cold | 3/5 done, 58,982 tok/done, $0.2013 | 5/5 done, 27,875 tok/done, $0.1126 | 5/5 done, 5,190 tok/done, $0.0517 |
| scene-rendering-10 | scene-rendering | cold | 0/5 done, UNDEFINED tok/done, $0.1966 | 1/5 done, 249,419 tok/done, $0.2421 | 2/5 done, 67,302 tok/done, $0.1381 |
| scene-rendering-11 | scene-rendering | cold | 0/5 done, UNDEFINED tok/done, $0.2575 | 0/5 done, UNDEFINED tok/done, $0.2002 | 3/5 done, 30,578 tok/done, $0.1247 |
| shader-bridge-01 | shader-bridge | edit | 0/5 done, UNDEFINED tok/done, $0.1015 | 5/5 done, 9,720 tok/done, $0.0726 | 5/5 done, 5,624 tok/done, $0.0444 |
| shader-bridge-02 | shader-bridge | edit | 0/5 done, UNDEFINED tok/done, $0.1008 | 5/5 done, 12,340 tok/done, $0.0843 | 5/5 done, 9,076 tok/done, $0.0662 |
| shader-bridge-03 | shader-bridge | cold | 0/5 done, UNDEFINED tok/done, $0.1906 | 0/5 done, UNDEFINED tok/done, $0.1670 | 4/5 done, 16,559 tok/done, $0.0904 |
| shader-bridge-04 | shader-bridge | edit | 3/5 done, 46,921 tok/done, $0.1306 | 5/5 done, 24,400 tok/done, $0.1067 | 5/5 done, 4,768 tok/done, $0.0381 |
| shader-bridge-05 | shader-bridge | edit | 5/5 done, 5,621 tok/done, $0.0409 | 5/5 done, 9,973 tok/done, $0.0686 | 5/5 done, 7,027 tok/done, $0.0468 |
| shader-bridge-06 | shader-bridge | edit | 5/5 done, 9,766 tok/done, $0.0566 | 5/5 done, 12,041 tok/done, $0.0719 | 5/5 done, 7,858 tok/done, $0.0407 |

## Documentation given to the model

| side | largest documentation in bytes |
| --- | --- |
| baseline | 9,803 |
| mtek+guide | 26,178 |
| mtek | 12,802 |

## Attempts that could not be judged

None: every attempt ended in success or failure.

## Holdout (reported apart, by ids and layer outcomes only)

The holdout set is never used for design (decision 0021). These attempts are not in any aggregate above; no prompt, message or candidate text of the holdout appears here.

| attempt | side | outcome | reason | calls | repairs | tokens | cost | first attempt: parse/check/start/tests | final verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| holdout-01--unconstrained--00 | mtek | failure | max-repairs | 4 | 3 | 33,470 | $0.0284 | fail/fail/not-run/not-run | fail |
| holdout-01--baseline-unconstrained--00 | baseline | success |  | 1 | 0 | 4,531 | $0.0069 | pass/pass/pass/pass | pass |
| holdout-02--unconstrained--00 | mtek | failure | max-repairs | 4 | 3 | 42,398 | $0.0397 | fail/fail/not-run/not-run | fail |
| holdout-02--baseline-unconstrained--00 | baseline | success |  | 1 | 0 | 4,752 | $0.0077 | pass/pass/pass/pass | pass |
| holdout-03--unconstrained--00 | mtek | success |  | 3 | 2 | 21,254 | $0.0224 | pass/fail/not-run/not-run | pass |
| holdout-03--baseline-unconstrained--00 | baseline | success |  | 1 | 0 | 5,007 | $0.0087 | pass/pass/pass/pass | pass |
| holdout-04--unconstrained--00 | mtek | failure | max-repairs | 4 | 3 | 36,948 | $0.0276 | pass/fail/not-run/not-run | fail |
| holdout-04--baseline-unconstrained--00 | baseline | success |  | 2 | 1 | 11,114 | $0.0175 | pass/fail/not-run/not-run | pass |
| holdout-05--unconstrained--00 | mtek | success |  | 2 | 1 | 14,375 | $0.0174 | fail/fail/not-run/not-run | pass |
| holdout-05--baseline-unconstrained--00 | baseline | success |  | 1 | 0 | 5,140 | $0.0093 | pass/pass/pass/pass | pass |
| holdout-06--unconstrained--00 | mtek | failure | max-repairs | 4 | 3 | 29,015 | $0.0256 | pass/pass/pass/fail | fail |
| holdout-06--baseline-unconstrained--00 | baseline | success |  | 1 | 0 | 4,844 | $0.0079 | pass/pass/pass/pass | pass |
| holdout-07--unconstrained--00 | mtek | success |  | 1 | 0 | 6,118 | $0.0099 | pass/pass/pass/pass | pass |
| holdout-07--baseline-unconstrained--00 | baseline | success |  | 1 | 0 | 5,350 | $0.0107 | pass/pass/pass/pass | pass |
| holdout-08--unconstrained--00 | mtek | success |  | 1 | 0 | 5,472 | $0.0082 | pass/pass/pass/pass | pass |
| holdout-08--baseline-unconstrained--00 | baseline | success |  | 1 | 0 | 4,442 | $0.0068 | pass/pass/pass/pass | pass |
| holdout-01--unconstrained--01 | mtek | success |  | 4 | 3 | 41,290 | $0.0386 | fail/fail/not-run/not-run | pass |
| holdout-01--baseline-unconstrained--01 | baseline | success |  | 1 | 0 | 4,587 | $0.0072 | pass/pass/pass/pass | pass |
| holdout-02--unconstrained--01 | mtek | success |  | 2 | 1 | 11,086 | $0.0175 | fail/fail/not-run/not-run | pass |
| holdout-02--baseline-unconstrained--01 | baseline | failure | max-repairs | 4 | 3 | 30,541 | $0.0374 | pass/pass/pass/fail | fail |
| holdout-03--unconstrained--01 | mtek | failure | max-repairs | 4 | 3 | 47,605 | $0.0480 | fail/fail/not-run/not-run | fail |
| holdout-03--baseline-unconstrained--01 | baseline | success |  | 1 | 0 | 5,147 | $0.0094 | pass/pass/pass/pass | pass |
| holdout-04--unconstrained--01 | mtek | success |  | 3 | 2 | 28,515 | $0.0184 | pass/fail/not-run/not-run | pass |
| holdout-04--baseline-unconstrained--01 | baseline | success |  | 3 | 2 | 18,457 | $0.0234 | none/none/none/none | pass |
| holdout-05--unconstrained--01 | mtek | success |  | 3 | 2 | 33,258 | $0.0367 | fail/fail/not-run/not-run | pass |
| holdout-05--baseline-unconstrained--01 | baseline | success |  | 3 | 2 | 19,803 | $0.0274 | none/none/none/none | pass |
| holdout-06--unconstrained--01 | mtek | failure | max-repairs | 4 | 3 | 28,168 | $0.0153 | pass/pass/pass/fail | fail |
| holdout-06--baseline-unconstrained--01 | baseline | success |  | 1 | 0 | 4,877 | $0.0081 | pass/pass/pass/pass | pass |
| holdout-07--unconstrained--01 | mtek | success |  | 2 | 1 | 13,418 | $0.0077 | pass/pass/pass/fail | pass |
| holdout-07--baseline-unconstrained--01 | baseline | success |  | 2 | 1 | 10,426 | $0.0072 | none/none/none/none | pass |
| holdout-08--unconstrained--01 | mtek | success |  | 1 | 0 | 5,440 | $0.0021 | pass/pass/pass/pass | pass |
| holdout-08--baseline-unconstrained--01 | baseline | success |  | 2 | 1 | 9,558 | $0.0045 | none/none/none/none | pass |
| holdout-01--unconstrained--02 | mtek | success |  | 2 | 1 | 11,732 | $0.0182 | fail/fail/not-run/not-run | pass |
| holdout-01--baseline-unconstrained--02 | baseline | success |  | 1 | 0 | 4,558 | $0.0071 | pass/pass/pass/pass | pass |
| holdout-02--unconstrained--02 | mtek | failure | max-repairs | 4 | 3 | 27,524 | $0.0311 | none/none/none/none | fail |
| holdout-02--baseline-unconstrained--02 | baseline | success |  | 1 | 0 | 4,838 | $0.0081 | pass/pass/pass/pass | pass |
| holdout-03--unconstrained--02 | mtek | failure | max-repairs | 4 | 3 | 46,952 | $0.0475 | fail/fail/not-run/not-run | fail |
| holdout-03--baseline-unconstrained--02 | baseline | success |  | 1 | 0 | 5,118 | $0.0092 | pass/pass/pass/pass | pass |
| holdout-04--unconstrained--02 | mtek | success |  | 3 | 2 | 27,194 | $0.0159 | pass/fail/not-run/not-run | pass |
| holdout-04--baseline-unconstrained--02 | baseline | success |  | 2 | 1 | 11,165 | $0.0176 | pass/fail/not-run/not-run | pass |
| holdout-05--unconstrained--02 | mtek | success |  | 3 | 2 | 24,597 | $0.0181 | pass/fail/not-run/not-run | pass |
| holdout-05--baseline-unconstrained--02 | baseline | success |  | 1 | 0 | 5,228 | $0.0097 | pass/pass/pass/pass | pass |
| holdout-06--unconstrained--02 | mtek | failure | max-repairs | 4 | 3 | 29,502 | $0.0188 | pass/pass/pass/fail | fail |
| holdout-06--baseline-unconstrained--02 | baseline | success |  | 1 | 0 | 4,994 | $0.0087 | pass/pass/pass/pass | pass |
| holdout-07--unconstrained--02 | mtek | success |  | 2 | 1 | 13,092 | $0.0068 | pass/pass/pass/fail | pass |
| holdout-07--baseline-unconstrained--02 | baseline | success |  | 1 | 0 | 4,953 | $0.0038 | pass/pass/pass/pass | pass |
| holdout-08--unconstrained--02 | mtek | success |  | 1 | 0 | 5,453 | $0.0022 | pass/pass/pass/pass | pass |
| holdout-08--baseline-unconstrained--02 | baseline | success |  | 2 | 1 | 9,570 | $0.0045 | none/none/none/none | pass |
| holdout-01--unconstrained--03 | mtek | failure | max-repairs | 4 | 3 | 39,169 | $0.0371 | fail/fail/not-run/not-run | fail |
| holdout-01--baseline-unconstrained--03 | baseline | success |  | 1 | 0 | 4,628 | $0.0074 | pass/pass/pass/pass | pass |
| holdout-02--unconstrained--03 | mtek | failure | max-repairs | 4 | 3 | 34,581 | $0.0315 | fail/fail/not-run/not-run | fail |
| holdout-02--baseline-unconstrained--03 | baseline | success |  | 1 | 0 | 4,732 | $0.0076 | pass/pass/pass/pass | pass |
| holdout-03--unconstrained--03 | mtek | failure | max-repairs | 4 | 3 | 47,298 | $0.0491 | fail/fail/not-run/not-run | fail |
| holdout-03--baseline-unconstrained--03 | baseline | success |  | 1 | 0 | 5,081 | $0.0090 | pass/pass/pass/pass | pass |
| holdout-04--unconstrained--03 | mtek | success |  | 4 | 3 | 40,050 | $0.0231 | fail/fail/not-run/not-run | pass |
| holdout-04--baseline-unconstrained--03 | baseline | success |  | 2 | 1 | 11,703 | $0.0196 | pass/fail/not-run/not-run | pass |
| holdout-05--unconstrained--03 | mtek | success |  | 3 | 2 | 22,598 | $0.0144 | pass/fail/not-run/not-run | pass |
| holdout-05--baseline-unconstrained--03 | baseline | success |  | 1 | 0 | 5,165 | $0.0094 | pass/pass/pass/pass | pass |
| holdout-06--unconstrained--03 | mtek | failure | max-repairs | 4 | 3 | 31,229 | $0.0159 | pass/pass/pass/fail | fail |
| holdout-06--baseline-unconstrained--03 | baseline | success |  | 1 | 0 | 4,898 | $0.0082 | pass/pass/pass/pass | pass |
| holdout-07--unconstrained--03 | mtek | success |  | 2 | 1 | 13,393 | $0.0079 | pass/pass/pass/fail | pass |
| holdout-07--baseline-unconstrained--03 | baseline | success |  | 1 | 0 | 5,295 | $0.0056 | pass/pass/pass/pass | pass |
| holdout-08--unconstrained--03 | mtek | success |  | 1 | 0 | 5,492 | $0.0024 | pass/pass/pass/pass | pass |
| holdout-08--baseline-unconstrained--03 | baseline | success |  | 1 | 0 | 4,413 | $0.0019 | pass/pass/pass/pass | pass |
| holdout-01--unconstrained--04 | mtek | failure | max-repairs | 4 | 3 | 35,689 | $0.0303 | fail/fail/not-run/not-run | fail |
| holdout-01--baseline-unconstrained--04 | baseline | success |  | 1 | 0 | 4,598 | $0.0073 | pass/pass/pass/pass | pass |
| holdout-02--unconstrained--04 | mtek | success |  | 2 | 1 | 10,327 | $0.0156 | fail/fail/not-run/not-run | pass |
| holdout-02--baseline-unconstrained--04 | baseline | success |  | 2 | 1 | 11,001 | $0.0181 | pass/pass/pass/fail | pass |
| holdout-03--unconstrained--04 | mtek | success |  | 3 | 2 | 25,782 | $0.0311 | fail/fail/not-run/not-run | pass |
| holdout-03--baseline-unconstrained--04 | baseline | success |  | 1 | 0 | 4,875 | $0.0080 | pass/pass/pass/pass | pass |
| holdout-04--unconstrained--04 | mtek | success |  | 3 | 2 | 24,957 | $0.0148 | pass/fail/not-run/not-run | pass |
| holdout-04--baseline-unconstrained--04 | baseline | success |  | 2 | 1 | 11,458 | $0.0186 | pass/fail/not-run/not-run | pass |
| holdout-05--unconstrained--04 | mtek | success |  | 2 | 1 | 15,798 | $0.0178 | pass/fail/not-run/not-run | pass |
| holdout-05--baseline-unconstrained--04 | baseline | success |  | 1 | 0 | 5,352 | $0.0104 | pass/pass/pass/pass | pass |
| holdout-06--unconstrained--04 | mtek | failure | max-repairs | 4 | 3 | 29,302 | $0.0177 | pass/pass/pass/fail | fail |
| holdout-06--baseline-unconstrained--04 | baseline | success |  | 1 | 0 | 4,867 | $0.0080 | pass/pass/pass/pass | pass |
| holdout-07--unconstrained--04 | mtek | success |  | 1 | 0 | 6,091 | $0.0034 | pass/pass/pass/pass | pass |
| holdout-07--baseline-unconstrained--04 | baseline | success |  | 1 | 0 | 5,165 | $0.0049 | pass/pass/pass/pass | pass |
| holdout-08--unconstrained--04 | mtek | success |  | 1 | 0 | 5,499 | $0.0024 | pass/pass/pass/pass | pass |
| holdout-08--baseline-unconstrained--04 | baseline | success |  | 2 | 1 | 9,496 | $0.0043 | none/none/none/none | pass |

Holdout: 80 attempts, 64 completed, 16 failed, 0 not judged; 1,272,858 tokens, $1.2536.

## All attempts

| attempt | task | category | mode | side | kind | outcome | reason | calls | repairs | input | cache read | cache write | output | cost | seconds | first attempt parse/check/build/start/tests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| interaction-01--unconstrained--00 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 21,433 | 12,368 | 9,056 | 1,070 | $0.0179 | 14.7 | fail/fail/not-run/not-run/not-run |
| interaction-01--baseline-unconstrained--00 | interaction-01 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 3,980 | 0 | 0 | 779 | $0.0079 | 9.9 | pass/pass/pass/pass/pass |
| interaction-02--unconstrained--00 | interaction-02 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 23,086 | 12,637 | 10,440 | 2,394 | $0.0263 | 24.7 | fail/fail/not-run/not-run/not-run |
| interaction-02--baseline-unconstrained--00 | interaction-02 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,076 | 0 | 0 | 888 | $0.0085 | 11.5 | pass/pass/pass/pass/pass |
| interaction-03--unconstrained--00 | interaction-03 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 42,835 | 25,849 | 16,974 | 3,551 | $0.0416 | 25.0 | fail/fail/not-run/not-run/not-run |
| interaction-03--baseline-unconstrained--00 | interaction-03 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,111 | 0 | 4,108 | 976 | $0.0100 | 14.4 | pass/pass/pass/pass/pass |
| interaction-04--unconstrained--00 | interaction-04 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 12,173 | 4,821 | 7,346 | 1,813 | $0.0187 | 16.5 | pass/fail/not-run/not-run/not-run |
| interaction-04--baseline-unconstrained--00 | interaction-04 | interaction | edit | baseline | unconstrained | success |  | 2 | 1 | 9,812 | 0 | 5,779 | 898 | $0.0157 | 15.4 | pass/fail/not-run/not-run/not-run |
| interaction-05--unconstrained--00 | interaction-05 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 33,924 | 22,784 | 11,128 | 2,138 | $0.0269 | 24.1 | fail/fail/not-run/not-run/not-run |
| interaction-05--baseline-unconstrained--00 | interaction-05 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,124 | 0 | 4,121 | 841 | $0.0094 | 11.5 | pass/pass/pass/pass/pass |
| interaction-06--unconstrained--00 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 4,981 | 0 | 4,978 | 452 | $0.0085 | 8.1 | pass/pass/pass/pass/pass |
| interaction-06--baseline-unconstrained--00 | interaction-06 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,098 | 0 | 0 | 1,092 | $0.0096 | 14.2 | pass/pass/pass/pass/pass |
| interaction-07--unconstrained--00 | interaction-07 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 45,430 | 28,865 | 16,553 | 5,264 | $0.0499 | 28.4 | fail/fail/not-run/not-run/not-run |
| interaction-07--baseline-unconstrained--00 | interaction-07 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,220 | 0 | 4,217 | 1,413 | $0.0123 | 21.4 | pass/pass/pass/pass/pass |
| interaction-08--unconstrained--00 | interaction-08 | interaction | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 40,675 | 20,566 | 16,861 | 2,860 | $0.0407 | 26.8 | fail/fail/not-run/not-run/not-run |
| interaction-08--baseline-unconstrained--00 | interaction-08 | interaction | cold | baseline | unconstrained | success |  | 1 | 0 | 4,048 | 0 | 0 | 1,326 | $0.0107 | 15.9 | pass/pass/pass/pass/pass |
| interaction-09--unconstrained--00 | interaction-09 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 25,733 | 14,396 | 11,328 | 2,237 | $0.0268 | 18.6 | fail/fail/not-run/not-run/not-run |
| interaction-09--baseline-unconstrained--00 | interaction-09 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,328 | 0 | 4,325 | 1,269 | $0.0118 | 14.0 | pass/pass/pass/pass/pass |
| interaction-10--unconstrained--00 | interaction-10 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 15,929 | 5,074 | 10,849 | 1,654 | $0.0223 | 18.7 | fail/fail/not-run/not-run/not-run |
| interaction-10--baseline-unconstrained--00 | interaction-10 | interaction | edit | baseline | unconstrained | failure | max-repairs | 4 | 3 | 22,802 | 15,732 | 7,058 | 3,320 | $0.0270 | 25.0 | none/none/none/none/none |
| interaction-11--unconstrained--00 | interaction-11 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 30,041 | 20,155 | 9,874 | 3,084 | $0.0298 | 32.9 | pass/pass/pass/pass/fail |
| interaction-11--baseline-unconstrained--00 | interaction-11 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,248 | 0 | 4,245 | 735 | $0.0090 | 10.5 | pass/pass/pass/pass/pass |
| maintenance-01--unconstrained--00 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 4,825 | 0 | 4,822 | 275 | $0.0074 | 5.0 | pass/pass/pass/pass/pass |
| maintenance-01--baseline-unconstrained--00 | maintenance-01 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,008 | 0 | 0 | 336 | $0.0057 | 5.7 | pass/pass/pass/pass/pass |
| maintenance-02--unconstrained--00 | maintenance-02 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,534 | 0 | 5,531 | 416 | $0.0090 | 6.8 | pass/pass/pass/pass/pass |
| maintenance-02--baseline-unconstrained--00 | maintenance-02 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 512 | $0.0079 | 6.6 | pass/pass/pass/pass/pass |
| maintenance-03--unconstrained--00 | maintenance-03 | maintenance | edit | mtek | unconstrained | success |  | 3 | 2 | 18,914 | 11,409 | 7,496 | 1,113 | $0.0161 | 16.9 | none/none/none/none/none |
| maintenance-03--baseline-unconstrained--00 | maintenance-03 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,104 | 0 | 4,101 | 351 | $0.0069 | 7.0 | pass/pass/pass/pass/pass |
| maintenance-04--unconstrained--00 | maintenance-04 | maintenance | edit | mtek | unconstrained | success |  | 2 | 1 | 11,790 | 5,217 | 6,567 | 1,064 | $0.0141 | 16.8 | pass/pass/pass/pass/fail |
| maintenance-04--baseline-unconstrained--00 | maintenance-04 | maintenance | edit | baseline | unconstrained | success |  | 2 | 1 | 9,839 | 4,200 | 5,633 | 1,098 | $0.0130 | 15.5 | pass/pass/pass/pass/fail |
| maintenance-05--unconstrained--00 | maintenance-05 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,247 | 0 | 5,244 | 581 | $0.0095 | 7.7 | pass/pass/pass/pass/pass |
| maintenance-05--baseline-unconstrained--00 | maintenance-05 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,325 | 0 | 4,322 | 841 | $0.0096 | 9.4 | pass/pass/pass/pass/pass |
| maintenance-06--unconstrained--00 | maintenance-06 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,804 | 0 | 5,801 | 543 | $0.0100 | 7.9 | pass/pass/pass/pass/pass |
| maintenance-06--baseline-unconstrained--00 | maintenance-06 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 946 | $0.0100 | 12.3 | pass/pass/pass/pass/pass |
| scene-rendering-01--unconstrained--00 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 3 | 2 | 15,239 | 5,001 | 7,160 | 927 | $0.0172 | 12.4 | pass/fail/not-run/not-run/not-run |
| scene-rendering-01--baseline-unconstrained--00 | scene-rendering-01 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,879 | 0 | 0 | 313 | $0.0054 | 5.1 | pass/pass/pass/pass/pass |
| scene-rendering-02--unconstrained--00 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | success |  | 3 | 2 | 15,990 | 5,677 | 7,126 | 1,058 | $0.0180 | 13.5 | pass/fail/not-run/not-run/not-run |
| scene-rendering-02--baseline-unconstrained--00 | scene-rendering-02 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,988 | 0 | 0 | 508 | $0.0065 | 7.7 | pass/pass/pass/pass/pass |
| scene-rendering-03--unconstrained--00 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | success |  | 4 | 3 | 35,900 | 19,162 | 13,308 | 2,853 | $0.0362 | 24.2 | fail/fail/not-run/not-run/not-run |
| scene-rendering-03--baseline-unconstrained--00 | scene-rendering-03 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,200 | 0 | 4,197 | 1,117 | $0.0108 | 10.0 | pass/pass/pass/pass/pass |
| scene-rendering-04--unconstrained--00 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | success |  | 2 | 1 | 9,994 | 0 | 6,725 | 1,208 | $0.0177 | 14.1 | pass/fail/not-run/not-run/not-run |
| scene-rendering-04--baseline-unconstrained--00 | scene-rendering-04 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,069 | 0 | 0 | 868 | $0.0084 | 10.5 | pass/pass/pass/pass/pass |
| scene-rendering-05--unconstrained--00 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | success |  | 2 | 1 | 11,552 | 5,167 | 6,379 | 716 | $0.0121 | 7.9 | pass/fail/not-run/not-run/not-run |
| scene-rendering-05--baseline-unconstrained--00 | scene-rendering-05 | scene-rendering | edit | baseline | unconstrained | success |  | 1 | 0 | 4,167 | 0 | 4,164 | 884 | $0.0096 | 10.2 | pass/pass/pass/pass/pass |
| scene-rendering-06--unconstrained--00 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 38,588 | 20,006 | 15,208 | 3,563 | $0.0422 | 31.7 | fail/fail/not-run/not-run/not-run |
| scene-rendering-06--baseline-unconstrained--00 | scene-rendering-06 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 31,265 | 20,323 | 10,930 | 4,346 | $0.0374 | 48.5 | pass/pass/pass/pass/fail |
| scene-rendering-07--unconstrained--00 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 31,447 | 17,805 | 10,246 | 2,200 | $0.0290 | 27.1 | fail/fail/not-run/not-run/not-run |
| scene-rendering-07--baseline-unconstrained--00 | scene-rendering-07 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 27,624 | 18,372 | 9,240 | 2,108 | $0.0239 | 32.0 | pass/pass/pass/pass/fail |
| scene-rendering-08--unconstrained--00 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 4,994 | 0 | 4,991 | 337 | $0.0079 | 5.0 | pass/pass/pass/pass/pass |
| scene-rendering-08--baseline-unconstrained--00 | scene-rendering-08 | scene-rendering | edit | baseline | unconstrained | success |  | 1 | 0 | 4,203 | 0 | 4,200 | 382 | $0.0072 | 5.9 | pass/pass/pass/pass/pass |
| scene-rendering-09--unconstrained--00 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | success |  | 3 | 2 | 21,367 | 8,234 | 9,764 | 2,919 | $0.0310 | 31.4 | fail/fail/not-run/not-run/not-run |
| scene-rendering-09--baseline-unconstrained--00 | scene-rendering-09 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,162 | 0 | 4,159 | 1,143 | $0.0109 | 9.9 | pass/pass/pass/pass/pass |
| scene-rendering-10--unconstrained--00 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 40,841 | 20,563 | 16,766 | 3,191 | $0.0425 | 31.7 | fail/fail/not-run/not-run/not-run |
| scene-rendering-10--baseline-unconstrained--00 | scene-rendering-10 | scene-rendering | cold | baseline | unconstrained | success |  | 2 | 1 | 11,097 | 4,303 | 6,788 | 1,678 | $0.0173 | 21.8 | pass/pass/pass/pass/fail |
| scene-rendering-11--unconstrained--00 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 48,710 | 24,802 | 20,368 | 6,021 | $0.0616 | 54.7 | fail/fail/not-run/not-run/not-run |
| scene-rendering-11--baseline-unconstrained--00 | scene-rendering-11 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 32,761 | 20,935 | 11,814 | 3,642 | $0.0351 | 32.7 | pass/pass/pass/pass/fail |
| shader-bridge-01--unconstrained--00 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 24,422 | 17,096 | 7,314 | 2,025 | $0.0210 | 21.4 | pass/pass/pass/pass/fail |
| shader-bridge-01--baseline-unconstrained--00 | shader-bridge-01 | shader-bridge | edit | baseline | unconstrained | success |  | 2 | 1 | 8,559 | 0 | 4,611 | 1,147 | $0.0154 | 14.0 | none/none/none/none/none |
| shader-bridge-02--unconstrained--00 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 26,855 | 18,720 | 8,123 | 1,098 | $0.0175 | 20.0 | pass/pass/pass/pass/fail |
| shader-bridge-02--baseline-unconstrained--00 | shader-bridge-02 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,165 | 0 | 4,162 | 919 | $0.0098 | 11.0 | pass/pass/pass/pass/pass |
| shader-bridge-03--unconstrained--00 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 31,845 | 15,220 | 13,349 | 2,418 | $0.0336 | 24.2 | fail/fail/not-run/not-run/not-run |
| shader-bridge-03--baseline-unconstrained--00 | shader-bridge-03 | shader-bridge | cold | baseline | unconstrained | success |  | 2 | 1 | 9,891 | 0 | 5,812 | 1,081 | $0.0167 | 13.4 | pass/fail/not-run/not-run/not-run |
| shader-bridge-04--unconstrained--00 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | success |  | 3 | 2 | 23,266 | 13,422 | 9,835 | 1,403 | $0.0207 | 16.4 | pass/fail/not-run/not-run/not-run |
| shader-bridge-04--baseline-unconstrained--00 | shader-bridge-04 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,053 | 0 | 0 | 635 | $0.0072 | 8.7 | pass/pass/pass/pass/pass |
| shader-bridge-05--unconstrained--00 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 5,315 | 0 | 5,312 | 308 | $0.0082 | 7.4 | pass/pass/pass/pass/pass |
| shader-bridge-05--baseline-unconstrained--00 | shader-bridge-05 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,186 | 0 | 4,183 | 388 | $0.0072 | 7.9 | pass/pass/pass/pass/pass |
| shader-bridge-06--unconstrained--00 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 5,197 | 0 | 5,194 | 643 | $0.0097 | 10.0 | pass/pass/pass/pass/pass |
| shader-bridge-06--baseline-unconstrained--00 | shader-bridge-06 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,231 | 0 | 4,228 | 299 | $0.0068 | 7.2 | pass/pass/pass/pass/pass |
| interaction-01--unconstrained--01 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 20,690 | 12,377 | 8,304 | 948 | $0.0164 | 13.0 | fail/fail/not-run/not-run/not-run |
| interaction-01--baseline-unconstrained--01 | interaction-01 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 3,980 | 0 | 0 | 584 | $0.0069 | 8.3 | pass/pass/pass/pass/pass |
| interaction-02--unconstrained--01 | interaction-02 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 36,499 | 23,839 | 12,648 | 2,874 | $0.0326 | 25.9 | fail/fail/not-run/not-run/not-run |
| interaction-02--baseline-unconstrained--01 | interaction-02 | interaction | edit | baseline | unconstrained | success |  | 2 | 1 | 9,852 | 0 | 5,773 | 1,066 | $0.0166 | 14.2 | fail/fail/not-run/not-run/not-run |
| interaction-03--unconstrained--01 | interaction-03 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 25,866 | 14,493 | 11,364 | 1,729 | $0.0243 | 14.9 | fail/fail/not-run/not-run/not-run |
| interaction-03--baseline-unconstrained--01 | interaction-03 | interaction | edit | baseline | unconstrained | success |  | 3 | 2 | 17,431 | 10,204 | 7,218 | 1,572 | $0.0179 | 19.6 | pass/fail/not-run/not-run/not-run |
| interaction-04--unconstrained--01 | interaction-04 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 30,402 | 20,368 | 10,022 | 2,068 | $0.0249 | 19.7 | fail/fail/not-run/not-run/not-run |
| interaction-04--baseline-unconstrained--01 | interaction-04 | interaction | edit | baseline | unconstrained | success |  | 2 | 1 | 9,810 | 0 | 5,777 | 1,626 | $0.0194 | 20.1 | pass/fail/not-run/not-run/not-run |
| interaction-05--unconstrained--01 | interaction-05 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 28,024 | 19,459 | 8,553 | 1,414 | $0.0197 | 17.5 | pass/fail/not-run/not-run/not-run |
| interaction-05--baseline-unconstrained--01 | interaction-05 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,124 | 0 | 4,121 | 859 | $0.0094 | 13.8 | pass/pass/pass/pass/pass |
| interaction-06--unconstrained--01 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 4,981 | 0 | 4,978 | 636 | $0.0094 | 9.4 | pass/pass/pass/pass/pass |
| interaction-06--baseline-unconstrained--01 | interaction-06 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,098 | 0 | 0 | 983 | $0.0090 | 13.1 | pass/pass/pass/pass/pass |
| interaction-07--unconstrained--01 | interaction-07 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 41,880 | 24,630 | 17,238 | 6,011 | $0.0541 | 30.9 | none/none/none/none/none |
| interaction-07--baseline-unconstrained--01 | interaction-07 | interaction | edit | baseline | unconstrained | success |  | 2 | 1 | 10,313 | 4,217 | 6,090 | 1,163 | $0.0139 | 20.3 | pass/fail/not-run/not-run/not-run |
| interaction-08--unconstrained--01 | interaction-08 | interaction | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 35,740 | 18,060 | 14,432 | 2,834 | $0.0373 | 28.7 | fail/fail/not-run/not-run/not-run |
| interaction-08--baseline-unconstrained--01 | interaction-08 | interaction | cold | baseline | unconstrained | success |  | 1 | 0 | 4,048 | 0 | 0 | 633 | $0.0072 | 11.0 | pass/pass/pass/pass/pass |
| interaction-09--unconstrained--01 | interaction-09 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 33,442 | 21,511 | 11,919 | 3,016 | $0.0321 | 22.3 | none/none/none/none/none |
| interaction-09--baseline-unconstrained--01 | interaction-09 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,328 | 0 | 4,325 | 1,340 | $0.0121 | 18.3 | pass/pass/pass/pass/pass |
| interaction-10--unconstrained--01 | interaction-10 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 12,543 | 5,074 | 7,463 | 1,236 | $0.0160 | 16.0 | pass/fail/not-run/not-run/not-run |
| interaction-10--baseline-unconstrained--01 | interaction-10 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,190 | 0 | 4,187 | 1,164 | $0.0111 | 17.5 | pass/pass/pass/pass/pass |
| interaction-11--unconstrained--01 | interaction-11 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 23,246 | 13,578 | 9,659 | 1,809 | $0.0225 | 21.1 | fail/fail/not-run/not-run/not-run |
| interaction-11--baseline-unconstrained--01 | interaction-11 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,248 | 0 | 4,245 | 792 | $0.0093 | 12.5 | pass/pass/pass/pass/pass |
| maintenance-01--unconstrained--01 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 4,825 | 0 | 4,822 | 298 | $0.0075 | 5.4 | pass/pass/pass/pass/pass |
| maintenance-01--baseline-unconstrained--01 | maintenance-01 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,008 | 0 | 0 | 300 | $0.0055 | 5.5 | pass/pass/pass/pass/pass |
| maintenance-02--unconstrained--01 | maintenance-02 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,534 | 0 | 5,531 | 550 | $0.0097 | 7.7 | pass/pass/pass/pass/pass |
| maintenance-02--baseline-unconstrained--01 | maintenance-02 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 292 | $0.0068 | 6.2 | pass/pass/pass/pass/pass |
| maintenance-03--unconstrained--01 | maintenance-03 | maintenance | edit | mtek | unconstrained | success |  | 2 | 1 | 11,206 | 5,096 | 6,104 | 417 | $0.0102 | 7.3 | pass/fail/not-run/not-run/not-run |
| maintenance-03--baseline-unconstrained--01 | maintenance-03 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,104 | 0 | 4,101 | 378 | $0.0070 | 7.1 | pass/pass/pass/pass/pass |
| maintenance-04--unconstrained--01 | maintenance-04 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,220 | 0 | 5,217 | 560 | $0.0093 | 8.5 | pass/pass/pass/pass/pass |
| maintenance-04--baseline-unconstrained--01 | maintenance-04 | maintenance | edit | baseline | unconstrained | success |  | 2 | 1 | 9,781 | 4,200 | 5,575 | 1,050 | $0.0126 | 16.2 | pass/pass/pass/pass/fail |
| maintenance-05--unconstrained--01 | maintenance-05 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,247 | 0 | 5,244 | 553 | $0.0093 | 7.6 | pass/pass/pass/pass/pass |
| maintenance-05--baseline-unconstrained--01 | maintenance-05 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,325 | 0 | 4,322 | 644 | $0.0086 | 7.0 | pass/pass/pass/pass/pass |
| maintenance-06--unconstrained--01 | maintenance-06 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,804 | 0 | 5,801 | 426 | $0.0094 | 6.8 | pass/pass/pass/pass/pass |
| maintenance-06--baseline-unconstrained--01 | maintenance-06 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 910 | $0.0099 | 11.9 | pass/pass/pass/pass/pass |
| scene-rendering-01--unconstrained--01 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 30,988 | 16,236 | 11,671 | 1,680 | $0.0277 | 14.2 | fail/fail/not-run/not-run/not-run |
| scene-rendering-01--baseline-unconstrained--01 | scene-rendering-01 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,879 | 0 | 0 | 397 | $0.0059 | 6.0 | pass/pass/pass/pass/pass |
| scene-rendering-02--unconstrained--01 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 33,256 | 17,958 | 12,108 | 2,120 | $0.0307 | 21.8 | fail/fail/not-run/not-run/not-run |
| scene-rendering-02--baseline-unconstrained--01 | scene-rendering-02 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,988 | 0 | 0 | 704 | $0.0075 | 9.9 | pass/pass/pass/pass/pass |
| scene-rendering-03--unconstrained--01 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | success |  | 2 | 1 | 10,356 | 0 | 6,932 | 1,430 | $0.0192 | 13.0 | pass/fail/not-run/not-run/not-run |
| scene-rendering-03--baseline-unconstrained--01 | scene-rendering-03 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,200 | 0 | 4,197 | 866 | $0.0096 | 8.6 | pass/pass/pass/pass/pass |
| scene-rendering-04--unconstrained--01 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 34,892 | 17,796 | 13,821 | 2,305 | $0.0339 | 22.7 | fail/fail/not-run/not-run/not-run |
| scene-rendering-04--baseline-unconstrained--01 | scene-rendering-04 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,069 | 0 | 0 | 897 | $0.0086 | 10.5 | pass/pass/pass/pass/pass |
| scene-rendering-05--unconstrained--01 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | success |  | 4 | 3 | 26,507 | 18,292 | 8,203 | 1,438 | $0.0193 | 13.4 | none/none/none/none/none |
| scene-rendering-05--baseline-unconstrained--01 | scene-rendering-05 | scene-rendering | edit | baseline | unconstrained | success |  | 1 | 0 | 4,167 | 0 | 4,164 | 780 | $0.0091 | 9.0 | pass/pass/pass/pass/pass |
| scene-rendering-06--unconstrained--01 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 29,805 | 16,497 | 9,934 | 2,186 | $0.0284 | 25.2 | fail/fail/not-run/not-run/not-run |
| scene-rendering-06--baseline-unconstrained--01 | scene-rendering-06 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,170 | 0 | 4,167 | 2,097 | $0.0157 | 21.0 | pass/pass/pass/pass/pass |
| scene-rendering-07--unconstrained--01 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 41,768 | 21,895 | 16,477 | 3,397 | $0.0432 | 32.1 | fail/fail/not-run/not-run/not-run |
| scene-rendering-07--baseline-unconstrained--01 | scene-rendering-07 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 28,032 | 18,517 | 9,503 | 3,303 | $0.0303 | 43.4 | pass/pass/pass/pass/fail |
| scene-rendering-08--unconstrained--01 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 4,994 | 0 | 4,991 | 322 | $0.0079 | 4.6 | pass/pass/pass/pass/pass |
| scene-rendering-08--baseline-unconstrained--01 | scene-rendering-08 | scene-rendering | edit | baseline | unconstrained | success |  | 2 | 1 | 9,273 | 4,200 | 5,067 | 832 | $0.0109 | 9.7 | none/none/none/none/none |
| scene-rendering-09--unconstrained--01 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 43,366 | 21,999 | 17,995 | 4,081 | $0.0485 | 36.6 | fail/fail/not-run/not-run/not-run |
| scene-rendering-09--baseline-unconstrained--01 | scene-rendering-09 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,162 | 0 | 4,159 | 1,140 | $0.0109 | 9.8 | pass/pass/pass/pass/pass |
| scene-rendering-10--unconstrained--01 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 41,592 | 21,565 | 16,515 | 3,254 | $0.0426 | 31.2 | fail/fail/not-run/not-run/not-run |
| scene-rendering-10--baseline-unconstrained--01 | scene-rendering-10 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 27,943 | 18,399 | 9,532 | 2,960 | $0.0286 | 31.2 | none/none/none/none/none |
| scene-rendering-11--unconstrained--01 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 49,282 | 25,140 | 20,602 | 6,130 | $0.0625 | 54.0 | fail/fail/not-run/not-run/not-run |
| scene-rendering-11--baseline-unconstrained--01 | scene-rendering-11 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 30,776 | 19,200 | 11,564 | 5,551 | $0.0441 | 40.5 | none/none/none/none/none |
| shader-bridge-01--unconstrained--01 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 25,144 | 17,377 | 7,755 | 1,757 | $0.0202 | 19.6 | pass/pass/pass/pass/fail |
| shader-bridge-01--baseline-unconstrained--01 | shader-bridge-01 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 3,945 | 0 | 0 | 669 | $0.0073 | 9.3 | pass/pass/pass/pass/pass |
| shader-bridge-02--unconstrained--01 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 26,783 | 18,430 | 8,341 | 1,889 | $0.0217 | 20.2 | none/none/none/none/none |
| shader-bridge-02--baseline-unconstrained--01 | shader-bridge-02 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,165 | 0 | 4,162 | 917 | $0.0098 | 11.0 | pass/pass/pass/pass/pass |
| shader-bridge-03--unconstrained--01 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 38,324 | 19,194 | 15,854 | 3,295 | $0.0415 | 30.0 | fail/fail/not-run/not-run/not-run |
| shader-bridge-03--baseline-unconstrained--01 | shader-bridge-03 | shader-bridge | cold | baseline | unconstrained | success |  | 2 | 1 | 9,887 | 0 | 5,808 | 2,282 | $0.0227 | 18.6 | none/none/none/none/none |
| shader-bridge-04--unconstrained--01 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 42,321 | 25,518 | 16,791 | 3,339 | $0.0402 | 28.6 | fail/fail/not-run/not-run/not-run |
| shader-bridge-04--baseline-unconstrained--01 | shader-bridge-04 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,053 | 0 | 0 | 699 | $0.0075 | 9.6 | pass/pass/pass/pass/pass |
| shader-bridge-05--unconstrained--01 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 5,315 | 0 | 5,312 | 304 | $0.0082 | 7.2 | pass/pass/pass/pass/pass |
| shader-bridge-05--baseline-unconstrained--01 | shader-bridge-05 | shader-bridge | edit | baseline | unconstrained | success |  | 2 | 1 | 9,822 | 4,183 | 5,633 | 1,445 | $0.0147 | 12.0 | none/none/none/none/none |
| shader-bridge-06--unconstrained--01 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 5,197 | 0 | 5,194 | 719 | $0.0101 | 10.1 | pass/pass/pass/pass/pass |
| shader-bridge-06--baseline-unconstrained--01 | shader-bridge-06 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,231 | 0 | 4,228 | 336 | $0.0070 | 6.7 | pass/pass/pass/pass/pass |
| interaction-01--unconstrained--02 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 31,659 | 21,416 | 10,231 | 1,172 | $0.0208 | 19.5 | fail/fail/not-run/not-run/not-run |
| interaction-01--baseline-unconstrained--02 | interaction-01 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 3,980 | 0 | 0 | 664 | $0.0073 | 7.5 | pass/pass/pass/pass/pass |
| interaction-02--unconstrained--02 | interaction-02 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 21,715 | 12,497 | 9,209 | 1,577 | $0.0207 | 19.2 | pass/fail/not-run/not-run/not-run |
| interaction-02--baseline-unconstrained--02 | interaction-02 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,076 | 0 | 0 | 930 | $0.0087 | 11.8 | pass/pass/pass/pass/pass |
| interaction-03--unconstrained--02 | interaction-03 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 23,919 | 13,157 | 10,753 | 3,045 | $0.0300 | 20.7 | fail/fail/not-run/not-run/not-run |
| interaction-03--baseline-unconstrained--02 | interaction-03 | interaction | edit | baseline | unconstrained | success |  | 3 | 2 | 18,009 | 10,187 | 7,813 | 1,717 | $0.0194 | 19.7 | pass/fail/not-run/not-run/not-run |
| interaction-04--unconstrained--02 | interaction-04 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 30,024 | 20,353 | 9,659 | 2,141 | $0.0248 | 21.5 | fail/fail/not-run/not-run/not-run |
| interaction-04--baseline-unconstrained--02 | interaction-04 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,030 | 0 | 0 | 807 | $0.0081 | 13.2 | pass/pass/pass/pass/pass |
| interaction-05--unconstrained--02 | interaction-05 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 32,823 | 22,376 | 10,435 | 2,013 | $0.0254 | 18.3 | fail/fail/not-run/not-run/not-run |
| interaction-05--baseline-unconstrained--02 | interaction-05 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,124 | 0 | 4,121 | 850 | $0.0094 | 11.2 | pass/pass/pass/pass/pass |
| interaction-06--unconstrained--02 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 4,981 | 0 | 4,978 | 417 | $0.0083 | 7.9 | pass/pass/pass/pass/pass |
| interaction-06--baseline-unconstrained--02 | interaction-06 | interaction | edit | baseline | unconstrained | success |  | 2 | 1 | 10,136 | 0 | 6,035 | 2,227 | $0.0228 | 18.5 | none/none/none/none/none |
| interaction-07--unconstrained--02 | interaction-07 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 33,800 | 20,984 | 12,804 | 4,123 | $0.0387 | 23.1 | none/none/none/none/none |
| interaction-07--baseline-unconstrained--02 | interaction-07 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,220 | 0 | 4,217 | 1,037 | $0.0105 | 17.5 | pass/pass/pass/pass/pass |
| interaction-08--unconstrained--02 | interaction-08 | interaction | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 39,247 | 19,850 | 16,149 | 3,562 | $0.0432 | 32.3 | fail/fail/not-run/not-run/not-run |
| interaction-08--baseline-unconstrained--02 | interaction-08 | interaction | cold | baseline | unconstrained | success |  | 1 | 0 | 4,048 | 0 | 0 | 1,284 | $0.0105 | 15.4 | pass/pass/pass/pass/pass |
| interaction-09--unconstrained--02 | interaction-09 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 27,031 | 14,753 | 12,269 | 3,473 | $0.0342 | 24.4 | fail/fail/not-run/not-run/not-run |
| interaction-09--baseline-unconstrained--02 | interaction-09 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,328 | 0 | 4,325 | 1,164 | $0.0112 | 13.6 | pass/pass/pass/pass/pass |
| interaction-10--unconstrained--02 | interaction-10 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 15,049 | 5,074 | 9,969 | 2,365 | $0.0248 | 24.1 | pass/fail/not-run/not-run/not-run |
| interaction-10--baseline-unconstrained--02 | interaction-10 | interaction | edit | baseline | unconstrained | success |  | 2 | 1 | 9,450 | 4,187 | 5,257 | 1,721 | $0.0156 | 22.0 | none/none/none/none/none |
| interaction-11--unconstrained--02 | interaction-11 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 36,447 | 24,231 | 12,204 | 4,696 | $0.0412 | 36.3 | pass/fail/not-run/not-run/not-run |
| interaction-11--baseline-unconstrained--02 | interaction-11 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,248 | 0 | 4,245 | 758 | $0.0091 | 12.2 | pass/pass/pass/pass/pass |
| maintenance-01--unconstrained--02 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 4,825 | 0 | 4,822 | 292 | $0.0075 | 5.2 | pass/pass/pass/pass/pass |
| maintenance-01--baseline-unconstrained--02 | maintenance-01 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,008 | 0 | 0 | 356 | $0.0058 | 6.0 | pass/pass/pass/pass/pass |
| maintenance-02--unconstrained--02 | maintenance-02 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,534 | 0 | 5,531 | 431 | $0.0091 | 7.1 | pass/pass/pass/pass/pass |
| maintenance-02--baseline-unconstrained--02 | maintenance-02 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 454 | $0.0076 | 6.7 | pass/pass/pass/pass/pass |
| maintenance-03--unconstrained--02 | maintenance-03 | maintenance | edit | mtek | unconstrained | success |  | 2 | 1 | 12,037 | 5,096 | 6,935 | 489 | $0.0116 | 8.2 | fail/fail/not-run/not-run/not-run |
| maintenance-03--baseline-unconstrained--02 | maintenance-03 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,104 | 0 | 4,101 | 373 | $0.0070 | 7.4 | pass/pass/pass/pass/pass |
| maintenance-04--unconstrained--02 | maintenance-04 | maintenance | edit | mtek | unconstrained | success |  | 2 | 1 | 11,591 | 5,217 | 6,368 | 814 | $0.0126 | 14.5 | pass/pass/pass/pass/fail |
| maintenance-04--baseline-unconstrained--02 | maintenance-04 | maintenance | edit | baseline | unconstrained | success |  | 2 | 1 | 9,485 | 4,200 | 5,279 | 785 | $0.0109 | 10.2 | none/none/none/none/none |
| maintenance-05--unconstrained--02 | maintenance-05 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,247 | 0 | 5,244 | 556 | $0.0093 | 7.4 | pass/pass/pass/pass/pass |
| maintenance-05--baseline-unconstrained--02 | maintenance-05 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,325 | 0 | 4,322 | 455 | $0.0077 | 6.5 | pass/pass/pass/pass/pass |
| maintenance-06--unconstrained--02 | maintenance-06 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,804 | 0 | 5,801 | 529 | $0.0099 | 7.7 | pass/pass/pass/pass/pass |
| maintenance-06--baseline-unconstrained--02 | maintenance-06 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 924 | $0.0099 | 11.9 | pass/pass/pass/pass/pass |
| scene-rendering-01--unconstrained--02 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 2 | 1 | 10,180 | 0 | 7,105 | 943 | $0.0167 | 9.9 | fail/fail/not-run/not-run/not-run |
| scene-rendering-01--baseline-unconstrained--02 | scene-rendering-01 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,879 | 0 | 0 | 380 | $0.0058 | 5.8 | pass/pass/pass/pass/pass |
| scene-rendering-02--unconstrained--02 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | success |  | 4 | 3 | 27,549 | 14,573 | 9,786 | 1,604 | $0.0249 | 19.2 | fail/fail/not-run/not-run/not-run |
| scene-rendering-02--baseline-unconstrained--02 | scene-rendering-02 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,988 | 0 | 0 | 442 | $0.0062 | 7.3 | pass/pass/pass/pass/pass |
| scene-rendering-03--unconstrained--02 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | success |  | 3 | 2 | 22,184 | 8,000 | 10,757 | 2,470 | $0.0300 | 20.2 | fail/fail/not-run/not-run/not-run |
| scene-rendering-03--baseline-unconstrained--02 | scene-rendering-03 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,200 | 0 | 4,197 | 968 | $0.0101 | 8.9 | pass/pass/pass/pass/pass |
| scene-rendering-04--unconstrained--02 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | success |  | 2 | 1 | 10,374 | 0 | 7,105 | 1,021 | $0.0173 | 12.3 | pass/fail/not-run/not-run/not-run |
| scene-rendering-04--baseline-unconstrained--02 | scene-rendering-04 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,069 | 0 | 0 | 958 | $0.0089 | 11.6 | pass/pass/pass/pass/pass |
| scene-rendering-05--unconstrained--02 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | success |  | 2 | 1 | 12,107 | 5,167 | 6,934 | 871 | $0.0135 | 9.2 | pass/fail/not-run/not-run/not-run |
| scene-rendering-05--baseline-unconstrained--02 | scene-rendering-05 | scene-rendering | edit | baseline | unconstrained | success |  | 2 | 1 | 9,368 | 4,164 | 5,198 | 1,551 | $0.0147 | 15.1 | none/none/none/none/none |
| scene-rendering-06--unconstrained--02 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 43,002 | 21,625 | 18,003 | 3,253 | $0.0443 | 31.2 | fail/fail/not-run/not-run/not-run |
| scene-rendering-06--baseline-unconstrained--02 | scene-rendering-06 | scene-rendering | cold | baseline | unconstrained | success |  | 4 | 3 | 29,236 | 19,576 | 9,648 | 3,076 | $0.0294 | 33.1 | pass/pass/pass/pass/fail |
| scene-rendering-07--unconstrained--02 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 38,850 | 20,736 | 14,718 | 2,638 | $0.0371 | 25.4 | fail/fail/not-run/not-run/not-run |
| scene-rendering-07--baseline-unconstrained--02 | scene-rendering-07 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 29,200 | 19,042 | 10,146 | 3,107 | $0.0301 | 35.2 | pass/pass/pass/pass/fail |
| scene-rendering-08--unconstrained--02 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 4,994 | 0 | 4,991 | 414 | $0.0083 | 5.1 | pass/pass/pass/pass/pass |
| scene-rendering-08--baseline-unconstrained--02 | scene-rendering-08 | scene-rendering | edit | baseline | unconstrained | success |  | 1 | 0 | 4,203 | 0 | 4,200 | 385 | $0.0072 | 6.0 | pass/pass/pass/pass/pass |
| scene-rendering-09--unconstrained--02 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | success |  | 3 | 2 | 23,259 | 8,369 | 11,521 | 2,497 | $0.0311 | 26.7 | pass/fail/not-run/not-run/not-run |
| scene-rendering-09--baseline-unconstrained--02 | scene-rendering-09 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,162 | 0 | 4,159 | 683 | $0.0086 | 7.6 | pass/pass/pass/pass/pass |
| scene-rendering-10--unconstrained--02 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 28,900 | 15,957 | 9,431 | 2,030 | $0.0270 | 24.8 | pass/fail/not-run/not-run/not-run |
| scene-rendering-10--baseline-unconstrained--02 | scene-rendering-10 | scene-rendering | cold | baseline | unconstrained | success |  | 3 | 2 | 20,703 | 11,722 | 8,972 | 2,758 | $0.0262 | 29.9 | pass/pass/pass/pass/fail |
| scene-rendering-11--unconstrained--02 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 44,427 | 24,166 | 16,721 | 3,349 | $0.0436 | 31.9 | fail/fail/not-run/not-run/not-run |
| scene-rendering-11--baseline-unconstrained--02 | scene-rendering-11 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,408 | 0 | 4,405 | 2,223 | $0.0166 | 15.2 | pass/pass/pass/pass/pass |
| shader-bridge-01--unconstrained--02 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 24,270 | 16,876 | 7,382 | 1,643 | $0.0191 | 19.5 | pass/pass/pass/pass/fail |
| shader-bridge-01--baseline-unconstrained--02 | shader-bridge-01 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 3,945 | 0 | 0 | 696 | $0.0074 | 9.7 | pass/pass/pass/pass/pass |
| shader-bridge-02--unconstrained--02 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 27,817 | 19,238 | 8,567 | 2,150 | $0.0234 | 20.4 | pass/fail/not-run/not-run/not-run |
| shader-bridge-02--baseline-unconstrained--02 | shader-bridge-02 | shader-bridge | edit | baseline | unconstrained | success |  | 3 | 2 | 16,686 | 9,800 | 6,877 | 2,613 | $0.0227 | 23.8 | none/none/none/none/none |
| shader-bridge-03--unconstrained--02 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 38,556 | 18,995 | 16,285 | 3,840 | $0.0447 | 36.6 | fail/fail/not-run/not-run/not-run |
| shader-bridge-03--baseline-unconstrained--02 | shader-bridge-03 | shader-bridge | cold | baseline | unconstrained | success |  | 2 | 1 | 9,907 | 0 | 5,828 | 966 | $0.0162 | 13.4 | pass/fail/not-run/not-run/not-run |
| shader-bridge-04--unconstrained--02 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 27,092 | 18,140 | 8,940 | 2,891 | $0.0275 | 29.8 | none/none/none/none/none |
| shader-bridge-04--baseline-unconstrained--02 | shader-bridge-04 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,053 | 0 | 0 | 684 | $0.0075 | 9.1 | pass/pass/pass/pass/pass |
| shader-bridge-05--unconstrained--02 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 5,315 | 0 | 5,312 | 278 | $0.0080 | 5.8 | pass/pass/pass/pass/pass |
| shader-bridge-05--baseline-unconstrained--02 | shader-bridge-05 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,186 | 0 | 4,183 | 423 | $0.0073 | 7.7 | pass/pass/pass/pass/pass |
| shader-bridge-06--unconstrained--02 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | success |  | 2 | 1 | 11,502 | 5,194 | 6,302 | 631 | $0.0116 | 9.9 | pass/fail/not-run/not-run/not-run |
| shader-bridge-06--baseline-unconstrained--02 | shader-bridge-06 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,231 | 0 | 4,228 | 334 | $0.0070 | 6.6 | pass/pass/pass/pass/pass |
| interaction-01--unconstrained--03 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 12,354 | 5,130 | 7,218 | 730 | $0.0132 | 10.5 | fail/fail/not-run/not-run/not-run |
| interaction-01--baseline-unconstrained--03 | interaction-01 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 3,980 | 0 | 0 | 653 | $0.0072 | 6.9 | pass/pass/pass/pass/pass |
| interaction-02--unconstrained--03 | interaction-02 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 34,318 | 22,108 | 12,198 | 3,099 | $0.0330 | 26.6 | fail/fail/not-run/not-run/not-run |
| interaction-02--baseline-unconstrained--03 | interaction-02 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,076 | 0 | 0 | 918 | $0.0087 | 11.9 | pass/pass/pass/pass/pass |
| interaction-03--unconstrained--03 | interaction-03 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 26,360 | 14,476 | 11,875 | 2,726 | $0.0299 | 26.8 | fail/fail/not-run/not-run/not-run |
| interaction-03--baseline-unconstrained--03 | interaction-03 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,111 | 0 | 4,108 | 1,059 | $0.0104 | 13.1 | pass/pass/pass/pass/pass |
| interaction-04--unconstrained--03 | interaction-04 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 11,300 | 4,821 | 6,473 | 953 | $0.0133 | 11.0 | pass/fail/not-run/not-run/not-run |
| interaction-04--baseline-unconstrained--03 | interaction-04 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,030 | 0 | 0 | 790 | $0.0080 | 13.4 | pass/pass/pass/pass/pass |
| interaction-05--unconstrained--03 | interaction-05 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 28,654 | 19,400 | 9,242 | 1,228 | $0.0196 | 20.0 | pass/fail/not-run/not-run/not-run |
| interaction-05--baseline-unconstrained--03 | interaction-05 | interaction | edit | baseline | unconstrained | failure | max-repairs | 4 | 3 | 21,962 | 15,076 | 6,874 | 2,839 | $0.0243 | 15.0 | none/none/none/none/none |
| interaction-06--unconstrained--03 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 4,981 | 0 | 4,978 | 516 | $0.0088 | 8.9 | pass/pass/pass/pass/pass |
| interaction-06--baseline-unconstrained--03 | interaction-06 | interaction | edit | baseline | unconstrained | success |  | 2 | 1 | 10,072 | 0 | 5,971 | 1,848 | $0.0208 | 27.4 | pass/pass/pass/pass/fail |
| interaction-07--unconstrained--03 | interaction-07 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 26,700 | 14,885 | 11,806 | 2,574 | $0.0291 | 23.1 | pass/fail/not-run/not-run/not-run |
| interaction-07--baseline-unconstrained--03 | interaction-07 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,220 | 0 | 4,217 | 1,108 | $0.0108 | 18.1 | pass/pass/pass/pass/pass |
| interaction-08--unconstrained--03 | interaction-08 | interaction | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 39,173 | 19,890 | 16,035 | 2,975 | $0.0402 | 27.6 | fail/fail/not-run/not-run/not-run |
| interaction-08--baseline-unconstrained--03 | interaction-08 | interaction | cold | baseline | unconstrained | success |  | 1 | 0 | 4,048 | 0 | 0 | 723 | $0.0077 | 12.0 | pass/pass/pass/pass/pass |
| interaction-09--unconstrained--03 | interaction-09 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 12,363 | 5,284 | 7,073 | 943 | $0.0141 | 13.3 | pass/fail/not-run/not-run/not-run |
| interaction-09--baseline-unconstrained--03 | interaction-09 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,328 | 0 | 4,325 | 1,137 | $0.0111 | 13.6 | pass/pass/pass/pass/pass |
| interaction-10--unconstrained--03 | interaction-10 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 28,166 | 15,486 | 12,671 | 1,841 | $0.0266 | 21.3 | fail/fail/not-run/not-run/not-run |
| interaction-10--baseline-unconstrained--03 | interaction-10 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,190 | 0 | 4,187 | 1,133 | $0.0109 | 17.4 | pass/pass/pass/pass/pass |
| interaction-11--unconstrained--03 | interaction-11 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 40,031 | 25,516 | 14,503 | 7,214 | $0.0568 | 55.6 | pass/pass/pass/pass/fail |
| interaction-11--baseline-unconstrained--03 | interaction-11 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,248 | 0 | 4,245 | 805 | $0.0093 | 12.7 | pass/pass/pass/pass/pass |
| maintenance-01--unconstrained--03 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 4,825 | 0 | 4,822 | 275 | $0.0074 | 5.2 | pass/pass/pass/pass/pass |
| maintenance-01--baseline-unconstrained--03 | maintenance-01 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,008 | 0 | 0 | 213 | $0.0051 | 5.0 | pass/pass/pass/pass/pass |
| maintenance-02--unconstrained--03 | maintenance-02 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,534 | 0 | 5,531 | 633 | $0.0101 | 8.5 | pass/pass/pass/pass/pass |
| maintenance-02--baseline-unconstrained--03 | maintenance-02 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 645 | $0.0085 | 6.9 | pass/pass/pass/pass/pass |
| maintenance-03--unconstrained--03 | maintenance-03 | maintenance | edit | mtek | unconstrained | success |  | 2 | 1 | 10,916 | 5,096 | 5,814 | 505 | $0.0103 | 6.8 | none/none/none/none/none |
| maintenance-03--baseline-unconstrained--03 | maintenance-03 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,104 | 0 | 4,101 | 355 | $0.0069 | 7.0 | pass/pass/pass/pass/pass |
| maintenance-04--unconstrained--03 | maintenance-04 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,220 | 0 | 5,217 | 602 | $0.0095 | 9.3 | pass/pass/pass/pass/pass |
| maintenance-04--baseline-unconstrained--03 | maintenance-04 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,203 | 0 | 4,200 | 653 | $0.0085 | 8.8 | pass/pass/pass/pass/pass |
| maintenance-05--unconstrained--03 | maintenance-05 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,247 | 0 | 5,244 | 565 | $0.0094 | 7.6 | pass/pass/pass/pass/pass |
| maintenance-05--baseline-unconstrained--03 | maintenance-05 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,325 | 0 | 4,322 | 644 | $0.0086 | 7.0 | pass/pass/pass/pass/pass |
| maintenance-06--unconstrained--03 | maintenance-06 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,804 | 0 | 5,801 | 482 | $0.0097 | 7.3 | pass/pass/pass/pass/pass |
| maintenance-06--baseline-unconstrained--03 | maintenance-06 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 906 | $0.0098 | 11.8 | pass/pass/pass/pass/pass |
| scene-rendering-01--unconstrained--03 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 29,167 | 15,798 | 10,288 | 1,569 | $0.0254 | 15.8 | fail/fail/not-run/not-run/not-run |
| scene-rendering-01--baseline-unconstrained--03 | scene-rendering-01 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,879 | 0 | 0 | 418 | $0.0060 | 6.2 | pass/pass/pass/pass/pass |
| scene-rendering-02--unconstrained--03 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 26,095 | 13,257 | 9,648 | 1,587 | $0.0245 | 16.9 | fail/fail/not-run/not-run/not-run |
| scene-rendering-02--baseline-unconstrained--03 | scene-rendering-02 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,988 | 0 | 0 | 768 | $0.0078 | 10.0 | pass/pass/pass/pass/pass |
| scene-rendering-03--unconstrained--03 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | success |  | 2 | 1 | 11,430 | 0 | 8,006 | 1,661 | $0.0217 | 14.5 | pass/fail/not-run/not-run/not-run |
| scene-rendering-03--baseline-unconstrained--03 | scene-rendering-03 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,200 | 0 | 4,197 | 719 | $0.0088 | 7.8 | pass/pass/pass/pass/pass |
| scene-rendering-04--unconstrained--03 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 36,714 | 18,950 | 14,489 | 2,649 | $0.0365 | 26.6 | fail/fail/not-run/not-run/not-run |
| scene-rendering-04--baseline-unconstrained--03 | scene-rendering-04 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,069 | 0 | 0 | 785 | $0.0080 | 9.8 | pass/pass/pass/pass/pass |
| scene-rendering-05--unconstrained--03 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | success |  | 2 | 1 | 11,919 | 5,167 | 6,746 | 917 | $0.0135 | 9.6 | pass/fail/not-run/not-run/not-run |
| scene-rendering-05--baseline-unconstrained--03 | scene-rendering-05 | scene-rendering | edit | baseline | unconstrained | success |  | 1 | 0 | 4,167 | 0 | 4,164 | 904 | $0.0097 | 10.0 | pass/pass/pass/pass/pass |
| scene-rendering-06--unconstrained--03 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 38,964 | 20,158 | 15,432 | 3,161 | $0.0405 | 29.0 | fail/fail/not-run/not-run/not-run |
| scene-rendering-06--baseline-unconstrained--03 | scene-rendering-06 | scene-rendering | cold | baseline | unconstrained | success |  | 2 | 1 | 9,858 | 4,167 | 5,685 | 2,241 | $0.0187 | 22.4 | none/none/none/none/none |
| scene-rendering-07--unconstrained--03 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 45,257 | 22,991 | 18,870 | 4,341 | $0.0510 | 38.4 | fail/fail/not-run/not-run/not-run |
| scene-rendering-07--baseline-unconstrained--03 | scene-rendering-07 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 28,441 | 18,563 | 9,866 | 2,940 | $0.0289 | 37.8 | pass/pass/pass/pass/fail |
| scene-rendering-08--unconstrained--03 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 4,994 | 0 | 4,991 | 300 | $0.0077 | 4.5 | pass/pass/pass/pass/pass |
| scene-rendering-08--baseline-unconstrained--03 | scene-rendering-08 | scene-rendering | edit | baseline | unconstrained | success |  | 1 | 0 | 4,203 | 0 | 4,200 | 491 | $0.0077 | 6.6 | pass/pass/pass/pass/pass |
| scene-rendering-09--unconstrained--03 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | success |  | 3 | 2 | 24,973 | 8,556 | 13,048 | 2,708 | $0.0341 | 26.7 | fail/fail/not-run/not-run/not-run |
| scene-rendering-09--baseline-unconstrained--03 | scene-rendering-09 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,162 | 0 | 4,159 | 1,058 | $0.0105 | 9.6 | pass/pass/pass/pass/pass |
| scene-rendering-10--unconstrained--03 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 41,231 | 21,380 | 16,339 | 4,059 | $0.0464 | 35.4 | fail/fail/not-run/not-run/not-run |
| scene-rendering-10--baseline-unconstrained--03 | scene-rendering-10 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 31,302 | 20,258 | 11,032 | 3,862 | $0.0351 | 48.6 | pass/pass/pass/pass/fail |
| scene-rendering-11--unconstrained--03 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 47,091 | 23,827 | 19,724 | 3,803 | $0.0496 | 34.4 | fail/fail/not-run/not-run/not-run |
| scene-rendering-11--baseline-unconstrained--03 | scene-rendering-11 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,408 | 0 | 4,405 | 2,447 | $0.0177 | 16.0 | pass/pass/pass/pass/pass |
| shader-bridge-01--unconstrained--03 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 25,478 | 17,086 | 8,380 | 1,699 | $0.0207 | 20.9 | pass/pass/pass/pass/fail |
| shader-bridge-01--baseline-unconstrained--03 | shader-bridge-01 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 3,945 | 0 | 0 | 641 | $0.0072 | 9.2 | pass/pass/pass/pass/pass |
| shader-bridge-02--unconstrained--03 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 27,283 | 18,919 | 8,352 | 1,084 | $0.0178 | 16.7 | pass/pass/pass/pass/fail |
| shader-bridge-02--baseline-unconstrained--03 | shader-bridge-02 | shader-bridge | edit | baseline | unconstrained | success |  | 2 | 1 | 9,385 | 4,162 | 5,217 | 1,380 | $0.0138 | 14.7 | none/none/none/none/none |
| shader-bridge-03--unconstrained--03 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 34,693 | 17,943 | 13,474 | 2,437 | $0.0341 | 25.5 | fail/fail/not-run/not-run/not-run |
| shader-bridge-03--baseline-unconstrained--03 | shader-bridge-03 | shader-bridge | cold | baseline | unconstrained | success |  | 1 | 0 | 4,076 | 0 | 0 | 766 | $0.0079 | 10.6 | pass/pass/pass/pass/pass |
| shader-bridge-04--unconstrained--03 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | success |  | 2 | 1 | 13,320 | 4,968 | 8,346 | 1,222 | $0.0170 | 13.7 | pass/fail/not-run/not-run/not-run |
| shader-bridge-04--baseline-unconstrained--03 | shader-bridge-04 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,053 | 0 | 0 | 717 | $0.0076 | 9.6 | pass/pass/pass/pass/pass |
| shader-bridge-05--unconstrained--03 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 5,315 | 0 | 5,312 | 314 | $0.0082 | 5.8 | pass/pass/pass/pass/pass |
| shader-bridge-05--baseline-unconstrained--03 | shader-bridge-05 | shader-bridge | edit | baseline | unconstrained | success |  | 2 | 1 | 9,414 | 4,183 | 5,225 | 632 | $0.0101 | 13.3 | pass/pass/pass/pass/fail |
| shader-bridge-06--unconstrained--03 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | success |  | 2 | 1 | 11,829 | 5,194 | 6,629 | 919 | $0.0134 | 12.3 | pass/fail/not-run/not-run/not-run |
| shader-bridge-06--baseline-unconstrained--03 | shader-bridge-06 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,231 | 0 | 4,228 | 325 | $0.0069 | 7.1 | pass/pass/pass/pass/pass |
| interaction-01--unconstrained--04 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 31,632 | 21,423 | 10,197 | 1,125 | $0.0205 | 15.9 | fail/fail/not-run/not-run/not-run |
| interaction-01--baseline-unconstrained--04 | interaction-01 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 3,980 | 0 | 0 | 710 | $0.0075 | 7.5 | pass/pass/pass/pass/pass |
| interaction-02--unconstrained--04 | interaction-02 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 33,157 | 22,224 | 10,921 | 2,971 | $0.0307 | 27.8 | fail/fail/not-run/not-run/not-run |
| interaction-02--baseline-unconstrained--04 | interaction-02 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,076 | 0 | 0 | 918 | $0.0087 | 11.6 | pass/pass/pass/pass/pass |
| interaction-03--unconstrained--04 | interaction-03 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 43,693 | 27,109 | 16,572 | 3,521 | $0.0410 | 33.5 | fail/fail/not-run/not-run/not-run |
| interaction-03--baseline-unconstrained--04 | interaction-03 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,111 | 0 | 4,108 | 1,136 | $0.0108 | 13.1 | pass/pass/pass/pass/pass |
| interaction-04--unconstrained--04 | interaction-04 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 11,896 | 4,821 | 7,069 | 2,460 | $0.0216 | 19.3 | fail/fail/not-run/not-run/not-run |
| interaction-04--baseline-unconstrained--04 | interaction-04 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,030 | 0 | 0 | 791 | $0.0080 | 12.7 | pass/pass/pass/pass/pass |
| interaction-05--unconstrained--04 | interaction-05 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 28,483 | 19,277 | 9,194 | 1,223 | $0.0195 | 17.5 | pass/fail/not-run/not-run/not-run |
| interaction-05--baseline-unconstrained--04 | interaction-05 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,124 | 0 | 4,121 | 886 | $0.0096 | 11.7 | pass/pass/pass/pass/pass |
| interaction-06--unconstrained--04 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 4,981 | 0 | 4,978 | 423 | $0.0083 | 8.1 | pass/pass/pass/pass/pass |
| interaction-06--baseline-unconstrained--04 | interaction-06 | interaction | edit | baseline | unconstrained | success |  | 2 | 1 | 9,855 | 0 | 5,754 | 1,760 | $0.0201 | 23.8 | pass/pass/pass/pass/fail |
| interaction-07--unconstrained--04 | interaction-07 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 49,942 | 30,980 | 18,950 | 7,699 | $0.0653 | 38.5 | pass/fail/not-run/not-run/not-run |
| interaction-07--baseline-unconstrained--04 | interaction-07 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,220 | 0 | 4,217 | 936 | $0.0100 | 16.7 | pass/pass/pass/pass/pass |
| interaction-08--unconstrained--04 | interaction-08 | interaction | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 38,420 | 19,260 | 15,912 | 3,974 | $0.0449 | 34.9 | fail/fail/not-run/not-run/not-run |
| interaction-08--baseline-unconstrained--04 | interaction-08 | interaction | cold | baseline | unconstrained | success |  | 1 | 0 | 4,048 | 0 | 0 | 511 | $0.0066 | 9.6 | pass/pass/pass/pass/pass |
| interaction-09--unconstrained--04 | interaction-09 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 21,444 | 12,683 | 8,752 | 2,085 | $0.0226 | 22.9 | pass/fail/not-run/not-run/not-run |
| interaction-09--baseline-unconstrained--04 | interaction-09 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,328 | 0 | 4,325 | 1,177 | $0.0113 | 14.1 | pass/pass/pass/pass/pass |
| interaction-10--unconstrained--04 | interaction-10 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 46,199 | 29,065 | 17,122 | 4,819 | $0.0484 | 42.3 | pass/fail/not-run/not-run/not-run |
| interaction-10--baseline-unconstrained--04 | interaction-10 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,190 | 0 | 4,187 | 1,169 | $0.0111 | 17.6 | pass/pass/pass/pass/pass |
| interaction-11--unconstrained--04 | interaction-11 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 38,931 | 25,766 | 13,153 | 2,853 | $0.0333 | 23.9 | fail/fail/not-run/not-run/not-run |
| interaction-11--baseline-unconstrained--04 | interaction-11 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,248 | 0 | 4,245 | 763 | $0.0091 | 12.2 | pass/pass/pass/pass/pass |
| maintenance-01--unconstrained--04 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 4,825 | 0 | 4,822 | 259 | $0.0073 | 4.9 | pass/pass/pass/pass/pass |
| maintenance-01--baseline-unconstrained--04 | maintenance-01 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,008 | 0 | 0 | 300 | $0.0055 | 5.4 | pass/pass/pass/pass/pass |
| maintenance-02--unconstrained--04 | maintenance-02 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,534 | 0 | 5,531 | 524 | $0.0095 | 7.7 | pass/pass/pass/pass/pass |
| maintenance-02--baseline-unconstrained--04 | maintenance-02 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 472 | $0.0077 | 6.4 | pass/pass/pass/pass/pass |
| maintenance-03--unconstrained--04 | maintenance-03 | maintenance | edit | mtek | unconstrained | success |  | 3 | 2 | 17,634 | 10,929 | 6,696 | 651 | $0.0127 | 9.2 | none/none/none/none/none |
| maintenance-03--baseline-unconstrained--04 | maintenance-03 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,104 | 0 | 4,101 | 344 | $0.0068 | 6.8 | pass/pass/pass/pass/pass |
| maintenance-04--unconstrained--04 | maintenance-04 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,220 | 0 | 5,217 | 658 | $0.0098 | 10.5 | pass/pass/pass/pass/pass |
| maintenance-04--baseline-unconstrained--04 | maintenance-04 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,203 | 0 | 4,200 | 729 | $0.0089 | 10.5 | pass/pass/pass/pass/pass |
| maintenance-05--unconstrained--04 | maintenance-05 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,247 | 0 | 5,244 | 569 | $0.0094 | 7.6 | pass/pass/pass/pass/pass |
| maintenance-05--baseline-unconstrained--04 | maintenance-05 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,325 | 0 | 4,322 | 644 | $0.0086 | 7.0 | pass/pass/pass/pass/pass |
| maintenance-06--unconstrained--04 | maintenance-06 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,804 | 0 | 5,801 | 366 | $0.0091 | 6.1 | pass/pass/pass/pass/pass |
| maintenance-06--baseline-unconstrained--04 | maintenance-06 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 817 | $0.0094 | 10.8 | pass/pass/pass/pass/pass |
| scene-rendering-01--unconstrained--04 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 2 | 1 | 7,625 | 0 | 4,550 | 673 | $0.0121 | 8.0 | pass/fail/not-run/not-run/not-run |
| scene-rendering-01--baseline-unconstrained--04 | scene-rendering-01 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,879 | 0 | 0 | 402 | $0.0059 | 5.8 | pass/pass/pass/pass/pass |
| scene-rendering-02--unconstrained--04 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | success |  | 3 | 2 | 15,476 | 5,596 | 6,693 | 1,125 | $0.0177 | 14.8 | pass/fail/not-run/not-run/not-run |
| scene-rendering-02--baseline-unconstrained--04 | scene-rendering-02 | scene-rendering | cold | baseline | unconstrained | success |  | 2 | 1 | 8,869 | 0 | 4,878 | 987 | $0.0150 | 11.6 | none/none/none/none/none |
| scene-rendering-03--unconstrained--04 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | success |  | 3 | 2 | 21,096 | 8,055 | 9,614 | 1,466 | $0.0236 | 16.8 | fail/fail/not-run/not-run/not-run |
| scene-rendering-03--baseline-unconstrained--04 | scene-rendering-03 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,200 | 0 | 4,197 | 836 | $0.0094 | 8.2 | pass/pass/pass/pass/pass |
| scene-rendering-04--unconstrained--04 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | success |  | 4 | 3 | 35,710 | 18,626 | 13,809 | 2,179 | $0.0333 | 23.1 | fail/fail/not-run/not-run/not-run |
| scene-rendering-04--baseline-unconstrained--04 | scene-rendering-04 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,069 | 0 | 0 | 635 | $0.0072 | 8.2 | pass/pass/pass/pass/pass |
| scene-rendering-05--unconstrained--04 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | success |  | 2 | 1 | 11,469 | 5,167 | 6,296 | 631 | $0.0115 | 7.3 | pass/fail/not-run/not-run/not-run |
| scene-rendering-05--baseline-unconstrained--04 | scene-rendering-05 | scene-rendering | edit | baseline | unconstrained | success |  | 1 | 0 | 4,167 | 0 | 4,164 | 847 | $0.0094 | 9.4 | pass/pass/pass/pass/pass |
| scene-rendering-06--unconstrained--04 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 29,424 | 16,417 | 9,633 | 2,312 | $0.0286 | 27.5 | fail/fail/not-run/not-run/not-run |
| scene-rendering-06--baseline-unconstrained--04 | scene-rendering-06 | scene-rendering | cold | baseline | unconstrained | success |  | 2 | 1 | 11,348 | 4,167 | 7,175 | 2,973 | $0.0243 | 30.5 | pass/pass/pass/pass/fail |
| scene-rendering-07--unconstrained--04 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 42,094 | 21,111 | 17,587 | 4,487 | $0.0499 | 41.1 | fail/fail/not-run/not-run/not-run |
| scene-rendering-07--baseline-unconstrained--04 | scene-rendering-07 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 27,526 | 18,260 | 9,254 | 2,774 | $0.0273 | 38.1 | pass/pass/pass/pass/fail |
| scene-rendering-08--unconstrained--04 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 4,994 | 0 | 4,991 | 300 | $0.0077 | 4.5 | pass/pass/pass/pass/pass |
| scene-rendering-08--baseline-unconstrained--04 | scene-rendering-08 | scene-rendering | edit | baseline | unconstrained | success |  | 1 | 0 | 4,203 | 0 | 4,200 | 375 | $0.0071 | 5.8 | pass/pass/pass/pass/pass |
| scene-rendering-09--unconstrained--04 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 46,552 | 23,263 | 19,917 | 5,223 | $0.0567 | 46.5 | fail/fail/not-run/not-run/not-run |
| scene-rendering-09--baseline-unconstrained--04 | scene-rendering-09 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,162 | 0 | 4,159 | 1,118 | $0.0108 | 9.4 | pass/pass/pass/pass/pass |
| scene-rendering-10--unconstrained--04 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 37,726 | 20,324 | 13,890 | 3,048 | $0.0381 | 31.7 | fail/fail/not-run/not-run/not-run |
| scene-rendering-10--baseline-unconstrained--04 | scene-rendering-10 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 29,052 | 18,841 | 10,199 | 3,249 | $0.0309 | 41.4 | pass/pass/pass/pass/fail |
| scene-rendering-11--unconstrained--04 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 37,413 | 18,607 | 15,266 | 3,154 | $0.0403 | 29.9 | fail/fail/not-run/not-run/not-run |
| scene-rendering-11--baseline-unconstrained--04 | scene-rendering-11 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,408 | 0 | 4,405 | 1,110 | $0.0111 | 10.2 | pass/pass/pass/pass/pass |
| shader-bridge-01--unconstrained--04 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 24,336 | 16,885 | 7,439 | 1,887 | $0.0204 | 20.5 | pass/pass/pass/pass/fail |
| shader-bridge-01--baseline-unconstrained--04 | shader-bridge-01 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 3,945 | 0 | 0 | 629 | $0.0071 | 8.7 | pass/pass/pass/pass/pass |
| shader-bridge-02--unconstrained--04 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 27,061 | 18,264 | 8,785 | 1,508 | $0.0204 | 16.4 | pass/pass/pass/pass/fail |
| shader-bridge-02--baseline-unconstrained--04 | shader-bridge-02 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,165 | 0 | 4,162 | 985 | $0.0101 | 11.8 | pass/pass/pass/pass/pass |
| shader-bridge-03--unconstrained--04 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 32,416 | 16,214 | 12,926 | 3,122 | $0.0367 | 30.8 | fail/fail/not-run/not-run/not-run |
| shader-bridge-03--baseline-unconstrained--04 | shader-bridge-03 | shader-bridge | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 25,206 | 12,672 | 8,449 | 2,173 | $0.0268 | 28.9 | pass/fail/not-run/not-run/not-run |
| shader-bridge-04--unconstrained--04 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | success |  | 3 | 2 | 23,712 | 13,397 | 10,306 | 2,198 | $0.0252 | 21.4 | pass/fail/not-run/not-run/not-run |
| shader-bridge-04--baseline-unconstrained--04 | shader-bridge-04 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,053 | 0 | 0 | 838 | $0.0082 | 10.1 | pass/pass/pass/pass/pass |
| shader-bridge-05--unconstrained--04 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 5,315 | 0 | 5,312 | 324 | $0.0083 | 6.5 | pass/pass/pass/pass/pass |
| shader-bridge-05--baseline-unconstrained--04 | shader-bridge-05 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,186 | 0 | 4,183 | 455 | $0.0075 | 7.8 | pass/pass/pass/pass/pass |
| shader-bridge-06--unconstrained--04 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | success |  | 2 | 1 | 11,514 | 5,194 | 6,314 | 679 | $0.0118 | 10.5 | fail/fail/not-run/not-run/not-run |
| shader-bridge-06--baseline-unconstrained--04 | shader-bridge-06 | shader-bridge | edit | baseline | unconstrained | success |  | 4 | 3 | 20,237 | 14,252 | 5,973 | 836 | $0.0131 | 10.9 | none/none/none/none/none |
| interaction-01--mtek-guide-unconstrained--00 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 9,459 | 0 | 9,456 | 812 | $0.0159 | 9.6 | pass/pass/pass/pass/pass |
| interaction-02--mtek-guide-unconstrained--00 | interaction-02 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 37,336 | 21,890 | 15,437 | 2,073 | $0.0319 | 17.1 | fail/fail/not-run/not-run/not-run |
| interaction-03--mtek-guide-unconstrained--00 | interaction-03 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 57,229 | 38,297 | 18,920 | 4,112 | $0.0481 | 26.6 | fail/fail/not-run/not-run/not-run |
| interaction-04--mtek-guide-unconstrained--00 | interaction-04 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 9,150 | 0 | 9,147 | 660 | $0.0147 | 9.9 | pass/pass/pass/pass/pass |
| interaction-05--mtek-guide-unconstrained--00 | interaction-05 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 9,316 | 0 | 9,313 | 917 | $0.0162 | 12.5 | pass/pass/pass/pass/pass |
| interaction-06--mtek-guide-unconstrained--00 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 9,307 | 0 | 9,304 | 547 | $0.0144 | 9.8 | pass/pass/pass/pass/pass |
| interaction-07--mtek-guide-unconstrained--00 | interaction-07 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 48,292 | 33,604 | 14,676 | 2,371 | $0.0336 | 27.7 | none/none/none/none/none |
| interaction-08--mtek-guide-unconstrained--00 | interaction-08 | interaction | cold | mtek | unconstrained | success |  | 3 | 2 | 26,221 | 16,427 | 9,785 | 795 | $0.0179 | 15.8 | pass/pass/pass/pass/fail |
| interaction-09--mtek-guide-unconstrained--00 | interaction-09 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 50,144 | 34,943 | 15,189 | 3,276 | $0.0389 | 38.4 | pass/fail/not-run/not-run/not-run |
| interaction-10--mtek-guide-unconstrained--00 | interaction-10 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 23,145 | 9,400 | 13,739 | 1,564 | $0.0259 | 14.6 | pass/fail/not-run/not-run/not-run |
| interaction-11--mtek-guide-unconstrained--00 | interaction-11 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 56,223 | 37,079 | 19,132 | 6,270 | $0.0590 | 58.3 | pass/pass/pass/pass/fail |
| maintenance-01--mtek-guide-unconstrained--00 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 9,151 | 0 | 9,148 | 305 | $0.0130 | 5.3 | pass/pass/pass/pass/pass |
| maintenance-02--mtek-guide-unconstrained--00 | maintenance-02 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 9,860 | 0 | 9,857 | 774 | $0.0162 | 9.5 | pass/pass/pass/pass/pass |
| maintenance-03--mtek-guide-unconstrained--00 | maintenance-03 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 9,425 | 0 | 9,422 | 375 | $0.0137 | 6.6 | pass/pass/pass/pass/pass |
| maintenance-04--mtek-guide-unconstrained--00 | maintenance-04 | maintenance | edit | mtek | unconstrained | success |  | 2 | 1 | 20,621 | 9,543 | 11,072 | 1,234 | $0.0210 | 18.3 | pass/pass/pass/pass/fail |
| maintenance-05--mtek-guide-unconstrained--00 | maintenance-05 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 9,573 | 0 | 9,570 | 768 | $0.0158 | 7.0 | pass/pass/pass/pass/pass |
| maintenance-06--mtek-guide-unconstrained--00 | maintenance-06 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,130 | 0 | 10,127 | 352 | $0.0144 | 8.0 | pass/pass/pass/pass/pass |
| scene-rendering-01--mtek-guide-unconstrained--00 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 3 | 2 | 25,495 | 15,892 | 9,594 | 1,235 | $0.0198 | 14.6 | pass/fail/not-run/not-run/not-run |
| scene-rendering-02--mtek-guide-unconstrained--00 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | success |  | 2 | 1 | 16,689 | 7,504 | 9,179 | 676 | $0.0156 | 9.4 | pass/fail/not-run/not-run/not-run |
| scene-rendering-03--mtek-guide-unconstrained--00 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | success |  | 3 | 2 | 27,858 | 17,352 | 10,497 | 1,155 | $0.0206 | 16.8 | pass/fail/not-run/not-run/not-run |
| scene-rendering-04--mtek-guide-unconstrained--00 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | success |  | 2 | 1 | 16,886 | 7,589 | 9,291 | 939 | $0.0171 | 10.4 | pass/fail/not-run/not-run/not-run |
| scene-rendering-05--mtek-guide-unconstrained--00 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | success |  | 2 | 1 | 20,234 | 9,493 | 10,735 | 819 | $0.0185 | 10.5 | pass/fail/not-run/not-run/not-run |
| scene-rendering-06--mtek-guide-unconstrained--00 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 38,281 | 27,202 | 11,067 | 1,319 | $0.0232 | 17.3 | pass/fail/not-run/not-run/not-run |
| scene-rendering-07--mtek-guide-unconstrained--00 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 38,653 | 27,351 | 11,290 | 2,114 | $0.0274 | 27.1 | pass/pass/pass/pass/fail |
| scene-rendering-08--mtek-guide-unconstrained--00 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 9,320 | 0 | 9,317 | 321 | $0.0133 | 4.7 | pass/pass/pass/pass/pass |
| scene-rendering-09--mtek-guide-unconstrained--00 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | success |  | 3 | 2 | 26,984 | 16,888 | 10,087 | 788 | $0.0182 | 14.9 | pass/fail/not-run/not-run/not-run |
| scene-rendering-10--mtek-guide-unconstrained--00 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 54,498 | 36,380 | 18,106 | 6,299 | $0.0578 | 60.5 | pass/fail/not-run/not-run/not-run |
| scene-rendering-11--mtek-guide-unconstrained--00 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 52,976 | 36,552 | 16,412 | 2,913 | $0.0387 | 26.9 | pass/fail/not-run/not-run/not-run |
| shader-bridge-01--mtek-guide-unconstrained--00 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 9,088 | 0 | 9,085 | 594 | $0.0143 | 7.0 | pass/pass/pass/pass/pass |
| shader-bridge-02--mtek-guide-unconstrained--00 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | success |  | 2 | 1 | 19,598 | 9,327 | 10,265 | 1,467 | $0.0211 | 14.9 | none/none/none/none/none |
| shader-bridge-03--mtek-guide-unconstrained--00 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 42,670 | 29,218 | 13,440 | 3,671 | $0.0381 | 39.6 | pass/fail/not-run/not-run/not-run |
| shader-bridge-04--mtek-guide-unconstrained--00 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | success |  | 2 | 1 | 20,833 | 9,294 | 11,533 | 954 | $0.0201 | 12.3 | pass/fail/not-run/not-run/not-run |
| shader-bridge-05--mtek-guide-unconstrained--00 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 9,641 | 0 | 9,638 | 366 | $0.0139 | 6.8 | pass/pass/pass/pass/pass |
| shader-bridge-06--mtek-guide-unconstrained--00 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 9,523 | 0 | 9,520 | 308 | $0.0134 | 5.8 | pass/pass/pass/pass/pass |
| interaction-01--mtek-guide-unconstrained--01 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 9,459 | 0 | 9,456 | 851 | $0.0161 | 7.7 | pass/pass/pass/pass/pass |
| interaction-02--mtek-guide-unconstrained--01 | interaction-02 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 21,861 | 9,258 | 12,597 | 1,857 | $0.0260 | 15.1 | pass/fail/not-run/not-run/not-run |
| interaction-03--mtek-guide-unconstrained--01 | interaction-03 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 36,385 | 21,835 | 14,541 | 1,959 | $0.0302 | 16.1 | fail/fail/not-run/not-run/not-run |
| interaction-04--mtek-guide-unconstrained--01 | interaction-04 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 42,285 | 29,987 | 12,286 | 2,329 | $0.0300 | 20.1 | none/none/none/none/none |
| interaction-05--mtek-guide-unconstrained--01 | interaction-05 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 9,316 | 0 | 9,313 | 805 | $0.0157 | 10.8 | pass/pass/pass/pass/pass |
| interaction-06--mtek-guide-unconstrained--01 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 9,307 | 0 | 9,304 | 765 | $0.0155 | 9.9 | pass/pass/pass/pass/pass |
| interaction-07--mtek-guide-unconstrained--01 | interaction-07 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 51,059 | 34,363 | 16,684 | 5,665 | $0.0526 | 42.5 | none/none/none/none/none |
| interaction-08--mtek-guide-unconstrained--01 | interaction-08 | interaction | cold | mtek | unconstrained | success |  | 2 | 1 | 16,251 | 7,562 | 8,683 | 543 | $0.0143 | 12.0 | pass/pass/pass/pass/fail |
| interaction-09--mtek-guide-unconstrained--01 | interaction-09 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 56,415 | 39,086 | 17,317 | 3,263 | $0.0419 | 37.2 | fail/fail/not-run/not-run/not-run |
| interaction-10--mtek-guide-unconstrained--01 | interaction-10 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 23,195 | 9,400 | 13,789 | 1,612 | $0.0262 | 14.6 | pass/fail/not-run/not-run/not-run |
| interaction-11--mtek-guide-unconstrained--01 | interaction-11 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 50,584 | 34,422 | 16,150 | 4,453 | $0.0459 | 46.2 | pass/pass/pass/pass/fail |
| maintenance-01--mtek-guide-unconstrained--01 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 9,151 | 0 | 9,148 | 291 | $0.0129 | 5.6 | pass/pass/pass/pass/pass |
| maintenance-02--mtek-guide-unconstrained--01 | maintenance-02 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 9,860 | 0 | 9,857 | 721 | $0.0159 | 9.3 | pass/pass/pass/pass/pass |
| maintenance-03--mtek-guide-unconstrained--01 | maintenance-03 | maintenance | edit | mtek | unconstrained | success |  | 2 | 1 | 19,581 | 9,422 | 10,153 | 518 | $0.0162 | 8.0 | none/none/none/none/none |
| maintenance-04--mtek-guide-unconstrained--01 | maintenance-04 | maintenance | edit | mtek | unconstrained | success |  | 2 | 1 | 20,294 | 9,543 | 10,745 | 936 | $0.0191 | 13.1 | none/none/none/none/none |
| maintenance-05--mtek-guide-unconstrained--01 | maintenance-05 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 9,573 | 0 | 9,570 | 605 | $0.0150 | 6.2 | pass/pass/pass/pass/pass |
| maintenance-06--mtek-guide-unconstrained--01 | maintenance-06 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,130 | 0 | 10,127 | 554 | $0.0154 | 9.1 | pass/pass/pass/pass/pass |
| scene-rendering-01--mtek-guide-unconstrained--01 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 3 | 2 | 25,432 | 15,857 | 9,566 | 824 | $0.0177 | 12.2 | pass/fail/not-run/not-run/not-run |
| scene-rendering-02--mtek-guide-unconstrained--01 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | success |  | 3 | 2 | 25,688 | 16,144 | 9,535 | 774 | $0.0174 | 10.6 | pass/fail/not-run/not-run/not-run |
| scene-rendering-03--mtek-guide-unconstrained--01 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | success |  | 2 | 1 | 17,490 | 7,744 | 9,740 | 1,591 | $0.0209 | 16.3 | pass/fail/not-run/not-run/not-run |
| scene-rendering-04--mtek-guide-unconstrained--01 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | success |  | 4 | 3 | 38,322 | 27,082 | 11,228 | 1,422 | $0.0239 | 17.0 | pass/fail/not-run/not-run/not-run |
| scene-rendering-05--mtek-guide-unconstrained--01 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | success |  | 2 | 1 | 20,447 | 9,493 | 10,948 | 700 | $0.0181 | 9.5 | pass/fail/not-run/not-run/not-run |
| scene-rendering-06--mtek-guide-unconstrained--01 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 39,311 | 27,646 | 11,653 | 1,621 | $0.0254 | 15.6 | pass/fail/not-run/not-run/not-run |
| scene-rendering-07--mtek-guide-unconstrained--01 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 42,043 | 29,359 | 12,672 | 3,260 | $0.0351 | 33.2 | pass/fail/not-run/not-run/not-run |
| scene-rendering-08--mtek-guide-unconstrained--01 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 9,320 | 0 | 9,317 | 324 | $0.0133 | 4.9 | pass/pass/pass/pass/pass |
| scene-rendering-09--mtek-guide-unconstrained--01 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | success |  | 3 | 2 | 29,514 | 17,957 | 11,548 | 2,011 | $0.0263 | 28.7 | pass/fail/not-run/not-run/not-run |
| scene-rendering-10--mtek-guide-unconstrained--01 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | success |  | 4 | 3 | 51,014 | 34,176 | 16,826 | 3,607 | $0.0425 | 40.5 | pass/fail/not-run/not-run/not-run |
| scene-rendering-11--mtek-guide-unconstrained--01 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 49,436 | 32,985 | 16,439 | 3,762 | $0.0427 | 25.3 | none/none/none/none/none |
| shader-bridge-01--mtek-guide-unconstrained--01 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 9,088 | 0 | 9,085 | 620 | $0.0145 | 7.7 | pass/pass/pass/pass/pass |
| shader-bridge-02--mtek-guide-unconstrained--01 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 9,330 | 0 | 9,327 | 857 | $0.0159 | 10.1 | pass/pass/pass/pass/pass |
| shader-bridge-03--mtek-guide-unconstrained--01 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 42,497 | 29,456 | 13,029 | 2,778 | $0.0331 | 28.9 | pass/fail/not-run/not-run/not-run |
| shader-bridge-04--mtek-guide-unconstrained--01 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | success |  | 4 | 3 | 44,743 | 31,650 | 13,081 | 2,623 | $0.0326 | 28.4 | pass/pass/pass/pass/fail |
| shader-bridge-05--mtek-guide-unconstrained--01 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 9,641 | 0 | 9,638 | 371 | $0.0139 | 7.0 | pass/pass/pass/pass/pass |
| shader-bridge-06--mtek-guide-unconstrained--01 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | success |  | 2 | 1 | 20,086 | 9,520 | 10,560 | 532 | $0.0168 | 8.4 | pass/fail/not-run/not-run/not-run |
| interaction-01--mtek-guide-unconstrained--02 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 9,459 | 0 | 9,456 | 466 | $0.0142 | 7.0 | pass/pass/pass/pass/pass |
| interaction-02--mtek-guide-unconstrained--02 | interaction-02 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 37,930 | 22,178 | 15,743 | 2,049 | $0.0322 | 17.0 | fail/fail/not-run/not-run/not-run |
| interaction-03--mtek-guide-unconstrained--02 | interaction-03 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 36,382 | 21,841 | 14,532 | 1,944 | $0.0301 | 21.2 | fail/fail/not-run/not-run/not-run |
| interaction-04--mtek-guide-unconstrained--02 | interaction-04 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 33,113 | 19,855 | 13,249 | 1,081 | $0.0240 | 14.5 | pass/fail/not-run/not-run/not-run |
| interaction-05--mtek-guide-unconstrained--02 | interaction-05 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 20,339 | 9,313 | 11,020 | 1,105 | $0.0202 | 14.5 | pass/fail/not-run/not-run/not-run |
| interaction-06--mtek-guide-unconstrained--02 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 9,307 | 0 | 9,304 | 553 | $0.0144 | 9.6 | pass/pass/pass/pass/pass |
| interaction-07--mtek-guide-unconstrained--02 | interaction-07 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 36,304 | 22,269 | 14,026 | 2,430 | $0.0319 | 30.9 | pass/fail/not-run/not-run/not-run |
| interaction-08--mtek-guide-unconstrained--02 | interaction-08 | interaction | cold | mtek | unconstrained | success |  | 2 | 1 | 16,244 | 7,562 | 8,676 | 534 | $0.0143 | 11.9 | pass/pass/pass/pass/fail |
| interaction-09--mtek-guide-unconstrained--02 | interaction-09 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 21,982 | 9,610 | 12,366 | 2,246 | $0.0277 | 23.7 | fail/fail/not-run/not-run/not-run |
| interaction-10--mtek-guide-unconstrained--02 | interaction-10 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 23,222 | 9,400 | 13,816 | 1,705 | $0.0267 | 16.3 | pass/fail/not-run/not-run/not-run |
| interaction-11--mtek-guide-unconstrained--02 | interaction-11 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 34,678 | 21,456 | 13,213 | 3,053 | $0.0339 | 39.1 | pass/pass/pass/pass/fail |
| maintenance-01--mtek-guide-unconstrained--02 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 9,151 | 0 | 9,148 | 311 | $0.0130 | 5.7 | pass/pass/pass/pass/pass |
| maintenance-02--mtek-guide-unconstrained--02 | maintenance-02 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 9,860 | 0 | 9,857 | 881 | $0.0167 | 10.2 | pass/pass/pass/pass/pass |
| maintenance-03--mtek-guide-unconstrained--02 | maintenance-03 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 9,425 | 0 | 9,422 | 331 | $0.0134 | 6.2 | pass/pass/pass/pass/pass |
| maintenance-04--mtek-guide-unconstrained--02 | maintenance-04 | maintenance | edit | mtek | unconstrained | success |  | 2 | 1 | 20,545 | 9,543 | 10,996 | 1,475 | $0.0221 | 21.5 | pass/pass/pass/pass/fail |
| maintenance-05--mtek-guide-unconstrained--02 | maintenance-05 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 9,573 | 0 | 9,570 | 415 | $0.0140 | 5.5 | pass/pass/pass/pass/pass |
| maintenance-06--mtek-guide-unconstrained--02 | maintenance-06 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,130 | 0 | 10,127 | 563 | $0.0155 | 9.3 | pass/pass/pass/pass/pass |
| scene-rendering-01--mtek-guide-unconstrained--02 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 4 | 3 | 33,262 | 23,969 | 9,281 | 824 | $0.0181 | 13.8 | none/none/none/none/none |
| scene-rendering-02--mtek-guide-unconstrained--02 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | success |  | 2 | 1 | 16,209 | 7,504 | 8,699 | 803 | $0.0156 | 10.3 | pass/fail/not-run/not-run/not-run |
| scene-rendering-03--mtek-guide-unconstrained--02 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | success |  | 2 | 1 | 17,371 | 7,744 | 9,621 | 1,036 | $0.0180 | 12.8 | pass/fail/not-run/not-run/not-run |
| scene-rendering-04--mtek-guide-unconstrained--02 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | success |  | 2 | 1 | 16,741 | 7,589 | 9,146 | 695 | $0.0157 | 9.4 | pass/fail/not-run/not-run/not-run |
| scene-rendering-05--mtek-guide-unconstrained--02 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | success |  | 2 | 1 | 20,281 | 9,493 | 10,782 | 775 | $0.0183 | 10.6 | pass/fail/not-run/not-run/not-run |
| scene-rendering-06--mtek-guide-unconstrained--02 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 40,499 | 28,594 | 11,893 | 2,455 | $0.0300 | 26.3 | pass/fail/not-run/not-run/not-run |
| scene-rendering-07--mtek-guide-unconstrained--02 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 48,157 | 33,135 | 15,010 | 2,617 | $0.0352 | 30.5 | pass/fail/not-run/not-run/not-run |
| scene-rendering-08--mtek-guide-unconstrained--02 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 9,320 | 0 | 9,317 | 425 | $0.0138 | 6.5 | pass/pass/pass/pass/pass |
| scene-rendering-09--mtek-guide-unconstrained--02 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | success |  | 3 | 2 | 29,017 | 17,509 | 11,499 | 2,081 | $0.0265 | 26.0 | pass/fail/not-run/not-run/not-run |
| scene-rendering-10--mtek-guide-unconstrained--02 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 42,379 | 29,601 | 12,766 | 3,271 | $0.0353 | 39.4 | pass/fail/not-run/not-run/not-run |
| scene-rendering-11--mtek-guide-unconstrained--02 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 54,682 | 36,481 | 18,189 | 3,472 | $0.0438 | 28.5 | pass/fail/not-run/not-run/not-run |
| shader-bridge-01--mtek-guide-unconstrained--02 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 9,088 | 0 | 9,085 | 654 | $0.0146 | 8.5 | pass/pass/pass/pass/pass |
| shader-bridge-02--mtek-guide-unconstrained--02 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 9,330 | 0 | 9,327 | 825 | $0.0158 | 9.9 | pass/pass/pass/pass/pass |
| shader-bridge-03--mtek-guide-unconstrained--02 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 40,709 | 27,863 | 12,834 | 2,479 | $0.0312 | 27.1 | pass/fail/not-run/not-run/not-run |
| shader-bridge-04--mtek-guide-unconstrained--02 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 9,297 | 0 | 9,294 | 715 | $0.0152 | 7.5 | pass/pass/pass/pass/pass |
| shader-bridge-05--mtek-guide-unconstrained--02 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 9,641 | 0 | 9,638 | 313 | $0.0136 | 6.2 | pass/pass/pass/pass/pass |
| shader-bridge-06--mtek-guide-unconstrained--02 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 9,523 | 0 | 9,520 | 388 | $0.0138 | 6.5 | pass/pass/pass/pass/pass |
| interaction-01--mtek-guide-unconstrained--03 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 9,459 | 0 | 9,456 | 517 | $0.0144 | 7.6 | pass/pass/pass/pass/pass |
| interaction-02--mtek-guide-unconstrained--03 | interaction-02 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 37,968 | 22,222 | 15,737 | 2,084 | $0.0323 | 17.0 | fail/fail/not-run/not-run/not-run |
| interaction-03--mtek-guide-unconstrained--03 | interaction-03 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 21,791 | 9,299 | 12,486 | 1,752 | $0.0253 | 18.3 | fail/fail/not-run/not-run/not-run |
| interaction-04--mtek-guide-unconstrained--03 | interaction-04 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 36,209 | 21,317 | 14,883 | 2,430 | $0.0329 | 24.3 | fail/fail/not-run/not-run/not-run |
| interaction-05--mtek-guide-unconstrained--03 | interaction-05 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 20,414 | 9,313 | 11,095 | 1,835 | $0.0240 | 22.9 | pass/pass/pass/pass/fail |
| interaction-06--mtek-guide-unconstrained--03 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 9,307 | 0 | 9,304 | 500 | $0.0141 | 8.7 | pass/pass/pass/pass/pass |
| interaction-07--mtek-guide-unconstrained--03 | interaction-07 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 48,186 | 32,125 | 16,049 | 4,037 | $0.0435 | 31.7 | none/none/none/none/none |
| interaction-08--mtek-guide-unconstrained--03 | interaction-08 | interaction | cold | mtek | unconstrained | success |  | 4 | 3 | 36,922 | 26,239 | 10,671 | 912 | $0.0205 | 17.7 | pass/fail/not-run/not-run/not-run |
| interaction-09--mtek-guide-unconstrained--03 | interaction-09 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 38,859 | 23,101 | 15,749 | 2,335 | $0.0337 | 25.7 | fail/fail/not-run/not-run/not-run |
| interaction-10--mtek-guide-unconstrained--03 | interaction-10 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 23,133 | 9,400 | 13,727 | 1,592 | $0.0261 | 14.8 | pass/fail/not-run/not-run/not-run |
| interaction-11--mtek-guide-unconstrained--03 | interaction-11 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 49,182 | 34,507 | 14,663 | 3,869 | $0.0411 | 45.4 | fail/fail/not-run/not-run/not-run |
| maintenance-01--mtek-guide-unconstrained--03 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 9,151 | 0 | 9,148 | 297 | $0.0129 | 5.4 | pass/pass/pass/pass/pass |
| maintenance-02--mtek-guide-unconstrained--03 | maintenance-02 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 9,860 | 0 | 9,857 | 737 | $0.0160 | 8.2 | pass/pass/pass/pass/pass |
| maintenance-03--mtek-guide-unconstrained--03 | maintenance-03 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 9,425 | 0 | 9,422 | 323 | $0.0134 | 6.2 | pass/pass/pass/pass/pass |
| maintenance-04--mtek-guide-unconstrained--03 | maintenance-04 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 9,546 | 0 | 9,543 | 611 | $0.0150 | 9.3 | pass/pass/pass/pass/pass |
| maintenance-05--mtek-guide-unconstrained--03 | maintenance-05 | maintenance | edit | mtek | unconstrained | success |  | 2 | 1 | 20,779 | 9,570 | 11,203 | 821 | $0.0191 | 9.1 | pass/fail/not-run/not-run/not-run |
| maintenance-06--mtek-guide-unconstrained--03 | maintenance-06 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,130 | 0 | 10,127 | 383 | $0.0146 | 7.8 | pass/pass/pass/pass/pass |
| scene-rendering-01--mtek-guide-unconstrained--03 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 2 | 1 | 15,740 | 7,395 | 8,339 | 422 | $0.0133 | 7.3 | pass/fail/not-run/not-run/not-run |
| scene-rendering-02--mtek-guide-unconstrained--03 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | success |  | 3 | 2 | 25,512 | 16,181 | 9,322 | 714 | $0.0168 | 11.6 | pass/fail/not-run/not-run/not-run |
| scene-rendering-03--mtek-guide-unconstrained--03 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | success |  | 2 | 1 | 17,370 | 7,744 | 9,620 | 1,040 | $0.0180 | 12.4 | pass/fail/not-run/not-run/not-run |
| scene-rendering-04--mtek-guide-unconstrained--03 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | success |  | 3 | 2 | 26,912 | 16,715 | 10,188 | 969 | $0.0193 | 13.2 | pass/fail/not-run/not-run/not-run |
| scene-rendering-05--mtek-guide-unconstrained--03 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | success |  | 2 | 1 | 20,950 | 9,493 | 11,451 | 821 | $0.0194 | 10.7 | pass/fail/not-run/not-run/not-run |
| scene-rendering-06--mtek-guide-unconstrained--03 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 38,553 | 27,129 | 11,412 | 1,884 | $0.0264 | 23.5 | pass/fail/not-run/not-run/not-run |
| scene-rendering-07--mtek-guide-unconstrained--03 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 43,023 | 30,088 | 12,923 | 2,721 | $0.0328 | 32.0 | pass/fail/not-run/not-run/not-run |
| scene-rendering-08--mtek-guide-unconstrained--03 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 9,320 | 0 | 9,317 | 400 | $0.0136 | 5.0 | pass/pass/pass/pass/pass |
| scene-rendering-09--mtek-guide-unconstrained--03 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | success |  | 3 | 2 | 29,442 | 17,939 | 11,494 | 1,904 | $0.0257 | 23.0 | pass/fail/not-run/not-run/not-run |
| scene-rendering-10--mtek-guide-unconstrained--03 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 52,604 | 35,883 | 16,709 | 5,731 | $0.0531 | 53.9 | pass/fail/not-run/not-run/not-run |
| scene-rendering-11--mtek-guide-unconstrained--03 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 54,093 | 36,051 | 18,030 | 2,961 | $0.0410 | 22.0 | pass/fail/not-run/not-run/not-run |
| shader-bridge-01--mtek-guide-unconstrained--03 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 9,088 | 0 | 9,085 | 709 | $0.0149 | 7.7 | pass/pass/pass/pass/pass |
| shader-bridge-02--mtek-guide-unconstrained--03 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 9,330 | 0 | 9,327 | 820 | $0.0158 | 9.7 | pass/pass/pass/pass/pass |
| shader-bridge-03--mtek-guide-unconstrained--03 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 40,898 | 28,482 | 12,404 | 2,368 | $0.0302 | 27.6 | pass/fail/not-run/not-run/not-run |
| shader-bridge-04--mtek-guide-unconstrained--03 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | success |  | 3 | 2 | 31,363 | 19,982 | 11,372 | 1,485 | $0.0236 | 20.3 | pass/fail/not-run/not-run/not-run |
| shader-bridge-05--mtek-guide-unconstrained--03 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 9,641 | 0 | 9,638 | 296 | $0.0135 | 6.1 | pass/pass/pass/pass/pass |
| shader-bridge-06--mtek-guide-unconstrained--03 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 9,523 | 0 | 9,520 | 406 | $0.0139 | 6.6 | pass/pass/pass/pass/pass |
| interaction-01--mtek-guide-unconstrained--04 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 9,459 | 0 | 9,456 | 374 | $0.0137 | 6.4 | pass/pass/pass/pass/pass |
| interaction-02--mtek-guide-unconstrained--04 | interaction-02 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 37,435 | 22,145 | 15,281 | 2,009 | $0.0314 | 17.1 | fail/fail/not-run/not-run/not-run |
| interaction-03--mtek-guide-unconstrained--04 | interaction-03 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 36,376 | 21,834 | 14,533 | 1,922 | $0.0300 | 21.1 | fail/fail/not-run/not-run/not-run |
| interaction-04--mtek-guide-unconstrained--04 | interaction-04 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 52,060 | 35,299 | 16,749 | 3,297 | $0.0410 | 28.7 | fail/fail/not-run/not-run/not-run |
| interaction-05--mtek-guide-unconstrained--04 | interaction-05 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 9,316 | 0 | 9,313 | 832 | $0.0158 | 11.5 | pass/pass/pass/pass/pass |
| interaction-06--mtek-guide-unconstrained--04 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 9,307 | 0 | 9,304 | 574 | $0.0145 | 10.2 | pass/pass/pass/pass/pass |
| interaction-07--mtek-guide-unconstrained--04 | interaction-07 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 37,846 | 21,878 | 15,959 | 2,593 | $0.0351 | 28.7 | pass/fail/not-run/not-run/not-run |
| interaction-08--mtek-guide-unconstrained--04 | interaction-08 | interaction | cold | mtek | unconstrained | success |  | 2 | 1 | 16,405 | 7,562 | 8,837 | 714 | $0.0154 | 14.6 | pass/pass/pass/pass/fail |
| interaction-09--mtek-guide-unconstrained--04 | interaction-09 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 39,059 | 23,200 | 15,850 | 2,425 | $0.0343 | 26.8 | fail/fail/not-run/not-run/not-run |
| interaction-10--mtek-guide-unconstrained--04 | interaction-10 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 23,600 | 9,400 | 14,194 | 1,882 | $0.0281 | 16.7 | pass/fail/not-run/not-run/not-run |
| interaction-11--mtek-guide-unconstrained--04 | interaction-11 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 56,210 | 38,350 | 17,848 | 6,961 | $0.0610 | 68.9 | fail/fail/not-run/not-run/not-run |
| maintenance-01--mtek-guide-unconstrained--04 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 9,151 | 9,148 | 0 | 267 | $0.0023 | 4.9 | pass/pass/pass/pass/pass |
| maintenance-02--mtek-guide-unconstrained--04 | maintenance-02 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 9,860 | 0 | 9,857 | 616 | $0.0154 | 7.1 | pass/pass/pass/pass/pass |
| maintenance-03--mtek-guide-unconstrained--04 | maintenance-03 | maintenance | edit | mtek | unconstrained | success |  | 2 | 1 | 19,941 | 9,422 | 10,513 | 539 | $0.0168 | 9.2 | pass/fail/not-run/not-run/not-run |
| maintenance-04--mtek-guide-unconstrained--04 | maintenance-04 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 9,546 | 0 | 9,543 | 781 | $0.0158 | 10.9 | pass/pass/pass/pass/pass |
| maintenance-05--mtek-guide-unconstrained--04 | maintenance-05 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 9,573 | 0 | 9,570 | 733 | $0.0156 | 7.1 | pass/pass/pass/pass/pass |
| maintenance-06--mtek-guide-unconstrained--04 | maintenance-06 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,130 | 0 | 10,127 | 436 | $0.0148 | 8.1 | pass/pass/pass/pass/pass |
| scene-rendering-01--mtek-guide-unconstrained--04 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 3 | 2 | 25,391 | 15,760 | 9,622 | 994 | $0.0186 | 12.6 | pass/fail/not-run/not-run/not-run |
| scene-rendering-02--mtek-guide-unconstrained--04 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | success |  | 3 | 2 | 25,225 | 16,033 | 9,183 | 560 | $0.0159 | 10.5 | pass/fail/not-run/not-run/not-run |
| scene-rendering-03--mtek-guide-unconstrained--04 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 53,566 | 34,764 | 18,790 | 3,586 | $0.0449 | 26.6 | pass/fail/not-run/not-run/not-run |
| scene-rendering-04--mtek-guide-unconstrained--04 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | success |  | 3 | 2 | 28,299 | 17,371 | 10,919 | 1,041 | $0.0206 | 12.8 | pass/fail/not-run/not-run/not-run |
| scene-rendering-05--mtek-guide-unconstrained--04 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | success |  | 2 | 1 | 20,284 | 9,493 | 10,785 | 802 | $0.0184 | 11.1 | pass/fail/not-run/not-run/not-run |
| scene-rendering-06--mtek-guide-unconstrained--04 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 39,784 | 28,047 | 11,725 | 1,862 | $0.0268 | 21.1 | pass/fail/not-run/not-run/not-run |
| scene-rendering-07--mtek-guide-unconstrained--04 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 37,459 | 26,264 | 11,183 | 2,269 | $0.0280 | 23.6 | none/none/none/none/none |
| scene-rendering-08--mtek-guide-unconstrained--04 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 9,320 | 0 | 9,317 | 331 | $0.0133 | 5.5 | pass/pass/pass/pass/pass |
| scene-rendering-09--mtek-guide-unconstrained--04 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | success |  | 2 | 1 | 16,922 | 7,686 | 9,230 | 713 | $0.0159 | 11.0 | pass/fail/not-run/not-run/not-run |
| scene-rendering-10--mtek-guide-unconstrained--04 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | failure | generation-truncated | 2 | 1 | 23,389 | 7,826 | 15,557 | 6,627 | $0.0534 | 49.1 | pass/fail/not-run/not-run/not-run |
| scene-rendering-11--mtek-guide-unconstrained--04 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 39,350 | 28,034 | 11,304 | 3,421 | $0.0341 | 20.4 | none/none/none/none/none |
| shader-bridge-01--mtek-guide-unconstrained--04 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 9,088 | 0 | 9,085 | 584 | $0.0143 | 7.1 | pass/pass/pass/pass/pass |
| shader-bridge-02--mtek-guide-unconstrained--04 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 9,330 | 0 | 9,327 | 813 | $0.0157 | 9.8 | pass/pass/pass/pass/pass |
| shader-bridge-03--mtek-guide-unconstrained--04 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 41,777 | 28,774 | 12,991 | 3,045 | $0.0344 | 35.7 | pass/fail/not-run/not-run/not-run |
| shader-bridge-04--mtek-guide-unconstrained--04 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 9,297 | 0 | 9,294 | 689 | $0.0151 | 7.8 | pass/pass/pass/pass/pass |
| shader-bridge-05--mtek-guide-unconstrained--04 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 9,641 | 0 | 9,638 | 315 | $0.0136 | 6.3 | pass/pass/pass/pass/pass |
| shader-bridge-06--mtek-guide-unconstrained--04 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 9,523 | 0 | 9,520 | 391 | $0.0139 | 6.3 | pass/pass/pass/pass/pass |

## How the conclusion is reached

The rule (decision 0108, applying decision 0001 and `spec/ai-and-benchmarks.md` section 6.4) compares the Mtek condition with the baseline over the tasks both have attempts at, on two axes:

- success: completion rate = completed / attempts that ended by themselves (completed or failed); "matched" when the two differ by at most 10 points, "higher" or "lower" otherwise;
- tokens per completed task = all tokens of all attempts (successes, failures, unfinished) / completed tasks; the ratio Mtek / baseline with a 95 % percentile interval from a bootstrap over tasks (4 000 resamples, fixed seed); "fewer" when the whole interval is below 1, "more" when above 1, "same" otherwise.

better = success matched or higher and tokens fewer, or success higher and tokens the same; worse = success matched or lower and tokens more, or success lower and tokens the same; equivalent = success matched and tokens the same; inconclusive = nothing completes on either side, the axes oppose each other, or no task has attempts on both sides. If only one side completes anything it is better; the other is worse. No comparison is tuned to turn "equivalent" into a win.

The research target (proposed, not a result): at matched success, at least 30 % fewer tokens per completed task than the baseline (ratio at most 0.70 and the verdict better). Missing it triggers the investigation of spec 6.4, not a cryptic syntax. A verdict is provisional when a task has fewer than 5 trials on a side, when more than 10 % of the attempts could not be judged, or when token counts are unknown.
