// Model of interaction-09: the Stone (2 x 2, centre x = -4 at the start) is yellow, orange while Space is held.
// While Space is held each press of ArrowUp adds 1 to `power` (at most 5); when Space is released the Stone moves
// 2 units per point of power to the right, never past x = 5 (centre), and power goes back to 0. Every key event
// counts, in the order it happened, also within one frame. Written from the task prompt only: a queue of key
// events and a state machine, no engine, no run of either reference.
import { DT60, Fixture, probes, rect, writeFixtures } from "./lib.mjs";

const BG = "#202020";
const YELLOW = "#ffd24a";
const ORANGE = "#ff7a1a";
const POWER = "#38bdf8";
const RAIL = "#404040";
const MAX_POWER = 5;
const RIGHT_LIMIT = 5;

class Model {
  x = -4;
  power = 0;
  held = false;
  moved = false;
  queue = [];

  down(key) {
    this.queue.push(["down", key]);
  }
  up(key) {
    this.queue.push(["up", key]);
  }
  /**
   * One frame: the queued events, in the order they arrived. Refuses a frame that changes the Stone's colour right
   * after a frame that moved it: three.js r186.1 (the baseline's renderer, driven by a manual loop) does not upload
   * a colour change in that frame (decision 0088 item 10), so a fixture must not rely on it.
   */
  frame() {
    const movedBefore = this.moved;
    const heldBefore = this.held;
    const xBefore = this.x;
    for (const [kind, key] of this.queue.splice(0)) {
      if (kind === "down" && key === "Space") this.held = true;
      else if (kind === "down" && key === "ArrowUp") {
        if (this.held) this.power = Math.min(MAX_POWER, this.power + 1);
      } else if (kind === "up" && key === "Space") {
        this.held = false;
        this.x = Math.min(RIGHT_LIMIT, this.x + 2 * this.power);
        this.power = 0;
      }
    }
    this.moved = this.x !== xBefore;
    if (movedBefore && this.held !== heldBefore) {
      throw new Error("a colour change in the frame after a frame that moved the Stone (three.js r186.1 does not upload it)");
    }
  }
  boxes() {
    return {
      rail: rect(RAIL, 0, -1.1, 12, 0.2),
      stone: rect(this.held ? ORANGE : YELLOW, this.x, 0, 2, 2),
      power: rect(POWER, -5.5 + this.power, 3.5, 1, 1),
    };
  }
}

const HEADER = [
  "Camera: orthographic, height 12.8, at (0, 0, 10) looking at the origin: 10 pixels per world unit,",
  "pixel x = 64 + 10 x, pixel y = 64 - 10 y. Stone: 2 x 2 units, centre (x, 0), yellow #ffd24a, orange #ff7a1a while",
  "Space is held; at x = -4 it covers the pixels x 14..33, y 54..73. Power: 1 x 1 unit, cyan #38bdf8, centre",
  "(-5.5 + power, 3.5), so it covers x 4 + 10 power .. 13 + 10 power, y 24..33. Rail: 12 x 0.2 units at (0, -1.1),",
  "#404040, pixels x 4..123, y 74..75. Background #202020. Frames last 1/60 s (the launcher does not depend on time).",
  "Every key event is handled in the order it happened; `press` and `release` queue a transition that the next frame",
  "applies (a press and a release of Space within one frame both count: the model is the key events, not the key state).",
  "Every expected colour below was computed by evidence/M6/benchmark-input-hooks/oracle/interaction-09.mjs from the",
  "task description, not from a run of either reference solution.",
];

function probe(fx, model, text) {
  const { rail, stone, power } = model.boxes();
  const all = [rail, stone, power];
  fx.note(`${text}: Stone x = ${String(model.x)} ${model.held ? "orange" : "yellow"}, power = ${String(model.power)}`);
  const points = [...probes(stone), ...probes(power), [rail.x0, rail.y0], [rail.x1 - 1, rail.y1 - 1], [rail.x0 - 1, rail.y0]];
  for (const [px, py] of points) fx.expect(all, BG, px, py);
}

/**
 * A script of ["press"|"release"|"step"|"check"|"note", ...]; a step of n frames runs the model n times (the first
 * frame applies the queued events).
 */
