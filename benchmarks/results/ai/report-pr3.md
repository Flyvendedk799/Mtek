# AI/token benchmark report

Generated from the stored `records.jsonl` by `tools/ai-eval/src/report.ts` (decision 0108); the same records give the same text. Every attempt is listed in the last section, failures included. The original "about 80 % fewer tokens" claim is an unverified hypothesis and is not tested by the 30 % research target below.

## Runs and recorded settings

| run | started | status | provider / model | settings | spend |
| --- | --- | --- | --- | --- | --- |
| pr3-main-mtek | 2026-10-20T07:27:26.692Z | complete | anthropic / claude-haiku-4-5-20251001 | temperature 1, prompt caching true, test feedback messages, max repairs per task | cap $15, this run $7.2506, ledger after $11.2700, 731 calls, 0 refused |
| pr3-main-baseline | 2026-10-20T07:27:26.743Z | complete | anthropic / claude-haiku-4-5-20251001 | temperature 1, prompt caching true, test feedback messages, max repairs per task | cap $15, this run $2.0909, ledger after $7.1486, 250 calls, 0 refused |
| pr3-holdout | 2026-10-20T07:27:26.708Z | complete | anthropic / claude-haiku-4-5-20251001 | temperature 1, prompt caching true, test feedback messages, max repairs per task | cap $15, this run $1.9285, ledger after $5.2248, 192 calls, 0 refused |

Date of the runs: 2026-10-20T07:27:26.692Z to 2026-10-20T07:27:26.743Z. Models: claude-haiku-4-5-20251001.

## Model claude-haiku-4-5-20251001

### Conclusion on H4 (agent-facing contract), decision 0001 by the rule of decision 0108

**Mtek unconstrained against the baseline: WORSE.** completion lower and tokens per completed task significantly more.

|  | attempts | completed | completion rate | tokens per completed task | cost per completed task |
| --- | --- | --- | --- | --- | --- |
| Mtek | 170 | 119 | 70.0 % | 30,908 | $0.0290 |
| baseline | 170 | 159 | 93.5 % | 9,416 | $0.0132 |

Over 34 task(s): token ratio Mtek / baseline 3.282, 95 % interval [2.336, 4.785]; completion difference -23.5 points (success lower, tokens more). Research target of 30 % fewer tokens: not met.

**Mtek unconstrained with the document guide added against the baseline: WORSE.** completion matched and tokens per completed task significantly more.

|  | attempts | completed | completion rate | tokens per completed task | cost per completed task |
| --- | --- | --- | --- | --- | --- |
| Mtek | 170 | 144 | 84.7 % | 29,428 | $0.0264 |
| baseline | 170 | 159 | 93.5 % | 9,416 | $0.0132 |

Over 34 task(s): token ratio Mtek / baseline 3.125, 95 % interval [2.628, 3.768]; completion difference -8.8 points (success matched, tokens more). Research target of 30 % fewer tokens: not met.

### Aggregates per condition

| cell | attempts | completed / failed / not judged | completion rate | tokens per completed task | tokens per attempt, median [IQR] | tokens per completed attempt, median [IQR] | repairs per completed, median [IQR] | seconds per attempt, median [IQR] | cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mtek unconstrained | 170 | 119 / 51 / 0 | 70.0 % | 30,908 | 16,315 [8,484, 33,732] | 9,244 [5,871, 18,799] | 0.0 [0.0, 1.0] | 18.2 [9.9, 28.3] | $3.4470 |
| mtek unconstrained+guide | 170 | 144 / 26 / 0 | 84.7 % | 29,428 | 14,287 [11,028, 34,979] | 14,034 [10,920, 22,291] | 0.0 [0.0, 1.0] | 11.5 [8.6, 22.2] | $3.8036 |
| baseline unconstrained | 170 | 159 / 11 / 0 | 93.5 % | 9,416 | 5,008 [4,689, 10,210] | 4,969 [4,664, 5,397] | 0.0 [0.0, 0.0] | 14.8 [10.8, 23.7] | $2.0909 |

Tokens are input plus output of every call of every attempt (cached reads and writes are input). "Not judged" counts not-run, error, unavailable and unfinished-by-budget attempts: they are in the token sums, not in the completion rate.

### Tokens, separately

| cell | input | of which cache reads | of which cache writes | of which uncached | output | total | attempts with unknown usage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mtek unconstrained | 3,407,356 | 1,883,042 | 1,523,075 | 1,239 | 270,731 | 3,678,087 | 0 |
| mtek unconstrained+guide | 4,055,902 | 1,891,256 | 2,163,692 | 954 | 181,776 | 4,237,678 | 0 |
| baseline unconstrained | 1,297,140 | 409,096 | 646,224 | 241,820 | 200,071 | 1,497,211 | 0 |

### First-attempt success (the first candidate that was validated)

| cell | candidates | parse | check | start | tests | everything |
| --- | --- | --- | --- | --- | --- | --- |
| mtek unconstrained | 170 | 111 / 170 (65.3 %) | 80 / 170 (47.1 %) | 80 / 170 (47.1 %) | 62 / 170 (36.5 %) | 62 / 170 (36.5 %) |
| mtek unconstrained+guide | 170 | 136 / 170 (80.0 %) | 125 / 170 (73.5 %) | 125 / 170 (73.5 %) | 100 / 170 (58.8 %) | 100 / 170 (58.8 %) |
| baseline unconstrained | 170 | 155 / 170 (91.2 %) | 143 / 170 (84.1 %) | 143 / 170 (84.1 %) | 125 / 170 (73.5 %) | 125 / 170 (73.5 %) |

### Where the input tokens went (by each part's share of the request's characters)

| cell | instructions | task | documentation | project files | diagnostics | tool results | repair context | generated code | other | output (generated code) | input in repair rounds | output in repair rounds |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mtek unconstrained | 209,773 (6.2 %) | 177,082 (5.2 %) | 2,049,892 (60.2 %) | 75,602 (2.2 %) | 344,301 (10.1 %) | 67,820 (2.0 %) | 155,932 (4.6 %) | 326,954 (9.6 %) | 0 (0.0 %) | 270,731 | 2,393,376 | 132,623 |
| mtek unconstrained+guide | 164,273 (4.1 %) | 150,223 (3.7 %) | 3,305,248 (81.5 %) | 59,325 (1.5 %) | 77,207 (1.9 %) | 40,788 (1.0 %) | 93,980 (2.3 %) | 164,859 (4.1 %) | 0 (0.0 %) | 181,776 | 2,119,672 | 73,306 |
| baseline unconstrained | 126,817 (9.8 %) | 113,244 (8.7 %) | 777,609 (59.9 %) | 51,799 (4.0 %) | 12,527 (1.0 %) | 17,269 (1.3 %) | 74,742 (5.8 %) | 123,133 (9.5 %) | 0 (0.0 %) | 200,071 | 592,225 | 55,522 |

The provider counts tokens per request, not per part of a request: each request's input tokens are split by the share of its characters (system prompt, each message's sections, the model's earlier replies). "documentation" is the compiler context export on the Mtek side (its examples are inside it and are not counted apart) and the reference document on the baseline side. These are estimates of attribution, the totals are exact.

### Per category

| cell | attempts | completed / failed / not judged | completion rate | tokens per completed task | tokens per attempt, median [IQR] | tokens per completed attempt, median [IQR] | repairs per completed, median [IQR] | seconds per attempt, median [IQR] | cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| interaction: mtek unconstrained | 55 | 37 / 18 / 0 | 67.3 % | 43,150 | 28,681 [15,725, 41,231] | 22,869 [13,071, 32,228] | 2.0 [1.0, 3.0] | 25.1 [18.8, 30.8] | $1.4897 |
| interaction: mtek unconstrained+guide | 55 | 45 / 10 / 0 | 81.8 % | 35,794 | 23,164 [11,126, 49,841] | 14,360 [11,070, 37,029] | 0.0 [0.0, 2.0] | 18.3 [13.6, 24.9] | $1.3909 |
| interaction: baseline unconstrained | 55 | 55 / 0 / 0 | 100.0 % | 7,879 | 5,133 [4,855, 11,208] | 5,133 [4,855, 11,208] | 0.0 [0.0, 1.0] | 21.6 [15.4, 25.6] | $0.6600 |
| maintenance: mtek unconstrained | 30 | 30 / 0 / 0 | 100.0 % | 6,891 | 5,871 [5,572, 6,086] | 5,871 [5,572, 6,086] | 0.0 [0.0, 0.0] | 9.6 [8.0, 13.5] | $0.2902 |
| maintenance: mtek unconstrained+guide | 30 | 30 / 0 / 0 | 100.0 % | 13,264 | 11,197 [10,895, 11,496] | 11,197 [10,895, 11,496] | 0.0 [0.0, 0.0] | 8.3 [7.7, 11.2] | $0.4848 |
| maintenance: baseline unconstrained | 30 | 30 / 0 / 0 | 100.0 % | 5,824 | 4,780 [4,457, 5,001] | 4,780 [4,457, 5,001] | 0.0 [0.0, 0.0] | 10.6 [9.0, 14.6] | $0.2536 |
| scene-rendering: mtek unconstrained | 55 | 37 / 18 / 0 | 67.3 % | 32,493 | 11,735 [8,789, 41,873] | 9,037 [8,652, 11,735] | 0.0 [0.0, 1.0] | 12.1 [9.2, 31.3] | $1.0963 |
| scene-rendering: mtek unconstrained+guide | 55 | 39 / 16 / 0 | 70.9 % | 45,711 | 14,507 [14,109, 63,212] | 14,276 [13,933, 14,583] | 0.0 [0.0, 0.0] | 11.3 [9.2, 28.0] | $1.4014 |
| scene-rendering: baseline unconstrained | 55 | 44 / 11 / 0 | 80.0 % | 16,414 | 5,274 [4,712, 19,158] | 4,963 [4,653, 6,982] | 0.0 [0.0, 0.3] | 13.8 [10.3, 37.0] | $0.9094 |
| shader-bridge: mtek unconstrained | 30 | 15 / 15 / 0 | 50.0 % | 44,838 | 25,051 [11,681, 29,565] | 11,661 [5,328, 19,339] | 1.0 [0.0, 1.0] | 24.3 [11.5, 27.3] | $0.5709 |
| shader-bridge: mtek unconstrained+guide | 30 | 30 / 0 / 0 | 100.0 % | 14,876 | 11,018 [10,767, 14,386] | 11,018 [10,767, 14,386] | 0.0 [0.0, 0.0] | 9.2 [8.5, 11.6] | $0.5265 |
| shader-bridge: baseline unconstrained | 30 | 30 / 0 / 0 | 100.0 % | 5,564 | 4,783 [4,606, 5,135] | 4,783 [4,606, 5,135] | 0.0 [0.0, 0.0] | 12.5 [10.8, 15.2] | $0.2678 |

### Per mode (cold authoring, edit)

| cell | attempts | completed / failed / not judged | completion rate | tokens per completed task | tokens per attempt, median [IQR] | tokens per completed attempt, median [IQR] | repairs per completed, median [IQR] | seconds per attempt, median [IQR] | cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cold: mtek unconstrained | 55 | 33 / 22 / 0 | 60.0 % | 44,437 | 19,422 [9,100, 43,659] | 9,185 [8,783, 19,255] | 0.0 [0.0, 1.0] | 18.5 [10.2, 31.5] | $1.2716 |
| cold: mtek unconstrained+guide | 55 | 39 / 16 / 0 | 70.9 % | 45,093 | 14,386 [14,154, 63,212] | 14,276 [14,107, 14,396] | 0.0 [0.0, 0.0] | 11.3 [9.5, 28.0] | $1.4323 |
| cold: baseline unconstrained | 55 | 44 / 11 / 0 | 80.0 % | 16,571 | 5,320 [4,783, 19,158] | 5,002 [4,721, 11,279] | 0.0 [0.0, 1.0] | 16.8 [11.3, 37.0] | $0.9166 |
| edit: mtek unconstrained | 115 | 86 / 29 / 0 | 74.8 % | 25,717 | 15,001 [5,730, 28,721] | 11,540 [5,570, 18,386] | 1.0 [0.0, 2.0] | 17.9 [9.9, 27.7] | $2.1754 |
| edit: mtek unconstrained+guide | 115 | 105 / 10 / 0 | 91.3 % | 23,610 | 11,315 [10,786, 23,189] | 11,195 [10,752, 22,847] | 0.0 [0.0, 1.0] | 11.6 [8.3, 20.4] | $2.3712 |
| edit: baseline unconstrained | 115 | 115 / 0 / 0 | 100.0 % | 6,679 | 4,968 [4,649, 5,310] | 4,968 [4,649, 5,310] | 0.0 [0.0, 0.0] | 14.6 [10.5, 21.6] | $1.1742 |

### Per task

| task | category | mode | mtek unconstrained | mtek unconstrained+guide | baseline unconstrained |
| --- | --- | --- | --- | --- | --- |
| interaction-01 | interaction | edit | 4/5 done, 22,953 tok/done, $0.0730 | 5/5 done, 10,636 tok/done, $0.0738 | 5/5 done, 4,639 tok/done, $0.0364 |
| interaction-02 | interaction | edit | 4/5 done, 41,836 tok/done, $0.1507 | 4/5 done, 54,556 tok/done, $0.1564 | 5/5 done, 12,955 tok/done, $0.0856 |
| interaction-03 | interaction | edit | 3/5 done, 63,781 tok/done, $0.1809 | 3/5 done, 74,024 tok/done, $0.1662 | 5/5 done, 10,454 tok/done, $0.0668 |
| interaction-04 | interaction | edit | 5/5 done, 15,164 tok/done, $0.0821 | 5/5 done, 44,878 tok/done, $0.1570 | 5/5 done, 6,087 tok/done, $0.0496 |
| interaction-05 | interaction | edit | 0/5 done, UNDEFINED tok/done, $0.1194 | 4/5 done, 32,544 tok/done, $0.1095 | 5/5 done, 11,170 tok/done, $0.0692 |
| interaction-06 | interaction | edit | 5/5 done, 5,225 tok/done, $0.0418 | 5/5 done, 10,688 tok/done, $0.0766 | 5/5 done, 6,703 tok/done, $0.0602 |
| interaction-07 | interaction | edit | 2/5 done, 119,660 tok/done, $0.2414 | 3/5 done, 47,038 tok/done, $0.1215 | 5/5 done, 6,687 tok/done, $0.0595 |
| interaction-08 | interaction | cold | 1/5 done, 242,369 tok/done, $0.1695 | 5/5 done, 14,153 tok/done, $0.0991 | 5/5 done, 4,762 tok/done, $0.0381 |
| interaction-09 | interaction | edit | 5/5 done, 25,644 tok/done, $0.1245 | 4/5 done, 47,363 tok/done, $0.1629 | 5/5 done, 8,373 tok/done, $0.0673 |
| interaction-10 | interaction | edit | 5/5 done, 24,772 tok/done, $0.1423 | 5/5 done, 22,830 tok/done, $0.1164 | 5/5 done, 6,415 tok/done, $0.0567 |
| interaction-11 | interaction | edit | 3/5 done, 50,322 tok/done, $0.1640 | 2/5 done, 96,884 tok/done, $0.1515 | 5/5 done, 8,426 tok/done, $0.0707 |
| maintenance-01 | maintenance | edit | 5/5 done, 4,871 tok/done, $0.0359 | 5/5 done, 10,299 tok/done, $0.0698 | 5/5 done, 4,307 tok/done, $0.0275 |
| maintenance-02 | maintenance | edit | 5/5 done, 5,992 tok/done, $0.0506 | 5/5 done, 11,262 tok/done, $0.0806 | 5/5 done, 4,742 tok/done, $0.0389 |
| maintenance-03 | maintenance | edit | 5/5 done, 13,188 tok/done, $0.0628 | 5/5 done, 17,325 tok/done, $0.0807 | 5/5 done, 4,458 tok/done, $0.0345 |
| maintenance-04 | maintenance | edit | 5/5 done, 5,666 tok/done, $0.0483 | 5/5 done, 18,275 tok/done, $0.0946 | 5/5 done, 7,038 tok/done, $0.0479 |
| maintenance-05 | maintenance | edit | 5/5 done, 5,595 tok/done, $0.0461 | 5/5 done, 10,980 tok/done, $0.0789 | 5/5 done, 4,818 tok/done, $0.0393 |
| maintenance-06 | maintenance | edit | 5/5 done, 6,033 tok/done, $0.0465 | 5/5 done, 11,445 tok/done, $0.0801 | 5/5 done, 9,579 tok/done, $0.0654 |
| scene-rendering-01 | scene-rendering | cold | 5/5 done, 12,382 tok/done, $0.0677 | 5/5 done, 13,757 tok/done, $0.0923 | 5/5 done, 4,242 tok/done, $0.0285 |
| scene-rendering-02 | scene-rendering | cold | 5/5 done, 8,696 tok/done, $0.0655 | 5/5 done, 14,124 tok/done, $0.0995 | 5/5 done, 4,622 tok/done, $0.0358 |
| scene-rendering-03 | scene-rendering | cold | 5/5 done, 9,271 tok/done, $0.0754 | 5/5 done, 14,506 tok/done, $0.1045 | 5/5 done, 7,764 tok/done, $0.0588 |
| scene-rendering-04 | scene-rendering | cold | 5/5 done, 8,808 tok/done, $0.0667 | 5/5 done, 14,155 tok/done, $0.0986 | 5/5 done, 5,035 tok/done, $0.0445 |
| scene-rendering-05 | scene-rendering | edit | 5/5 done, 15,072 tok/done, $0.0671 | 5/5 done, 20,501 tok/done, $0.0955 | 5/5 done, 4,935 tok/done, $0.0452 |
| scene-rendering-06 | scene-rendering | cold | 0/5 done, UNDEFINED tok/done, $0.1669 | 0/5 done, UNDEFINED tok/done, $0.1850 | 4/5 done, 23,374 tok/done, $0.1217 |
| scene-rendering-07 | scene-rendering | cold | 0/5 done, UNDEFINED tok/done, $0.1274 | 0/5 done, UNDEFINED tok/done, $0.1668 | 1/5 done, 149,960 tok/done, $0.1558 |
| scene-rendering-08 | scene-rendering | edit | 5/5 done, 5,110 tok/done, $0.0378 | 5/5 done, 12,823 tok/done, $0.0761 | 5/5 done, 4,649 tok/done, $0.0374 |
| scene-rendering-09 | scene-rendering | cold | 5/5 done, 11,801 tok/done, $0.0835 | 5/5 done, 14,338 tok/done, $0.1014 | 5/5 done, 5,279 tok/done, $0.0539 |
| scene-rendering-10 | scene-rendering | cold | 1/5 done, 196,140 tok/done, $0.1386 | 1/5 done, 285,779 tok/done, $0.1624 | 2/5 done, 72,233 tok/done, $0.1449 |
| scene-rendering-11 | scene-rendering | cold | 1/5 done, 207,102 tok/done, $0.1998 | 3/5 done, 113,438 tok/done, $0.2193 | 2/5 done, 75,840 tok/done, $0.1828 |
| shader-bridge-01 | shader-bridge | edit | 0/5 done, UNDEFINED tok/done, $0.0952 | 5/5 done, 12,768 tok/done, $0.0801 | 5/5 done, 4,626 tok/done, $0.0367 |
| shader-bridge-02 | shader-bridge | edit | 0/5 done, UNDEFINED tok/done, $0.1095 | 5/5 done, 15,666 tok/done, $0.0922 | 5/5 done, 5,188 tok/done, $0.0516 |
| shader-bridge-03 | shader-bridge | cold | 5/5 done, 24,543 tok/done, $0.1107 | 5/5 done, 14,349 tok/done, $0.1035 | 5/5 done, 6,196 tok/done, $0.0518 |
| shader-bridge-04 | shader-bridge | edit | 0/5 done, UNDEFINED tok/done, $0.1586 | 5/5 done, 15,547 tok/done, $0.0901 | 5/5 done, 5,933 tok/done, $0.0483 |
| shader-bridge-05 | shader-bridge | edit | 5/5 done, 5,302 tok/done, $0.0383 | 5/5 done, 10,841 tok/done, $0.0751 | 5/5 done, 6,861 tok/done, $0.0441 |
| shader-bridge-06 | shader-bridge | edit | 5/5 done, 12,989 tok/done, $0.0587 | 5/5 done, 20,084 tok/done, $0.0855 | 5/5 done, 4,580 tok/done, $0.0352 |

