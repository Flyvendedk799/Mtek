// Model of interaction-11: the Ticker (1 x 1, red, centre y = 3) moves 0.1 unit (one pixel) to the right on every
// fixed tick; the Glider (1 x 1, cyan, centre y = -3) moves 6 units per second of program time. Both start with
// their centres at x = -5.5, so their left edges are at pixel 4. The frame clock of `spec/scenes.md` sections 10
// and 10.2 (counted delta <= 0.1 s, step 1/60 s, at most 4 ticks a frame, whole steps beyond that dropped, the
// fraction of a step kept) is FrameTime in lib.mjs. Written from the task prompt only.
//
// The Glider's edges fall between pixel boundaries (60 pixels per second of program time), so a probe is only
// placed where the pixel centre is at least 0.2 pixel from both edges; the model refuses a checkpoint where the
// left or the right edge is closer than that to a pixel centre.
import { DT60, FrameTime, Fixture, writeFixtures } from "./lib.mjs";

void DT60;

const BG = "#202020";
const TICKER = "#ef4444";
const GLIDER = "#38bdf8";
const MARGIN = 0.2;

/** y pixel ranges [y0, y1) of the two blocks (1 unit = 10 pixels; centres y = 3 and y = -3). */
const ROWS = { ticker: [29, 39], glider: [89, 99] };

const HEADER = [
  "Camera: orthographic, height 12.8, at (0, 0, 10) looking at the origin: 10 pixels per world unit,",
  "pixel x = 64 + 10 x, pixel y = 64 - 10 y. Ticker: 1 x 1 unit, #ef4444, pixels y 29..38; Glider: 1 x 1 unit,",
  "#38bdf8, pixels y 89..98; both start with the left edge at pixel x = 4 (centre x = -5.5). Background #202020.",
  "The Ticker's left edge is at pixel 4 + (number of ticks so far); the Glider's at 4 + 60 * (program time so far, the",
  "sum of the frame durations each counted at most 0.1 s). A tick is one whole 1/60 s of program time (at most 4 per",
  "frame, whole steps beyond the fourth dropped, the fraction of a step kept for the next frame).",
  "Frame lengths are 1/60 s and 1/30 s rounded up in the fourth digit (0.0167 and 0.0334) and a few others; none is",
  "within 0.001 step of a tick boundary on either value of the step (1/60 s as binary64 and as the manifest's",
  "binary32 print 0.016666668 s): the model runs both and refuses a frame where they differ.",
  "Every expected colour below was computed by evidence/M6/benchmark-input-hooks/oracle/interaction-11.mjs from the",
  "task description, not from a run of either reference solution.",
];

/** The colour of pixel (px, py) given the left edges (pixels, fractional) of the two blocks. */
function colorAt(tickerX0, gliderX0, px, py) {
  const covers = (x0, [y0, y1]) => px + 0.5 >= x0 && px + 0.5 < x0 + 10 && py >= y0 && py < y1;
  if (covers(tickerX0, ROWS.ticker)) return TICKER;
  if (covers(gliderX0, ROWS.glider)) return GLIDER;
  return BG;
}

function pointsFor(x0, [y0, y1]) {
  const left = Math.ceil(x0 - 0.5);
  const right = Math.ceil(x0 + 10 - 0.5) - 1;
  for (const edge of [x0, x0 + 10]) {
    const nearest = Math.round(edge - 0.5) + 0.5;
    if (Math.abs(edge - nearest) < MARGIN) throw new Error(`an edge at pixel ${String(edge)} is within ${String(MARGIN)} of a pixel centre`);
  }
  const mid = Math.floor((left + right) / 2);
  const ym = Math.floor((y0 + y1 - 1) / 2);
  return [[left, ym], [right, ym], [left, y0], [right, y1 - 1], [left - 1, ym], [right + 1, ym], [mid, y0 - 1], [mid, y1]];
}

class Model {
  time = new FrameTime();
  frame(dt) {
    return this.time.frame(dt);
  }
  get ticks() {
    return this.time.ticks;
  }
  get tickerX0() {
    return 4 + this.time.ticks;
  }
  get gliderX0() {
    return 4 + 60 * this.time.time;
  }
}

