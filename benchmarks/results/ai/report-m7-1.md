# AI/token benchmark report: the M7.1 re-run of the Mtek conditions (main set)

Mtek attempts: only the run `m7-1-rerun-main` (34 tasks, 5 trials, the compiler context alone and with `docs/language-guide.md` added, both as changed after the M7-05 run). Baseline attempts: only the 170 baseline attempts of the EARLIER run `m7-05-main`, read with `--baseline-run`; the baseline was NOT re-run, and no Mtek attempt of the earlier run is in this report (the row of `m7-05-main` in the first table shows the spend of that whole run, of which only the baseline attempts are used). 57 of the 340 Mtek attempts (28 + 29) were lost to connection errors and timeouts and are not judged (see 'Attempts that could not be judged'); that is more than 10 % of the attempts, so every verdict here is provisional. No holdout attempt is in this report, and no holdout result exists for the new documentation.

Generated from the stored `records.jsonl` by `tools/ai-eval/src/report.ts` (decision 0108); the same records give the same text. Every attempt is listed in the last section, failures included. The original "about 80 % fewer tokens" claim is an unverified hypothesis and is not tested by the 30 % research target below.

## Runs and recorded settings

| run | started | status | provider / model | settings | spend |
| --- | --- | --- | --- | --- | --- |
| m7-1-rerun-main | 2026-10-19T15:48:40.781Z | complete | anthropic / claude-haiku-4-5-20251001 | temperature 1, prompt caching true, test feedback messages, max repairs per task | cap $20.6, this run $8.1007, ledger after $19.9054, 693 calls, 0 refused |
| m7-05-main | 2026-10-19T09:23:16.558Z | complete | anthropic / claude-haiku-4-5-20251001 | temperature 1, prompt caching true, test feedback messages, max repairs per task | cap $7.8, this run $6.1594, ledger after $6.6040, 731 calls, 0 refused |

Date of the runs: 2026-10-19T09:23:16.558Z to 2026-10-19T15:48:40.781Z. Models: claude-haiku-4-5-20251001.

## Model claude-haiku-4-5-20251001

### Conclusion on H4 (agent-facing contract), decision 0001 by the rule of decision 0108

**Mtek unconstrained against the baseline: WORSE (provisional).** completion lower and tokens per completed task significantly more.

|  | attempts | completed | completion rate | tokens per completed task | cost per completed task |
| --- | --- | --- | --- | --- | --- |
| Mtek | 170 | 97 | 68.3 % | 33,659 | $0.0386 |
| baseline | 170 | 156 | 91.8 % | 9,388 | $0.0131 |

Over 34 task(s): token ratio Mtek / baseline 3.585, 95 % interval [2.508, 5.192]; completion difference -23.5 points (success lower, tokens more). Research target of 30 % fewer tokens: not met.

Provisional because: more than 10 % of the attempts could not be judged (not-run, error, unavailable or unfinished).

**Mtek unconstrained with the document guide added against the baseline: WORSE (provisional).** completion matched and tokens per completed task significantly more.

|  | attempts | completed | completion rate | tokens per completed task | cost per completed task |
| --- | --- | --- | --- | --- | --- |
| Mtek | 170 | 119 | 84.4 % | 31,166 | $0.0366 |
| baseline | 170 | 156 | 91.8 % | 9,388 | $0.0131 |

Over 34 task(s): token ratio Mtek / baseline 3.320, 95 % interval [2.686, 4.118]; completion difference -7.4 points (success matched, tokens more). Research target of 30 % fewer tokens: not met.

Provisional because: more than 10 % of the attempts could not be judged (not-run, error, unavailable or unfinished).

### Aggregates per condition

| cell | attempts | completed / failed / not judged | completion rate | tokens per completed task | tokens per attempt, median [IQR] | tokens per completed attempt, median [IQR] | repairs per completed, median [IQR] | seconds per attempt, median [IQR] | cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mtek unconstrained | 170 | 97 / 45 / 28 | 68.3 % | 33,659 | 12,180 [5,292, 33,493] | 11,164 [5,551, 19,516] | 1.0 [0.0, 1.0] | 10.8 [6.7, 24.6] | $3.7490 |
| mtek unconstrained+guide | 170 | 119 / 22 / 29 | 84.4 % | 31,166 | 11,454 [10,594, 29,135] | 13,631 [10,738, 22,764] | 0.0 [0.0, 1.0] | 9.0 [6.8, 17.0] | $4.3517 |
| baseline unconstrained | 170 | 156 / 14 / 0 | 91.8 % | 9,388 | 5,052 [4,707, 9,819] | 5,008 [4,692, 5,472] | 0.0 [0.0, 0.0] | 11.1 [8.2, 15.3] | $2.0476 |

Tokens are input plus output of every call of every attempt (cached reads and writes are input). "Not judged" counts not-run, error, unavailable and unfinished-by-budget attempts: they are in the token sums, not in the completion rate.

### Tokens, separately

| cell | input | of which cache reads | of which cache writes | of which uncached | output | total | attempts with unknown usage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mtek unconstrained | 3,040,099 | 1,739,778 | 1,299,238 | 1,083 | 224,821 | 3,264,920 | 0 |
| mtek unconstrained+guide | 3,538,618 | 1,727,220 | 1,810,573 | 825 | 170,125 | 3,708,743 | 0 |
| baseline unconstrained | 1,272,681 | 384,464 | 646,397 | 241,820 | 191,871 | 1,464,552 | 0 |

### First-attempt success (the first candidate that was validated)

| cell | candidates | parse | check | start | tests | everything |
| --- | --- | --- | --- | --- | --- | --- |
| mtek unconstrained | 142 | 87 / 142 (61.3 %) | 66 / 142 (46.5 %) | 66 / 142 (46.5 %) | 48 / 142 (33.8 %) | 48 / 142 (33.8 %) |
| mtek unconstrained+guide | 141 | 111 / 141 (78.7 %) | 106 / 141 (75.2 %) | 106 / 141 (75.2 %) | 83 / 141 (58.9 %) | 83 / 141 (58.9 %) |
| baseline unconstrained | 170 | 152 / 170 (89.4 %) | 144 / 170 (84.7 %) | 144 / 170 (84.7 %) | 126 / 170 (74.1 %) | 126 / 170 (74.1 %) |

### Where the input tokens went (by each part's share of the request's characters)

| cell | instructions | task | documentation | project files | diagnostics | tool results | repair context | generated code | other | output (generated code) | input in repair rounds | output in repair rounds |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mtek unconstrained | 183,722 (6.0 %) | 157,694 (5.2 %) | 1,809,354 (59.5 %) | 65,318 (2.1 %) | 319,612 (10.5 %) | 65,560 (2.2 %) | 149,511 (4.9 %) | 289,328 (9.5 %) | 0 (0.0 %) | 224,821 | 2,200,603 | 117,298 |
| mtek unconstrained+guide | 142,788 (4.0 %) | 130,281 (3.7 %) | 2,841,769 (80.3 %) | 51,645 (1.5 %) | 82,105 (2.3 %) | 39,078 (1.1 %) | 86,989 (2.5 %) | 163,963 (4.6 %) | 0 (0.0 %) | 170,125 | 1,950,497 | 76,037 |
| baseline unconstrained | 126,531 (9.9 %) | 110,077 (8.6 %) | 775,322 (60.9 %) | 51,601 (4.1 %) | 7,705 (0.6 %) | 16,616 (1.3 %) | 70,886 (5.6 %) | 113,943 (9.0 %) | 0 (0.0 %) | 191,871 | 567,766 | 47,067 |

The provider counts tokens per request, not per part of a request: each request's input tokens are split by the share of its characters (system prompt, each message's sections, the model's earlier replies). "documentation" is the compiler context export on the Mtek side (its examples are inside it and are not counted apart) and the reference document on the baseline side. These are estimates of attribution, the totals are exact.

### Per category

| cell | attempts | completed / failed / not judged | completion rate | tokens per completed task | tokens per attempt, median [IQR] | tokens per completed attempt, median [IQR] | repairs per completed, median [IQR] | seconds per attempt, median [IQR] | cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| interaction: mtek unconstrained | 55 | 32 / 18 / 5 | 64.0 % | 44,813 | 28,292 [12,180, 39,698] | 18,837 [11,816, 37,488] | 1.5 [1.0, 3.0] | 24.3 [11.7, 32.8] | $1.4604 |
| interaction: mtek unconstrained+guide | 55 | 42 / 7 / 6 | 85.7 % | 35,625 | 22,863 [10,703, 50,454] | 22,732 [11,027, 38,547] | 1.0 [0.0, 2.0] | 15.6 [9.6, 27.0] | $1.5066 |
| interaction: baseline unconstrained | 55 | 53 / 2 / 0 | 96.4 % | 7,540 | 5,170 [4,979, 5,615] | 5,156 [4,974, 5,505] | 0.0 [0.0, 0.0] | 13.6 [11.8, 17.5] | $0.6391 |
| maintenance: mtek unconstrained | 30 | 24 / 0 / 6 | 100.0 % | 6,988 | 5,545 [4,870, 5,944] | 5,602 [5,455, 6,011] | 0.0 [0.0, 0.0] | 7.5 [5.2, 8.7] | $0.3800 |
| maintenance: mtek unconstrained+guide | 30 | 23 / 1 / 6 | 95.8 % | 14,465 | 10,898 [10,208, 11,328] | 10,969 [10,691, 11,344] | 0.0 [0.0, 0.0] | 7.4 [5.2, 8.9] | $0.6001 |
| maintenance: baseline unconstrained | 30 | 30 / 0 / 0 | 100.0 % | 5,329 | 4,818 [4,464, 5,129] | 4,818 [4,464, 5,129] | 0.0 [0.0, 0.0] | 7.0 [6.5, 10.4] | $0.2468 |
| scene-rendering: mtek unconstrained | 55 | 29 / 15 / 11 | 65.9 % | 38,269 | 9,019 [5,163, 41,544] | 8,833 [8,413, 17,741] | 0.0 [0.0, 1.0] | 10.2 [6.2, 23.6] | $1.2891 |
| scene-rendering: mtek unconstrained+guide | 55 | 30 / 14 / 11 | 68.2 % | 48,671 | 14,166 [10,598, 62,353] | 14,065 [13,740, 14,302] | 0.0 [0.0, 0.0] | 8.9 [5.6, 24.8] | $1.5797 |
| scene-rendering: baseline unconstrained | 55 | 44 / 11 / 0 | 80.0 % | 15,160 | 5,220 [4,801, 13,548] | 5,032 [4,694, 5,705] | 0.0 [0.0, 0.0] | 10.0 [8.2, 26.2] | $0.8350 |
| shader-bridge: mtek unconstrained | 30 | 12 / 12 / 6 | 50.0 % | 46,116 | 21,911 [5,340, 27,521] | 14,816 [5,351, 21,513] | 1.0 [0.0, 2.0] | 16.5 [5.8, 20.3] | $0.6195 |
| shader-bridge: mtek unconstrained+guide | 30 | 24 / 0 / 6 | 100.0 % | 17,487 | 10,709 [10,470, 10,979] | 10,805 [10,693, 16,409] | 0.0 [0.0, 0.3] | 8.0 [6.8, 10.1] | $0.6652 |
| shader-bridge: baseline unconstrained | 30 | 29 / 1 / 0 | 96.7 % | 8,207 | 4,806 [4,610, 10,585] | 4,770 [4,609, 10,046] | 0.0 [0.0, 1.0] | 9.9 [8.7, 12.9] | $0.3267 |

### Per mode (cold authoring, edit)

| cell | attempts | completed / failed / not judged | completion rate | tokens per completed task | tokens per attempt, median [IQR] | tokens per completed attempt, median [IQR] | repairs per completed, median [IQR] | seconds per attempt, median [IQR] | cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cold: mtek unconstrained | 55 | 25 / 19 / 11 | 56.8 % | 55,042 | 19,847 [8,458, 45,825] | 9,594 [8,763, 20,613] | 0.0 [0.0, 1.0] | 16.5 [8.7, 25.6] | $1.4805 |
| cold: mtek unconstrained+guide | 55 | 30 / 14 / 11 | 68.2 % | 51,678 | 14,276 [13,742, 62,766] | 14,124 [13,946, 14,314] | 0.0 [0.0, 0.0] | 8.9 [6.6, 25.9] | $1.6524 |
| cold: baseline unconstrained | 55 | 43 / 12 / 0 | 78.2 % | 16,243 | 5,317 [4,844, 18,891] | 5,066 [4,730, 6,449] | 0.0 [0.0, 0.0] | 11.6 [9.5, 29.4] | $0.8754 |
| edit: mtek unconstrained | 115 | 72 / 26 / 17 | 73.5 % | 26,234 | 11,678 [5,253, 27,871] | 11,189 [5,351, 17,815] | 1.0 [0.0, 2.0] | 10.2 [6.2, 24.2] | $2.2685 |
| edit: mtek unconstrained+guide | 115 | 89 / 8 / 18 | 91.8 % | 24,252 | 10,966 [10,528, 23,136] | 11,026 [10,679, 23,017] | 0.0 [0.0, 1.0] | 9.0 [6.8, 16.2] | $2.6992 |
| edit: baseline unconstrained | 115 | 113 / 2 / 0 | 98.3 % | 6,780 | 5,006 [4,689, 5,412] | 4,994 [4,688, 5,354] | 0.0 [0.0, 0.0] | 11.0 [7.5, 14.0] | $1.1722 |

### Per task

