# M7.1: the AI/token benchmark re-run of the Mtek conditions, final

This page summarises `benchmarks/results/ai/report-m7-1.md` and `benchmarks/results/ai/compare-m7-1.md`, which `node tools/ai-eval/src/report-cli.ts` and `node tools/ai-eval/src/compare-cli.ts` generate from the stored records only (`benchmarks/results/ai/m7-1-rerun-main/records.jsonl` and the two retry runs `m7-1-retry-ctx` and `m7-1-retry-guide`; the earlier runs `m7-05-main` and `m7-05-guide`; the holdout runs are stored outside the repository and only their ids, outcomes, tokens and cost are in `benchmarks/results/ai/holdout-summary.jsonl` and `holdout-summary-m7-1.jsonl`), and the machine-readable `evidence/M7/ai-baseline.json`, which `compare-cli --baseline-json` generates. It adds nothing that is not in those files except where it says so. It does not replace `evidence/M7/ai-benchmark.md`, the summary of the M7-05 result. The decisions are [0124](../../spec/decisions/0124-attempts-the-harness-could-not-judge.md) (attempts the model never answered are not judged) and [0125](../../spec/decisions/0125-retry-runs-and-the-final-m7-1-baseline.md) (retry runs, the final comparison, the holdout, the baseline file).

**Status: final for the main set; the holdout is exploratory.** After the retry runs every one of the 340 Mtek attempts of the main set that counts ended in success or failure. By the rule of decision 0108 no main-set verdict is provisional: every task has 5 trials on each side, 0 % of the attempts are not judged (the limit is 10 %), and no token count is unknown. Both Mtek conditions are still **worse than the three.js baseline** for this model: the research target (30 % fewer tokens per completed task) is not met by either, on the main set or on the holdout. The baseline was not re-run.

## What was re-run and why

- After the M7-05 result (Mtek worse than the three.js baseline for this model) the agent-facing documentation was changed: the compiler's context for cold-start projects, which now holds generated schemas, enums and signatures (K-01); the diagnostics, which now say what to write instead (K-02); and the documentation, including the compact agent guide that is the guide condition's document (K-03). The re-run asks what those changes did to the same measurement.
- The same 34 tasks, 5 trials each, `claude-haiku-4-5-20251001`, temperature 1, prompt caching on, the same repair loop and budgets. Two Mtek conditions, as in M7-05: the compiler's context alone, and the context with `docs/language-guide.md` added (the guide now has another hash; the largest documentation given to the model grew from 12,802 to 22,638 bytes for the context alone and from 26,178 to 37,182 with the guide). The baseline was not re-run: the baseline row is the one of `m7-05-main`.
- `m7-1-rerun-main` started 2026-10-19T15:48:40Z and ended 17:19:28Z with the status `complete`. At list prices it cost 8.10 USD (cap 20.60 on the ledger). A holdout re-run (8 tasks, 5 trials, the two Mtek conditions: 80 attempts) was started right after, at 17:19:32Z.
- One attempt of the main re-run is a failure of another kind and is a failure, not a lost attempt: it used up its wall-clock budget of 300 s (`budget-wall-clock`), at about 16:06Z by the owner's log (the records carry no time for it). It is not a transport error and is in the completion rate as a failure.

## The outage and what it cost

- Calls failed only between 2026-10-19T17:18:27Z and 17:20:04Z, about 97 seconds. In the main re-run 57 calls, each the only call of its attempt, 52 with the error `Connection error.` and 5 with `Request timed out.`, none with a response or a token (the last call that was answered started at 17:18:18Z); these are the last 57 of the 68 attempts of trial index 4, so the lost cells are the later tasks of trial 4: 28 of the context-only condition and 29 of the guide condition. The records say `failure` / `generation-error`; the report reads them as `error` / `transport-error`, not judged (decision 0124), and they are out of every completion rate and of tokens per completed task.
- The holdout re-run lost all 80 attempts: 63 to the same two errors (17:19:32Z to 17:20:04Z) and 17 that the spend cap refused (`unfinished` / `budget-spend`). It was therefore not a holdout result; the first M7.1 version of this page said so.
- Money, not reconciled with an invoice: the spend guard charged each of the 120 failed calls its worst case, 3.96 USD together, which filled the ledger to 21.98 USD of the cap of 22.00 and made the guard refuse the last 17 holdout attempts. The service most likely billed none of them. The ledger (outside the repository, append-only) was not corrected: its total after everything below is 23.96 USD, so the real spend is about 20 USD if those 3.96 USD were never billed. No invoice was compared.

