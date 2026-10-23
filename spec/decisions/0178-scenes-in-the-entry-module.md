# 0178. Scenes belong in the entry module

- Status: Accepted
- Date: 2026-10-23
- Specification: `spec/language.md` §9.2; `spec/diagnostics.md` (`E5230`).
- Audit: `docs/audits/2026-10-23-game-audit.md`, finding C4.

## Decision

A `scene` declared in a module other than the entry module is `E5230`. Prefabs, materials, structs, enums, functions and constants stay importable from anywhere.

The audit's suspicion was right: a scene in an imported module was lowered and packaged as one scene of the game (`package/builder.rs` takes every scene of the program), but the checks that make a set of scenes coherent run per module. Two scenes named `Level` in two modules wrote the same output file, so one silently overwrote the other, and `shared state` and `saved state` of one name could have different types without `E5204` or `E5212`. A scene of an imported module could not be reached by `go_to`, which resolves names through the module scope and cannot import a scene. So the scene was unreachable code with side effects on the package.

**Why reject instead of checking the whole program.** The state checks (`E5204`, `E5212`), the scene-name rule and the file naming would each have to move from the module to the program and be tested there. The only thing gained would be scenes in several files, which nothing can navigate to today because a scene cannot be exported. If a later decision lets a scene be exported and imported for `go_to`, the whole-program checks come with that decision.

## Alternatives considered

- **Whole-program uniqueness and state checks.** See above.
- **Ignore scenes of imported modules.** Silent; a scene that does nothing is the kind of surprise `E5230` removes.

## Verification

`tests/semantics/fail/e5230_scene_in_imported_module` (the shape from the audit: two `Level` scenes with a disagreeing `score`).
