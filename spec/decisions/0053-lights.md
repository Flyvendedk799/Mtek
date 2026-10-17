# 0053. Lights: components, limits, frame-block packing and bindable colour and intensity: details the specification leaves open

- Status: Accepted
- Date: 2026-10-17
- Blueprint origin: M4 (blueprint §11), task M4-02; `spec/materials.md` §7; `spec/gpu-layout.md` §6.1; `spec/scenes.md` §§4.1, 8.2, 8.4; `spec/runtime-abi.md` §§4.2, 5.2; `spec/diagnostics.md` (`E5110`, `E5111`); decisions 0025 (milestone gating), 0035 (items that land before their milestone's gate), 0049 (state, handlers and writes), 0051 (`bind`).
- Supersedes: nothing. Lifts the M4 gating of the `Entity` field `light`, the schemas `DirectionalLight` and `PointLight`, and the `Scene` fields `ambient_color` and `ambient_intensity`; the `Pbr` material, textures, samplers and assets stay M4 items of other tasks.

## Context

The specification fixes what a light is (`spec/materials.md` §7), the fixed-size `MtekLight`/`MtekFrame` layout (`spec/gpu-layout.md` §6.1), the manifest shape (`scene.lights`, `entities[].light`, binding target `{ "kind": "light" }`) and the codes `E5110`/`E5111`. It leaves open how lights are checked, lowered, initialised, written and packed each frame. Every choice below is a **proposal** the owner may overrule.

## Decision

1. **Gating.** Following decision 0035, the items this task implements are marked `M1` in the registry (`since`): `Entity.light`, `DirectionalLight`, `PointLight` with their fields, and `Scene.ambient_color`/`ambient_intensity`. `CURRENT_MILESTONE` stays `M1`; the M4 gate may move them back to `M4` (documentation only). The gate fixtures that used `light` (`gate_entity_field`, `gate_entity_field_read`) now use `body` (M5) and `tests/semantics/fail/*` messages that list the valid fields gained `light`, `ambient_color` and `ambient_intensity`. `spec/stdlib-schema.json` is regenerated.
2. **The limit.** At most `MAX_LIGHTS` = 4 lights per scene, a constant of `layout::builtin` that also sizes `MtekFrame.lights`. The fifth light (in instance order) is `E5111`, one diagnostic per scene at that light's `light:` member, with the first four as related spans. The rule finds light-valued entity fields through the registry (a field of the entity schema whose type is a light descriptor), so the checker names no field.
3. **Prefabs.** A prefab that declares a light is `E5110` at the `light` member. Prefabs themselves are still gated (`E9010`, M5), so a program with a prefab reports both; the rule is syntactic and already holds, and M5-01 keeps it. Entities are always named in v0.1, so a light on any scene entity is a light on a named entity.
4. **Field rules, from the registry.** `color` and `intensity` are writable and bindable; `range` (point lights only) is construction-only with a value of at least 0 (`E5006`) and a constant (`E3090`). `range` on a directional light is `E5001` (unknown field). A non-constant `color` or `intensity` initial value that is not a `bind` is `E9010` ("initial values that are not constant expressions", M3-05), exactly as for material params.
5. **Reading, writing and binding.** `Name.light.field` and `self.light.field` read and assign a light field (`Name.light.range` can be read, not assigned: `E5073`; assigning `Name.light` itself is `E5073`). An entity without a light, or a field the light's schema lacks, is `E5001`. A `bind(..)` is allowed as the whole value of `color` and `intensity` inside the `light:` descriptor of an entity (`E5004` for `range`, `E3102` for a wrong type); an assignment to a bound light field is `E5070` with the `bind` as related span. A light field cannot be read in a state initialiser (`E5081`).
6. **A binding may not read a light field** (`E5005`), the camera precedent of decision 0051 item 2: the manifest's dependency kinds (`spec/runtime-abi.md` §5.2) have no light kind to order bindings by. Bound light fields themselves have a manifest target (`{ "kind": "light", "entity": i, "field": … }`, `entity` the static entity index, as for transforms).
7. **IR and manifest.** `ir::Entity.light` is `Light { kind: Directional | Point { range }, color, intensity }` where `color` and `intensity` are `Field`s with `Source::Const` or `Source::Bound(binding)`; `ir::SceneFields` gains `ambient_color` and `ambient_intensity`, which the manifest now copies instead of the registry defaults (`gravity` still takes the default until M5). `PlaceRoot::LightField`, `ExprKind::LightField` and `BindingTarget::Light` carry reads, writes and bindings. To keep the committed IR goldens stable, the serialised IR omits `light` for an entity without one and the ambient fields when the source does not write them (the in-memory IR always has them). `scene.lights` lists the lights in stable entity instance order (`index`, `entity`, `kind`, `range` for points); `entities[i].light` is the index.
8. **Generated code.** `init` sets, after an entity's material params, `ctx.setLight(e, "color", v)` then `"intensity"` for every field that is not bound (a bound field is written by the runtime's initial binding evaluation); handlers compile writes to `ctx.setLight(e, field, v)` and reads to `e.light.<field>`. The eager default (white, 1.0) of the record is overwritten by `init`.
9. **Runtime records.** Every entity with a light has `record.light = { color, intensity, range }` (defaults white and 1.0, `range` from the manifest, 0 for a directional light). `ctx.setLight(e, field, value)` accepts `"color"` (a colour object; its alpha is ignored by the packing) and `"intensity"` (a number); anything else (`range`, an entity without a light, a wrong shape) is an internal error, because the compiler rules it out. Non-finite numbers are not rejected, like the other setters (`setParam` does not reject them either). The scene object's lights are validated at mount against the layout: at most as many as `MtekFrame.lights` holds, `lights[i].index == i`, and each light and its entity name each other (`E8006` otherwise).
10. **Packing (`render/lights.ts`).** Every frame, before the frame block is compared and uploaded, light `i` of `scene.lights` is written to `MtekFrame.lights[i]` through the **generated** `lights` field writer, and `light_count` is `scene.lights.length`:
    - `color` = linear `rgb × intensity` (alpha ignored; the product is formed in binary64 and rounded once by the f32 write);
    - `kind` = 0 directional, 1 point;
    - `position` = the translation of the entity's world matrix (after phase 6);
    - `range` = the construction-time range (0 = unlimited; 0 for a directional light);
    - `direction` = the unit vector of the entity's world −Z axis, i.e. minus the normalised third column of the world matrix, so scale and parent scale do not change where it points;
    - `reserved` = 0; unused slots stay all zero.

    `position`, `range` and `direction` are written for both kinds; shaders read `direction` of directional lights and `position` and `range` of point lights. `visible: false` on the carrying entity hides its mesh only; the light stays in the scene (`spec/scenes.md` §4.1). `ambient` is `ambient_color.rgb × ambient_intensity` from the scene fields, now the written values.
