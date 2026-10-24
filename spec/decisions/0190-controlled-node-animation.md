# 0190 — Controlled node animation

Status: accepted. Supersedes the automatic-playback-only and rotation-sampling
parts of decision 0156; composition from decision 0174 stays unchanged.

The first-person room-clearer exposed a missing basic engine facility: imported
clips could only autoplay and loop. Weapon cycles and attacks need explicit
starts, completion, blending and reliable contact timing.

The CPU namespace `animation` controls the single imported node clip declared
on a live entity. All functions take `target: entity_ref` first (a named entity
is accepted). Mutation calls are lifecycle/handler-only and return `bool`.
Queries are CPU-only, nonconstant, and not allowed directly in bindings.

| Function after target | Result | Semantics |
|---|---|---|
| `play(looping: bool, speed: f32)` | bool | Restart at zero; speed finite and >= 0. Does not change weight or an in-progress fade. |
| `pause()` | bool | Freeze time. |
| `resume()` | bool | Continue; false if a one-shot is finished. |
| `seek(time: f32)` | bool | Clamp finite seconds to [0, duration]; apply now, clear marker crossings, never resume implicitly. Seeking a one-shot to its end finishes it. |
| `fade(weight: f32, duration: f32)` | bool | Clamp finite weight to [0,1]. Finite duration >= 0. Smoothstep from current weight; zero applies immediately. Interruptions start at the current weight. |
| `time()`, `duration()`, `weight()` | f32 | Current values, rounded to binary32. |
| `playing()`, `finished()` | bool | Playback state; zero-speed playback is still playing. Finished persists until play or seek away from the end. |
| `crossed(marker: f32)` | bool | Marker in (0, duration] crossed in the latest phase-3 advance, including wrap and multiple loops. Reading does not consume it. A seek or restart clears it. |

Missing clips and stale, reserved or removing references return false/zero and
do nothing. Invalid numeric control arguments return false without changing
the player. Commands use generation checks before looking up a clip slot.
Removal discards playback state. A newly occupied slot starts with defaults.
Playback is transient: scene reset/recreation and hot reload create new players;
saved scene state does not serialize animation players.

Defaults preserve old programs: autoplay, loop, speed 1, weight 1. Exact loop
end holds the last key and wraps only on a later advance. A one-shot clamps at
the end and stays there. A zero-duration one-shot finishes immediately.
Per-clip pause freezes time but not fades. Scene pause freezes both, following
the existing phase-3 scheduling. Init controls survive the initial posing pass.
Controls apply changed poses immediately; ordinary transform propagation still
happens in the normal frame order.

Translation/scale LINEAR samples use lerp; rotation LINEAR uses shortest-arc,
normalized SLERP (glTF semantics), replacing nlerp. STEP holds the previous key.
Weight blends translation toward zero, scale toward one, and rotation toward
identity with shortest-arc SLERP, before composing `base * clip`. This blends a
clip with the base pose; it is **not** crossfading between clips.

This adds no manifest fields and no skeletal animation, named-clip switching,
root motion, masks, IK, or state-machine graph. Those need separate designs.

Validation: sampler/control tests, world composition and init tests, compiler
effect checks, emitted-code execution, and a one-shot GLB slide in room-clearer.
