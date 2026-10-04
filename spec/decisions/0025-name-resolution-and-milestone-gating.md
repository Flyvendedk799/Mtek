# 0025. Name resolution and milestone gating: details the specification leaves open

- Status: Accepted
- Date: 2026-10-04
- Blueprint origin: §3.4 (one registry), §9.4 (diagnostics); `spec/language.md` §2.1–§2.4, §4, §9.5; `spec/scenes.md` §2–§5; `spec/compiler-architecture.md` §4.3, §4.6; `spec/diagnostics.md` §5.2.

## Context

Task M1-09 implements `crates/mtek-compiler/src/resolve/` (scopes, `DefId`s, the `NodeId -> Res` side table, the no-shadowing rules) and milestone gating: every construct that parses but is not implemented by the running build is `E9010`. It also wires the front end (`mtek_compiler::check`: load, lex, parse, resolve, entry scene). The specification states the rules but not every choice an implementation has to make: which milestone implements which construct, how often a gated program is reported, and a handful of scope and diagnostic details. They are fixed here so that they are visible, testable and changeable by a later record.

## Decision

All of the following are **proposals** (design choices), not external constraints.

1. **One constant.** `resolve::IMPLEMENTED_MILESTONE` is the registry's `stdlib::CURRENT_MILESTONE` (decision 0024), so the construct table and the registry cannot disagree about the build. A construct or registry item is implemented when its milestone `is_reached_by` that constant.

2. **The construct table** (`resolve::gate::construct_gate`, an exhaustive `match`, so a new construct cannot be forgotten). M1 implements what task M1-09 lists: scenes with scene fields, `camera` objects, entities (nested), descriptor literals of M1 registry schemas, `const` items and module constants. The milestones of the rest follow the work items of the plan:

   | Construct | Milestone | Work item |
   |---|---|---|
   | `import` | M2 | M2-03 |
   | `export` (reported at the keyword) | M2 | M2-03 |
   | `fn`, `cpu fn` | M2 | M2-02 |
   | `struct` | M2 | M2-01 |
   | `material` (with its params and stage functions) | M2 | M2-04 |
   | string literals; array literals and indexing | M2 | the registry types `string` and `array` are M2 (a unit test keeps the rows equal to the registry) |
   | `state` (scene, entity, prefab) | M3 | M3-01 |
   | lifecycle functions | M3 | M3-02 |
   | event handlers | M3, or the event's `since` if later (`on collision_enter` is M5) | M3-02 |
   | `bind` | M3 | M3-05 |
   | `self` | M3 | with `state` (M3-01): in M1 `self` could only read fields in initialisers, which is `E5081` |
   | `prefab`, prefab instances (`entity Name: Prefab`) | M5 | M5-01 |
   | `const` in scene, entity and prefab bodies | M1 | constants, like module constants |

   Statements, parameters and stage functions are part of the construct they appear in (a function, handler, lifecycle function or material) and have no row of their own. Operators, conversions and swizzles are not gated here: which of them the M1 type checker implements is M1-10's decision (it may gate them with the same mechanism).

3. **Registry gating.** A prelude name used in an expression or type, a namespace or enum member (only once its owner is implemented), a schema in a descriptor literal, a field of a registry schema (scene fields against `Scene`, entity and prefab fields against `Entity`, camera fields against the kind's schema, descriptor fields against the descriptor's schema), a scene-object kind and an event are gated by their own `since`. Fields a schema does not have are left to the schema checks (`E5001`, M1-11).

4. **The outermost construct is reported, once.** `E9010` is reported at the construct's span (the whole item, member, field or expression; for a prelude name the name; for `export` the keyword), with the note "this compiler build implements the language up to milestone M1". Inside a reported construct nothing is gated again, so a function full of statements, arrays and M2 intrinsics is one `E9010`. Its names are still resolved and every non-gating diagnostic (`E2001`–`E2005`, `E3003`, …) is still reported, so nothing that parses is silently accepted. When a milestone lands, the constructs inside become visible to the gate by themselves.

5. **Messages.** `E9010` messages are one sentence: "`<subject>` is/are specified for v0.1 but not implemented by this compiler build yet (planned for M<n>)." — capitalised and ending with a period like every other message ("Imports are specified …", "`fn` declarations are specified …", "The built-in function `sin` is specified …", "The `Entity` field `light` is specified …", "Event handlers (`on key_down`) are specified …").

