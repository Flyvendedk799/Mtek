// Model of interaction-04: the Beacon is idle (#3a3a3a), running (#ffb000) or done (#22c55e). Space starts
// it when idle (it then runs for 1.5 s of summed frame durations), does nothing while it runs and sets it
// idle when it is done. Written from the task prompt only.
//
// The prompt does not say whether the frame that applies the press already counts its own duration, so the
// model is run in both readings and every checkpoint of every fixture must give the same state in both
// (checkpoints are at least two frames away from the 1.5 s threshold on either side).
import { DT16, Fixture, rect, writeFixtures } from "./lib.mjs";

const BG = "#202020";
const COLORS = { idle: "#3a3a3a", running: "#ffb000", done: "#22c55e" };
const RUN_SECONDS = 1.5;

class Model {
  /** @param {boolean} countsPressFrame whether the press frame's own duration is part of the run */
  constructor(countsPressFrame) {
    this.countsPressFrame = countsPressFrame;
    this.phase = "idle";
    this.elapsed = 0;
    this.queue = [];
  }
  press(key) {
    this.queue.push(key);
  }
  frame(dt) {
    for (const key of this.queue.splice(0)) {
      if (key !== "Space") continue;
      if (this.phase === "idle") {
        this.phase = "running";
        this.elapsed = this.countsPressFrame ? 0 : -dt;
      } else if (this.phase === "done") {
        this.phase = "idle";
      }
    }
    if (this.phase === "running") {
      this.elapsed += dt;
      if (this.elapsed >= RUN_SECONDS) this.phase = "done";
    }
  }
}

const HEADER = [
  "Camera: orthographic, height 12.8, at (0, 0, 10) looking at the origin: 10 pixels per world unit,",
  "pixel x = 64 + 10 x, pixel y = 64 - 10 y. The Beacon is a 4 x 4 block at the origin (pixels 44..83 in x",
  "and y). idle #3a3a3a, running #ffb000, done #22c55e, background #202020.",
  "Frames last 1/16 s (0.0625, exactly representable, so every sum of frames is exact; it is below the",
  "runtime's 0.1 s frame-delta clamp). A run lasts 1.5 s = 24 frames; n counts the frames since (and including)",
  "the one that applies the press, so the run ends at frame n = 24 or n = 25 depending on whether that frame's",
  "own duration counts. Checkpoints are only at n <= 21 (still running) and n >= 27 (done).",
  "Every expected colour below was computed by evidence/M6/benchmark-interaction/oracle/interaction-04.mjs",
  "from the task description, not from a run of either reference solution.",
];

const POINTS = [[64, 64], [44, 44], [83, 83], [43, 64], [84, 64], [64, 43], [64, 84]];

/** Runs a script of ["press"|"release"|"step"|"check", ...] on two model readings and writes the fixture. */
function build(name, extra, script) {
  const fx = new Fixture(name, [...HEADER, ...extra]);
  const models = [new Model(true), new Model(false)];
  for (const item of script) {
    const [kind, arg, note] = item;
    if (kind === "step") {
      fx.step(arg, DT16);
      for (const m of models) for (let i = 0; i < arg; i += 1) m.frame(DT16);
    } else if (kind === "press") {
      fx.press(arg);
      for (const m of models) m.press(arg);
    } else if (kind === "release") {
      fx.release(arg);
    } else if (kind === "check") {
      const [a, b] = models;
      if (a.phase !== b.phase) throw new Error(`${name}: the two readings differ at "${arg}": ${a.phase} / ${b.phase}`);
      fx.note(`${arg}: ${a.phase}`);
      fx.expectAll([rect(COLORS[a.phase], 0, 0, 4, 4)], BG, POINTS);
    } else if (kind === "note") {
      fx.note(arg);
    }
  }
  return fx;
}

const tap = (key) => [["press", key], ["step", 1], ["release", key]];

writeFixtures("interaction-04", {
  "idle-without-input": build("the beacon stays idle without a key press", ["Retention check: the starter's behaviour."], [
    ["step", 2],
    ["check", "after 2 frames"],
    ["step", 90],
    ["check", "after 90 more frames (5.6 s)"],
  ]),
  "runs-for-one-and-a-half-seconds": build("Space starts a run that turns the beacon done after 1.5 s", [], [
    ["step", 2],
    ["check", "idle at the start"],
    ...tap("Space"),
    ["check", "n = 1"],
    ["step", 19],
    ["check", "n = 20 (1.25 s)"],
    ["step", 1],
    ["check", "n = 21"],
    ["step", 6],
    ["check", "n = 27"],
    ["step", 60],
    ["check", "n = 87: done stays done"],
  ]),
  "space-while-running-is-ignored": build("Space while running does nothing and does not restart the run", [], [
    ["step", 2],
    ...tap("Space"),
    ["step", 11],
    ["check", "n = 12: running"],
    ...tap("Space"),
    ["step", 1],
    ["check", "n = 14, after a second press: still running"],
    ["step", 6],
    ["check", "n = 20: running"],
    ["step", 8],
    ["check", "n = 28: done (a restarted run would still be running until n = 37 or more)"],
  ]),
  "done-returns-to-idle-and-a-new-run-starts-from-zero": build("Space when done returns to idle; the next run counts the full 1.5 s", [], [
    ["step", 2],
    ...tap("Space"),
    ["step", 29],
    ["check", "n = 30: done"],
    ...tap("Space"),
    ["check", "Space when done: idle at once"],
    ["step", 5],
    ["check", "still idle"],
    ...tap("Space"),
    ["step", 1],
    ["check", "second run, n = 2: running"],
    ["step", 8],
    ["check", "second run, n = 10: running (a stale timer would have finished already)"],
    ["step", 17],
    ["check", "second run, n = 27: done"],
    ...tap("Space"),
    ["check", "idle again"],
  ]),
});