## Documentation given to the model

| side | largest documentation in bytes |
| --- | --- |
| baseline | 9,803 |
| mtek+guide | 37,513 |
| mtek | 22,638 |

## Attempts that could not be judged

None: every attempt ended in success or failure.

## Holdout (reported apart, by ids and layer outcomes only)

The holdout set is never used for design (decision 0021). These attempts are not in any aggregate above; no prompt, message or candidate text of the holdout appears here.

| attempt | side | outcome | reason | calls | repairs | tokens | cost | first attempt: parse/check/start/tests | final verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| holdout-01--unconstrained--00 | mtek | success |  | 2 | 1 | 19,590 | $0.0183 | fail/fail/not-run/not-run | pass |
| holdout-01--mtek-guide-unconstrained--00 | mtek | success |  | 1 | 0 | 13,906 | $0.0190 | pass/pass/pass/pass | pass |
| holdout-01--baseline-unconstrained--00 | baseline | success |  | 1 | 0 | 4,605 | $0.0073 | pass/pass/pass/pass | pass |
| holdout-02--unconstrained--00 | mtek | success |  | 2 | 1 | 18,707 | $0.0183 | pass/pass/pass/fail | pass |
| holdout-02--mtek-guide-unconstrained--00 | mtek | success |  | 1 | 0 | 14,222 | $0.0202 | pass/pass/pass/pass | pass |
| holdout-02--baseline-unconstrained--00 | baseline | success |  | 1 | 0 | 4,711 | $0.0074 | pass/pass/pass/pass | pass |
| holdout-03--unconstrained--00 | mtek | success |  | 1 | 0 | 9,047 | $0.0144 | pass/pass/pass/pass | pass |
| holdout-03--mtek-guide-unconstrained--00 | mtek | success |  | 1 | 0 | 14,211 | $0.0199 | pass/pass/pass/pass | pass |
| holdout-03--baseline-unconstrained--00 | baseline | success |  | 1 | 0 | 5,133 | $0.0093 | pass/pass/pass/pass | pass |
| holdout-04--unconstrained--00 | mtek | success |  | 2 | 1 | 20,509 | $0.0330 | pass/fail/not-run/not-run | pass |
| holdout-04--mtek-guide-unconstrained--00 | mtek | success |  | 1 | 0 | 11,853 | $0.0194 | pass/pass/pass/pass | pass |
| holdout-04--baseline-unconstrained--00 | baseline | success |  | 2 | 1 | 11,204 | $0.0177 | pass/fail/not-run/not-run | pass |
| holdout-05--unconstrained--00 | mtek | failure | max-repairs | 4 | 3 | 39,668 | $0.0347 | fail/fail/not-run/not-run | fail |
| holdout-05--mtek-guide-unconstrained--00 | mtek | success |  | 1 | 0 | 11,416 | $0.0188 | pass/pass/pass/pass | pass |
| holdout-05--baseline-unconstrained--00 | baseline | success |  | 1 | 0 | 5,204 | $0.0096 | pass/pass/pass/pass | pass |
| holdout-06--unconstrained--00 | mtek | failure | max-repairs | 4 | 3 | 30,865 | $0.0256 | pass/pass/pass/fail | fail |
| holdout-06--mtek-guide-unconstrained--00 | mtek | success |  | 2 | 1 | 22,128 | $0.0191 | pass/pass/pass/fail | pass |
| holdout-06--baseline-unconstrained--00 | baseline | success |  | 1 | 0 | 4,987 | $0.0086 | pass/pass/pass/pass | pass |
| holdout-07--unconstrained--00 | mtek | success |  | 2 | 1 | 12,776 | $0.0138 | pass/pass/pass/fail | pass |
| holdout-07--mtek-guide-unconstrained--00 | mtek | success |  | 2 | 1 | 24,455 | $0.0237 | pass/pass/pass/fail | pass |
| holdout-07--baseline-unconstrained--00 | baseline | success |  | 1 | 0 | 4,897 | $0.0085 | pass/pass/pass/pass | pass |
| holdout-08--unconstrained--00 | mtek | success |  | 1 | 0 | 5,183 | $0.0076 | pass/pass/pass/pass | pass |
| holdout-08--mtek-guide-unconstrained--00 | mtek | success |  | 1 | 0 | 10,637 | $0.0145 | pass/pass/pass/pass | pass |
| holdout-08--baseline-unconstrained--00 | baseline | success |  | 1 | 0 | 4,478 | $0.0070 | pass/pass/pass/pass | pass |
| holdout-01--unconstrained--01 | mtek | success |  | 1 | 0 | 8,546 | $0.0125 | pass/pass/pass/pass | pass |
| holdout-01--mtek-guide-unconstrained--01 | mtek | success |  | 1 | 0 | 13,896 | $0.0189 | pass/pass/pass/pass | pass |
| holdout-01--baseline-unconstrained--01 | baseline | success |  | 1 | 0 | 4,574 | $0.0071 | pass/pass/pass/pass | pass |
| holdout-02--unconstrained--01 | mtek | success |  | 1 | 0 | 8,852 | $0.0137 | pass/pass/pass/pass | pass |
| holdout-02--mtek-guide-unconstrained--01 | mtek | success |  | 1 | 0 | 13,973 | $0.0190 | pass/pass/pass/pass | pass |
| holdout-02--baseline-unconstrained--01 | baseline | success |  | 1 | 0 | 4,659 | $0.0072 | pass/pass/pass/pass | pass |
| holdout-03--unconstrained--01 | mtek | success |  | 2 | 1 | 18,808 | $0.0193 | none/none/none/none | pass |
| holdout-03--mtek-guide-unconstrained--01 | mtek | success |  | 1 | 0 | 14,541 | $0.0215 | pass/pass/pass/pass | pass |
| holdout-03--baseline-unconstrained--01 | baseline | success |  | 1 | 0 | 5,233 | $0.0098 | pass/pass/pass/pass | pass |
| holdout-04--unconstrained--01 | mtek | success |  | 2 | 1 | 13,305 | $0.0148 | pass/fail/not-run/not-run | pass |
| holdout-04--mtek-guide-unconstrained--01 | mtek | success |  | 3 | 2 | 41,763 | $0.0324 | pass/fail/not-run/not-run | pass |
| holdout-04--baseline-unconstrained--01 | baseline | success |  | 2 | 1 | 11,304 | $0.0181 | pass/fail/not-run/not-run | pass |
| holdout-05--unconstrained--01 | mtek | success |  | 4 | 3 | 35,459 | $0.0262 | fail/fail/not-run/not-run | pass |
| holdout-05--mtek-guide-unconstrained--01 | mtek | success |  | 1 | 0 | 11,332 | $0.0184 | pass/pass/pass/pass | pass |
| holdout-05--baseline-unconstrained--01 | baseline | success |  | 2 | 1 | 12,179 | $0.0228 | none/none/none/none | pass |
| holdout-06--unconstrained--01 | mtek | failure | max-repairs | 4 | 3 | 28,362 | $0.0217 | pass/pass/pass/fail | fail |
| holdout-06--mtek-guide-unconstrained--01 | mtek | success |  | 2 | 1 | 21,999 | $0.0187 | pass/pass/pass/fail | pass |
| holdout-06--baseline-unconstrained--01 | baseline | success |  | 1 | 0 | 4,918 | $0.0083 | pass/pass/pass/pass | pass |
| holdout-07--unconstrained--01 | mtek | success |  | 2 | 1 | 12,979 | $0.0147 | pass/pass/pass/fail | pass |
| holdout-07--mtek-guide-unconstrained--01 | mtek | success |  | 2 | 1 | 23,555 | $0.0213 | pass/pass/pass/fail | pass |
| holdout-07--baseline-unconstrained--01 | baseline | success |  | 1 | 0 | 5,253 | $0.0103 | pass/pass/pass/pass | pass |
| holdout-08--unconstrained--01 | mtek | success |  | 1 | 0 | 5,217 | $0.0078 | pass/pass/pass/pass | pass |
| holdout-08--mtek-guide-unconstrained--01 | mtek | success |  | 1 | 0 | 10,662 | $0.0147 | pass/pass/pass/pass | pass |
| holdout-08--baseline-unconstrained--01 | baseline | success |  | 1 | 0 | 4,424 | $0.0067 | pass/pass/pass/pass | pass |
| holdout-01--unconstrained--02 | mtek | success |  | 1 | 0 | 8,576 | $0.0127 | pass/pass/pass/pass | pass |
| holdout-01--mtek-guide-unconstrained--02 | mtek | success |  | 1 | 0 | 13,899 | $0.0190 | pass/pass/pass/pass | pass |
| holdout-01--baseline-unconstrained--02 | baseline | success |  | 1 | 0 | 4,487 | $0.0067 | pass/pass/pass/pass | pass |
| holdout-02--unconstrained--02 | mtek | success |  | 1 | 0 | 8,544 | $0.0122 | pass/pass/pass/pass | pass |
| holdout-02--mtek-guide-unconstrained--02 | mtek | success |  | 1 | 0 | 14,227 | $0.0202 | pass/pass/pass/pass | pass |
| holdout-02--baseline-unconstrained--02 | baseline | success |  | 1 | 0 | 4,876 | $0.0083 | pass/pass/pass/pass | pass |
| holdout-03--unconstrained--02 | mtek | success |  | 1 | 0 | 9,083 | $0.0146 | pass/pass/pass/pass | pass |
| holdout-03--mtek-guide-unconstrained--02 | mtek | success |  | 1 | 0 | 14,213 | $0.0199 | pass/pass/pass/pass | pass |
| holdout-03--baseline-unconstrained--02 | baseline | success |  | 1 | 0 | 5,007 | $0.0087 | pass/pass/pass/pass | pass |
| holdout-04--unconstrained--02 | mtek | success |  | 2 | 1 | 18,547 | $0.0292 | pass/fail/not-run/not-run | pass |
| holdout-04--mtek-guide-unconstrained--02 | mtek | success |  | 1 | 0 | 11,894 | $0.0197 | pass/pass/pass/pass | pass |
| holdout-04--baseline-unconstrained--02 | baseline | success |  | 2 | 1 | 11,273 | $0.0179 | pass/fail/not-run/not-run | pass |
| holdout-05--unconstrained--02 | mtek | success |  | 2 | 1 | 13,255 | $0.0160 | pass/fail/not-run/not-run | pass |
| holdout-05--mtek-guide-unconstrained--02 | mtek | success |  | 2 | 1 | 23,697 | $0.0255 | none/none/none/none | pass |
| holdout-05--baseline-unconstrained--02 | baseline | success |  | 3 | 2 | 19,228 | $0.0260 | none/none/none/none | pass |
| holdout-06--unconstrained--02 | mtek | failure | max-repairs | 4 | 3 | 27,125 | $0.0183 | pass/pass/pass/fail | fail |
| holdout-06--mtek-guide-unconstrained--02 | mtek | success |  | 2 | 1 | 21,980 | $0.0186 | pass/pass/pass/fail | pass |
| holdout-06--baseline-unconstrained--02 | baseline | success |  | 1 | 0 | 4,892 | $0.0082 | pass/pass/pass/pass | pass |
| holdout-07--unconstrained--02 | mtek | success |  | 1 | 0 | 5,849 | $0.0096 | pass/pass/pass/pass | pass |
| holdout-07--mtek-guide-unconstrained--02 | mtek | success |  | 2 | 1 | 23,718 | $0.0212 | pass/pass/pass/fail | pass |
| holdout-07--baseline-unconstrained--02 | baseline | success |  | 1 | 0 | 5,024 | $0.0091 | pass/pass/pass/pass | pass |
| holdout-08--unconstrained--02 | mtek | success |  | 1 | 0 | 5,166 | $0.0075 | pass/pass/pass/pass | pass |
| holdout-08--mtek-guide-unconstrained--02 | mtek | success |  | 1 | 0 | 10,648 | $0.0146 | pass/pass/pass/pass | pass |
| holdout-08--baseline-unconstrained--02 | baseline | success |  | 3 | 2 | 14,910 | $0.0110 | none/none/none/none | pass |
| holdout-01--unconstrained--03 | mtek | success |  | 1 | 0 | 8,644 | $0.0130 | pass/pass/pass/pass | pass |
| holdout-01--mtek-guide-unconstrained--03 | mtek | success |  | 1 | 0 | 13,884 | $0.0189 | pass/pass/pass/pass | pass |
| holdout-01--baseline-unconstrained--03 | baseline | success |  | 1 | 0 | 4,549 | $0.0070 | pass/pass/pass/pass | pass |
| holdout-02--unconstrained--03 | mtek | success |  | 1 | 0 | 8,815 | $0.0135 | pass/pass/pass/pass | pass |
| holdout-02--mtek-guide-unconstrained--03 | mtek | success |  | 1 | 0 | 14,230 | $0.0202 | pass/pass/pass/pass | pass |
| holdout-02--baseline-unconstrained--03 | baseline | success |  | 1 | 0 | 4,808 | $0.0079 | pass/pass/pass/pass | pass |
| holdout-03--unconstrained--03 | mtek | success |  | 1 | 0 | 8,990 | $0.0141 | pass/pass/pass/pass | pass |
| holdout-03--mtek-guide-unconstrained--03 | mtek | success |  | 1 | 0 | 14,492 | $0.0213 | pass/pass/pass/pass | pass |
| holdout-03--baseline-unconstrained--03 | baseline | success |  | 1 | 0 | 4,984 | $0.0085 | pass/pass/pass/pass | pass |
| holdout-04--unconstrained--03 | mtek | success |  | 3 | 2 | 25,248 | $0.0218 | pass/fail/not-run/not-run | pass |
| holdout-04--mtek-guide-unconstrained--03 | mtek | success |  | 3 | 2 | 39,414 | $0.0367 | none/none/none/none | pass |
| holdout-04--baseline-unconstrained--03 | baseline | success |  | 2 | 1 | 11,507 | $0.0187 | pass/fail/not-run/not-run | pass |
| holdout-05--unconstrained--03 | mtek | success |  | 2 | 1 | 13,270 | $0.0158 | pass/fail/not-run/not-run | pass |
| holdout-05--mtek-guide-unconstrained--03 | mtek | failure | max-repairs | 4 | 3 | 47,871 | $0.0285 | none/none/none/none | - |
| holdout-05--baseline-unconstrained--03 | baseline | success |  | 1 | 0 | 5,195 | $0.0096 | pass/pass/pass/pass | pass |
| holdout-06--unconstrained--03 | mtek | failure | max-repairs | 4 | 3 | 26,777 | $0.0200 | pass/pass/pass/fail | fail |
| holdout-06--mtek-guide-unconstrained--03 | mtek | success |  | 2 | 1 | 22,014 | $0.0188 | pass/pass/pass/fail | pass |
| holdout-06--baseline-unconstrained--03 | baseline | success |  | 1 | 0 | 4,866 | $0.0080 | pass/pass/pass/pass | pass |
| holdout-07--unconstrained--03 | mtek | success |  | 1 | 0 | 5,827 | $0.0095 | pass/pass/pass/pass | pass |
| holdout-07--mtek-guide-unconstrained--03 | mtek | success |  | 1 | 0 | 11,242 | $0.0163 | pass/pass/pass/pass | pass |
| holdout-07--baseline-unconstrained--03 | baseline | success |  | 1 | 0 | 4,987 | $0.0089 | pass/pass/pass/pass | pass |
| holdout-08--unconstrained--03 | mtek | success |  | 1 | 0 | 5,188 | $0.0076 | pass/pass/pass/pass | pass |
| holdout-08--mtek-guide-unconstrained--03 | mtek | success |  | 1 | 0 | 10,679 | $0.0148 | pass/pass/pass/pass | pass |
| holdout-08--baseline-unconstrained--03 | baseline | success |  | 1 | 0 | 4,532 | $0.0072 | pass/pass/pass/pass | pass |
| holdout-01--unconstrained--04 | mtek | success |  | 2 | 1 | 19,603 | $0.0184 | fail/fail/not-run/not-run | pass |
| holdout-01--mtek-guide-unconstrained--04 | mtek | success |  | 1 | 0 | 13,894 | $0.0189 | pass/pass/pass/pass | pass |
| holdout-01--baseline-unconstrained--04 | baseline | success |  | 1 | 0 | 4,576 | $0.0072 | pass/pass/pass/pass | pass |
| holdout-02--unconstrained--04 | mtek | success |  | 1 | 0 | 8,953 | $0.0142 | pass/pass/pass/pass | pass |
| holdout-02--mtek-guide-unconstrained--04 | mtek | success |  | 1 | 0 | 14,277 | $0.0205 | pass/pass/pass/pass | pass |
| holdout-02--baseline-unconstrained--04 | baseline | success |  | 1 | 0 | 4,767 | $0.0077 | pass/pass/pass/pass | pass |
| holdout-03--unconstrained--04 | mtek | success |  | 1 | 0 | 9,085 | $0.0146 | pass/pass/pass/pass | pass |
| holdout-03--mtek-guide-unconstrained--04 | mtek | success |  | 1 | 0 | 14,357 | $0.0206 | pass/pass/pass/pass | pass |
| holdout-03--baseline-unconstrained--04 | baseline | success |  | 1 | 0 | 5,158 | $0.0094 | pass/pass/pass/pass | pass |
| holdout-04--unconstrained--04 | mtek | success |  | 3 | 2 | 26,119 | $0.0305 | pass/fail/not-run/not-run | pass |
| holdout-04--mtek-guide-unconstrained--04 | mtek | success |  | 2 | 1 | 26,832 | $0.0276 | pass/fail/not-run/not-run | pass |
| holdout-04--baseline-unconstrained--04 | baseline | success |  | 4 | 3 | 24,691 | $0.0261 | none/none/none/none | pass |
| holdout-05--unconstrained--04 | mtek | success |  | 2 | 1 | 14,051 | $0.0176 | fail/fail/not-run/not-run | pass |
| holdout-05--mtek-guide-unconstrained--04 | mtek | success |  | 1 | 0 | 11,288 | $0.0181 | pass/pass/pass/pass | pass |
| holdout-05--baseline-unconstrained--04 | baseline | success |  | 3 | 2 | 19,456 | $0.0268 | none/none/none/none | pass |
| holdout-06--unconstrained--04 | mtek | failure | max-repairs | 4 | 3 | 28,463 | $0.0220 | pass/pass/pass/fail | fail |
| holdout-06--mtek-guide-unconstrained--04 | mtek | success |  | 2 | 1 | 22,008 | $0.0188 | pass/pass/pass/fail | pass |
| holdout-06--baseline-unconstrained--04 | baseline | success |  | 1 | 0 | 4,975 | $0.0086 | pass/pass/pass/pass | pass |
| holdout-07--unconstrained--04 | mtek | success |  | 2 | 1 | 12,892 | $0.0139 | pass/pass/pass/fail | pass |
| holdout-07--mtek-guide-unconstrained--04 | mtek | success |  | 2 | 1 | 23,654 | $0.0214 | pass/pass/pass/fail | pass |
| holdout-07--baseline-unconstrained--04 | baseline | success |  | 3 | 2 | 16,501 | $0.0133 | none/none/none/none | pass |
| holdout-08--unconstrained--04 | mtek | success |  | 1 | 0 | 5,208 | $0.0077 | pass/pass/pass/pass | pass |
| holdout-08--mtek-guide-unconstrained--04 | mtek | success |  | 1 | 0 | 10,639 | $0.0146 | pass/pass/pass/pass | pass |
| holdout-08--baseline-unconstrained--04 | baseline | success |  | 1 | 0 | 4,436 | $0.0067 | pass/pass/pass/pass | pass |