11. **Hot reload.** Lights are not migrated across a reload: the manifest has no per-field update class for lights, so a changed literal `intensity` must apply, and a light written by a handler is reset to its new `init` value (transforms are migrated, material params only when imperative).

## Known limitations (recorded, not fixed here)

- A binding cannot depend on a light field (item 6).
- A hot reload resets light values written at run time (item 11).
- Shading with these lights is the `Pbr` material (M4-01); `Unlit` ignores them.
- Non-finite light values reach the GPU unchanged.

## Consequences

- The ambient scene fields work for every scene; no visible effect until a lit material exists.
- `E5110` and `E5111` left the checker's not-yet-implemented list; `tests/codegen/lights` joined the codegen fixtures (golden manifest, `app.js`, inspect views).
- Merge note: M4 tasks that touch the registry's `since` values, `ir::SceneFields` or the frame writer calls (the PBR oracle, textures) rebase onto this.

## Verification

Fixtures: pass `lights`; fail `e5111_too_many_lights`, `e5110_light_in_prefab`, `e5073_write_to_light_range`, `e5073_write_to_light_component`, `e5004_bind_light_range`, `e5070_write_to_bound_light_field`, `e5005_bind_reads_light_field`, `e3102_light_intensity_is_a_colour`, `e3102_bind_light_colour_type`, `e5006_light_range_negative`, `e3090_light_range_not_constant`, `e5001_entity_has_no_light`, `e5001_light_unknown_field`, `e5001_directional_light_range`, `e5081_light_read_in_state_initialiser`. Runtime: `src/render/lights.test.ts` (packing against hand-derived values: direction from rotation, premultiplied colour), `src/render/renderer.test.ts` (the frame block read back through the manifest's layout offsets, including a rotated and scaled parent, and the compiler's `lights` program running with a bound intensity and handler writes), `src/scene/world.test.ts`, `src/scene/structure.test.ts`. `cargo test --workspace --locked`, `npm run check`, `npm run test:unit`, `MTEK_REQUIRE_GPU=1 npm run test:browser:hardware`.
