# 0116. The documentation is an index, a tutorial and one page per concept, written from templates against the registry

- Status: Accepted
- Date: 2026-10-19
- Blueprint origin: M7 (blueprint §11), follow-up task K-03 ("proper documentation"); decisions 0100 (the release documentation is generated), 0101 (the consistency check), 0103 and 0104.
- Supersedes: nothing. Extends 0100: the set of generated pages grows from three to every page under `docs/` that is written from a template.

## Context

The first AI benchmark run (decisions 0108 and 0109) loaded `docs/language-guide.md` into one of its conditions. Many failures there were rules a reader cannot guess from the syntax: how to hold a reference to a spawned entity, what a texture or a sampler is and how a path is resolved, what `bind` may call, how a prefab is shaped, which unit a light has and what the exposure does to it, what the keys are called. The guide was a tour of four example programs; it did not state those rules, and no other page did either. A person has the same problem: `docs/getting-started.md` teaches the tool, and `spec/` is normative but is written for the compiler.

## Decision

1. **The pages.** `docs/README.md` is the index and the learning path. `docs/tutorial.md` builds one program in seven steps. `docs/concepts/*.md` has one page per concept: values and types, functions and effects, state and bindings, time and input, entities and references, prefabs and scenes, lighting and units, materials and shaders, textures samplers and assets, physics, modules projects and host inputs. `docs/language-guide.md` is the compact guide of decision 0118. The reference, the limitations page, the coverage matrix and the getting-started page keep their roles.
2. **Every concept page has the same sections**, as `## Rules`, `## Why`, `## Examples`, `## Common mistakes` and `## See also`, after a title and a short introduction, and ends with `## Diagnostics on this page`. A rule is a numbered item that says what the compiler accepts and the code it raises otherwise. "Why" says the reason for the rule. The examples are minimal and correct. "Common mistakes" has at least one block that is wrong on purpose, with the diagnostic it raises named in the text. The check `docs/structure` fails a page that lacks a section, and `docs/wrong-cited` fails a wrong block whose code the prose never names.
3. **The pages are written from templates.** `tools/release-docs/templates/pages/<path>.md` is written to `docs/<path>.md` by `npm run generate -w @mtek/release-docs`, and `npm run check:release` fails when a committed page is not what the generator writes (`docs/stale`, as for the three pages of decision 0100). A template is Markdown with directives in double braces, so that a fact that the compiler knows is never typed twice:
   - `{{fields SCHEMA}}`, `{{field-list SCHEMA}}`, `{{default SCHEMA.FIELD}}`, `{{range SCHEMA.FIELD}}`: the registry fields of a schema, as a table, a line of code, a default or a range;
   - `{{enum NAME}}`, `{{signature NAME}}`, `{{methods TYPE}}`, `{{members NAMESPACE}}`, `{{events}}`, `{{body-commands}}`, `{{type-fields TYPE}}`, `{{intrinsics DOMAIN}}`: enum members, signatures, methods, namespace members, the events, the body commands and the functions of an execution domain, from the registry;
   - `{{project-default NAME}}`: a default of the project configuration, read from `crates/mtek-compiler/src/project/config.rs`;
   - `{{exposure-for LUX}}`: the camera exposure for an illuminance, computed with the formula of `spec/materials.md` §8 rule 9, and checked by `docs/exposure-formula` against the default exposure of the registry;
   - `{{reserved-words}}`, `{{features PREFIX}}`, `{{schemas CATEGORY}}`, `{{codecs}}`, `{{commands}}`, `{{decision N}}`: as in decision 0100, with the additions named here;
   - `{{cited-codes}}`: a table of every diagnostic code (`MTEK-E5070`) that the page mentions, with the title of the catalogue, so that the table cannot omit or invent one.
   A directive that names a schema, field, enum, type or code that does not exist is an error in the generator.
4. **Links are held to the pages.** `docs/links` covers every generated page and fails a relative link that points at nothing. `docs/anchors` fails a link `page.md#anchor` whose page has no heading with that GitHub anchor. `docs/index` fails when `docs/README.md` does not link every concept page, the tutorial, the guide, the reference, the limitations and the getting-started page. `docs/cited-codes` fails a diagnostic code in a page that is not in `spec/diagnostics.md`.
5. **What a page may not say.** Pages are written from `spec/`, the registry, the compiler and the programs of `examples/`; not from benchmark task prompts, reference solutions, the holdout or stored results. The check `docs/claims` fails a page whose prose uses a word of a short list (benchmark, performance, faster, efficient, token cost, the paths of the benchmark inputs): the documentation makes no claim about speed or about tokens.
6. **The getting-started page is unchanged.** It is executed against the real tool (decision 0091). Its links are included in the anchor check.

## Consequences

- A new registry field, enum member or default changes the pages in the same commit, or `npm run check:release` fails.
- A page gets a code example only by writing it into a template, where decision 0117 holds it to the compiler.
- Writing a page is slower than writing prose: the examples have to compile and be canonical. That is the intended price.

## Verification

`npm run check:release` (`docs/stale`, `docs/links`, `docs/anchors`, `docs/index`, `docs/structure`, `docs/wrong-cited`, `docs/cited-codes`, `docs/claims`, `docs/exposure-formula`); the unit tests of `tools/release-docs` (each of these checks fails on a mutated page and names both sides; each directive has a test and an error test). Recorded in the completion report of K-03.