| task | category | mode | mtek unconstrained | mtek unconstrained+guide | baseline unconstrained |
| --- | --- | --- | --- | --- | --- |
| interaction-01 | interaction | edit | 5/5 done, 11,702 tok/done, $0.0563 | 5/5 done, 10,614 tok/done, $0.0748 | 5/5 done, 4,658 tok/done, $0.0369 |
| interaction-02 | interaction | edit | 5/5 done, 31,770 tok/done, $0.1446 | 4/5 done, 51,725 tok/done, $0.1515 | 5/5 done, 6,175 tok/done, $0.0512 |
| interaction-03 | interaction | edit | 5/5 done, 32,730 tok/done, $0.1691 | 4/5 done, 74,084 tok/done, $0.2210 | 5/5 done, 10,847 tok/done, $0.0686 |
| interaction-04 | interaction | edit | 3/5 done, 45,560 tok/done, $0.1235 | 5/5 done, 34,273 tok/done, $0.1326 | 5/5 done, 7,325 tok/done, $0.0592 |
| interaction-05 | interaction | edit | 0/5 done, UNDEFINED tok/done, $0.1524 | 5/5 done, 18,135 tok/done, $0.0993 | 4/5 done, 11,183 tok/done, $0.0621 |
| interaction-06 | interaction | edit | 5/5 done, 5,237 tok/done, $0.0421 | 4/5 done, 10,609 tok/done, $0.0953 | 5/5 done, 9,234 tok/done, $0.0822 |
| interaction-07 | interaction | edit | 2/5 done, 93,432 tok/done, $0.2007 | 2/5 done, 82,744 tok/done, $0.1518 | 5/5 done, 6,570 tok/done, $0.0574 |
| interaction-08 | interaction | cold | 1/5 done, 198,075 tok/done, $0.1749 | 4/5 done, 13,967 tok/done, $0.1168 | 5/5 done, 4,943 tok/done, $0.0426 |
| interaction-09 | interaction | edit | 1/5 done, 124,437 tok/done, $0.1327 | 3/5 done, 44,110 tok/done, $0.1566 | 5/5 done, 5,545 tok/done, $0.0575 |
| interaction-10 | interaction | edit | 4/5 done, 20,909 tok/done, $0.1205 | 3/5 done, 47,040 tok/done, $0.1600 | 4/5 done, 13,332 tok/done, $0.0756 |
| interaction-11 | interaction | edit | 1/5 done, 111,380 tok/done, $0.1436 | 3/5 done, 46,886 tok/done, $0.1469 | 5/5 done, 5,019 tok/done, $0.0458 |
| maintenance-01 | maintenance | edit | 4/5 done, 4,866 tok/done, $0.0554 | 4/5 done, 10,209 tok/done, $0.0894 | 5/5 done, 4,309 tok/done, $0.0276 |
| maintenance-02 | maintenance | edit | 4/5 done, 8,658 tok/done, $0.0646 | 4/5 done, 11,222 tok/done, $0.0998 | 5/5 done, 4,720 tok/done, $0.0384 |
| maintenance-03 | maintenance | edit | 4/5 done, 11,250 tok/done, $0.0673 | 4/5 done, 16,191 tok/done, $0.0986 | 5/5 done, 4,464 tok/done, $0.0347 |
| maintenance-04 | maintenance | edit | 4/5 done, 5,595 tok/done, $0.0646 | 4/5 done, 14,071 tok/done, $0.1056 | 5/5 done, 8,365 tok/done, $0.0540 |
| maintenance-05 | maintenance | edit | 4/5 done, 5,534 tok/done, $0.0630 | 4/5 done, 10,839 tok/done, $0.0963 | 5/5 done, 4,971 tok/done, $0.0432 |
| maintenance-06 | maintenance | edit | 4/5 done, 6,026 tok/done, $0.0652 | 3/5 done, 27,524 tok/done, $0.1104 | 5/5 done, 5,146 tok/done, $0.0490 |
| scene-rendering-01 | scene-rendering | cold | 4/5 done, 8,433 tok/done, $0.0812 | 4/5 done, 13,685 tok/done, $0.1134 | 5/5 done, 4,261 tok/done, $0.0289 |
| scene-rendering-02 | scene-rendering | cold | 4/5 done, 11,011 tok/done, $0.0891 | 4/5 done, 14,040 tok/done, $0.1190 | 5/5 done, 5,646 tok/done, $0.0431 |
| scene-rendering-03 | scene-rendering | cold | 4/5 done, 26,870 tok/done, $0.1293 | 4/5 done, 14,458 tok/done, $0.1241 | 5/5 done, 5,101 tok/done, $0.0488 |
| scene-rendering-04 | scene-rendering | cold | 4/5 done, 11,569 tok/done, $0.0912 | 4/5 done, 14,002 tok/done, $0.1171 | 5/5 done, 4,898 tok/done, $0.0411 |
| scene-rendering-05 | scene-rendering | edit | 4/5 done, 8,594 tok/done, $0.0681 | 4/5 done, 19,846 tok/done, $0.1102 | 5/5 done, 6,200 tok/done, $0.0526 |
| scene-rendering-06 | scene-rendering | cold | 0/5 done, UNDEFINED tok/done, $0.1695 | 0/5 done, UNDEFINED tok/done, $0.1835 | 4/5 done, 25,153 tok/done, $0.1255 |
| scene-rendering-07 | scene-rendering | cold | 1/5 done, 143,440 tok/done, $0.1252 | 0/5 done, UNDEFINED tok/done, $0.1823 | 0/5 done, UNDEFINED tok/done, $0.1405 |
| scene-rendering-08 | scene-rendering | edit | 4/5 done, 5,134 tok/done, $0.0577 | 4/5 done, 10,557 tok/done, $0.0933 | 5/5 done, 5,710 tok/done, $0.0401 |
| scene-rendering-09 | scene-rendering | cold | 4/5 done, 14,798 tok/done, $0.1058 | 4/5 done, 14,300 tok/done, $0.1218 | 5/5 done, 5,190 tok/done, $0.0517 |
| scene-rendering-10 | scene-rendering | cold | 0/5 done, UNDEFINED tok/done, $0.1541 | 1/5 done, 257,778 tok/done, $0.1861 | 2/5 done, 67,302 tok/done, $0.1381 |
| scene-rendering-11 | scene-rendering | cold | 0/5 done, UNDEFINED tok/done, $0.2179 | 1/5 done, 287,645 tok/done, $0.2290 | 3/5 done, 30,578 tok/done, $0.1247 |
| shader-bridge-01 | shader-bridge | edit | 0/5 done, UNDEFINED tok/done, $0.0969 | 4/5 done, 10,491 tok/done, $0.0956 | 5/5 done, 5,624 tok/done, $0.0444 |
| shader-bridge-02 | shader-bridge | edit | 0/5 done, UNDEFINED tok/done, $0.1010 | 4/5 done, 10,967 tok/done, $0.1018 | 5/5 done, 9,076 tok/done, $0.0662 |
| shader-bridge-03 | shader-bridge | cold | 3/5 done, 41,035 tok/done, $0.1423 | 4/5 done, 38,991 tok/done, $0.1594 | 4/5 done, 16,559 tok/done, $0.0904 |
| shader-bridge-04 | shader-bridge | edit | 1/5 done, 138,634 tok/done, $0.1436 | 4/5 done, 23,018 tok/done, $0.1204 | 5/5 done, 4,768 tok/done, $0.0381 |
| shader-bridge-05 | shader-bridge | edit | 4/5 done, 5,330 tok/done, $0.0586 | 4/5 done, 10,710 tok/done, $0.0934 | 5/5 done, 7,027 tok/done, $0.0468 |
| shader-bridge-06 | shader-bridge | edit | 4/5 done, 14,782 tok/done, $0.0771 | 4/5 done, 10,745 tok/done, $0.0947 | 5/5 done, 7,858 tok/done, $0.0407 |

## Documentation given to the model

| side | largest documentation in bytes |
| --- | --- |
| baseline | 9,803 |
| mtek+guide | 37,182 |
| mtek | 22,638 |

## Attempts that could not be judged

| attempt | outcome | reason |
| --- | --- | --- |
| interaction-06--mtek-guide-unconstrained--04 | error | transport-error: Request timed out. (no response from the model; record made before decision 0124, read as not judged) |
| interaction-07--unconstrained--04 | error | transport-error: Request timed out. (no response from the model; record made before decision 0124, read as not judged) |
| interaction-07--mtek-guide-unconstrained--04 | error | transport-error: Request timed out. (no response from the model; record made before decision 0124, read as not judged) |
| interaction-08--unconstrained--04 | error | transport-error: Request timed out. (no response from the model; record made before decision 0124, read as not judged) |
| interaction-08--mtek-guide-unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| interaction-09--unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| interaction-09--mtek-guide-unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| interaction-10--unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| interaction-10--mtek-guide-unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| interaction-11--unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| interaction-11--mtek-guide-unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| maintenance-01--unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| maintenance-01--mtek-guide-unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| maintenance-02--unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| maintenance-02--mtek-guide-unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| maintenance-03--unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| maintenance-03--mtek-guide-unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| maintenance-04--unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| maintenance-04--mtek-guide-unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| maintenance-05--unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| maintenance-05--mtek-guide-unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| maintenance-06--unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| maintenance-06--mtek-guide-unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| scene-rendering-01--unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| scene-rendering-01--mtek-guide-unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| scene-rendering-02--unconstrained--04 | error | transport-error: Request timed out. (no response from the model; record made before decision 0124, read as not judged) |
| scene-rendering-02--mtek-guide-unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| scene-rendering-03--unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| scene-rendering-03--mtek-guide-unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| scene-rendering-04--unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| scene-rendering-04--mtek-guide-unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| scene-rendering-05--unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| scene-rendering-05--mtek-guide-unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| scene-rendering-06--unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| scene-rendering-06--mtek-guide-unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| scene-rendering-07--unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| scene-rendering-07--mtek-guide-unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| scene-rendering-08--unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| scene-rendering-08--mtek-guide-unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| scene-rendering-09--unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| scene-rendering-09--mtek-guide-unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| scene-rendering-10--unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| scene-rendering-10--mtek-guide-unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| scene-rendering-11--unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| scene-rendering-11--mtek-guide-unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| shader-bridge-01--unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| shader-bridge-01--mtek-guide-unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| shader-bridge-02--unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| shader-bridge-02--mtek-guide-unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| shader-bridge-03--unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| shader-bridge-03--mtek-guide-unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| shader-bridge-04--unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| shader-bridge-04--mtek-guide-unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| shader-bridge-05--unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| shader-bridge-05--mtek-guide-unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| shader-bridge-06--unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |
| shader-bridge-06--mtek-guide-unconstrained--04 | error | transport-error: Connection error. (no response from the model; record made before decision 0124, read as not judged) |

57 of the 510 attempts ended with the reason `transport-error`: the model could not be reached (a connection error or a timeout, no response at all). That is a failure of the network or the service, not of the model: these attempts are not judged, are out of every completion rate and of tokens per completed task, and are listed here. By condition: mtek unconstrained+guide 29, mtek unconstrained 28.

57 of them are read by a legacy rule (decision 0124): the records were made before the harness retried and marked such attempts, and say outcome `failure`, reason `generation-error`. An attempt is read as `error` / `transport-error` when it is recorded that way, its reason is `generation-error` and EVERY model call of it is `backend-error` with the error text `Connection error.` or `Request timed out.`, no response text, no tokens and no HTTP status. An attempt with any other call, or with another error text, stays a failure. The records are not changed.

## Holdout (reported apart, by ids and layer outcomes only)

No holdout attempt is in these records.

## All attempts