Holdout: 120 attempts, 113 completed, 7 failed, 0 not judged; 1,628,199 tokens, $1.9285.

## All attempts

| attempt | task | category | mode | side | kind | outcome | reason | calls | repairs | input | cache read | cache write | output | cost | seconds | first attempt parse/check/build/start/tests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| interaction-01--unconstrained--00 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 10,988 | 4,818 | 6,164 | 574 | $0.0111 | 21.1 | pass/fail/not-run/not-run/not-run |
| interaction-01--mtek-guide-unconstrained--00 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,246 | 0 | 10,243 | 441 | $0.0150 | 8.8 | pass/pass/pass/pass/pass |
| interaction-02--unconstrained--00 | interaction-02 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 34,163 | 22,837 | 11,314 | 2,728 | $0.0301 | 21.6 | fail/fail/not-run/not-run/not-run |
| interaction-02--mtek-guide-unconstrained--00 | interaction-02 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 51,154 | 35,397 | 15,745 | 2,980 | $0.0381 | 37.1 | fail/fail/not-run/not-run/not-run |
| interaction-03--unconstrained--00 | interaction-03 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 25,853 | 14,330 | 11,514 | 1,933 | $0.0255 | 18.6 | fail/fail/not-run/not-run/not-run |
| interaction-03--mtek-guide-unconstrained--00 | interaction-03 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,158 | 0 | 10,155 | 862 | $0.0170 | 18.3 | pass/pass/pass/pass/pass |
| interaction-04--unconstrained--00 | interaction-04 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 11,461 | 4,578 | 6,877 | 1,610 | $0.0171 | 26.1 | pass/fail/not-run/not-run/not-run |
| interaction-04--mtek-guide-unconstrained--00 | interaction-04 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 51,235 | 34,966 | 16,257 | 3,473 | $0.0412 | 66.4 | pass/fail/not-run/not-run/not-run |
| interaction-05--unconstrained--00 | interaction-05 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 27,431 | 18,624 | 8,795 | 1,250 | $0.0191 | 27.4 | pass/fail/not-run/not-run/not-run |
| interaction-05--mtek-guide-unconstrained--00 | interaction-05 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,172 | 0 | 10,169 | 912 | $0.0173 | 13.9 | pass/pass/pass/pass/pass |
| interaction-06--unconstrained--00 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 4,738 | 0 | 4,735 | 471 | $0.0083 | 16.8 | pass/pass/pass/pass/pass |
| interaction-06--mtek-guide-unconstrained--00 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,163 | 0 | 10,160 | 480 | $0.0151 | 20.5 | pass/pass/pass/pass/pass |
| interaction-07--unconstrained--00 | interaction-07 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 36,986 | 21,624 | 15,350 | 3,124 | $0.0370 | 28.5 | none/none/none/none/none |
| interaction-07--mtek-guide-unconstrained--00 | interaction-07 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 50,605 | 35,909 | 14,684 | 2,172 | $0.0328 | 58.5 | pass/pass/pass/pass/fail |
| interaction-08--unconstrained--00 | interaction-08 | interaction | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 40,508 | 28,221 | 12,275 | 1,957 | $0.0280 | 19.0 | none/none/none/none/none |
| interaction-08--mtek-guide-unconstrained--00 | interaction-08 | interaction | cold | mtek | unconstrained | success |  | 1 | 0 | 13,586 | 0 | 13,583 | 407 | $0.0190 | 17.4 | pass/pass/pass/pass/pass |
| interaction-09--unconstrained--00 | interaction-09 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 21,859 | 12,727 | 9,123 | 2,474 | $0.0251 | 29.4 | fail/fail/not-run/not-run/not-run |
| interaction-09--mtek-guide-unconstrained--00 | interaction-09 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 37,134 | 23,027 | 14,098 | 2,010 | $0.0300 | 22.8 | fail/fail/not-run/not-run/not-run |
| interaction-10--unconstrained--00 | interaction-10 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 13,657 | 4,831 | 8,820 | 2,187 | $0.0224 | 33.1 | pass/fail/not-run/not-run/not-run |
| interaction-10--mtek-guide-unconstrained--00 | interaction-10 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 41,322 | 24,393 | 16,920 | 2,388 | $0.0355 | 29.2 | fail/fail/not-run/not-run/not-run |
| interaction-11--unconstrained--00 | interaction-11 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 37,529 | 23,305 | 14,212 | 4,822 | $0.0442 | 62.7 | pass/pass/pass/pass/fail |
| interaction-11--mtek-guide-unconstrained--00 | interaction-11 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 52,273 | 36,368 | 15,893 | 3,565 | $0.0413 | 59.2 | pass/pass/pass/pass/fail |
| maintenance-01--unconstrained--00 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 4,582 | 0 | 4,579 | 269 | $0.0071 | 16.6 | pass/pass/pass/pass/pass |
| maintenance-01--mtek-guide-unconstrained--00 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,007 | 0 | 10,004 | 309 | $0.0141 | 11.3 | pass/pass/pass/pass/pass |
| maintenance-02--unconstrained--00 | maintenance-02 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,291 | 0 | 5,288 | 853 | $0.0109 | 14.2 | pass/pass/pass/pass/pass |
| maintenance-02--mtek-guide-unconstrained--00 | maintenance-02 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,716 | 0 | 10,713 | 270 | $0.0147 | 25.2 | pass/pass/pass/pass/pass |
| maintenance-03--unconstrained--00 | maintenance-03 | maintenance | edit | mtek | unconstrained | success |  | 3 | 2 | 16,826 | 10,378 | 6,439 | 592 | $0.0121 | 28.4 | none/none/none/none/none |
| maintenance-03--mtek-guide-unconstrained--00 | maintenance-03 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,281 | 0 | 10,278 | 315 | $0.0144 | 8.2 | pass/pass/pass/pass/pass |
| maintenance-04--unconstrained--00 | maintenance-04 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 4,977 | 0 | 4,974 | 465 | $0.0085 | 37.7 | pass/pass/pass/pass/pass |
| maintenance-04--mtek-guide-unconstrained--00 | maintenance-04 | maintenance | edit | mtek | unconstrained | success |  | 2 | 1 | 21,939 | 10,399 | 11,534 | 908 | $0.0200 | 49.0 | pass/pass/pass/pass/fail |
| maintenance-05--unconstrained--00 | maintenance-05 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,004 | 0 | 5,001 | 581 | $0.0092 | 17.7 | pass/pass/pass/pass/pass |
| maintenance-05--mtek-guide-unconstrained--00 | maintenance-05 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,429 | 0 | 10,426 | 646 | $0.0163 | 13.4 | pass/pass/pass/pass/pass |
| maintenance-06--unconstrained--00 | maintenance-06 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,561 | 0 | 5,558 | 432 | $0.0091 | 10.6 | pass/pass/pass/pass/pass |
| maintenance-06--mtek-guide-unconstrained--00 | maintenance-06 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,986 | 0 | 10,983 | 526 | $0.0164 | 9.9 | pass/pass/pass/pass/pass |
| scene-rendering-01--unconstrained--00 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 7,994 | 0 | 7,991 | 292 | $0.0115 | 9.5 | pass/pass/pass/pass/pass |
| scene-rendering-01--mtek-guide-unconstrained--00 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,419 | 0 | 13,416 | 415 | $0.0188 | 17.4 | pass/pass/pass/pass/pass |
| scene-rendering-02--unconstrained--00 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 8,103 | 0 | 8,100 | 565 | $0.0130 | 10.1 | pass/pass/pass/pass/pass |
| scene-rendering-02--mtek-guide-unconstrained--00 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,528 | 0 | 13,525 | 676 | $0.0203 | 14.9 | pass/pass/pass/pass/pass |
| scene-rendering-03--unconstrained--00 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 8,343 | 0 | 8,340 | 891 | $0.0149 | 15.4 | pass/pass/pass/pass/pass |
| scene-rendering-03--mtek-guide-unconstrained--00 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,768 | 0 | 13,765 | 640 | $0.0204 | 9.8 | pass/pass/pass/pass/pass |
| scene-rendering-04--unconstrained--00 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 8,188 | 0 | 8,185 | 629 | $0.0134 | 11.5 | pass/pass/pass/pass/pass |
| scene-rendering-04--mtek-guide-unconstrained--00 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,613 | 0 | 13,610 | 424 | $0.0191 | 29.8 | pass/pass/pass/pass/pass |
| scene-rendering-05--unconstrained--00 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | success |  | 3 | 2 | 18,777 | 11,369 | 7,399 | 957 | $0.0152 | 13.7 | fail/fail/not-run/not-run/not-run |
| scene-rendering-05--mtek-guide-unconstrained--00 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | success |  | 2 | 1 | 21,893 | 10,325 | 11,562 | 740 | $0.0192 | 11.4 | pass/fail/not-run/not-run/not-run |
| scene-rendering-06--unconstrained--00 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 40,906 | 28,990 | 11,904 | 2,228 | $0.0289 | 46.9 | pass/pass/pass/pass/fail |
| scene-rendering-06--mtek-guide-unconstrained--00 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 62,040 | 44,915 | 17,113 | 2,061 | $0.0362 | 41.9 | pass/pass/pass/pass/fail |
| scene-rendering-07--unconstrained--00 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 44,186 | 31,223 | 12,951 | 1,380 | $0.0262 | 47.8 | fail/fail/not-run/not-run/not-run |
| scene-rendering-07--mtek-guide-unconstrained--00 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 61,230 | 44,504 | 16,714 | 1,422 | $0.0325 | 49.9 | pass/pass/pass/pass/fail |
| scene-rendering-08--unconstrained--00 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 4,800 | 0 | 4,797 | 307 | $0.0075 | 11.9 | pass/pass/pass/pass/pass |
| scene-rendering-08--mtek-guide-unconstrained--00 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | success |  | 2 | 1 | 21,159 | 10,222 | 10,931 | 590 | $0.0176 | 12.5 | none/none/none/none/none |
| scene-rendering-09--unconstrained--00 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 8,285 | 0 | 8,282 | 959 | $0.0152 | 12.6 | pass/pass/pass/pass/pass |
| scene-rendering-09--mtek-guide-unconstrained--00 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,710 | 0 | 13,707 | 597 | $0.0201 | 11.3 | pass/pass/pass/pass/pass |
| scene-rendering-10--unconstrained--00 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 40,022 | 28,421 | 11,589 | 1,833 | $0.0265 | 36.0 | none/none/none/none/none |
| scene-rendering-10--mtek-guide-unconstrained--00 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 62,177 | 45,095 | 17,070 | 1,655 | $0.0341 | 42.8 | pass/pass/pass/pass/fail |
| scene-rendering-11--unconstrained--00 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | failure | generation-truncated | 1 | 0 | 8,453 | 0 | 8,450 | 4,000 | $0.0306 | 35.5 | none/none/none/none/none |
| scene-rendering-11--mtek-guide-unconstrained--00 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 69,560 | 49,198 | 20,350 | 3,449 | $0.0476 | 44.8 | pass/fail/not-run/not-run/not-run |
| shader-bridge-01--unconstrained--00 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 23,804 | 16,266 | 7,526 | 1,842 | $0.0203 | 31.5 | pass/pass/pass/pass/fail |
| shader-bridge-01--mtek-guide-unconstrained--00 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | success |  | 2 | 1 | 20,825 | 9,966 | 10,853 | 702 | $0.0181 | 25.4 | pass/pass/pass/pass/fail |
| shader-bridge-02--unconstrained--00 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 25,651 | 17,866 | 7,773 | 1,303 | $0.0180 | 33.5 | pass/pass/pass/pass/fail |
| shader-bridge-02--mtek-guide-unconstrained--00 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | success |  | 2 | 1 | 21,352 | 10,208 | 11,138 | 1,452 | $0.0222 | 23.3 | none/none/none/none/none |
| shader-bridge-03--unconstrained--00 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | success |  | 3 | 2 | 30,139 | 18,398 | 11,732 | 1,469 | $0.0239 | 25.6 | fail/fail/not-run/not-run/not-run |
| shader-bridge-03--mtek-guide-unconstrained--00 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | success |  | 1 | 0 | 13,614 | 0 | 13,611 | 741 | $0.0207 | 11.7 | pass/pass/pass/pass/pass |
| shader-bridge-04--unconstrained--00 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 31,783 | 20,709 | 11,062 | 2,218 | $0.0270 | 23.8 | pass/fail/not-run/not-run/not-run |
| shader-bridge-04--mtek-guide-unconstrained--00 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 10,178 | 0 | 10,175 | 623 | $0.0158 | 9.1 | pass/pass/pass/pass/pass |
| shader-bridge-05--unconstrained--00 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 5,026 | 0 | 5,023 | 255 | $0.0076 | 28.7 | pass/pass/pass/pass/pass |
| shader-bridge-05--mtek-guide-unconstrained--00 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 10,451 | 0 | 10,448 | 575 | $0.0159 | 18.5 | pass/pass/pass/pass/pass |
| shader-bridge-06--unconstrained--00 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | success |  | 3 | 2 | 17,392 | 10,752 | 6,631 | 1,024 | $0.0145 | 25.3 | none/none/none/none/none |
| shader-bridge-06--mtek-guide-unconstrained--00 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | success |  | 4 | 3 | 45,282 | 33,004 | 12,266 | 961 | $0.0234 | 17.7 | none/none/none/none/none |
| interaction-01--unconstrained--01 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 10,939 | 4,818 | 6,115 | 579 | $0.0110 | 15.0 | pass/fail/not-run/not-run/not-run |
| interaction-01--mtek-guide-unconstrained--01 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,246 | 0 | 10,243 | 460 | $0.0151 | 13.7 | pass/pass/pass/pass/pass |
| interaction-02--unconstrained--01 | interaction-02 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 35,558 | 23,166 | 12,380 | 3,439 | $0.0350 | 27.8 | fail/fail/not-run/not-run/not-run |
| interaction-02--mtek-guide-unconstrained--01 | interaction-02 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 35,305 | 21,954 | 13,342 | 2,017 | $0.0290 | 22.8 | fail/fail/not-run/not-run/not-run |
| interaction-03--unconstrained--01 | interaction-03 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 39,732 | 25,214 | 14,506 | 4,609 | $0.0437 | 33.7 | fail/fail/not-run/not-run/not-run |
| interaction-03--mtek-guide-unconstrained--01 | interaction-03 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 55,771 | 36,976 | 18,783 | 2,295 | $0.0387 | 21.4 | none/none/none/none/none |
| interaction-04--unconstrained--01 | interaction-04 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 11,705 | 4,578 | 7,121 | 1,843 | $0.0186 | 19.1 | pass/fail/not-run/not-run/not-run |
| interaction-04--mtek-guide-unconstrained--01 | interaction-04 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 20,816 | 10,003 | 10,807 | 1,101 | $0.0200 | 17.9 | none/none/none/none/none |
| interaction-05--unconstrained--01 | interaction-05 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 28,679 | 19,644 | 9,023 | 1,569 | $0.0211 | 23.6 | pass/fail/not-run/not-run/not-run |
| interaction-05--mtek-guide-unconstrained--01 | interaction-05 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 48,624 | 35,044 | 13,568 | 1,464 | $0.0278 | 25.8 | pass/fail/not-run/not-run/not-run |
| interaction-06--unconstrained--01 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 4,738 | 0 | 4,735 | 481 | $0.0083 | 10.0 | pass/pass/pass/pass/pass |
| interaction-06--mtek-guide-unconstrained--01 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,163 | 0 | 10,160 | 433 | $0.0149 | 8.5 | pass/pass/pass/pass/pass |
| interaction-07--unconstrained--01 | interaction-07 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 48,156 | 29,376 | 18,768 | 5,144 | $0.0521 | 44.7 | fail/fail/not-run/not-run/not-run |
| interaction-07--mtek-guide-unconstrained--01 | interaction-07 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,361 | 0 | 10,358 | 709 | $0.0165 | 14.4 | pass/pass/pass/pass/pass |
| interaction-08--unconstrained--01 | interaction-08 | interaction | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 48,908 | 31,413 | 17,483 | 3,443 | $0.0422 | 34.9 | fail/fail/not-run/not-run/not-run |
| interaction-08--mtek-guide-unconstrained--01 | interaction-08 | interaction | cold | mtek | unconstrained | success |  | 1 | 0 | 13,586 | 0 | 13,583 | 585 | $0.0199 | 20.0 | pass/pass/pass/pass/pass |
| interaction-09--unconstrained--01 | interaction-09 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 21,400 | 12,411 | 8,980 | 1,827 | $0.0216 | 34.7 | fail/fail/not-run/not-run/not-run |
| interaction-09--mtek-guide-unconstrained--01 | interaction-09 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 23,001 | 10,466 | 12,529 | 2,176 | $0.0276 | 20.7 | fail/fail/not-run/not-run/not-run |
| interaction-10--unconstrained--01 | interaction-10 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 13,515 | 4,831 | 8,678 | 2,000 | $0.0213 | 24.0 | pass/fail/not-run/not-run/not-run |
| interaction-10--mtek-guide-unconstrained--01 | interaction-10 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,259 | 0 | 10,256 | 885 | $0.0172 | 25.7 | pass/pass/pass/pass/pass |
| interaction-11--unconstrained--01 | interaction-11 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 39,850 | 25,672 | 14,166 | 5,169 | $0.0461 | 51.8 | pass/fail/not-run/not-run/not-run |
| interaction-11--mtek-guide-unconstrained--01 | interaction-11 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 48,841 | 34,577 | 14,252 | 2,490 | $0.0337 | 53.0 | none/none/none/none/none |
| maintenance-01--unconstrained--01 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 4,582 | 0 | 4,579 | 315 | $0.0073 | 10.2 | pass/pass/pass/pass/pass |
| maintenance-01--mtek-guide-unconstrained--01 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,007 | 0 | 10,004 | 290 | $0.0140 | 6.2 | pass/pass/pass/pass/pass |
| maintenance-02--unconstrained--01 | maintenance-02 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,291 | 0 | 5,288 | 754 | $0.0104 | 9.9 | pass/pass/pass/pass/pass |
| maintenance-02--mtek-guide-unconstrained--01 | maintenance-02 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,716 | 0 | 10,713 | 846 | $0.0176 | 10.9 | pass/pass/pass/pass/pass |
| maintenance-03--unconstrained--01 | maintenance-03 | maintenance | edit | mtek | unconstrained | success |  | 2 | 1 | 11,299 | 4,853 | 6,440 | 1,041 | $0.0137 | 17.8 | pass/fail/not-run/not-run/not-run |
| maintenance-03--mtek-guide-unconstrained--01 | maintenance-03 | maintenance | edit | mtek | unconstrained | success |  | 2 | 1 | 21,483 | 10,278 | 11,199 | 527 | $0.0177 | 20.0 | pass/pass/pass/pass/fail |
| maintenance-04--unconstrained--01 | maintenance-04 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 4,977 | 0 | 4,974 | 619 | $0.0093 | 10.5 | pass/pass/pass/pass/pass |
| maintenance-04--mtek-guide-unconstrained--01 | maintenance-04 | maintenance | edit | mtek | unconstrained | success |  | 2 | 1 | 22,155 | 10,399 | 11,750 | 1,048 | $0.0210 | 24.8 | pass/pass/pass/pass/fail |
| maintenance-05--unconstrained--01 | maintenance-05 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,004 | 0 | 5,001 | 566 | $0.0091 | 8.4 | pass/pass/pass/pass/pass |
| maintenance-05--mtek-guide-unconstrained--01 | maintenance-05 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,429 | 0 | 10,426 | 459 | $0.0153 | 11.6 | pass/pass/pass/pass/pass |
| maintenance-06--unconstrained--01 | maintenance-06 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,561 | 0 | 5,558 | 532 | $0.0096 | 9.5 | pass/pass/pass/pass/pass |
| maintenance-06--mtek-guide-unconstrained--01 | maintenance-06 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,986 | 0 | 10,983 | 444 | $0.0160 | 10.2 | pass/pass/pass/pass/pass |
| scene-rendering-01--unconstrained--01 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 7,994 | 0 | 7,991 | 438 | $0.0122 | 7.0 | pass/pass/pass/pass/pass |
| scene-rendering-01--mtek-guide-unconstrained--01 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,419 | 0 | 13,416 | 330 | $0.0184 | 6.2 | pass/pass/pass/pass/pass |
| scene-rendering-02--unconstrained--01 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 8,103 | 0 | 8,100 | 537 | $0.0128 | 8.7 | pass/pass/pass/pass/pass |
| scene-rendering-02--mtek-guide-unconstrained--01 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,528 | 0 | 13,525 | 580 | $0.0198 | 9.1 | pass/pass/pass/pass/pass |
| scene-rendering-03--unconstrained--01 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 8,343 | 0 | 8,340 | 874 | $0.0148 | 11.8 | pass/pass/pass/pass/pass |
| scene-rendering-03--mtek-guide-unconstrained--01 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,768 | 0 | 13,765 | 682 | $0.0206 | 10.0 | pass/pass/pass/pass/pass |
| scene-rendering-04--unconstrained--01 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 8,188 | 0 | 8,185 | 732 | $0.0139 | 10.4 | pass/pass/pass/pass/pass |
| scene-rendering-04--mtek-guide-unconstrained--01 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,613 | 0 | 13,610 | 493 | $0.0195 | 8.3 | pass/pass/pass/pass/pass |
| scene-rendering-05--unconstrained--01 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | success |  | 2 | 1 | 11,121 | 4,900 | 6,215 | 815 | $0.0123 | 9.5 | pass/fail/not-run/not-run/not-run |
| scene-rendering-05--mtek-guide-unconstrained--01 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 10,328 | 0 | 10,325 | 762 | $0.0167 | 10.1 | pass/pass/pass/pass/pass |
| scene-rendering-06--unconstrained--01 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 43,780 | 30,737 | 13,031 | 2,763 | $0.0332 | 39.5 | fail/fail/not-run/not-run/not-run |
| scene-rendering-06--mtek-guide-unconstrained--01 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 61,514 | 44,487 | 17,015 | 1,707 | $0.0343 | 35.9 | pass/pass/pass/pass/fail |
| scene-rendering-07--unconstrained--01 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 40,326 | 28,741 | 11,573 | 1,564 | $0.0252 | 42.7 | pass/pass/pass/pass/fail |
| scene-rendering-07--mtek-guide-unconstrained--01 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 61,703 | 44,846 | 16,845 | 1,540 | $0.0333 | 32.8 | pass/pass/pass/pass/fail |
| scene-rendering-08--unconstrained--01 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 4,800 | 0 | 4,797 | 326 | $0.0076 | 12.0 | pass/pass/pass/pass/pass |
| scene-rendering-08--mtek-guide-unconstrained--01 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 10,225 | 0 | 10,222 | 332 | $0.0144 | 6.1 | pass/pass/pass/pass/pass |
| scene-rendering-09--unconstrained--01 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 8,285 | 0 | 8,282 | 878 | $0.0147 | 19.8 | pass/pass/pass/pass/pass |
| scene-rendering-09--mtek-guide-unconstrained--01 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,710 | 0 | 13,707 | 676 | $0.0205 | 14.7 | pass/pass/pass/pass/pass |
| scene-rendering-10--unconstrained--01 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 40,520 | 28,520 | 11,988 | 2,684 | $0.0313 | 42.6 | none/none/none/none/none |
| scene-rendering-10--mtek-guide-unconstrained--01 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | success |  | 2 | 1 | 29,261 | 13,847 | 15,408 | 1,276 | $0.0270 | 28.5 | pass/pass/pass/pass/fail |
| scene-rendering-11--unconstrained--01 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 57,877 | 38,345 | 19,520 | 3,343 | $0.0450 | 31.1 | fail/fail/not-run/not-run/not-run |
| scene-rendering-11--mtek-guide-unconstrained--01 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | success |  | 3 | 2 | 50,145 | 31,200 | 18,936 | 2,429 | $0.0389 | 31.4 | pass/fail/not-run/not-run/not-run |
| shader-bridge-01--unconstrained--01 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 23,727 | 16,294 | 7,421 | 1,615 | $0.0190 | 24.4 | pass/pass/pass/pass/fail |
| shader-bridge-01--mtek-guide-unconstrained--01 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 9,969 | 0 | 9,966 | 575 | $0.0153 | 8.2 | pass/pass/pass/pass/pass |
| shader-bridge-02--unconstrained--01 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 28,405 | 18,903 | 9,490 | 2,289 | $0.0252 | 31.6 | pass/pass/pass/pass/fail |
| shader-bridge-02--mtek-guide-unconstrained--01 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 10,211 | 0 | 10,208 | 849 | $0.0170 | 11.2 | pass/pass/pass/pass/pass |
| shader-bridge-03--unconstrained--01 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | success |  | 3 | 2 | 29,575 | 18,334 | 11,232 | 1,606 | $0.0239 | 24.4 | fail/fail/not-run/not-run/not-run |
| shader-bridge-03--mtek-guide-unconstrained--01 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | success |  | 1 | 0 | 13,614 | 0 | 13,611 | 779 | $0.0209 | 11.0 | pass/pass/pass/pass/pass |
| shader-bridge-04--unconstrained--01 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 34,269 | 22,539 | 11,718 | 2,335 | $0.0286 | 24.3 | pass/fail/not-run/not-run/not-run |
| shader-bridge-04--mtek-guide-unconstrained--01 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | success |  | 2 | 1 | 21,139 | 10,175 | 10,958 | 1,107 | $0.0203 | 11.7 | none/none/none/none/none |
| shader-bridge-05--unconstrained--01 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 5,026 | 0 | 5,023 | 297 | $0.0078 | 6.9 | pass/pass/pass/pass/pass |
| shader-bridge-05--mtek-guide-unconstrained--01 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 10,451 | 0 | 10,448 | 301 | $0.0146 | 7.1 | pass/pass/pass/pass/pass |
| shader-bridge-06--unconstrained--01 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | success |  | 2 | 1 | 11,093 | 4,976 | 6,111 | 649 | $0.0114 | 10.8 | pass/fail/not-run/not-run/not-run |
| shader-bridge-06--mtek-guide-unconstrained--01 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 10,404 | 0 | 10,401 | 327 | $0.0146 | 8.9 | pass/pass/pass/pass/pass |
| interaction-01--unconstrained--02 | interaction-01 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 26,809 | 17,895 | 8,902 | 1,426 | $0.0201 | 16.1 | none/none/none/none/none |
| interaction-01--mtek-guide-unconstrained--02 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,246 | 0 | 10,243 | 332 | $0.0145 | 7.0 | pass/pass/pass/pass/pass |
| interaction-02--unconstrained--02 | interaction-02 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 33,921 | 22,389 | 11,520 | 2,917 | $0.0312 | 26.0 | fail/fail/not-run/not-run/not-run |
| interaction-02--mtek-guide-unconstrained--02 | interaction-02 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 35,010 | 21,989 | 13,012 | 1,449 | $0.0257 | 21.6 | fail/fail/not-run/not-run/not-run |
| interaction-03--unconstrained--02 | interaction-03 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 40,450 | 26,123 | 14,315 | 4,612 | $0.0436 | 28.2 | fail/fail/not-run/not-run/not-run |
| interaction-03--mtek-guide-unconstrained--02 | interaction-03 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 37,113 | 22,492 | 14,612 | 2,297 | $0.0320 | 24.7 | fail/fail/not-run/not-run/not-run |
| interaction-04--unconstrained--02 | interaction-04 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 16,765 | 9,909 | 6,847 | 1,532 | $0.0172 | 17.9 | none/none/none/none/none |
| interaction-04--mtek-guide-unconstrained--02 | interaction-04 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 44,892 | 32,066 | 12,814 | 2,546 | $0.0320 | 25.1 | none/none/none/none/none |
| interaction-05--unconstrained--02 | interaction-05 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 29,545 | 20,022 | 9,511 | 2,473 | $0.0263 | 29.6 | none/none/none/none/none |
| interaction-05--mtek-guide-unconstrained--02 | interaction-05 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 21,406 | 10,169 | 11,231 | 1,293 | $0.0215 | 13.5 | none/none/none/none/none |
| interaction-06--unconstrained--02 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 4,738 | 0 | 4,735 | 538 | $0.0086 | 10.0 | pass/pass/pass/pass/pass |
| interaction-06--mtek-guide-unconstrained--02 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,163 | 0 | 10,160 | 398 | $0.0147 | 8.0 | pass/pass/pass/pass/pass |
| interaction-07--unconstrained--02 | interaction-07 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 39,604 | 23,727 | 15,865 | 4,624 | $0.0453 | 45.8 | none/none/none/none/none |
| interaction-07--mtek-guide-unconstrained--02 | interaction-07 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,361 | 0 | 10,358 | 869 | $0.0173 | 13.0 | pass/pass/pass/pass/pass |
| interaction-08--unconstrained--02 | interaction-08 | interaction | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 44,327 | 30,351 | 13,964 | 2,487 | $0.0329 | 19.2 | fail/fail/not-run/not-run/not-run |
| interaction-08--mtek-guide-unconstrained--02 | interaction-08 | interaction | cold | mtek | unconstrained | success |  | 1 | 0 | 13,586 | 0 | 13,583 | 566 | $0.0198 | 9.3 | pass/pass/pass/pass/pass |
| interaction-09--unconstrained--02 | interaction-09 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 21,649 | 12,524 | 9,116 | 1,927 | $0.0223 | 23.9 | fail/fail/not-run/not-run/not-run |
| interaction-09--mtek-guide-unconstrained--02 | interaction-09 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 37,148 | 23,046 | 14,093 | 2,005 | $0.0300 | 21.6 | fail/fail/not-run/not-run/not-run |
| interaction-10--unconstrained--02 | interaction-10 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 39,657 | 22,538 | 17,107 | 3,830 | $0.0428 | 37.7 | none/none/none/none/none |
| interaction-10--mtek-guide-unconstrained--02 | interaction-10 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 21,795 | 10,256 | 11,533 | 1,348 | $0.0222 | 17.3 | none/none/none/none/none |
| interaction-11--unconstrained--02 | interaction-11 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 12,395 | 4,868 | 7,521 | 2,606 | $0.0229 | 31.5 | pass/pass/pass/pass/fail |
| interaction-11--mtek-guide-unconstrained--02 | interaction-11 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,296 | 0 | 10,293 | 962 | $0.0177 | 14.1 | pass/pass/pass/pass/pass |
| maintenance-01--unconstrained--02 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 4,582 | 0 | 4,579 | 277 | $0.0071 | 5.7 | pass/pass/pass/pass/pass |
| maintenance-01--mtek-guide-unconstrained--02 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,007 | 0 | 10,004 | 290 | $0.0140 | 5.4 | pass/pass/pass/pass/pass |
| maintenance-02--unconstrained--02 | maintenance-02 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,291 | 0 | 5,288 | 740 | $0.0103 | 7.7 | pass/pass/pass/pass/pass |
| maintenance-02--mtek-guide-unconstrained--02 | maintenance-02 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,716 | 0 | 10,713 | 479 | $0.0158 | 8.1 | pass/pass/pass/pass/pass |
| maintenance-03--unconstrained--02 | maintenance-03 | maintenance | edit | mtek | unconstrained | success |  | 2 | 1 | 10,721 | 4,853 | 5,862 | 449 | $0.0101 | 9.0 | pass/fail/not-run/not-run/not-run |
| maintenance-03--mtek-guide-unconstrained--02 | maintenance-03 | maintenance | edit | mtek | unconstrained | success |  | 2 | 1 | 21,248 | 10,278 | 10,964 | 473 | $0.0171 | 8.3 | none/none/none/none/none |
| maintenance-04--unconstrained--02 | maintenance-04 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 4,977 | 0 | 4,974 | 633 | $0.0094 | 10.8 | pass/pass/pass/pass/pass |
| maintenance-04--mtek-guide-unconstrained--02 | maintenance-04 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,402 | 0 | 10,399 | 812 | $0.0171 | 10.9 | pass/pass/pass/pass/pass |
| maintenance-05--unconstrained--02 | maintenance-05 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,004 | 0 | 5,001 | 572 | $0.0091 | 8.3 | pass/pass/pass/pass/pass |
| maintenance-05--mtek-guide-unconstrained--02 | maintenance-05 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,429 | 0 | 10,426 | 554 | $0.0158 | 6.7 | pass/pass/pass/pass/pass |
| maintenance-06--unconstrained--02 | maintenance-06 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,561 | 0 | 5,558 | 420 | $0.0091 | 7.9 | pass/pass/pass/pass/pass |
| maintenance-06--mtek-guide-unconstrained--02 | maintenance-06 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,986 | 0 | 10,983 | 427 | $0.0159 | 8.1 | pass/pass/pass/pass/pass |
| scene-rendering-01--unconstrained--02 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 7,994 | 0 | 7,991 | 428 | $0.0121 | 7.3 | pass/pass/pass/pass/pass |
| scene-rendering-01--mtek-guide-unconstrained--02 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,419 | 0 | 13,416 | 274 | $0.0181 | 6.0 | pass/pass/pass/pass/pass |
| scene-rendering-02--unconstrained--02 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 8,103 | 0 | 8,100 | 680 | $0.0135 | 8.9 | pass/pass/pass/pass/pass |
| scene-rendering-02--mtek-guide-unconstrained--02 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,528 | 0 | 13,525 | 503 | $0.0194 | 8.3 | pass/pass/pass/pass/pass |
| scene-rendering-03--unconstrained--02 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 8,343 | 0 | 8,340 | 1,106 | $0.0160 | 12.2 | pass/pass/pass/pass/pass |
| scene-rendering-03--mtek-guide-unconstrained--02 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,768 | 0 | 13,765 | 888 | $0.0216 | 10.3 | pass/pass/pass/pass/pass |
| scene-rendering-04--unconstrained--02 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 8,188 | 0 | 8,185 | 469 | $0.0126 | 7.1 | pass/pass/pass/pass/pass |
| scene-rendering-04--mtek-guide-unconstrained--02 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,613 | 0 | 13,610 | 635 | $0.0202 | 9.6 | pass/pass/pass/pass/pass |
| scene-rendering-05--unconstrained--02 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | success |  | 3 | 2 | 18,823 | 11,384 | 7,430 | 992 | $0.0154 | 12.1 | fail/fail/not-run/not-run/not-run |
| scene-rendering-05--mtek-guide-unconstrained--02 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | success |  | 2 | 1 | 22,217 | 10,325 | 11,886 | 768 | $0.0197 | 10.7 | fail/fail/not-run/not-run/not-run |
| scene-rendering-06--unconstrained--02 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 41,627 | 29,527 | 12,088 | 2,486 | $0.0305 | 33.1 | pass/pass/pass/pass/fail |
| scene-rendering-06--mtek-guide-unconstrained--02 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 62,868 | 45,484 | 17,372 | 2,436 | $0.0385 | 37.2 | pass/pass/pass/pass/fail |
| scene-rendering-07--unconstrained--02 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 38,800 | 27,697 | 11,091 | 1,632 | $0.0248 | 24.3 | none/none/none/none/none |
| scene-rendering-07--mtek-guide-unconstrained--02 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 61,671 | 44,792 | 16,867 | 1,532 | $0.0332 | 25.0 | pass/pass/pass/pass/fail |
| scene-rendering-08--unconstrained--02 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 4,800 | 0 | 4,797 | 307 | $0.0075 | 5.1 | pass/pass/pass/pass/pass |
| scene-rendering-08--mtek-guide-unconstrained--02 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 10,225 | 0 | 10,222 | 360 | $0.0146 | 6.2 | pass/pass/pass/pass/pass |
| scene-rendering-09--unconstrained--02 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 8,285 | 0 | 8,282 | 880 | $0.0148 | 11.5 | pass/pass/pass/pass/pass |
| scene-rendering-09--mtek-guide-unconstrained--02 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,710 | 0 | 13,707 | 588 | $0.0201 | 9.3 | pass/pass/pass/pass/pass |
| scene-rendering-10--unconstrained--02 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 46,565 | 32,591 | 13,962 | 2,166 | $0.0316 | 31.6 | fail/fail/not-run/not-run/not-run |
| scene-rendering-10--mtek-guide-unconstrained--02 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 62,245 | 45,165 | 17,068 | 1,554 | $0.0336 | 18.6 | pass/pass/pass/pass/fail |
| scene-rendering-11--unconstrained--02 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | success |  | 4 | 3 | 56,882 | 36,611 | 20,259 | 3,708 | $0.0475 | 38.7 | fail/fail/not-run/not-run/not-run |
| scene-rendering-11--mtek-guide-unconstrained--02 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | success |  | 4 | 3 | 68,049 | 47,933 | 20,104 | 2,832 | $0.0441 | 26.0 | none/none/none/none/none |
| shader-bridge-01--unconstrained--02 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 24,349 | 16,659 | 7,678 | 1,854 | $0.0205 | 25.9 | pass/pass/pass/pass/fail |
| shader-bridge-01--mtek-guide-unconstrained--02 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 9,969 | 0 | 9,966 | 654 | $0.0157 | 9.1 | pass/pass/pass/pass/pass |
| shader-bridge-02--unconstrained--02 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 27,178 | 18,153 | 9,013 | 1,420 | $0.0202 | 24.2 | pass/pass/pass/pass/fail |
| shader-bridge-02--mtek-guide-unconstrained--02 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | success |  | 2 | 1 | 21,600 | 10,208 | 11,386 | 826 | $0.0194 | 13.0 | pass/pass/pass/pass/fail |
| shader-bridge-03--unconstrained--02 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | success |  | 2 | 1 | 18,214 | 8,186 | 10,022 | 1,208 | $0.0194 | 13.4 | fail/fail/not-run/not-run/not-run |
| shader-bridge-03--mtek-guide-unconstrained--02 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | success |  | 1 | 0 | 13,614 | 0 | 13,611 | 660 | $0.0203 | 9.2 | pass/pass/pass/pass/pass |
| shader-bridge-04--unconstrained--02 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 38,778 | 24,794 | 13,972 | 4,027 | $0.0401 | 35.1 | fail/fail/not-run/not-run/not-run |
| shader-bridge-04--mtek-guide-unconstrained--02 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 10,178 | 0 | 10,175 | 551 | $0.0155 | 8.4 | pass/pass/pass/pass/pass |
| shader-bridge-05--unconstrained--02 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 5,026 | 0 | 5,023 | 254 | $0.0076 | 6.7 | pass/pass/pass/pass/pass |
| shader-bridge-05--mtek-guide-unconstrained--02 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 10,451 | 0 | 10,448 | 371 | $0.0149 | 7.9 | pass/pass/pass/pass/pass |
| shader-bridge-06--unconstrained--02 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | success |  | 2 | 1 | 11,056 | 4,976 | 6,074 | 605 | $0.0111 | 10.4 | pass/fail/not-run/not-run/not-run |
| shader-bridge-06--mtek-guide-unconstrained--02 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 10,404 | 0 | 10,401 | 357 | $0.0148 | 7.6 | pass/pass/pass/pass/pass |
| interaction-01--unconstrained--03 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 11,865 | 4,818 | 7,041 | 800 | $0.0133 | 11.9 | fail/fail/not-run/not-run/not-run |
| interaction-01--mtek-guide-unconstrained--03 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,246 | 0 | 10,243 | 327 | $0.0144 | 7.0 | pass/pass/pass/pass/pass |
| interaction-02--unconstrained--03 | interaction-02 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 13,385 | 4,689 | 8,690 | 2,220 | $0.0224 | 22.8 | pass/fail/not-run/not-run/not-run |
| interaction-02--mtek-guide-unconstrained--03 | interaction-02 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 50,887 | 35,237 | 15,638 | 2,392 | $0.0350 | 19.6 | fail/fail/not-run/not-run/not-run |
| interaction-03--unconstrained--03 | interaction-03 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 36,423 | 23,772 | 12,639 | 3,297 | $0.0347 | 26.9 | pass/fail/not-run/not-run/not-run |
| interaction-03--mtek-guide-unconstrained--03 | interaction-03 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 54,372 | 37,060 | 17,300 | 3,659 | $0.0436 | 31.5 | fail/fail/not-run/not-run/not-run |
| interaction-04--unconstrained--03 | interaction-04 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 17,934 | 10,761 | 7,164 | 1,248 | $0.0163 | 19.9 | pass/fail/not-run/not-run/not-run |
| interaction-04--mtek-guide-unconstrained--03 | interaction-04 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 48,599 | 33,057 | 15,530 | 2,132 | $0.0334 | 22.9 | none/none/none/none/none |
| interaction-05--unconstrained--03 | interaction-05 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 33,156 | 21,161 | 11,983 | 2,350 | $0.0289 | 25.1 | fail/fail/not-run/not-run/not-run |
| interaction-05--mtek-guide-unconstrained--03 | interaction-05 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 22,041 | 10,169 | 11,866 | 1,101 | $0.0214 | 13.3 | pass/fail/not-run/not-run/not-run |
| interaction-06--unconstrained--03 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 4,738 | 0 | 4,735 | 499 | $0.0084 | 10.1 | pass/pass/pass/pass/pass |
| interaction-06--mtek-guide-unconstrained--03 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,163 | 0 | 10,160 | 558 | $0.0155 | 10.2 | pass/pass/pass/pass/pass |
| interaction-07--unconstrained--03 | interaction-07 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 46,006 | 29,077 | 16,917 | 4,285 | $0.0455 | 45.1 | fail/fail/not-run/not-run/not-run |
| interaction-07--mtek-guide-unconstrained--03 | interaction-07 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,361 | 0 | 10,358 | 954 | $0.0177 | 14.1 | pass/pass/pass/pass/pass |
| interaction-08--unconstrained--03 | interaction-08 | interaction | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 48,318 | 32,843 | 15,463 | 2,070 | $0.0330 | 17.6 | fail/fail/not-run/not-run/not-run |
| interaction-08--mtek-guide-unconstrained--03 | interaction-08 | interaction | cold | mtek | unconstrained | success |  | 1 | 0 | 13,586 | 0 | 13,583 | 774 | $0.0209 | 11.1 | pass/pass/pass/pass/pass |
| interaction-09--unconstrained--03 | interaction-09 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 26,344 | 14,579 | 11,756 | 2,416 | $0.0282 | 27.6 | fail/fail/not-run/not-run/not-run |
| interaction-09--mtek-guide-unconstrained--03 | interaction-09 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 54,074 | 37,415 | 16,647 | 3,890 | $0.0440 | 42.5 | fail/fail/not-run/not-run/not-run |
| interaction-10--unconstrained--03 | interaction-10 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 14,641 | 4,831 | 9,804 | 2,144 | $0.0235 | 23.3 | pass/fail/not-run/not-run/not-run |
| interaction-10--mtek-guide-unconstrained--03 | interaction-10 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 23,746 | 10,256 | 13,484 | 1,297 | $0.0244 | 15.7 | pass/fail/not-run/not-run/not-run |
| interaction-11--unconstrained--03 | interaction-11 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 22,966 | 13,308 | 9,649 | 2,760 | $0.0272 | 35.1 | pass/fail/not-run/not-run/not-run |
| interaction-11--mtek-guide-unconstrained--03 | interaction-11 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 22,354 | 10,293 | 12,055 | 1,227 | $0.0222 | 17.4 | pass/fail/not-run/not-run/not-run |
| maintenance-01--unconstrained--03 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 4,582 | 0 | 4,579 | 290 | $0.0072 | 6.1 | pass/pass/pass/pass/pass |
| maintenance-01--mtek-guide-unconstrained--03 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,007 | 0 | 10,004 | 290 | $0.0140 | 5.1 | pass/pass/pass/pass/pass |
| maintenance-02--unconstrained--03 | maintenance-02 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,291 | 0 | 5,288 | 517 | $0.0092 | 7.0 | pass/pass/pass/pass/pass |
| maintenance-02--mtek-guide-unconstrained--03 | maintenance-02 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,716 | 0 | 10,713 | 482 | $0.0158 | 8.3 | pass/pass/pass/pass/pass |
| maintenance-03--unconstrained--03 | maintenance-03 | maintenance | edit | mtek | unconstrained | success |  | 2 | 1 | 11,450 | 4,853 | 6,591 | 1,175 | $0.0146 | 17.7 | pass/fail/not-run/not-run/not-run |
| maintenance-03--mtek-guide-unconstrained--03 | maintenance-03 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,281 | 0 | 10,278 | 330 | $0.0145 | 7.2 | pass/pass/pass/pass/pass |
| maintenance-04--unconstrained--03 | maintenance-04 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 4,977 | 0 | 4,974 | 593 | $0.0092 | 9.7 | pass/pass/pass/pass/pass |
| maintenance-04--mtek-guide-unconstrained--03 | maintenance-04 | maintenance | edit | mtek | unconstrained | success |  | 2 | 1 | 22,139 | 10,399 | 11,734 | 998 | $0.0207 | 16.1 | pass/pass/pass/pass/fail |
| maintenance-05--unconstrained--03 | maintenance-05 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,004 | 0 | 5,001 | 590 | $0.0092 | 8.6 | pass/pass/pass/pass/pass |
| maintenance-05--mtek-guide-unconstrained--03 | maintenance-05 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,429 | 0 | 10,426 | 607 | $0.0161 | 7.6 | pass/pass/pass/pass/pass |
| maintenance-06--unconstrained--03 | maintenance-06 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,561 | 0 | 5,558 | 503 | $0.0095 | 8.8 | pass/pass/pass/pass/pass |
| maintenance-06--mtek-guide-unconstrained--03 | maintenance-06 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,986 | 0 | 10,983 | 435 | $0.0159 | 8.1 | pass/pass/pass/pass/pass |
| scene-rendering-01--unconstrained--03 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 2 | 1 | 17,791 | 7,991 | 9,794 | 565 | $0.0159 | 9.1 | fail/fail/not-run/not-run/not-run |
| scene-rendering-01--mtek-guide-unconstrained--03 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,419 | 0 | 13,416 | 286 | $0.0182 | 5.9 | pass/pass/pass/pass/pass |
| scene-rendering-02--unconstrained--03 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 8,103 | 0 | 8,100 | 549 | $0.0129 | 9.0 | pass/pass/pass/pass/pass |
| scene-rendering-02--mtek-guide-unconstrained--03 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,528 | 0 | 13,525 | 595 | $0.0199 | 9.1 | pass/pass/pass/pass/pass |
| scene-rendering-03--unconstrained--03 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 8,343 | 0 | 8,340 | 694 | $0.0139 | 9.0 | pass/pass/pass/pass/pass |
| scene-rendering-03--mtek-guide-unconstrained--03 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,768 | 0 | 13,765 | 742 | $0.0209 | 9.4 | pass/pass/pass/pass/pass |
| scene-rendering-04--unconstrained--03 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 8,188 | 0 | 8,185 | 665 | $0.0136 | 9.8 | pass/pass/pass/pass/pass |
| scene-rendering-04--mtek-guide-unconstrained--03 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,613 | 0 | 13,610 | 663 | $0.0203 | 10.2 | pass/pass/pass/pass/pass |
| scene-rendering-05--unconstrained--03 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | success |  | 2 | 1 | 11,352 | 4,900 | 6,446 | 787 | $0.0125 | 9.5 | fail/fail/not-run/not-run/not-run |
| scene-rendering-05--mtek-guide-unconstrained--03 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | success |  | 2 | 1 | 21,886 | 10,325 | 11,555 | 815 | $0.0196 | 11.1 | pass/fail/not-run/not-run/not-run |
| scene-rendering-06--unconstrained--03 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 45,353 | 31,835 | 13,506 | 3,454 | $0.0373 | 38.7 | pass/pass/pass/pass/fail |
| scene-rendering-06--mtek-guide-unconstrained--03 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 62,483 | 45,145 | 17,326 | 2,291 | $0.0376 | 32.6 | pass/pass/pass/pass/fail |
| scene-rendering-07--unconstrained--03 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 40,338 | 28,876 | 11,450 | 1,369 | $0.0241 | 26.6 | pass/pass/pass/pass/fail |
| scene-rendering-07--mtek-guide-unconstrained--03 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 59,321 | 43,305 | 16,004 | 2,265 | $0.0357 | 23.3 | none/none/none/none/none |
| scene-rendering-08--unconstrained--03 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 4,800 | 0 | 4,797 | 296 | $0.0075 | 5.0 | pass/pass/pass/pass/pass |
| scene-rendering-08--mtek-guide-unconstrained--03 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 10,225 | 0 | 10,222 | 346 | $0.0145 | 6.1 | pass/pass/pass/pass/pass |
| scene-rendering-09--unconstrained--03 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 8,285 | 0 | 8,282 | 900 | $0.0149 | 12.1 | pass/pass/pass/pass/pass |
| scene-rendering-09--mtek-guide-unconstrained--03 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,710 | 0 | 13,707 | 689 | $0.0206 | 10.1 | pass/pass/pass/pass/pass |
| scene-rendering-10--unconstrained--03 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | success |  | 2 | 1 | 18,639 | 8,422 | 10,211 | 1,446 | $0.0208 | 22.0 | pass/pass/pass/pass/fail |
| scene-rendering-10--mtek-guide-unconstrained--03 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 62,469 | 45,103 | 17,354 | 1,557 | $0.0340 | 28.1 | pass/pass/pass/pass/fail |
| scene-rendering-11--unconstrained--03 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | failure | generation-truncated | 1 | 0 | 8,453 | 0 | 8,450 | 4,000 | $0.0306 | 31.8 | none/none/none/none/none |
| scene-rendering-11--mtek-guide-unconstrained--03 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | success |  | 4 | 3 | 66,576 | 46,896 | 19,668 | 2,418 | $0.0414 | 22.3 | none/none/none/none/none |
| shader-bridge-01--unconstrained--03 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 23,046 | 15,991 | 7,043 | 1,713 | $0.0190 | 27.1 | pass/pass/pass/pass/fail |
| shader-bridge-01--mtek-guide-unconstrained--03 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 9,969 | 0 | 9,966 | 599 | $0.0155 | 8.5 | pass/pass/pass/pass/pass |
| shader-bridge-02--unconstrained--03 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 27,323 | 18,169 | 9,142 | 2,362 | $0.0251 | 31.5 | pass/pass/pass/pass/fail |
| shader-bridge-02--mtek-guide-unconstrained--03 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 10,211 | 0 | 10,208 | 798 | $0.0168 | 8.6 | pass/pass/pass/pass/pass |
| shader-bridge-03--unconstrained--03 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | success |  | 2 | 1 | 18,139 | 8,186 | 9,947 | 1,116 | $0.0188 | 14.5 | fail/fail/not-run/not-run/not-run |
| shader-bridge-03--mtek-guide-unconstrained--03 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | success |  | 1 | 0 | 13,614 | 0 | 13,611 | 745 | $0.0207 | 9.7 | pass/pass/pass/pass/pass |
| shader-bridge-04--unconstrained--03 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 40,785 | 26,735 | 14,038 | 3,801 | $0.0392 | 34.0 | pass/fail/not-run/not-run/not-run |
| shader-bridge-04--mtek-guide-unconstrained--03 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 10,178 | 0 | 10,175 | 607 | $0.0158 | 9.4 | pass/pass/pass/pass/pass |
| shader-bridge-05--unconstrained--03 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 5,026 | 0 | 5,023 | 269 | $0.0076 | 6.7 | pass/pass/pass/pass/pass |
| shader-bridge-05--mtek-guide-unconstrained--03 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 10,451 | 0 | 10,448 | 368 | $0.0149 | 7.6 | pass/pass/pass/pass/pass |
| shader-bridge-06--unconstrained--03 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | success |  | 2 | 1 | 11,027 | 4,976 | 6,045 | 592 | $0.0110 | 9.8 | pass/fail/not-run/not-run/not-run |
| shader-bridge-06--mtek-guide-unconstrained--03 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 10,404 | 0 | 10,401 | 488 | $0.0154 | 8.0 | pass/pass/pass/pass/pass |
| interaction-01--unconstrained--04 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 26,770 | 18,405 | 8,353 | 1,060 | $0.0176 | 16.7 | pass/fail/not-run/not-run/not-run |
| interaction-01--mtek-guide-unconstrained--04 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,246 | 0 | 10,243 | 389 | $0.0148 | 7.3 | pass/pass/pass/pass/pass |
| interaction-02--unconstrained--04 | interaction-02 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 36,164 | 23,911 | 12,241 | 2,847 | $0.0319 | 30.1 | fail/fail/not-run/not-run/not-run |
| interaction-02--mtek-guide-unconstrained--04 | interaction-02 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 35,007 | 21,988 | 13,010 | 2,022 | $0.0286 | 18.3 | fail/fail/not-run/not-run/not-run |
| interaction-03--unconstrained--04 | interaction-03 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 31,020 | 19,459 | 11,549 | 3,414 | $0.0335 | 22.6 | none/none/none/none/none |
| interaction-03--mtek-guide-unconstrained--04 | interaction-03 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 53,403 | 37,027 | 16,364 | 2,143 | $0.0349 | 25.6 | fail/fail/not-run/not-run/not-run |
| interaction-04--unconstrained--04 | interaction-04 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 10,798 | 4,578 | 6,214 | 926 | $0.0129 | 13.5 | pass/fail/not-run/not-run/not-run |
| interaction-04--mtek-guide-unconstrained--04 | interaction-04 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 47,902 | 33,004 | 14,886 | 1,692 | $0.0304 | 20.3 | none/none/none/none/none |
| interaction-05--unconstrained--04 | interaction-05 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 31,038 | 21,036 | 9,990 | 1,887 | $0.0240 | 16.4 | fail/fail/not-run/not-run/not-run |
| interaction-05--mtek-guide-unconstrained--04 | interaction-05 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 22,024 | 10,169 | 11,849 | 1,140 | $0.0215 | 16.9 | pass/pass/pass/pass/fail |
| interaction-06--unconstrained--04 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 4,738 | 0 | 4,735 | 445 | $0.0081 | 9.2 | pass/pass/pass/pass/pass |
| interaction-06--mtek-guide-unconstrained--04 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,163 | 0 | 10,160 | 758 | $0.0165 | 10.6 | pass/pass/pass/pass/pass |
| interaction-07--unconstrained--04 | interaction-07 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 43,549 | 27,954 | 15,583 | 7,841 | $0.0615 | 67.4 | fail/fail/not-run/not-run/not-run |
| interaction-07--mtek-guide-unconstrained--04 | interaction-07 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 51,861 | 36,521 | 15,328 | 2,862 | $0.0371 | 33.2 | pass/pass/pass/pass/fail |
| interaction-08--unconstrained--04 | interaction-08 | interaction | cold | mtek | unconstrained | success |  | 4 | 3 | 48,266 | 32,468 | 15,786 | 2,085 | $0.0334 | 23.3 | fail/fail/not-run/not-run/not-run |
| interaction-08--mtek-guide-unconstrained--04 | interaction-08 | interaction | cold | mtek | unconstrained | success |  | 1 | 0 | 13,586 | 0 | 13,583 | 501 | $0.0195 | 10.3 | pass/pass/pass/pass/pass |
| interaction-09--unconstrained--04 | interaction-09 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 26,047 | 14,429 | 11,609 | 2,277 | $0.0273 | 26.1 | fail/fail/not-run/not-run/not-run |
| interaction-09--mtek-guide-unconstrained--04 | interaction-09 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 25,789 | 10,466 | 15,317 | 2,223 | $0.0313 | 21.8 | fail/fail/not-run/not-run/not-run |
| interaction-10--unconstrained--04 | interaction-10 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 29,738 | 15,123 | 14,606 | 2,490 | $0.0322 | 29.4 | pass/fail/not-run/not-run/not-run |
| interaction-10--mtek-guide-unconstrained--04 | interaction-10 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,259 | 0 | 10,256 | 849 | $0.0171 | 13.7 | pass/pass/pass/pass/pass |
| interaction-11--unconstrained--04 | interaction-11 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 20,568 | 11,868 | 8,691 | 2,301 | $0.0236 | 32.9 | pass/fail/not-run/not-run/not-run |
| interaction-11--mtek-guide-unconstrained--04 | interaction-11 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 48,676 | 34,541 | 14,123 | 3,083 | $0.0365 | 35.1 | none/none/none/none/none |
| maintenance-01--unconstrained--04 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 4,582 | 0 | 4,579 | 293 | $0.0072 | 5.9 | pass/pass/pass/pass/pass |
| maintenance-01--mtek-guide-unconstrained--04 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,007 | 0 | 10,004 | 281 | $0.0139 | 5.3 | pass/pass/pass/pass/pass |
| maintenance-02--unconstrained--04 | maintenance-02 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,291 | 0 | 5,288 | 643 | $0.0098 | 7.6 | pass/pass/pass/pass/pass |
| maintenance-02--mtek-guide-unconstrained--04 | maintenance-02 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,716 | 0 | 10,713 | 654 | $0.0167 | 9.3 | pass/pass/pass/pass/pass |
| maintenance-03--unconstrained--04 | maintenance-03 | maintenance | edit | mtek | unconstrained | success |  | 2 | 1 | 11,739 | 4,853 | 6,880 | 649 | $0.0123 | 11.5 | fail/fail/not-run/not-run/not-run |
| maintenance-03--mtek-guide-unconstrained--04 | maintenance-03 | maintenance | edit | mtek | unconstrained | success |  | 2 | 1 | 21,232 | 10,278 | 10,948 | 457 | $0.0170 | 8.2 | none/none/none/none/none |
| maintenance-04--unconstrained--04 | maintenance-04 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 4,977 | 0 | 4,974 | 1,137 | $0.0119 | 14.9 | pass/pass/pass/pass/pass |
| maintenance-04--mtek-guide-unconstrained--04 | maintenance-04 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,402 | 0 | 10,399 | 571 | $0.0159 | 8.9 | pass/pass/pass/pass/pass |
| maintenance-05--unconstrained--04 | maintenance-05 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,004 | 0 | 5,001 | 647 | $0.0095 | 7.5 | pass/pass/pass/pass/pass |
| maintenance-05--mtek-guide-unconstrained--04 | maintenance-05 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,429 | 0 | 10,426 | 487 | $0.0155 | 7.2 | pass/pass/pass/pass/pass |
| maintenance-06--unconstrained--04 | maintenance-06 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,561 | 0 | 5,558 | 471 | $0.0093 | 8.5 | pass/pass/pass/pass/pass |
| maintenance-06--mtek-guide-unconstrained--04 | maintenance-06 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,986 | 0 | 10,983 | 462 | $0.0160 | 8.3 | pass/pass/pass/pass/pass |
| scene-rendering-01--unconstrained--04 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 2 | 1 | 17,820 | 7,991 | 9,823 | 595 | $0.0161 | 9.3 | fail/fail/not-run/not-run/not-run |
| scene-rendering-01--mtek-guide-unconstrained--04 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,419 | 0 | 13,416 | 386 | $0.0187 | 6.9 | pass/pass/pass/pass/pass |
| scene-rendering-02--unconstrained--04 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 8,103 | 0 | 8,100 | 635 | $0.0133 | 8.1 | pass/pass/pass/pass/pass |
| scene-rendering-02--mtek-guide-unconstrained--04 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,528 | 0 | 13,525 | 628 | $0.0200 | 9.6 | pass/pass/pass/pass/pass |
| scene-rendering-03--unconstrained--04 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 8,343 | 0 | 8,340 | 1,077 | $0.0158 | 12.1 | pass/pass/pass/pass/pass |
| scene-rendering-03--mtek-guide-unconstrained--04 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,768 | 0 | 13,765 | 739 | $0.0209 | 9.6 | pass/pass/pass/pass/pass |
| scene-rendering-04--unconstrained--04 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 8,188 | 0 | 8,185 | 607 | $0.0133 | 8.1 | pass/pass/pass/pass/pass |
| scene-rendering-04--mtek-guide-unconstrained--04 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,613 | 0 | 13,610 | 496 | $0.0195 | 8.3 | pass/pass/pass/pass/pass |
| scene-rendering-05--unconstrained--04 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | success |  | 2 | 1 | 11,027 | 4,900 | 6,121 | 708 | $0.0117 | 9.0 | pass/fail/not-run/not-run/not-run |
| scene-rendering-05--mtek-guide-unconstrained--04 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | success |  | 2 | 1 | 22,213 | 10,325 | 11,882 | 883 | $0.0203 | 12.0 | pass/fail/not-run/not-run/not-run |
| scene-rendering-06--unconstrained--04 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 42,923 | 30,079 | 12,832 | 3,582 | $0.0370 | 34.4 | none/none/none/none/none |
| scene-rendering-06--mtek-guide-unconstrained--04 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 62,707 | 45,202 | 17,493 | 2,399 | $0.0384 | 32.5 | pass/pass/pass/pass/fail |
| scene-rendering-07--unconstrained--04 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 42,888 | 30,367 | 12,509 | 1,701 | $0.0272 | 26.5 | fail/fail/not-run/not-run/not-run |
| scene-rendering-07--mtek-guide-unconstrained--04 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 61,065 | 44,373 | 16,680 | 1,375 | $0.0322 | 24.5 | pass/pass/pass/pass/fail |
| scene-rendering-08--unconstrained--04 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 4,800 | 0 | 4,797 | 315 | $0.0076 | 5.4 | pass/pass/pass/pass/pass |
| scene-rendering-08--mtek-guide-unconstrained--04 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 10,225 | 0 | 10,222 | 427 | $0.0149 | 6.8 | pass/pass/pass/pass/pass |
| scene-rendering-09--unconstrained--04 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | success |  | 2 | 1 | 20,723 | 8,282 | 12,435 | 1,527 | $0.0240 | 18.5 | fail/fail/not-run/not-run/not-run |
| scene-rendering-09--mtek-guide-unconstrained--04 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,710 | 0 | 13,707 | 589 | $0.0201 | 9.0 | pass/pass/pass/pass/pass |
| scene-rendering-10--unconstrained--04 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 40,056 | 28,438 | 11,606 | 2,209 | $0.0284 | 31.5 | none/none/none/none/none |
| scene-rendering-10--mtek-guide-unconstrained--04 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 62,010 | 44,993 | 17,005 | 1,575 | $0.0336 | 27.8 | pass/pass/pass/pass/fail |
| scene-rendering-11--unconstrained--04 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 56,745 | 37,379 | 19,354 | 3,641 | $0.0461 | 27.3 | fail/fail/not-run/not-run/not-run |
| scene-rendering-11--mtek-guide-unconstrained--04 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 71,623 | 50,782 | 20,829 | 3,232 | $0.0473 | 31.4 | pass/fail/not-run/not-run/not-run |
| shader-bridge-01--unconstrained--04 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 23,471 | 16,384 | 7,075 | 1,181 | $0.0164 | 21.4 | pass/pass/pass/pass/fail |
| shader-bridge-01--mtek-guide-unconstrained--04 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 9,969 | 0 | 9,966 | 610 | $0.0155 | 8.5 | pass/pass/pass/pass/pass |
| shader-bridge-02--unconstrained--04 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 26,951 | 18,508 | 8,431 | 1,712 | $0.0210 | 21.6 | pass/pass/pass/pass/fail |
| shader-bridge-02--mtek-guide-unconstrained--04 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 10,211 | 0 | 10,208 | 821 | $0.0169 | 8.8 | pass/pass/pass/pass/pass |
| shader-bridge-03--unconstrained--04 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | success |  | 2 | 1 | 19,248 | 8,186 | 11,056 | 2,003 | $0.0247 | 17.3 | fail/fail/not-run/not-run/not-run |
| shader-bridge-03--mtek-guide-unconstrained--04 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | success |  | 1 | 0 | 13,614 | 0 | 13,611 | 749 | $0.0208 | 9.8 | pass/pass/pass/pass/pass |
| shader-bridge-04--unconstrained--04 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 26,984 | 18,386 | 8,586 | 2,222 | $0.0237 | 27.4 | pass/fail/not-run/not-run/not-run |
| shader-bridge-04--mtek-guide-unconstrained--04 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | success |  | 2 | 1 | 21,699 | 10,175 | 11,518 | 1,476 | $0.0228 | 17.9 | pass/pass/pass/pass/fail |
| shader-bridge-05--unconstrained--04 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 5,026 | 0 | 5,023 | 306 | $0.0078 | 7.2 | pass/pass/pass/pass/pass |
| shader-bridge-05--mtek-guide-unconstrained--04 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 10,451 | 0 | 10,448 | 335 | $0.0147 | 7.6 | pass/pass/pass/pass/pass |
| shader-bridge-06--unconstrained--04 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | success |  | 2 | 1 | 10,979 | 4,976 | 5,997 | 528 | $0.0106 | 9.7 | pass/fail/not-run/not-run/not-run |
| shader-bridge-06--mtek-guide-unconstrained--04 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | success |  | 2 | 1 | 21,288 | 10,401 | 10,881 | 507 | $0.0172 | 9.2 | none/none/none/none/none |
| interaction-01--baseline-unconstrained--00 | interaction-01 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 3,980 | 0 | 0 | 644 | $0.0072 | 13.5 | pass/pass/pass/pass/pass |
| interaction-02--baseline-unconstrained--00 | interaction-02 | interaction | edit | baseline | unconstrained | success |  | 4 | 3 | 21,987 | 11,147 | 6,755 | 3,144 | $0.0294 | 28.9 | none/none/none/none/none |
| interaction-03--baseline-unconstrained--00 | interaction-03 | interaction | edit | baseline | unconstrained | success |  | 2 | 1 | 10,156 | 4,108 | 6,042 | 1,290 | $0.0144 | 23.0 | pass/fail/not-run/not-run/not-run |
| interaction-04--baseline-unconstrained--00 | interaction-04 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,030 | 0 | 0 | 801 | $0.0080 | 16.0 | pass/pass/pass/pass/pass |
| interaction-05--baseline-unconstrained--00 | interaction-05 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,124 | 0 | 4,121 | 755 | $0.0089 | 16.8 | pass/pass/pass/pass/pass |
| interaction-06--baseline-unconstrained--00 | interaction-06 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,098 | 0 | 0 | 909 | $0.0086 | 22.8 | pass/pass/pass/pass/pass |
| interaction-07--baseline-unconstrained--00 | interaction-07 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,220 | 0 | 4,217 | 1,266 | $0.0116 | 23.7 | pass/pass/pass/pass/pass |
| interaction-08--baseline-unconstrained--00 | interaction-08 | interaction | cold | baseline | unconstrained | success |  | 1 | 0 | 4,048 | 0 | 0 | 656 | $0.0073 | 12.8 | pass/pass/pass/pass/pass |
| interaction-09--baseline-unconstrained--00 | interaction-09 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,328 | 0 | 4,325 | 1,083 | $0.0108 | 19.1 | pass/pass/pass/pass/pass |
| interaction-10--baseline-unconstrained--00 | interaction-10 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,190 | 0 | 4,187 | 818 | $0.0093 | 21.6 | pass/pass/pass/pass/pass |
| interaction-11--baseline-unconstrained--00 | interaction-11 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,248 | 0 | 4,245 | 395 | $0.0073 | 12.7 | pass/pass/pass/pass/pass |
| maintenance-01--baseline-unconstrained--00 | maintenance-01 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,008 | 0 | 0 | 291 | $0.0055 | 19.6 | pass/pass/pass/pass/pass |
| maintenance-02--baseline-unconstrained--00 | maintenance-02 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 355 | $0.0071 | 10.6 | pass/pass/pass/pass/pass |
| maintenance-03--baseline-unconstrained--00 | maintenance-03 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,104 | 0 | 4,101 | 353 | $0.0069 | 10.6 | pass/pass/pass/pass/pass |
| maintenance-04--baseline-unconstrained--00 | maintenance-04 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,203 | 0 | 4,200 | 779 | $0.0091 | 13.6 | pass/pass/pass/pass/pass |
| maintenance-05--baseline-unconstrained--00 | maintenance-05 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,325 | 0 | 4,322 | 455 | $0.0077 | 25.9 | pass/pass/pass/pass/pass |
| maintenance-06--baseline-unconstrained--00 | maintenance-06 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 826 | $0.0094 | 13.3 | pass/pass/pass/pass/pass |
| scene-rendering-01--baseline-unconstrained--00 | scene-rendering-01 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,879 | 0 | 0 | 282 | $0.0053 | 8.9 | pass/pass/pass/pass/pass |
| scene-rendering-02--baseline-unconstrained--00 | scene-rendering-02 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,988 | 0 | 0 | 626 | $0.0071 | 11.3 | pass/pass/pass/pass/pass |
| scene-rendering-03--baseline-unconstrained--00 | scene-rendering-03 | scene-rendering | cold | baseline | unconstrained | success |  | 2 | 1 | 10,621 | 4,197 | 6,418 | 1,181 | $0.0144 | 20.8 | pass/fail/not-run/not-run/not-run |
| scene-rendering-04--baseline-unconstrained--00 | scene-rendering-04 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,069 | 0 | 0 | 706 | $0.0076 | 13.2 | pass/pass/pass/pass/pass |
| scene-rendering-05--baseline-unconstrained--00 | scene-rendering-05 | scene-rendering | edit | baseline | unconstrained | success |  | 1 | 0 | 4,167 | 0 | 4,164 | 690 | $0.0087 | 14.5 | pass/pass/pass/pass/pass |
| scene-rendering-06--baseline-unconstrained--00 | scene-rendering-06 | scene-rendering | cold | baseline | unconstrained | success |  | 2 | 1 | 10,591 | 4,167 | 6,418 | 1,739 | $0.0171 | 23.7 | pass/pass/pass/pass/fail |
| scene-rendering-07--baseline-unconstrained--00 | scene-rendering-07 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 28,476 | 18,549 | 9,915 | 3,543 | $0.0320 | 56.4 | pass/pass/pass/pass/fail |
| scene-rendering-08--baseline-unconstrained--00 | scene-rendering-08 | scene-rendering | edit | baseline | unconstrained | success |  | 1 | 0 | 4,203 | 0 | 4,200 | 370 | $0.0071 | 12.6 | pass/pass/pass/pass/pass |
| scene-rendering-09--baseline-unconstrained--00 | scene-rendering-09 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,162 | 0 | 4,159 | 1,186 | $0.0111 | 16.8 | pass/pass/pass/pass/pass |
| scene-rendering-10--baseline-unconstrained--00 | scene-rendering-10 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 29,315 | 19,472 | 9,831 | 2,623 | $0.0274 | 41.2 | pass/fail/not-run/not-run/not-run |
| scene-rendering-11--baseline-unconstrained--00 | scene-rendering-11 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 39,298 | 24,030 | 15,256 | 6,816 | $0.0556 | 82.4 | pass/pass/pass/pass/fail |
| shader-bridge-01--baseline-unconstrained--00 | shader-bridge-01 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 3,945 | 0 | 0 | 720 | $0.0075 | 17.0 | pass/pass/pass/pass/pass |
| shader-bridge-02--baseline-unconstrained--00 | shader-bridge-02 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,165 | 0 | 4,162 | 1,182 | $0.0111 | 16.4 | pass/pass/pass/pass/pass |
| shader-bridge-03--baseline-unconstrained--00 | shader-bridge-03 | shader-bridge | cold | baseline | unconstrained | success |  | 1 | 0 | 4,076 | 0 | 0 | 785 | $0.0080 | 11.8 | pass/pass/pass/pass/pass |
| shader-bridge-04--baseline-unconstrained--00 | shader-bridge-04 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,053 | 0 | 0 | 720 | $0.0077 | 13.9 | pass/pass/pass/pass/pass |
| shader-bridge-05--baseline-unconstrained--00 | shader-bridge-05 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,186 | 0 | 4,183 | 419 | $0.0073 | 14.8 | pass/pass/pass/pass/pass |
| shader-bridge-06--baseline-unconstrained--00 | shader-bridge-06 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,231 | 0 | 4,228 | 332 | $0.0069 | 10.1 | pass/pass/pass/pass/pass |
| interaction-01--baseline-unconstrained--01 | interaction-01 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 3,980 | 0 | 0 | 654 | $0.0073 | 39.8 | pass/pass/pass/pass/pass |
| interaction-02--baseline-unconstrained--01 | interaction-02 | interaction | edit | baseline | unconstrained | success |  | 2 | 1 | 9,369 | 0 | 5,290 | 1,627 | $0.0188 | 18.5 | none/none/none/none/none |
| interaction-03--baseline-unconstrained--01 | interaction-03 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,111 | 0 | 4,108 | 1,011 | $0.0102 | 22.0 | pass/pass/pass/pass/pass |
| interaction-04--baseline-unconstrained--01 | interaction-04 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,030 | 0 | 0 | 745 | $0.0078 | 17.3 | pass/pass/pass/pass/pass |
| interaction-05--baseline-unconstrained--01 | interaction-05 | interaction | edit | baseline | unconstrained | success |  | 3 | 2 | 15,147 | 9,211 | 5,927 | 2,253 | $0.0196 | 26.2 | none/none/none/none/none |
| interaction-06--baseline-unconstrained--01 | interaction-06 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,098 | 0 | 0 | 1,082 | $0.0095 | 21.5 | pass/pass/pass/pass/pass |
| interaction-07--baseline-unconstrained--01 | interaction-07 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,220 | 0 | 4,217 | 942 | $0.0100 | 25.2 | pass/pass/pass/pass/pass |
| interaction-08--baseline-unconstrained--01 | interaction-08 | interaction | cold | baseline | unconstrained | success |  | 1 | 0 | 4,048 | 0 | 0 | 743 | $0.0078 | 23.6 | pass/pass/pass/pass/pass |
| interaction-09--baseline-unconstrained--01 | interaction-09 | interaction | edit | baseline | unconstrained | success |  | 3 | 2 | 17,529 | 9,912 | 7,608 | 2,286 | $0.0219 | 33.7 | none/none/none/none/none |
| interaction-10--baseline-unconstrained--01 | interaction-10 | interaction | edit | baseline | unconstrained | success |  | 2 | 1 | 9,597 | 4,187 | 5,404 | 2,164 | $0.0180 | 28.8 | none/none/none/none/none |
| interaction-11--baseline-unconstrained--01 | interaction-11 | interaction | edit | baseline | unconstrained | success |  | 2 | 1 | 11,119 | 4,245 | 6,868 | 3,157 | $0.0248 | 36.4 | none/none/none/none/none |
| maintenance-01--baseline-unconstrained--01 | maintenance-01 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,008 | 0 | 0 | 339 | $0.0057 | 18.2 | pass/pass/pass/pass/pass |
| maintenance-02--baseline-unconstrained--01 | maintenance-02 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 240 | $0.0065 | 10.0 | pass/pass/pass/pass/pass |
| maintenance-03--baseline-unconstrained--01 | maintenance-03 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,104 | 0 | 4,101 | 353 | $0.0069 | 10.5 | pass/pass/pass/pass/pass |
| maintenance-04--baseline-unconstrained--01 | maintenance-04 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,203 | 0 | 4,200 | 804 | $0.0093 | 17.1 | pass/pass/pass/pass/pass |
| maintenance-05--baseline-unconstrained--01 | maintenance-05 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,325 | 0 | 4,322 | 644 | $0.0086 | 12.3 | pass/pass/pass/pass/pass |
| maintenance-06--baseline-unconstrained--01 | maintenance-06 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 999 | $0.0103 | 14.3 | pass/pass/pass/pass/pass |
| scene-rendering-01--baseline-unconstrained--01 | scene-rendering-01 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,879 | 0 | 0 | 417 | $0.0060 | 9.6 | pass/pass/pass/pass/pass |
| scene-rendering-02--baseline-unconstrained--01 | scene-rendering-02 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,988 | 0 | 0 | 700 | $0.0075 | 10.5 | pass/pass/pass/pass/pass |
| scene-rendering-03--baseline-unconstrained--01 | scene-rendering-03 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,200 | 0 | 4,197 | 1,074 | $0.0106 | 14.0 | pass/pass/pass/pass/pass |
| scene-rendering-04--baseline-unconstrained--01 | scene-rendering-04 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,069 | 0 | 0 | 1,492 | $0.0115 | 15.4 | pass/pass/pass/pass/pass |
| scene-rendering-05--baseline-unconstrained--01 | scene-rendering-05 | scene-rendering | edit | baseline | unconstrained | success |  | 1 | 0 | 4,167 | 0 | 4,164 | 960 | $0.0100 | 12.6 | pass/pass/pass/pass/pass |
| scene-rendering-06--baseline-unconstrained--01 | scene-rendering-06 | scene-rendering | cold | baseline | unconstrained | success |  | 2 | 1 | 10,457 | 4,167 | 6,284 | 2,466 | $0.0206 | 35.8 | pass/pass/pass/pass/fail |
| scene-rendering-07--baseline-unconstrained--01 | scene-rendering-07 | scene-rendering | cold | baseline | unconstrained | success |  | 3 | 2 | 18,675 | 10,472 | 8,194 | 3,711 | $0.0299 | 43.4 | none/none/none/none/none |
| scene-rendering-08--baseline-unconstrained--01 | scene-rendering-08 | scene-rendering | edit | baseline | unconstrained | success |  | 1 | 0 | 4,203 | 0 | 4,200 | 502 | $0.0078 | 7.1 | pass/pass/pass/pass/pass |
| scene-rendering-09--baseline-unconstrained--01 | scene-rendering-09 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,162 | 0 | 4,159 | 1,397 | $0.0122 | 18.9 | pass/pass/pass/pass/pass |
| scene-rendering-10--baseline-unconstrained--01 | scene-rendering-10 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 29,263 | 18,951 | 10,300 | 3,588 | $0.0327 | 55.8 | pass/pass/pass/pass/fail |
| scene-rendering-11--baseline-unconstrained--01 | scene-rendering-11 | scene-rendering | cold | baseline | unconstrained | success |  | 2 | 1 | 11,110 | 4,405 | 6,699 | 1,205 | $0.0148 | 20.9 | pass/fail/not-run/not-run/not-run |
| shader-bridge-01--baseline-unconstrained--01 | shader-bridge-01 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 3,945 | 0 | 0 | 663 | $0.0073 | 12.6 | pass/pass/pass/pass/pass |
| shader-bridge-02--baseline-unconstrained--01 | shader-bridge-02 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,165 | 0 | 4,162 | 906 | $0.0097 | 14.0 | pass/pass/pass/pass/pass |
| shader-bridge-03--baseline-unconstrained--01 | shader-bridge-03 | shader-bridge | cold | baseline | unconstrained | success |  | 1 | 0 | 4,076 | 0 | 0 | 934 | $0.0087 | 16.9 | pass/pass/pass/pass/pass |
| shader-bridge-04--baseline-unconstrained--01 | shader-bridge-04 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,053 | 0 | 0 | 730 | $0.0077 | 15.3 | pass/pass/pass/pass/pass |
| shader-bridge-05--baseline-unconstrained--01 | shader-bridge-05 | shader-bridge | edit | baseline | unconstrained | success |  | 2 | 1 | 9,500 | 4,183 | 5,311 | 687 | $0.0105 | 25.5 | pass/pass/pass/pass/fail |
| shader-bridge-06--baseline-unconstrained--01 | shader-bridge-06 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,231 | 0 | 4,228 | 368 | $0.0071 | 9.6 | pass/pass/pass/pass/pass |
| interaction-01--baseline-unconstrained--02 | interaction-01 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 3,980 | 0 | 0 | 712 | $0.0075 | 14.6 | pass/pass/pass/pass/pass |
| interaction-02--baseline-unconstrained--02 | interaction-02 | interaction | edit | baseline | unconstrained | success |  | 3 | 2 | 17,389 | 6,071 | 7,236 | 1,330 | $0.0204 | 28.5 | pass/fail/not-run/not-run/not-run |
| interaction-03--baseline-unconstrained--02 | interaction-03 | interaction | edit | baseline | unconstrained | success |  | 2 | 1 | 10,159 | 4,108 | 6,045 | 1,305 | $0.0145 | 24.3 | pass/fail/not-run/not-run/not-run |
| interaction-04--baseline-unconstrained--02 | interaction-04 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,030 | 0 | 0 | 691 | $0.0075 | 18.2 | pass/pass/pass/pass/pass |
| interaction-05--baseline-unconstrained--02 | interaction-05 | interaction | edit | baseline | unconstrained | success |  | 3 | 2 | 15,685 | 9,144 | 6,532 | 1,749 | $0.0178 | 26.5 | none/none/none/none/none |
| interaction-06--baseline-unconstrained--02 | interaction-06 | interaction | edit | baseline | unconstrained | success |  | 2 | 1 | 10,879 | 0 | 6,778 | 2,116 | $0.0232 | 30.8 | pass/pass/pass/pass/fail |
| interaction-07--baseline-unconstrained--02 | interaction-07 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,220 | 0 | 4,217 | 1,076 | $0.0107 | 22.9 | pass/pass/pass/pass/pass |
| interaction-08--baseline-unconstrained--02 | interaction-08 | interaction | cold | baseline | unconstrained | success |  | 1 | 0 | 4,048 | 0 | 0 | 679 | $0.0074 | 25.1 | pass/pass/pass/pass/pass |
| interaction-09--baseline-unconstrained--02 | interaction-09 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,328 | 0 | 4,325 | 1,197 | $0.0114 | 19.5 | pass/pass/pass/pass/pass |
| interaction-10--baseline-unconstrained--02 | interaction-10 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,190 | 0 | 4,187 | 881 | $0.0096 | 26.2 | pass/pass/pass/pass/pass |
| interaction-11--baseline-unconstrained--02 | interaction-11 | interaction | edit | baseline | unconstrained | success |  | 2 | 1 | 10,855 | 4,245 | 6,604 | 2,270 | $0.0200 | 23.1 | none/none/none/none/none |
| maintenance-01--baseline-unconstrained--02 | maintenance-01 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,008 | 0 | 0 | 301 | $0.0055 | 7.9 | pass/pass/pass/pass/pass |
| maintenance-02--baseline-unconstrained--02 | maintenance-02 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 640 | $0.0085 | 10.4 | pass/pass/pass/pass/pass |
| maintenance-03--baseline-unconstrained--02 | maintenance-03 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,104 | 0 | 4,101 | 351 | $0.0069 | 8.1 | pass/pass/pass/pass/pass |
| maintenance-04--baseline-unconstrained--02 | maintenance-04 | maintenance | edit | baseline | unconstrained | success |  | 2 | 1 | 9,509 | 4,200 | 5,303 | 793 | $0.0110 | 16.3 | none/none/none/none/none |
| maintenance-05--baseline-unconstrained--02 | maintenance-05 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,325 | 0 | 4,322 | 455 | $0.0077 | 15.4 | pass/pass/pass/pass/pass |
| maintenance-06--baseline-unconstrained--02 | maintenance-06 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 835 | $0.0095 | 14.7 | pass/pass/pass/pass/pass |
| scene-rendering-01--baseline-unconstrained--02 | scene-rendering-01 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,879 | 0 | 0 | 296 | $0.0054 | 10.6 | pass/pass/pass/pass/pass |
| scene-rendering-02--baseline-unconstrained--02 | scene-rendering-02 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,988 | 0 | 0 | 616 | $0.0071 | 10.0 | pass/pass/pass/pass/pass |
| scene-rendering-03--baseline-unconstrained--02 | scene-rendering-03 | scene-rendering | cold | baseline | unconstrained | success |  | 2 | 1 | 10,299 | 4,197 | 6,096 | 944 | $0.0128 | 25.6 | pass/fail/not-run/not-run/not-run |
| scene-rendering-04--baseline-unconstrained--02 | scene-rendering-04 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,069 | 0 | 0 | 774 | $0.0079 | 10.5 | pass/pass/pass/pass/pass |
| scene-rendering-05--baseline-unconstrained--02 | scene-rendering-05 | scene-rendering | edit | baseline | unconstrained | success |  | 1 | 0 | 4,167 | 0 | 4,164 | 765 | $0.0090 | 9.6 | pass/pass/pass/pass/pass |
| scene-rendering-06--baseline-unconstrained--02 | scene-rendering-06 | scene-rendering | cold | baseline | unconstrained | success |  | 3 | 2 | 20,472 | 11,541 | 8,922 | 3,526 | $0.0299 | 47.8 | pass/pass/pass/pass/fail |
| scene-rendering-07--baseline-unconstrained--02 | scene-rendering-07 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 30,929 | 18,702 | 12,215 | 3,711 | $0.0357 | 48.0 | pass/pass/pass/pass/fail |
| scene-rendering-08--baseline-unconstrained--02 | scene-rendering-08 | scene-rendering | edit | baseline | unconstrained | success |  | 1 | 0 | 4,203 | 0 | 4,200 | 516 | $0.0078 | 8.9 | pass/pass/pass/pass/pass |
| scene-rendering-09--baseline-unconstrained--02 | scene-rendering-09 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,162 | 0 | 4,159 | 1,011 | $0.0103 | 11.1 | pass/pass/pass/pass/pass |
| scene-rendering-10--baseline-unconstrained--02 | scene-rendering-10 | scene-rendering | cold | baseline | unconstrained | success |  | 2 | 1 | 11,682 | 4,303 | 7,373 | 2,532 | $0.0223 | 36.5 | pass/pass/pass/pass/fail |
| scene-rendering-11--baseline-unconstrained--02 | scene-rendering-11 | scene-rendering | cold | baseline | unconstrained | success |  | 2 | 1 | 13,400 | 4,405 | 8,989 | 2,530 | $0.0243 | 30.1 | pass/fail/not-run/not-run/not-run |
| shader-bridge-01--baseline-unconstrained--02 | shader-bridge-01 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 3,945 | 0 | 0 | 685 | $0.0074 | 10.8 | pass/pass/pass/pass/pass |
| shader-bridge-02--baseline-unconstrained--02 | shader-bridge-02 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,165 | 0 | 4,162 | 1,113 | $0.0108 | 19.1 | pass/pass/pass/pass/pass |
| shader-bridge-03--baseline-unconstrained--02 | shader-bridge-03 | shader-bridge | cold | baseline | unconstrained | success |  | 1 | 0 | 4,076 | 0 | 0 | 729 | $0.0077 | 15.4 | pass/pass/pass/pass/pass |
| shader-bridge-04--baseline-unconstrained--02 | shader-bridge-04 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,053 | 0 | 0 | 711 | $0.0076 | 10.8 | pass/pass/pass/pass/pass |
| shader-bridge-05--baseline-unconstrained--02 | shader-bridge-05 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,186 | 0 | 4,183 | 368 | $0.0071 | 9.3 | pass/pass/pass/pass/pass |
| shader-bridge-06--baseline-unconstrained--02 | shader-bridge-06 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,231 | 0 | 4,228 | 374 | $0.0072 | 8.8 | pass/pass/pass/pass/pass |
| interaction-01--baseline-unconstrained--03 | interaction-01 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 3,980 | 0 | 0 | 675 | $0.0074 | 12.4 | pass/pass/pass/pass/pass |
| interaction-02--baseline-unconstrained--03 | interaction-02 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,076 | 0 | 0 | 892 | $0.0085 | 13.4 | pass/pass/pass/pass/pass |
| interaction-03--baseline-unconstrained--03 | interaction-03 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,111 | 0 | 4,108 | 1,022 | $0.0102 | 21.9 | pass/pass/pass/pass/pass |
| interaction-04--baseline-unconstrained--03 | interaction-04 | interaction | edit | baseline | unconstrained | success |  | 2 | 1 | 9,894 | 0 | 5,861 | 1,357 | $0.0181 | 26.8 | pass/fail/not-run/not-run/not-run |
| interaction-05--baseline-unconstrained--03 | interaction-05 | interaction | edit | baseline | unconstrained | success |  | 2 | 1 | 10,026 | 4,121 | 5,899 | 1,138 | $0.0135 | 24.2 | pass/fail/not-run/not-run/not-run |
| interaction-06--baseline-unconstrained--03 | interaction-06 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,098 | 0 | 0 | 1,014 | $0.0092 | 24.0 | pass/pass/pass/pass/pass |
| interaction-07--baseline-unconstrained--03 | interaction-07 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,220 | 0 | 4,217 | 1,104 | $0.0108 | 33.3 | pass/pass/pass/pass/pass |
| interaction-08--baseline-unconstrained--03 | interaction-08 | interaction | cold | baseline | unconstrained | success |  | 1 | 0 | 4,048 | 0 | 0 | 686 | $0.0075 | 12.7 | pass/pass/pass/pass/pass |
| interaction-09--baseline-unconstrained--03 | interaction-09 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,328 | 0 | 4,325 | 1,405 | $0.0124 | 21.6 | pass/pass/pass/pass/pass |
| interaction-10--baseline-unconstrained--03 | interaction-10 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,190 | 0 | 4,187 | 901 | $0.0097 | 18.0 | pass/pass/pass/pass/pass |
| interaction-11--baseline-unconstrained--03 | interaction-11 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,248 | 0 | 4,245 | 777 | $0.0092 | 13.1 | pass/pass/pass/pass/pass |
| maintenance-01--baseline-unconstrained--03 | maintenance-01 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,008 | 0 | 0 | 241 | $0.0052 | 6.0 | pass/pass/pass/pass/pass |
| maintenance-02--baseline-unconstrained--03 | maintenance-02 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 719 | $0.0089 | 9.6 | pass/pass/pass/pass/pass |
| maintenance-03--baseline-unconstrained--03 | maintenance-03 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,104 | 0 | 4,101 | 353 | $0.0069 | 8.1 | pass/pass/pass/pass/pass |
| maintenance-04--baseline-unconstrained--03 | maintenance-04 | maintenance | edit | baseline | unconstrained | success |  | 2 | 1 | 9,451 | 4,200 | 5,245 | 766 | $0.0108 | 12.0 | none/none/none/none/none |
| maintenance-05--baseline-unconstrained--03 | maintenance-05 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,325 | 0 | 4,322 | 455 | $0.0077 | 9.0 | pass/pass/pass/pass/pass |
| maintenance-06--baseline-unconstrained--03 | maintenance-06 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 895 | $0.0098 | 13.1 | pass/pass/pass/pass/pass |
| scene-rendering-01--baseline-unconstrained--03 | scene-rendering-01 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,879 | 0 | 0 | 318 | $0.0055 | 6.8 | pass/pass/pass/pass/pass |
| scene-rendering-02--baseline-unconstrained--03 | scene-rendering-02 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,988 | 0 | 0 | 636 | $0.0072 | 10.2 | pass/pass/pass/pass/pass |
| scene-rendering-03--baseline-unconstrained--03 | scene-rendering-03 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,200 | 0 | 4,197 | 1,120 | $0.0108 | 13.3 | pass/pass/pass/pass/pass |
| scene-rendering-04--baseline-unconstrained--03 | scene-rendering-04 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,069 | 0 | 0 | 776 | $0.0079 | 10.7 | pass/pass/pass/pass/pass |
| scene-rendering-05--baseline-unconstrained--03 | scene-rendering-05 | scene-rendering | edit | baseline | unconstrained | success |  | 1 | 0 | 4,167 | 0 | 4,164 | 686 | $0.0086 | 9.5 | pass/pass/pass/pass/pass |
| scene-rendering-06--baseline-unconstrained--03 | scene-rendering-06 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 26,904 | 17,627 | 9,265 | 2,774 | $0.0272 | 38.0 | pass/pass/pass/pass/fail |
| scene-rendering-07--baseline-unconstrained--03 | scene-rendering-07 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 27,141 | 17,841 | 9,288 | 2,515 | $0.0260 | 43.3 | pass/pass/pass/pass/fail |
| scene-rendering-08--baseline-unconstrained--03 | scene-rendering-08 | scene-rendering | edit | baseline | unconstrained | success |  | 1 | 0 | 4,203 | 0 | 4,200 | 459 | $0.0075 | 9.3 | pass/pass/pass/pass/pass |
| scene-rendering-09--baseline-unconstrained--03 | scene-rendering-09 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,162 | 0 | 4,159 | 831 | $0.0094 | 10.9 | pass/pass/pass/pass/pass |
| scene-rendering-10--baseline-unconstrained--03 | scene-rendering-10 | scene-rendering | cold | baseline | unconstrained | success |  | 4 | 3 | 29,665 | 19,632 | 10,021 | 3,020 | $0.0296 | 36.8 | pass/pass/pass/pass/fail |
| scene-rendering-11--baseline-unconstrained--03 | scene-rendering-11 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 33,084 | 21,559 | 11,513 | 5,651 | $0.0448 | 49.3 | pass/fail/not-run/not-run/not-run |
| shader-bridge-01--baseline-unconstrained--03 | shader-bridge-01 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 3,945 | 0 | 0 | 696 | $0.0074 | 10.8 | pass/pass/pass/pass/pass |
| shader-bridge-02--baseline-unconstrained--03 | shader-bridge-02 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,165 | 0 | 4,162 | 982 | $0.0101 | 12.7 | pass/pass/pass/pass/pass |
| shader-bridge-03--baseline-unconstrained--03 | shader-bridge-03 | shader-bridge | cold | baseline | unconstrained | success |  | 2 | 1 | 9,822 | 0 | 5,743 | 1,563 | $0.0191 | 19.2 | pass/pass/pass/pass/fail |
| shader-bridge-04--baseline-unconstrained--03 | shader-bridge-04 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,053 | 0 | 0 | 729 | $0.0077 | 10.9 | pass/pass/pass/pass/pass |
| shader-bridge-05--baseline-unconstrained--03 | shader-bridge-05 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,186 | 0 | 4,183 | 986 | $0.0102 | 10.7 | pass/pass/pass/pass/pass |
| shader-bridge-06--baseline-unconstrained--03 | shader-bridge-06 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,231 | 0 | 4,228 | 336 | $0.0070 | 8.2 | pass/pass/pass/pass/pass |
| interaction-01--baseline-unconstrained--04 | interaction-01 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 3,980 | 0 | 0 | 608 | $0.0070 | 9.7 | pass/pass/pass/pass/pass |
| interaction-02--baseline-unconstrained--04 | interaction-02 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,076 | 0 | 0 | 884 | $0.0085 | 15.1 | pass/pass/pass/pass/pass |
| interaction-03--baseline-unconstrained--04 | interaction-03 | interaction | edit | baseline | unconstrained | success |  | 3 | 2 | 17,672 | 10,303 | 7,360 | 1,435 | $0.0174 | 26.1 | pass/fail/not-run/not-run/not-run |
| interaction-04--baseline-unconstrained--04 | interaction-04 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,030 | 0 | 0 | 825 | $0.0082 | 15.3 | pass/pass/pass/pass/pass |
| interaction-05--baseline-unconstrained--04 | interaction-05 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,124 | 0 | 4,121 | 848 | $0.0094 | 15.5 | pass/pass/pass/pass/pass |
| interaction-06--baseline-unconstrained--04 | interaction-06 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,098 | 0 | 0 | 1,121 | $0.0097 | 16.7 | pass/pass/pass/pass/pass |
| interaction-07--baseline-unconstrained--04 | interaction-07 | interaction | edit | baseline | unconstrained | success |  | 2 | 1 | 10,532 | 4,217 | 6,309 | 1,635 | $0.0165 | 26.2 | fail/fail/not-run/not-run/not-run |
| interaction-08--baseline-unconstrained--04 | interaction-08 | interaction | cold | baseline | unconstrained | success |  | 1 | 0 | 4,048 | 0 | 0 | 807 | $0.0081 | 13.6 | pass/pass/pass/pass/pass |
| interaction-09--baseline-unconstrained--04 | interaction-09 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,328 | 0 | 4,325 | 1,054 | $0.0107 | 14.9 | pass/pass/pass/pass/pass |
| interaction-10--baseline-unconstrained--04 | interaction-10 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,190 | 0 | 4,187 | 955 | $0.0100 | 18.2 | pass/pass/pass/pass/pass |
| interaction-11--baseline-unconstrained--04 | interaction-11 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,248 | 0 | 4,245 | 815 | $0.0094 | 12.7 | pass/pass/pass/pass/pass |
| maintenance-01--baseline-unconstrained--04 | maintenance-01 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,008 | 0 | 0 | 323 | $0.0056 | 5.7 | pass/pass/pass/pass/pass |
| maintenance-02--baseline-unconstrained--04 | maintenance-02 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 530 | $0.0080 | 8.4 | pass/pass/pass/pass/pass |
| maintenance-03--baseline-unconstrained--04 | maintenance-03 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,104 | 0 | 4,101 | 360 | $0.0069 | 10.3 | pass/pass/pass/pass/pass |
| maintenance-04--baseline-unconstrained--04 | maintenance-04 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,203 | 0 | 4,200 | 480 | $0.0077 | 9.1 | pass/pass/pass/pass/pass |
| maintenance-05--baseline-unconstrained--04 | maintenance-05 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,325 | 0 | 4,322 | 455 | $0.0077 | 9.0 | pass/pass/pass/pass/pass |
| maintenance-06--baseline-unconstrained--04 | maintenance-06 | maintenance | edit | baseline | unconstrained | success |  | 4 | 3 | 24,303 | 16,717 | 7,574 | 3,055 | $0.0264 | 29.4 | none/none/none/none/none |
| scene-rendering-01--baseline-unconstrained--04 | scene-rendering-01 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,879 | 0 | 0 | 503 | $0.0064 | 8.4 | pass/pass/pass/pass/pass |
| scene-rendering-02--baseline-unconstrained--04 | scene-rendering-02 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,988 | 0 | 0 | 593 | $0.0070 | 9.7 | pass/pass/pass/pass/pass |
| scene-rendering-03--baseline-unconstrained--04 | scene-rendering-03 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,200 | 0 | 4,197 | 983 | $0.0102 | 12.2 | pass/pass/pass/pass/pass |
| scene-rendering-04--baseline-unconstrained--04 | scene-rendering-04 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,069 | 0 | 0 | 1,083 | $0.0095 | 13.3 | pass/pass/pass/pass/pass |
| scene-rendering-05--baseline-unconstrained--04 | scene-rendering-05 | scene-rendering | edit | baseline | unconstrained | success |  | 1 | 0 | 4,167 | 0 | 4,164 | 738 | $0.0089 | 10.1 | pass/pass/pass/pass/pass |
| scene-rendering-06--baseline-unconstrained--04 | scene-rendering-06 | scene-rendering | cold | baseline | unconstrained | success |  | 2 | 1 | 10,987 | 4,167 | 6,814 | 3,578 | $0.0268 | 37.1 | pass/pass/pass/pass/fail |
| scene-rendering-07--baseline-unconstrained--04 | scene-rendering-07 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 27,487 | 18,202 | 9,273 | 3,772 | $0.0323 | 43.6 | none/none/none/none/none |
| scene-rendering-08--baseline-unconstrained--04 | scene-rendering-08 | scene-rendering | edit | baseline | unconstrained | success |  | 1 | 0 | 4,203 | 0 | 4,200 | 384 | $0.0072 | 6.1 | pass/pass/pass/pass/pass |
| scene-rendering-09--baseline-unconstrained--04 | scene-rendering-09 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,162 | 0 | 4,159 | 1,160 | $0.0110 | 13.8 | pass/pass/pass/pass/pass |
| scene-rendering-10--baseline-unconstrained--04 | scene-rendering-10 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 29,111 | 18,951 | 10,148 | 3,666 | $0.0329 | 51.6 | pass/pass/pass/pass/fail |
| scene-rendering-11--baseline-unconstrained--04 | scene-rendering-11 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 33,460 | 21,057 | 12,391 | 5,125 | $0.0432 | 49.6 | pass/pass/pass/pass/fail |
| shader-bridge-01--baseline-unconstrained--04 | shader-bridge-01 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 3,945 | 0 | 0 | 639 | $0.0071 | 9.0 | pass/pass/pass/pass/pass |
| shader-bridge-02--baseline-unconstrained--04 | shader-bridge-02 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,165 | 0 | 4,162 | 934 | $0.0099 | 12.3 | pass/pass/pass/pass/pass |
| shader-bridge-03--baseline-unconstrained--04 | shader-bridge-03 | shader-bridge | cold | baseline | unconstrained | success |  | 1 | 0 | 4,076 | 0 | 0 | 841 | $0.0083 | 11.3 | pass/pass/pass/pass/pass |
| shader-bridge-04--baseline-unconstrained--04 | shader-bridge-04 | shader-bridge | edit | baseline | unconstrained | success |  | 2 | 1 | 9,097 | 0 | 5,041 | 1,464 | $0.0177 | 14.8 | none/none/none/none/none |
| shader-bridge-05--baseline-unconstrained--04 | shader-bridge-05 | shader-bridge | edit | baseline | unconstrained | success |  | 2 | 1 | 9,348 | 4,183 | 5,159 | 440 | $0.0091 | 14.3 | pass/pass/pass/pass/fail |
| shader-bridge-06--baseline-unconstrained--04 | shader-bridge-06 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,231 | 0 | 4,228 | 335 | $0.0070 | 8.7 | pass/pass/pass/pass/pass |

