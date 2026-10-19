# 0118. The language guide is a compact page of rules and patterns for programs that write Mtek, held to 16 384 bytes

- Status: Accepted
- Date: 2026-10-19
- Blueprint origin: M7 (blueprint §11), follow-up task K-03; decisions 0100 (the guide is generated from a template), 0108 and 0109 (a second Mtek condition loads `docs/language-guide.md`), 0116, 0117.
- Supersedes: the description of the guide in decision 0100 item 2 ("a tour of three demonstrations and the first example").

## Context

`docs/language-guide.md` is the file that the `mtek-guide` condition of the AI benchmark puts after the compiler context (`tools/ai-eval`, `MTEK_EXTRA_DOCS`). The guide of decision 0100 was a tour: it taught by showing four programs and said "it does not repeat the rules". Its examples were whole files (a theme module, a prefab, a configurator), which spent bytes on code that shows one idea and a page of other code. It did not mention references, textures and samplers, light units, exposure, key names or the purity of `bind` beyond a sentence, and a model that reads only the guide cannot learn rules that are not in it.

## Decision

1. **The guide carries the rules, and one correct pattern for each.** Its sections follow the concept pages: program shape, values, functions and effects, state and bind, entities and references and spawn, time and input, lighting and units, materials textures and assets, physics, modules and host inputs. Each section is a block of code that shows the patterns, with the reason for a pattern in a comment on the line above it, followed by the rules that code cannot show, each with the diagnostic code that it raises when broken. For depth the guide links the concept pages and says nothing it does not link.
2. **Only the guide is for a model; the concept pages are for everyone.** The guide has no introduction, no motivation and no list of the pages beyond a last line. A sentence is in it only if a model that does not know it writes a program that fails.
3. **Size.** At most **16 384 bytes** (16 KiB), as written to `docs/language-guide.md`. `npm run check:release` fails above it (`docs/guide-size`). The bytes are counted for the generated file, including the header; the budget is therefore also spent on the facts that the generator expands (the lists of names and the excerpts of examples).
4. **Still generated.** The mechanism of decision 0100 stays: the template is `tools/release-docs/templates/language-guide.md`, the generator expands `{{...}}` directives and the staleness test (`docs/stale`) compares the committed file with the generated one. Whole files and excerpts of examples are still copied by `{{example}}` and `{{excerpt}}`, now into blocks marked `from=PATH` so that a test finds the text in the file. The directives of decision 0116 give the lists of names (intrinsics by domain, keys, events, codecs, commands), the defaults and the field lists, so none of those is typed.
5. **Compiled.** Every Mtek block of the guide is compiled by decision 0117. A pattern that is shown is a program that compiles and, for a whole program, is canonical.
6. **Written from the sources.** The guide's rules come from `spec/`, the registry and the compiler's behaviour, and its programs from snippets compiled for this purpose and from `examples/`. No benchmark task prompt, reference solution, holdout item or result was read to write it, and the guide quotes none.
7. **No claims.** The guide says nothing about speed, cost or the number of tokens. The benchmark measures that; the guide only states the language.

## Consequences

- The guide changes whenever the registry changes (a new key, a default), and `npm run check:release` says so.
- Adding a rule means finding the bytes for it: something else is shortened. The size check is the discipline.
- The `mtek-guide` condition is not comparable with the same condition on the earlier guide; a report of a benchmark run records the hash of the guide it used (`context-export+docs/language-guide.md:<hash>`, decision 0108), which differs.

## Verification

`npm run check:release` (`docs/stale`, `docs/guide-size`, `docs/code`); `tools/release-docs/test` (the size limit fails on a guide of 16 385 bytes and names both sides). The size of the committed guide is stated in the completion report of K-03.
