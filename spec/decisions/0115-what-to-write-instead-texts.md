# 0115. The "what to write instead" texts: which diagnostics say what, and why each form is the right one

- Status: Accepted
- Date: 2026-10-19
- Blueprint origin: task K-02; decisions 0113 (the rules) and 0114 (the cascades); `spec/language.md`, `spec/scenes.md`, `spec/materials.md`, `spec/stdlib.md` (the rules the texts restate).
- Supersedes: nothing.

## Context

Decision 0113 sets how a diagnostic names the way out. This record lists the classes and the form each recommends, so that a later change to the language changes these texts with it. Every example below was run through `mtek check` and passes, except where it is the mistake itself.

## Decision

| code | mistake | what the diagnostic says to write |
|---|---|---|
| `E2003` | `null`, `nil`, `None`, `undefined` | "Mtek has no null value"; keep a `bool` state next to the `entity_ref` (`state has_target: bool = false;`), start the reference at a named entity (`state target: entity_ref = Floor;`), set both when you `spawn`; `alive(target)` is false once the entity is destroyed |
| `E2003` | `Key.Up`, `Key.Left` | the nearest members and every member of `Key` (decision 0113); `Key.Up` is an edit to `Key.ArrowUp` |
| `E2003` | `Math`, `console`, `Vec3`, `this`, `dt`, `time` | `Math`: the functions are global (`sin(x)`, `sqrt(x)`, ...) and there is no `PI`; `console`: `print`; `Vec3`: lowercase, called; `this`: `self`; `dt`: the parameter of `update`, `frame.delta`; `time`: `frame.time` |
| `E3001` | an `entity_ref` (or another value) called like a function | what a reference allows (`==`, `alive`, `destroy`, `r.body.<command>`, `spawn` to create); a handle is opaque; a number is combined with an operator or converted with `f32(x)` |
| `E3001` | `vec3.zero()`, `vec3` as a value | call the type: `vec3(x, y, z)` or `vec3(s)` |
| `E3002` | wrong argument count | the parameters in the message, the missing or extra arguments in a help (decision 0113) |
| `E3003` | `float`, `int`, `Vector3`, `Texture2D`, ... | the Mtek spelling (`f32`, `i32`, `vec3`, `texture`) and the list of types |
| `E3013` | `v.length()`, `x.abs()`, `v.dot(w)` | a built-in function, not a method: the signature `length(x: T) -> f32` |
| `E1001` | `if` where a value is required | `if` is a statement; declare the variable and assign in the branches (`var x = a; if cond { x = b; }`); `mix(a, b, t)` for numbers; there is no ternary operator |
| `E0005` | `?` | the same advice as the `if` expression |
| `E0013` | `while`, `loop`, `match`, `enum`, `mut`, `impl` | the form v0.1 has: `for i in 0..n { ... }` with `break`; an `if` chain; `i32` constants; `var`; a function with the value as an argument |
| `E1040` | `prefab`, `fn`, `struct`, `material`, `import`, `scene` in a scene or block; `entity`, `state`, `on` at the top level; a statement in a scene, entity, prefab or material; a `param` in a scene; a stage function outside a material | where the declaration belongs, with the one-line form (`entity Name: PrefabName { ... }`, `spawn(PrefabName { ... })`, `update(dt: f32) { ... }`) |
| `E5005` | a `bind` that calls a `cpu fn` or a CPU intrinsic | why (they run only in `update`, `fixed_update` and `on` handlers) and the two ways out: declare the function `fn` if it needs no CPU-only operation, otherwise call it in `update`, assign to a `state` and `bind(that_state)` |
| `E5040` | an `entity` inside a prefab | a prefab is the template of one entity: write its fields directly; declare the structure in the scene, where an `entity` inside an `entity` is its child, or one prefab per part |
| `E5061` | a filter that is not a constant member | the filter is fixed when the program is built; test `is_key_down(...)` in `update` or write one handler per key |
| `E5001` | an unknown field of an entity, camera or schema (`pos`) | the nearest fields, by the ranking of decision 0113 (`pos` is `position`); the valid fields were already in the message |
| `E5060` | an unknown event | the nearest event names, and the events of v0.1 as a note |
| `E4011` | a `texture` or `sampler` local or function parameter in GPU code | declare it as a param of the material and use `sample(tex, smp, uv)`; a helper takes the `vec4` that `sample` returns, never the texture |
| `E4011` | a `string`, or a handle (`entity_ref`, `mesh`, `material`) | strings exist only on the CPU; give the stage the number, vector or colour as a `param`, `bind` for a value that changes |
| `E4012` | `texture.white()`, `sampler.*`, `asset.*` in a stage | textures and samplers are made outside the stage, as params with their default; `random()`: compute it on the CPU, keep it in a state, give it to the material with `bind`; `print`: remove it |
| `E4040` | a `texture` or `sampler` constant read by a stage | a param of the material with the constant as its default |
| `E4041` | a texture or sampler param used other than as an argument of `sample` | use it directly in `sample(...)`; a helper takes the `uv` or the result |
| `E4031` | a default that is not a constant, or of the wrong type | defaults are fixed when the material or prefab is declared; set a value that changes where the instance is made (`material: Name { param: bind(state) }`, `entity Name: Prefab { param: value }`); a `texture` default is `texture.white()`, `texture.black()` or `asset.texture("file.png")`, a `sampler` default one of the four constructors |

The advice is a `help:` or `note:` line added to the diagnostic; the lines that were there before (what a scene may contain, what a binding may read) stay. None is an edit: each needs a decision of the author (which state, which prefab, which constant), which `spec/diagnostics.md` §6.2 forbids guessing.

## Consequences

- A change to the language that makes one of these forms stop checking is a change to its text and its fixture; the fixtures hold the text.
- The foreign names that are corrected are the ones in `foreign_name_help` and `foreign_type` in `crates/mtek-compiler/src/resolve/resolver.rs`; more can be added with a fixture. The lists are data in the source, not in the registry.
- The texts were written from `spec/diagnostics.md`, the language specification and the checker's own rules. No benchmark task, reference solution, holdout or result was read for them.

## Verification

Fixtures: `e2003_null_value`, `e2003_foreign_global_math`, `e3001_entity_ref_called`, `e3001_name_is_not_a_value`, `e3003_foreign_type_name`, `e3013_method_call_style`, `e1040_prefab_and_fn_in_scene`, `tests/syntax/fail/e1001_if_as_expression`, `tests/syntax/fail/e1040_prefab_in_scene`, `e0013_loop_loop`, `e5005_bind_calls_cpu_fn`, `e5005_bind_calls_cpu_intrinsic`, `e5040_prefab_with_nested_entity`, `e5001_field_abbreviation`, `e5060_unknown_event`, `e5061_filter_is_a_named_constant`, `materials/e4011_string_in_stage`, `materials/e4012_builtin_texture_called_in_stage`, `materials/e4012_texture_made_in_stage`, `materials/e4031_default_reads_frame`, `materials/e4031_sampler_default_wrong_type`, `materials/e3102_sampler_for_texture_param`, `materials/e4040_texture_constant_in_stage`, `materials/e4041_*`.
