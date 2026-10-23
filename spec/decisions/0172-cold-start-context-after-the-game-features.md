# 0172. The cold-start context after the game features: overloads and families share a line, and the default budget is 30 000 bytes

- Status: Accepted
- Date: 2026-10-23
- Amends: decision 0112 (the budget of 24 000 bytes), decision 0147 and decision 0148 (the room of 1 000 bytes stays). Specification: `spec/ai-and-benchmarks.md` §2, `spec/tooling.md`.
- Source: `docs/audits/2026-10-23-game-audit.md` §1 (five red tests in `context_cold_start.rs`).

## Context

After PR #4 (hud, audio, tweens, sprites, particles, timers, tags, input polling, camera switching, animated clips) the context of an empty project no longer fit the 24 000 bytes of decision 0112. The budget dropped the library in sections (decision 0112 item 4), which is what the five failing tests saw:

- a stub scene lost `records`, `body`, `events` and `builtins` from `reference`;
- the empty project was truncated, and `reference.typeClasses` and the signatures were gone (the failure at `T = f32 | vec2 | vec3 | vec4` was this, not a formatting bug: the line is correct, and was not in the output);
- 112 `function:*` entries were in `supported.features`. Decision 0148 puts them back when `builtins` is dropped, so this was the same truncation again, not a second listing of the functions that decision 0148 keeps out;
- the goldens `empty` and `scene-stub` were written from a truncated context.

Nothing was wrong in the rule of decision 0148. The library grew.

## Where the bytes went

Bytes of the JSON text of an empty project with a budget large enough to drop nothing (`mtek context --entry src/main.mtek --max-bytes 1000000`), per section, at the commit before the small-game work (`4e7ff0e3`), on `main` (`d28886b8`) and after this decision. At `4e7ff0e3` `supported.features` still has the `function:*` entries (decision 0148 came later), which is why it is larger there.

| section | `4e7ff0e3` | `d28886b8` | this decision |
|---|---|---|---|
| total | 22 638 | **29 909** | **28 288** |
| `supported.features` (entries) | 3 665 (168) | 2 318 (112) | 2 318 (112) |
| `supported.notSupported` | 642 | 531 | 531 |
| `syntax` | 1 571 | 1 609 | 1 609 |
| `schemaGuide` | 230 | 230 | 296 |
| `schemas` | 7 328 (15) | 9 361 (17) | 9 361 (17) |
| `reference.builtins` (lines) | 3 590 (42) | 10 266 (84) | 8 615 (75) |
| `reference.enums`, `typeClasses`, `events`, `records`, `body`, `conventions` | 3 138 | 3 138 | 3 138 |

The growth since `4e7ff0e3` after decision 0148 took `function:*` out is 8 648 bytes against 21 261:

- `reference.builtins` +6 676: 42 more lines, and the longest are the overload families (`hud.text` 5 signatures 694 bytes, `hud.button` 404, `hud.rect` 287, `play` 275, `play_at` 257, `play_music` 211) and the ten `easing.*` lines (about 1 300 bytes, each repeating "`t` is clamped to 0..1, the result is 0 at 0 and 1 at 1.");
- `schemas` +2 033: the `Sprite` and `Emitter` schemas, and `tag`, `particles` and `clip` on `Entity` (+691).

The new rows are the library a game needs and are documented as tersely as the older ones. The growth is real, not waste, so most of it cannot be compacted away.

## Decision

