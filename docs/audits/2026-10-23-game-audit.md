# Game support audit, 2026-10-23

Baseline: `main` @ `d28886b8` (merge of PR #4, `feat/sgs-codey2`: small-game support, 724 files, +32,192/−3,444 since `4e7ff0e3`). PR #4 was merged after only cheap checks (`TESTING-codey2.md` §0: no browser, GPU or full test runs). This audit runs the full gate once and reviews the game features in four areas: compiler, runtime, rendering, and shipping/examples/gaps.

Method: a clean clone of `d28886b8`, gate run on Windows 11 with an RX 7900 XTX, Node 24, Rust 1.99.0. The four code reviews were read-only. Two reviewers found the orthographic-sort finding (R1) and the named-camera finding (C1) independently, and both were re-checked by hand. Other findings marked *suspected* are not confirmed.

## 1. Gate result: `main` is red

| Step | Result | Cause |
| --- | --- | --- |
| `npm ci`, `npm run build` | pass | |
| `npm run check` | **fail** | 7 eslint errors in runtime-web: `host/app.ts:77,661`, `render/renderer.ts:968`, `scene/world.ts:488,1306-1308` (unnecessary assertions, unsafe `any`) |
| `cargo test --workspace` (no fail-fast) | **fail, 5 tests** | `tests/context_cold_start.rs`: the cold-start AI context goes over its budget. A stub scene drops `records`, `body`, `events`, `builtins`; the empty project is truncated; 112 duplicate function names; goldens are stale. Everything else passes. |
| `npm run test:unit` | **fail, 2 tests** | `assets-profile.test.ts`: the `e7019_animation` fail fixture is gone (animation is now partly supported). `release-docs live.test.ts`: README example-count mutation (`ten examples`) no longer matches. |
| `check:coverage`, `check:release` | pass | |
| `check:budgets` | **fail** | `pulse-cube` 634,482 B over its 630,000 B budget, and `modular-scene` 652,847 B over its 650,000 B budget (the runtime grew about 13 % after the budgets were set). |
| Browser suite, `MTEK_REQUIRE_GPU=1` | **cannot start** | Global setup fails: `tests/browser/fixtures/m5/physics_{callbacks,combos}` declare `state tag`, which now clashes with the new `Entity.tag` field (E2002). The Playwright version was also bumped, so `npx playwright install chromium` is needed. |
| Browser suite with those two fixtures renamed (clone only) | hardware 257/1, software 242/1 (+15 skipped), benchmarks 104/0 | The one failure is caused by the rename itself: the spec reads the state by the name `tag`. Otherwise green. |

Notes:
- **Source compatibility.** Adding `Entity.tag` breaks any existing program that has a state, param or field named `tag`. That is acceptable before 1.0, but it should be recorded in the release notes.
- **No GPU coverage of the new examples.** The green GPU suite does not cover the new game features. `specs/m6/mtek-test.spec.ts` runs fixtures only for the four older examples. `small-game`, `sprite-pop`, `lane-runner`, `stage-show`, `hud-score` and `arcade-audio` never run in the browser in CI, and their fixtures are thin (title screen only, `t += dt`).
- **AI benchmark impact.** The cold-start context failure directly affects the AI benchmark, Mtek's main claim. The PR3 benchmark run (2026-10-20, uncommitted results) predates this merge.

## 2. Findings

Severity: **B** = blocker (breaks a common game), **M** = major, **m** = minor.

### Rendering

| # | Sev | Where | Finding | Fix |
| --- | --- | --- | --- | --- |
| R1 | **B** | `render/renderer.ts:107-119` | Translucent sort key is clip-space `w`. Under `orthographic()` (`math/mat4.ts:190`) `w ≡ 1`, so every sprite ties and layers by draw-list order (pipeline key, material, mesh), not `z`. This breaks 2D layering, contradicts `spec/materials.md:205`, and the unit test covers only perspective. | Sort by view-space depth; add an orthographic test; consider an explicit `layer`. |
| R2 | M | `renderer.ts:559-560, 927` | Particles are drawn after the translucent pass with the opaque pipeline and write depth: they cover sprites and glass, and a Sprite-material emitter shows solid quads. | Draw them between opaque and translucent; use the blended variant without depth write when the material is translucent. |
| R3 | M | `renderer.ts:119, 554` | `orderTranslucent` returns a new array every frame, so one visible translucent draw makes the renderer rebatch and re-upload every frame (every 2D scene). Translucent draws are never instanced (`:515`), so N sprites cost N draws. | Use a persistent sort buffer with a change check; add an opaque/alpha-cutout instanced sprite path. |
| R4 | M | `renderer.ts:~935-967` | The particle GPU buffer is recreated almost every frame while the count ramps up. | Allocate the cap once, or grow geometrically. |
| R5 | M | `scene/world.ts` `writeChannel`, `assets/clips.rs` | A clip's TRS overwrites the entity transform. Every spawned prefab with a translation clip appears at the glTF node position, and parent nodes are ignored. | Apply base·clip. |
| R6 | M | `renderer.ts:190-205` | The blended pipeline is created lazily, so sprites and alpha < 1 instances render opaque and write depth for their first frames. | Create it at `startScene` for materials known to blend. |
| R7 | m | `stdlib/std/materials.mtek` (Sprite) | `columns`/`rows` are not clamped or floored at run time, so 0 divides by zero (decision 0170 §4 promises a clamp). | |
| R8 | m | `renderer.ts:987`, `startup.ts:144` | The 256-particle cap truncates silently; with instancing off, particles draw nothing; particles share the gameplay `random()` stream. | |
| R9 | m | `assets/glb.rs`, `:2083` | One cubic-spline/morph animation anywhere fails the whole file (E7019). Normalized BYTE/SHORT rotations are rejected (E7025). | |
| R10 | m | `world.ts:1174` | `setCameraOn` with an unknown name silently writes the active camera. | |

### Compiler and language

| # | Sev | Where | Finding | Fix |
| --- | --- | --- | --- | --- |
| C1 | **M** | `emit_js/cpu.rs:798, 825, 1214` | `Wide.position = v` / reads of a non-active camera emit `ctx.cam.*` / `ctx.setCamera(field, v)`, so they move or read the **active** camera. Bindings were fixed; imperative code was not. | Carry the camera name; emit `ctx.setCameraOn(name, …)` / `ctx.camera(name)`; add a two-camera fixture. |
| C2 | M | `ir/lower.rs:106`, `project/host_inputs.rs:24` | An enum state can be a host input with the plain `u32` codec. An out-of-range value runs the last `match` arm and makes every `==` false. | E9020 for enum host targets, or a range-checked codec. |
| C3 | M | `types/prefab.rs:712`, `check.rs:2669` | A pure `fn` can read `entity_ref` fields; called from `bind`, this bypasses E5005 and dependency ordering, so the E5075 cycle check is blind. | Record `RefField` as an ambient CPU read; add an E5005 fixture. |
| C4 | M | `ir/model.rs:91`, `package/builder.rs:187-245` | Scenes in imported modules are packaged, but scene-name uniqueness and the saved/shared state checks run per module. Two scenes named `Level` silently overwrite each other's file, and saved-state types can disagree across modules. *Suspected reachable.* | Reject scenes outside the entry module, or run the checks over the whole program. |
| C5 | M | `scene/timers.ts` | `every(…)` inside `update` registers a new repeating timer every frame, with no cap, no cancel and no diagnostic. | A compile-time warning for `after`/`every` in `update`/`fixed_update`/bindings, plus a runtime cap with a W-code. |
| C6 | m | various | E3203 says `Key` is "not an enum". Constant folding visits dead `match` arms. Hot reload re-maps reordered enum variants silently. Decisions 0149 and 0143 promise wider usability than the checker allows. `key_pressed` edges are seen 0..n times in `fixed_update`. Negative fixtures missing for E5005/E4002/E5080 cases. Duplicated checker code in `game.rs:32-162` and `check.rs:1954-1972`. | |

### Runtime game systems

| # | Sev | Where | Finding | Fix |
| --- | --- | --- | --- | --- |
| G1 | **B** | `hud/hud.ts:207, 290`, `host/app.ts:1141`, scheduler | `pause()` empties the HUD: `beginFrame` clears it, but `update` (where the HUD is drawn) does not run while paused. `hud.button` needs a redraw in the next frame to report a click, so a "Resume"/"Restart" button cannot work. This contradicts decision 0143. | A UI phase that runs while paused, or keep the last list while paused. |
| G2 | M | `host/mount.ts:486` | Audio unlock listeners are only on the canvas and document `keydown`. HUD buttons sit in a sibling layer and `stopPropagation`, so a "click Play" title screen leaves the game silent. | A capturing `pointerdown` on the document or the HUD layer. |
| G3 | M | `host/app.ts:1219-1232` | A physics failure inside a `go_to` swap returns before clearing `sceneRequest`. Every later `go_to`/`reset()` is then silently ignored. | Clear it in the catch and report E5401. |
| G4 | M | `host/app.ts:310-321`, `render/startup.ts:124` | The next scene's `init` runs in the background against the **old** scene's game hooks. `load()` writes into the old scene, `save()` saves the old state, and `pause()` freezes the old scene. Seeded randomness is not reproducible across `go_to`. | Give the preparing world its own hooks, or queue the calls. |
| G5 | M | `host/mount.ts:478`, `audio/audio.ts` | The positional-audio listener keeps the first world for good: `play_at` pans against the old camera after `go_to`/`reset`, and the old `World` is never freed. | The listener follows `this.deps.scene.world`. |
| G6 | M | `audio/audio.ts:295-311, 354` | `play_music` on a sound that is still decoding is silently lost and never retried. `adopt` decode failures are swallowed. | Start the music when decoding resolves; report W8202. |
| G7 | M | `host/app.ts:259-265, 1272`, `input/dom.ts:55,61` | `handledKeys` is computed once from the entry scene and never refreshed on `go_to`. Polled keys never block the browser default, so arrow keys scroll the page around an itch.io iframe. | Rebuild the set per scene; include polled `Key.*` constants. |
| G8 | M | `package/html.rs:177`, `input/dom.ts:76-96` | No `touch-action:none`: on mobile, a drag pans or zooms the page and cancels the pointer. Only the primary pointer is tracked. | Set the CSS at mount; track pointers by id. |
| G9 | m | `host/app.ts:83`, `math/ease.ts:10`, `scene/saves.ts`, `hud.ts` | Shared `mat4` state becomes a plain object when carried. `ease(+∞)` returns 0. Saved structs are integer-checked at the top level only. A click from the old scene's button can be claimed by a same-labelled button after the swap. HUD/audio diagnostics resolve against the entry manifest after `go_to`. | |
| G10 | m | `app.ts:1188`, `timers.ts:93`, `world.ts:495`, `hud.ts:425` | Per-frame allocations: settings autosave JSON every frame, a timer list filter, the tag query maps (and `has_tag` is O(n)), pixel-font SVG rebuilds. | |
| G11 | m | — | No unit tests for timers (`scene/timers.test.ts` missing), the HUD while paused, music before decode, or the listener after `go_to`. | |

### Shipping, examples, docs

| # | Sev | Where | Finding |
| --- | --- | --- | --- |
| S1 | M | `.github/workflows/ci.yml` | CI never runs `check:prebuilt` or the budgets; `ci/small-games-ci.patch` (applies cleanly) adds budgets only. A runtime change without a refreshed `crates/mtek-cli/prebuilt` passes CI and ships stale to fresh clones. The E9030 `not(mtek_runtime_embedded)` tests no longer run anywhere. `tests/prebuilt.rs:15` skips `runtime.min.js`. |
| S2 | M | `budgets/small-games.json` | The four game examples (small-game, sprite-pop, lane-runner, stage-show) have no budget, and the frame harness skips them too. `README.md:67` claims "every example". |
| S3 | M | `scripts/record-frame-evidence.mjs:84, 89`, `game-budgets.mjs:43` | A missing `isFallbackAdapter` counts as hardware; a run whose game failed to mount (`failure` set) still passes; headless by default. |
| S4 | M | `docs/` | No user doc covers saved/setting state, timers, `mtek build --release`/`--itch` or `--template game`; there is no "make a game" guide. `release-notes-v0.1.md:48` still says scene switching and transparency are refused. `TESTING-codey2.md` §9 says features are "not done" that later commits completed. `lane-runner/README.md:15` says "no text yet". |
| S5 | m | `spec/decisions/README.md:161, 179-181` | Ghost rows 0160–0162 (renumbered to 0130–0132). Row 0170 is out of order. 0157–0169 unexplained. Stale refs in `.gitattributes:10` and `mount.ts:393`. |
| S6 | m | `tools/coverage-matrix/src/projects.ts:26` | hud-score, arcade-audio, sprite-pop and small-game are not listed, so HUD, sound and Sprite rows show no example. |
| S7 | m | `crates/mtek-cli/templates/game.mtek` | A byte copy of `examples/small-game/src/main.mtek` with no equality test. No test builds a scaffolded game. |
| S8 | m | save key (decision 0145) | `mtek.save.<project name>`: itch.io serves every HTML5 game from one origin, so two games named `my-game` overwrite each other's saves. |
| S9 | m | packaging | `dist-itch.zip` is not gitignored. A stale zip survives a later failing build. `--out ..` puts the zip inside the folder. No `*.wav binary` in `.gitattributes`. |

What the examples are:
- **lane-runner** is the only real game loop (title, run, lose, score, save).
- **small-game** is a toy with no lose condition.
- **hud-score** is a timed clicker.
- **sprite-pop**, **stage-show** and **arcade-audio** are feature demos; sprite-pop never uses a sheet image.

## 3. Gaps that block typical small games

Ranked by how many genres each blocks. "Exists" means it was checked to exist: keyboard edges, pointer, `collision_enter`/`exit`, tags and tag queries, timers, saves, scenes, easing, sprites, particles, camera switching, audio, HUD text, rects and buttons.

| # | Gap | Blocks | Size |
| --- | --- | --- | --- |
| 1 | Correct 2D layering plus batched/instanced sprites (R1, R3) | every 2D game | M |
| 2 | UI that works while paused (G1); pause menus, game-over overlays | all genres | S |
| 3 | Cheap overlap/trigger tests without Rapier (`overlaps`, `first_overlapping(tag)`). Collisions today need physics.js (+4.4 MB). | arcade, shooter, platformer | M |
| 4 | Cross-entity communication: writes or state reads through `entity_ref`, or messages. A bullet cannot damage an enemy. | any game with HP or AI | L |
| 5 | Screen/world mapping: viewport size on the CPU, `screen_to_world`, `world_to_screen`, pick/raycast from the pointer | mouse aim, click-to-move, puzzles | S–M |
| 6 | Touch and mobile (G8), multi-touch, on-screen controls | itch.io mobile | S / M |
| 7 | Gamepad and input-action mapping | platformer, action | M |
| 8 | Sprite flip, run-time sheet swap (E5073), animation-state helper | 2D characters | S–M |
| 9 | Timer handles and cancel; growable collections | most game logic | M |
| 10 | Particles: bursts, colour/size/alpha over life, additive blending, no global 256 cap | effects in all genres | M |
| 11 | Tilemaps and level data assets | platformer, puzzle, top-down | L |
| 12 | Camera helpers: follow, shake, smoothing, `look_at`, `move_toward` | platformer, top-down | S |
| 13 | Per-sound control (stop, pitch, loop SFX), music follows pause and hidden tabs | polish | S |
| 14 | Strings beyond interpolation (compare, length, concat); localisation | menus, dialogue | S–M |
| 15 | Performance evidence at game entity counts: hundreds of sprites, tag queries, spawn churn, any real-GPU frame-time record | confidence | M |

## 4. Recommended order

1. **Make `main` green.** Fix the lint errors, rename the m5 fixtures' state, re-baseline the unit tests, and re-baseline the budgets and add the four games. Fix the cold-start context budget for real; do not just re-bless it, because it feeds the AI benchmark. Wire `check:prebuilt` and the budgets into CI, and run the new examples' fixtures in the browser suite.
2. **Fix the blocker and major bugs:**
   - R1 2D layering, G1 HUD while paused, C1 named cameras.
   - G2–G7 scene/audio/input correctness.
   - R2–R6 particle/sprite pipeline correctness and per-frame cost.
   - C2–C5 checker holes.
3. **Close the core gaps** (the goal of the next PR, see `docs/audits/2026-10-23-game-next-pr.md`) 3 (overlap), 5 (screen/world), 4 (entity communication), 6–7 (touch, gamepad), then 8–12.
4. **Ship one real game per genre** (2D arcade shooter, platformer, puzzle) with full fixtures, as the acceptance test for each gap, plus a "make a game" guide.