| attempt | task | category | mode | side | kind | outcome | reason | calls | repairs | input | cache read | cache write | output | cost | seconds | first attempt parse/check/build/start/tests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| interaction-01--unconstrained--00 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 11,202 | 4,818 | 6,378 | 719 | $0.0121 | 12.6 | pass/fail/not-run/not-run/not-run |
| interaction-01--mtek-guide-unconstrained--00 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,164 | 0 | 10,161 | 462 | $0.0150 | 7.5 | pass/pass/pass/pass/pass |
| interaction-02--unconstrained--00 | interaction-02 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 23,336 | 13,043 | 10,284 | 2,523 | $0.0268 | 25.6 | fail/fail/not-run/not-run/not-run |
| interaction-02--mtek-guide-unconstrained--00 | interaction-02 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 50,870 | 35,184 | 15,674 | 2,643 | $0.0363 | 28.8 | fail/fail/not-run/not-run/not-run |
| interaction-03--unconstrained--00 | interaction-03 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 40,026 | 26,292 | 13,722 | 3,818 | $0.0389 | 36.6 | fail/fail/not-run/not-run/not-run |
| interaction-03--mtek-guide-unconstrained--00 | interaction-03 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 56,239 | 36,680 | 19,547 | 2,997 | $0.0431 | 30.1 | fail/fail/not-run/not-run/not-run |
| interaction-04--unconstrained--00 | interaction-04 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 30,868 | 20,935 | 9,921 | 3,580 | $0.0324 | 34.0 | fail/fail/not-run/not-run/not-run |
| interaction-04--mtek-guide-unconstrained--00 | interaction-04 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 51,635 | 35,860 | 15,763 | 2,176 | $0.0342 | 23.4 | pass/fail/not-run/not-run/not-run |
| interaction-05--unconstrained--00 | interaction-05 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 35,561 | 23,737 | 11,812 | 2,835 | $0.0313 | 26.5 | fail/fail/not-run/not-run/not-run |
| interaction-05--mtek-guide-unconstrained--00 | interaction-05 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,090 | 0 | 10,087 | 972 | $0.0175 | 13.1 | pass/pass/pass/pass/pass |
| interaction-06--unconstrained--00 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 4,738 | 0 | 4,735 | 542 | $0.0086 | 9.5 | pass/pass/pass/pass/pass |
| interaction-06--mtek-guide-unconstrained--00 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,081 | 0 | 10,078 | 391 | $0.0146 | 8.4 | pass/pass/pass/pass/pass |
| interaction-07--unconstrained--00 | interaction-07 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 36,857 | 22,234 | 14,611 | 3,599 | $0.0385 | 30.4 | none/none/none/none/none |
| interaction-07--mtek-guide-unconstrained--00 | interaction-07 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 48,112 | 34,280 | 13,820 | 2,475 | $0.0331 | 32.4 | none/none/none/none/none |
| interaction-08--unconstrained--00 | interaction-08 | interaction | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 43,867 | 30,136 | 13,719 | 4,043 | $0.0404 | 36.7 | fail/fail/not-run/not-run/not-run |
| interaction-08--mtek-guide-unconstrained--00 | interaction-08 | interaction | cold | mtek | unconstrained | success |  | 1 | 0 | 13,504 | 0 | 13,501 | 484 | $0.0193 | 9.8 | pass/pass/pass/pass/pass |
| interaction-09--unconstrained--00 | interaction-09 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 31,795 | 21,148 | 10,635 | 3,056 | $0.0307 | 43.7 | pass/fail/not-run/not-run/not-run |
| interaction-09--mtek-guide-unconstrained--00 | interaction-09 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,387 | 0 | 10,384 | 1,088 | $0.0184 | 12.9 | pass/pass/pass/pass/pass |
| interaction-10--unconstrained--00 | interaction-10 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 15,515 | 4,831 | 10,678 | 2,299 | $0.0253 | 24.3 | fail/fail/not-run/not-run/not-run |
| interaction-10--mtek-guide-unconstrained--00 | interaction-10 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,177 | 0 | 10,174 | 1,160 | $0.0185 | 15.3 | pass/pass/pass/pass/pass |
| interaction-11--unconstrained--00 | interaction-11 | interaction | edit | mtek | unconstrained | failure | budget-wall-clock | 3 | 3 | 22,716 | 11,357 | 11,350 | 2,932 | $0.0300 | 626.0 | pass/pass/pass/pass/fail |
| interaction-11--mtek-guide-unconstrained--00 | interaction-11 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 50,940 | 36,029 | 14,899 | 2,839 | $0.0364 | 40.4 | pass/pass/pass/pass/fail |
| maintenance-01--unconstrained--00 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 4,582 | 0 | 4,579 | 290 | $0.0072 | 5.6 | pass/pass/pass/pass/pass |
| maintenance-01--mtek-guide-unconstrained--00 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 9,925 | 0 | 9,922 | 291 | $0.0139 | 5.7 | pass/pass/pass/pass/pass |
| maintenance-02--unconstrained--00 | maintenance-02 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,291 | 0 | 5,288 | 513 | $0.0092 | 7.0 | pass/pass/pass/pass/pass |
| maintenance-02--mtek-guide-unconstrained--00 | maintenance-02 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,634 | 0 | 10,631 | 827 | $0.0174 | 10.0 | pass/pass/pass/pass/pass |
| maintenance-03--unconstrained--00 | maintenance-03 | maintenance | edit | mtek | unconstrained | success |  | 2 | 1 | 10,760 | 4,853 | 5,901 | 484 | $0.0103 | 8.9 | pass/fail/not-run/not-run/not-run |
| maintenance-03--mtek-guide-unconstrained--00 | maintenance-03 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,199 | 0 | 10,196 | 444 | $0.0150 | 8.2 | pass/pass/pass/pass/pass |
| maintenance-04--unconstrained--00 | maintenance-04 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 4,977 | 0 | 4,974 | 738 | $0.0099 | 10.9 | pass/pass/pass/pass/pass |
| maintenance-04--mtek-guide-unconstrained--00 | maintenance-04 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,320 | 0 | 10,317 | 649 | $0.0161 | 9.7 | pass/pass/pass/pass/pass |
| maintenance-05--unconstrained--00 | maintenance-05 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,004 | 0 | 5,001 | 561 | $0.0091 | 7.7 | pass/pass/pass/pass/pass |
| maintenance-05--mtek-guide-unconstrained--00 | maintenance-05 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,347 | 0 | 10,344 | 473 | $0.0153 | 7.4 | pass/pass/pass/pass/pass |
| maintenance-06--unconstrained--00 | maintenance-06 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,561 | 0 | 5,558 | 438 | $0.0091 | 8.7 | pass/pass/pass/pass/pass |
| maintenance-06--mtek-guide-unconstrained--00 | maintenance-06 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,904 | 0 | 10,901 | 445 | $0.0159 | 8.0 | pass/pass/pass/pass/pass |
| scene-rendering-01--unconstrained--00 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 7,994 | 0 | 7,991 | 503 | $0.0125 | 7.7 | pass/pass/pass/pass/pass |
| scene-rendering-01--mtek-guide-unconstrained--00 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,337 | 0 | 13,334 | 409 | $0.0187 | 6.9 | pass/pass/pass/pass/pass |
| scene-rendering-02--unconstrained--00 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | success |  | 2 | 1 | 16,858 | 8,100 | 8,752 | 883 | $0.0162 | 11.1 | none/none/none/none/none |
| scene-rendering-02--mtek-guide-unconstrained--00 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,446 | 0 | 13,443 | 590 | $0.0198 | 8.1 | pass/pass/pass/pass/pass |
| scene-rendering-03--unconstrained--00 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | success |  | 3 | 2 | 30,777 | 18,710 | 12,058 | 1,311 | $0.0235 | 17.7 | fail/fail/not-run/not-run/not-run |
| scene-rendering-03--mtek-guide-unconstrained--00 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,686 | 0 | 13,683 | 614 | $0.0202 | 9.0 | pass/pass/pass/pass/pass |
| scene-rendering-04--unconstrained--00 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 8,188 | 0 | 8,185 | 687 | $0.0137 | 9.6 | pass/pass/pass/pass/pass |
| scene-rendering-04--mtek-guide-unconstrained--00 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,531 | 0 | 13,528 | 411 | $0.0190 | 7.2 | pass/pass/pass/pass/pass |
| scene-rendering-05--unconstrained--00 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 4,903 | 0 | 4,900 | 526 | $0.0088 | 6.1 | pass/pass/pass/pass/pass |
| scene-rendering-05--mtek-guide-unconstrained--00 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | success |  | 2 | 1 | 22,219 | 10,243 | 11,970 | 971 | $0.0208 | 12.9 | pass/fail/not-run/not-run/not-run |
| scene-rendering-06--unconstrained--00 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 52,864 | 36,316 | 16,536 | 2,520 | $0.0369 | 26.3 | fail/fail/not-run/not-run/not-run |
| scene-rendering-06--mtek-guide-unconstrained--00 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 62,931 | 45,584 | 17,335 | 2,360 | $0.0380 | 30.5 | pass/pass/pass/pass/fail |
| scene-rendering-07--unconstrained--00 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 39,815 | 28,538 | 11,265 | 1,158 | $0.0227 | 23.5 | pass/pass/pass/pass/fail |
| scene-rendering-07--mtek-guide-unconstrained--00 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 61,589 | 44,690 | 16,887 | 1,713 | $0.0342 | 28.0 | pass/pass/pass/pass/fail |
| scene-rendering-08--unconstrained--00 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 4,800 | 0 | 4,797 | 305 | $0.0075 | 5.5 | pass/pass/pass/pass/pass |
| scene-rendering-08--mtek-guide-unconstrained--00 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 10,143 | 0 | 10,140 | 417 | $0.0148 | 8.9 | pass/pass/pass/pass/pass |
| scene-rendering-09--unconstrained--00 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | success |  | 2 | 1 | 18,752 | 8,282 | 10,464 | 1,212 | $0.0200 | 16.5 | fail/fail/not-run/not-run/not-run |
| scene-rendering-09--mtek-guide-unconstrained--00 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,628 | 0 | 13,625 | 674 | $0.0204 | 9.5 | pass/pass/pass/pass/pass |
| scene-rendering-10--unconstrained--00 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 52,597 | 36,311 | 16,274 | 2,224 | $0.0351 | 22.0 | fail/fail/not-run/not-run/not-run |
| scene-rendering-10--mtek-guide-unconstrained--00 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 60,861 | 43,995 | 16,854 | 2,124 | $0.0361 | 26.3 | none/none/none/none/none |
| scene-rendering-11--unconstrained--00 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 59,033 | 38,681 | 20,340 | 3,143 | $0.0450 | 23.6 | fail/fail/not-run/not-run/not-run |
| scene-rendering-11--mtek-guide-unconstrained--00 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 71,809 | 50,246 | 21,551 | 4,670 | $0.0553 | 45.2 | none/none/none/none/none |
| shader-bridge-01--unconstrained--00 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 23,839 | 16,447 | 7,380 | 1,491 | $0.0183 | 24.1 | pass/pass/pass/pass/fail |
| shader-bridge-01--mtek-guide-unconstrained--00 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 9,887 | 0 | 9,884 | 567 | $0.0152 | 8.0 | pass/pass/pass/pass/pass |
| shader-bridge-02--unconstrained--00 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 26,307 | 17,852 | 8,443 | 1,289 | $0.0188 | 20.1 | pass/pass/pass/pass/fail |
| shader-bridge-02--mtek-guide-unconstrained--00 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 10,129 | 0 | 10,126 | 841 | $0.0169 | 9.0 | pass/pass/pass/pass/pass |
| shader-bridge-03--unconstrained--00 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | success |  | 2 | 1 | 19,079 | 8,186 | 10,887 | 2,036 | $0.0246 | 21.8 | fail/fail/not-run/not-run/not-run |
| shader-bridge-03--mtek-guide-unconstrained--00 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | success |  | 2 | 1 | 28,496 | 13,529 | 14,961 | 1,262 | $0.0264 | 17.0 | pass/pass/pass/pass/fail |
| shader-bridge-04--unconstrained--00 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 26,774 | 18,207 | 8,555 | 1,371 | $0.0194 | 16.9 | pass/fail/not-run/not-run/not-run |
| shader-bridge-04--mtek-guide-unconstrained--00 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | success |  | 3 | 2 | 34,034 | 21,441 | 12,584 | 1,962 | $0.0277 | 27.0 | pass/pass/pass/pass/fail |
| shader-bridge-05--unconstrained--00 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 5,026 | 0 | 5,023 | 312 | $0.0078 | 5.9 | pass/pass/pass/pass/pass |
| shader-bridge-05--mtek-guide-unconstrained--00 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 10,369 | 0 | 10,366 | 352 | $0.0147 | 6.9 | pass/pass/pass/pass/pass |
| shader-bridge-06--unconstrained--00 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | success |  | 3 | 2 | 16,433 | 10,458 | 5,966 | 748 | $0.0123 | 10.7 | none/none/none/none/none |
| shader-bridge-06--mtek-guide-unconstrained--00 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 10,322 | 0 | 10,319 | 441 | $0.0151 | 7.7 | pass/pass/pass/pass/pass |
| interaction-01--unconstrained--01 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 11,733 | 4,818 | 6,909 | 706 | $0.0127 | 10.1 | fail/fail/not-run/not-run/not-run |
| interaction-01--mtek-guide-unconstrained--01 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,164 | 0 | 10,161 | 482 | $0.0151 | 7.9 | pass/pass/pass/pass/pass |
| interaction-02--unconstrained--01 | interaction-02 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 39,933 | 25,253 | 14,668 | 4,247 | $0.0421 | 38.5 | fail/fail/not-run/not-run/not-run |
| interaction-02--mtek-guide-unconstrained--01 | interaction-02 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 23,271 | 10,032 | 13,233 | 1,341 | $0.0243 | 15.5 | fail/fail/not-run/not-run/not-run |
| interaction-03--unconstrained--01 | interaction-03 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 15,415 | 4,730 | 10,679 | 2,742 | $0.0275 | 25.6 | fail/fail/not-run/not-run/not-run |
| interaction-03--mtek-guide-unconstrained--01 | interaction-03 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 55,010 | 36,880 | 18,118 | 3,601 | $0.0444 | 30.4 | fail/fail/not-run/not-run/not-run |
| interaction-04--unconstrained--01 | interaction-04 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 18,233 | 10,877 | 7,347 | 1,283 | $0.0167 | 20.3 | pass/fail/not-run/not-run/not-run |
| interaction-04--mtek-guide-unconstrained--01 | interaction-04 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 33,040 | 20,777 | 12,254 | 1,788 | $0.0263 | 20.1 | none/none/none/none/none |
| interaction-05--unconstrained--01 | interaction-05 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 38,480 | 25,077 | 13,391 | 3,177 | $0.0351 | 27.6 | fail/fail/not-run/not-run/not-run |
| interaction-05--mtek-guide-unconstrained--01 | interaction-05 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 32,955 | 21,138 | 11,808 | 2,044 | $0.0271 | 20.3 | none/none/none/none/none |
| interaction-06--unconstrained--01 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 4,738 | 0 | 4,735 | 513 | $0.0085 | 9.1 | pass/pass/pass/pass/pass |
| interaction-06--mtek-guide-unconstrained--01 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,081 | 0 | 10,078 | 656 | $0.0159 | 9.9 | pass/pass/pass/pass/pass |
| interaction-07--unconstrained--01 | interaction-07 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 42,945 | 26,931 | 16,002 | 4,261 | $0.0440 | 41.0 | fail/fail/not-run/not-run/not-run |
| interaction-07--mtek-guide-unconstrained--01 | interaction-07 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 48,396 | 34,434 | 13,950 | 1,925 | $0.0305 | 25.6 | none/none/none/none/none |
| interaction-08--unconstrained--01 | interaction-08 | interaction | cold | mtek | unconstrained | success |  | 4 | 3 | 43,584 | 30,064 | 13,508 | 2,952 | $0.0347 | 28.5 | fail/fail/not-run/not-run/not-run |
| interaction-08--mtek-guide-unconstrained--01 | interaction-08 | interaction | cold | mtek | unconstrained | success |  | 1 | 0 | 13,504 | 0 | 13,501 | 578 | $0.0198 | 8.5 | pass/pass/pass/pass/pass |
| interaction-09--unconstrained--01 | interaction-09 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 31,223 | 20,963 | 10,248 | 1,951 | $0.0247 | 28.1 | fail/fail/not-run/not-run/not-run |
| interaction-09--mtek-guide-unconstrained--01 | interaction-09 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 25,136 | 10,384 | 14,746 | 2,128 | $0.0301 | 19.3 | fail/fail/not-run/not-run/not-run |
| interaction-10--unconstrained--01 | interaction-10 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 26,467 | 14,140 | 12,318 | 1,825 | $0.0259 | 21.7 | fail/fail/not-run/not-run/not-run |
| interaction-10--mtek-guide-unconstrained--01 | interaction-10 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 47,841 | 34,254 | 13,575 | 4,014 | $0.0405 | 30.4 | none/none/none/none/none |
| interaction-11--unconstrained--01 | interaction-11 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 11,290 | 4,868 | 6,416 | 1,903 | $0.0180 | 24.1 | pass/pass/pass/pass/fail |
| interaction-11--mtek-guide-unconstrained--01 | interaction-11 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 49,899 | 35,324 | 14,563 | 2,935 | $0.0364 | 42.2 | pass/pass/pass/pass/fail |
| maintenance-01--unconstrained--01 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 4,582 | 0 | 4,579 | 256 | $0.0070 | 5.2 | pass/pass/pass/pass/pass |
| maintenance-01--mtek-guide-unconstrained--01 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 9,925 | 0 | 9,922 | 292 | $0.0139 | 5.4 | pass/pass/pass/pass/pass |
| maintenance-02--unconstrained--01 | maintenance-02 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,291 | 0 | 5,288 | 475 | $0.0090 | 7.5 | pass/pass/pass/pass/pass |
| maintenance-02--mtek-guide-unconstrained--01 | maintenance-02 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,634 | 0 | 10,631 | 660 | $0.0166 | 8.8 | pass/pass/pass/pass/pass |
| maintenance-03--unconstrained--01 | maintenance-03 | maintenance | edit | mtek | unconstrained | success |  | 3 | 2 | 16,797 | 10,389 | 6,399 | 593 | $0.0120 | 9.9 | none/none/none/none/none |
| maintenance-03--mtek-guide-unconstrained--01 | maintenance-03 | maintenance | edit | mtek | unconstrained | success |  | 2 | 1 | 21,516 | 10,196 | 11,314 | 557 | $0.0180 | 9.0 | pass/fail/not-run/not-run/not-run |
| maintenance-04--unconstrained--01 | maintenance-04 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 4,977 | 0 | 4,974 | 641 | $0.0094 | 10.3 | pass/pass/pass/pass/pass |
| maintenance-04--mtek-guide-unconstrained--01 | maintenance-04 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,320 | 0 | 10,317 | 947 | $0.0176 | 12.6 | pass/pass/pass/pass/pass |
| maintenance-05--unconstrained--01 | maintenance-05 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,004 | 0 | 5,001 | 547 | $0.0090 | 7.6 | pass/pass/pass/pass/pass |
| maintenance-05--mtek-guide-unconstrained--01 | maintenance-05 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,347 | 0 | 10,344 | 598 | $0.0159 | 7.8 | pass/pass/pass/pass/pass |
| maintenance-06--unconstrained--01 | maintenance-06 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,561 | 0 | 5,558 | 506 | $0.0095 | 8.8 | pass/pass/pass/pass/pass |
| maintenance-06--mtek-guide-unconstrained--01 | maintenance-06 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,904 | 0 | 10,901 | 435 | $0.0158 | 7.2 | pass/pass/pass/pass/pass |
| scene-rendering-01--unconstrained--01 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 7,994 | 0 | 7,991 | 407 | $0.0120 | 6.6 | pass/pass/pass/pass/pass |
| scene-rendering-01--mtek-guide-unconstrained--01 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,337 | 0 | 13,334 | 286 | $0.0181 | 5.4 | pass/pass/pass/pass/pass |
| scene-rendering-02--unconstrained--01 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 8,103 | 0 | 8,100 | 660 | $0.0134 | 9.8 | pass/pass/pass/pass/pass |
| scene-rendering-02--mtek-guide-unconstrained--01 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,446 | 0 | 13,443 | 631 | $0.0200 | 8.1 | pass/pass/pass/pass/pass |
| scene-rendering-03--unconstrained--01 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | success |  | 2 | 1 | 17,561 | 8,340 | 9,215 | 1,389 | $0.0193 | 14.9 | none/none/none/none/none |
| scene-rendering-03--mtek-guide-unconstrained--01 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,686 | 0 | 13,683 | 970 | $0.0220 | 12.0 | pass/pass/pass/pass/pass |
| scene-rendering-04--unconstrained--01 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | success |  | 2 | 1 | 19,026 | 8,185 | 10,835 | 821 | $0.0185 | 11.1 | fail/fail/not-run/not-run/not-run |
| scene-rendering-04--mtek-guide-unconstrained--01 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,531 | 0 | 13,528 | 635 | $0.0201 | 8.9 | pass/pass/pass/pass/pass |
| scene-rendering-05--unconstrained--01 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | success |  | 2 | 1 | 11,088 | 4,900 | 6,182 | 786 | $0.0122 | 10.5 | pass/fail/not-run/not-run/not-run |
| scene-rendering-05--mtek-guide-unconstrained--01 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | success |  | 2 | 1 | 22,043 | 10,243 | 11,794 | 782 | $0.0197 | 10.5 | fail/fail/not-run/not-run/not-run |
| scene-rendering-06--unconstrained--01 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 43,994 | 30,923 | 13,059 | 3,013 | $0.0345 | 39.2 | pass/pass/pass/pass/fail |
| scene-rendering-06--mtek-guide-unconstrained--01 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 63,874 | 46,123 | 17,739 | 2,472 | $0.0392 | 34.3 | pass/pass/pass/pass/fail |
| scene-rendering-07--unconstrained--01 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | success |  | 2 | 1 | 18,113 | 8,306 | 9,801 | 1,267 | $0.0194 | 18.5 | pass/pass/pass/pass/fail |
| scene-rendering-07--mtek-guide-unconstrained--01 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 63,202 | 45,177 | 18,013 | 3,404 | $0.0441 | 38.6 | pass/pass/pass/pass/fail |
| scene-rendering-08--unconstrained--01 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 4,800 | 0 | 4,797 | 304 | $0.0075 | 5.1 | pass/pass/pass/pass/pass |
| scene-rendering-08--mtek-guide-unconstrained--01 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 10,143 | 0 | 10,140 | 328 | $0.0143 | 5.0 | pass/pass/pass/pass/pass |
| scene-rendering-09--unconstrained--01 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 8,285 | 0 | 8,282 | 734 | $0.0140 | 9.9 | pass/pass/pass/pass/pass |
| scene-rendering-09--mtek-guide-unconstrained--01 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,628 | 0 | 13,625 | 674 | $0.0204 | 9.3 | pass/pass/pass/pass/pass |
| scene-rendering-10--unconstrained--01 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 41,479 | 29,255 | 12,212 | 2,308 | $0.0297 | 32.6 | pass/pass/pass/pass/fail |
| scene-rendering-10--mtek-guide-unconstrained--01 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 63,313 | 45,652 | 17,649 | 2,109 | $0.0372 | 31.5 | pass/pass/pass/pass/fail |
| scene-rendering-11--unconstrained--01 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 49,338 | 33,596 | 15,730 | 4,097 | $0.0435 | 39.8 | fail/fail/not-run/not-run/not-run |
| scene-rendering-11--mtek-guide-unconstrained--01 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 64,189 | 46,072 | 18,105 | 2,520 | $0.0399 | 29.7 | pass/fail/not-run/not-run/not-run |
| shader-bridge-01--unconstrained--01 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 25,056 | 17,320 | 7,724 | 1,364 | $0.0182 | 20.3 | pass/fail/not-run/not-run/not-run |
| shader-bridge-01--mtek-guide-unconstrained--01 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 9,887 | 0 | 9,884 | 565 | $0.0152 | 7.8 | pass/pass/pass/pass/pass |
| shader-bridge-02--unconstrained--01 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 25,839 | 17,591 | 8,236 | 1,133 | $0.0177 | 16.4 | pass/pass/pass/pass/fail |
| shader-bridge-02--mtek-guide-unconstrained--01 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 10,129 | 0 | 10,126 | 828 | $0.0168 | 9.7 | pass/pass/pass/pass/pass |
| shader-bridge-03--unconstrained--01 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 44,791 | 31,329 | 13,450 | 3,158 | $0.0357 | 29.3 | fail/fail/not-run/not-run/not-run |
| shader-bridge-03--mtek-guide-unconstrained--01 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | success |  | 3 | 2 | 46,352 | 29,218 | 17,125 | 2,464 | $0.0367 | 26.9 | pass/pass/pass/pass/fail |
| shader-bridge-04--unconstrained--01 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 35,365 | 22,588 | 12,765 | 2,290 | $0.0297 | 23.0 | fail/fail/not-run/not-run/not-run |
| shader-bridge-04--mtek-guide-unconstrained--01 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | success |  | 2 | 1 | 21,492 | 10,093 | 11,393 | 1,189 | $0.0212 | 16.6 | pass/pass/pass/pass/fail |
| shader-bridge-05--unconstrained--01 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 5,026 | 0 | 5,023 | 258 | $0.0076 | 5.6 | pass/pass/pass/pass/pass |
| shader-bridge-05--mtek-guide-unconstrained--01 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 10,369 | 0 | 10,366 | 330 | $0.0146 | 6.7 | pass/pass/pass/pass/pass |
| shader-bridge-06--unconstrained--01 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | success |  | 2 | 1 | 11,066 | 4,976 | 6,084 | 612 | $0.0112 | 10.2 | pass/fail/not-run/not-run/not-run |
| shader-bridge-06--mtek-guide-unconstrained--01 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 10,322 | 0 | 10,319 | 369 | $0.0147 | 7.1 | pass/pass/pass/pass/pass |
| interaction-01--unconstrained--02 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 10,802 | 4,818 | 5,978 | 412 | $0.0100 | 8.1 | pass/fail/not-run/not-run/not-run |
| interaction-01--mtek-guide-unconstrained--02 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,164 | 0 | 10,161 | 334 | $0.0144 | 6.6 | pass/pass/pass/pass/pass |
| interaction-02--unconstrained--02 | interaction-02 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 35,380 | 23,505 | 11,863 | 2,322 | $0.0288 | 26.2 | fail/fail/not-run/not-run/not-run |
| interaction-02--mtek-guide-unconstrained--02 | interaction-02 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 22,369 | 10,032 | 12,331 | 1,369 | $0.0233 | 16.2 | fail/fail/not-run/not-run/not-run |
| interaction-03--unconstrained--02 | interaction-03 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 14,072 | 4,730 | 9,336 | 2,714 | $0.0257 | 24.8 | fail/fail/not-run/not-run/not-run |
| interaction-03--mtek-guide-unconstrained--02 | interaction-03 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 58,209 | 37,725 | 20,472 | 3,816 | $0.0485 | 35.4 | fail/fail/not-run/not-run/not-run |
| interaction-04--unconstrained--02 | interaction-04 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 22,082 | 11,452 | 10,621 | 2,728 | $0.0281 | 26.4 | fail/fail/not-run/not-run/not-run |
| interaction-04--mtek-guide-unconstrained--02 | interaction-04 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 22,953 | 9,921 | 13,026 | 1,317 | $0.0239 | 14.9 | fail/fail/not-run/not-run/not-run |
| interaction-05--unconstrained--02 | interaction-05 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 33,727 | 21,660 | 12,055 | 2,014 | $0.0273 | 24.9 | fail/fail/not-run/not-run/not-run |
| interaction-05--mtek-guide-unconstrained--02 | interaction-05 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,090 | 0 | 10,087 | 936 | $0.0173 | 12.4 | pass/pass/pass/pass/pass |
| interaction-06--unconstrained--02 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 4,738 | 0 | 4,735 | 516 | $0.0085 | 9.1 | pass/pass/pass/pass/pass |
| interaction-06--mtek-guide-unconstrained--02 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,081 | 0 | 10,078 | 526 | $0.0152 | 9.3 | pass/pass/pass/pass/pass |
| interaction-07--unconstrained--02 | interaction-07 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 43,605 | 28,323 | 15,270 | 4,155 | $0.0427 | 35.9 | fail/fail/not-run/not-run/not-run |
| interaction-07--mtek-guide-unconstrained--02 | interaction-07 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,279 | 0 | 10,276 | 1,046 | $0.0181 | 15.6 | pass/pass/pass/pass/pass |
| interaction-08--unconstrained--02 | interaction-08 | interaction | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 52,003 | 35,212 | 16,779 | 1,898 | $0.0340 | 18.9 | fail/fail/not-run/not-run/not-run |
| interaction-08--mtek-guide-unconstrained--02 | interaction-08 | interaction | cold | mtek | unconstrained | success |  | 1 | 0 | 13,504 | 0 | 13,501 | 390 | $0.0188 | 7.4 | pass/pass/pass/pass/pass |
| interaction-09--unconstrained--02 | interaction-09 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 21,035 | 12,239 | 8,787 | 1,614 | $0.0203 | 21.0 | fail/fail/not-run/not-run/not-run |
| interaction-09--mtek-guide-unconstrained--02 | interaction-09 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 34,855 | 21,970 | 12,876 | 2,802 | $0.0323 | 27.0 | none/none/none/none/none |
| interaction-10--unconstrained--02 | interaction-10 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 14,572 | 4,831 | 9,735 | 1,436 | $0.0198 | 17.9 | pass/fail/not-run/not-run/not-run |
| interaction-10--mtek-guide-unconstrained--02 | interaction-10 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 36,399 | 21,631 | 14,759 | 2,444 | $0.0328 | 25.2 | none/none/none/none/none |
| interaction-11--unconstrained--02 | interaction-11 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 34,776 | 22,358 | 12,406 | 4,164 | $0.0386 | 43.2 | fail/fail/not-run/not-run/not-run |
| interaction-11--mtek-guide-unconstrained--02 | interaction-11 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 21,520 | 10,211 | 11,303 | 1,497 | $0.0226 | 17.5 | none/none/none/none/none |
| maintenance-01--unconstrained--02 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 4,582 | 0 | 4,579 | 287 | $0.0072 | 5.2 | pass/pass/pass/pass/pass |
| maintenance-01--mtek-guide-unconstrained--02 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 9,925 | 0 | 9,922 | 280 | $0.0138 | 4.9 | pass/pass/pass/pass/pass |
| maintenance-02--unconstrained--02 | maintenance-02 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,291 | 0 | 5,288 | 171 | $0.0075 | 5.1 | pass/pass/pass/pass/pass |
| maintenance-02--mtek-guide-unconstrained--02 | maintenance-02 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,634 | 0 | 10,631 | 461 | $0.0156 | 7.4 | pass/pass/pass/pass/pass |
| maintenance-03--unconstrained--02 | maintenance-03 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 4,856 | 0 | 4,853 | 344 | $0.0078 | 6.3 | pass/pass/pass/pass/pass |
| maintenance-03--mtek-guide-unconstrained--02 | maintenance-03 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,199 | 0 | 10,196 | 296 | $0.0142 | 5.8 | pass/pass/pass/pass/pass |
| maintenance-04--unconstrained--02 | maintenance-04 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 4,977 | 0 | 4,974 | 532 | $0.0089 | 8.3 | pass/pass/pass/pass/pass |
| maintenance-04--mtek-guide-unconstrained--02 | maintenance-04 | maintenance | edit | mtek | unconstrained | success |  | 2 | 1 | 21,987 | 10,317 | 11,664 | 1,095 | $0.0211 | 17.0 | pass/pass/pass/pass/fail |
| maintenance-05--unconstrained--02 | maintenance-05 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,004 | 0 | 5,001 | 430 | $0.0084 | 6.7 | pass/pass/pass/pass/pass |
| maintenance-05--mtek-guide-unconstrained--02 | maintenance-05 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,347 | 0 | 10,344 | 504 | $0.0155 | 7.1 | pass/pass/pass/pass/pass |
| maintenance-06--unconstrained--02 | maintenance-06 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,561 | 0 | 5,558 | 485 | $0.0094 | 8.9 | pass/pass/pass/pass/pass |
| maintenance-06--mtek-guide-unconstrained--02 | maintenance-06 | maintenance | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 46,825 | 34,410 | 12,403 | 1,614 | $0.0270 | 10.6 | none/none/none/none/none |
| scene-rendering-01--unconstrained--02 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 7,994 | 0 | 7,991 | 425 | $0.0121 | 6.7 | pass/pass/pass/pass/pass |
| scene-rendering-01--mtek-guide-unconstrained--02 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,337 | 0 | 13,334 | 401 | $0.0187 | 6.2 | pass/pass/pass/pass/pass |
| scene-rendering-02--unconstrained--02 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 8,103 | 0 | 8,100 | 673 | $0.0135 | 9.5 | pass/pass/pass/pass/pass |
| scene-rendering-02--mtek-guide-unconstrained--02 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,446 | 0 | 13,443 | 549 | $0.0196 | 7.5 | pass/pass/pass/pass/pass |
| scene-rendering-03--unconstrained--02 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 8,343 | 0 | 8,340 | 948 | $0.0152 | 11.6 | pass/pass/pass/pass/pass |
| scene-rendering-03--mtek-guide-unconstrained--02 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,686 | 0 | 13,683 | 590 | $0.0201 | 8.4 | pass/pass/pass/pass/pass |
| scene-rendering-04--unconstrained--02 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 8,188 | 0 | 8,185 | 645 | $0.0135 | 9.0 | pass/pass/pass/pass/pass |
| scene-rendering-04--mtek-guide-unconstrained--02 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,531 | 0 | 13,528 | 409 | $0.0190 | 7.0 | pass/pass/pass/pass/pass |
| scene-rendering-05--unconstrained--02 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | success |  | 2 | 1 | 11,039 | 4,900 | 6,133 | 717 | $0.0117 | 10.2 | pass/fail/not-run/not-run/not-run |
| scene-rendering-05--mtek-guide-unconstrained--02 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 10,246 | 0 | 10,243 | 649 | $0.0161 | 9.2 | pass/pass/pass/pass/pass |
| scene-rendering-06--unconstrained--02 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 42,387 | 30,020 | 12,355 | 2,367 | $0.0303 | 32.4 | pass/pass/pass/pass/fail |
| scene-rendering-06--mtek-guide-unconstrained--02 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 60,903 | 44,069 | 16,822 | 1,716 | $0.0340 | 26.9 | pass/pass/pass/pass/fail |
| scene-rendering-07--unconstrained--02 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 39,927 | 28,493 | 11,422 | 1,498 | $0.0246 | 24.9 | pass/pass/pass/pass/fail |
| scene-rendering-07--mtek-guide-unconstrained--02 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 61,422 | 44,646 | 16,764 | 1,490 | $0.0329 | 25.5 | pass/pass/pass/pass/fail |
| scene-rendering-08--unconstrained--02 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 4,800 | 0 | 4,797 | 308 | $0.0075 | 5.5 | pass/pass/pass/pass/pass |
| scene-rendering-08--mtek-guide-unconstrained--02 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 10,143 | 0 | 10,140 | 461 | $0.0150 | 5.8 | pass/pass/pass/pass/pass |
| scene-rendering-09--unconstrained--02 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | success |  | 2 | 1 | 19,073 | 8,282 | 10,785 | 1,540 | $0.0220 | 17.3 | fail/fail/not-run/not-run/not-run |
| scene-rendering-09--mtek-guide-unconstrained--02 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,628 | 0 | 13,625 | 665 | $0.0204 | 8.2 | pass/pass/pass/pass/pass |
| scene-rendering-10--unconstrained--02 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 43,097 | 30,464 | 12,621 | 2,017 | $0.0289 | 24.6 | fail/fail/not-run/not-run/not-run |
| scene-rendering-10--mtek-guide-unconstrained--02 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 62,989 | 45,211 | 17,766 | 2,254 | $0.0380 | 31.8 | pass/pass/pass/pass/fail |
| scene-rendering-11--unconstrained--02 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 53,344 | 34,330 | 19,002 | 3,251 | $0.0435 | 26.4 | fail/fail/not-run/not-run/not-run |
| scene-rendering-11--mtek-guide-unconstrained--02 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | success |  | 4 | 3 | 71,177 | 48,677 | 22,488 | 2,980 | $0.0479 | 30.1 | none/none/none/none/none |
| shader-bridge-01--unconstrained--02 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 23,616 | 16,265 | 7,339 | 948 | $0.0156 | 16.6 | pass/pass/pass/pass/fail |
| shader-bridge-01--mtek-guide-unconstrained--02 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 9,887 | 0 | 9,884 | 650 | $0.0156 | 8.6 | pass/pass/pass/pass/pass |
| shader-bridge-02--unconstrained--02 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 26,165 | 17,798 | 8,355 | 1,131 | $0.0179 | 17.4 | pass/pass/pass/pass/fail |
| shader-bridge-02--mtek-guide-unconstrained--02 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 10,129 | 0 | 10,126 | 829 | $0.0168 | 8.9 | pass/pass/pass/pass/pass |
| shader-bridge-03--unconstrained--02 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | success |  | 3 | 2 | 29,996 | 18,436 | 11,551 | 1,339 | $0.0230 | 17.1 | fail/fail/not-run/not-run/not-run |
| shader-bridge-03--mtek-guide-unconstrained--02 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | success |  | 1 | 0 | 13,532 | 0 | 13,529 | 786 | $0.0208 | 11.0 | pass/pass/pass/pass/pass |
| shader-bridge-04--unconstrained--02 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | success |  | 4 | 3 | 31,780 | 20,586 | 11,182 | 3,184 | $0.0320 | 30.2 | none/none/none/none/none |
| shader-bridge-04--mtek-guide-unconstrained--02 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | success |  | 2 | 1 | 21,446 | 10,093 | 11,347 | 1,256 | $0.0215 | 16.7 | pass/pass/pass/pass/fail |
| shader-bridge-05--unconstrained--02 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 5,026 | 0 | 5,023 | 327 | $0.0079 | 5.8 | pass/pass/pass/pass/pass |
| shader-bridge-05--mtek-guide-unconstrained--02 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 10,369 | 0 | 10,366 | 347 | $0.0147 | 6.9 | pass/pass/pass/pass/pass |
| shader-bridge-06--unconstrained--02 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | success |  | 3 | 2 | 17,119 | 10,606 | 6,504 | 699 | $0.0127 | 10.7 | none/none/none/none/none |
| shader-bridge-06--mtek-guide-unconstrained--02 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 10,322 | 0 | 10,319 | 524 | $0.0155 | 8.0 | pass/pass/pass/pass/pass |
| interaction-01--unconstrained--03 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 10,949 | 4,818 | 6,125 | 551 | $0.0109 | 9.2 | pass/fail/not-run/not-run/not-run |
| interaction-01--mtek-guide-unconstrained--03 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,164 | 0 | 10,161 | 504 | $0.0152 | 7.5 | pass/pass/pass/pass/pass |
| interaction-02--unconstrained--03 | interaction-02 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 12,492 | 4,689 | 7,797 | 1,202 | $0.0162 | 15.0 | pass/fail/not-run/not-run/not-run |
| interaction-02--mtek-guide-unconstrained--03 | interaction-02 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 51,881 | 35,698 | 16,171 | 3,195 | $0.0398 | 31.5 | fail/fail/not-run/not-run/not-run |
| interaction-03--unconstrained--03 | interaction-03 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 40,634 | 25,120 | 15,502 | 3,680 | $0.0403 | 34.8 | fail/fail/not-run/not-run/not-run |
| interaction-03--mtek-guide-unconstrained--03 | interaction-03 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 53,645 | 36,845 | 16,788 | 3,391 | $0.0416 | 32.8 | fail/fail/not-run/not-run/not-run |
| interaction-04--unconstrained--03 | interaction-04 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 26,537 | 17,447 | 9,078 | 2,386 | $0.0250 | 21.6 | none/none/none/none/none |
| interaction-04--mtek-guide-unconstrained--03 | interaction-04 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 34,284 | 20,638 | 13,637 | 1,309 | $0.0257 | 16.3 | none/none/none/none/none |
| interaction-05--unconstrained--03 | interaction-05 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 37,206 | 24,414 | 12,780 | 4,226 | $0.0396 | 32.2 | fail/fail/not-run/not-run/not-run |
| interaction-05--mtek-guide-unconstrained--03 | interaction-05 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,090 | 0 | 10,087 | 897 | $0.0171 | 12.4 | pass/pass/pass/pass/pass |
| interaction-06--unconstrained--03 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 4,738 | 0 | 4,735 | 489 | $0.0084 | 9.2 | pass/pass/pass/pass/pass |
| interaction-06--mtek-guide-unconstrained--03 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,081 | 0 | 10,078 | 538 | $0.0153 | 10.0 | pass/pass/pass/pass/pass |
| interaction-07--unconstrained--03 | interaction-07 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 46,406 | 30,389 | 16,005 | 5,036 | $0.0482 | 48.2 | fail/fail/not-run/not-run/not-run |
| interaction-07--mtek-guide-unconstrained--03 | interaction-07 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 50,558 | 35,722 | 14,824 | 2,696 | $0.0356 | 54.3 | pass/pass/pass/pass/fail |
| interaction-08--unconstrained--03 | interaction-08 | interaction | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 47,516 | 32,496 | 15,008 | 2,212 | $0.0331 | 23.0 | fail/fail/not-run/not-run/not-run |
| interaction-08--mtek-guide-unconstrained--03 | interaction-08 | interaction | cold | mtek | unconstrained | success |  | 1 | 0 | 13,504 | 0 | 13,501 | 399 | $0.0189 | 7.4 | pass/pass/pass/pass/pass |
| interaction-09--unconstrained--03 | interaction-09 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 30,872 | 20,492 | 10,368 | 2,891 | $0.0295 | 42.5 | pass/fail/not-run/not-run/not-run |
| interaction-09--mtek-guide-unconstrained--03 | interaction-09 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 52,355 | 36,899 | 15,444 | 3,580 | $0.0409 | 33.7 | fail/fail/not-run/not-run/not-run |
| interaction-10--unconstrained--03 | interaction-10 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 19,499 | 10,773 | 8,717 | 2,021 | $0.0221 | 22.9 | none/none/none/none/none |
| interaction-10--mtek-guide-unconstrained--03 | interaction-10 | interaction | edit | mtek | unconstrained | success |  | 3 | 2 | 36,518 | 21,692 | 14,817 | 2,568 | $0.0335 | 27.0 | none/none/none/none/none |
| interaction-11--unconstrained--03 | interaction-11 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 30,659 | 20,255 | 10,392 | 2,940 | $0.0297 | 39.1 | pass/pass/pass/pass/fail |
| interaction-11--mtek-guide-unconstrained--03 | interaction-11 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,214 | 0 | 10,211 | 814 | $0.0168 | 12.2 | pass/pass/pass/pass/pass |
| maintenance-01--unconstrained--03 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 4,582 | 0 | 4,579 | 302 | $0.0072 | 6.0 | pass/pass/pass/pass/pass |
| maintenance-01--mtek-guide-unconstrained--03 | maintenance-01 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 9,925 | 0 | 9,922 | 272 | $0.0138 | 5.2 | pass/pass/pass/pass/pass |
| maintenance-02--unconstrained--03 | maintenance-02 | maintenance | edit | mtek | unconstrained | success |  | 3 | 2 | 17,043 | 11,106 | 5,928 | 558 | $0.0113 | 10.0 | none/none/none/none/none |
| maintenance-02--mtek-guide-unconstrained--03 | maintenance-02 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,634 | 0 | 10,631 | 404 | $0.0153 | 7.4 | pass/pass/pass/pass/pass |
| maintenance-03--unconstrained--03 | maintenance-03 | maintenance | edit | mtek | unconstrained | success |  | 2 | 1 | 10,720 | 4,853 | 5,861 | 444 | $0.0100 | 8.5 | pass/fail/not-run/not-run/not-run |
| maintenance-03--mtek-guide-unconstrained--03 | maintenance-03 | maintenance | edit | mtek | unconstrained | success |  | 2 | 1 | 21,081 | 10,196 | 10,879 | 470 | $0.0170 | 8.4 | none/none/none/none/none |
| maintenance-04--unconstrained--03 | maintenance-04 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 4,977 | 0 | 4,974 | 562 | $0.0090 | 9.1 | pass/pass/pass/pass/pass |
| maintenance-04--mtek-guide-unconstrained--03 | maintenance-04 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,320 | 0 | 10,317 | 646 | $0.0161 | 9.1 | pass/pass/pass/pass/pass |
| maintenance-05--unconstrained--03 | maintenance-05 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,004 | 0 | 5,001 | 581 | $0.0092 | 8.2 | pass/pass/pass/pass/pass |
| maintenance-05--mtek-guide-unconstrained--03 | maintenance-05 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,347 | 0 | 10,344 | 391 | $0.0149 | 6.6 | pass/pass/pass/pass/pass |
| maintenance-06--unconstrained--03 | maintenance-06 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 5,561 | 0 | 5,558 | 429 | $0.0091 | 8.2 | pass/pass/pass/pass/pass |
| maintenance-06--mtek-guide-unconstrained--03 | maintenance-06 | maintenance | edit | mtek | unconstrained | success |  | 1 | 0 | 10,904 | 0 | 10,901 | 542 | $0.0163 | 8.9 | pass/pass/pass/pass/pass |
| scene-rendering-01--unconstrained--03 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 7,994 | 0 | 7,991 | 419 | $0.0121 | 6.9 | pass/pass/pass/pass/pass |
| scene-rendering-01--mtek-guide-unconstrained--03 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,337 | 0 | 13,334 | 294 | $0.0181 | 5.4 | pass/pass/pass/pass/pass |
| scene-rendering-02--unconstrained--03 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 8,103 | 0 | 8,100 | 659 | $0.0134 | 10.0 | pass/pass/pass/pass/pass |
| scene-rendering-02--mtek-guide-unconstrained--03 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,446 | 0 | 13,443 | 607 | $0.0198 | 8.2 | pass/pass/pass/pass/pass |
| scene-rendering-03--unconstrained--03 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | success |  | 4 | 3 | 43,594 | 29,475 | 14,107 | 3,558 | $0.0384 | 31.3 | none/none/none/none/none |
| scene-rendering-03--mtek-guide-unconstrained--03 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,686 | 0 | 13,683 | 915 | $0.0217 | 11.7 | pass/pass/pass/pass/pass |
| scene-rendering-04--unconstrained--03 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 8,188 | 0 | 8,185 | 533 | $0.0129 | 8.3 | pass/pass/pass/pass/pass |
| scene-rendering-04--mtek-guide-unconstrained--03 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,531 | 0 | 13,528 | 428 | $0.0191 | 7.2 | pass/pass/pass/pass/pass |
| scene-rendering-05--unconstrained--03 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 4,903 | 0 | 4,900 | 412 | $0.0082 | 6.5 | pass/pass/pass/pass/pass |
| scene-rendering-05--mtek-guide-unconstrained--03 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | success |  | 2 | 1 | 21,731 | 10,243 | 11,482 | 743 | $0.0191 | 10.2 | pass/fail/not-run/not-run/not-run |
| scene-rendering-06--unconstrained--03 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 43,422 | 30,513 | 12,897 | 3,117 | $0.0348 | 40.2 | pass/pass/pass/pass/fail |
| scene-rendering-06--mtek-guide-unconstrained--03 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 60,628 | 44,010 | 16,606 | 1,362 | $0.0320 | 24.0 | pass/pass/pass/pass/fail |
| scene-rendering-07--unconstrained--03 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 40,010 | 28,599 | 11,399 | 1,652 | $0.0254 | 26.4 | pass/pass/pass/pass/fail |
| scene-rendering-07--mtek-guide-unconstrained--03 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 60,939 | 44,385 | 16,542 | 1,147 | $0.0309 | 23.9 | pass/pass/pass/pass/fail |
| scene-rendering-08--unconstrained--03 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 4,800 | 0 | 4,797 | 417 | $0.0081 | 6.3 | pass/pass/pass/pass/pass |
| scene-rendering-08--mtek-guide-unconstrained--03 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | success |  | 1 | 0 | 10,143 | 0 | 10,140 | 448 | $0.0149 | 5.8 | pass/pass/pass/pass/pass |
| scene-rendering-09--unconstrained--03 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 8,285 | 0 | 8,282 | 1,309 | $0.0169 | 14.9 | pass/pass/pass/pass/pass |
| scene-rendering-09--mtek-guide-unconstrained--03 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | success |  | 1 | 0 | 13,628 | 0 | 13,625 | 674 | $0.0204 | 9.2 | pass/pass/pass/pass/pass |
| scene-rendering-10--unconstrained--03 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 41,573 | 29,525 | 12,036 | 1,803 | $0.0270 | 29.4 | pass/pass/pass/pass/fail |
| scene-rendering-10--mtek-guide-unconstrained--03 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | success |  | 4 | 3 | 62,515 | 45,220 | 17,283 | 1,613 | $0.0342 | 28.0 | pass/pass/pass/pass/fail |
| scene-rendering-11--unconstrained--03 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 63,581 | 41,488 | 22,081 | 4,153 | $0.0525 | 29.0 | pass/fail/not-run/not-run/not-run |
| scene-rendering-11--mtek-guide-unconstrained--03 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | failure | max-repairs | 4 | 3 | 67,111 | 47,438 | 19,661 | 3,189 | $0.0453 | 35.5 | pass/pass/pass/pass/fail |
| shader-bridge-01--unconstrained--03 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 23,012 | 16,183 | 6,817 | 1,571 | $0.0180 | 22.0 | pass/pass/pass/pass/fail |
| shader-bridge-01--mtek-guide-unconstrained--03 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 9,887 | 0 | 9,884 | 632 | $0.0155 | 9.1 | pass/pass/pass/pass/pass |
| shader-bridge-02--unconstrained--03 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 27,001 | 18,702 | 8,287 | 1,440 | $0.0194 | 18.3 | pass/fail/not-run/not-run/not-run |
| shader-bridge-02--mtek-guide-unconstrained--03 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 10,129 | 0 | 10,126 | 853 | $0.0169 | 10.3 | pass/pass/pass/pass/pass |
| shader-bridge-03--unconstrained--03 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | success |  | 2 | 1 | 20,794 | 8,186 | 12,602 | 1,913 | $0.0261 | 20.3 | fail/fail/not-run/not-run/not-run |
| shader-bridge-03--mtek-guide-unconstrained--03 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | success |  | 4 | 3 | 61,084 | 44,234 | 16,838 | 1,986 | $0.0354 | 23.2 | pass/pass/pass/pass/fail |
| shader-bridge-04--unconstrained--03 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 34,110 | 22,567 | 11,531 | 3,760 | $0.0355 | 32.5 | fail/fail/not-run/not-run/not-run |
| shader-bridge-04--mtek-guide-unconstrained--03 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 10,096 | 0 | 10,093 | 598 | $0.0156 | 8.5 | pass/pass/pass/pass/pass |
| shader-bridge-05--unconstrained--03 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 5,026 | 0 | 5,023 | 318 | $0.0079 | 6.0 | pass/pass/pass/pass/pass |
| shader-bridge-05--mtek-guide-unconstrained--03 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 10,369 | 0 | 10,366 | 333 | $0.0146 | 6.8 | pass/pass/pass/pass/pass |
| shader-bridge-06--unconstrained--03 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | success |  | 2 | 1 | 11,453 | 4,976 | 6,471 | 997 | $0.0136 | 13.9 | pass/fail/not-run/not-run/not-run |
| shader-bridge-06--mtek-guide-unconstrained--03 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | success |  | 1 | 0 | 10,322 | 0 | 10,319 | 357 | $0.0147 | 6.8 | pass/pass/pass/pass/pass |
| interaction-01--unconstrained--04 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 10,919 | 4,818 | 6,095 | 519 | $0.0107 | 9.1 | pass/fail/not-run/not-run/not-run |
| interaction-01--mtek-guide-unconstrained--04 | interaction-01 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 10,164 | 0 | 10,161 | 466 | $0.0150 | 7.9 | pass/pass/pass/pass/pass |
| interaction-02--unconstrained--04 | interaction-02 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 34,740 | 22,738 | 11,990 | 2,677 | $0.0307 | 27.6 | fail/fail/not-run/not-run/not-run |
| interaction-02--mtek-guide-unconstrained--04 | interaction-02 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 48,590 | 34,564 | 14,014 | 1,372 | $0.0278 | 18.0 | fail/fail/not-run/not-run/not-run |
| interaction-03--unconstrained--04 | interaction-03 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 37,016 | 23,718 | 13,286 | 3,535 | $0.0367 | 33.5 | fail/fail/not-run/not-run/not-run |
| interaction-03--mtek-guide-unconstrained--04 | interaction-03 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 56,370 | 36,757 | 19,601 | 3,058 | $0.0435 | 30.8 | fail/fail/not-run/not-run/not-run |
| interaction-04--unconstrained--04 | interaction-04 | interaction | edit | mtek | unconstrained | success |  | 4 | 3 | 27,288 | 18,542 | 8,734 | 1,696 | $0.0213 | 24.3 | pass/fail/not-run/not-run/not-run |
| interaction-04--mtek-guide-unconstrained--04 | interaction-04 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 21,417 | 9,921 | 11,490 | 1,446 | $0.0226 | 16.2 | fail/fail/not-run/not-run/not-run |
| interaction-05--unconstrained--04 | interaction-05 | interaction | edit | mtek | unconstrained | failure | max-repairs | 4 | 3 | 27,222 | 18,697 | 8,513 | 1,309 | $0.0191 | 19.2 | pass/fail/not-run/not-run/not-run |
| interaction-05--mtek-guide-unconstrained--04 | interaction-05 | interaction | edit | mtek | unconstrained | success |  | 2 | 1 | 21,626 | 10,087 | 11,533 | 974 | $0.0203 | 17.0 | pass/pass/pass/pass/fail |
| interaction-06--unconstrained--04 | interaction-06 | interaction | edit | mtek | unconstrained | success |  | 1 | 0 | 4,738 | 0 | 4,735 | 437 | $0.0081 | 8.3 | pass/pass/pass/pass/pass |
| interaction-06--mtek-guide-unconstrained--04 | interaction-06 | interaction | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0343 | 10.8 | - |
| interaction-07--unconstrained--04 | interaction-07 | interaction | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0273 | 10.8 | - |
| interaction-07--mtek-guide-unconstrained--04 | interaction-07 | interaction | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0346 | 10.8 | - |
| interaction-08--unconstrained--04 | interaction-08 | interaction | cold | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0328 | 10.8 | - |
| interaction-08--mtek-guide-unconstrained--04 | interaction-08 | interaction | cold | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0401 | 0.2 | - |
| interaction-09--unconstrained--04 | interaction-09 | interaction | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0276 | 0.2 | - |
| interaction-09--mtek-guide-unconstrained--04 | interaction-09 | interaction | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0349 | 0.2 | - |
| interaction-10--unconstrained--04 | interaction-10 | interaction | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0273 | 0.2 | - |
| interaction-10--mtek-guide-unconstrained--04 | interaction-10 | interaction | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0346 | 0.2 | - |
| interaction-11--unconstrained--04 | interaction-11 | interaction | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0273 | 0.2 | - |
| interaction-11--mtek-guide-unconstrained--04 | interaction-11 | interaction | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0346 | 0.2 | - |
| maintenance-01--unconstrained--04 | maintenance-01 | maintenance | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0268 | 0.2 | - |
| maintenance-01--mtek-guide-unconstrained--04 | maintenance-01 | maintenance | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0341 | 0.2 | - |
| maintenance-02--unconstrained--04 | maintenance-02 | maintenance | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0276 | 0.2 | - |
| maintenance-02--mtek-guide-unconstrained--04 | maintenance-02 | maintenance | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0349 | 0.2 | - |
| maintenance-03--unconstrained--04 | maintenance-03 | maintenance | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0272 | 0.2 | - |
| maintenance-03--mtek-guide-unconstrained--04 | maintenance-03 | maintenance | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0345 | 0.2 | - |
| maintenance-04--unconstrained--04 | maintenance-04 | maintenance | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0274 | 0.2 | - |
| maintenance-04--mtek-guide-unconstrained--04 | maintenance-04 | maintenance | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0346 | 0.2 | - |
| maintenance-05--unconstrained--04 | maintenance-05 | maintenance | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0274 | 0.2 | - |
| maintenance-05--mtek-guide-unconstrained--04 | maintenance-05 | maintenance | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0347 | 0.2 | - |
| maintenance-06--unconstrained--04 | maintenance-06 | maintenance | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0281 | 0.2 | - |
| maintenance-06--mtek-guide-unconstrained--04 | maintenance-06 | maintenance | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0354 | 0.2 | - |
| scene-rendering-01--unconstrained--04 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0325 | 0.2 | - |
| scene-rendering-01--mtek-guide-unconstrained--04 | scene-rendering-01 | scene-rendering | cold | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0398 | 0.2 | - |
| scene-rendering-02--unconstrained--04 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0326 | 10.3 | - |
| scene-rendering-02--mtek-guide-unconstrained--04 | scene-rendering-02 | scene-rendering | cold | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0399 | 0.2 | - |
| scene-rendering-03--unconstrained--04 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0329 | 0.2 | - |
| scene-rendering-03--mtek-guide-unconstrained--04 | scene-rendering-03 | scene-rendering | cold | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0402 | 0.2 | - |
| scene-rendering-04--unconstrained--04 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0327 | 0.2 | - |
| scene-rendering-04--mtek-guide-unconstrained--04 | scene-rendering-04 | scene-rendering | cold | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0400 | 0.2 | - |
| scene-rendering-05--unconstrained--04 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0272 | 0.2 | - |
| scene-rendering-05--mtek-guide-unconstrained--04 | scene-rendering-05 | scene-rendering | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0345 | 0.2 | - |
| scene-rendering-06--unconstrained--04 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0330 | 0.2 | - |
| scene-rendering-06--mtek-guide-unconstrained--04 | scene-rendering-06 | scene-rendering | cold | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0403 | 0.2 | - |
| scene-rendering-07--unconstrained--04 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0331 | 0.2 | - |
| scene-rendering-07--mtek-guide-unconstrained--04 | scene-rendering-07 | scene-rendering | cold | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0404 | 0.2 | - |
| scene-rendering-08--unconstrained--04 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0271 | 0.2 | - |
| scene-rendering-08--mtek-guide-unconstrained--04 | scene-rendering-08 | scene-rendering | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0343 | 0.2 | - |
| scene-rendering-09--unconstrained--04 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0329 | 0.2 | - |
| scene-rendering-09--mtek-guide-unconstrained--04 | scene-rendering-09 | scene-rendering | cold | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0402 | 0.2 | - |
| scene-rendering-10--unconstrained--04 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0333 | 0.2 | - |
| scene-rendering-10--mtek-guide-unconstrained--04 | scene-rendering-10 | scene-rendering | cold | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0406 | 0.2 | - |
| scene-rendering-11--unconstrained--04 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0334 | 0.2 | - |
| scene-rendering-11--mtek-guide-unconstrained--04 | scene-rendering-11 | scene-rendering | cold | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0407 | 0.2 | - |
| shader-bridge-01--unconstrained--04 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0268 | 0.2 | - |
| shader-bridge-01--mtek-guide-unconstrained--04 | shader-bridge-01 | shader-bridge | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0341 | 0.2 | - |
| shader-bridge-02--unconstrained--04 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0271 | 0.2 | - |
| shader-bridge-02--mtek-guide-unconstrained--04 | shader-bridge-02 | shader-bridge | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0344 | 0.2 | - |
| shader-bridge-03--unconstrained--04 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0328 | 0.2 | - |
| shader-bridge-03--mtek-guide-unconstrained--04 | shader-bridge-03 | shader-bridge | cold | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0401 | 0.2 | - |
| shader-bridge-04--unconstrained--04 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0271 | 0.2 | - |
| shader-bridge-04--mtek-guide-unconstrained--04 | shader-bridge-04 | shader-bridge | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0344 | 0.2 | - |
| shader-bridge-05--unconstrained--04 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0274 | 0.2 | - |
| shader-bridge-05--mtek-guide-unconstrained--04 | shader-bridge-05 | shader-bridge | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0347 | 0.2 | - |
| shader-bridge-06--unconstrained--04 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0274 | 0.2 | - |
| shader-bridge-06--mtek-guide-unconstrained--04 | shader-bridge-06 | shader-bridge | edit | mtek | unconstrained | error | transport-error | 1 | 0 | 0 | 0 | - | 0 | $0.0347 | 0.2 | - |
| interaction-01--baseline-unconstrained--00 | interaction-01 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 3,980 | 0 | 0 | 779 | $0.0079 | 9.9 | pass/pass/pass/pass/pass |
| interaction-02--baseline-unconstrained--00 | interaction-02 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,076 | 0 | 0 | 888 | $0.0085 | 11.5 | pass/pass/pass/pass/pass |
| interaction-03--baseline-unconstrained--00 | interaction-03 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,111 | 0 | 4,108 | 976 | $0.0100 | 14.4 | pass/pass/pass/pass/pass |
| interaction-04--baseline-unconstrained--00 | interaction-04 | interaction | edit | baseline | unconstrained | success |  | 2 | 1 | 9,812 | 0 | 5,779 | 898 | $0.0157 | 15.4 | pass/fail/not-run/not-run/not-run |
| interaction-05--baseline-unconstrained--00 | interaction-05 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,124 | 0 | 4,121 | 841 | $0.0094 | 11.5 | pass/pass/pass/pass/pass |
| interaction-06--baseline-unconstrained--00 | interaction-06 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,098 | 0 | 0 | 1,092 | $0.0096 | 14.2 | pass/pass/pass/pass/pass |
| interaction-07--baseline-unconstrained--00 | interaction-07 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,220 | 0 | 4,217 | 1,413 | $0.0123 | 21.4 | pass/pass/pass/pass/pass |
| interaction-08--baseline-unconstrained--00 | interaction-08 | interaction | cold | baseline | unconstrained | success |  | 1 | 0 | 4,048 | 0 | 0 | 1,326 | $0.0107 | 15.9 | pass/pass/pass/pass/pass |
| interaction-09--baseline-unconstrained--00 | interaction-09 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,328 | 0 | 4,325 | 1,269 | $0.0118 | 14.0 | pass/pass/pass/pass/pass |
| interaction-10--baseline-unconstrained--00 | interaction-10 | interaction | edit | baseline | unconstrained | failure | max-repairs | 4 | 3 | 22,802 | 15,732 | 7,058 | 3,320 | $0.0270 | 25.0 | none/none/none/none/none |
| interaction-11--baseline-unconstrained--00 | interaction-11 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,248 | 0 | 4,245 | 735 | $0.0090 | 10.5 | pass/pass/pass/pass/pass |
| maintenance-01--baseline-unconstrained--00 | maintenance-01 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,008 | 0 | 0 | 336 | $0.0057 | 5.7 | pass/pass/pass/pass/pass |
| maintenance-02--baseline-unconstrained--00 | maintenance-02 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 512 | $0.0079 | 6.6 | pass/pass/pass/pass/pass |
| maintenance-03--baseline-unconstrained--00 | maintenance-03 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,104 | 0 | 4,101 | 351 | $0.0069 | 7.0 | pass/pass/pass/pass/pass |
| maintenance-04--baseline-unconstrained--00 | maintenance-04 | maintenance | edit | baseline | unconstrained | success |  | 2 | 1 | 9,839 | 4,200 | 5,633 | 1,098 | $0.0130 | 15.5 | pass/pass/pass/pass/fail |
| maintenance-05--baseline-unconstrained--00 | maintenance-05 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,325 | 0 | 4,322 | 841 | $0.0096 | 9.4 | pass/pass/pass/pass/pass |
| maintenance-06--baseline-unconstrained--00 | maintenance-06 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 946 | $0.0100 | 12.3 | pass/pass/pass/pass/pass |
| scene-rendering-01--baseline-unconstrained--00 | scene-rendering-01 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,879 | 0 | 0 | 313 | $0.0054 | 5.1 | pass/pass/pass/pass/pass |
| scene-rendering-02--baseline-unconstrained--00 | scene-rendering-02 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,988 | 0 | 0 | 508 | $0.0065 | 7.7 | pass/pass/pass/pass/pass |
| scene-rendering-03--baseline-unconstrained--00 | scene-rendering-03 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,200 | 0 | 4,197 | 1,117 | $0.0108 | 10.0 | pass/pass/pass/pass/pass |
| scene-rendering-04--baseline-unconstrained--00 | scene-rendering-04 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,069 | 0 | 0 | 868 | $0.0084 | 10.5 | pass/pass/pass/pass/pass |
| scene-rendering-05--baseline-unconstrained--00 | scene-rendering-05 | scene-rendering | edit | baseline | unconstrained | success |  | 1 | 0 | 4,167 | 0 | 4,164 | 884 | $0.0096 | 10.2 | pass/pass/pass/pass/pass |
| scene-rendering-06--baseline-unconstrained--00 | scene-rendering-06 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 31,265 | 20,323 | 10,930 | 4,346 | $0.0374 | 48.5 | pass/pass/pass/pass/fail |
| scene-rendering-07--baseline-unconstrained--00 | scene-rendering-07 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 27,624 | 18,372 | 9,240 | 2,108 | $0.0239 | 32.0 | pass/pass/pass/pass/fail |
| scene-rendering-08--baseline-unconstrained--00 | scene-rendering-08 | scene-rendering | edit | baseline | unconstrained | success |  | 1 | 0 | 4,203 | 0 | 4,200 | 382 | $0.0072 | 5.9 | pass/pass/pass/pass/pass |
| scene-rendering-09--baseline-unconstrained--00 | scene-rendering-09 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,162 | 0 | 4,159 | 1,143 | $0.0109 | 9.9 | pass/pass/pass/pass/pass |
| scene-rendering-10--baseline-unconstrained--00 | scene-rendering-10 | scene-rendering | cold | baseline | unconstrained | success |  | 2 | 1 | 11,097 | 4,303 | 6,788 | 1,678 | $0.0173 | 21.8 | pass/pass/pass/pass/fail |
| scene-rendering-11--baseline-unconstrained--00 | scene-rendering-11 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 32,761 | 20,935 | 11,814 | 3,642 | $0.0351 | 32.7 | pass/pass/pass/pass/fail |
| shader-bridge-01--baseline-unconstrained--00 | shader-bridge-01 | shader-bridge | edit | baseline | unconstrained | success |  | 2 | 1 | 8,559 | 0 | 4,611 | 1,147 | $0.0154 | 14.0 | none/none/none/none/none |
| shader-bridge-02--baseline-unconstrained--00 | shader-bridge-02 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,165 | 0 | 4,162 | 919 | $0.0098 | 11.0 | pass/pass/pass/pass/pass |
| shader-bridge-03--baseline-unconstrained--00 | shader-bridge-03 | shader-bridge | cold | baseline | unconstrained | success |  | 2 | 1 | 9,891 | 0 | 5,812 | 1,081 | $0.0167 | 13.4 | pass/fail/not-run/not-run/not-run |
| shader-bridge-04--baseline-unconstrained--00 | shader-bridge-04 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,053 | 0 | 0 | 635 | $0.0072 | 8.7 | pass/pass/pass/pass/pass |
| shader-bridge-05--baseline-unconstrained--00 | shader-bridge-05 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,186 | 0 | 4,183 | 388 | $0.0072 | 7.9 | pass/pass/pass/pass/pass |
| shader-bridge-06--baseline-unconstrained--00 | shader-bridge-06 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,231 | 0 | 4,228 | 299 | $0.0068 | 7.2 | pass/pass/pass/pass/pass |
| interaction-01--baseline-unconstrained--01 | interaction-01 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 3,980 | 0 | 0 | 584 | $0.0069 | 8.3 | pass/pass/pass/pass/pass |
| interaction-02--baseline-unconstrained--01 | interaction-02 | interaction | edit | baseline | unconstrained | success |  | 2 | 1 | 9,852 | 0 | 5,773 | 1,066 | $0.0166 | 14.2 | fail/fail/not-run/not-run/not-run |
| interaction-03--baseline-unconstrained--01 | interaction-03 | interaction | edit | baseline | unconstrained | success |  | 3 | 2 | 17,431 | 10,204 | 7,218 | 1,572 | $0.0179 | 19.6 | pass/fail/not-run/not-run/not-run |
| interaction-04--baseline-unconstrained--01 | interaction-04 | interaction | edit | baseline | unconstrained | success |  | 2 | 1 | 9,810 | 0 | 5,777 | 1,626 | $0.0194 | 20.1 | pass/fail/not-run/not-run/not-run |
| interaction-05--baseline-unconstrained--01 | interaction-05 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,124 | 0 | 4,121 | 859 | $0.0094 | 13.8 | pass/pass/pass/pass/pass |
| interaction-06--baseline-unconstrained--01 | interaction-06 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,098 | 0 | 0 | 983 | $0.0090 | 13.1 | pass/pass/pass/pass/pass |
| interaction-07--baseline-unconstrained--01 | interaction-07 | interaction | edit | baseline | unconstrained | success |  | 2 | 1 | 10,313 | 4,217 | 6,090 | 1,163 | $0.0139 | 20.3 | pass/fail/not-run/not-run/not-run |
| interaction-08--baseline-unconstrained--01 | interaction-08 | interaction | cold | baseline | unconstrained | success |  | 1 | 0 | 4,048 | 0 | 0 | 633 | $0.0072 | 11.0 | pass/pass/pass/pass/pass |
| interaction-09--baseline-unconstrained--01 | interaction-09 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,328 | 0 | 4,325 | 1,340 | $0.0121 | 18.3 | pass/pass/pass/pass/pass |
| interaction-10--baseline-unconstrained--01 | interaction-10 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,190 | 0 | 4,187 | 1,164 | $0.0111 | 17.5 | pass/pass/pass/pass/pass |
| interaction-11--baseline-unconstrained--01 | interaction-11 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,248 | 0 | 4,245 | 792 | $0.0093 | 12.5 | pass/pass/pass/pass/pass |
| maintenance-01--baseline-unconstrained--01 | maintenance-01 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,008 | 0 | 0 | 300 | $0.0055 | 5.5 | pass/pass/pass/pass/pass |
| maintenance-02--baseline-unconstrained--01 | maintenance-02 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 292 | $0.0068 | 6.2 | pass/pass/pass/pass/pass |
| maintenance-03--baseline-unconstrained--01 | maintenance-03 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,104 | 0 | 4,101 | 378 | $0.0070 | 7.1 | pass/pass/pass/pass/pass |
| maintenance-04--baseline-unconstrained--01 | maintenance-04 | maintenance | edit | baseline | unconstrained | success |  | 2 | 1 | 9,781 | 4,200 | 5,575 | 1,050 | $0.0126 | 16.2 | pass/pass/pass/pass/fail |
| maintenance-05--baseline-unconstrained--01 | maintenance-05 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,325 | 0 | 4,322 | 644 | $0.0086 | 7.0 | pass/pass/pass/pass/pass |
| maintenance-06--baseline-unconstrained--01 | maintenance-06 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 910 | $0.0099 | 11.9 | pass/pass/pass/pass/pass |
| scene-rendering-01--baseline-unconstrained--01 | scene-rendering-01 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,879 | 0 | 0 | 397 | $0.0059 | 6.0 | pass/pass/pass/pass/pass |
| scene-rendering-02--baseline-unconstrained--01 | scene-rendering-02 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,988 | 0 | 0 | 704 | $0.0075 | 9.9 | pass/pass/pass/pass/pass |
| scene-rendering-03--baseline-unconstrained--01 | scene-rendering-03 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,200 | 0 | 4,197 | 866 | $0.0096 | 8.6 | pass/pass/pass/pass/pass |
| scene-rendering-04--baseline-unconstrained--01 | scene-rendering-04 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,069 | 0 | 0 | 897 | $0.0086 | 10.5 | pass/pass/pass/pass/pass |
| scene-rendering-05--baseline-unconstrained--01 | scene-rendering-05 | scene-rendering | edit | baseline | unconstrained | success |  | 1 | 0 | 4,167 | 0 | 4,164 | 780 | $0.0091 | 9.0 | pass/pass/pass/pass/pass |
| scene-rendering-06--baseline-unconstrained--01 | scene-rendering-06 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,170 | 0 | 4,167 | 2,097 | $0.0157 | 21.0 | pass/pass/pass/pass/pass |
| scene-rendering-07--baseline-unconstrained--01 | scene-rendering-07 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 28,032 | 18,517 | 9,503 | 3,303 | $0.0303 | 43.4 | pass/pass/pass/pass/fail |
| scene-rendering-08--baseline-unconstrained--01 | scene-rendering-08 | scene-rendering | edit | baseline | unconstrained | success |  | 2 | 1 | 9,273 | 4,200 | 5,067 | 832 | $0.0109 | 9.7 | none/none/none/none/none |
| scene-rendering-09--baseline-unconstrained--01 | scene-rendering-09 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,162 | 0 | 4,159 | 1,140 | $0.0109 | 9.8 | pass/pass/pass/pass/pass |
| scene-rendering-10--baseline-unconstrained--01 | scene-rendering-10 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 27,943 | 18,399 | 9,532 | 2,960 | $0.0286 | 31.2 | none/none/none/none/none |
| scene-rendering-11--baseline-unconstrained--01 | scene-rendering-11 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 30,776 | 19,200 | 11,564 | 5,551 | $0.0441 | 40.5 | none/none/none/none/none |
| shader-bridge-01--baseline-unconstrained--01 | shader-bridge-01 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 3,945 | 0 | 0 | 669 | $0.0073 | 9.3 | pass/pass/pass/pass/pass |
| shader-bridge-02--baseline-unconstrained--01 | shader-bridge-02 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,165 | 0 | 4,162 | 917 | $0.0098 | 11.0 | pass/pass/pass/pass/pass |
| shader-bridge-03--baseline-unconstrained--01 | shader-bridge-03 | shader-bridge | cold | baseline | unconstrained | success |  | 2 | 1 | 9,887 | 0 | 5,808 | 2,282 | $0.0227 | 18.6 | none/none/none/none/none |
| shader-bridge-04--baseline-unconstrained--01 | shader-bridge-04 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,053 | 0 | 0 | 699 | $0.0075 | 9.6 | pass/pass/pass/pass/pass |
| shader-bridge-05--baseline-unconstrained--01 | shader-bridge-05 | shader-bridge | edit | baseline | unconstrained | success |  | 2 | 1 | 9,822 | 4,183 | 5,633 | 1,445 | $0.0147 | 12.0 | none/none/none/none/none |
| shader-bridge-06--baseline-unconstrained--01 | shader-bridge-06 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,231 | 0 | 4,228 | 336 | $0.0070 | 6.7 | pass/pass/pass/pass/pass |
| interaction-01--baseline-unconstrained--02 | interaction-01 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 3,980 | 0 | 0 | 664 | $0.0073 | 7.5 | pass/pass/pass/pass/pass |
| interaction-02--baseline-unconstrained--02 | interaction-02 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,076 | 0 | 0 | 930 | $0.0087 | 11.8 | pass/pass/pass/pass/pass |
| interaction-03--baseline-unconstrained--02 | interaction-03 | interaction | edit | baseline | unconstrained | success |  | 3 | 2 | 18,009 | 10,187 | 7,813 | 1,717 | $0.0194 | 19.7 | pass/fail/not-run/not-run/not-run |
| interaction-04--baseline-unconstrained--02 | interaction-04 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,030 | 0 | 0 | 807 | $0.0081 | 13.2 | pass/pass/pass/pass/pass |
| interaction-05--baseline-unconstrained--02 | interaction-05 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,124 | 0 | 4,121 | 850 | $0.0094 | 11.2 | pass/pass/pass/pass/pass |
| interaction-06--baseline-unconstrained--02 | interaction-06 | interaction | edit | baseline | unconstrained | success |  | 2 | 1 | 10,136 | 0 | 6,035 | 2,227 | $0.0228 | 18.5 | none/none/none/none/none |
| interaction-07--baseline-unconstrained--02 | interaction-07 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,220 | 0 | 4,217 | 1,037 | $0.0105 | 17.5 | pass/pass/pass/pass/pass |
| interaction-08--baseline-unconstrained--02 | interaction-08 | interaction | cold | baseline | unconstrained | success |  | 1 | 0 | 4,048 | 0 | 0 | 1,284 | $0.0105 | 15.4 | pass/pass/pass/pass/pass |
| interaction-09--baseline-unconstrained--02 | interaction-09 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,328 | 0 | 4,325 | 1,164 | $0.0112 | 13.6 | pass/pass/pass/pass/pass |
| interaction-10--baseline-unconstrained--02 | interaction-10 | interaction | edit | baseline | unconstrained | success |  | 2 | 1 | 9,450 | 4,187 | 5,257 | 1,721 | $0.0156 | 22.0 | none/none/none/none/none |
| interaction-11--baseline-unconstrained--02 | interaction-11 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,248 | 0 | 4,245 | 758 | $0.0091 | 12.2 | pass/pass/pass/pass/pass |
| maintenance-01--baseline-unconstrained--02 | maintenance-01 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,008 | 0 | 0 | 356 | $0.0058 | 6.0 | pass/pass/pass/pass/pass |
| maintenance-02--baseline-unconstrained--02 | maintenance-02 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 454 | $0.0076 | 6.7 | pass/pass/pass/pass/pass |
| maintenance-03--baseline-unconstrained--02 | maintenance-03 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,104 | 0 | 4,101 | 373 | $0.0070 | 7.4 | pass/pass/pass/pass/pass |
| maintenance-04--baseline-unconstrained--02 | maintenance-04 | maintenance | edit | baseline | unconstrained | success |  | 2 | 1 | 9,485 | 4,200 | 5,279 | 785 | $0.0109 | 10.2 | none/none/none/none/none |
| maintenance-05--baseline-unconstrained--02 | maintenance-05 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,325 | 0 | 4,322 | 455 | $0.0077 | 6.5 | pass/pass/pass/pass/pass |
| maintenance-06--baseline-unconstrained--02 | maintenance-06 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 924 | $0.0099 | 11.9 | pass/pass/pass/pass/pass |
| scene-rendering-01--baseline-unconstrained--02 | scene-rendering-01 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,879 | 0 | 0 | 380 | $0.0058 | 5.8 | pass/pass/pass/pass/pass |
| scene-rendering-02--baseline-unconstrained--02 | scene-rendering-02 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,988 | 0 | 0 | 442 | $0.0062 | 7.3 | pass/pass/pass/pass/pass |
| scene-rendering-03--baseline-unconstrained--02 | scene-rendering-03 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,200 | 0 | 4,197 | 968 | $0.0101 | 8.9 | pass/pass/pass/pass/pass |
| scene-rendering-04--baseline-unconstrained--02 | scene-rendering-04 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,069 | 0 | 0 | 958 | $0.0089 | 11.6 | pass/pass/pass/pass/pass |
| scene-rendering-05--baseline-unconstrained--02 | scene-rendering-05 | scene-rendering | edit | baseline | unconstrained | success |  | 2 | 1 | 9,368 | 4,164 | 5,198 | 1,551 | $0.0147 | 15.1 | none/none/none/none/none |
| scene-rendering-06--baseline-unconstrained--02 | scene-rendering-06 | scene-rendering | cold | baseline | unconstrained | success |  | 4 | 3 | 29,236 | 19,576 | 9,648 | 3,076 | $0.0294 | 33.1 | pass/pass/pass/pass/fail |
| scene-rendering-07--baseline-unconstrained--02 | scene-rendering-07 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 29,200 | 19,042 | 10,146 | 3,107 | $0.0301 | 35.2 | pass/pass/pass/pass/fail |
| scene-rendering-08--baseline-unconstrained--02 | scene-rendering-08 | scene-rendering | edit | baseline | unconstrained | success |  | 1 | 0 | 4,203 | 0 | 4,200 | 385 | $0.0072 | 6.0 | pass/pass/pass/pass/pass |
| scene-rendering-09--baseline-unconstrained--02 | scene-rendering-09 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,162 | 0 | 4,159 | 683 | $0.0086 | 7.6 | pass/pass/pass/pass/pass |
| scene-rendering-10--baseline-unconstrained--02 | scene-rendering-10 | scene-rendering | cold | baseline | unconstrained | success |  | 3 | 2 | 20,703 | 11,722 | 8,972 | 2,758 | $0.0262 | 29.9 | pass/pass/pass/pass/fail |
| scene-rendering-11--baseline-unconstrained--02 | scene-rendering-11 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,408 | 0 | 4,405 | 2,223 | $0.0166 | 15.2 | pass/pass/pass/pass/pass |
| shader-bridge-01--baseline-unconstrained--02 | shader-bridge-01 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 3,945 | 0 | 0 | 696 | $0.0074 | 9.7 | pass/pass/pass/pass/pass |
| shader-bridge-02--baseline-unconstrained--02 | shader-bridge-02 | shader-bridge | edit | baseline | unconstrained | success |  | 3 | 2 | 16,686 | 9,800 | 6,877 | 2,613 | $0.0227 | 23.8 | none/none/none/none/none |
| shader-bridge-03--baseline-unconstrained--02 | shader-bridge-03 | shader-bridge | cold | baseline | unconstrained | success |  | 2 | 1 | 9,907 | 0 | 5,828 | 966 | $0.0162 | 13.4 | pass/fail/not-run/not-run/not-run |
| shader-bridge-04--baseline-unconstrained--02 | shader-bridge-04 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,053 | 0 | 0 | 684 | $0.0075 | 9.1 | pass/pass/pass/pass/pass |
| shader-bridge-05--baseline-unconstrained--02 | shader-bridge-05 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,186 | 0 | 4,183 | 423 | $0.0073 | 7.7 | pass/pass/pass/pass/pass |
| shader-bridge-06--baseline-unconstrained--02 | shader-bridge-06 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,231 | 0 | 4,228 | 334 | $0.0070 | 6.6 | pass/pass/pass/pass/pass |
| interaction-01--baseline-unconstrained--03 | interaction-01 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 3,980 | 0 | 0 | 653 | $0.0072 | 6.9 | pass/pass/pass/pass/pass |
| interaction-02--baseline-unconstrained--03 | interaction-02 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,076 | 0 | 0 | 918 | $0.0087 | 11.9 | pass/pass/pass/pass/pass |
| interaction-03--baseline-unconstrained--03 | interaction-03 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,111 | 0 | 4,108 | 1,059 | $0.0104 | 13.1 | pass/pass/pass/pass/pass |
| interaction-04--baseline-unconstrained--03 | interaction-04 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,030 | 0 | 0 | 790 | $0.0080 | 13.4 | pass/pass/pass/pass/pass |
| interaction-05--baseline-unconstrained--03 | interaction-05 | interaction | edit | baseline | unconstrained | failure | max-repairs | 4 | 3 | 21,962 | 15,076 | 6,874 | 2,839 | $0.0243 | 15.0 | none/none/none/none/none |
| interaction-06--baseline-unconstrained--03 | interaction-06 | interaction | edit | baseline | unconstrained | success |  | 2 | 1 | 10,072 | 0 | 5,971 | 1,848 | $0.0208 | 27.4 | pass/pass/pass/pass/fail |
| interaction-07--baseline-unconstrained--03 | interaction-07 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,220 | 0 | 4,217 | 1,108 | $0.0108 | 18.1 | pass/pass/pass/pass/pass |
| interaction-08--baseline-unconstrained--03 | interaction-08 | interaction | cold | baseline | unconstrained | success |  | 1 | 0 | 4,048 | 0 | 0 | 723 | $0.0077 | 12.0 | pass/pass/pass/pass/pass |
| interaction-09--baseline-unconstrained--03 | interaction-09 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,328 | 0 | 4,325 | 1,137 | $0.0111 | 13.6 | pass/pass/pass/pass/pass |
| interaction-10--baseline-unconstrained--03 | interaction-10 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,190 | 0 | 4,187 | 1,133 | $0.0109 | 17.4 | pass/pass/pass/pass/pass |
| interaction-11--baseline-unconstrained--03 | interaction-11 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,248 | 0 | 4,245 | 805 | $0.0093 | 12.7 | pass/pass/pass/pass/pass |
| maintenance-01--baseline-unconstrained--03 | maintenance-01 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,008 | 0 | 0 | 213 | $0.0051 | 5.0 | pass/pass/pass/pass/pass |
| maintenance-02--baseline-unconstrained--03 | maintenance-02 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 645 | $0.0085 | 6.9 | pass/pass/pass/pass/pass |
| maintenance-03--baseline-unconstrained--03 | maintenance-03 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,104 | 0 | 4,101 | 355 | $0.0069 | 7.0 | pass/pass/pass/pass/pass |
| maintenance-04--baseline-unconstrained--03 | maintenance-04 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,203 | 0 | 4,200 | 653 | $0.0085 | 8.8 | pass/pass/pass/pass/pass |
| maintenance-05--baseline-unconstrained--03 | maintenance-05 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,325 | 0 | 4,322 | 644 | $0.0086 | 7.0 | pass/pass/pass/pass/pass |
| maintenance-06--baseline-unconstrained--03 | maintenance-06 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 906 | $0.0098 | 11.8 | pass/pass/pass/pass/pass |
| scene-rendering-01--baseline-unconstrained--03 | scene-rendering-01 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,879 | 0 | 0 | 418 | $0.0060 | 6.2 | pass/pass/pass/pass/pass |
| scene-rendering-02--baseline-unconstrained--03 | scene-rendering-02 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,988 | 0 | 0 | 768 | $0.0078 | 10.0 | pass/pass/pass/pass/pass |
| scene-rendering-03--baseline-unconstrained--03 | scene-rendering-03 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,200 | 0 | 4,197 | 719 | $0.0088 | 7.8 | pass/pass/pass/pass/pass |
| scene-rendering-04--baseline-unconstrained--03 | scene-rendering-04 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,069 | 0 | 0 | 785 | $0.0080 | 9.8 | pass/pass/pass/pass/pass |
| scene-rendering-05--baseline-unconstrained--03 | scene-rendering-05 | scene-rendering | edit | baseline | unconstrained | success |  | 1 | 0 | 4,167 | 0 | 4,164 | 904 | $0.0097 | 10.0 | pass/pass/pass/pass/pass |
| scene-rendering-06--baseline-unconstrained--03 | scene-rendering-06 | scene-rendering | cold | baseline | unconstrained | success |  | 2 | 1 | 9,858 | 4,167 | 5,685 | 2,241 | $0.0187 | 22.4 | none/none/none/none/none |
| scene-rendering-07--baseline-unconstrained--03 | scene-rendering-07 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 28,441 | 18,563 | 9,866 | 2,940 | $0.0289 | 37.8 | pass/pass/pass/pass/fail |
| scene-rendering-08--baseline-unconstrained--03 | scene-rendering-08 | scene-rendering | edit | baseline | unconstrained | success |  | 1 | 0 | 4,203 | 0 | 4,200 | 491 | $0.0077 | 6.6 | pass/pass/pass/pass/pass |
| scene-rendering-09--baseline-unconstrained--03 | scene-rendering-09 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,162 | 0 | 4,159 | 1,058 | $0.0105 | 9.6 | pass/pass/pass/pass/pass |
| scene-rendering-10--baseline-unconstrained--03 | scene-rendering-10 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 31,302 | 20,258 | 11,032 | 3,862 | $0.0351 | 48.6 | pass/pass/pass/pass/fail |
| scene-rendering-11--baseline-unconstrained--03 | scene-rendering-11 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,408 | 0 | 4,405 | 2,447 | $0.0177 | 16.0 | pass/pass/pass/pass/pass |
| shader-bridge-01--baseline-unconstrained--03 | shader-bridge-01 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 3,945 | 0 | 0 | 641 | $0.0072 | 9.2 | pass/pass/pass/pass/pass |
| shader-bridge-02--baseline-unconstrained--03 | shader-bridge-02 | shader-bridge | edit | baseline | unconstrained | success |  | 2 | 1 | 9,385 | 4,162 | 5,217 | 1,380 | $0.0138 | 14.7 | none/none/none/none/none |
| shader-bridge-03--baseline-unconstrained--03 | shader-bridge-03 | shader-bridge | cold | baseline | unconstrained | success |  | 1 | 0 | 4,076 | 0 | 0 | 766 | $0.0079 | 10.6 | pass/pass/pass/pass/pass |
| shader-bridge-04--baseline-unconstrained--03 | shader-bridge-04 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,053 | 0 | 0 | 717 | $0.0076 | 9.6 | pass/pass/pass/pass/pass |
| shader-bridge-05--baseline-unconstrained--03 | shader-bridge-05 | shader-bridge | edit | baseline | unconstrained | success |  | 2 | 1 | 9,414 | 4,183 | 5,225 | 632 | $0.0101 | 13.3 | pass/pass/pass/pass/fail |
| shader-bridge-06--baseline-unconstrained--03 | shader-bridge-06 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,231 | 0 | 4,228 | 325 | $0.0069 | 7.1 | pass/pass/pass/pass/pass |
| interaction-01--baseline-unconstrained--04 | interaction-01 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 3,980 | 0 | 0 | 710 | $0.0075 | 7.5 | pass/pass/pass/pass/pass |
| interaction-02--baseline-unconstrained--04 | interaction-02 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,076 | 0 | 0 | 918 | $0.0087 | 11.6 | pass/pass/pass/pass/pass |
| interaction-03--baseline-unconstrained--04 | interaction-03 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,111 | 0 | 4,108 | 1,136 | $0.0108 | 13.1 | pass/pass/pass/pass/pass |
| interaction-04--baseline-unconstrained--04 | interaction-04 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,030 | 0 | 0 | 791 | $0.0080 | 12.7 | pass/pass/pass/pass/pass |
| interaction-05--baseline-unconstrained--04 | interaction-05 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,124 | 0 | 4,121 | 886 | $0.0096 | 11.7 | pass/pass/pass/pass/pass |
| interaction-06--baseline-unconstrained--04 | interaction-06 | interaction | edit | baseline | unconstrained | success |  | 2 | 1 | 9,855 | 0 | 5,754 | 1,760 | $0.0201 | 23.8 | pass/pass/pass/pass/fail |
| interaction-07--baseline-unconstrained--04 | interaction-07 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,220 | 0 | 4,217 | 936 | $0.0100 | 16.7 | pass/pass/pass/pass/pass |
| interaction-08--baseline-unconstrained--04 | interaction-08 | interaction | cold | baseline | unconstrained | success |  | 1 | 0 | 4,048 | 0 | 0 | 511 | $0.0066 | 9.6 | pass/pass/pass/pass/pass |
| interaction-09--baseline-unconstrained--04 | interaction-09 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,328 | 0 | 4,325 | 1,177 | $0.0113 | 14.1 | pass/pass/pass/pass/pass |
| interaction-10--baseline-unconstrained--04 | interaction-10 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,190 | 0 | 4,187 | 1,169 | $0.0111 | 17.6 | pass/pass/pass/pass/pass |
| interaction-11--baseline-unconstrained--04 | interaction-11 | interaction | edit | baseline | unconstrained | success |  | 1 | 0 | 4,248 | 0 | 4,245 | 763 | $0.0091 | 12.2 | pass/pass/pass/pass/pass |
| maintenance-01--baseline-unconstrained--04 | maintenance-01 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,008 | 0 | 0 | 300 | $0.0055 | 5.4 | pass/pass/pass/pass/pass |
| maintenance-02--baseline-unconstrained--04 | maintenance-02 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 472 | $0.0077 | 6.4 | pass/pass/pass/pass/pass |
| maintenance-03--baseline-unconstrained--04 | maintenance-03 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,104 | 0 | 4,101 | 344 | $0.0068 | 6.8 | pass/pass/pass/pass/pass |
| maintenance-04--baseline-unconstrained--04 | maintenance-04 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,203 | 0 | 4,200 | 729 | $0.0089 | 10.5 | pass/pass/pass/pass/pass |
| maintenance-05--baseline-unconstrained--04 | maintenance-05 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,325 | 0 | 4,322 | 644 | $0.0086 | 7.0 | pass/pass/pass/pass/pass |
| maintenance-06--baseline-unconstrained--04 | maintenance-06 | maintenance | edit | baseline | unconstrained | success |  | 1 | 0 | 4,245 | 0 | 4,242 | 817 | $0.0094 | 10.8 | pass/pass/pass/pass/pass |
| scene-rendering-01--baseline-unconstrained--04 | scene-rendering-01 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 3,879 | 0 | 0 | 402 | $0.0059 | 5.8 | pass/pass/pass/pass/pass |
| scene-rendering-02--baseline-unconstrained--04 | scene-rendering-02 | scene-rendering | cold | baseline | unconstrained | success |  | 2 | 1 | 8,869 | 0 | 4,878 | 987 | $0.0150 | 11.6 | none/none/none/none/none |
| scene-rendering-03--baseline-unconstrained--04 | scene-rendering-03 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,200 | 0 | 4,197 | 836 | $0.0094 | 8.2 | pass/pass/pass/pass/pass |
| scene-rendering-04--baseline-unconstrained--04 | scene-rendering-04 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,069 | 0 | 0 | 635 | $0.0072 | 8.2 | pass/pass/pass/pass/pass |
| scene-rendering-05--baseline-unconstrained--04 | scene-rendering-05 | scene-rendering | edit | baseline | unconstrained | success |  | 1 | 0 | 4,167 | 0 | 4,164 | 847 | $0.0094 | 9.4 | pass/pass/pass/pass/pass |
| scene-rendering-06--baseline-unconstrained--04 | scene-rendering-06 | scene-rendering | cold | baseline | unconstrained | success |  | 2 | 1 | 11,348 | 4,167 | 7,175 | 2,973 | $0.0243 | 30.5 | pass/pass/pass/pass/fail |
| scene-rendering-07--baseline-unconstrained--04 | scene-rendering-07 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 27,526 | 18,260 | 9,254 | 2,774 | $0.0273 | 38.1 | pass/pass/pass/pass/fail |
| scene-rendering-08--baseline-unconstrained--04 | scene-rendering-08 | scene-rendering | edit | baseline | unconstrained | success |  | 1 | 0 | 4,203 | 0 | 4,200 | 375 | $0.0071 | 5.8 | pass/pass/pass/pass/pass |
| scene-rendering-09--baseline-unconstrained--04 | scene-rendering-09 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,162 | 0 | 4,159 | 1,118 | $0.0108 | 9.4 | pass/pass/pass/pass/pass |
| scene-rendering-10--baseline-unconstrained--04 | scene-rendering-10 | scene-rendering | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 29,052 | 18,841 | 10,199 | 3,249 | $0.0309 | 41.4 | pass/pass/pass/pass/fail |
| scene-rendering-11--baseline-unconstrained--04 | scene-rendering-11 | scene-rendering | cold | baseline | unconstrained | success |  | 1 | 0 | 4,408 | 0 | 4,405 | 1,110 | $0.0111 | 10.2 | pass/pass/pass/pass/pass |
| shader-bridge-01--baseline-unconstrained--04 | shader-bridge-01 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 3,945 | 0 | 0 | 629 | $0.0071 | 8.7 | pass/pass/pass/pass/pass |
| shader-bridge-02--baseline-unconstrained--04 | shader-bridge-02 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,165 | 0 | 4,162 | 985 | $0.0101 | 11.8 | pass/pass/pass/pass/pass |
| shader-bridge-03--baseline-unconstrained--04 | shader-bridge-03 | shader-bridge | cold | baseline | unconstrained | failure | max-repairs | 4 | 3 | 25,206 | 12,672 | 8,449 | 2,173 | $0.0268 | 28.9 | pass/fail/not-run/not-run/not-run |
| shader-bridge-04--baseline-unconstrained--04 | shader-bridge-04 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,053 | 0 | 0 | 838 | $0.0082 | 10.1 | pass/pass/pass/pass/pass |
| shader-bridge-05--baseline-unconstrained--04 | shader-bridge-05 | shader-bridge | edit | baseline | unconstrained | success |  | 1 | 0 | 4,186 | 0 | 4,183 | 455 | $0.0075 | 7.8 | pass/pass/pass/pass/pass |
| shader-bridge-06--baseline-unconstrained--04 | shader-bridge-06 | shader-bridge | edit | baseline | unconstrained | success |  | 4 | 3 | 20,237 | 14,252 | 5,973 | 836 | $0.0131 | 10.9 | none/none/none/none/none |

