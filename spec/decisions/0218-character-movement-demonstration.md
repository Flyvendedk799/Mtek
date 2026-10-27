# 0218 — Character movement demonstration

Status: implemented; the browser acceptance below ran green on both local backends (hardware and software) and
`specs/m5` is re-run by the orchestrator's gate. Date: 2026-10-27. Extends 0214, 0215, 0216 and 0217.

Decision 0214 asks, in acceptance item 8, for "an example and a browser test that exercise the above on both local
backends, including a display-rate-independence check". This record is that example, that test and the remaining
documentation. It found one real defect in the runtime (below), which it fixes.

## The example: `examples/character-movement`

A playable course in Mtek source only (about 400 lines, mostly geometry): `mtek.toml`, `src/main.mtek`, a README. The
host does nothing but mount it; gravity, jumping, input and the camera are the program's.

* **The character** `Player`: `body: Kinematic { max_slope: 0.7853982; step_height: 0.3; }`, a `CapsuleCollider` of
  radius 0.3 m and height 1.8 m (so it rests 0.91 m above a surface: half the height plus the 0.01 m skin). Its
  `fixed_update` reads `self.body.grounded` and `ground_normal`, integrates its own vertical speed (gravity 9.81,
  zero when grounded, 5 m/s when Space is held while grounded: a jump of 1.27 m in continuous time), reads the arrow
  keys and WASD with `is_key_down` (polling in `fixed_update`, so the key state is the same for every tick of a
  frame), and calls `self.body.move_character(vec3(walk.x * dt, self.vy * dt, walk.z * dt), self.rotation)` at 4 m/s.
  A white nose on a child entity shows the facing. `update` only moves the camera (a fixed offset behind and above).
