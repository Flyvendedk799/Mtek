# Cost projection for the full AI/token benchmark (from the pilot)

Arithmetic on the cost per attempt that the pilot measured; nothing here was run. `central` is the pilot mean weighted by the share of cold and edit tasks of the scope, `high` is central x 1.5 (the pilot is small), `ceiling` prices every attempt as the dearest attempt of its condition in the pilot. Wall time is the pilot's mean seconds per attempt, run one attempt at a time. The budget compared with is $8.00.

## Measured per attempt

| condition | attempts | mean cost, cold | mean cost, edit | mean cost, all | dearest attempt | mean seconds |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | 8 | $0.0068 (n=4) | $0.0083 (n=4) | $0.0075 | $0.0145 | 9.6 |
| mtek | 8 | $0.0315 (n=4) | $0.0211 (n=4) | $0.0263 | $0.0417 | 19.1 |
| mtek+guide | 6 | $0.0229 (n=4) | $0.0279 (n=2) | $0.0246 | $0.0443 | 21.2 |

## Scopes

| scope | what it runs | attempts | central | high | ceiling | fits the budget | time | what it drops |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S0 full protocol | 34 main tasks + 8 holdout tasks, 5 trials each, Mtek (compiler context) and the baseline | 420 | $6.78 | $10.18 | $11.82 | at central only | 1.7 h | nothing of the protocol |
| S1 main set at the protocol's trials | 34 main tasks, 5 trials each, Mtek (compiler context) and the baseline | 340 | $5.48 | $8.22 | $9.57 | at central only | 1.4 h | the holdout (8 tasks, 40 attempts per condition) |
| S2 S1 + the guide on half the tasks | S1, plus Mtek with docs/language-guide.md added on 17 main tasks, 3 trials each | 391 | $6.81 | $10.22 | $11.83 | at central only | 1.7 h | the holdout; the guide condition covers half the tasks with 3 trials (provisional) |
| S3 all 42 tasks at 3 trials | 34 main tasks + 8 holdout tasks, 3 trials each, Mtek (compiler context) and the baseline | 252 | $4.07 | $6.11 | $7.09 | yes, also at high | 1.0 h | trials 5 to 3: below the protocol minimum, so every verdict is provisional |
| S4 main set, three conditions at 3 trials | 34 main tasks, 3 trials each, Mtek (compiler context), Mtek with the guide, and the baseline | 306 | $5.97 | $8.95 | $10.26 | at central only | 1.4 h | the holdout; trials 5 to 3 (provisional) |
| S5 half the main set at 5 trials, three conditions | 17 main tasks (every second task), 5 trials each, Mtek (compiler context), Mtek with the guide, and the baseline | 255 | $4.98 | $7.47 | $8.55 | yes, also at high | 1.2 h | 17 of the 34 main tasks and the holdout: the subset is a sample of the set, not the set |