## How the conclusion is reached

The rule (decision 0108, applying decision 0001 and `spec/ai-and-benchmarks.md` section 6.4) compares the Mtek condition with the baseline over the tasks both have attempts at, on two axes:

- success: completion rate = completed / attempts that ended by themselves (completed or failed); "matched" when the two differ by at most 10 points, "higher" or "lower" otherwise;
- tokens per completed task = all tokens of all attempts (successes, failures, unfinished) / completed tasks; the ratio Mtek / baseline with a 95 % percentile interval from a bootstrap over tasks (4 000 resamples, fixed seed); "fewer" when the whole interval is below 1, "more" when above 1, "same" otherwise.

better = success matched or higher and tokens fewer, or success higher and tokens the same; worse = success matched or lower and tokens more, or success lower and tokens the same; equivalent = success matched and tokens the same; inconclusive = nothing completes on either side, the axes oppose each other, or no task has attempts on both sides. If only one side completes anything it is better; the other is worse. No comparison is tuned to turn "equivalent" into a win.

The research target (proposed, not a result): at matched success, at least 30 % fewer tokens per completed task than the baseline (ratio at most 0.70 and the verdict better). Missing it triggers the investigation of spec 6.4, not a cryptic syntax. A verdict is provisional when a task has fewer than 5 trials on a side, when more than 10 % of the attempts could not be judged, or when token counts are unknown.