1. **Overloads that only add trailing arguments are one signature with the optional arguments in brackets.** When every signature of a function extends the one before it with more arguments and gives the same type, the line is `play(sound: sound, [volume: f32, pitch: f32]) -> ()`, not three signatures. Overloads that are not such a chain (`abs(x: T) -> T; abs(x: I) -> I`, `mix`) are written as before. The cold-start `schemaGuide` says so ("In a function signature, arguments in [brackets] may be left out."). Nothing is lost: the leading arguments of the bracketed list are the shorter overloads.
2. **A family of three or more namespace functions with one signature list, domain and restriction, whose documentation ends in the same sentence, is one line** with the names joined by `|` and that sentence: `easing.in_quad|out_quad|…|out_bounce(t: f32) -> f32 [cpu only] // `t` is clamped to 0..1, the result is 0 at 0 and 1 at 1.` The part of each documentation in front of the common sentence ("Easing t²;", "Easing bounces at 1 like a dropped ball;") is not shown: the names say which curve it is, and the namespace documentation says what the family is for. This is the rule decision 0112 item 3 uses for presets, widened from "takes nothing" to "shares the whole documentation but its first clause". No function loses its name or its signature, and a test checks that no function is listed twice.
3. **The default budget of `mtek context` and of the benchmark harness (`DEFAULT_CONTEXT_MAX_BYTES`) is 30 000 bytes, not 24 000.** After items 1 and 2 an empty project is 28 288 bytes and a stub scene (one camera) 28 589. 24 000 would need 4 300 bytes removed from sections that are all the registry's own wording (the field documentation, the signatures, the `notSupported` names): that is dropping information from the context of the one project it is built for, which decision 0112 rules out. Decision 0112 fixed 24 000 because it is the number the benchmark records for both conditions. It still is: the harness constant moves with the CLI default, so both conditions use 30 000 and the comparison is the same one. The room for the project's own section and symbols stays 1 000 bytes (1 712 now). The decision also leaves room for the next registry rows; the next growth of 1 700 bytes makes the choice again, in a decision.
4. **Goldens.** `tests/context/golden/empty.default.json` and `scene-stub.default.json` are blessed. Their diff: the `function:*` entries are gone from `supported.features` (they were in the truncated output), and `reference`, `typeClasses`, `builtins`, `events`, `records`, `body`, `conventions` and the enums are back. The warm goldens did not change: they were never over the budget.

## Alternatives considered

- **Drop the `function:*`, `event:*`, `body-*`, `enum:*`, `value:*` and `schema:*` entries of `supported.features` in a cold start.** `event:*` to `schema:*` repeat `reference` and `schemas` as `function:*` did, and the saving is about 900 bytes. It needs the same restoring rule as decision 0148 for each of four reference sections the budget can drop, and it does not change the outcome (28 288 would become about 27 400, still over 24 000). Left for the next growth.
- **Print the context without the indentation.** The two-space indentation is 3 100 bytes of the 29 909 (decision 0072 fixes it as the format of the text). A format change with a `contextFormat` bump and every golden; not needed to fit.
- **Shorten `[handlers and lifecycle functions only]`.** About 250 bytes; the label is quoted by the benchmark records (decision 0148).
- **Keep 24 000 and truncate `body`/`events`/`records` for a stub.** Against the requirement of decision 0112 that a cold start is not truncated.

## Consequences

- The cold-start context is 28.3 kB, 7.0 kB more than the 21.3 kB of decision 0148. Benchmark runs before this decision (PR3, 2026-10-20) used 24 000 bytes and a context that did not have the game features; their results are not comparable with a run after it.
- The detail of the budget in `spec/ai-and-benchmarks.md` §2 and `spec/tooling.md` is now 30 000. The older decisions 0072, 0077, 0108, 0110, 0112, 0147 and 0148 quote 24 000 as it was then and are not rewritten.
- `tools/ai-eval/src/repair-loop.ts` has the same default. The tests there that pass `24_000` explicitly are unchanged: they pin an explicit argument.

## Verification

`crates/mtek-compiler/tests/context_cold_start.rs`: `overloads_and_families_share_a_line_without_losing_a_function` (new), `an_empty_project_lists_the_signature_of_every_built_in` (accepts the bracketed form), `a_cold_start_names_the_functions_once`, `a_stub_scene_gets_the_library_and_its_own_symbols_within_the_budget`, `an_empty_project_lists_every_schema_field_and_every_enum_member`, `cold_start_goldens`.
