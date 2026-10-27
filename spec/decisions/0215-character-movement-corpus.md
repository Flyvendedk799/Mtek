# 0215 — Character movement corpus and operating ranges

Status: implemented (adapter, corpus, ranges); the runtime and language surface are 0217.
Date: 2026-10-27. Extends 0214 (and 0193).

Decision 0214 defined what a complete character move is and left the Rapier
adapter, the real-engine corpus and the published ranges to this record. All of
it is `packages/physics-rapier` (adapter, tests, one script) plus
`spec/physics.md` section 7.2 and `evidence/movement/operating-ranges.json`.
`packages/runtime-web/src/physics/types.ts` was not changed: 0214 had already
extended it.

## Adapter

`castRay(origin, direction, maxDistance, filter)` returns `RayHit` (user id,
distance along the unit direction, normal, point); `exclude`, `groups` and
`includeSensors` mean what they mean for `castShape`; a zero-length or non-finite
direction, a non-finite origin and a negative or non-finite distance are
`RangeError`s. Capsules (`height` includes both caps, must exceed `2 * radius`)
were already mapped by 0214's types; they now have tests for the collider, the
cast and the character.

`moveCharacter` implements 0214 "Resolution of one move" and keeps "query only:
the caller applies the result": support (a downward cast of the character's own
cached shape, `skin + max(snapToGround, 0.05)` long, sensors and the character
excluded, accepted within `maxSlope` of +Y) gives `ground`; with `carry` and a
kinematic support the carry is the rigid motion of the character as a point
attached to the support from its pose to its pending pose
(`nextTranslation/nextRotation`), `carriedYaw` is the swing-twist twist about +Y
of the rotation change, applied to `options.rotation ?? current` in `rotation`;
`displacement` includes the carry. One `KinematicCharacterController` is kept per
world and configured per call (it is freed in `dispose`; `counts()` is
unaffected); a controller per call costs about 1.5 microseconds more.

The corpus found five real problems in Rapier's controller, each of which the
adapter now works around, so the contract holds without caveats a program would
have to know. Each is covered by a test and by the ranges.

1. **A kinematic support is resolved in its own frame (deviation from 0214 step
   3).** 0214 has the controller sweep `displacement + carry`. Measured: the
   support's collider is still at its pose from before the carry during the
   query, so (a) a platform that descends is not followed (the character is
   stopped by the stale surface and trails by one tick, up to 8 cm at 5 m/s);
   (b) one that ascends fast leaves the character "in the air" (`grounded` false
   on every tick at 5 m/s); (c) Rapier's controller adds the kinematic body's
   previous-step velocity to the motion (a second carry: with the stuck-character problem below worked
   around, a 15 m ride at 10 m/s measured 19 m; and, by Rapier's
   source, a carry even when `carry` is false) and cancels the contact nudge against
   kinematic bodies, so a character resting within the skin of a kinematic
   surface could not slide along it at all (20 hits with time of impact 0, no
   motion; on a 12 m kinematic floor 6 of 16 direction/height combinations at
   rest heights 0.900 to 0.9099 m returned no motion, none at 0.910 m or more).
   The adapter therefore leaves the support
   out of the sweep and resolves it afterwards in the support's current frame:
   the character's own motion is the resolved motion minus the carry; it rests
   `offset` above the support's top, snaps down to it by at most
   `snapToGround` when it was not asked to rise, and is airborne otherwise.
   `grounded` and a contact entry for the support come from that. Result: drift
   0.2 mm at most in every platform run, `grounded` on every tick.
2. **Stair assist.** Rapier's autostep (a) casts upward with a target distance of
   exactly `offset` from the wall the character rests against, so float noise
   decides whether a flight can be climbed (measured: riser 0.24 m, tread 0.3 m,
   box, stepHeight 0.3 m is impassable, 0.25 m is not; a 1e-4 m back-off and a
   smaller `offset` only moved the coin), and (b) advances the character only by
   what is left of the tick's displacement, which cannot put a round shape's
   lowest point (its centre) over the edge, so capsules and spheres crept up
   risers over many ticks or got stuck. When the controller made less than a
   quarter of the requested horizontal progress against a wall, `stepHeight`
   is positive and the character is supported, the adapter performs the step
   itself: lift by `stepHeight`, advance by `max(stepMinWidth + offset, extent
   along the direction + offset)`, land within `offset`, accept a landing within
   `maxSlope` that is higher than the start. Same filters as autostep (no
   dynamic bodies, no sensors, `exclude`, `groups`). After it the box climbs
   exactly when `riser <= stepHeight`.
3. **Overlap guard.** Rapier's iterative shape casts stop early for some shape
   pairs: a sphere walking over a 36 m box was left 2.9 cm inside it. A resolved
   pose that overlaps geometry the start pose did not is never returned: the move
   is lifted by the smallest of 5, 10, 20, 40, 80 mm that clears it, else halved.
4. **Test geometry.** An early thin-wall sweep used a 5 km long 0.01 m wall and
   showed passes at 0.5 m per tick; the geometry was ill-conditioned (single
   precision at 2.5 km is 0.2 mm against a 10 mm wall). Scenario geometry is
   sized to the scenario (wall length from the sweep); a "safety net" that
   halved moves ending inside geometry was added and removed again because it
   changed nothing once the geometry was sound.
5. **Queries and spawns.** Rapier's query structures are updated by
   `world.step()`: a collider added in a tick is not seen by `moveCharacter`,
   `castShape` or `castRay` until the next step. Documented in 7.2. Open for
   0217: a character spawned in tick N cannot see geometry spawned in the same
   tick when it first moves; the runtime may step once or delay the first move.

