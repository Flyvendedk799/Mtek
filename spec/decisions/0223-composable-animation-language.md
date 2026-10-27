# 0223 — Composable animation in programs

Status: accepted and implemented; the browser demonstration is decision 0224. Date: 2026-10-27.
Extends 0190, 0191, 0219, 0220, 0221 and 0222 (acceptance item 1 of 0219).

## Why

Decisions 0220 to 0222 gave a host everything area 2 asks for: 2D blend spaces and layer
fades, automatic humanoid mapping and retargeting, anatomical limb and foot solving. A `.mtek`
program could still only play, fade and transition one clip. This decision is the source surface:
the calls, the entity field, the diagnostics and the manifest data that let a program use all of it
without host code. The normative text is `spec/animation.md` section 4; this record keeps the
decisions and their reasons.

## Decision

1. **Sixteen `animation.*` calls, CPU only.** `set_layer`, `fade_layer`, `remove_layer`,
   `blend_sample`, `blend_play`, `blend_parameter`, `blend_clear`, `blend_phase`, `limb_goal`,
   `clear_limb`, `foot_placement`, `clear_foot_placement`, `chain_goal`, `clear_chain`, `root_motion`
   and `take_root_motion`, with the signatures of the task and `spec/stdlib.md`. The ones that change
   state are handlers-only like `animation.play`. All return `bool` (applied) except `blend_phase`
   and `take_root_motion`. Non-finite numbers, a dead reference and an entity without a skeleton
   return `false` silently (the convention of `animation.play`); a weight outside 0..1 is clamped
   (the convention of `animation.fade`).
2. **Blend spaces accumulate, then play.** `blend_sample` appends to a pending definition,
   `blend_play` builds it with `player.blend.set` and *consumes* it, valid or not, so a failed play
   cannot poison the next definition. I chose this over one `blend_space(target, clips, points)`
   call: the registry has no cleanly checked fixed-length array parameters for this (the `choose`
   style `array<T, N>` takes one element type, and a clip/point pair would need a struct).
3. **Goals are world space, converted by the runtime.** The solvers work in the mesh-local space of
   `joint_position`; the runtime converts a goal with the inverse of the entity's world matrix (a
   normal with its transpose, a displacement with its linear part) at the time of the call, after
   propagating pending transforms. A rotated, moved and uniformly or non-uniformly scaled entity
   keeps its end joint on the world goal (tested against an independent `T R S` inverse). Goals
   are not tied to the entity afterwards; a program calls again each frame.
4. **Lazy humanoid mapping.** `limb_goal` and `foot_placement` run `mapHumanoid` on the entity's
   skin the first time and `setHumanoid` with the result; a skeleton that does not map is `E8112`
   once and the call is dropped. A leg goal together with foot placement is refused by the solver
   (0222) and reported as `E8113`.
5. **Chains** are `player.ik.set` with the chain built from the skeleton hierarchy (`end_joint` and
   its `length - 1` ancestors, at least two joints), the default 12 iterations and tolerance.
6. **Root motion** is `setRootMotion` plus `take_root_motion`. The accumulated displacement is turned
   from the root joint's parent space into the skeletal mesh local space (new
   `SkeletonPlayer.consumeRootMotionLocal`, the displayed transform of the parent relative to the
   mesh node) and then into the world with the entity's rotation and scale. Without the first step
   a rig with a scaled or Z-up armature would be wrong; the test uses one (scale 0.01, rotated
   armature, rotated mesh node) and compares against the displayed motion of an unowned twin.
7. **Layers by subtree.** `AnimationLayer` gains the host option `subtree` (a joint name whose
   subtree has weight one, added to `mask`), so the language's `mask` argument cannot be confused by
   duplicate node names and costs no name list.
8. **`clips_from` and the manifest.** A new entity/prefab field `clips_from: asset.glb(..)`. The
   compile-time check (`E7028`, new, the next free asset-range code) requires a skeletal mesh on the
   entity and a skin with clips in the file; a `clip` then names a clip of that skeleton (`E5016`
   otherwise). The manifest gains two *optional* fields (schema 1 and runtime ABI 1 stay): the
   top-level `clipSources`, each source skeleton once (nodes, joints, inverse binds, clips,
   with empty `indices` and `weights`), and `clipsFrom` on entities and prefabs, an index into it.
   I put the table at the top level so a crowd of prefab instances and a scene full of actors share
   one copy; the vertex influences stay with the mesh. The `clip` of such an entity has no channels.
   At mount (and for each spawn) the runtime calls `retargetHumanoid(source, ownSkin)`, caches it per
   pair, and plays the result: the entity's own skeleton with the source's clips. A mapping or
   retarget failure is `E8110` once per declaration and the entity keeps its own skin and clips.