* **The course** (the floor's top is y = 0; the start is at (-6, 0, 0)): a stair flight of six risers of 0.2 m and
  treads of 0.4 m (lane z = -9, landing 1.2 m high); a ledge of 0.6 m, twice the step height (z = -3); a ramp of 30
  degrees, 6 m long, with a landing 3 m high (z = 3); a ramp of 60 degrees (z = 9); four walls of 3 m around an arena
  of 36 x 32 m (the corners are the places to walk into diagonally); and three kinematic platforms that call
  `set_kinematic_target` in `fixed_update` from their own clock (an entity state advanced by the fixed `dt`, never
  `frame.time`): a slider (3 x 3 m, +-2.4 m in x, period 10 s) over a chasm, a lift (0.2 m to 3.2 m above the floor,
  period 12 s, next to a tall block at the top), and a turntable (a 5 x 2 m bar turning at 0.5 rad/s).
* **Controls**: arrows or WASD walk, Space jumps, R restarts, 1 to 8 teleport to a station (stairs, ledge, slope of
  30 degrees, slope of 60 degrees, slider, lift, turntable, corner). The stations make the course testable from a
  known pose and make every feature reachable at once; a `teleport` is also the program's own command, nothing is
  host-side. Falling below y = -8 (the chasm) starts again.
* **What the program exposes** (scene state, for the HUD and for the spec): `on_ground`, `ground_up`, `rise_speed`,
  `air_ticks`, `ticks`.

## The browser acceptance: `tests/browser/specs/movement/character.spec.ts`

Eleven tests on each of the hardware and software projects (22 runs), with the manual clock and scripted keys. The
example is built by `global-setup.ts` (`support/movement-example.ts`, `buildMovementExample`) like the playground;
`movement.config.ts` with `support/movement-setup.ts` runs the spec alone (`npx playwright test -c movement.config.ts`)
without building every other fixture. `support/movement-drive.ts` turns a script of `hold(keys, ticks)`, `tap(key)`
and `wait(ticks)` into frames for a frame-time pattern; `support/movement-drive.test.ts` runs those plans through a
model of the runtime's accumulator and checks that the same ticks run and every key change arrives after the same tick
in every pattern, and that the source lines the spec transcribes are in the program.

Expected values come from the program's source and geometry or from the published ranges of `spec/physics.md` 7.2,
never from the run. Measured values (hardware and software are identical to the last digit, as they must be: the
engine is WebAssembly and no WebGPU result enters the simulation):

| Test | Expectation (derivation) | Measured |
|---|---|---|
| Start | rests at 0.91 m (0.005 m), grounded, ground normal y = 1 | at rest, grounded, 60 ticks |
| Stairs | from x = 0 the character reaches the landing (1.2 m + 0.91 m = 2.11 m) grounded on every tick, within 1.3 times the unobstructed time of the corpus (the walk to the sixth step, 60 ticks, so 82 with the 4 ticks of slack), height never dropping by 10 mm (the published resting-height variation is 9 mm) | y = 2.11000 m on the landing at x = 5.71; landing reached after 63 ticks (unobstructed 60); largest drop between two ticks 3.3 mm |
| Ledge | 120 ticks of ArrowRight stop it at 3 - 0.3 - 0.01 = 2.69 m on the floor, never higher than 0.93 m; with a jump it ends on top at 0.6 + 0.91 = 1.51 m | blocked at x = 2.68990, y = 0.90988; on top at x = 3.653, y = 1.50995 |
| Slope of 30 degrees | ends on the landing (3.91 m); on the ramp the ground normal y is cos 30 = 0.86603 within 0.002 and the height gained per metre is tan 30 within 2 % | y = 3.90995; normal y between 0.866006 and 0.866045 over 64 ticks; ratio to tan 30 = 0.99999 |
| Slope of 60 degrees | 240 ticks of ArrowRight never carry x past the foot of the ramp (2.0) or y above 0.94 m, grounded on the floor throughout | max x = 1.8265, max y = 0.9198 (the capsule creeps up 10 mm in 4 s) |
| Jump | grounded false from the first tick of the rise to the landing; the height after each tick is the sum of the program's own discrete velocities (`dt * sum(5 - g dt (i - 1))`, within 2 mm); apex tick and height equal the model's | apex at tick 31 in both, 1.316208 m against the model's 1.316208; 62 airborne samples, landing at tick 63 |
| Sliding platform | carried for 10 s + 1 s with a drift under the published 1 mm plus a 0.5 mm margin (the page reads f32 poses at x up to 20 m); it reaches both ends of its travel; grounded on every tick | drift 6e-8 m; platform x from 13.6 to 18.4 |
| Lift | the same for 12 s + 1 s, up and down; travels at least 2.9 of its 3 m, with the character | drift 2e-7 m; platform y from 0 to 3 |
| Turntable | in the platform's frame the character's offset keeps its radius (1.5 m) within 1.5 mm; the character turns with the platform within 1 mrad | drift 4.3e-5 m (0.043 mm); yaw drift 7.9e-7 rad; platform turned 5.99 rad in the 12 s |
| Corner | walking diagonally into the corner at (26, 16) stops at (26 - 0.31, 16 - 0.31) within 5 mm without penetrating, with under 4 mm of jitter in the last second | final (25.69032, 15.69037); largest x 25.69036, z 15.69069 |
| Display rate | the same script (walks, stairs, a jump, three teleports to platforms, the corner stations, 1 391 ticks) under frame times of 1/30, 1/60, 1/144 s and two jittery patterns (1/240 to 3 ticks, seeds 1 and 2026) is bit-for-bit equal to the one-frame-per-tick run at every step of the script: the same tick count, the player pose, the three platform poses and the scene state; and the same script with one key change a tick later differs by over 5 cm (the control: equality is not vacuous) | equal at all 20 steps in all six patterns (1 391, 712, 1 411, 3 357, 884 and 865 frames); final position (16, 1.2506, 1.5) in all |
| Host API | see below | see below |
| Resources | after `dispose`: every live counter of buffers, textures, pipelines, bind groups, shader modules, listeners, physics bodies and colliders is 0 (also after three mount and dispose rounds in one page); no runtime diagnostics, no page error, no console error; the camera follows (the white nose stays within 8 % of the middle of the picture at the start and after 8 m back and 4 m right) | all zero; none; nose at the middle |

The host API test mounts with an extension to learn the entity IDs (`readTransforms`) and asks `app.physics` after
a second of settling: a ray straight down 5 m above the floor hits `Ground` at 5.000 m with normal +y; above the
character it hits `Player` at 3.190 m (the top of the capsule at 0.91 + 0.9 m), and with `exclude: Player` it hits
`Ground` again; along +x at 0.3 m in the ledge's lane it hits `Ledge` at 3.000 m with normal -x; upwards it hits
nothing; a sphere of radius 0.5 cast 10 m down from 5 m above stops at fraction 0.4500021 on `Ground`;
`contacts(Player)` lists `Ground` with a gap of 9.98 mm (the skin) and normal (0, -1, 0) and two entries for the one
resting contact at first; the integration then fixed the adapter (see "Contact normals" below), and the spec now
requires exactly one `Ground` entry with normal y > 0.99; `setCollisionGroups(Ground, 2, 2)` makes a query of groups 1/1 pass through it (nothing is hit), a query of
groups 2/2 and one without groups hit it, and restoring the groups (0xffff) makes it visible to 1/1 again; four bad
inputs throw the documented kinds (`RangeError` for a zero direction, an unknown entity and a mask above 65535,
`TypeError` for a non-string `exclude`).

### Why the display-rate equality is exact, and the one thing that needed care

The ticks that have run depend only on the elapsed time (`spec/runtime-abi.md` section 7), and every simulated thing
(the character, the platform clocks, the `is_key_down` polling) lives in `fixed_update`. What differs between patterns
is only where a key change lands between ticks. A key change is delivered at the start of the next frame, so the plan
puts it half a tick from either neighbouring tick boundary (a segment ends at `(K + 0.5) * STEP`), which makes the
number of ticks run before it `K` whatever the rounding of the sums (a segment ending exactly on `K * STEP` would
depend on the last bit of a double sum). The unit test proves it against a model of the accumulator for five jitter
seeds. The spec asserts equality, not a tolerance, as 0214 item 5 requires of the tick sequence; the published
tolerances of 7.2 (flat 10 mm, stairs 0.4 m across fixed steps) concern different fixed steps, not different display
rates, and are not used here.

## The defect found, and its fix (runtime; prebuilt regenerated)

On the turntable the character's position followed the platform to 0.04 mm but its yaw turned at **half** the
platform's rate (the player's yaw after 20 ticks was 0.083 rad against the platform's 0.167). The example passes
`self.rotation` back every tick, the idiom the documentation recommends ("keep the facing"). `self.rotation` is the
pose after the last `step`, that is one tick older than the pose at which the move is resolved (the move is applied at
the start of the next tick, after the platform's target). The adapter adds the platform's yaw step to the requested
rotation, so the target of tick `t + 1` is the yaw step on top of the pose of tick `t - 1`: one step in every two ticks.
The position carry is unaffected because the displacement is relative and the adapter reads the current pose.

Fix, in `packages/runtime-web/src/physics/system.ts` (and `commands.ts`): the runtime remembers the rotation it last
wrote into the entity's record (what `self.rotation` returns); a `move_character` whose requested rotation equals it
(binary32 tolerance, 1e-6 per component) is marked "keep", and when the move is resolved the adapter is given the
rotation the body has then instead. Every other rotation is absolute as before, and without a platform nothing
changes (the pose does not move between the issue and the resolution). Three tests in
`packages/runtime-web/src/physics/character.test.ts` ("the rotation a move asks for"): the kept rotation follows a
turn between issue and resolution, an explicit rotation is not replaced, and the last of several moves decides; the
first fails without the fix. `spec/physics.md` section 3 states the rule. The prebuilt runtime of
`crates/mtek-cli/prebuilt` was regenerated (`npm run build && npm run prebuilt:write`).

A program that keeps its own heading and passes it absolutely does not follow a platform's yaw (the adapter adds the
platform's step to the heading each tick and the heading is not fed back); that is the contract of 0214 and unchanged.

## Documentation

* `docs/limitations.md` is generated from `tools/release-docs/data/limitations.json`: the physics entry that described
  0193 ("Host physics options can enable CCD. A regression covers 240 m/s ...") now states the 0216 envelope and its
  residuals, and a new entry `physics-character-movement` lists the measured exclusions of 0215 and 0217 (thin walls
  above 1 m per tick, stairs across fixed steps 0.4 m, narrow treads, spawned geometry seen from the next tick, hosts
  cannot move bodies).
* `docs/making-games.md` (template `tools/release-docs/templates/pages/making-games.md`): the sentence under
  "Collisions" became the section "Character movement" with three code excerpts of the example and a pointer to it.
* `docs/platform-runtime.md`: a pointer to the example and the rule about `self.rotation`.
* `README.md`: the example row and the two `ccd:` scripts of 0216 that `npm run check:release` compared and found
  missing (they were not mentioned before this change); `spec/README.md`: the decision range.
* `budgets/small-games.json`: `character-movement` with 5 830 000 B for the folder and the zip (measured 5 289 885 and
  5 291 427 B, plus 10 %, rounded up to 10 kB; the runtime and the physics module are included, as for the
  playground); the comment has one sentence for this decision; no other budget changed.
* No context example was added under `crates/mtek-compiler/src/context/examples/`: the cold-start budget has 36 bytes
  of headroom.

## Deviations and open items

* **Teleport stations** (keys 1 to 8) are not in the task text; they let one program serve both as a demo and as a
  test fixture without a long scripted walk to each feature.
* **A one-tick difference between `self.rotation` and the pending target** remains for programs that read it for
  another purpose (the fix concerns the move's request only).
* **Contact normals (fixed at integration).** `contacts` listed a resting contact twice (the capsule's manifold has two
  points at the same position) and its normal pointed from the queried body to the other. The adapter now lists points
  at the same position once and reports the other body's surface normal pointing toward the queried body (a floor gives
  +Y), the convention of `castShape` hits; `packages/physics-rapier/src/character.test.ts` asserts both.
* **The HUD** (`ui`) is DOM text over the canvas (`data-mtek-hud-text`), not part of the render-target pictures, so the
  spec checks the 3D scene only and the HUD lines ("on the ground", "in the air") are not asserted.
* **Gravity, jump, speed** are the program's; the example does not claim a particular character feel.
* The nose's colour is checked as pure white on a 640 x 320 target; the first attempt on a 320 x 160 target found no
  pixel at or above 250 (the box is three pixels wide there).

## Tests

`tests/browser/specs/movement/character.spec.ts` (22 runs), `tests/browser/support/movement-drive.test.ts` (7 unit
tests), `packages/runtime-web/src/physics/character.test.ts` (3 new), `crates/mtek-cli/tests/cli.rs` (every example
checks clean, this one included), `npm run check:budgets`, `npm run check:release`, `npm run check:coverage`,
`npm run check:prebuilt`.