## The retry runs

The owner paid for the re-run of exactly the lost cells, with the harness as decision 0124 changed it (a call without a response is retried, up to three times; a connection error is not charged):

- `m7-1-retry-ctx` (28 attempts, 2026-10-19T19:12Z, 0.60 USD) and `m7-1-retry-guide` (29 attempts, 19:21Z, 0.62 USD): the lost cells of the main set, trial index 4. All 57 ended in success or failure, none needed a retry of a call. They are not a recovery of the lost draws but a second draw for those cells, with the same model, settings, condition ids and the same documentation text (the context hash of every retry attempt equals that of the attempt it replaces; a test checks it).
- `m7-1-retry-holdout` (80 attempts, 19:25Z, 0.76 USD): the whole holdout, both Mtek conditions, all judged.
- Rule (decision 0125): a retry run supplies attempts only for cells whose attempt was not judged; in every aggregate the retry attempt replaces the lost one; both stay listed, the lost one marked `superseded by retry run X` and the retry `retry of the attempt in run Y`; a retry attempt for a judged cell is an error, and so is one with another model, condition or documentation text.
- Of the 28 retry attempts of the context-only condition 19 completed (67.9 %), of the 29 of the guide condition 26 (89.7 %), close to the rates of the first run (68.3 % and 84.4 % on the attempts that were judged).

## The final comparison with the M7-05 runs (main set, all numbers in `compare-m7-1.md`)

After the retry runs each condition has 170 attempts (34 tasks x 5 trials), all judged. Every cell is judged in both runs, so the matched cells are all the cells.

| Condition | Run | Attempts | Completed | Completion rate | Tokens per completed task |
| --- | --- | --- | --- | --- | --- |
| context only | M7-05 | 170 | 103 | 60.6 % | 40,535 |
| context only | M7.1 final | 170 | 116 | 68.2 % | 33,648 |
| context + guide | M7-05 | 170 | 134 | 78.8 % | 32,842 |
| context + guide | M7.1 final | 170 | 145 | 85.3 % | 29,872 |
| three.js baseline (M7-05, not re-run) | M7-05 | 170 | 156 | 91.8 % | 9,388 |

By mode (completion rate and tokens per completed task, before / after):

| Condition | Mode | Cells | Completed before / after | Completion rate before / after | Tokens per completed task before / after |
| --- | --- | --- | --- | --- | --- |
| context only | cold authoring | 55 | 17 / 32 | 30.9 % / 58.2 % | 112,711 / 53,878 |
| context only | edit | 115 | 86 / 84 | 74.8 % / 73.0 % | 26,268 / 25,942 |
| context + guide | cold authoring | 55 | 30 / 39 | 54.5 % / 70.9 % | 64,631 / 48,243 |
| context + guide | edit | 115 | 104 / 106 | 90.4 % / 92.2 % | 23,672 / 23,114 |

By category (completion rate, before / after): context only: interaction 60.0 % / 61.8 %, maintenance 100.0 % / 100.0 %, scene-rendering 49.1 % / 67.3 %, shader-bridge 43.3 % / 50.0 %; with the guide: interaction 80.0 % / 85.5 %, maintenance 100.0 % / 96.7 %, scene-rendering 63.6 % / 70.9 %, shader-bridge 83.3 % / 100.0 %. The tokens per completed task by category are in `compare-m7-1.md`.

## The verdict by the rule of decision 0108 (from `report-m7-1.md` and `compare-m7-1.md`)