9. **Diagnostics.** `E8110`, `E8111`, `E8112` as reserved by 0219, plus **`E8113`** (animation
   command rejected): 0219 reserved three codes, but a blend space with two samples at one point or
   a chain longer than the skeleton is neither an unknown name nor a non-humanoid; folding them into
   `E8111` would have stretched its meaning. Each is reported once per entity and name, located at
   the call (the commands that can report take the manifest span as a last argument), and the call
   returns `false`.
10. **No immediate pose evaluation.** The calls change state; the next advance of phase 3 evaluates
    once. A handler that makes five calls costs one evaluation, like the limb goals of 0222.
11. **Hot reload drops the animation state.** A reload builds a new world, hence new players: layers,
    the blend space, pending samples, goals, root ownership and the once-only diagnostics start
    again (a playing clip does not migrate either, 0190). The new program sets them up in its first
    frames.

## Consequences

* **Cold-start context.** The context of an empty project is limited to 30 000 bytes and must leave
  1 000 for the project. The sixteen calls and the field cost 3 038 bytes with plain documentation
  (the file had 36 bytes of headroom). Making room, without raising anything:
  * families: functions of one signature whose documentation ends in the same sentence are one
    line (`animation.pause|resume|blend_clear|clear_foot_placement`, `animation.remove_layer|clear_limb|clear_chain`,
    `animation.time|duration|weight|blend_phase`). That mechanism existed for namespaces (0172);
    it now also applies to global intrinsics, which makes `is_key_down|key_pressed|key_released`
    one line (a small change in `context/reference.rs`: `family_doc` takes any iterator of
    functions);
  * the documentation strings of about eighty registry entries were tightened (the sampler fields of
    `Pbr` and `Sprite` now read "Sampler.", `near`/`far` "Near plane.", and so on), with the same
    meaning, and the decision numbers were not touched;
  * result: 28 964 bytes before, **28 961** after (39 bytes of headroom).
* **The language guide** (`docs/language-guide.md`, limited to 16 384 bytes by 0118) grew by 415 bytes
  with the sixteen names; the list of functions now writes a namespace with at least three functions in
  a domain as one span, `animation.{copy_pose, crossed, ...}`, which also shortened `easing`, `hud`,
  `gamepad`, `asset` and `mat4`. The guide is now 16 114 bytes.
* **`runtime.min.js`** grows from 730 560 to 742 916 bytes (+12 356; `crates/mtek-cli/prebuilt` is not
  regenerated here).
* The `max-bytes` test of `mtek context` for a warm project uses 12 600 bytes (12 000 before): the
  `supported.features` list names the sixteen functions.
* `PoseLayers.set` accepts `subtree`; `SkeletonPlayer.consumeRootMotionLocal` is new public API
  (declared in `runtime.d.ts`).

## Not done / deviations from 0219

* One extra code, `E8113` (item 9), and `E8112` is only about non-humanoids; an unknown chain id is no
  diagnostic (`clear_chain` is idempotent), and an unknown end joint is `E8111` as the task says.
* `clip:` with `clips_from` is checked at compile time against the first skin of the file that has
  clips; a file with several skeletons needs a dedicated file.
* Foot placement takes the world ground points and normals of the call; the language has no ray
  casts, the program supplies them (`body` queries of the host).
* The demonstration and the browser spec on both backends are decision 0224.

## Tests

`crates/mtek-compiler/tests/{assets,fixtures,ir_goldens,stdlib_registry,stdlib_schema,context_cold_start,context}.rs`
with the fixtures `tests/semantics/pass/animation_composition`,
`tests/semantics/fail/{e3002_animation_set_layer_arity,e3001_animation_blend_sample_argument_type,e3001_animation_chain_goal_argument_types,e5080_animation_set_layer_in_function,e5080_animation_take_root_motion_in_state_initialiser,e3102_clips_from_needs_a_glb}`,
`tests/assets/pass/clips_from`, `tests/assets/fail/{e7028_source_without_skin,e7028_mesh_not_skeletal,e5016_clips_from_unknown_clip}`
(generated by `tests/assets/tools/make-glb.mjs`), the IR golden `tests/codegen/ir/animation_composition.*`,
`tests/codegen/animation-composition.test.ts` (the generated calls and their spans);
`packages/runtime-web/src/scene/animation-script.test.ts` (layer masks by subtree, fades, blend
accumulation and play, world-to-mesh conversion of limb, foot and chain goals and of root motion with a
rotated and scaled entity on generated Mixamo and Unreal humanoids, CesiumMan and, when present, the
character-composition rigs, `clips_from`, `E8110` to `E8113`, hot reload, the manifest tables).
