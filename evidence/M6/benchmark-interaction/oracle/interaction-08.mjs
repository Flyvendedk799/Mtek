// Model of interaction-08 (cold): the Runner starts stopped at x = -5; Space toggles moving; while moving it
// advances 4 world units per second of summed frame time and stays in -6 <= x < 6 (12 is subtracted when it
// reaches 6 or more). Written from the task prompt only.
//
// The prompt does not say in which frame a toggle takes effect, so the model is run in two readings:
//   A: the press is applied first and the same frame's update already sees the new state;
//   B: the update of the press frame still sees the old state (the toggle shows from the next frame on).
// A pixel is only checked when both readings agree on its colour, also under a shift of the picture by up to
// 3 pixels in either direction (one frame of motion is 2.5 pixels), so no check sits at an edge in either
// reading. The checked pixels are all written into the fixture, so what is checked is visible there.
import { DT16, Fixture, rect, writeFixtures } from "./lib.mjs";

const BG = "#202020";
const RUNNER = "#f97316";
const TRACK_COLOR = "#404040";
const TRACK = rect(TRACK_COLOR, 0, -1, 12, 0.2);
const SPEED = 4;
const START = -5;

class Model {
  /** @param {"A" | "B"} reading */
  constructor(reading) {
    this.reading = reading;
    this.x = START;
    this.moving = false;
    this.queue = [];
  }
  press(key) {
    this.queue.push(key);
  }
  frame(dt) {
    const before = this.moving;
    for (const key of this.queue.splice(0)) if (key === "Space") this.moving = !this.moving;
    const movesNow = this.reading === "A" ? this.moving : before;
    if (movesNow) {
      this.x += SPEED * dt;
      if (this.x >= 6) this.x -= 12;
    }
  }
  /** Colour of pixel (px, py) with the Runner shifted by `shift` pixels. */
  colorAt(px, py, shift) {
    const cx = 64 + 10 * this.x + shift;
    if (px + 0.5 >= cx - 5 && px + 0.5 <= cx + 5 && py + 0.5 >= 59 && py + 0.5 <= 69) return RUNNER;
    const inTrack = px >= TRACK.x0 && px < TRACK.x1 && py >= TRACK.y0 && py < TRACK.y1;
    return inTrack ? TRACK_COLOR : BG;
  }
}

const HEADER = [
  "Camera: orthographic, height 12.8, at (0, 0, 10) looking at the origin: 10 pixels per world unit,",
  "pixel x = 64 + 10 x, pixel y = 64 - 10 y. The Runner is a 1 x 1 block (#f97316) at y = 0 (pixel rows",
  "59..68) that starts at x = -5; the Track is 12 x 0.2 at y = -1 (#404040, pixels x 4..123, y 73..74).",
  "Frames last 1/16 s (0.0625, exactly representable, below the runtime's 0.1 s frame-delta clamp): moving at",
  "4 units per second is 0.25 units (2.5 pixels) per frame, with exact sums.",
  "The prompt does not say whether the frame that applies a press already moves (or still moves) the Runner,",
  "so a pixel is only checked when its colour is the same in both readings and under a shift of up to 3",
  "pixels. Every expected colour below was computed by evidence/M6/benchmark-interaction/oracle/",
  "interaction-08.mjs from the task description, not from a run of either reference solution.",
];

/** Candidate pixels around the Runner and along the track, kept only where the readings agree. */
function probes(models) {
  const centres = new Set(models.map((m) => Math.round(64 + 10 * m.x)));
  const wanted = [];
  for (const c of centres) {
    for (const dx of [-12, -9, -6, -4, -2, 0, 2, 4, 6, 9, 12]) wanted.push([c + dx, 64]);
    wanted.push([c, 60], [c, 67], [c, 57], [c, 70]);
  }
  wanted.push([64, 74], [20, 74], [110, 74]);
  const seen = new Set();
  const out = [];
  for (const [px, py] of wanted) {
    const key = `${String(px)},${String(py)}`;
    if (px < 0 || px > 127 || seen.has(key)) continue;
    seen.add(key);
    const colors = new Set();
    for (const m of models) for (const shift of [-3, -0.5, 0, 0.5, 3]) colors.add(m.colorAt(px, py, shift));
    if (colors.size === 1) out.push([px, py, [...colors][0]]);
  }
  return out;
}

/** script items: ["step", n] | ["press", key] | ["release", key] | ["check", text] */
function build(name, extra, script) {
  const fx = new Fixture(name, [...HEADER, ...extra]);
  const models = [new Model("A"), new Model("B")];
  for (const [kind, arg] of script) {
    if (kind === "step") {
      fx.step(arg, DT16);
      for (const m of models) for (let i = 0; i < arg; i += 1) m.frame(DT16);
    } else if (kind === "press") {
      fx.press(arg);
      for (const m of models) m.press(arg);
    } else if (kind === "release") {
      fx.release(arg);
    } else {
      const [a, b] = models;
      const points = probes(models);
      if (points.filter(([, , color]) => color === RUNNER).length < 3) throw new Error(`${name}: "${arg}" checks too few Runner pixels`);
      fx.note(`${arg}: ${a.moving ? "moving" : "stopped"}, x = ${String(a.x)} (reading A) or ${String(b.x)} (reading B)`);
      for (const [px, py, color] of points) fx.expectColor(px, py, color);
    }
  }
  return fx;
}

const tap = (key) => [["press", key], ["step", 1], ["release", key]];

writeFixtures("interaction-08", {
  "runner-waits-at-the-start": build("the runner stays at x = -5 until Space is pressed", [], [
    ["step", 2],
    ["check", "after 2 frames"],
    ["step", 60],
    ["check", "after 62 frames without a key press"],
  ]),
  "space-starts-and-stops": build("Space starts the runner, the next Space stops it, the next continues", [], [
    ["step", 2],
    ...tap("Space"),
    ["step", 15],
    ["check", "1 s after the first Space"],
    ...tap("Space"),
    ["step", 30],
    ["check", "stopped for 30 frames"],
    ...tap("Space"),
    ["step", 15],
    ["check", "1 s after the third Space"],
    ["step", 16],
    ["check", "1 s later"],
  ]),
  "wraps-around-at-six": build("the runner re-enters at the left after reaching x = 6", [], [
    ["step", 2],
    ...tap("Space"),
    ["step", 40],
    ["check", "just before the wrap, 41 frames after the first Space (x about 5.25)"],
    ["step", 15],
    ["check", "after the first wrap"],
    ["step", 8],
    ["check", "8 frames later"],
    ["step", 32],
    ["check", "after the second wrap"],
  ]),
});
