# Animation Composition

The demonstration of decision 0224 (acceptance item 7 of [decision 0219](../../spec/decisions/0219-complete-composable-animation.md)): a character driven by a 2D blend space, an upper-body layer, foot placement on steps, a curb and a ramp, a hand reaching a world-space point, a chain goal on a tail and root motion that moves a character capsule, and a second character with another skeleton playing the first one's clips. It is Mtek source only: the host does nothing but mount the program.

```
examples/animation-composition/
  mtek.toml          the project and its scene (Stage)
  src/main.mtek      the whole program (about 300 lines)
  models/Hero.glb    the Hero: T-pose, Mixamo-style names, a Root joint above the hips, a four joint tail, seven clips (169 kB)
  models/Guest.glb   the Guest: A-pose, Unreal-style names, clavicles, other proportions, no clips (43 kB)
```

The models are **generated**, not downloaded: `tests/assets/tools/animation-demo-assets.mjs` writes them from explicit data (original work, the licence of this repository), `node tests/assets/tools/make-glb.mjs` rewrites them and `npm run check:assets` fails when a committed file differs. They are committed because they are small. The Hero's clips are Idle, Walk, Run, StrafeLeft, StrafeRight (the travel is in `Root`, the left foot strikes at phase 0), Wave (a whole-body pose with the right arm waving) and Dance (in place).

## Controls

| Key | What happens |
|---|---|
| W / Shift+W | walk (1.17 m/s) / run (2.86 m/s) forward |
| Q / E | strafe left / right (0.83 m/s); with W the parameter leaves the hull of the samples and is clamped to it |
| A / D | turn left / right at 2 rad/s |
| F | hold to wave: the upper-body layer fades in over 0.4 s, and out when released |
| G | hold to reach for the orb with the left hand (`limb_goal`, held to 0.5 m of the shoulder) |
| T | the tail follows a point that swings behind the figure, on / off (`chain_goal`) |
| P | foot placement on / off |
| 1 to 4 | stations: the start, the curb's edge, the foot of the stairs, the plateau |

The Guest dances beside the curb at x = -2.4 (on the right of the picture, seen from the start). The stage runs along +z: a curb of 0.2 m (x >= 0, z 0 to 2), two risers of 0.15 m (z = 3.5 and 4.5), a plateau of 0.3 m and a ramp down to the floor (z 7.5 to 9).

## What it shows

| Feature | Where |
|---|---|
| A 2D blend space (0220) | `update`: five `blend_sample` calls and `blend_play` once, then `blend_parameter` every frame; the parameter follows the keys with `1 - exp(-dt / FOLLOW)`, which gives the same curve at every frame time |
| Root motion into a body mover (0223) | `root_motion(Model, "Root")`, `take_root_motion` added to `Hero.travel` in `update` and spent in `Hero.fixed_update` with `move_character` |
| A masked layer and fades (0220) | `set_layer(.., "Spine1")` once; `fade_layer` on F down and up; the Wave clip is whole-body, the mask keeps the legs and the tail out of it |
| A limb goal in world space (0222, 0223) | `limb_goal(Model, "left_arm", goal, reach)`, the goal being the orb held to the arm's reach, the weight following G |
| A chain goal (0223) | `chain_goal(Model, "tail", "Tail4", 4, tip, 1.0)` |
| Foot placement and the hips drop (0222, 0223) | `foot_placement` with ground points from the program's `ground` and `ground_normal`; the runtime lowers the hips only as much as needed (up to 0.2 m at the curb's edge) |
| An unplaced twin | `Ghost`: a hidden figure with the same blend and no goals. `animation.joint_position` reads the pose after goals, so the animated feet come from the twin |
| Another humanoid with `clips_from` (0221, 0223) | `Guest`: `clips_from: HERO; clip: "Dance"`; the Hero's clips are retargeted to the Guest's bones, proportions and rest pose at mount |

The animation clock runs on the frame time: the weights of a blend that moves differ a little between display rates, as decision 0224 and `spec/animation.md` section 6 explain. The parameter, the fades and the layer clocks do not.

## Run

```bash
mtek check examples/animation-composition      # 0 errors, 0 warnings
mtek build examples/animation-composition      # writes examples/animation-composition/dist, including physics/<hash>.js
mtek dev examples/animation-composition        # serves it
```

## Tests

- `tests/browser/specs/animation-composition/*.spec.ts` (hardware and software adapters, manual clock, scripted keys; `npx playwright test -c animation-composition.config.ts` from `tests/browser`): the blend weights against a hand-derived Delaunay layout and the pose's continuity while the parameter moves; root motion against the clips' own travel; the layer mask and the smoothstep timing of the fades under five frame-time patterns; the Guest against a CPU `retargetHumanoid`; the hand on its target and the elbows and knees on the right side of their limbs; the tail's chain goal; the feet on the steps and the hips drop against a derivation from the unplaced pose; the GPU image against a CPU-skinned silhouette; no page errors, resources released after `dispose`. The derivations and the measured values are in [decision 0224](../../spec/decisions/0224-composable-animation-demonstration.md).
- `tests/browser/support/animation-reference.test.ts` and `animation-assets.test.ts`: the references and the models without the engine (the models are regenerated and compared byte for byte).
- `crates/mtek-cli/tests/cli.rs`: every example under `examples/` checks clean, this one included.
- `budgets/small-games.json`: the size budget of the game package.
