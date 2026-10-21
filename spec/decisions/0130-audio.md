# 0130. Audio: sound assets, playback intrinsics and the autoplay unlock

- Status: Accepted
- Date: 2026-10-21
- Supersedes: "audio" in `spec/scenes.md` section 14 ("Not in v0.1").
- Specification: `spec/audio.md`.

## Context

Small games need hit and score sounds, looping music and a mute switch. Mtek treats files as compile-time dependencies (decision 0015), and browsers block audio until a user gesture.

## Decision

1. **Sounds are assets.** `asset.sound(path) -> sound` follows the rules of `asset.texture`: a string literal, a local path, validated while the program is checked. The compiler sniffs WAV, Ogg (Vorbis, Opus) and MP3 headers without decoding (`E7101` for a wrong format or an extension that disagrees with the content, `E7102` for a broken header). Decoding is left to the browser, because a decoder in the compiler would be a large dependency for little gain; a file the browser rejects is a warning (`W8202`), not a stopped game.
2. **A new CPU-only type `sound`.** It lowers to its project path, a JavaScript string, and the manifest's `audio` asset entries map the path to the packaged url. The type lets the checker reject `play(42)` and keeps sounds out of GPU code without a new rule.
3. **Global intrinsics**, as the plan names them: `play`, `play_at`, `play_music`, `stop_music`, `set_volume`, `set_muted` (handlers only) and `is_muted`. They reach `ctx.audio` with the call's span id first. One music track at a time keeps the model small; several loops can be had with long `play` calls later if needed.
4. **Ranges.** Volume `0..4`, pitch `0.0625..16`: wide enough for games, narrow enough to catch a percent given as a fraction (`play(s, 50.0)`). Constants are checked (`E5501`); run-time values are clamped with `W8201`, the same split as scale (`E5090`/`E8090`), but a warning because a too-loud sound is not worth a wrong frame.
5. **Positional sound** is computed in the camera's frame at the moment of the call and given to a `PannerNode` (`equalpower`, inverse distance, reference 1 m). The listener API is not used, because its `AudioParam` form is missing in some browsers; the cost is that a sound does not move after it starts, which is fine for short effects.
6. **Autoplay.** The runtime unlocks audio on the first `pointerdown`/`mousedown`/`touchend` on the canvas or `keydown` on the document, with capturing listeners registered through the resource registry (so `dispose()` removes them). Before that, effects are dropped and music is remembered. Decoding uses an `OfflineAudioContext` so it can finish before the gesture without the "AudioContext was not allowed to start" warning.
7. **Missing files fail the mount** (`E7030`) like every other asset: a wrong path is a build problem, not something to hide.

## Consequences

- The `audio` asset kind is added to `spec/manifest.schema.json` and to the runtime's manifest types; older runtimes reject a manifest with it (the schema is closed), which is the intended "incompatible program" behaviour.
- `ctx.audio` is a new context member (`CONTEXT_MEMBERS`).
- New codes: `E7101`, `E7102`, `E5501`, `W8201`, `W8202` (`/workspace/mtek-codey2-codes.md` lists them for renumbering).
- Not done: streaming of long music (files are decoded whole), audio sprites, per-entity attached emitters that move with the entity, a HUD mute button (the HUD is phase 1, owned elsewhere; the example uses a click region and a key).

## Verification

See `spec/audio.md` section 7 and `TESTING-codey2.md`.
