# Game-development audit — 24 October 2026

At the start of this audit, the room-clearer was a prototype with block characters,
procedural hands and limited enemy behaviours. Those were content choices, but
Mtek also lacked the skeletal asset and animation facilities needed to replace
them. The upgrades delivered below address those engine limitations.

The current game is [Night Shift](../../GameExamples/Night_Shift/README.md).
Its source, prepared assets, browser host and verification tools are checked in
under `GameExamples/Night_Shift/`.

## Shipped in this change

- Native imported-node animation playback: one-shot/loop, speed, pause, resume,
  seek, completion queries and smooth weight fades.
- Frame-crossing markers for synchronizing gameplay with clip time.
- Correct glTF rotation SLERP.
- Compiler registry, type/effect rules, generated JS context calls and runtime
  support. These are usable from Mtek, not JavaScript game logic.
- Room-clearer uses an original bevelled GLB slide and native one-shot cycle.
  Player tracers now originate at the muzzle instead of clipping the near plane.

Contract: [decision 0190](../../spec/decisions/0190-controlled-node-animation.md).
The marker query reports whether a crossing happened, not how many; it is intended
for one-shot contact/action windows, not counting every repetition during a hitch.

## Skeletal upgrade delivered (decision 0191)

Validated skin import, independent hierarchical pose players, named clip
transitions with interruption continuity, mesh-local sockets and reusable CPU
skinning buffers are implemented. Room-clearer uses CC0 anatomical meshes with
53 joints, authored weapon/melee clips, locomotion, hit reactions and death.
Player and enemy damage use clip markers. Engine and full encounter browser
checks exercise the implementation.

Further engine work can add GPU deformation, layer masks/additive animation,
native relative pointer input, and capsule sweeps/character collision queries.
Those are distinct features, not prerequisites hidden behind this integration.

## Quality gate for calling this a showcase

A complete 30-enemy run is necessary but insufficient. Also check first-person
silhouettes and sight clearance at varied aspect ratios; continuous transitions
under aim/fire/reload/melee interruption; no contacts through cover; frame-time
consistency on a stated GPU; input latency; and a human playtest of encounter
variety and combat readability. Browser smoke checks do not establish those
subjective quality claims.

## Verification of the skeletal integration

On 2026-10-24: 904 compiler unit tests, 18 asset tests, 23 fixture tests,
6 standard-library schema tests and 1,527 runtime tests passed. TypeScript,
ESLint, compiler Clippy, generated documentation, asset fixtures and prebuilt
runtime provenance checks passed. Additional focused tests exercise generated
Mtek socket calls, buffer isolation, teardown and rebuilding retained skin data.

Chromium 153.0.8010.12 at 1440x900 completed all six rooms and 30 enemies using
real gameplay inputs, then passed melee, takedown, reload, pause, pointer capture
and restart checks. The animation check captures idle, recoil, magazine removal,
strike windup/contact and recovery. The production entry page runs without
browser errors. The seven-enemy encounter measured 8.5 ms median / 11.4 ms p95
CPU frame work over 32 manually stepped frames. This is a local CPU measurement,
not a GPU timing or a guarantee for other devices. Reports/screenshots are in
ignored `tests/browser/results/room-clearer/` and can be reproduced with the
example's verification scripts.

## Aiming, grip and locomotion correction

A later visual review found that the old ADS offset raised the sights above the
camera ray, the rear sight was a solid block, and moving the entire arm rig for
ADS exposed the cut shoulder mesh. Dedicated aim/aim-fire clips now keep the
shoulders in place, with a notched rear sight and camera-aligned front-sight tip.
Muzzle tracers and ejected cases follow the animated weapon transform.

The hand pose now orients palms around the grip, positions the support hand
against the weapon, and lays the thumbs along its frame. Enemies carry a pistol
with a separate grip and barrel. Armed walking and unarmed running have distinct
upper-body poses. Baked leg IK plants feet at the game's movement speeds;
contralateral arm swings, torso movement and travel-facing turns replace the
fixed upper-body running pose. Exported-rig checks verify loop seams, contact
height/speed and support-hand distance; browser captures cover 4:3 and 16:9 ADS.

The real aimed-fire test also found a runtime defect: chorded mouse button
changes arrive as pointermove rather than additional pointerdown/up events.
Mtek now reconciles the button bitmask on these transitions, allowing left-fire
while right-aim remains held. A DOM regression test covers left/right/middle
button combinations and cancellation.

## Close-combat continuity (decision 0192)

The runtime now advances both clips during a crossfade, snapshots interrupted
blends, and exposes `animation.copy_pose` for compatible live rigs. The game
transfers a defeated guard's displayed pose into its falling body before the
fall transition. Tests cover independently owned copies, incompatible skeletons,
weighted outgoing clips, interruptions and generated context calls.

Gameplay adds one buffered follow-up strike, left/right hit reactions, bounded
collision-checked pushback, and contextual takedowns with a short approach and
victim interruption. Normal enemy melee now requires closer contact. In-game
checks exercise buffered kills and actual movement into takedown contact, in
addition to all 30 encounters, aimed shots, reload, pause and restart. Captured
close-ups led to restoring covered skin at the cuffs/neckline, clearing title
text when combat begins, and authoring immediate upper-body death reactions.
