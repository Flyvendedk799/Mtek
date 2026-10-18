// Model of interaction-06: the whole-number counter `value` (1 at the start, shown as the length of the Bar,
// whose left end is at x = -6). D doubles it, P adds 3, R sets it to 1, and it never exceeds 8. Every press
// counts, in the order it was made, also within one frame. Written from the task prompt only.
import { Fixture, rect, writeFixtures } from "./lib.mjs";

const BG = "#202020";
const BAR = "#ffd24a";
const MAX = 8;

class Model {
  value = 1;
  press(key) {
    if (key === "KeyD") this.value = Math.min(MAX, this.value * 2);
    else if (key === "KeyP") this.value = Math.min(MAX, this.value + 3);
    else if (key === "KeyR") this.value = 1;
  }
  boxes() {
    return [rect(BAR, -6 + this.value / 2, 0, this.value, 1)];
  }
  points() {
    const end = 4 + 10 * this.value;
    return [[4, 64], [end - 1, 64], [end, 64], [3, 64], [Math.floor((4 + end) / 2), 64], [4, 59], [end - 1, 68], [4, 58], [4, 69], [end - 1, 69], [end + 6, 64]];
  }
}

const HEADER = [
  "Camera: orthographic, height 12.8, at (0, 0, 10) looking at the origin: 10 pixels per world unit,",
  "pixel x = 64 + 10 x, pixel y = 64 - 10 y. The Bar is `value` units long and 1 unit high with its left end",
  "at x = -6: it covers the pixels x 4 .. 4 + 10 value - 1 and y 59 .. 68 (#ffd24a on #202020).",
  "Every expected colour below was computed by evidence/M6/benchmark-interaction/oracle/interaction-06.mjs",
  "from the task description, not from a run of either reference solution.",
  "A key press is applied at the start of the next frame, in the order the presses were made.",
];

function probe(fx, model, text) {
  fx.note(`${text}: value = ${String(model.value)}`);
  fx.expectAll(model.boxes(), BG, model.points());
}

/** A step is a key (pressed alone in its own frame) or an array of keys pressed together before one frame. */
function build(name, extra, steps) {
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

writeFixtures("interaction-06", {
  "bar-shows-one-without-input": (() => {
    const fx = new Fixture("the bar is one unit long and stays so without a key press", [
      ...HEADER,
      "Retention check: the starter's behaviour.",
    ]);
    fx.step(60);
    fx.expectAll(new Model().boxes(), BG, new Model().points());
    return fx;
  })(),
  "keys-change-the-value": build("D doubles, P adds three, R resets, and the value never exceeds 8", [], [
    "KeyD", "KeyD", "KeyD", "KeyD", "KeyR", "KeyP", "KeyP", "KeyP", "KeyR", "KeyP", "KeyD",
  ]),
  "same-frame-presses-apply-in-order": build(
    "presses of one frame apply in the order they were made",
    ["Each group below presses its keys before the one frame that applies them; a lone R between groups restores value 1 where a group needs it."],
    [
      ["KeyD", "KeyP"],
      "KeyR",
      ["KeyP", "KeyD"],
      "KeyR",
      ["KeyD", "KeyP", "KeyR"],
      ["KeyR", "KeyD", "KeyP"],
      ["KeyP", "KeyR", "KeyD"],
      ["KeyD", "KeyR", "KeyP"],
      ["KeyR", "KeyP", "KeyD"],
      ["KeyP", "KeyD", "KeyR"],
      ["KeyD", "KeyR"],
      "KeyD",
      ["KeyR", "KeyD"],
    ],
  ),
});
