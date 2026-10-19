# tools/ai-eval: the repair harness

A provider-independent, bounded generate, validate, repair loop for the AI benchmark
(`spec/ai-and-benchmarks.md` section 4, [decision 0077](../../spec/decisions/0077-repair-harness.md)).
It asks a model for an edit, applies the edit to a scratch copy of a benchmark task's project, runs the
real compiler and the task's own tests, and on failure sends back localized diagnostics, up to a
repair and budget limit. Every call and every validation is recorded. **Syntax is never counted as
success**: a candidate succeeds only when parse, check, build, start and every task fixture pass and
every declaration the task requires still exists.

Nothing in the language, the compiler or the runtime depends on this workspace or on any inference
provider. `npm run lint -w @mtek/ai-eval` (part of `npm run check`) fails if a language package
imports the harness, an adapter or a provider library (`src/check-boundary.ts`).

## What it needs

- Node 24 (it runs TypeScript directly) and `npm ci` once at the repository root.
- A built `mtek` (`npm run build`). It is found as `MTEK_BIN`, else `target/debug/mtek`, else
  `target/release/mtek`; `--mtek PATH` names another.
- For the start and task-test layers, a machine with a WebGPU adapter and Playwright's Chromium
  (what `mtek test` needs, decision 0074). Without them those layers are **NOT-RUN**, and a candidate
  with a layer that did not run is never a success.

The benchmark runs of M7-05 (the three.js baseline side, the spend guard, the report) are described under
[Benchmark runs](#benchmark-runs) below and in [decision 0108](../../spec/decisions/0108-ai-benchmark-run-and-report.md);
the pilot and the scopes of the full run are [decision 0109](../../spec/decisions/0109-ai-benchmark-pilot-and-scopes.md).

## Commands

```
node tools/ai-eval/src/cli.ts validate --task benchmarks/tasks/interaction-01 \
     [--project benchmarks/tasks/interaction-01/reference/mtek]
node tools/ai-eval/src/cli.ts run --task benchmarks/tasks/interaction-01 --client replay \
     --transcript evidence/M6/ai-eval/transcripts/interaction-01-first-try.jsonl \
     --out /tmp/results --run-id my-run
```

`validate` runs the validation layers once on the task's starter (or on `--project`, for example a
reference solution) with the task's fixtures and prints every layer as JSON. Exit codes: 0 verdict
`pass`, 1 `fail`, 2 usage, 3 the tool chain failed (or the run was refused), 4 `not-run`.

`run` runs `--trials N` trials of the task under one condition and writes
`<out>/<run-id>/records.jsonl` plus the final candidate of every trial in
`<out>/<run-id>/trials/<trial-id>/project/`. The default `--out` is `benchmarks/results`.
It never overwrites an existing run. Options:

