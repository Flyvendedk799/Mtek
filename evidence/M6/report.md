# M6 completion report

- Milestone: **M6 — Make authoring and repair dependable** (blueprint §11, M6)
- Gate task: M6-GATE
- Gate run: clean `git clone` of the local `main` into a new directory at commit `e5da5dd` (`gitCommit` in the gate environment records, `gitDirty: false`), 2026-10-19, Node 24, Windows 11, after a fresh `npm ci` ([`gate-commit.txt`](gate-commit.txt), [`gate-status.txt`](gate-status.txt)). Two earlier gate runs on the same day failed on defects of M6's own tests (a package script that named a file that does not exist, found by the new CI job; a 5 s test timeout; a harness test that ran the real grammar check when the pinned backend was installed). They were fixed and the gate was run again from scratch; this report is about the third run only.
- Decision: **passed**, with the limits under "Unsupported / remaining". Every criterion below was proved by a run that really ran: nothing rests on a NOT-RUN result, and the software-adapter results (informational) are not used for any criterion. One CI job is red on GitHub and is named under "Remaining".

## Implemented behaviour

| Work item | What now works | Proved by |
|---|---|---|
| M6-01 | `mtek fmt [--check] [PATHS…]`: one canonical, idempotent, comment-preserving formatting; refuses (never rewrites) a file that does not parse | `crates/mtek-compiler/tests/format_corpus.rs` (856 files: 728 parse and pass idempotence, same tree, literals as written, comment multiset; the 128 that do not parse are refused), comment-mutation tests (20 223 single, 2 904 multi, 43 560 exhaustive multi), `crates/mtek-cli/tests/fmt.rs` (the examples, templates and benchmark sources are canonical, except the starter that is broken on purpose); [0070](../../spec/decisions/0070-canonical-formatter.md) |
| M6-02 | Validated suggested edits: one validator re-checks every candidate on an in-memory copy; attached only if the diagnostic disappears and no new error appears; none when ambiguous; the diagnostics audit | `crates/mtek-compiler/tests/suggested_edits.rs` (applies every attached edit by plain splice and re-runs the analysis itself), `diagnostics_audit.rs`, `tests/semantics/fail/edits_*`; [0071](../../spec/decisions/0071-validated-suggested-edits-and-diagnostics-audit.md) |
| M6-03 | `mtek lsp`: diagnostics, hover, definition (imports, `mtek-prelude:` virtual documents), completion, quick fixes from the validated edits, UTF-16 and UTF-8 positions | 120 unit tests and 10 sessions against the real binary (`crates/mtek-cli/tests/lsp.rs`), multi-byte text; [0076](../../spec/decisions/0076-language-server.md) |
| M6-04 | VS Code extension: LSP client, generated TextMate grammar, language configuration, `.vsix` | 10 integration tests in a real VS Code ([`vscode-integration-gate.txt`](vscode-integration-gate.txt)), tokenizer corpus of 955 files, grammar drift tests; CI job `vscode-extension` green on Ubuntu and Windows; [0090](../../spec/decisions/0090-vscode-extension.md) |
| M6-05 | `mtek context`: versioned, derived `supported`/`notSupported`, neighbourhood and truncation, examples that check clean | `crates/mtek-compiler/tests/context.rs` (goldens, derivation tests, schema validation); [0072](../../spec/decisions/0072-context-export.md) |
| M6-06 | Grammar model, `mtek grammar export` (EBNF equals `spec/grammar.ebnf`, GBNF), one pinned backend and its capability check | conformance on the real validator, [`cargo-test-gate.txt`](cargo-test-gate.txt); [0073](../../spec/decisions/0073-grammar-model-gbnf-and-the-llama-cpp-adapter.md) |
| M6-07 | `tools/ai-eval`: bounded generate–validate–repair loop, replay-tested; the grammar capability is wired to M6-06's real check | 207 tests; [0077](../../spec/decisions/0077-repair-harness.md) |
| M6-08 | 34 benchmark tasks and 8 holdout tasks, every Mtek reference verified through the harness, every three.js reference through Playwright | [`gate-mtek-references.json`](gate-mtek-references.json) (42 of 42 pass every layer), `test-results-gate-benchmarks.json` (104 of 104); decisions 0078, 0079, 0083–0085, 0088, 0089 |
| M6-09 | `mtek test`: declarative fixtures in a real browser, NOT-RUN reported as such | `crates/mtek-cli/tests/test_cmd.rs`, `specs/m6/mtek-test.spec.ts` (hardware); [0074](../../spec/decisions/0074-mtek-test.md) |
| M6-10 | `--mode preview`: loop budgets (`E8080`), fetch restricted to `baseUrl`, external bootstrap, CSP, compile timeout; `docs/preview-hosting.md` | `specs/preview/*.spec.ts`; [0075](../../spec/decisions/0075-untrusted-preview-mode.md) |
| M6-11 | `docs/getting-started.md` and a test that executes the document | `crates/mtek-cli/tests/getting_started.rs` (9 tests), `specs/m6/getting-started.spec.ts`; [0091](../../spec/decisions/0091-getting-started-walkthrough.md) |
| M6-12, M6-13 (added during M6) | Built-in `Unlit`/`Pbr` params readable and assignable by name; honest wording of two diagnostics; four more benchmark tasks and the baseline hooks | decisions 0086, 0087, 0088, 0089 |

