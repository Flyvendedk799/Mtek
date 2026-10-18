// Model of interaction-03: two lamps. A toggles LampA, B toggles LampB, Space flips each lamp from its own
// state, Enter switches both off. Every key event counts, in the order it arrived, also within one frame.
// Written from the task prompt only.
import { Fixture, rect, writeFixtures } from "./lib.mjs";

const BG = "#202020";
const ON = "#ffd24a";
const OFF = "#3a3a3a";

class Model {
  a = false;
  b = false;
  press(key) {
    if (key === "KeyA") this.a = !this.a;
    else if (key === "KeyB") this.b = !this.b;
    else if (key === "Space") {
      this.a = !this.a;
      this.b = !this.b;
    } else if (key === "Enter") {
      this.a = false;
      this.b = false;
    }
  }
  boxes() {
    return [rect(this.a ? ON : OFF, -3, 0, 2, 2), rect(this.b ? ON : OFF, 3, 0, 2, 2)];
  }
  label() {
    return `A ${this.a ? "on" : "off"}, B ${this.b ? "on" : "off"}`;
  }
}

const HEADER = [
  "Camera: orthographic, height 12.8, at (0, 0, 10) looking at the origin: 10 pixels per world unit,",
  "pixel x = 64 + 10 x, pixel y = 64 - 10 y. LampA is a 2 x 2 block at x = -3 (pixels x 24..43, y 54..73),",
  "LampB the same at x = 3 (pixels x 84..103). Off is #3a3a3a, on is #ffd24a, the background #202020.",
  "Every expected colour below was computed by evidence/M6/benchmark-interaction/oracle/interaction-03.mjs",
  "from the task description, not from a run of either reference solution.",
  "A key press is applied at the start of the next frame, in the order the presses were made.",
];

const POINTS = [
  [34, 64], [24, 54], [43, 73], [23, 64], [44, 64],
  [94, 64], [84, 54], [103, 73], [83, 64], [104, 64],
  [64, 64],
];

function probe(fx, model, text) {
  fx.note(`${text}: ${model.label()}`);
  fx.expectAll(model.boxes(), BG, POINTS);
}

/** keys: array of steps; a step is a key (tapped alone) or an array of keys pressed in one frame. */
function run(name, extra, steps) {
  const fx = new Fixture(name, [...HEADER, ...extra]);
  const model = new Model();
  fx.step(2);
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

const retention = (() => {
  const fx = new Fixture("both lamps are off and stay off without a key press", [
    ...HEADER,
    "Retention check: the starter's behaviour (both lamps off) must not be broken.",
  ]);
  const model = new Model();
  fx.step(60);
  fx.expectAll(model.boxes(), BG, POINTS);
  return fx;
})();

writeFixtures("interaction-03", {
  "lamps-off-without-input": retention,
  "a-and-b-toggle-their-own-lamp": run("A and B each toggle their own lamp", [], [
    "KeyA", "KeyB", "KeyA", "KeyA", "KeyB",
  ]),
  "space-flips-each-lamp": run("Space flips every lamp from its own state; Enter switches both off", [], [
    "Space", "KeyA", "Space", "Space", "Enter", "Space", "KeyB", "Space",
  ]),
  "same-frame-presses-count-in-order": run(
    "key presses of one frame all count, in the order they were made",
    ["Each group below presses two or three keys before the one frame that applies them (keys released after it)."],
    [["KeyA", "Space"], ["KeyA", "KeyB", "Space"], ["Enter", "Space"], ["Space", "Enter"], ["Space", "KeyA", "KeyB"]],
  ),
});
