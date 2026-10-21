# Lane Runner

A small game in three scenes that uses the game-flow features of decisions 0140 to 0144.

| Scene | What happens | Feature |
|---|---|---|
| `Title` | The logo turns and the prompt blinks. Enter starts a run. Backspace clears the best score. | `every`, `go_to`, `reset()` (shared state included) |
| `Run` | ArrowLeft and ArrowRight change lanes. Rocks fall; a rock in your lane at your height ends the run. Every second survived is a point. Escape pauses and resumes. R restarts the run and keeps the best score. | `every`, `after`, bounded `while`, `pause()`/`resume()`/`paused()`, `go_to(Run)` |
| `GameOver` | Shows the score (red bar) and the best score (green bar) for three seconds, then goes back to the title. Enter starts a new run. | `after`, `go_to` |

`score` and `best` are `shared state` in all three scenes. A scene change copies them into the next scene. Everything else starts afresh: rocks, lanes, timers and the pause.

There is no text yet, so the scores are shown as bars: 0.2 m per point.

## Run

```bash
mtek check
mtek build      # app.js (Title), app.Run.js, app.GameOver.js and their manifests
mtek dev
mtek test       # tests/title-blink.test.toml; needs a browser with WebGPU
```

## Things to try

- Press Escape during a run. Rocks and the score stop, and ArrowLeft/ArrowRight are ignored (the handlers check `paused()`). Escape again resumes. A timer never counts paused time.
- After 20 s of game time the rocks fall faster (`after(20.0)`). Pausing pushes that moment back.
- Press R mid-run. The run restarts, and `best` survives because `go_to(Run)` carries shared state.
- Press Backspace on the title. `reset()` restarts the title scene, and `best` goes back to 0.
