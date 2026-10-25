# AI/token benchmark after PR 3 (2026-10-20)

The AI benchmark was run again on `main` at the merge of PR 3 (`4e7ff0e3`, "an embedded product configurator with assemblies and typed outputs"), to see whether it changed the results of [`ai-benchmark-m7-1.md`](ai-benchmark-m7-1.md). The stored baseline in [`baseline.json`](baseline.json) is the reference.

## What was run, and why the comparison is fair

- Same model and settings as every earlier run: `claude-haiku-4-5-20251001`, temperature 1, prompt caching on, 5 trials per task per condition, unconstrained generation, the same repair loop, budgets and token accounting.
- The tasks, the holdout (tree hash unchanged), the three.js baseline, the runtime benchmark definitions and the harness are **identical** to the commit the baseline was verified at (`git diff` over `benchmarks/tasks`, `benchmarks/holdout`, `benchmarks/baselines`, `benchmarks/runtime` and `tools/ai-eval` is empty). PR 3 changed the compiler and runtime (static prefab assemblies, host outputs, correctness fixes) and the language guide by three lines; it did not touch the context export or the guide generator, and it added only a few diagnostics (for example `E9001` and `E9020` for host outputs) beside fixes of existing ones.
- Conditions: Mtek with the compiler context, Mtek with the context and the guide, and the **three.js baseline repeated** (it was measured once before, so this also gives a first measurement of run-to-run variation of an unchanged setup).
- Three processes ran in parallel under one hard cap of 15 USD on a fresh spend ledger. No attempt was lost to an error (0 not judged); the harness retries connection failures since decision 0124.
- Runs: [`pr3-main-mtek`](../../benchmarks/results/ai/pr3-main-mtek) (340 attempts), [`pr3-main-baseline`](../../benchmarks/results/ai/pr3-main-baseline) (170), and the holdout run (120, stored outside the repository; numbers only in [`holdout-summary-pr3.jsonl`](../../benchmarks/results/ai/holdout-summary-pr3.jsonl)). Report: [`report-pr3.md`](../../benchmarks/results/ai/report-pr3.md); comparison with the first M7 measurement: [`compare-pr3-vs-v01.md`](../../benchmarks/results/ai/compare-pr3-vs-v01.md).

## Result: no detectable change

Main set, 34 tasks x 5 trials per condition (completion; tokens per completed task):

| Condition | First M7 measurement | After M7.1 | After PR 3 |
|---|---|---|---|
| Mtek, context only | 60.6 % (103/170), 40,535 | 68.2 % (116/170), 33,648 | 70.0 % (119/170), 30,908 |
| Mtek, context + guide | 78.8 % (134/170), 32,842 | 85.3 % (145/170), 29,872 | 84.7 % (144/170), 29,428 |
| three.js baseline | 91.8 % (156/170), 9,388 | not re-run | 93.5 % (159/170), 9,416 |

- Against the M7.1 result the differences are +1.8 points (context only) and -0.6 points (guide), and 8 % and 1.5 % fewer tokens per completed task. By category and mode nothing moves beyond what 170 attempts show: context only cold 32/55 to 33/55 and edit 84/115 to 86/115; with the guide 39/55 to 39/55 and 106/115 to 105/115. Individual tasks that moved by two or more of five trials: `interaction-03` (5 to 3), `interaction-04` (3 to 5) and `interaction-09` (1 to 5) for context only; none with the guide. This is what noise looks like.
- **The repeat of the unchanged three.js baseline** moved from 91.8 % to 93.5 % completion (+1.7 points, 3 more of 170 attempts) and from 9,388 to 9,416 tokens per completed task (+0.3 %). So completion on 170 attempts varies by roughly two points between identical runs, and the token metric is much more stable than completion for a condition that needs few repairs. Mtek, whose attempts often need repairs, varies more; this is a single repeat, not a measured noise floor.
- By the rule of decision 0108 both Mtek conditions are still **WORSE** than the baseline: context only has a token ratio of 3.282 (95 % interval 2.336 to 4.785) and a completion gap of 23.5 points; with the guide the ratio is 3.125 (2.628 to 3.768) and the gap is 8.8 points, which the rule calls matched. The 30 % token target is not met.

Holdout (8 tasks x 5 trials, exploratory; numbers only):

| Condition | Earlier (first M7 measurement) | After M7.1 | After PR 3 |
|---|---|---|---|
| Mtek, context only | 25/40 = 62.5 %, 38,845 tokens/completed | 34/40 = 85.0 %, 17,629 | 34/40 = 85.0 %, 17,975 |
| Mtek, context + guide | not run | 39/40 = 97.5 %, 16,112 | 39/40 = 97.5 %, 18,451 |
| three.js baseline | 39/40 = 97.5 %, 7,737 | not re-run | 40/40 = 100.0 %, 7,436 |

The holdout is saturated: with the guide Mtek completes 39 of 40 attempts, so it can show a regression but not an improvement.

## Reading

PR 3 was not aimed at the agent contract (context, guide, diagnostics), and the benchmark shows no effect of it, good or bad: no regression in completion, in tokens per completed task, or in the holdout. The gap to the three.js baseline is unchanged: about 3.1 to 3.3 times the tokens per completed task.

## Money

The fresh ledger for this test ends at 11.27 USD of the 15.00 USD cap (main set Mtek 7.25, main set baseline 2.09, holdout 1.93), at list prices from provider-reported usage; no failed call was charged. The earlier ledger (23.96 USD) is separate.

Not done: constrained decoding, any other model, a repeat of the Mtek conditions (so the variation of Mtek's own results between identical runs is still not measured), and an update of [`baseline.json`](baseline.json), which still describes the end of M7.1.
