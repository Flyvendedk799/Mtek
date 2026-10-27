# 0217 — Character movement in programs and hosts

Status: accepted. Date: 2026-10-27. Extends 0065, 0066 and 0214.

Implements the language, runtime and host-API part of the contract of decision 0214
(acceptance items 1 and 2, "Language surface" and "Host API"). The adapter side is
decision 0215, continuous collision coverage is decision 0216, the example and the
browser acceptance are decision 0218.

## Why

Decision 0193 gave the Rapier adapter `castShape`, `moveCharacter`, `contacts` and
`setCollisionGroups`, but no `.mtek` program and no mounted host could call them. A
program could only set a kinematic target, so every game with a walking character had to
bring its own collision code, and a host could not ask the physics world a question.

## Decision

### Language

* **`CapsuleCollider { radius; height; sensor; friction; restitution }`.** A cylinder
  along local Y with a hemisphere on each end. `height` is the full height including both
  caps and must exceed `2 * radius`. The compile-time code **`E5124`** (new, class 5xxx,
  `spec/diagnostics.md` section 5.5) reports `height <= 2 * radius`, at the `height` value,
  with a related span at `radius` and the help "increase `height` or decrease `radius`".
  A value outside the usual range (a non-positive or non-finite size) is `E5006` and hides
  `E5124` for that collider. The registry expresses the rule as data
  (`FieldRule::ExceedsMultiple { field: "height", other: "radius", factor: 2, code: E5124 }`),
  checked on every descriptor literal like the other schema rules.
* **`Kinematic` character settings.** Six optional construction-only constants:
  `max_slope` (radians, 0 to 1.5707964, default 0.7853982), `step_height` (m, >= 0, 0.25),
  `step_min_width` (m, > 0, 0.1), `snap_to_ground` (m, >= 0, 0.2), `skin` (m, > 0, 0.01),
  `carry` (bool, true). Out of range is `E5006`. They tune `move_character` only; a
  kinematic body that never calls it ignores them.
* **`Dynamic { continuous: bool = false }`.** Per-body continuous collision detection. The
  host option `physics: { continuousCollision: true }` still enables it for every dynamic
  body; the two are or-ed.
* **`Name.body.move_character(displacement: vec3, rotation: quat)`**, Kinematic only
  (`E5123` on a named entity of another kind, `E8101` through an `entity_ref`, `E3002` /
  `E3001` for wrong arguments, `E5080` / `E5005` outside handlers like every command).
  `displacement` is metres for this tick (`velocity * dt`); gravity is not applied.
* **Readable `Name.body.grounded: bool` and `Name.body.ground_normal: vec3`**, Kinematic
  only, under the rules of `linear_velocity` (`E5123` for another kind, `E8101` through a
  reference, `E5081` in an initialiser, `E5005` in a `bind`). Assigning one is `E5071`
  with a note ("the result of the last completed `move_character`") and a help naming
  `move_character`. The note on the ownership errors of a kinematic body now lists
  `set_kinematic_target`, `move_character` and `teleport`.

An example program:

```mtek
scene Demo {
    state vertical: f32 = 0.0;
    camera Main { position: vec3(0.0, 4.0, 10.0); target: vec3(0.0, 1.0, 0.0); }
    entity Floor {
        position: vec3(0.0, -0.5, 0.0);
        mesh: Box { size: vec3(20.0, 1.0, 20.0) };
        body: Static {};
        collider: BoxCollider { size: vec3(20.0, 1.0, 20.0) };
    }
    entity Hero {
        position: vec3(0.0, 1.0, 0.0);
        mesh: Box { size: vec3(0.8, 1.8, 0.8) };
        body: Kinematic { step_height: 0.3 };
        collider: CapsuleCollider { radius: 0.4; height: 1.8 };
        fixed_update(dt: f32) {
            if self.body.grounded { vertical = 0.0; } else { vertical = vertical - 9.81 * dt; }
            self.body.move_character(vec3(3.0 * dt, vertical * dt, 0.0), quat.identity());
        }
    }
}
```

### Detecting "the author wrote a character field"

A completed descriptor fills in every default, so "written" cannot be told from
"defaulted" afterwards. The registry gets a field flag `UNSET_WHEN_OMITTED`: the six
character fields keep their documented defaults (documentation, hover, `stdlib-schema.json`)
but a completed `Kinematic` descriptor omits a field the program did not write. The IR
lowering reads the written fields: none gives `character: None`; any gives all six, the
unwritten ones with the defaults. The flag is internal to the checker and is not part of
the exported schema.

