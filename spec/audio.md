# Audio: Sound Assets, Playback, Volume and Browser Autoplay (v0.1 extension)

- Repository path: `spec/audio.md`
- Status: Normative for the small-game extension (decision 0160). Lifts "audio" from `spec/scenes.md` section 14.
- Depends on: `spec/assets.md` (declarations, packaging, loading), `spec/stdlib.md` section 6 (the intrinsics), `spec/runtime-abi.md` (the `ctx` contract).

---

## 1. Model

A sound is a **compile-time asset** like an image: `asset.sound(path)` names a local file, the compiler opens and validates it while it checks the program, and `mtek build` copies it into `dist/assets/`. Sounds are played from lifecycle functions and handlers with CPU intrinsics. The runtime plays them with Web Audio. Audio never stops a program: what cannot be played is a warning, and playing it does nothing.

## 2. Declaring sounds

```mtek
const HIT = asset.sound("sounds/hit.wav");
const MUSIC = asset.sound("sounds/theme.ogg");
```

- `asset.sound(path: string) -> sound`. The argument must be a string literal (`E7022`); path rules are those of `spec/assets.md` section 2 (`E7020`, `E7021`, `E7023`, `E7901`) and the size limit is `[assets] max_file_bytes` (`E7002`).
- Formats: **WAV** (RIFF/WAVE; PCM or IEEE float, 8, 16, 24 or 32-bit samples; `WAVE_FORMAT_EXTENSIBLE` accepted), **Ogg** (Vorbis or Opus in the first page) and **MP3** (an optional ID3v2 tag followed by an MPEG audio frame within 4 KiB). The extension (`.wav`/`.wave`, `.ogg`/`.oga`/`.opus`, `.mp3`, case-insensitive) must name one of them and the content must agree with it; otherwise `E7101`.
- A header that is truncated or inconsistent (a `fmt ` or `data` chunk missing or past the end of the file, zero channels, sample rate or block size; an Ogg page shorter than its header; an ID3 tag that ends past the file; no MPEG frame) is `E7102`.
- Only the header is inspected. Decoding is the browser's (section 5).
- `sound` is a CPU-only type (`E4011` in GPU code); a value of it is usually a `const`, but a `state`, a local or a function parameter of type `sound` is allowed. It cannot be a host input (`E9020`).

## 3. Playing sounds

| Call | Effect |
|---|---|
| `play(s)`, `play(s, volume)`, `play(s, volume, pitch)` | plays `s` once |
| `play_at(s, position)`, `play_at(s, position, volume)` | plays `s` once from a world position: inverse-distance attenuation with a reference distance of 1 m, panned left/right relative to the active camera at the moment of the call |
| `play_music(s)`, `play_music(s, volume)` | starts `s` as looping music, replacing the music that plays (one music track at a time) |
| `stop_music()` | stops the music; a no-op when none plays |
| `set_volume(v)` | the global volume of every sound and the music |
| `set_muted(m)` | mutes or unmutes all audio; the global volume is kept |
| `is_muted() -> bool` | whether audio is muted |

- `volume` is a linear gain in `0.0..=4.0` (default `1.0`); `pitch` is a playback rate in `0.0625..=16.0` (default `1.0`; `2.0` is an octave higher and twice as fast).
- Every call except `is_muted` is **handlers only**: allowed in `update`, `fixed_update` and `on` handlers, not in initialisers (`E5080`) or bindings (`E5005`).
- A constant volume or pitch outside its range is `E5501` at the argument. A run-time value outside the range, or one that is not finite, is clamped to the range (a non-finite value uses the default) with the warning `W8201` at the call.
- Muting and the global volume are settable from any handler, so they can be driven by `state`, by a key, by a click, and by a HUD button once the HUD lands (`on click` of the HUD layer, small-game plan phase 1).

## 4. Packaging

Every sound file that a module of the program declares is copied byte for byte to `dist/assets/<h16>.<ext>` (`h16` of `"sound\0"` followed by the bytes) and listed in the manifest's `assets` with `kind: "audio"`, `format`, `mime`, `source` (the project path, which is how generated code names the sound: `ctx.audio.play(spanId, "sounds/hit.wav", ..)`) and the declaring `span`. Unlike meshes and images, a declared sound is packaged even when no handler plays it: whether a handler runs is a run-time question. Sound bytes count against `max_total_bytes` (`E7026`) and are part of the build identity.

## 5. Loading and the browser autoplay policy

- Sound files are fetched and verified with the other assets (`spec/assets.md` section 5): a missing, changed or truncated file fails the mount with `E7030`, like an image.
- Decoding starts at mount with an `OfflineAudioContext`, which browsers allow without a user gesture. A file the browser cannot decode is the warning `W8202` once; playing it does nothing.
- **Autoplay.** Browsers keep audio suspended until the page receives a user gesture. The runtime creates (or resumes) its `AudioContext` on the **first `pointerdown`, `mousedown` or `touchend` on the canvas or `keydown` on the document**, in capturing listeners, so the gesture that triggers a handler also unlocks audio. Before that gesture `play` and `play_at` do nothing (they are not queued: a late hit sound is worse than none), and `play_music` remembers the track, which starts when audio unlocks. A game does not have to do anything for this; a page that wants sound from the very first frame should show a "click to start" screen.
- A browser without Web Audio plays nothing and reports nothing.
- `dispose()` stops every sound and closes the context. A hot reload keeps playing; sounds that the new program declares are decoded and become playable when their decode finishes.

## 6. Diagnostics

`E7101` unsupported audio file · `E7102` malformed audio file · `E5501` audio argument out of range · `W8201` audio value clamped (runtime) · `W8202` sound could not be decoded (runtime).

## 7. Tests

- Compiler: `crates/mtek-compiler/src/assets/audio.rs` (header sniffing), `tests/assets/pass/audio_sounds` (packaging, manifest schema, generated calls), `tests/assets/fail/e7101_unsupported_audio`, `tests/assets/fail/e7102_truncated_wav`, `tests/semantics/fail/e5501_audio_argument_out_of_range`.
- Runtime: `packages/runtime-web/src/audio/audio.test.ts` (unlock, remembered music, clamping, decode failure, mute and volume, positional placement) against a fake Web Audio.
- The WAV files are generated by `scripts/gen-sounds.mjs` (`--check` verifies them).
- Example: `examples/arcade-audio`. Hearing it is a manual check (`TESTING-codey2.md`).
- Not covered by an automated test: real browser decoding and audible output.

## 8. Not in this extension

No streaming (every sound is decoded whole at mount), no audio effects, filters or buses beyond the master gain, no per-sound handles (a playing one-shot cannot be stopped or changed), one music track at a time, no Doppler, and the positional listener is the active camera of the first mounted world (after a hot reload it is not re-attached until the page is reloaded).
