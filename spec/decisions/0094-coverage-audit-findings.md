# 0094. The findings of the M7-02 audit: gaps in fixtures and in the allow-lists, and what was done about each

- Status: Accepted
- Date: 2026-10-19
- Blueprint origin: M7 (blueprint §11), task M7-02; decision 0093 (the tool), 0027 item 11 (the allow-lists), 0070 item 11 (the naming lint)
- Supersedes: nothing.

## Context

The first run of `tools/coverage-matrix` (decision 0093) against the repository at the merge of M7-01 found what a hand count had not. This record lists every finding and the response, so that the M7 gate can see what was added and what was only recorded. The honesty rule of the task applied throughout: no assertion was weakened, nothing was dropped from the registry, and a code was put on a list of exceptions only when no program of v0.1 can produce it or a fixture cannot express it.

## Decision

1. **Features without a demonstration or a positive fixture (13 of 303).** `event:pointer_move`, `event:pointer_up`, `value:frame.delta`, `value:frame.index`, `expr/camera-field-read` (reading `Main.position` from a handler), `expr/material-literal` (a user material's descriptor that is not constant, used as a value) and six host input codecs: `i32`, `u32`, `bool`, `vec2`, `vec4`, `string` (only `f32`, `vec3` and the two colour codecs were exercised). Four minimal passing fixtures close these twelve, in the style of the existing ones (`mtek.toml` and `src/main.mtek`, no expected file because they check cleanly): `tests/semantics/pass/handler_pointer_events`, `frame_and_camera_reads`, `material_literal_value` and `host_inputs_every_codec`. The thirteenth, `schema:Scene`, was a gap of the tool (a scene with written fields did not feed it), not of the fixtures; the tool was fixed.
2. **A pressure that was not one.** The first draft listed `module/cross-file-material` as a pressure of the modular scene; the material configurator also keeps its materials in a module of its own. The tool said so, and the list lost that item (decision 0093 item 2). Every other pressure of decision 0002 is exercised by exactly one demonstration.
3. **The allow-list of decision 0027 was not empty at M7.** `NOT_YET_IMPLEMENTED` still held 14 codes with milestone reasons that had been overtaken. Ten of them are implemented and tested at run time: `E8011`, `W8030`, `E8030`, `W8031`, `W8032`, `E8033`, `E8041`, `W8070`, `E8090`, `E8100`. They moved to `coveredElsewhere` with the test file that names each code (the runtime's unit tests, `spec/testing.md` §2). Four are not covered by any test because no program can produce them. They are in `reserved`, each with its reason and each marked in `spec/diagnostics.md` §5:
   - `E5901` (scene switching) and `E5902` (transparency): v0.1 has no construct that switches scenes or asks for transparency; `mtek context` lists both features as not supported.
   - `E6003` (more than 16 inter-stage variables): the limit cannot be reached, v0.1 allows 4 and has no custom vertex stage (`E4901`).
   - `W0030` (the naming lint): see item 4.
4. **A divergence the gate should decide: `W0030`.** `spec/language.md` §3.3 says the formatter's lint `W0030` warns about names that do not follow the conventions; decision 0070 item 11 says it is not part of `spec/tooling.md` §5 and is not implemented; the catalogue lists it without saying so. It stays reserved here with a visible reason. The M7 gate has two honest options: implement the lint in `mtek fmt` (and then give it a fixture and take it off the list), or amend §3.3 to say it is planned for a later version. Neither is a change this task should make silently.
5. **A hard gate that is a v0.1 gap.** `supported.notSupported` lists `non-constant-initial-values`: initial values of `state` that are not constant expressions are "specified for v0.1 but not implemented by this compiler build yet" (`E9010`, decisions 0039 item 9 and 0086). The matrix shows it as a rejected neighbour with its `E9010` fixtures. It is a missing feature of a v0.1 specification, not a missing test, and is reported rather than changed.
6. **What the audit found fully covered.** All 30 reserved words have an `E0013` fixture that names them; four of the six `x9xx` unsupported-feature codes have a fixture and the other two are the reserved ones of item 3; every code of every negative-test area has a fixture or a named test; no fixture expects a code the catalogue does not have; no entry of the lists of exceptions other than the overtaken `notYetImplemented` was stale.
7. **Changes made to the compiler, none to its behaviour.** `mtek_compiler::context::used_features(root, fs)` (public, additive) returns the features a project uses as the example selection of `mtek context` reads them, plus the glb accessors and body commands the type checker recorded; `Program::used_features` itself is unchanged, so no golden moved. `tools/coverage-uses` prints it per project directory. The four marks in `spec/diagnostics.md` are in the Trigger column, which the catalogue test does not read. The Rust test `every_catalogue_code_has_a_fixture_or_a_listed_reason` reads `code-coverage-exceptions.json` and additionally checks the marks.
8. **Not done.** The per-field matrix (item 3 of decision 0093); a browser spec for the four new fixtures (they are compile-time evidence: the compiler suites check them and the tool reads them; the runtime side of host input codecs is `packages/runtime-web/src/host/codecs.test.ts`, and no spec was added for the pointer events or `frame.delta`/`frame.index` at run time, which this task did not audit); a decision on `W0030` and on non-constant initial values (items 4 and 5).

## Consequences

- The M7 gate can cite `docs/coverage-matrix.md` for the sentence "every advertised language feature has a passing positive fixture and appropriate negative tests", with the limits of items 3, 4 and 5 beside it.
- A future change that makes `E5901`, `E5902` or `E6003` reachable, or implements `W0030`, must give the code a fixture and remove it from `reserved` and from its mark in the catalogue; the Rust test and the tool both fail until it does.

## Verification

Recorded in the completion report of M7-02.