## Corpus and ranges

`movement-harness.ts` (rig, tick, stairs, slopes, walls), `movement-scenarios.ts`
(corners, ceilings, gaps, thin walls, bumps, platforms, variable step),
`movement-ranges.ts` (the sweeps and the document), `movement-table.ts` (the
Markdown), `scripts/measure-movement-ranges.ts` (write / `--check` / `--cost`) and
the tests `character.test.ts` (adapter features, 22), `movement-corpus.test.ts`
(22, real Rapier, CPU only). A sweep takes about 10 s. The document is
deterministic and free of timings and paths; `npm run ranges:check` and the first
corpus test fail when it or the 7.2 table differ from a fresh run; the other
corpus tests read the committed document and assert the rules below, so
regenerating cannot publish a worse envelope unnoticed.

Characters: capsule r 0.3 / 1.8 m, sphere r 0.5, box 0.6 x 1.8 x 0.6, contract
defaults (skin 0.01, snap 0.2, max slope 45 degrees, step 0.25, min width 0.1).

Rules established and asserted:

- Stairs (risers 0.05 to 0.50 by 0.05, treads 0.15/0.3/0.6, stepHeight
  0.2/0.3/0.4, 2 m/s): the box climbs cleanly iff `riser <= stepHeight`. Round
  characters climb cleanly every riser <= stepHeight whose incline is at most 40
  degrees and never one more than 0.10 m above it (they roll over the nosing).
  The "tread >= stepMinWidth" of 0.214 is more exactly: the box climbs iff
  `(1 + floor((stepMinWidth + skin) / tread)) * riser <= stepHeight`.
  `stepHeight` 0 disables stepping for the box; round shapes still roll over
  `radius * (1 - cos(maxSlope))` (a slope, not a step). Descending stays grounded
  with snap for risers up to the snap distance and never without it.
- Slopes 5..85 degrees against limits 30/45/60: climbing stops and sliding starts
  within 0.25 degrees of the limit; height gained is 1.01 to 1.06 times the
  `sin * cos` prediction; the ground normal is within 0.4 mrad.
- Obstacles: no penetration of walls (0/15/45/75 degrees) or corners
  (90/45/30), jitter at most 3.1 mm; ceilings and gaps passable from `2 * skin`
  (plus at most 5 mm); small bumps up to `stepHeight` walked over; a 0.01 m wall
  stops every character up to 1 m per tick.
- Platforms (horizontal 0.5 to 10 m/s, vertical +-0.5 to 5, yaw 0.1 to 3 rad/s
  at 0 to 4 m, abrupt start and stop, walking, gravity): drift at most 0.2 mm,
  never airborne, `carry` false does not carry.
- Variable step 1/30, 1/60, 1/120, 1/144: flat within 10 mm, slope within 5 mm,
  platform within 1 mm.

## Excluded from the envelope (measured, with the cause)

- **Thin walls above 1 m per tick.** Capsule: 1 of 16 runs passes at 2 m and at
  100 m per tick; sphere 2 of 16 at 100 m; box none. In the capsule case the
  controller returned a whole diagonal move with no contact from a pose 9.92 mm
  from the wall (0.08 mm inside the skin); the same distance with other
  displacements is blocked. Cause not isolated; no claim above 1 m per tick
  (60 m/s at 1/60 s).
- **Stairs across fixed steps.** Final position after 3 s on a six-step flight
  differs by up to 0.35 m (capsule), 0.33 m (box), 0.08 m (sphere): each riser
  costs the part of the tick the character is blocked in, so a coarser step
  loses more. Published tolerance 0.4 m; flat/slope/platform are tight.
- **Round characters on narrow treads.** Capsule and sphere cannot climb a flight
  whose incline exceeds the maximum slope (tread 0.15 m with risers above 0.15 m):
  they stand on the nosings like on a 53 degree ramp.
- **Resting height** varies by up to 9 mm over flat ground between steps (sphere,
  1/30 s) after the overlap guard.
- Characters are not pushed by kinematic bodies that are not their support
  (kinematic-kinematic pairs have no contacts); not measured further.

## Cost

Windows 11, Node 24, this machine: 100 characters in one world, `moveCharacter`
8 to 14 microseconds per call (sphere 8, box 10, capsule 12 to 14), 9 to 16 per
character and tick with targets and `world.step`; Rapier's controller alone is 5.
About 1.5 ms of a 16.7 ms tick for 100 characters. Informative only: the test
asserts a generous 1 ms bound, the document carries no timings.

## Deviations from 0214, open issues

- 0214 step 3 (one sweep of `displacement + carry`) holds except for a kinematic
  support, which is resolved in its own frame (item 1); the returned `grounded`
  for such a character comes from that resolution, `ground` is still the step-1
  cast. The `contacts` of such a move include the support.
- Stepping is Rapier's autostep plus the stair assist (item 2), not autostep
  alone; a step may move the character forward by up to its radius in one tick.
- Open: other kinematic bodies still go through Rapier's kinematic friction (a
  character standing on one that is not its support is not a case the corpus
  covers); the thin-wall leak above; `spec/physics.md` section 5.1 does not list
  the capsule mapping (`ColliderDesc.capsule(height / 2 - radius, radius)`) yet.

## Verification

`npx vitest run` in `packages/physics-rapier` (125 tests, 6 files, about 11 s),
`npx tsc -p packages/physics-rapier --noEmit`, `npx tsc -p packages/runtime-web
--noEmit`, `npm run lint -w @mtek/physics-rapier`,
`npm run ranges:check -w @mtek/physics-rapier`.
