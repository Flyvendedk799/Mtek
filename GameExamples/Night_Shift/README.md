# Night Shift — The Meridian

A small first-person room clearer, inspired by cinematic close-quarters action.
The game uses Mtek's skeletal GLB pipeline: anatomical hands and enemies with
53-joint rigs, named combat clips, interrupted transitions, and animated weapon
sockets. Gunfire, reload and melee contact are coordinated with clip playback.
See [the engine contract](../../spec/decisions/0191-skeletal-animation.md) and
[asset provenance](models/CREDITS.md).
The pistol slide uses an original bevelled GLB mesh with native one-shot playback
(`animation.play`). Regenerate it with `node GameExamples/Night_Shift/tools/weapon.mjs`.
Level 1 contains **30 enemies across six rooms: 3 + 4 + 5 + 5 + 6 + 7**.
Clear each encounter, then walk through the gold exit. The next room restores
20 health and a full magazine. Clear the penthouse and walk out to finish.

## Play

From the repository root, with the Rust/Node toolchains installed:

```sh
cargo run --locked -p mtek-cli -- build --release GameExamples/Night_Shift
python -m http.server 4173 --bind 127.0.0.1 --directory GameExamples/Night_Shift
```

Open **http://127.0.0.1:4173/host/** in a desktop WebGPU browser. Click **Begin
contract** to capture the mouse; Escape releases it and pauses. Serve the whole
example directory: the host imports `../dist/app.js`. The generated `dist/`
page alone does not include the pointer-lock adapter. `mtek dev` therefore is
not the intended launch path for this example. Rebuild after editing Mtek.

To create a standalone distributable folder including the pointer-lock page:

```sh
node GameExamples/Night_Shift/tools/build.mjs
```

Upload the resulting `GameExamples/Night_Shift/dist/` folder to a static host, or
serve that folder locally. This wraps the real compiler's release build and
copies in the browser adapter; it does not replace generated gameplay code.

| Input | Action |
|---|---|
| WASD / mouse | Move / look |
| Left mouse | Fire; hold for repeat fire |
| Right mouse | Bring the pistol to the sight line; slower, precise movement |
| R | Reload (12 rounds; unlimited reserve) |
| F | Alternating punches; two connected strikes defeat a guard |
| E | Close takedown within 1.75 metres; otherwise a normal strike |
| Shift | Sprint |
| Space | Dodge in the movement direction; brief invulnerability, 0.85 s cooldown |
| Escape / M | Pause and release mouse / mute |
| Enter after defeat or completion | Restart the level |

Headshots defeat a guard immediately; body shots take two hits. Melee kills
restore 8 health. Guards wind up attacks, react to hits, and lose their attack
when staggered. Ranged guards aim at your position during the windup, so lateral
movement and dodging work. Counters block movement, sight and shots. Punches
resolve on their contact frame, not on the key press.

## Example structure

- `src/main.mtek`: scene, first-person camera, movement, pistol and hand assemblies,
  animation curves, combat queries, health, HUD and room progression.
- `src/actors.mtek`: independently animated guards, attack windups, hit reactions,
  message dispatch and falling bodies.
- `src/world.mtek`: room roster, shared collision/ray geometry and pooled visual assets.
- `host/`: browser pointer lock and focus handling through typed `setInput` /
  `onOutput`. No JavaScript combat or movement simulation.
- `sounds/`: original synthesized Foley; regenerate with `node
  GameExamples/Night_Shift/tools/sounds.mjs`.

Seven independently animated guard rigs are reused between rooms, with spawned
skinned bodies, props and effects.
Hidden guards are parked outside the level and ignore damage. String equality
(decision 0189) is the small compiler addition needed for useful message dispatch.
The six rooms share the hotel exterior shell but have separately authored interiors:
an asymmetric reception, grouped lounge booths, a central banquet table with
two flanking aisles, staggered gallery plinths and partitions, a divided office,
and an L-shaped penthouse bar beside a panoramic city wall. Furniture footprints
drive rendering, movement, bullet occlusion and guard navigation. Character meshes and weights derive from CC0 MakeHuman assets; see
[asset provenance](models/CREDITS.md). Mtek imports 53-joint rigs with authored
recoil, reload, strikes and hit/death clips, smooth interrupted transitions and
animated weapon sockets. Damage is synchronized to clip contact markers. Movement and recoil use delta-time-based exponential smoothing;
collision movement uses four substeps to prevent dash tunnelling.

## Verify

```sh
cargo run --locked -p mtek-cli -- build --mode test GameExamples/Night_Shift
node node_modules/typescript/bin/tsc -p GameExamples/Night_Shift/host
node GameExamples/Night_Shift/tools/verify.mjs
```

