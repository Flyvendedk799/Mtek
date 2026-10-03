# 0024. Standard library registry: details the specification leaves open

- Status: Accepted
- Date: 2026-10-03
- Blueprint origin: §3.4 (one registry).

## Context

`spec/stdlib.md` defines the registry's data model (§1.1), the JSON format (§1.2) and the tables of names (§2 to §6). Implementing `crates/mtek-compiler/src/stdlib/` (task M1-08) needed a handful of decisions the text does not make, plus a few additive extensions that later stages (checker, LSP, AI context export) need and that cost nothing to add while the registry is first written. None of them contradicts a normative sentence; each is recorded here so it is visible and reviewable.

## Decision

All of the following are **proposals** (design choices), not external constraints.

1. **Type class `V`.** §6 uses `T` (`f32`, `vec2`, `vec3`, `vec4`) and `I` (`i32`, `u32`) but never defines `V`, which `dot`, `normalize` and `reflect` use. `V` is `vec2`, `vec3`, `vec4` (vectors only; `dot(f32, f32)` is rejected). The meaning of `T`, `I` and `V` is part of the JSON output (`typeClasses`).
2. **Additive registry fields.** `FieldDef` gains `since` (items inside one schema land in different milestones: `Entity.light` is M4, `Entity.body` M5, `Scene.gravity` M5) and `default_when_set` (`Entity.material` defaults to `Unlit {}` only when `mesh` is set). `Registry` gains `body_commands` and `body_properties` (`spec/physics.md` §3), which §1.1 does not list. `TypeDef` carries the record fields of `SurfaceInput` and `PointerEvent` and, for the compile-time handle type `glb_asset`, its ten accessors (`spec/assets.md` §2.1). `glb_asset` is registered as a type although the §2 type list omits it, because the `asset.glb` signature names it.
3. **Default text is derived, not stored.** §1.2 says each default is "stored twice". The registry stores the `ConstValue` once and derives the canonical text from it (`ConstValue::canonical_text`), so the two cannot drift; colours keep the `#rrggbb` literal they were declared with inside the value. The required test (canonical text re-parses and const-evaluates to the stored value) is implemented against an independent parser and evaluator in `tests/stdlib_registry.rs`.
4. **JSON additions to the §1.2 format.** Field objects add `constructionOnly`, `since` and `doc` (and `defaultWhenSet` when present); every object has `since`; the document adds the arrays `sceneObjects`, `bodyCommands`, `bodyProperties`, `typeClasses` and `preludeSources` (paths only). Absent defaults and ranges are `null` (the key is always present). Intrinsic signatures are strings with parameter names, `(a: T, b: T) -> T`. "Sorted by name within each array" is applied literally, including to schema fields and enum members (declaration order is not part of the JSON). The document contains only strings, booleans, `null` and integers, so no number formatting can differ between hosts.
5. **Milestones the work plan leaves implicit.** `since` follows the task text; where it is silent: math intrinsics and the `mat4` namespace and type are M2 ("function-related"); `quat` and `color` namespaces and the `bool i32 u32 f32 vec2 vec3 vec4 quat color mesh material` types are M1; `string`, `array` and `SurfaceInput` are M2; `PointerEvent` is M3; `texture`, `sampler`, `glb_asset` are M4; `entity_ref` is M5; `Scene.ambient_color` and `Scene.ambient_intensity` are M4 (they only affect lit materials); `Scene.gravity` is M5 (physics only).
6. **Const-eligibility of namespace functions** (§6 defines column K only for global intrinsics). All namespace functions are const-eligible (pure functions of their arguments, folded with `libm`, `spec/language.md` §10) except `lighting.pbr`, which is GPU only and not const-eligible. The `asset.*` functions and the `glb_asset` accessors are const-eligible as `spec/assets.md` §2 states. In particular `color.srgb` **is** const-eligible (orchestrator decision: M1 must type-check and fold it, and `spec/language.md` §6.3 makes folding of constant-only expressions mandatory):
   - **Compile-time folding is deterministic.** `color.srgb(rgb, a)` is folded with the binary32 formula below, using `libm::powf`, identical on every host. Per channel `c: f32`: `if c <= 0.04045 { c / 12.92 } else { libm::powf((c + 0.055) / 1.055, 2.4) }`, every operation rounded to binary32; alpha is passed through unchanged. The definition lives in `stdlib::value::srgb_channel_to_linear_f32`, which the constant folder uses.
   - **Contract with M2-06.** Run-time evaluation (`rt`, `packages/runtime-web/src/math/`, task M2-06) uses the same formula and operation order (`Math.fround` after every operation) and agrees with the folded value within the CPU/GPU tolerance of `spec/testing.md` §5. It does not have to agree bit for bit: JavaScript has no portable binary32 `powf`. M2-06 cites this item.
   - **Literals unchanged.** `#rrggbb` literals still convert with the exact `f64` EOTF rounded once to `f32` (`spec/language.md` §5.4). Hence `#808080` and `color.srgb(vec3(128.0 / 255.0), 1.0)` may differ in the last bit. That is intended.
7. **Ranges beyond the tables.** `Entity.scale` is "> 0, finite" (§12 of `spec/scenes.md` requires finite); `Orthographic.near` and `.far` carry the same constraints as `Perspective` (`spec/scenes.md` §3 states them for both projections); `PointLight.range` and `SphereCollider.friction` are `≥ 0` (the manifest schema already bounds them so); `fov_y` is the open interval `(0, π)` with `π` the real number (so the binary32 value nearest π is out of range). Ranges are structured (`ValueRange`) with documentation text derived from them.
8. **Overload resolution with literals.** A call's arguments are passed as concrete types or as untyped integer/float literals. An integer literal costs 0 for `i32` and 1 for `u32`/`f32`, a float literal fits only `f32`; the cheapest instantiation wins, so `max(1, 2)` is the `i32` overload and `max(x, 1)` with `x: f32` the `f32` one. Equal-cost instantiations with different results are an `Ambiguous` error, never a silent choice.

## Consequences

- `spec/stdlib.md` §1.1, §1.2 and §6 gain short notes pointing here; the tables themselves are unchanged.
- Later milestones that change a `since`, a const-eligibility or a range regenerate `spec/stdlib-schema.json` (the staleness test enforces it) and amend this record.
- `E9010` gating consults `Milestone::is_reached_by(CURRENT_MILESTONE)`; `CURRENT_MILESTONE` is M1 and is raised as milestones land.

## Verification

`crates/mtek-compiler/tests/stdlib_registry.rs` (every table row, flags, ranges, milestones, canonical text), `tests/stdlib_schema.rs` (generated file equals the committed file), unit tests in `src/stdlib/`.
