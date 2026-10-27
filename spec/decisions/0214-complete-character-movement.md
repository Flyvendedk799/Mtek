# 0214 — Complete character movement and spatial queries

Status: accepted contract. Date: 2026-10-27. Extends 0063, 0066, 0068 and 0193.
Defines what "done" means for platform scorecard area 6 (movement and spatial
queries) and splits the work into 0215 (adapter, corpus and operating ranges),
0216 (continuous collision coverage), 0217 (language, runtime and host API) and
0218 (example, browser acceptance and documentation).

## Why

Decision 0193 added `castShape`, `moveCharacter`, `contacts` and
`setCollisionGroups` to the Rapier adapter only. No `.mtek` program and no
mounted host can call them, moving-platform carry does not exist, three unit
tests are the whole evidence, and lanes D06/D08 still tunnel with CCD enabled.

## Acceptance (area 6 is done when every item holds and is tested)

1. **Source reach.** A `.mtek` program moves a kinematic character with
   collide-and-slide, stair stepping, slope limits, ground snapping and platform
   carry, and reads whether it is grounded, without host code.
2. **Host reach.** A mounted app and extensions can ray-cast, shape-cast, read
   contacts and set collision groups by entity ID.
3. **Moving platforms.** A character standing on a kinematic body is carried
   by its translation and yaw, including vertical and rotating platforms.
4. **Corpus.** Stairs, slopes, obstacles (walls, corners, ceilings, gaps, thin
   walls) and platforms are tested on the real engine for capsule, sphere and box
   characters.
5. **Variable rate.** Results are independent of the display frame rate (the
   tick sequence is identical) and agree within published tolerances across
   fixed steps 1/30, 1/60, 1/120 and 1/144 s.
6. **Operating ranges.** `spec/physics.md` publishes measured ranges (max step,
   slope accuracy, speeds, platform speeds, tolerances) generated from a script,
   and tests assert them so a regression fails.
7. **CCD.** With continuous collision on, a published lane matrix (speeds ×
   phases × shot shapes × static/kinematic/dynamic thin obstacles) has no
   tunnelling inside its stated envelope; D06/D08 pass or the envelope excludes
   them with a measured, explained cause. Teleports stay unswept (documented).
8. **Demonstration.** An example and a browser test exercise the above on both
   local backends, including a display-rate-independence check.

Wider physical devices remain the business of scorecard area 7, not area 6.

## Language surface (0217)

`Kinematic` gains optional fields, used only by `move_character`:

| Field | Type | Default | Range |
|---|---|---|---|
| `max_slope` | f32 radians | 0.7853982 (45°) | [0, 1.5707964] |
| `step_height` | f32 m | 0.25 | ≥ 0 (0 disables stepping) |
| `step_min_width` | f32 m | 0.1 | > 0 |
| `snap_to_ground` | f32 m | 0.2 | ≥ 0 (0 disables snapping) |
| `skin` | f32 m | 0.01 | > 0 |
| `carry` | bool | true | |

`Dynamic` gains `continuous: bool` (default false): per-body CCD. The host
option `physics.continuousCollision` keeps enabling it for every dynamic body.

New collider `CapsuleCollider { radius; height; sensor; friction; restitution }`:
`height` is the full height including both caps along local Y and must exceed
`2 * radius` (new compile-time code `E5124`; other values use `E5006`).

New Kinematic command `move_character(displacement: vec3, rotation: quat)`:
`displacement` is metres for this tick (e.g. `velocity * dt` in `fixed_update`).
Gravity is not applied; the program adds its own vertical motion. Queued like
every body command, applied in a new category **after kinematic targets and
before impulses**, so a platform's target issued in the same tick is already
known. Several `move_character` calls for one body in one tick sum their
displacements and use the last rotation. A `move_character` replaces a
`set_kinematic_target` of the same body in the same tick. A teleport in the same
tick applies first and the move starts from the teleported pose.

New Kinematic readable properties, as of the last completed character move
(false/zero before the first and for kinematic bodies never moved this way):
`grounded: bool`, `ground_normal: vec3` (zero when not grounded).

Manifest (additive, runtime ABI stays 1): a kinematic body has an optional
`character` object with the six fields, emitted only when the author wrote at
least one of them (the runtime applies the defaults above otherwise); a dynamic
body has an optional `continuous: true`; a collider may be
`{ kind: "capsule", radius, height, sensor, friction, restitution }`.

## Resolution of one move (adapter, 0215)

1. **Support.** A downward shape cast of the character's own collider from its
   current pose, length `skin + max(snap_to_ground, 0.05)`, excluding itself and
   sensors, finds the support body; it counts only if its normal is within
   `max_slope` of +Y.
2. **Carry.** If `carry` and the support is kinematic, the carry is the
   support's pending pose change (`nextTranslation/nextRotation` against its
   current pose) applied to the character's position, and the yaw part of its
   rotation change is applied to the requested rotation.
3. **Sweep.** Rapier's character controller resolves `displacement + carry`
   with the settings above (slide enabled, autostep excluding dynamic bodies,
   slope climb and slide angle = `max_slope`).
4. The runtime sets the body's kinematic target to the resolved pose; grounded
   and the ground normal are recorded for the properties.

The adapter interface (`packages/runtime-web/src/physics/types.ts`) is extended
accordingly: capsule shapes, `castRay`, `CharacterMoveOptions.carry` and
`rotation`, and `CharacterMovement.{ground, carried, carriedYaw}`. Optional
methods remain optional; the runtime reports `E8105` once (the character
command is dropped) when the loaded adapter lacks `moveCharacter`.

## Host API (0217)

`app.physics` and `ExtensionContext.physics` return `undefined` when the program
has no physics; otherwise an object with `castRay`, `castShape`, `contacts` and
`setCollisionGroups` that take and return entity IDs (the IDs of inspection),
never adapter handles. Queries see the world as of the last completed tick.
Hosts cannot move bodies: the single pose authority of `spec/physics.md` holds.
