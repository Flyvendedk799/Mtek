# Next PR goal: game features the hardening PR left out

The game-hardening PR (#5) made `main` green and fixed the blocker and major findings of `docs/audits/2026-10-23-game-audit.md`. This page is the goal of the **next** game PR: the gaps of audit §3 that still stop typical small games. Each item is a feature, not a bug fix, so each needs a spec section, a decision record, pass and fail fixtures, and a GPU browser spec, the same way as the hardening work. Decision numbers start at 0180.

## Goal

A newcomer can write a small 2D arcade shooter, a platformer and a click puzzle in Mtek without workarounds. Each of the three ships as an example with fixtures that play the game: a run, a hit, a loss, a score. Those three examples are the acceptance test for the whole PR.

## Items, in order

Ordered by how many game genres each unblocks. Size: S is about a day, M a few days, L a week or more.

| # | Item | Unblocks | Size | Done when |
|---|---|---|---|---|
| 1 | **Overlap and trigger tests without Rapier**: `overlaps(a, b)`, `first_overlapping(self, tag)`, and box/circle shapes on an entity without a dynamic body. Collisions currently need physics.js (+4.4 MB). | arcade, shooter, platformer | M | A bullet hits an enemy in a game package with no physics bundle; size budget stays within the non-physics examples' range. |
| 2 | **Entities affecting each other**: write state through an `entity_ref` (today `E5074`), or a message/event a prefab handles (`send(ref, Damage { amount: 1 })`). Choose one model with the ownership rules of decision 0151. | anything with health, pickups or AI | L | A bullet lowers an enemy's `hp`; a pickup tells the player; no scene-level parallel arrays. |
| 3 | **Mapping between screen and world**: viewport size on the CPU, `screen_to_world(p)`, `world_to_screen(v)`, and picking or raycasting from the pointer. | mouse aim, click-to-move, puzzles, HUD anchored to entities | S–M | Clicking a sprite under an orthographic camera selects it; a HUD label follows an entity. |
| 4 | **Gamepad, and input actions**: Gamepad API polling, plus an action map (`action_pressed("jump")`) bound to keys, buttons and touch. | platformer, action, couch games | M | The platformer plays with keyboard and gamepad through one action map. |
| 5 | **Multi-touch and on-screen controls**: all active pointers, and a virtual stick and buttons. | mobile on itch.io | M | The shooter plays on a phone. |
| 6 | **Sprite flip and run-time sheet swap**: a `flip_x`/`flip_y` that survives back-face culling, texture params writable at run time (lift `E5073` for sprites), and a small helper for animation state (start cell, length, fps, loop or once, a finished event). | 2D characters | S–M | The platformer hero faces left and right and switches between idle, run and jump sheets. |
| 7 | **Timer handles and growable collections**: `let t = every(…)` with `cancel(t)`, and a bounded list type for inventories and pools. | most game logic | M | The shooter's spawn waves start and stop without flag state. |
| 8 | **Richer particles**: bursts (`emit(n)`), colour, size and alpha over life, additive blending, and a per-emitter cap in place of the global 256. | effects in every genre | M | Explosions in the shooter are one-shot bursts that fade. |
| 9 | **Tilemaps and level data**: a tilemap entity drawn instanced from a sheet, grid helpers, and a level asset type (JSON or Tiled `.tmj`). | platformer, puzzle, top-down | L | The platformer's level is a tilemap file; collision against solid tiles uses item 1. |
| 10 | **Camera helpers**: follow with damping, shake, `move_toward`, `look_at`. | platformer, top-down | S | The platformer camera follows the hero and shakes on a hit. |
| 11 | **Per-sound control**: a handle to stop one sound, pitch per play, looping effects, music crossfade. | polish | S | The shooter's engine loop stops when the ship is destroyed. |
| 12 | **Strings beyond interpolation**: compare, length, concatenation; a string table for localisation. | menus, dialogue | S–M | The puzzle's menu text comes from a string table. |
| 13 | **Performance evidence at game entity counts**: a benchmark workload with hundreds of sprites, tag queries and spawn and destroy churn, plus frame-time evidence on NVIDIA, Intel and Apple hardware (`evidence/small-games/`). | confidence for shooters and bullet hells | M | Numbers recorded; regressions gated in CI where a GPU runner exists. |

## Constraints carried over from the hardening PR

- **AI context budget.** The cold-start AI context budget is 30 000 bytes (decision 0172), with about 1.7 kB of room left. Every new builtin costs context, so items 1–12 must fit by folding and by grouping them into families, or the decision must be revisited with numbers. Re-run the AI benchmark after this PR; results from before #5 are not comparable.
- **Polled input.** Keys and buttons that are polled must keep blocking browser defaults (decision 0176). New input sources follow the same rule.
- **What runs while paused.** `ui(dt)` (decision 0175) is the only program code that runs while the game is paused. New UI features, such as anchored labels (item 3), must work from `ui`.
- **Scene-change safety.** A new runtime system must follow the scene-change rules of decision 0176: its own hooks for a scene being prepared, nothing left pointing at the old world, and a clean dispose on swap and hot reload.
- **Size budgets.** Every example has a size budget (`budgets/small-games.json`), and a new example needs one.