The rule compares each Mtek condition with the baseline; the baseline attempts are those of `m7-05-main`, and the earlier Mtek attempts are not in that report. Neither verdict is provisional.

- context only: **worse**. Completion 68.2 % against 91.8 % (23.5 points lower), tokens per completed task 33,648 against 9,388, ratio 3.584 with a 95 % interval of 2.505 to 5.245 (M7-05: 4.318). Target not met.
- context and guide: **worse**. Completion 85.3 % against 91.8 % (6.5 points lower, which the rule calls matched), 29,872 against 9,388, ratio 3.182 with an interval of 2.565 to 3.978 (M7-05: 3.498). Target not met.

## The holdout (exploratory; numbers only, from the summary files)

The holdout set is 8 tasks; the M7-05 holdout run measured the old context alone and the baseline; the M7.1 holdout run measured the new context alone and with the guide (5 trials each, 40 attempts per condition, all judged). The holdout baseline was not re-run: the earlier baseline stands for both new rows. Tokens per completed task is input plus output of all attempts / completed tasks.

| Set | Condition | Attempts | Completed | Completion rate | Tokens per completed task | Cost (list price) |
| --- | --- | --- | --- | --- | --- | --- |
| earlier (M7-05) | Mtek, context only | 40 | 25 | 62.5 % | 38,845 | 0.84 USD |
| earlier (M7-05) | three.js baseline | 40 | 39 | 97.5 % | 7,737 | 0.42 USD |
| new (M7.1) | Mtek, context only | 40 | 34 | 85.0 % | 17,629 | 0.43 USD |
| new (M7.1) | Mtek, context + guide | 40 | 39 | 97.5 % | 16,112 | 0.33 USD |

By the rule of decision 0108 (8 tasks are enough for an interval, so a verdict is allowed; all are exploratory), against the earlier holdout baseline: earlier Mtek, worse (35.0 points lower, token ratio 5.021, interval 2.479 to 12.073); new context only, **worse** (12.5 points lower, ratio 2.279, interval 1.253 to 4.866); new context and guide, **worse** (completion matched at 0.0 points, ratio 2.083, interval 1.444 to 3.005). The 80 attempts lost to the outage (`m7-1-rerun-holdout`) are rows of the new summary file, marked `supersededBy` the retry run, and are in no number above. The SHA-256 of the holdout `records.jsonl` files, which live outside the repository and are not checked by a test: `m7-05-holdout` 674b21a87a2609ef1d9e14c9a8de9b3dc4a694e1636fd85ae1c5cedca8839cf4, `m7-1-rerun-holdout` 9baf867ae4b5dfa471ba731b67f614b1f40804830504a28c3113f0c0ed4d8557, `m7-1-retry-holdout` 41d04a96c96e326dae7c622b923a77929ebed527e10146e5740cbd8c397a8f02 (the file bytes as stored).

## What it shows and does not show

