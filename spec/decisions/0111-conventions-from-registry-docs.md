# 0111. Conventions are registry documentation: where the units, the exposure scale, the two durations, the colour spaces and the key names are written

- Status: Accepted
- Date: 2026-10-19
- Blueprint origin: M7 (blueprint §11), follow-up K-01; blueprint §3.4 (one registry); decision 0110 (the cold-start context), decision 0072 item 1 (nothing in the context is typed in by hand except wording).
- Supersedes: nothing.

## Context

Decision 0110 gives a project with no code the library; some of what a model must know is not a signature but a rule that crosses items: light units, that the camera's exposure scale multiplies the ambient term as it multiplies every lit result, that `update(dt)` gets the frame delta and `fixed_update(dt)` a fixed step, that `#rrggbb` is sRGB and `color.linear` is not, that the key for the up arrow is `ArrowUp`. The task asks for a generated "conventions" block and forbids prose in Rust: a convention that matters and is not yet in the registry is added to the registry's `doc`.

## Decision

1. **A convention is the `doc` of a registry item.** `context::reference::CONVENTIONS` is a table of topics and **names** of registry items (a prelude type, a namespace); the context quotes each item's `doc` after its name. There is no sentence in the table or in Rust. A test fails when an item of the table no longer resolves, so a rename cannot silently empty a topic, and checks that each quoted note is the registry's text. Topics today: `colour` (`color`), `time` (`frame`).
2. **The rest of the conventions are the `doc` of the field they are about, which the detailed schemas carry whole** (decision 0110 item 2). Quoting `DirectionalLight.intensity` ("Illuminance in lux."), `PointLight.intensity` ("Luminous intensity in candela."), `Camera.exposure` and `Scene.ambient_intensity` a second time under a topic `lighting` was built first and measured: 0.96 kB for nothing new, which was the difference between a context that fits and one that does not (decision 0112). The lighting rules are therefore found on the fields, and a test fails if their docs lose "lux", "candela" or the exposure sentence.
3. **Registry documentation added or changed** (the text is the registry's; `spec/stdlib-schema.json` and `docs/language-reference.md` are regenerated from it):
   - `Scene.ambient_intensity`: the ambient term is multiplied by the camera's exposure scale like every lit result (about 3.14 at the default exposure, so 0.3 is already nearly full brightness on white); Unlit materials ignore it. The rule was in `spec/materials.md` §8 rule 9 and in `Camera.exposure`, but not on the field a model reads when it writes `ambient_intensity: 0.3`.
   - `frame` (namespace): `update(dt)` gets the frame delta, which varies; `fixed_update(dt)` runs zero or more times per frame and gets the constant fixed step, 1/60 s by default (`spec/scenes.md` §10 phase 2, `runtime.fixed_step`).
   - `color` (type): a `#rrggbb` literal is sRGB-encoded and converted, `color.linear(rgb, a)` takes linear components, `color.srgb(rgb, a)` sRGB ones, the fields are `.r .g .b .a` and `.rgb`, there is no arithmetic (`spec/language.md` §5.4).
   - `Key` (enum): written `Key.<Member>` with exactly the members listed, with examples; there is no `Key.Up`, `Key.KeyA` or `Key.Shift`. A test asserts that none of the invented names is a member, so the sentence cannot go stale.
   - Wording removed as noise for the reader of the context: "that rule belongs to the checker, not to this field" (`Entity.scale`), "Defined in the embedded prelude source `std/materials.mtek`" (`Unlit`, `Pbr`), "the compiler records which fields a material reads" (`SurfaceInput`), "other codes are ignored by the runtime" (`Key`), "of the camera" (`Camera.exposure`).
4. **Rules between fields are written in the docs.** The detailed schemas do not repeat `FieldRule` (`material` needs `mesh`, `collider` needs `body`, `rotation` excludes `target`) because each field's doc already says it. A test reads every rule of every schema and fails when the doc of the field does not name the other field in backticks, so the doc and the checker cannot drift apart.

## Consequences

- To make the context say one more thing about the library, edit the `doc` of the registry item; the editor hover, `docs/language-reference.md` and the context follow. To make a cross-cutting topic, add its item names to `CONVENTIONS`.
- Anything a model needs that is not a registry item (the shape of a material's fragment stage, the order of the sections of a scene) is not a convention in this sense and is the language guide's job.

## Verification

`the_conventions_are_the_documentation_of_registry_items`, `the_units_and_scales_a_model_needs_are_in_the_registry_documentation` and `every_rule_between_fields_is_stated_in_the_documentation_of_the_field` in `crates/mtek-compiler/tests/context_cold_start.rs`; `committed_schema_matches_the_generator` for `spec/stdlib-schema.json`; `npm run check:release` for the regenerated pages.
