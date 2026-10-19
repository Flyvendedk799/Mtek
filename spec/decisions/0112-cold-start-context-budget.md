# 0112. The byte budget of the cold-start context: what was measured, what fits 24 000 bytes, what was left out to make it fit, and what changed for projects with code

- Status: Accepted
- Date: 2026-10-19
- Blueprint origin: M7 (blueprint §11), follow-up K-01; `spec/ai-and-benchmarks.md` §2 (`--max-bytes`, default 24 000); decisions 0072 item 8 (truncation), 0108 (the harness uses 24 000 for both sides, the baseline documentation is never truncated silently), 0110, 0111.
- Supersedes: nothing.

## Context

Decision 0110 puts the library in the context of a cold-start project. The budget does not move: 24 000 bytes is the default of `mtek context`, the value the benchmark harness records for both conditions (`DEFAULT_CONTEXT_MAX_BYTES`), and the number the baseline's documentation is held to, so a larger one for Mtek alone would change the comparison. The requirement is that the context of a cold-start task is not truncated (`truncated` absent): a context that says it dropped something has told the model, and the report, that the export failed to fit the one project it was built for.

## Decision

1. **Measured** (bytes of the text `mtek context --entry src/main.mtek --format json` prints, before this task at `dfd365c` and after; the same project, the default budget):

   | project | before | after |
   |---|---|---|
   | empty entry module (cold start) | 7 566 | **22 638** |
   | `examples/pulse-cube` | 14 111 | 12 369 |
   | `examples/modular-scene` | 17 830 | 15 812 |
   | `examples/physics-playground` | 18 409 | 15 282 |
   | `examples/material-configurator` | 20 076 | 17 230 |
   | goldens with `--symbol`: `material-configurator` `Striped` | 11 472 | 11 600 |
   | `modular-scene` `Pillar` | 13 561 | 12 749 |
   | `physics-playground` `Crate` | 14 415 | 12 494 |
   | `pulse-cube` `Cube` | 12 239 | 11 427 |
   | `pulse-cube` with `--max-bytes 9000` | 8 845 | 8 881 |

   A scene with a camera and nothing else (`tests/context/golden/scene-stub.default.json`) is 22 939 bytes. The empty project leaves 1 362 bytes of the 24 000 for the project's own section and symbols (a stub scene with one camera costs 301), and a test keeps at least 1 000.
2. **Projects with code do not get a bigger context.** Four of the five goldens that follow an entry scene or a symbol shrink by 0.8 to 3.1 kB, because a schema field is a line instead of an object (decision 0110 item 4). Two small contexts grow, by 128 and 36 bytes: they use one or two schemas, so what the lines save is less than what the `schemaGuide` costs (104 bytes for a warm project). The selection of the neighbourhood, the examples and the order of truncation for a project with code are unchanged.
3. **What the full library did not leave room for, in the order it was given up.** The first complete rendering of an empty project was 34 523 bytes. Each cut below was measured when it was made (the sizes are approximate and were taken one after another, so they do not add up exactly to the difference) and is a rule of the generator, not a hand-written list:
   - field objects became lines (−5.5 kB) and enum members one string (−0.7 kB): decision 0110 item 4;
   - the plain mathematical functions share a line by signature (−1.2 kB) and the presets of a namespace (`sampler.linear_repeat|…`) share one without documentation (−0.45 kB);
   - the topic `lighting` of the conventions, which quoted four field docs the schemas already carry (−0.96 kB): decision 0111 item 2;
   - `declarations` (which declaration takes which schema; the schema docs say it) and the rules between fields (each field's doc says it, and a test holds the docs to the checker's rules) (−0.5 kB);
   - the range of a field when it is only "greater than zero", "not negative" or "finite" (−0.3 kB): the compiler reports a constant outside it (`E5006`), and a radius or a mass is not negative anyway;
   - the accessors of a `glb_asset` (−0.45 kB): they apply to a value only an asset file makes, they are named in `supported.features` as `method:glb_asset.<name>`, and the diagnostics name them;
   - the topic `rotation and matrices` (−0.25 kB), the schemas without fields (−0.26 kB), and the documentation of the body commands (−0.56 kB; names, argument names and the bodies that take them remain; the readable properties keep their documentation, which says "read-only");
   - **examples** (decision 0110 item 5): four examples do not fit beside the library, and a project that is a stub of a scene and a camera used to be shown them.
   What this costs a model: no example program in the context of a cold start (the `syntax.rules` and the field lines carry the shape of a scene, the language guide the rest), no glTF accessor signatures, no explanation of when a body command applies. These are the first things to restore if the budget of the benchmark is raised for both sides; `Reference::clear` and `REFERENCE_SECTIONS` make a section droppable by the budget today, so restoring one is adding its generator, not a format change.
4. **A budget below the full library degrades in sections, in the documented order** (decision 0110 item 5): `--max-bytes 12000` on an empty project drops records, body, events, builtins, conventions and enums, in that order as far as needed, and says so under `truncated.reference`; no schema is dropped before the last section of the library is gone. The default budget drops nothing for a cold start, and a test fails if it does.
5. **Registry growth.** The empty project is at 94 % of the budget. A registry row added later adds its field line or signature automatically; when the sum no longer fits 24 000 bytes the test `an_empty_project_lists_every_schema_field_and_every_enum_member` fails (it asserts `truncated` absent and the size) and the choice above is made again, in a decision, rather than by quietly dropping the new row.

## Consequences

- The cold-start context is 3.0 times larger than before (7.6 to 22.6 kB, about 5 700 tokens more); the benchmark's token accounting counts it (decision 0108). Whether the invented fields and keys it removes pay for it in fewer repair rounds is the measurement of M7-05 phase 2, not a claim made here.
- The documents that quote context sizes (`evidence/M7/ai-benchmark.md`, `benchmarks/results/ai/`) are records of a run with `contextFormat` 1 and are not edited.

## Verification

`an_empty_project_lists_every_schema_field_and_every_enum_member`, `a_stub_scene_gets_the_library_and_its_own_symbols_within_the_budget` and `a_budget_drops_the_library_in_sections_before_any_schema` in `crates/mtek-compiler/tests/context_cold_start.rs`; the goldens `tests/context/golden/*.json` pin the sizes above.
