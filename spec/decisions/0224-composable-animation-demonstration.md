# 0224 — Composable animation demonstration

Status: implemented; the browser acceptance below ran green on both local backends (hardware and software, 31 tests each).
Date: 2026-10-27. Extends 0219, 0220, 0221, 0222 and 0223.

Decision 0219 asks, in acceptance item 7, for "an example written in Mtek source with a browser test on both local backends comparing
GPU output with CPU references". This record is that example, that test, the two generated models they need and the remaining
documentation. It demonstrates items 1 to 6 of 0219 from source. It found no defect in the runtime or the compiler (below);
it found three limits of the source surface, which it documents.

## The example: `examples/animation-composition`

A playable stage in Mtek source only (`mtek.toml`, `src/main.mtek` of about 300 lines, a README, two models). The host does nothing
but mount it; there is no host animation code.

* **The Hero** (`Hero` with a child `Model`): a `Kinematic` capsule (radius 0.3 m, height 1.8 m) and, as its child, a skinned figure of
  1.84 m whose soles are `FIGURE_BASE` = 0.91 m below the capsule's centre. Keys: W walk, Shift+W run, Q and E strafe, A and D turn.
  **2D blend space** (0220): `blend_sample` of Idle (0, 0), Walk (0, 1), Run (0, 2), StrafeLeft (-1, 0) and StrafeRight (1, 0), then `blend_play`;
  the keys give a target, and the program moves the parameter after it with `1 - exp(-dt / 0.12)` per frame (which composes exactly, so the
  parameter is the same at every frame time). Diagonals fall outside the hull of the samples (W+E is (1, 1)) and are clamped to it by the runtime.
* **Root motion into the mover** (0223): `animation.root_motion(Model, "Root")` takes the travel of the `Root` joint above the hips; `update`
  adds `take_root_motion` to an entity state, `fixed_update` calls `move_character(that + gravity, heading)` (combining the animation with
  decisions 0214 to 0218: steps, the curb and the ramp are climbed by the capsule).
* **Upper-body layer** (0220): `set_layer(Model, "wave", "Wave", 0.0, false, "Spine1")` once; F fades it in over 0.4 s, releasing F fades it out.
  The `Wave` clip is a whole-body pose with a waving right arm, so only the mask keeps the legs, hips and tail out of it.
* **Reach** (0222, 0223): G holds the left hand on `Orb`, a world-space point, with `limb_goal`; the program holds the goal to 0.5 m of the shoulder
  (the arm is 0.57 m) and ramps the weight with the same exponential.
* **Chain goal** (0223): T toggles `chain_goal(Model, "tail", "Tail4", 4, tip, 1.0)`; the tip follows a point that swings 0.3 m to the side at
  2.5 rad/s behind the figure. (The Hero is a lizard-like biped with a four joint tail, which `mapHumanoid` accepts as an extra.)
* **Foot placement** (0222, 0223): the ground is a function of the program (`ground(x, z)`: a curb of 0.2 m for x >= 0 at z 0 to 2, two risers of 0.15 m at
  z = 3.5 and 4.5, a plateau of 0.3 m, a ramp down to the floor at z 7.5 to 9, with the edges smoothed over centimetres) with the same shapes as the
  colliders; the program puts each foot on the ground under it at the height the animation lifts it to (`foot_placement` takes the point and the
  normal; P toggles it). The animated feet come from `Ghost`, a second, hidden figure that plays the same blend and has no layer, goal or placement, because
  `animation.joint_position` reads the pose after goals (see the limits).
* **A second rig with `clips_from`** (0221, 0223): `Guest` is the `Guest.glb` skeleton (Unreal-style names, legs 1.12 times as long, arms 0.88, spine 0.9,
  clavicles and an upper chest, an A-pose rest) with `clips_from: HERO; clip: "Dance"`.