function probe(fx, model, text) {
  fx.note(`${text}: ${String(model.ticks)} ticks (Ticker at pixel ${String(model.tickerX0)}), Glider at pixel ${model.gliderX0.toFixed(3)}`);
  const points = [...pointsFor(model.tickerX0, ROWS.ticker), ...pointsFor(model.gliderX0, ROWS.glider), [2, 64], [125, 64]];
  for (const [px, py] of points) {
    if (px < 0 || px > 127) continue;
    fx.expectColor(px, py, colorAt(model.tickerX0, model.gliderX0, px, py));
  }
}

/** A script of ["step", frames, dt] and ["check", text] items. */
function build(name, extra, script) {
  const fx = new Fixture(name, [...HEADER, ...extra]);
  const model = new Model();
  for (const [kind, a, dt] of script) {
    if (kind === "step") {
      fx.step(a, dt);
      for (let i = 0; i < a; i += 1) model.frame(dt);
    } else if (kind === "check") {
      probe(fx, model, a);
    }
  }
  return fx;
}

const D60 = 0.0167;
const D30 = 0.0334;
const D144 = 0.024; // 1.44 steps
const D_BIG = 0.0867; // 5.202 steps
const D_SMALL = 0.0142; // 0.852 steps
const D_TINY = 0.001;

writeFixtures("interaction-11", {
  "no-tick-before-a-whole-step-has-passed": build("the blocks stay where they are while less than a step has passed", ["Retention check: the starter's behaviour."], [
    ["step", 4, D_TINY],
    ["check", "4 frames of 0.001 s (0.24 of a step): no tick, the Glider has moved a quarter of a pixel"],
  ]),

  "one-tick-per-sixtieth-two-per-thirtieth": build("a frame of 1/60 s runs one tick, a frame of 1/30 s runs two", [], [
    ["step", 10, D60],
    ["check", "10 frames of 1/60 s: 10 ticks"],
    ["step", 5, D30],
    ["check", "5 frames of 1/30 s: 10 more ticks"],
    ["step", 3, D60],
    ["check", "3 frames of 1/60 s: 3 more"],
  ]),

  "the-leftover-of-a-step-is-carried-to-the-next-frame": build("what is less than a step is kept for the next frame", [], [
    ["step", 5, D144],
    ["check", "5 frames of 0.024 s (1.44 steps each, 7.2 in all): 7 ticks"],
    ["step", 2, D144],
    ["check", "7 frames (10.08 steps): 10 ticks"],
    ["step", 2, D144],
    ["check", "9 frames (12.96 steps): 12 ticks"],
    ["step", 3, D144],
    ["check", "12 frames (17.28 steps): 17 ticks"],
    ["step", 8, D144],
    ["check", "20 frames (28.8 steps): 28 ticks (one tick per frame would give 20)"],
  ]),

  "at-most-four-ticks-a-frame-and-the-surplus-is-dropped": build("at most 4 ticks run in a frame and whole steps beyond them are dropped, not kept", [], [
    ["step", 3, D60],
    ["check", "3 frames of 1/60 s: 3 ticks"],
    ["step", 1, D_BIG],
    ["check", "a frame of 5.2 steps: 4 ticks (not 5), one whole step dropped, 0.2 of a step kept"],
    ["step", 1, D_SMALL],
    ["check", "a frame of 0.85 step: 0.2 + 0.85 is one step: 1 tick (0 if the fraction were dropped, 2 if the backlog were kept)"],
    ["step", 1, D_SMALL],
    ["check", "another 0.85 step: 0.05 + 0.85 is less than one step: no tick"],
    ["step", 1, D_SMALL],
    ["check", "and another: 0.9 + 0.85: 1 tick"],
  ]),

  "a-very-long-frame-counts-as-a-tenth-of-a-second": build("a frame longer than 0.1 s counts as 0.1 s", [], [
    ["step", 3, D60],
    ["check", "3 frames of 1/60 s: 3 ticks"],
    ["step", 1, 0.5],
    ["check", "one frame of 0.5 s: counts as 0.1 s: the Glider moves 6 pixels (not 30), 4 ticks run"],
  ]),
});
