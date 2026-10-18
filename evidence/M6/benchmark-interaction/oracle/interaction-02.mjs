// Model of interaction-02: ArrowRight / ArrowLeft move the Handle by one unit within [-4, 4]; at an end
// it is red; Enter recentres it. Written from the task prompt only.
import { Fixture, rect, writeFixtures } from "./lib.mjs";

const BG = "#202020";
const YELLOW = "#ffd24a";
const RED = "#ef4444";
const TRACK = rect("#404040", 0, -1, 10, 0.2);

/** The model: the handle position in world units. */
class Model {
  x = 0;
  press(key) {
    if (key === "ArrowRight") this.x = Math.min(4, this.x + 1);
    else if (key === "ArrowLeft") this.x = Math.max(-4, this.x - 1);
    else if (key === "Enter") this.x = 0;
  }
  boxes() {
    return [TRACK, rect(Math.abs(this.x) === 4 ? RED : YELLOW, this.x, 0, 0.8, 0.8, 1)];
  }
}

const HEADER = [
  "Camera: orthographic, height 12.8, at (0, 0, 10) looking at the origin: 10 pixels per world unit,",
  "pixel x = 64 + 10 x, pixel y = 64 - 10 y. The Handle is a 0.8 x 0.8 block: at x it covers the pixels",
  "64 + 10 x - 4 .. 64 + 10 x + 3 (edges on pixel boundaries); the Track is 10 x 0.2 at y = -1 (pixels",
  "x 14..113, y 73..74). Every expected colour below was computed by evidence/M6/benchmark-interaction/",
  "oracle/interaction-02.mjs from the task description, not from a run of either reference solution.",
  "A key press is applied at the start of the next frame; each tap is press, one frame, release, one frame.",
];

function probe(fx, model) {
  const centre = 64 + 10 * model.x;
  const points = [centre - 5, centre - 4, centre, centre + 3, centre + 4, 64].map((x) => [x, 64]);
  fx.expectAll(model.boxes(), BG, points);
}

function sequence(name, header, keys) {
  const fx = new Fixture(name, [...HEADER, ...header]);
  const model = new Model();
  fx.step(2);
  fx.expectAll(model.boxes(), BG, [[13, 74], [14, 74], [113, 74], [114, 74], [64, 74]]);
  probe(fx, model);
  for (const [key, repeat, note] of keys) {
    fx.note(note ?? `${key} x ${String(repeat)}`);
    for (let i = 0; i < repeat; i += 1) {
      fx.tap(key);
      model.press(key);
    }
    probe(fx, model);
  }
  return fx;
}

const fixtures = {
  "starts-centred": (() => {
    const fx = new Fixture("without a key press the handle stays in the centre, yellow", [
      ...HEADER,
      "Retention check: the starter's behaviour (nothing moves by itself) must not be broken.",
    ]);
    const model = new Model();
    fx.step(60);
    fx.expectAll(model.boxes(), BG, [[13, 74], [14, 74], [113, 74], [114, 74]]);
    probe(fx, model);
    return fx;
  })(),
  moves: sequence("each press of an arrow key moves the handle one unit", [], [
    ["ArrowRight", 3, "x: 0 -> 3"],
    ["ArrowLeft", 1, "x: 3 -> 2"],
    ["ArrowLeft", 4, "x: 2 -> -2"],
    ["ArrowRight", 2, "x: -2 -> 0"],
  ]),
  clamps: sequence("the handle stops at -4 and +4 and is red there", [], [
    ["ArrowRight", 3, "x: 0 -> 3 (yellow)"],
    ["ArrowRight", 1, "x: 3 -> 4 (end of the range: red)"],
    ["ArrowRight", 2, "two more presses at the end: nothing moves, still red"],
    ["ArrowLeft", 1, "x: 4 -> 3 (yellow again)"],
    ["ArrowLeft", 7, "x: 3 -> -4 (red)"],
    ["ArrowLeft", 3, "three more presses at the end: nothing moves, still red"],
    ["ArrowRight", 1, "x: -4 -> -3 (yellow)"],
  ]),
  enter: sequence("Enter puts the handle back at the centre, yellow", [], [
    ["ArrowRight", 2, "x: 0 -> 2"],
    ["Enter", 1, "Enter: x = 0"],
    ["Enter", 1, "Enter at the centre changes nothing"],
    ["ArrowLeft", 6, "x: 0 -> -4 (red)"],
    ["Enter", 1, "Enter from the red end: x = 0 and yellow again"],
  ]),
};

writeFixtures("interaction-02", {
  "handle-stays-without-input": fixtures["starts-centred"],
  "arrows-move-one-unit": fixtures.moves,
  "range-is-clamped-and-end-is-red": fixtures.clamps,
  "enter-recentres": fixtures.enter,
});