- **A modest improvement on the main set.** On all 170 cells of a condition the completion rate rose by 7.6 points (context only) and 6.5 points (with the guide) and the tokens per completed task fell by 17.0 % and 9.0 %. The change sits in the cold-authoring tasks (+27.3 and +16.4 points, tokens per completed task roughly halved and down a quarter); the edit tasks did not move (-1.7 and +1.7 points).
- **A larger improvement on the holdout, with the guide at the baseline's completion rate.** Context only went from 62.5 % to 85.0 % and from 38,845 to 17,629 tokens per completed task; with the guide the completion rate (97.5 %) equals the baseline's. There is no earlier holdout row for the guide, so the guide's own gain on the holdout is not measured.
- **The baseline is still ahead on tokens.** The three.js baseline completes a task for 9,388 tokens on the main set and 7,737 on the holdout; Mtek needs 2.1 to 3.6 times as many (3.2 and 3.6 on the main set, 2.1 and 2.3 on the holdout), significantly more by the rule. The target of 30 % fewer tokens is not met anywhere, and the original "about 80 % fewer tokens" claim stays unverified and must not appear (decision 0104). The completion gap closed with the guide (matched on the main set, equal on the holdout) and not without it.
- **The main-set gains are optimistic.** The failures that K-01 to K-03 address were diagnosed on this main set, so the documentation was shaped by these tasks. The holdout was not used for design (the repository check forbids holdout ids in tools, spec and docs), but its tasks may be easier: the baseline completes 97.5 % of them against 91.8 % on the main set. That the new context gained more on the holdout than on the main set does not show the main-set gain was not tuned; with 8 tasks the rate depends on which tasks they are.
- **40 attempts per condition can only show large effects.** A rate over 40 attempts has a 95 % interval of roughly 11 to 15 points either way by the normal approximation (computed by hand for this page, not in the generated files), and that is too narrow, because the 5 trials of one task are not independent. A difference of 12.5 points between two holdout rows is not shown to be more than the variation between runs. The same holds on the main set, in a smaller degree: one run of each cell at temperature 1, no repeat, no interval computed for the before / after differences.
- **The retry attempts are a second draw.** The 57 retry attempts were made after the first run, with the harness changed by decision 0124; the comparison of before and after is on all cells, which is what the retries buy, but the cells that were lost are the later tasks of trial 4 and which cells were lost is not random.
- One model, one machine; the cost figures are list prices, not an invoice. Nothing here supports release copy about the share of tokens saved.

## The machine-readable baseline

`evidence/M7/ai-baseline.json` is generated by `compare-cli --baseline-json` and never edited. It holds the model id, temperature (1), prompt caching (on), the price table used (Claude Haiku 4.5: 1 / 1.25 / 0.1 / 5 USD per million input / cache-write / cache-read / output tokens), the harness package and version, the run ids and SHA-256 of every `records.jsonl` and every holdout summary it was computed from, the conditions before and after with attempts, completed, completion rate, tokens per completed task and cost (overall, per mode, per category), the holdout numbers, the verdicts, and the targets a later run is held to: the main-set baseline row (91.8 % and 9,388 tokens per completed task), the holdout baseline (97.5 % and 7,737) and the research target (token ratio at most 0.70 at matched success). `tools/ai-eval/test/m7-1-evidence.test.ts` regenerates it byte for byte and checks every hash against the stored files.

## How to regenerate

```
node tools/ai-eval/src/report-cli.ts --run benchmarks/results/ai/m7-1-rerun-main --retry-run benchmarks/results/ai/m7-1-retry-ctx --retry-run benchmarks/results/ai/m7-1-retry-guide --baseline-run benchmarks/results/ai/m7-05-main --out benchmarks/results/ai/report-m7-1.md --title <the first line of the file> --note <its third line>
node tools/ai-eval/src/compare-cli.ts --before benchmarks/results/ai/m7-05-main,benchmarks/results/ai/m7-05-guide --after benchmarks/results/ai/m7-1-rerun-main --after-retry benchmarks/results/ai/m7-1-retry-ctx,benchmarks/results/ai/m7-1-retry-guide --holdout-before benchmarks/results/ai/holdout-summary.jsonl --holdout-after benchmarks/results/ai/holdout-summary-m7-1.jsonl --baseline-json evidence/M7/ai-baseline.json --out benchmarks/results/ai/compare-m7-1.md --title <...> --note <...>
node tools/ai-eval/src/report-cli.ts --run <m7-1-rerun-holdout, outside the repository> --retry-run <m7-1-retry-holdout, outside the repository> --out <anywhere outside the repository> --holdout-summary benchmarks/results/ai/holdout-summary-m7-1.jsonl
```

The first two are regenerated by `tools/ai-eval/test/m7-1-evidence.test.ts` byte for byte. The third needs the holdout run directories, which are outside the repository, so no test regenerates the holdout summary; the tests check its form (160 rows: 80 lost attempts, 63 `error` / `transport-error` and 17 `unfinished` / `budget-spend`, each `supersededBy` the retry run, and 80 judged retry attempts, each `retryOf` the lost one, in the same cells), and the holdout section and the numbers above are regenerated from the summary files alone.