### Manifest (additive, runtime ABI stays 1)

* `body: { "kind": "kinematic", "character": { "maxSlope", "stepHeight", "stepMinWidth",
  "snapToGround", "skin", "carry" } }` only when the author wrote at least one of the six
  fields; otherwise `{ "kind": "kinematic" }`. A program that writes `carry: true`
  therefore gets the object with the five other defaults filled.
* `body: { "kind": "dynamic", ..., "continuous": true }` only when true.
* `collider: { "kind": "capsule", "radius", "height", "sensor", "friction", "restitution" }`.

All three are optional additions in the style of `tag`, `particles` and `clip`: an old
runtime that does not know them cannot be given such a program by a newer compiler without
the new schema (`spec/manifest.schema.json` rejects unknown keys), and a new runtime
accepts every old manifest. `spec/runtime-abi.md` section 5.2 and
`packages/runtime-web/src/abi/manifest-types.ts` describe them.

### Runtime

* **A new command category `characterMove`**, applied after `kinematicTarget` and before
  `impulse`: teleports, linear velocities, kinematic targets, character moves, impulses,
  forces (`spec/physics.md` section 4). The platform's target of the same tick is
  therefore already known when the character standing on it is resolved.
* **One move per body and tick.** The displacements of all `move_character` commands of one
  body in one tick are summed (as `f32`), the last rotation wins, and the move is resolved
  once, at the position of the first of them in the batch. A move replaces a
  `set_kinematic_target` of the same body in the same tick, whichever was issued first (the
  target is skipped, not applied and overwritten, so the adapter sees one target). A
  `teleport` of the tick has been applied first (the adapter's pose changes at once), so
  the move starts from the teleported pose.
* **Resolving a move** is `moveCharacter(handle, displacement, { offset: skin, maxSlope,
  snapToGround, stepHeight, stepMinWidth, carry, rotation })` from the pose `readPose`
  returns now, then `setKinematicTarget(handle, { position: current +
  result.displacement, rotation: result.rotation })`. No `exclude` or `groups` filter is
  passed: the adapter's controller ignores the character's own collider and sensors.
  The result is checked: a position or rotation that is not finite freezes the body with
  `E8103` (it is the solver-pose case, one code).
* **`grounded` and `ground_normal`** are `result.grounded` and `result.ground.normal`,
  recorded when the move is resolved, so a `fixed_update` of the same tick reads the move
  that was just applied, and a `fixed_update` of the next tick reads the same values until
  the next move. The normal is zero when the result is not grounded or names no ground
  (the adapter can report `grounded` without a support body after a step-up hop; the
  runtime does not invent a normal). They are false / zero before the first move, for a
  frozen body and after a hot reload (the new world starts at rest).
* **Mapping.** `capsule` maps to `{ kind: "capsule", radius, height }`; `continuous` (or the
  host option) to `BodyDesc.continuousCollision`; the character settings are read from the
  manifest with the defaults of `CHARACTER_DEFAULTS` applied when the object is absent.
  A hot reload reads them again from the new manifest.
* **Diagnostics.** `E8104` for a displacement or rotation that is not finite (a rotation of
  zero length counts), `E8101` through a reference whose body is not kinematic, `W8031` for
  a dead or pending target, silence for a body destroyed after the command was issued (the
  generation check) and for a frozen body. **`E8105`** (new, `spec/diagnostics.md` section
  5.8): the loaded adapter has no `moveCharacter`. It is reported when the command is
  issued, at the command's span, once per body, and the command is dropped, so a
  `set_kinematic_target` of the same tick still applies.
* **Handle members** follow the camel-case convention: `moveCharacter`, `grounded`,
  `groundNormal` (`spec/runtime-abi.md` section 4.2).

### Host API

`app.physics` and `ExtensionContext.physics` (an optional additive API 1 capability) are
`undefined` while the running program has no physics (a getter: a hot reload can change
that) and otherwise one stable object:

```ts
interface MtekPhysics {
  castRay(origin: Vec3, direction: Vec3, maxDistance: number, options?: MtekQueryOptions): MtekRayHit | undefined;
  castShape(shape: MtekQueryShape, pose: { position: Vec3; rotation?: Quat }, displacement: Vec3, options?: MtekQueryOptions): MtekShapeHit | undefined;
  contacts(entityId: string): readonly MtekContact[];
  setCollisionGroups(entityId: string, memberships: number, filter: number): void;
}
```

* **IDs.** Arguments and results are the opaque entity IDs of `inspectScene()` and
  `readTransforms()` (`scene:<generation>:<symbol>` or `...:spawn:<slot>:<generation>`),
  produced by one `EntityIds` per application so they agree, including for an entity that
  is pending removal (a body leaves the world at the next flush, so a query can still hit
  it, but it cannot be named in an argument). The adapter's user ids and handles never
  cross. Results are fresh copies.
* **Inputs are validated** before the adapter is asked: vectors finite, `direction` not
  zero, `maxDistance` finite and positive, shapes positive (a capsule's height above twice
  its radius), rotations finite and normalised, group masks integers from 0 to 65535, IDs
  strings that name a live entity with an active body. A wrong kind throws `TypeError`, a
  bad value or an unknown / stale ID `RangeError`.
* **Groups** are two 16-bit masks. The query option `groups: { memberships, filter }` is
  packed as `((memberships << 16) | filter) >>> 0` into the adapter's `groups` word.
* **Methods the adapter lacks** are present but throw `MtekPhysicsUnsupportedError`
  (`method`, `adapter` properties, message "The physics adapter 'x' does not support y.").
  The alternative (absent members) would have made every call site a type guard; a
  uniform object with a named error keeps the types simple and still lets a host probe by
  catching.
* **What queries see.** The world as of the last completed tick: a query never steps the
  world, applies a command or moves a body (the single pose authority of
  `spec/physics.md` holds; a host that wants to move a body writes a host input the program
  reads). `setCollisionGroups` takes effect at once and lasts until the physics world is
  rebuilt by a hot reload. Types are exported from `@mtek/runtime-web` and declared in
  `src/runtime.d.ts` (checked against the implementation in both directions).

### Adapter limitation (decision 0215)

A collider added during a tick (a spawn) is not seen by `moveCharacter` or the queries until
the next `world.step()`: spawned geometry is visible to character moves from the next tick.
There is no workaround in the runtime; `spec/physics.md` sections 4 and 5 and
`docs/platform-runtime.md` say so.

## Consequences

* The cold-start context of an empty project is limited to 30 000 bytes and must leave
  1 000 bytes for the project (`context_cold_start.rs`). The new schemas, fields, command and
  properties cost about 1 600 bytes; to hold the budget without weakening that test, the
  documentation strings of the registry were tightened where they were wordy (about two
  dozen entries, no meaning removed; the references to decision numbers were dropped from
  four of them). The empty-project context is 28 964 bytes.
* `ExceedsMultiple` and `UNSET_WHEN_OMITTED` are small registry mechanisms, not special
  cases in the checker; the next field that needs "any of these written" or "greater than a
  multiple of a sibling" uses them.
* `MtekApp.physics` is optional in the interface (`readonly physics?: MtekPhysics |
  undefined`) so that existing test doubles and wrappers of `MtekApp` still type-check.
* The inspector overlay draws a capsule collider as two cap spheres and four side lines.

## Not done / deviations from 0214

* 0214 says `ground_normal` is "zero when not grounded". It is also zero when the adapter
  reports a grounded result without a support (see above); the runtime never fabricates a
  normal.
* 0214 says "E8105 once per body" without a time; it is reported when the command is
  issued, not when it would have been applied, so a program sees it in the tick of its call.
* The mount option and the manifest flag for CCD are or-ed; neither can switch CCD off for
  a body the other enables.
* The runtime does not pass `exclude`, `groups` or `includeSensors` to `moveCharacter`; the
  adapter's own policy (ignore the character itself and sensors) is the contract.

## Tests

`crates/mtek-compiler/tests/{stdlib_registry,fixtures,ir_goldens,context_cold_start}.rs`
and the fixtures `tests/semantics/pass/physics_character_movement`,
`tests/semantics/fail/{e5124_capsule_not_taller_than_caps,e5123_move_character_on_dynamic_and_static,e5071_assign_grounded,e5006_character_field_ranges,e3002_move_character_arity,e3001_move_character_argument_type}`;
the codegen fixture `tests/codegen/movement` with `tests/codegen/movement.test.ts` (manifest
shapes and the generated calls); `packages/runtime-web/src/physics/character.test.ts`
(mapping, category order, summing, replacement of a kinematic target, teleport first, the
reads, `E8101`, `E8103`, `E8104`, `E8105`, destroyed and frozen bodies, hot reload);
`packages/runtime-web/src/host/physics-api.test.ts` (IDs, validation, unsupported methods,
what queries see, reload); `packages/runtime-web/src/runtime-dts.test.ts` (declarations);
`packages/inspector/test/overlay.test.ts` (capsule overlay).
