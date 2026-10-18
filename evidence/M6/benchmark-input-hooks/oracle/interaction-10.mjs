// Model of interaction-10: the Ship (2 x 2, centre (0, 0) at the start) moves 8 units per second of program time
// along each axis for every arrow key that is held in a frame; opposite keys cancel; after every frame the centre is
// limited to [-4, 4] on each axis. A key is held in the frame that handles its press and in every later frame up to
// but not including the frame that handles its release; a key pressed and released within one frame is held in no
// frame. Written from the task prompt only: the key state at the end of the input phase, then the movement.
import { Fixture, probes, rect, writeFixtures } from "./lib.mjs";

const BG = "#202020";
const FIELD = "#303030";
const SHIP = "#38bdf8";
const SPEED = 8;
const LIMIT = 4;

const clamp = (v) => Math.max(-LIMIT, Math.min(LIMIT, v));

class Model {
  x = 0;
  y = 0;
  held = new Set();
  queue = [];
  down(key) {
    this.queue.push(["down", key]);
  }
  up(key) {
    this.queue.push(["up", key]);
  }
  /** One frame of `dt` seconds: the input phase first (the whole batch), then the movement. */
  frame(dt) {
    for (const [kind, key] of this.queue.splice(0)) {
      if (kind === "down") this.held.add(key);
      else this.held.delete(key);
    }
    let dx = 0;
    let dy = 0;
    if (this.held.has("ArrowRight")) dx += SPEED * dt;
    if (this.held.has("ArrowLeft")) dx -= SPEED * dt;
    if (this.held.has("ArrowUp")) dy += SPEED * dt;
    if (this.held.has("ArrowDown")) dy -= SPEED * dt;
    this.x = clamp(this.x + dx);
    this.y = clamp(this.y + dy);
  }
}

const HEADER = [
  "Camera: orthographic, height 12.8, at (0, 0, 10) looking at the origin: 10 pixels per world unit,",
  "pixel x = 64 + 10 x, pixel y = 64 - 10 y. Field: 10 x 10 units at the origin (behind the Ship), #303030, pixels",
  "x 14..113, y 14..113. Ship: 2 x 2 units, #38bdf8, centre (x, y): at the start it covers x 54..73, y 54..73.",
  "Speed 8 units per second of program time per held key. Frames last 1/16 s (0.0625, 0.5 unit = 5 pixels per frame)",
  "unless a step says otherwise; 1/32 s and 3/32 s are exact in binary too and below the 0.1 s frame clamp.",
  "A key counts as held in the frame that handles its press and every later frame up to but not including the frame",
  "that handles its release. The Ship is limited to x, y in [-4, 4] after every frame.",
  "Every expected colour below was computed by evidence/M6/benchmark-input-hooks/oracle/interaction-10.mjs from the",
  "task description, not from a run of either reference solution.",
];

function probe(fx, model, text) {
  const field = rect(FIELD, 0, 0, 10, 10, -1);
  const ship = rect(SHIP, model.x, model.y, 2, 2, 0);
  const all = [field, ship];
  fx.note(`${text}: Ship at (${String(model.x)}, ${String(model.y)})`);
  const points = [...probes(ship), [field.x0, 64], [field.x1 - 1, 64], [field.x0 - 1, 64], [64, field.y0], [64, field.y1 - 1], [64, field.y1]];
  for (const [px, py] of points) fx.expect(all, BG, px, py);
}

/** A script of ["press"|"release"|"step"|"check"|"note", ...]; a step is [n, dt]. */
function build(name, extra, script) {
  const fx = new Fixture(name, [...HEADER, ...extra]);
  const model = new Model();
  const held = new Set();
  for (const [kind, arg, dt = 0.0625] of script) {
    if (kind === "step") {
      fx.step(arg, dt);
      for (let i = 0; i < arg; i += 1) model.frame(dt);
    } else if (kind === "press") {
      if (held.has(arg)) throw new Error(`${name}: ${arg} is pressed while held`);
      held.add(arg);
      fx.press(arg);
      model.down(arg);
    } else if (kind === "release") {
      if (!held.delete(arg)) throw new Error(`${name}: ${arg} is released while not held`);
      fx.release(arg);
      model.up(arg);
    } else if (kind === "check") {
      probe(fx, model, arg);
    }
  }
  return fx;
}

