# 0176. Game runtime hardening: scene starts, input, audio and touch

- Status: Accepted
- Date: 2026-10-23
- Supersedes: nothing. Refines 0141 (scenes), 0130 (audio), 0134 (HUD) and the input rules of `spec/scenes.md` §7.

## Context

The game audit of 2026-10-23 (`docs/audits/2026-10-23-game-audit.md`, findings G2 to G10) found places where the small-game runtime acts on the wrong scene, drops an input, or does work per frame that it need not. Most are plain bugs; the following parts change what the spec says, so they are recorded here.

## Decision

1. **A scene that is being prepared has its own game hooks and random stream** (`go_to`, `reset()`; G4). Its `init` runs in the background while the old scene keeps running, so:
   - `pause()`, `resume()` and `paused()` seen by the new scene's `init` concern the new scene. A pause it asks for is applied when it becomes the live scene (a new scene otherwise starts with the game running); the scene that still runs is not paused.
   - `save()`, `load()` and `clear_saved()` read and write the **new** scene's state.
   - `go_to` and `reset()` are ignored: a scene change is pending already.
   - `random()` and the helpers built on it draw from a generator of the new scene, seeded by **one** draw of the old scene's stream made at the moment `go_to` or `reset()` was called. The numbers the new scene draws therefore do not depend on how long the preparation takes or on the frames the old scene runs meanwhile. The new scene keeps that generator for its whole life.
   A hot-reload candidate keeps using the running scene's hooks and stream; its `init` is a migration, not a scene start.
2. **The listener of positional sound is the camera of the scene that runs** (G5). `play_at` pans against the active camera at the moment of the call, also after `go_to` and `reset()`; the runtime keeps no reference to a world it has replaced.
3. **`play_music` before the sound has decoded** (G6). The track is remembered, as before the unlock, and starts when the decode finishes (if the audio is unlocked by then). A sound that a hot reload adds and the browser cannot decode is `W8202` at the reload, like one that fails at mount.
4. **Audio unlock** (G2). The first `pointerdown`, `mousedown` or `touchend` anywhere in the document, or `keydown`, unlocks audio, in capturing listeners. A click on a HUD button, which stops the event before it reaches the canvas, unlocks too. A hot reload that gives a program without sounds its first one starts listening for the gesture.
5. **Audio and the host pause** (audit m11). The host's pause (`app.pause()`, and the pause of a hidden page) suspends the audio context, and `app.resume()` resumes it. The program's own `pause()` (0143) leaves sound to the program: music goes on, and `stop_music()` is the way to stop it.
6. **Keys whose browser default is suppressed** (G7). Besides the keys a `key_down` or `key_up` handler names, the keys the program asks about with `is_key_down`, `key_pressed` or `key_released` have their default action suppressed (the arrow keys and space do not scroll the page around the game). The runtime learns the polled keys at run time, from the calls, so a key computed at run time counts as soon as the program has asked about it once. The set of handler keys is rebuilt, and the polled keys are forgotten, when a scene starts (`go_to`, `reset()`), and the handler keys are rebuilt after a hot reload.
7. **Touch** (G8). The runtime sets `touch-action: none` and `user-select: none` on the canvas, and the CSS of a game package says the same, so a drag reaches the game instead of panning, zooming or selecting. Pointer events are tracked by `pointerId`: the pointer that pressed owns the pointer state until it is released or cancelled, and the release or cancellation of another pointer (a second finger) leaves it alone. A second finger is still not a pointer of the program (multi-touch is not part of this extension).
8. **Scene change details** (G9).
   - A `mat4` in a `shared state` carries over as a matrix.
   - A HUD button click that no call claimed before the scene change is dropped at the change, so a button of the new scene with the same label is not pressed by it.
   - Diagnostics of the HUD (`W8203`), the audio (`W8201`, `W8202`) and fonts (`W8204`) resolve their source span against the manifest of the scene that runs, and a font is looked up in that scene's assets.
   - A stored value of a nested integer or enum type (`array<i32, 3>`, a struct field of type `i32`) is checked at every depth (`W5402` when it does not fit).
   - `easing.*` of `+inf` is 1 and of `-inf` is 0; only NaN counts as 0 (`spec/tweens.md` §3).
9. **A failed scene change never wedges the request** (G3). When the new scene's physics world cannot be made at the swap, `E5401` is reported (the physics failure is a note) and the current scene keeps running; later `go_to` and `reset()` calls are taken as usual.
10. **Per-frame cost** (G10). Settings are compared with the last written values and written only when they changed, without building JSON in a quiet frame; the timer list is not looked at before its earliest due time; tag queries and `has_tag` read the entity table without copying it; the pixel font's SVG is built once per text and colour.

## Alternatives considered

- **Queue the old scene's game calls made by the new scene's `init`** and replay them at the swap. Rejected: `load()` must answer at once, and the calls make no sense against the scene that runs.
- **Read the polled keys from the manifest.** The compiler cannot see a key computed at run time, and the manifest would need a new table for a rule that costs one `Set` at run time.
- **Make a game pause stop the music.** A pause menu usually wants the music to go on, and `stop_music()` is one call; the opposite choice would need a way to opt out.

## Verification

`packages/runtime-web/src/host/game.test.ts` (preparing hooks and random stream, physics failure, mat4 carry, HUD click, unlock from a document press, listener after `go_to`, host pause and sound, handler and polled keys, hot reload), `audio/audio.test.ts` (music before decode, `W8202` of a reload, first sound, suspension, span), `input/dom.test.ts` (touch CSS, pointer ids, polled keys), `hud/hud.test.ts` and `hud/fonts.test.ts`, `scene/saves.test.ts`, `scene/timers.test.ts`, `scene/tags.test.ts`, `math/ease.test.ts`, and the `package/html.rs` test for the game page CSS.
