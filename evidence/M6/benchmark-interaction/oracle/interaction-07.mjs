// Model of interaction-07: Space adds a Pip (at most five; the n-th existing Pip stands at x = -6 + 2n),
// Backspace removes the most recently added Pip, Enter removes all. Written from the task prompt only.
import { Fixture, rect, writeFixtures } from "./lib.mjs";

const BG = "#202020";
const PIP = "#38bdf8";
const RAIL = rect("#404040", 0, -1.5, 12, 0.2);
const MAX = 5;

class Model {
  count = 0;
  press(key) {
    if (key === "Space") {
      if (this.count < MAX) this.count += 1;
    } else if (key === "Backspace") {
      if (this.count > 0) this.count -= 1;
    } else if (key === "Enter") {
      this.count = 0;
    }
  }
  boxes() {
    const pips = [];
    for (let n = 1; n <= this.count; n += 1) pips.push(rect(PIP, -6 + 2 * n, 0, 0.8, 0.8, 1));
    return [RAIL, ...pips];
  }
  /** Four pixels per slot (centre, two inside corners, one just left of it) whether or not a Pip is there. */
  points() {
    const points = [];
    for (let slot = 1; slot <= MAX; slot += 1) {
      const c = 64 + 10 * (-6 + 2 * slot);
      points.push([c, 64], [c - 4, 60], [c + 3, 67], [c - 5, 64]);
    }
    return points;
  }
}

const HEADER = [
  "Camera: orthographic, height 12.8, at (0, 0, 10) looking at the origin: 10 pixels per world unit,",
  "pixel x = 64 + 10 x, pixel y = 64 - 10 y. The five slots are at x = -4, -2, 0, 2, 4 (centre pixels",
  "24, 44, 64, 84, 104 on row 64). A Pip is a 0.8 x 0.8 block (#38bdf8): in slot centre c it covers the",
  "pixels c - 4 .. c + 3 in x and 60 .. 67 in y. The Rail is 12 x 0.2 at y = -1.5 (#404040, pixels x 4..123,",
  "y 78..79). Background #202020. The n-th Pip that exists is in slot n. Per state the fixture checks four",
  "pixels of every slot (the centre, two inside corners, one pixel left of the Pip), occupied or not.",
  "Every expected colour below was computed by evidence/M6/benchmark-interaction/oracle/interaction-07.mjs",
  "from the task description, not from a run of either reference solution.",
  "A key press is applied at the start of the next frame; spawns and removals are visible after that frame.",
];

const RAIL_POINTS = [[3, 78], [4, 78], [64, 79], [123, 79], [124, 79], [64, 77], [64, 80]];

function probe(fx, model, text) {
  fx.note(`${text}: ${String(model.count)} Pip${model.count === 1 ? "" : "s"}`);
  fx.expectAll(model.boxes(), BG, model.points());
}

/** A step is a key (alone in its frame) or an array of keys pressed together before one frame. */
function build(name, extra, steps) {
  const fx = new Fixture(name, [...HEADER, ...extra]);
  const model = new Model();
  fx.step(2);
  fx.expectAll(model.boxes(), BG, RAIL_POINTS);
  probe(fx, model, "start");
  for (const step of steps) {
    const keys = Array.isArray(step) ? step : [step];
    for (const key of keys) {
      fx.press(key);
      model.press(key);
    }
    fx.step(1);
    for (const key of keys) fx.release(key);
    fx.step(1);
    probe(fx, model, keys.length === 1 ? keys[0] : `${keys.join(" then ")} in one frame`);
  }
  return fx;
}

writeFixtures("interaction-07", {
  "no-pips-without-input": (() => {
    const fx = new Fixture("there is no Pip before the first Space", [...HEADER, "Retention check: the starter's behaviour."]);
    const model = new Model();
    fx.step(60);
    fx.expectAll(model.boxes(), BG, [...RAIL_POINTS, ...model.points()]);
    return fx;
  })(),
  "space-adds-pips-up-to-five": build("Space adds a Pip at the next free slot, up to five", [], [
    "Space", "Space", "Space", "Space", "Space", "Space", "Space",
  ]),
  "backspace-removes-the-newest-enter-removes-all": build("Backspace removes the newest Pip, Enter removes all of them", [], [
    "Space", "Space", "Space", "Space",
    "Backspace",
    "Backspace", "Backspace", "Backspace",
    "Backspace",
    "Space", "Space",
    "Backspace",
    "Space",
    "Enter",
    "Enter",
    "Space",
  ]),
  "same-frame-presses-apply-in-order": build(
    "presses of one frame apply in the order they were made",
    ["The first five Space presses fill the row, so the pairs below start from five Pips."],
    [
      "Space", "Space", "Space", "Space", "Space",
      ["Space", "Backspace"],
      "Space",
      ["Backspace", "Space"],
      ["Enter", "Space"],
      ["Space", "Enter"],
      ["Space", "Backspace"],
      ["Backspace", "Space"],
    ],
  ),
});
