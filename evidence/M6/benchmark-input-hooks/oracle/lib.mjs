// Independent oracle for the key-release, held-key and fixed-tick benchmark tasks (decision 0088).
//
// It builds on the painter and fixture writer of the interaction oracle (decision 0079,
// ../../benchmark-interaction/oracle/lib.mjs): a flat-colour painter over the geometry of an orthographic
// camera at (0, 0, 10) with `height = 12.8` on the 128 x 128 target (pixel x = 64 + 10 x, pixel y = 64 - 10 y), and
// a writer for `mtek-tests/*.test.toml`. A model here is the task description turned into a few lines of
// JavaScript; it shares no code, no engine and no run with either reference solution.
//
// What this file adds:
//  - probes(): the pixels a check looks at for a box, just inside and just outside its edges;
//  - FrameTime: the frame clock of `spec/scenes.md` sections 10 and 10.2 as arithmetic (clamped frame delta, fixed
//    step 1/60 s, at most 4 ticks per frame, the whole steps beyond that dropped, the fraction of a step kept),
//    run with BOTH values of the step that exist (1/60 in binary64, as the baseline support did before decision
//    0088, and 0.016666668, the binary32 print that the Mtek manifest carries) and refusing a frame whose tick count
//    or dropped count differs between them, or that ends within 0.001 of a step of a tick boundary.
import { Fixture, colorAt, rect, writeFixtures } from "../../benchmark-interaction/oracle/lib.mjs";

export { Fixture, colorAt, rect, writeFixtures };
export { DT16, DT60, SIZE, UNIT } from "../../benchmark-interaction/oracle/lib.mjs";

/**
 * The pixels to look at for a box (as returned by rect()): the centre, the two corner pixels just inside and the
 * four pixels just outside the middle of each side. Pixels outside the 128 x 128 target are left out.
 * @param {{x0:number,x1:number,y0:number,y1:number}} box
 * @returns {Array<[number, number]>}
 */
export function probes(box) {
  const cx = Math.floor((box.x0 + box.x1 - 1) / 2);
  const cy = Math.floor((box.y0 + box.y1 - 1) / 2);
  const points = [
    [cx, cy],
    [box.x0, box.y0],
    [box.x1 - 1, box.y1 - 1],
    [box.x0 - 1, cy],
    [box.x1, cy],
    [cx, box.y0 - 1],
    [cx, box.y1],
  ];
  return points.filter(([x, y]) => x >= 0 && x < 128 && y >= 0 && y < 128);
}

/** A key code to the name the model uses. */
export const KEY = { Space: "Space", Up: "ArrowUp", Down: "ArrowDown", Left: "ArrowLeft", Right: "ArrowRight" };

/** The two steps of the fixed clock that exist: 1/60 as binary64 and the binary32 print the manifest carries. */
export const STEPS = [1 / 60, 0.016666668];
export const MAX_FRAME_DELTA = 0.1;
export const MAX_CATCH_UP = 4;
/** A frame is refused when its accumulator is closer than this (in steps) to a whole number of steps. */
export const TICK_MARGIN = 0.001;

/** The frame clock of one value of the fixed step. */
class Clock {
  constructor(step) {
    this.step = step;
    this.accumulator = 0;
  }
  /** @returns {{ticks:number, counted:number, before:number, dropped:number}} */
  frame(dt) {
    const counted = Math.min(dt, MAX_FRAME_DELTA);
    this.accumulator += counted;
    const before = this.accumulator / this.step;
    let ticks = 0;
    while (this.accumulator >= this.step && ticks < MAX_CATCH_UP) {
      this.accumulator -= this.step;
      ticks += 1;
    }
    let dropped = 0;
    if (this.accumulator >= this.step) {
      dropped = Math.floor(this.accumulator / this.step);
      this.accumulator %= this.step;
    }
    return { ticks, counted, before, dropped };
  }
}

/** Both clocks side by side; every frame must give the same answer on both and keep away from a tick boundary. */
export class FrameTime {
  constructor() {
    this.clocks = STEPS.map((step) => new Clock(step));
    this.ticks = 0;
    /** Program time: the sum of the counted frame durations, in seconds. */
    this.time = 0;
    this.log = [];
  }

  /** Runs one frame of `dt` seconds. @returns {number} the ticks it ran */
  frame(dt) {
    const results = this.clocks.map((clock) => clock.frame(dt));
    const [a, b] = results;
    if (a.ticks !== b.ticks || a.dropped !== b.dropped) {
      throw new Error(`a frame of ${String(dt)} s gives different ticks on the two steps: ${JSON.stringify(results)}`);
    }
    for (const r of results) {
      const distance = Math.abs(r.before - Math.round(r.before));
      if (distance < TICK_MARGIN) throw new Error(`a frame of ${String(dt)} s ends ${String(distance)} steps from a tick boundary`);
    }
    const carried = this.clocks.map((clock) => clock.accumulator / clock.step);
    this.ticks += a.ticks;
    this.time += a.counted;
    this.log.push({ dt, ticks: a.ticks, dropped: a.dropped, carried: carried[0] });
    return a.ticks;
  }
}