* **Stations** 1 to 4 teleport the Hero (start, the curb's edge, the foot of the stairs, the plateau).

## The assets

`tests/assets/tools/animation-demo-assets.mjs` writes `examples/animation-composition/models/Hero.glb` (169,452 bytes) and `Guest.glb` (42,764
bytes) from explicit data, called by `make-glb.mjs` like the configurator's chair, so `npm run check:assets` fails when a file differs and the files
are committed (they are small, and the release build and the browser setup find them in the project). Nothing was downloaded or exported: they are
original, generated, and under the licence of this repository (all rights reserved, like it). Each part of the mesh is a tube or a box bound rigidly to one joint
(about 900 vertices for the Hero, 700 for the Guest). The Hero has seven clips: Idle (2 s), Walk (1 s), Run (0.7 s), StrafeLeft and StrafeRight
(0.8 s) with the travel in `Root` (1.1667, 2.8571 and 0.8333 m/s), the left foot striking at phase 0; Wave (1.6 s) and Dance (2 s). Each is authored as
world-space bone directions with the legs solved by two-bone IK so that a stance foot stays where it was planted while the root travels
(`animation-assets.test.ts`: at most 3 mm between samples a sixtieth of a second apart, ankles never more than 3 mm below their height, knees forward in every
clip, every clip loops). The Guest has no clips of its own: the Hero's are retargeted onto it at mount.

## The browser acceptance: `tests/browser/specs/animation-composition/`

Six spec files, 31 tests on each of the hardware and software projects (62 runs), with the manual clock and scripted keys. `animation-example.ts`
builds the example for `animation-composition.config.ts` with `animation-setup.ts` (`npx playwright test -c animation-composition.config.ts`, which builds only what
it needs); `animation-drive.ts` is the page side (an extension that only reads: `context.animation(id).inspect()`, the pose and the palette);
`animation-reference.ts` holds the references; plans are those of the movement acceptance (`movement-drive.ts`). `animation-reference.test.ts` and
`animation-assets.test.ts` (29 tests) check the references and the models without the engine. Expected values are derived from something other than
the run; each is noted below. Hardware and software agree to the last digit in everything but the rendered images (the CPU animation system is the same
code), which agree to a pixel.

| Test | Expectation (derivation) | Measured |
|---|---|---|
| Blend weights | at every frame of a 700-frame sweep (inside every triangle, along the edges, outside the hull) the weights of `inspect().blend` equal the Delaunay barycentric weights derived by hand for the layout (hull LEFT, RIGHT, RUN; the triangulation is unique: no four points are cocircular), with the nearest-hull-point clamp outside; sum one; one at a sample | worst difference 1.1e-16; 84 frames outside the hull, 132 with three active clips; weight 1 at each sample after 1.5 s |
| Weight continuity | each weight changes by at most the altitude bound of the layout (1 / 0.4472, triangle LEFT, WALK, RUN) times the parameter step | 2.121 (bound 2.236) |
| Pose continuity | in one frame a joint moves by at most 1.25 times the fastest clip's own motion of it plus half the L1 change of the weights times the largest distance between two clips' poses at one phase, plus 3 mm (all measured on CPU players) | worst 0.76 of the allowed value; the clips differ by at least 5 times a frame's motion |
| Root motion | after a lead-in, over whole cycles under the tick pattern, the body's velocity equals the translation of `Root` over a cycle of the clip in the GLB divided by its duration (within 2 mm/s); after a turn of 1.5667 rad the displacement is that turned by the program's heading | walk 1.16652 against 1.16667, run 2.85652 against 2.85714, strafes 0.83313 and 0.83303 against 0.83333 m/s; heading displacement within 0.3 mm |
| Mask | the Wave clip has channels for the hips; with the layer faded in, every joint outside `Spine1` and its descendants is where the same figure without the layer (`Ghost`) has it, at every frame of the run (placement and tail goal off so that nothing else differs) | outside: 0 (exactly); inside: the right hand moved 0.99 m, its forearm 0.49 m, the left hand 0.09 m (its parent turned), the head's top 0.03 m |
| Fade | the weight is `from + (to - from) smoothstep(elapsed / 0.4)` from the weight at each key change, including two interrupted fades, at the frame patterns tick, 1/30, 1/60, 1/144 s and jitter; the layer's clock is the time since it was set; the slope never exceeds 1.5 / 0.4 | weight error 3e-14 at worst, clock error 1e-13, 62 to 285 samples in mid-fade per pattern; steepest slope 3.7413 (bound 3.75) |
| `clips_from` | at ten times over two cycles of Dance every Guest joint equals the position on a CPU player running `retargetHumanoid(Hero, Guest)` of the two GLB files; the bones keep their lengths; the limb directions equal those of the Hero's own playback within 0.25 degrees (the hierarchies and rests differ) | 2.4e-7 m; 5e-8 m; 0.164 degrees; the rests differ by 45.000 degrees |
| Reach | with G held the left wrist (`LeftHand` joint, in the world through the capsule's pose) is on the orb; the limb's weight is the program's; flexion stays in 0 to 145 degrees; out of reach (walking away) the hand stops at 0.5 m from the shoulder on the line to the orb, on the solver's goal | miss 2.6e-7 m; flexion 91.5 to 93.1 degrees; clamp within 0.16 mm of 0.5 m, 0.77 degrees off the line (the shoulder moves a few millimetres between the program's read and the pose), 8.8e-6 m from the goal |
| Elbows and knees | in every frame of the clamp walk the elbow lies on the back side of the shoulder-wrist line; in every frame of a run over the curb and one over the stairs, plateau and ramp both knees lie on the front side of the hip-ankle line, and the reported knee flexion is in 0 to 150 degrees | elbow +0.021 m at worst; knees +0.058 and +0.060 m at worst; flexion 15 to 113 degrees |
| Tail | the tail's goal is the program's expression (0.3 sin(2.5 t), 0.75, -0.5); the tip is within 1 mm (the default CCD tolerance) of it; T removes the goal and the tail is the animation's | goal 2.3e-7 m; tip 0.985 mm; swing 0.29999 m |
| Feet on the course | walking from the foot of the stairs up the risers, over the plateau and down the ramp, each foot's world height is the ground's plus the lift the animation gives it plus the sole offset along the normal (planted feet within `e^-1 * softness * (cmax - cmin)` + 1 mm of it, 13.0 mm, the miss of a target at full extension; any foot within that beyond the hips' smoothing lag) | median 4e-8 m; planted feet 4.7 mm at worst; beyond lag 7.9 mm; the hips dropped by up to 0.140 m |
| Hips drop | at the curb's edge (left foot on 0.2 m, right on the floor) the minimum drop derived from the unplaced pose (Ghost) with the closed form of spec/animation.md 3.4 equals the runtime's `requiredDrop`; every frame's applied drop is the smoothing of it from the previous one; the hips are lower than the unplaced hips by that drop; the right leg is at the exact-reach limit, the left inside it | minimum 0.19838 against 0.19841 reported; smoothing 5e-6 m per frame; applied 0.19736 (1.0 mm behind the moving minimum: the idle clip breathes and the smoothing trails it by 0.1 s of its rate); right leg 0.84841 against limit 0.84739, left 0.64864 |
| Placement toggle | P switches it off: the foot over the floor then hangs at the capsule's height (0.28 m), with it on it is at 0.08 m | 0.27999 and 0.07999 |
| GPU against CPU | the figure's pixels (orange for the Hero, blue for the Guest, no other surface is either) form a mask; the CPU mask is the committed mesh skinned with the CPU palette of that frame, placed by the entity's pose, projected through the program's camera and rasterised at pixel centres; the symmetric difference is at most 1.5 times the reference's boundary length, centroids within 1.5 pixels; the same mesh unposed does not match (IoU lower by 0.1) | 41 to 59 pixels against bounds of 467 to 521; IoU 0.964 to 0.975 (0.984 for the Guest); centroids 0.16 to 0.82 pixel; unposed IoU 0.48 to 0.61 |
| Display rate | the parameter (the program's own frame-time arithmetic) is the same at every boundary at 1/30, 1/60, 1/144 s and jitter; the weight-dependent results differ by at most the documented sample-and-hold | parameter 4.2e-7; see below |

No page error, console error or runtime diagnostic in any run, and every GPU, listener and physics counter is zero after `dispose`.

### The display rate

The animation clock advances in phase 3 by the frame time, not by the fixed tick (unlike the movement of 0218, whose results are bit-for-bit
equal), so a result that depends on the blend weights is a function of the frame partition. The weights an advance uses are those at its start
(spec/animation.md 1.1): a left-endpoint rule, so the pose trails the parameter by half a frame; and the program starts the blend in its first update, after the first
advance, so the phase origin is one frame late. The spec asserts what that implies and nothing looser: the parameter, the fades and the layer clocks are equal; the
phase differs between two partitions by at most (idle rate + half the rate gap) times the longer frame (measured 0.020 cycle at 1/30 s against 0.025 allowed); the body
by at most the walking speed times a frame and a tick (0.037 m for jitter against 0.058 m); and after the body has stopped the two lags cancel, so the resting
positions agree (4.9 mm at worst for jitter, asserted under 1 cm). Moving the blend update to `fixed_update` would not remove the effect (the advance would still
use the weights at the start of a frame); it would only quantise the input to ticks.

## Defects found

None in the runtime or the compiler: every comparison above holds at the first correct reading of the reference, and the failures during development
were references or authoring (a clip that did not loop, a reference reading a pose with the weights of the next frame, the hips' smoothing lag). Nothing was relaxed to pass. Three
limits of the source surface were found by writing the program; each is documented in `docs/making-games.md` and the limitations page:

1. **The animated feet cannot be read once goals are set.** `animation.joint_position` returns the pose after layers and goals. A program that places a foot from the animated
   foot (planted points follow the animation's xz and lift) would read its own result back and the foot would freeze. The example keeps an unplaced twin, `Ghost`
   (a second player playing the same blend; about the cost of one more skeleton). A call that reads the pose before goals, or a terrain-following form of `foot_placement`
   that takes a height, would remove the twin; both are additions to the language and are not done here.
2. **`foot_placement` has one contact weight for both feet and only the planted form.** The program's ground points carry the animation's lift (`max(foot.y - SOLE, 0)`)
   so that a swinging foot is not pinned to the ground. The runtime's `height` form (host API) has no language counterpart.
3. **The language has no ray cast.** The ground is a program function with the shape of its colliders, which a test checks (`animation-reference.test.ts`).

Also observed and not changed: `FootGroundInspection.residual` includes the shortfall of the soft reach margin (up to 29 mm in the course walk), as 0222 defines it.

## Package budget

`budgets/small-games.json` gets an entry for `animation-composition`: measured on the merged tree (after the lazily loaded animation module of 0225), folder 5,981,750 bytes and zip
5,983,686 bytes (`mtek build --release --itch`: the core runtime, the animation module, the physics module (about 5 MB, as for `character-movement`) and the two models) plus 10 %, rounded up to 10 kB:
**6,580,000** for the folder and **6,590,000** for the zip. (Measured before 0225 was merged, on the unsplit runtime of 0220 to 0223, it was 5,972,423 and 5,974,225 bytes: the split costs this example about 9 kB, which it
pays back in every game without a skeleton.) No other budget changed, and every row holds on the merged tree.

## Documentation

`docs/making-games.md` (template in `tools/release-docs/templates/pages/making-games.md`) has a section "Composing animation" that quotes the example verbatim
(blocks `from=` checked against the source by `npm run check:release`); the limitations data adds the three limits above; `README.md` lists the example;
`spec/animation.md` section 6 summarises the demonstration. The example's README has the controls and the verification commands.

## Not done

Skeletal animation of non-humanoids, facial animation and wider physical-device evidence remain outside the area (0219). The foot placement is demonstrated
on a straight strip with a smoothed ground function; slopes steeper than the ramp's 11 degrees, uneven ground under the capsule that the program's function does not
describe, and turning on the stairs are not asserted. The Guest plays one clip at a time and the layers of a retargeted rig are not part of the acceptance.