6. **Scopes.** The scene scope holds `state`, `const`s, scene objects and every entity of the scene at every depth (`spec/scenes.md` §4.2). An entity body's enclosing scope is the scene (or the prefab), not the body of its parent entity: nesting is parenting, not inheritance (§4.3), so a child may declare a constant its parent also declares. Module, scene and body scopes are order-independent (names are declared before anything in them is resolved); locals, block constants and loop variables are visible from the end of their declaration to the end of the block. Entities nested in a prefab are declared in the prefab's scope (`E5040` is the checker's). A prefab does not see scene names (`E2003`, `spec/scenes.md` §5).

7. **Prelude reuse** (`spec/language.md` §4.2). "Local" means `let`, `var` and a `for` variable; "parameter" means a parameter of a function, stage function, lifecycle function or handler. Those, `state` and `param` may reuse a name that is *only* a prelude function. Constants (at any level), entities, scene objects and items may not reuse any prelude name. The `param` exception covers a prelude type that is also a namespace (`color`, `quat`, `mat4`, `texture`, `sampler`) but not a schema or enum. `E2004` is reported for a call whose callee is a bare name resolving to such a local; `E2005` for `name.member` where `name` is a `param` and `member` is a member of the prelude namespace `name` (`color.r` stays a field access). Entity and prefab `state` named like an `Entity` field is `E2002` with a note (`spec/scenes.md` §4.4).

8. **Codes owned elsewhere.** `E0013` is reported by the parser wherever a reserved word appears as a name; the resolver treats the word as an ordinary name and does not report it a second time. `E0012` is reported for `_` in any name position, declared or used (a use cannot refer to anything, and "unknown name `_`" would be misleading). Names in type position are resolved here, so the resolver reports `E3003` for an unknown type name and for a name that denotes something other than a type; `Res::Error` always means "already reported" and M1-10 must not report the same name again.

9. **"Did you mean"** (`spec/language.md` §4.3, `spec/diagnostics.md` §6). A suggestion is attached only when exactly one candidate visible at that point (declarations and prelude names alike) is within edit distance 1–2. A declared candidate is a related span; a prelude candidate has no span, so it is a `help:` note. Unknown members of prelude namespaces and enums are `E2003` with the same rule over the members. No suggested edit is attached (an edit needs the re-check of §6, M6-02).

10. **Contextual words have no `Res`.** Lifecycle and stage function names and event names the registry does not know (`E5052`, `E5060` are the checker's, M3-02) get no side-table entry; known events resolve to `PreludeItem::Event`.

11. **Entry scene and `E9006`.** `check` selects the scene with `project::select_scene`. Ambiguous (several scenes, no `project.scene`): primary span at the second scene's name, related span at the first, help listing the scenes. A configured name that is not declared, or a module without scenes: project-level diagnostics (`source: null`, as for other `mtek.toml` diagnostics, decision 0018) with a "did you mean" under the rule of item 9. "Declares no scene" is not reported when an item failed to parse, because that would be a cascade of the syntax error.

12. **`check` API.** `mtek_compiler::check(&ProjectRoot, &dyn Fs) -> CheckResult { project, module, resolution, report }` (`spec/compiler-architecture.md` §4.12). The parser's candidate edits are not attached yet (they need validation, M6-02).

## Consequences

- When a milestone lands, its work item changes the row(s) of item 2 (or the registry's `since`, or the constant) and the `gate_*` fixtures that stop failing move to `tests/semantics/pass/` or get the new nested diagnostics; the gating logic does not change.
- `spec/compiler-architecture.md` §4.6 points here.

## Verification

`tests/semantics/fail/` (one fixture per resolver code, one `gate_*` fixture per gated construct and per kind of registry item), `tests/semantics/pass/`, and in `crates/mtek-compiler/tests/fixtures.rs` the tests `every_gated_construct_has_a_gating_fixture`, `registry_gates_without_a_fixture_are_unreachable_in_this_build`, `a_construct_inside_a_gated_construct_is_not_reported_again`, `every_resolver_code_has_a_semantic_fail_fixture`, `semantic_results_are_deterministic`; unit tests in `src/resolve/tests.rs` and `src/resolve/gate.rs`; `tests/resolve_corpus.rs` (side-table coverage over the syntax corpus, mutated programs).