const [R, L, U, D] = ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"];

writeFixtures("interaction-10", {
  "ship-stays-without-input": build("the Ship stays at the centre without a held key", ["Retention check: the starter's behaviour."], [
    ["step", 2],
    ["check", "after 2 frames"],
    ["step", 60],
    ["check", "after 62 frames"],
  ]),

  "ship-moves-in-every-frame-a-key-is-held": build("a held key moves the Ship in every frame until it is released", [], [
    ["step", 2],
    ["press", R],
    ["step", 1],
    ["check", "Right held, the press frame counts: one frame"],
    ["step", 2],
    ["check", "three frames"],
    ["release", R],
    ["step", 1],
    ["check", "the release frame does not count"],
    ["step", 4],
    ["check", "released: stays"],
    ["press", L],
    ["step", 3],
    ["check", "Left held for 3 frames"],
    ["release", L],
    ["step", 1],
    ["press", U],
    ["step", 2],
    ["release", U],
    ["step", 1],
    ["check", "Up held for 2 frames"],
    ["press", D],
    ["release", D],
    ["step", 1],
    ["check", "Down pressed and released within one frame: held in no frame"],
    ["press", D],
    ["step", 1],
    ["release", D],
    ["step", 1],
    ["check", "Down held for exactly one frame"],
    ["step", 20],
    ["check", "nothing moves any more"],
  ]),

  "keys-held-together-act-together": build("keys held at the same time all act, opposite keys cancel out", [], [
    ["step", 2],
    ["press", R],
    ["press", U],
    ["step", 2],
    ["check", "Right and Up held together: diagonal, two frames"],
    ["press", L],
    ["step", 2],
    ["check", "Left joins: Left and Right cancel, Up goes on"],
    ["release", U],
    ["step", 2],
    ["check", "Up released: only the cancelling pair is held"],
    ["release", L],
    ["step", 2],
    ["check", "Left released: Right goes on"],
    ["press", D],
    ["press", U],
    ["press", L],
    ["step", 3],
    ["check", "all four keys held: nothing moves"],
    ["release", R],
    ["release", U],
    ["step", 2],
    ["check", "Right and Up released: Left and Down act"],
  ]),

  "ship-stays-inside-the-field": build("the centre of the Ship is limited to -4 .. 4 on each axis", [], [
    ["step", 2],
    ["press", R],
    ["step", 6],
    ["check", "Right held 6 frames: x = 3"],
    ["step", 2],
    ["check", "8 frames: x = 4, exactly at the limit"],
    ["step", 5],
    ["check", "more frames: still 4"],
    ["press", U],
    ["step", 3],
    ["check", "Up and Right held: y rises, x stays at the limit"],
    ["step", 7],
    ["check", "y at the limit as well"],
    ["press", L],
    ["step", 2],
    ["check", "Left and Right cancel at the limit: the Ship stays in the corner"],
    ["release", R],
    ["step", 2],
    ["check", "Right released: Left acts"],
    ["release", L],
    ["release", U],
    ["press", D],
    ["step", 20],
    ["check", "Down held for 20 frames: y at -4"],
  ]),

  "movement-follows-the-frame-duration": build("the distance in a frame is 8 times that frame's duration", [], [
    ["step", 2],
    ["press", U],
    ["step", 8, 0.03125],
    ["check", "8 frames of 1/32 s: 2 units"],
    ["step", 2, 0.0625],
    ["check", "2 frames of 1/16 s: 1 unit more"],
    ["step", 2, 0.09375],
    ["check", "2 frames of 3/32 s: 1.5 units more, at the limit 4 (a frame count, not a time, would give less)"],
    ["release", U],
    ["press", L],
    ["step", 4, 0.03125],
    ["check", "Left: 4 frames of 1/32 s: 1 unit"],
    ["step", 6, 0.03125],
    ["check", "6 more frames of 1/32 s: 1.5 units more"],
  ]),
});