The browser check needs the repository's Playwright Chromium installation and a
working WebGPU adapter. It fails rather than silently skipping without one. It
aims, fires, defeats all 30 guards and walks through all six exits using real
inputs; it also checks pause, delayed punch contact, takedowns, healing, reload,
dodge and pointer capture. It never injects kills, health or room changes.
Screenshots and the run report go to ignored `tests/browser/results/room-clearer/`.
Build with `--release` again before playing normally.

`node GameExamples/Night_Shift/tools/verify-animation.mjs` checks the slide cycle,
spring recovery, magazine extraction/insertion, and punch windup/contact/recovery
against the compiled scene, and captures each pose. The viewmodel uses one skinned arm mesh with articulated fingers. Its rest pose
keeps the left side clear; the pistol follows the right-hand weapon socket.

For a production-page smoke check and an observed frame-cadence report, run
`node GameExamples/Night_Shift/tools/build.mjs` followed by
`node GameExamples/Night_Shift/tools/verify-release.mjs`. Presentation timings are
specific to the machine/browser; they are not a universal performance guarantee.

Aiming uses a dedicated arm pose and aligns the front-sight tip with the camera
ray. The rear sight has an open notch; the HUD crosshair hides while aiming.
Armed guards use a two-handed grip, while unarmed guards run with alternating
arm swings. Planted-foot IK is baked at the actual walk/run speeds, and enemies
turn toward their travel direction while moving around furniture.

`python GameExamples/Night_Shift/tools/verify-rig.py` checks exported loop seams,
foot contact speed/height, running arm motion and support-hand spacing (requires
the same Python dependencies as character preparation). `verify-animation.mjs`
checks sight alignment and captures 4:3 and 16:9 aiming views. `verify-poses.mjs`
captures a sequence of running poses in the game for visual review.

Close combat buffers one F press during strike recovery, allowing a deliberate
jab/cross combination. Strikes produce directional reactions and collision-checked
pushback. E chooses a nearby visible enemy before starting its takedown, briefly
interrupts that enemy, and steps into contact using the normal collision checks.
Outside grab range E falls back to a regular strike. Falling bodies copy the
victim's displayed pose before blending into their fall (`animation.copy_pose`).
Mtek's moving crossfades preserve outgoing motion; interrupted transitions retain
continuity by snapshotting their displayed blend (decision 0192).

Enemy strikes use a staggered, planted stance with knee flexion, hip/torso
rotation, a fast extension and slower recovery. Attack direction commits before
contact; damage uses a narrow forward corridor so lateral movement can evade a
punch without dodge immunity. `tools/verify-evasion.mjs` compares standing still
against the same attack with a sidestep, using real movement inputs.

Falls articulate the knees before backward rotation and settle the arms after
impact. Offline surface sampling grounds each baked death pose against the floor;
`verify-rig.py` checks the exported deformed surface, including interpolated frames.
`node GameExamples/Night_Shift/tools/playtest-visual.mjs` captures hit, fall, reload
and enemy attack sequences for visual review. These changes use the existing
Mtek skeletal runtime; this iteration adds no new language/runtime API.

Reloads raise and cant the pistol so magazine removal and insertion remain in the
viewport; the support hand follows the rotated magazine path. Shots add visible
wrist recoil, and sights/ejection-port detail follow the slide cycle. Empty
magazines hold the slide open until the reload reaches its insertion phase.
The animation browser check covers both tactical and empty-magazine reloads.

Armed NPCs carry six rounds and enter an explicit reload state with a skeletal
reload clip and matching magazine motion. Hits and grabs interrupt reloading;
an empty guard restarts after recovery. Firing, hit reactions and reloading have
explicit priority, with no movement or shots during reload. Enemy traces and
muzzle flashes use the animated weapon socket, and their slides cycle on contact.

Player weapon lag follows turn rate, sprinting lowers the shared hand/weapon rig,
and gait feedback follows actual displacement rather than requested velocity.
`node GameExamples/Night_Shift/tools/verify-feedback.mjs` checks NPC reload interruption
and recovery, sprint settling, and stopping gait against walls using real inputs.

The hotel uses original procedural dark stone, travertine, velvet, walnut, Art Deco artwork, signage and
weapon materials, generated by `python GameExamples/Night_Shift/tools/materials.py`
(with the character-preparation Python dependencies). Native Mtek scene geometry
adds ceiling coffers, brass rails, furniture fluting and stone tops. Four lights
balance a readable key with warm entry/reception light and each room's accent.
Prefab-only textures are uploaded at runtime startup before decoded images close,
so decorations can spawn safely on any later frame or room transition.
