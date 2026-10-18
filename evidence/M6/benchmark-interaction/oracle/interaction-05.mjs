// Model of interaction-05: the host input `cursor` (a pair [x, y]) places the Marker, each coordinate
// limited to [-4.5, 4.5] on its own; Space puts the Marker back at the centre. Written from the task prompt only.
import { Fixture, rect, writeFixtures } from "./lib.mjs";

const BG = "#202020";
const PANEL = rect("#2a2a2a", 0, 0, 10, 10, 0);
const MARKER = "#38bdf8";
const LIMIT = 4.5;
const clamp = (v) => Math.max(-LIMIT, Math.min(LIMIT, v));

class Model {
  x = 0;
  y = 0;
  setInput(x, y) {
    this.x = clamp(x);
    this.y = clamp(y);
  }
  press(key) {
    if (key === "Space") {
      this.x = 0;
      this.y = 0;
    }
  }
  boxes() {
    return [PANEL, rect(MARKER, this.x, this.y, 1, 1, 1)];
  }
  /** Pixels: marker centre, its four edge pixels inside, four just outside, the panel corners, the old centre. */
  points() {
    const cx = Math.round(64 + 10 * this.x);
    const cy = Math.round(64 - 10 * this.y);
    return [
      [cx, cy], [cx - 5, cy], [cx + 4, cy], [cx, cy - 5], [cx, cy + 4],
      [cx - 6, cy], [cx + 5, cy], [cx, cy - 6], [cx, cy + 5],
      [64, 64],
    ];
  }
}

const HEADER = [
  "Camera: orthographic, height 12.8, at (0, 0, 10) looking at the origin: 10 pixels per world unit,",
  "pixel x = 64 + 10 x, pixel y = 64 - 10 y. The Panel is 10 x 10 (pixels 14..113 in x and y, #2a2a2a); the",
  "Marker is a 1 x 1 block (#38bdf8) that covers pixels cx - 5 .. cx + 4 and cy - 5 .. cy + 4 around its centre",
  "pixel (cx, cy) = (64 + 10 x, 64 - 10 y). Background #202020.",
  "Every expected colour below was computed by evidence/M6/benchmark-interaction/oracle/interaction-05.mjs",
  "from the task description, not from a run of either reference solution.",
  "A host input is applied at the start of the next frame, so every set_input is followed by a step.",
  "A key press and a host input are never put into the same frame (the order between them is not specified).",
];

function probe(fx, model, text) {
  fx.note(`${text}: Marker at (${String(model.x)}, ${String(model.y)})`);
  fx.expectAll(model.boxes(), BG, model.points());
}

function build(name, extra, script) {
  const fx = new Fixture(name, [...HEADER, ...extra]);
  const model = new Model();
  fx.step(2);
  probe(fx, model, "start");
  for (const item of script) {
    if (item === "Space") {
      fx.tap("Space");
      model.press("Space");
      probe(fx, model, "Space");
    } else {
      const [x, y] = item;
      fx.setInput("cursor", `[${x.toFixed(1)}, ${y.toFixed(1)}]`).step(1);
      model.setInput(x, y);
      probe(fx, model, `cursor = [${x.toFixed(1)}, ${y.toFixed(1)}]`);
    }
  }
  return fx;
}

writeFixtures("interaction-05", {
  "marker-stays-centred-without-input": (() => {
    const fx = new Fixture("the marker stays at the centre until the host sets cursor", [
      ...HEADER,
      "Retention check: the starter's behaviour (a Marker at the centre, nothing moves by itself).",
    ]);
    const model = new Model();
    fx.step(60);
    fx.expectAll(model.boxes(), BG, [...model.points(), [13, 64], [14, 64], [113, 64], [114, 64], [64, 13], [64, 14], [64, 113], [64, 114]]);
    return fx;
  })(),
  "cursor-moves-the-marker": build("the host input cursor places the marker", [], [
    [3.0, 2.0],
    [-2.5, -3.5],
    [0.0, 4.0],
    [4.5, -4.5],
  ]),
  "each-coordinate-is-limited-on-its-own": build("coordinates beyond 4.5 are limited one by one", [], [
    [9.0, 1.0],
    [-7.0, -20.0],
    [1.5, 30.0],
    [4.6, 0.0],
    [-4.5, 4.5],
    [2.0, -2.0],
  ]),
  "space-recentres": build("Space puts the marker back at the centre and the next value moves it again", [], [
    [2.0, 2.0],
    "Space",
    [-1.0, 0.5],
    "Space",
    "Space",
    [8.0, -8.0],
    "Space",
  ]),
});