## Tests run

Gate run on 2026-10-19 from a clean `git clone` of the local `main` at `e5da5dd`, logs kept outside the clone, the pinned grammar backend installed by `node tools/grammar-adapters/fetch-backend.mjs --all`.

| Stage | Command | Result |
|---|---|---|
| Install and build | `npm ci`, `npm run build` | passed |
| Format, clippy, lint, types, naming, tasks, assets | `npm run check` | passed |
| Rust, backend required | `MTEK_REQUIRE_GBNF_VALIDATOR=1 MTEK_REQUIRE_GBNF_BACKEND=1 cargo test --workspace --locked` | **1590 passed, 0 failed, 1 ignored** (the one existing ignore); the conformance suite and the smoke ran for real ([`cargo-test-gate.txt`](cargo-test-gate.txt)) |
| TypeScript unit | `npm run test:unit` | 1245 + 78 + 78 + 285 + 1932 + 169 (+1 skipped) + 8 + 207 passed, 0 failed ([`unit-tests-gate.txt`](unit-tests-gate.txt)) |
| Browser, all projects | `MTEK_REQUIRE_GPU=1 npm run test:browser` | **584 passed, 0 failed, 0 not-run**: hardware 246, software 234 (informational) and 12 skipped by design, benchmarks 104 ([`test-results-gate-full.json`](test-results-gate-full.json); `environment-gate-full-*.json`) |
| Browser, M6 on hardware | `MTEK_REQUIRE_GPU=1 npm run test:browser:hardware -- specs/m6/` | **18 passed, 0 failed, 0 not-run** ([`test-results-gate-m6-hardware.json`](test-results-gate-m6-hardware.json)) |
| Benchmark baselines | `MTEK_REQUIRE_GPU=1 npm run test:benchmarks` | **104 passed** ([`test-results-gate-benchmarks.json`](test-results-gate-benchmarks.json)) |
| VS Code | `npm run test:integration -w mtek-vscode` | **10 passed, 0 failed** in a real VS Code |
| Mtek references through the harness | `node tools/ai-eval/src/cli.ts validate` over every task and holdout reference | **42 of 42 pass** parse, check, build, start, tests and required symbols (holdout: ids and layer outcomes only) |
| Grammar capability | `grammar-adapter check --format json` | available: llama.cpp b11719, Qwen2.5-Coder-1.5B-Instruct Q4_K_M ([`gate-grammar-capability.json`](gate-grammar-capability.json)) |

The 12 software-project skips are the pixel-exact specs of `specs/m6/mtek-test.spec.ts`, which are hardware-only, and the no-adapter spec, which cannot observe a missing adapter under Chromium's software fallback; the hardware project ran them all (none skipped). No criterion rests on them. `npm run evidence:sanitize` made the paths in the Playwright reports repo-relative; in the text logs only summary lines were kept and the clone's path was replaced by `<repo>`.

## Exit criteria

