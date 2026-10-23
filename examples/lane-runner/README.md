# Lane Runner

A small game in three scenes that uses the game-flow features of decisions 0140 to 0144 and the saved state and settings of decisions 0145 and 0146.

| Scene | What happens | Feature |
|---|---|---|
| `Title` | The logo turns and the prompt blinks. Enter starts a run. ArrowLeft and ArrowRight choose the difficulty: Easy, Normal or Hard (the logo turns faster on a harder one). Backspace deletes the stored best score and difficulty and restarts the title. | `every`, `go_to`, `setting state`, `match`, `clear_saved()`, `reset()` |
| `Run` | ArrowLeft and ArrowRight change lanes. Rocks fall, faster on a harder difficulty. A rock in your lane at your height ends the run. Every second survived is a point. A new best score is saved. Escape pauses and resumes. R restarts the run and keeps the best score. | `every`, `after`, bounded `while`, `pause()`/`resume()`/`paused()`, `go_to(Run)`, `save()` |
| `GameOver` | Shows the score (red bar) and the best score (green bar) for three seconds, then goes back to the title. Enter starts a new run. | `after`, `go_to` |

`score` and `best` are `shared state` in all three scenes. A scene change copies them into the next scene. Everything else starts afresh: rocks, lanes, timers and the pause.

`best` is also `saved state`. When a run beats it, `save()` stores it in the browser's `localStorage`, under `mtek.save.lane-runner`. The next visit starts with it. `difficulty` is a `setting state`, stored as soon as it changes, without a `save()`. `GameOver` does not declare `difficulty`, so it leaves the stored value alone. A stored value is applied after `init`, so `Run` reads the difficulty in its first `update`.

The scores are shown as bars, 0.2 m per point, as this example was written before the HUD (decision 0134) existed; `hud.text("Best ${best}", ...)` would draw the numbers, as `examples/small-game` does.

## Run

```bash
mtek check
mtek build      # app.js (Title), app.Run.js, app.GameOver.js and their manifests
mtek dev
mtek test       # tests/title-blink.test.toml, tests/difficulty-setting.test.toml; needs a browser with WebGPU
```

## Things to try

- Press Escape during a run. Rocks and the score stop, and ArrowLeft/ArrowRight are ignored (the handlers check `paused()`). Escape again resumes. A timer never counts paused time.
- After 20 s of game time the rocks fall faster (`after(20.0)`). Pausing pushes that moment back.
- Press R mid-run. The run restarts, and `best` survives because `go_to(Run)` carries shared state.
- Set a best score, choose Hard, and reload the page. The title shows the stored best score, and the logo turns at the Hard speed.
- Press Backspace on the title. `clear_saved()` deletes what is stored, and `reset()` restarts the title scene, so `best` goes back to 0 and the difficulty to Normal.
- In DevTools, Application, Local Storage: the key `mtek.save.lane-runner` holds `{"format":1,"values":{"best":{"type":"i32","value":…},"difficulty":{"type":"enum(Easy|Normal|Hard)","value":…}}}`. Edit `best` to `"many"` and reload: the console shows `W5402`, and the best starts at 0.