## How the conclusion is reached

The rule (decision 0108, applying decision 0001 and `spec/ai-and-benchmarks.md` section 6.4) compares the Mtek condition with the baseline over the tasks both have attempts at, on two axes:

- success: completion rate = completed / attempts that ended by themselves (completed or failed); "matched" when the two differ by at most 10 points, "higher" or "lower" otherwise;
- tokens per completed task = all tokens of all attempts (successes, failures, unfinished) / completed tasks; the ratio Mtek / baseline with a 95 % percentile interval from a bootstrap over tasks (4 000 resamples, fixed seed); "fewer" when the whole interval is below 1, "more" when above 1, "same" otherwise.

better = success matched or higher and tokens fewer, or success higher and tokens the same; worse = success matched or lower and tokens more, or success lower and tokens the same; equivalent = success matched and tokens the same; inconclusive = nothing completes on either side, the axes oppose each other, or no task has attempts on both sides. If only one side completes anything it is better; the other is worse. No comparison is tuned to turn "equivalent" into a win.

The research target (proposed, not a result): at matched success, at least 30 % fewer tokens per completed task than the baseline (ratio at most 0.70 and the verdict better). Missing it triggers the investigation of spec 6.4, not a cryptic syntax. A verdict is provisional when a task has fewer than 5 trials on a side, when more than 10 % of the attempts could not be judged, or when token counts are unknown.
