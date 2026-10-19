# 0103. The limitations page and what the release contract excludes

- Status: Accepted
- Date: 2026-10-19
- Blueprint origin: M7 (blueprint §11), task M7-06 ("a Limitations page listing every `x9xx` diagnostic and documented restriction (decisions 0015, 0016)"); decisions 0015 (asset strictness), 0016 (v0.1 restrictions), 0086 (the wording of `E9010`), 0094 (the audit findings), 0100, 0102.
- Supersedes: nothing.

## Context

The restrictions of v0.1 are spread over the specification: the `x9xx` codes (`spec/diagnostics.md` §3), the "Not in v0.1" sections of `scenes.md`, `materials.md` and `language.md`, the strict glTF profile (decision 0015), four narrowings of the blueprint (decision 0016), a hard gate (`E9010`, decision 0086), codes that no program can produce (decision 0094) and a measured physics weakness (`physics.md` §7.1). A reader and a release note need one list; a list that is typed from those places drifts.

## Decision

1. **One page, `docs/limitations.md`, generated** (`tools/release-docs/src/limitations.ts`). Its first section states the rule: the release contract is what the specification promises and a test proves; everything on the page is excluded from it, and nothing is hidden behind a softer word.
2. **Derived, not typed.**
   - Section 2, every `x9xx` diagnostic: the codes come from the diagnostics catalogue by the pattern `[EW]\d9\d\d`, with `E9999` (the internal error, the one exception that `spec/diagnostics.md` §3 names) set apart; the title and trigger from the catalogue; the negative fixture from the same reader as the coverage matrix (`readFixtureCodes`). Six codes today: `E1901`, `E4901`, `E5901`, `E5902`, `E7901`, `E7902`.
   - Section 3, the gates: `supported.notSupported` of `mtek context` (today `non-constant-initial-values`).
   - Section 4, the reserved words: `notSupported`, checked against `spec/language.md` 2.3.
   - Section 5, specified but never produced: the `reserved` list of `tests/semantics/code-coverage-exceptions.json` and the catalogue marks (`E5901`, `E5902`, `E6003`, `W0030`).
   - Section 7: `notSupported`, verbatim.
3. **Hand-written, but anchored.** `tools/release-docs/data/limitations.json` holds the reason of each `x9xx` code and of each gate, and the documented restrictions of section 6 (30 entries by area: language, materials and rendering, scenes and entities, physics, input, host page, assets, compiler, runtime, tooling). Every entry carries a quotation of the specification, a decision or the catalogue; a test (`validateLimitationsData`) fails if the quotation is not found verbatim in the named file, if a code is not in the catalogue, if a decision does not exist, or if an `x9xx` code has no reason (or a reason names a code that is not `x9xx`). Where the specification gives no reason beyond "not in v0.1", the entry says that; no rationale is invented.
4. **Two things the page says that earlier documents did not.**
   - `non-constant-initial-values` (`E9010`): the initial value of an entity or camera field, a material instance parameter or a projection field that is not a constant expression is rejected, although `spec/scenes.md` §11 specifies that such values are evaluated once at construction. Checked with the build of this commit: a scene `state` initialised by a pure user function (`state a: f32 = half(1.0);`) checks and builds; `position: vec3(half(1.0), 0.0, 0.0)` is `E9010`. The page says exactly that, not that "state initialisers" are rejected.
   - `W0030`: decision 0102.
5. **Anything not on the page is not excluded by it.** The page lists what is refused; what is promised is the specification, and what is proved is `docs/coverage-matrix.md`.

## Consequences

- A new `x9xx` code, a new gate or a new reserved word appears on the page when the catalogue or the compiler changes, and the check fails until its reason is written.
- A restriction recorded in prose elsewhere but missing from `limitations.json` is not detected: the list of section 6 is curated. What is detected is a curated entry whose source sentence is gone.

## Verification

`npm run check:release` (`limitations/*`, `docs/stale`); `test/live.test.ts` ("an x9xx row missing from the limitations page", "a code the catalogue does not have", "the gate missing", "a notSupported item missing", "a reserved code missing from section 5"). Recorded in the completion report of M7-06.
