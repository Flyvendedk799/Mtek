# M7-05: AI/token benchmark, summary of the result

This page summarises `benchmarks/results/ai/report.md`, which `node tools/ai-eval/src/report-cli.ts` generates from the stored records only (`benchmarks/results/ai/m7-05-main/records.jsonl`, `benchmarks/results/ai/m7-05-guide/records.jsonl` and the holdout run, which is stored outside the repository; its ids and outcomes are in `benchmarks/results/ai/holdout-summary.jsonl`). Method and the rule that turns the numbers into better, equivalent or worse: decisions [0108](../../spec/decisions/0108-ai-benchmark-run-and-report.md) and [0109](../../spec/decisions/0109-ai-benchmark-pilot-and-scopes.md); protocol: `spec/ai-and-benchmarks.md` section 6.

## What was run

- One model: `claude-haiku-4-5-20251001`, chosen because the owner asked for a cheap model within a budget of about 10 USD (a further run of the same size was approved later). Temperature 1, prompt caching on, the settings of every run are in the records.
- 34 tasks, 5 trials each, unconstrained (the constrained condition was not run: the pinned grammar backend was not installed for these runs). Conditions: Mtek with the compiler's context (`mtek context`), Mtek with the document `docs/language-guide.md` added after the context, and the three.js baseline. Every attempt used the same repair loop, budgets and token accounting on both sides (decision 0108).
- The "with the guide" condition was added after the pilot showed that the context of a cold-start task holds no field names; it is reported as its own condition, not as a replacement of the first.
- The holdout (8 tasks, 5 trials, Mtek with the compiler's context and baseline) was run apart and is reported by ids and outcomes only.
- Spend, from the provider's reported usage at list prices (not an invoice): 6.16 USD for the main set, 3.95 USD for the guide condition, 1.25 USD for the holdout, 0.44 USD for the pilot, 11.80 USD in all. Every attempt ended in success or failure; none was unfinished, errored or not run.

## Result: Mtek is worse than the baseline for this model

| Condition | attempts | completed | completion rate | tokens per completed task |
| --- | --- | --- | --- | --- |
| Mtek, compiler context | 170 | 103 | 60.6 % | 40,535 |
| Mtek, compiler context and guide | 170 | 134 | 78.8 % | 32,842 |
| baseline (three.js) | 170 | 156 | 91.8 % | 9,388 |

- By the rule of decision 0108, both Mtek conditions are **WORSE** than the baseline: completion is lower and tokens per completed task are significantly higher. Over 34 tasks the token ratio Mtek / baseline is 4.318 with a 95 % interval of 3.068 to 6.227 (context only) and 3.498 with an interval of 2.684 to 4.650 (with the guide).
- The research target of 30 % fewer tokens at matched success is **not met**. The original "about 80 % fewer tokens" claim is not supported by this measurement and must not appear in release copy.
- First-attempt success of everything (parse, check, start and tests): 23.5 % (Mtek, context), 37.1 % (Mtek with the guide) and 74.1 % (baseline).
- By category (completion rate, Mtek context / Mtek with the guide / baseline): interaction 60.0 % / 80.0 % / 96.4 %; maintenance 100.0 % / 100.0 % / 100.0 %; scene-rendering 49.1 % / 63.6 % / 80.0 %; shader-bridge 43.3 % / 83.3 % / 96.7 %. By mode: cold authoring 30.9 % / 54.5 % / 78.2 %, edit 74.8 % / 90.4 % / 98.3 %.
- In maintenance tasks (repair of an existing program) Mtek matched the baseline's completion at 7,760 tokens per completed task against 5,329.
- Holdout, by ids and outcomes (`benchmarks/results/ai/holdout-summary.jsonl`): Mtek with the compiler's context completed 25 of 40 attempts, the baseline 39 of 40. It points the same way as the main set; it was not used for any design.

## What it shows and does not show

- It measures one cheap model on one run of each trial. A model trained on far more three.js than Mtek text is the expected case for a new language; a stronger model, other settings or a model trained on Mtek could give other numbers. No other model was run.
- The finding that the compiler's context for a cold-start task holds no field names, examples or symbols (decision 0109) is a defect of the agent-facing contract as shipped, not of the benchmark. The guide narrows the gap and does not close it.
- The baseline's documentation is hand-written (9,803 bytes at most) and its coverage was checked against the installed three.js packages, not against what tasks need; the Mtek context is 12,802 bytes and the guide condition 26,178. Input tokens attributed to parts are an estimate by character share; the totals are exact.
- The decision to call "within 10 points" matched, and the bootstrap rule, were fixed in decision 0108 before the full run and were not tuned to a result.