| Option | Meaning |
|---|---|
| `--client NAME` | `replay`, `anthropic`, `openai-compatible` or `llama-cpp` |
| `--model ID` | the model id exactly as the provider is to receive it (required by every adapter but `replay`) |
| `--base-url URL` | a server (`openai-compatible`, `llama-cpp`, default `http://127.0.0.1:8080/v1`) or an API endpoint |
| `--api-key-env VAR` | the environment variable holding the key (defaults `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `LLAMA_API_KEY`). Keys are read at run time only and never recorded |
| `--transcript FILE` | `replay`: the recorded responses |
| `--temperature N\|default` | default 0; `default` sends no sampling parameter (some current models reject it) |
| `--stop S`, `--seed N` | stop sequences, seed; a seed is refused by a client that cannot apply it |
| `--max-repairs N` | repair rounds after the first generation (default: the task's `max_repairs`) |
| `--max-total-tokens N` | input plus output tokens over a trial (default: none) |
| `--max-bytes N` | the `mtek context` budget (default 24000) |
| `--test-feedback messages\|status-only` | whether the model sees the failure messages of the task's tests (default `messages`, what `mtek test` prints) |
| `--trial-kind unconstrained\|constrained` | see below |
| `--side mtek\|baseline\|mtek-guide` | which project of the task is worked on (see [Sides](#sides)) |
| `--trials N`, `--first-trial N` | repetitions and the index of the first |
| `--scratch DIR`, `--keep-scratch` | where candidates are made, and keeping them |

The wall-clock budget is the task's `max_wall_seconds`; the per-reply token cap is its
`max_output_tokens`.

## The loop

1. `mtek context` for the task's project (decision 0072) and the task prompt, the required
   declarations and the starter's files form the first message. The task's tests are never shown.
2. The model replies with edit blocks (`spec/ai-and-benchmarks.md` section 4.3):

   ```
   <<<FILE src/main.mtek
   <<<SEARCH
           speed = -speed;
   ===
           speed = -speed * 1.5;
   >>>REPLACE
   <<<FILE src/extra.mtek
   <<<WHOLE
   ...the complete file...
   >>>END
   ```

   Each SEARCH text must match exactly once; zero or several matches reject the **whole** reply
   (nothing is applied), the rejection is recorded, returned to the model as a structured error and
   counts as a repair round. Only `mtek.toml` and `src/**/*.mtek` can change, never the tests; a whole
   file may replace an existing file only in a `cold` task.
3. The candidate is validated, each layer on its own, in fresh processes:

   | Layer | From | Values |
   |---|---|---|
   | `parse` | `mtek check --format json`: no error of phase `parse` | pass, fail |
   | `check` | the same report: no error at all | pass, fail |
   | `build` | `mtek build --mode test --format json` (emits and validates the shaders: the spec's "shader/target validation") | pass, fail, not-run |
   | `start` | `mtek test --allow-not-run --format json`: the program mounted in the fixtures that ran | pass, fail, not-run |
   | `tests` | the same report: every fixture of the task passed | pass, fail, not-run |
   | required symbols | `mtek context --symbol S` for each name in `required_symbols` | pass, fail, not-run |

   A layer after a failed one is `not-run` with kind `skipped`; a layer this machine cannot run
   (no Node, browser or GPU adapter) is `not-run` with kind `environment`. The verdict is `pass`
   only when everything passes; `fail` when anything fails; `not-run` when nothing failed but
   something could not run; `error` when the tool chain failed (the binary is missing, `mtek`
   crashed, a report contradicts its exit code, a task fixture is invalid), which says nothing about
   the candidate.
4. On failure the model gets the compiler's diagnostic envelopes with the source lines around each
   span, the failing test messages, the missing declarations and the current text of the files it has
   changed, and replies again. The trial ends when the candidate passes (`success`), after
   `maxRepairs` repairs or when a budget runs out (`failure`), when a layer could not run (`not-run`),
   when the tool chain failed (`error`) or when a constrained trial was asked for and is unavailable
   (`unavailable`).
5. A generation that is truncated (`finish: length`), refused, cancelled or failed ends the trial as
   a failure at once: it is recorded and never silently repaired or retried, even when the partial
   output would have applied and passed.

## Records

`records.jsonl` has one canonical JSON record per line (keys sorted, no whitespace, a sequence
number, no machine path); the schema is [`spec/ai-eval-record.schema.json`](../../spec/ai-eval-record.schema.json).
Record types: `run-start`, `trial-start` (the whole condition and its id), `model-call` (the full
prompt, its hash, the response, usage, finish reason, generation outcome, timing, and prompt size per
section in characters), `edit` (what happened to the reply's edits), `validation` (every layer, the
required symbols, the diagnostics, the test report), `trial-end`. A recorded run is itself a replay
transcript. Changing any part of the condition (provider, model, temperature, token cap, stop
sequences, seed, prompt version, feedback mode, budgets, trial kind) changes the `conditionId`.

## Constrained decoding

`--trial-kind constrained` asks the `GrammarCapability` (`src/grammar.ts`) for a grammar. When the
`grammar-adapter` binary of M6-06 (decision 0073) is named with `--grammar-adapter PATH` or
`MTEK_GRAMMAR_ADAPTER`, or built in this repository (`cargo build -p mtek-grammar-adapters`), the harness
runs its check (`src/command-grammar.ts`: `grammar-adapter check --format json`, then
`mtek grammar export --format gbnf` for the grammar text) and a constrained trial runs only if the pinned
backend and model are really installed (`node tools/grammar-adapters/fetch-backend.mjs`). Otherwise the
capability is unavailable with the adapter's reason and the exact message "grammar-constrained mode
unavailable", and the trial ends `unavailable` without a model call. A constrained trial is **never** run
unconstrained instead, and constrained and unconstrained trials are recorded as separate kinds (and
separate conditions). The harness imports no adapter code: it spawns the two binaries (decision 0077
item 10, wired by the orchestrator after M6-06 merged).

## Adapters

| Adapter | Transport | Notes |
|---|---|---|
| `replay` | none | recorded responses, in order; the only adapter the unit tests and CI use |
| `anthropic` | the official `@anthropic-ai/sdk` (optional dependency) | no default model, no seed, no grammar, no retries; `inputTokens` is the whole input, `cachedInputTokens` the cache reads, `cacheWriteInputTokens` the cache writes; `promptCaching` puts one cache breakpoint on the newest message (Haiku 4.5 caches prefixes of at least 4 096 tokens); run against the real service for the first time on 2026-10-19 (decision 0108 item 5) |
| `openai-compatible` | `POST {base-url}/chat/completions` | hosted or local servers; seed forwarded, no grammar |
| `llama-cpp` | `llama-server`'s `/v1/chat/completions` | forwards `grammar` and `seed`; tested against a fake transport only |

Adapters are loaded by name and only when asked for (`src/adapters/registry.ts`); none imports
another, and nothing outside the registry imports an optional adapter. Their unit tests inject a
fake `fetch`: no test opens a network connection.

## Tests

`npm run test:unit -w @mtek/ai-eval`. The loop, the editor, the validator, the recorder and the CLI are
tested with the replay client and a scripted stand-in for `mtek`; `test/integration.test.ts` runs the
real compiler on the benchmark tasks (it needs a built `mtek` and is reported as skipped without one;
it makes `mtek test` NOT-RUN on purpose with an unusable Node, so it needs no GPU).

## Sides

A trial works on one side of the comparison (decision 0108 items 1 to 4): `mtek` (the task's Mtek project, validated
by `mtek check`, `mtek build` and `mtek test`), `baseline` (the task's TypeScript + three.js r186 project, validated by
the TypeScript compiler, the bundler and the task's own fixtures in a browser: `benchmarks/baselines/support/test/run-candidate.ts`)
and `mtek-guide` / `mtek-getting-started` / `mtek-reference` (the Mtek side with that document of `docs/` added after the
compiler context). The loop, the edit format, the budgets, the feedback wording and the token accounting are the same; the
documentation is what differs (`mtek context`, or `benchmarks/baselines/docs/reference.md`, whose tokens are counted the same way).
The side is part of the condition and of the trial id (`<task>--baseline-unconstrained--00`). A baseline candidate is made in
`node_modules/.cache/mtek-ai-eval/` of the checkout so that `three` resolves.

## Benchmark runs

```
node tools/ai-eval/src/benchmark-run.ts (--tasks id,id | --all) [--holdout] [--sides mtek,baseline,mtek-guide]
     --client anthropic --model claude-haiku-4-5-20251001 --spend-cap USD [--spend-ledger FILE]
     [--api-key-file FILE] [--temperature N|default] [--trials N] [--first-trial N] [--order trial-major|task-major]
     [--no-prompt-caching] [--gpu-lock DIR] [--run-id ID] [--out DIR]
node tools/ai-eval/src/report-cli.ts --run DIR [--run DIR ...] --out report.md [--projection FILE --budget USD] [--holdout-summary FILE]
```

- `benchmark-run` makes the attempts tasks x sides x trial kinds x trials for one model into `<out>/<run-id>/` (default
  `benchmarks/results/ai/`): `records.jsonl` (the settings of the run, every call, edit and validation, the spend, a `run-end`
  record) and the final candidate of every trial. Trial index is outermost (`--order task-major` puts the trials of a task and
  side together so their first prompt is served from the provider's cache). It never overwrites a run.
- **Money.** A provider is refused without `--spend-cap`. The cap is a ceiling on the total of the ledger, a file OUTSIDE the
  repository (default `<home>/gate-m7/ai-spend.json`) that persists across runs. Before each call the worst case of the call
  (the estimated input at the dearest input price plus the task's `max_output_tokens` at the output price) must fit under the
  cap; after it the cost computed from the provider's usage is charged. A refused call is recorded as `budget-exceeded`
  (budget `spend`) and the attempt ends **unfinished** (reason `budget-spend`); so does every attempt planned after it.
  Prices are in `src/spend.ts` (`PRICING`); a model without a price cannot be run.
- **Credentials.** The key is read from `--api-key-file FILE` (into the client only; never `process.env`, never a command line)
  or from the variable named by `--api-key-env` (default `ANTHROPIC_API_KEY`). It is in no record, no output line and no error
  text (`scrubSecrets`); the repository holds no key.
- `--gpu-lock DIR` takes a lock directory around the commands that open the browser (`mtek test`, the baseline runner) so that the
  GPU is never shared with another run; it is released also on an error or an interrupt.
- `--holdout` takes the tasks from `benchmarks/holdout/` and refuses a run directory inside the repository (a record holds
  the prompt and the candidate; decisions 0021 and 0085). `report-cli` turns such a run into ids and layer outcomes only.
- `report-cli` computes, from the stored records only: outcomes, completion rate, tokens per completed task (UNDEFINED, never 0,
  when nothing completes), medians and interquartile ranges, input/output and cached/uncached tokens apart, first-attempt success,
  the attribution of input tokens to parts of the prompt, per category and per mode, every attempt, and the conclusion on H4 by
  the rule of decision 0108 item 11 (better, equivalent, worse or inconclusive, and whether it is provisional). `--projection`
  writes the cost of six scopes of the full protocol from the cost per attempt in the runs (`src/projection.ts`).