| Criterion | Evidence |
|---|---|
| A new user can install the toolchain, run a documented example, break it, understand the error and repair it | `docs/getting-started.md` is executed by `getting_started.rs`: it extracts the commands, expected output, diffs and file listings from the document and runs them in a clean temp directory against the built `mtek` (with the runtime embedded in this run, so the full walk including `mtek dev` ran): the diagnostic printed in the document equals the real output, the documented fix equals the tool's own validated edit, the broken project exits as documented and the fixed one builds; seven altered copies of the document are each rejected. The browser spec runs the same edit, break and fix on a real page served by `mtek dev` (hardware). **No human tester was available**; decision 0091 carries a checklist for the first person who can try it |
| Canonical formatter | M6-01 above: idempotence, same tree, literals as written, comment multiset over 856 corpus files, and the repository's own sources are canonical |
| Structured diagnostic envelope | `spec/diagnostic.schema.json` validates `mtek check --format json` (the M1 browser spec and the CLI tests assert one schema-valid report with exact codes and spans); M6-02 adds validated `suggestedEdits` with a documented data model (`spec/diagnostics.md` §6.1) that the language server and the harness use |
| Basic LSP | M6-03 above, and the extension drives the same server in a real VS Code (10 of 10) |
| Context export | M6-05 above |
| One grammar adapter | The pinned backend is installed in this run and the capability check says available. The conformance suite ran on the real validator over 38 372 inputs (positive fixtures accepted, syntax-level negatives rejected, truncations, token deletions, word replacements) with only the two documented differences (the compiler's nesting limit of 256 and the `param` restriction); the end-to-end smoke ran constrained generation to completion (61 decode runs, output lexes and parses) |
| Bounded repair harness | `tools/ai-eval` budgets (repairs, tokens, wall clock) and failure preservation: `repair-loop.test.ts` (budget exhaustion, truncated generation, refusal, replay mismatch, crashing compiler) |
| Cross-parser / formatter fixtures | The GBNF is validated against the compiler's own parser over the whole syntax corpus (the conformance suite), the TextMate grammar over 955 files, and the formatter's property tests over the corpus |
| The harness records unconstrained and constrained trials separately | `repair-loop.test.ts` "constrained and unconstrained trials are separate kinds": separate trial kinds and `conditionId`s, a constrained trial without the capability ends `unavailable` with the exact message "grammar-constrained mode unavailable" and is never run unconstrained; `cli.test.ts` for the CLI; `command-grammar.test.ts` (10 tests) for every way the real check can be unavailable |
| A repair must satisfy the original task tests, not just compile | `repair-loop.test.ts`: "a candidate that parses and checks but fails its tests is a failure", "rejects a 'repair' that deletes the feature under test even though everything compiles and the tests pass" (required symbols), "ends in failure when the model keeps the feature deleted"; every Mtek reference passes its fixtures through `mtek test` |

**Guardrail — syntax validity is never counted as success.** The verdict of a candidate is `pass` only when every layer (parse, check, build, start, tests) passes and every required symbol exists (`outcomes.ts`); a trial is a `success` only on a `pass` verdict (`repair-loop.ts`). A layer after a failed one is recorded `not-run`; a layer that could not run on the machine (no GPU) ends the trial `not-run`, never `success`; truncated, refused or cancelled generations fail the trial even when the partial output would pass; a failed tool is `error`, not a pass. The tests named above pin each of these, and the 42 references are the positive evidence that "pass" means working programs.

## Unsupported / remaining

- **A CI job is red on GitHub**: `specs/m4/dev-overlay.spec.ts:239` in the Ubuntu `browser-software` job fails intermittently ("A valid external Instance reference no longer exists" on the second mount in one page; Linux software renderer only; it passes locally and passes on reruns, and failed on most runs after the M6 merges). Cause not found; deliberately left as is on the owner's instruction. All other CI jobs are green on the head commit, including the new `vscode-extension` job on both operating systems.
- **No model has been run**: the harness is tested with replay transcripts and fake transports; the `anthropic`, `openai-compatible` and `llama-cpp` adapters never met a real service, and no constrained trial ran through the harness against a real model (the adapter's own smoke did generate under the grammar). No token counts, completion rates or difficulty measurements exist (M7).
- **One machine and one OS for the grammar backend**: the conformance suite and the smoke ran on Windows only; the Linux path was verified by checksum only (decision 0073).
- **No human tester** for the walkthrough (above). Two new-user findings are documented, not changed: the validated suggested edit is shown only in `--format json` and by the language server (no command applies it), and `mtek` has no command to serve a release build.
- **The formatter's exhaustive single-comment run** (every comment kind at every token) did not finish and is not claimed; the single-comment, multi-comment and exhaustive multi-comment runs listed above passed.
- **The benchmark set is 34 tasks**, four above the blueprint's 30; the holdout (8) is not blind to its author, and its difficulty is a design intention, not a measurement.
- **Known gaps carried forward**: the three.js side has a manual-render-loop colour-upload quirk found by `interaction-09` (undiagnosed, decision 0088); the specification does not say whether the fraction of a step survives a dropped surplus (the runtime keeps it, `interaction-11` states it); a built-in material param write on a spawned entity is covered by the checker but not run at run time (decision 0087).

## Defects found and fixed during M6

- Merge integration: `mtek test` met the new build settings (M6-09 with M6-10), the context goldens met the reformatted examples (M6-01 with M6-05), and the repository's fmt and parse tests met the starter that is broken on purpose.
- A worker wrote three Windows-1252 bytes into `spec/ai-and-benchmarks.md`, which broke the spec-corpus test on both operating systems; fixed, and all 3 242 tracked text files were scanned.
- `mtek test` put an absolute runner path into a machine-readable not-run reason (found by Ubuntu CI); the no-adapter browser spec assumed Chromium without a GPU has no adapter (false on Linux CI): now it skips where it cannot observe the case.
- The real-clock pause spec asserted that no step was ever discarded over a run (a slow frame legitimately discards): it now asserts that the resume itself drops nothing.
- The new `vscode-extension` CI job pointed at a script file that does not exist; a 5 s test timeout and a harness test that depended on the installed backend were found by this gate.
- Wording: `E5001` for built-in material params, `E9010` for non-constant initial values and its note (decision 0086).