function build(name, extra, script) {
  const fx = new Fixture(name, [...HEADER, ...extra]);
  const model = new Model();
  const held = new Set();
  for (const [kind, arg] of script) {
    if (kind === "step") {
      fx.step(arg, DT60);
      for (let i = 0; i < arg; i += 1) model.frame();
    } else if (kind === "press") {
      if (held.has(arg)) throw new Error(`${name}: ${arg} is pressed while held (the runtime ignores that)`);
      held.add(arg);
      fx.press(arg);
      model.down(arg);
    } else if (kind === "release") {
      if (!held.delete(arg)) throw new Error(`${name}: ${arg} is released while not held (the runtime ignores that)`);
      fx.release(arg);
      model.up(arg);
    } else if (kind === "check") {
      probe(fx, model, arg);
    } else if (kind === "note") {
      fx.note(arg);
    }
  }
  return fx;
}

/** A key pressed in one frame and released in the next. */
const tap = (key) => [["press", key], ["step", 1], ["release", key], ["step", 1]];

writeFixtures("interaction-09", {
  "stone-stays-without-input": build("nothing happens without a key event", ["Retention check: the starter's behaviour."], [
    ["step", 2],
    ["check", "after 2 frames"],
    ["step", 60],
    ["check", "after 62 frames"],
  ]),

  "release-launches-and-press-does-not": build("the Stone is launched by the release of Space, not by its press", [], [
    ["step", 2],
    ["check", "start"],
    ["press", "Space"],
    ["step", 1],
    ["check", "Space pressed: orange, not launched"],
    ...tap("ArrowUp"),
    ["check", "Up pressed and released: power 1, no launch"],
    ...tap("ArrowUp"),
    ...tap("ArrowUp"),
    ["check", "three presses of Up: power 3, still at the start (the release of Up launches nothing)"],
    ["step", 5],
    ["check", "holding Space for a while changes nothing"],
    ["release", "Space"],
    ["step", 1],
    ["check", "Space released: launched by 6, power 0, yellow again"],
    ["step", 5],
    ["check", "stays there"],
    ...tap("Space"),
    ["check", "a launch with power 0 moves nothing"],
    ["press", "Space"],
    ["step", 1],
    ...tap("ArrowUp"),
    ["release", "Space"],
    ["step", 1],
    ["check", "a second launch, power 1, continues from where the Stone is"],
  ]),

  "power-is-capped-and-needs-space-held": build("Up counts only while Space is held, up to 5, and a launch stops at x = 5", [], [
    ["step", 2],
    ...tap("ArrowUp"),
    ...tap("ArrowUp"),
    ["check", "Up without Space does nothing"],
    ["press", "Space"],
    ["step", 1],
    ...tap("ArrowUp"),
    ...tap("ArrowUp"),
    ...tap("ArrowUp"),
    ...tap("ArrowUp"),
    ["check", "four presses of Up with Space held: power 4"],
    ...tap("ArrowUp"),
    ["check", "five presses: power 5"],
    ...tap("ArrowUp"),
    ["check", "a sixth press: still 5"],
    ["release", "Space"],
    ["step", 1],
    ["check", "launch with power 5 from -4 would reach 6: the Stone stops at x = 5"],
    ["step", 1],
    ["press", "Space"],
    ["step", 1],
    ...tap("ArrowUp"),
    ["check", "a new charge, the Stone is orange at x = 5"],
    ["release", "Space"],
    ["step", 1],
    ["check", "launched from x = 5: it stays at x = 5"],
  ]),

  "events-of-one-frame-are-handled-in-order": build("key events within one frame are handled in the order they happened", [], [
    ["step", 2],
    ["press", "Space"],
    ["press", "ArrowUp"],
    ["release", "Space"],
    ["step", 1],
    ["check", "Space down, Up down, Space up in one frame: launched with power 1"],
    ["release", "ArrowUp"],
    ["step", 1],
    ["press", "ArrowUp"],
    ["press", "Space"],
    ["step", 1],
    ["check", "Up down, then Space down in one frame: Up came first and counts for nothing; Space is held"],
    ["release", "Space"],
    ["release", "ArrowUp"],
    ["step", 1],
    ["check", "released again: a launch with power 0 moves nothing"],
    ["press", "Space"],
    ["step", 1],
    ["press", "ArrowUp"],
    ["release", "ArrowUp"],
    ["press", "ArrowUp"],
    ["release", "ArrowUp"],
    ["step", 1],
    ["check", "two presses of Up within one frame while Space is held: power 2"],
    ["release", "Space"],
    ["step", 1],
    ["check", "launched by 4"],
    ["press", "Space"],
    ["release", "Space"],
    ["press", "ArrowUp"],
    ["step", 1],
    ["check", "Space down and up, then Up, in one frame: Up came after the release and counts for nothing"],
    ["release", "ArrowUp"],
    ["step", 1],
    ["check", "nothing moved"],
  ]),
});

