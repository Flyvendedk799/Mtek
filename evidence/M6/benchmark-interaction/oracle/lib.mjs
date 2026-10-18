// Independent oracle for the interaction benchmark tasks (decision 0079).
//
// The fixtures of interaction-02 .. interaction-08 were generated from per-task models written in
// this directory. A model is the task description turned into a few lines of JavaScript (a state
// machine over the keys and inputs) plus this tiny flat-colour painter. It shares no code, no
// engine and no run with either side's reference solution, so a fixture cannot inherit a mistake
// of a reference. `node <task>.mjs` rewrites the task's mtek-tests/*.test.toml from its model.
//
// Geometry: every task uses an orthographic camera at (0, 0, 10) looking at the origin with
// `height = 12.8` on the 128 x 128 target, so one world unit is exactly ten pixels:
//   pixel x = 64 + 10 * world x          (left edge of the pixel; its centre is at + 0.5)
//   pixel y = 64 - 10 * world y
// All box edges lie on integer pixel boundaries (checked below), so a pixel centre is at least half
// a pixel from every edge and the colour of a pixel does not depend on rasterisation rules.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SIZE = 128;
export const UNIT = 10;
/** One 60 Hz frame as binary32 prints it (the value of `runtime.fixed_step`). */
export const DT60 = 0.016666668;
/** 1/16 s: exactly representable, so sums of frames are exact (below `max_frame_delta`, 0.1 s). */
export const DT16 = 0.0625;

const EDGE_EPSILON = 1e-9;

/**
 * A flat-coloured axis-aligned box seen from the front.
 * @param {string} color "#rrggbb"
 * @param {number} cx world x of the centre
 * @param {number} cy world y of the centre
 * @param {number} w full width in world units
 * @param {number} h full height in world units
 * @param {number} z nearer to the camera when larger (only the order matters)
 */
export function rect(color, cx, cy, w, h, z = 0) {
  const r = {
    color,
    x0: 64 + UNIT * (cx - w / 2),
    x1: 64 + UNIT * (cx + w / 2),
    y0: 64 - UNIT * (cy + h / 2),
    y1: 64 - UNIT * (cy - h / 2),
    z,
  };
  for (const edge of [r.x0, r.x1, r.y0, r.y1]) {
    if (Math.abs(edge - Math.round(edge)) > EDGE_EPSILON) {
      throw new Error(`an edge at pixel ${String(edge)} is not on a pixel boundary`);
    }
  }
  return { ...r, x0: Math.round(r.x0), x1: Math.round(r.x1), y0: Math.round(r.y0), y1: Math.round(r.y1) };
}

/** The colour of pixel (px, py): the nearest box that covers the pixel, else the background. */
export function colorAt(boxes, background, px, py) {
  let best = null;
  for (const b of boxes) {
    if (px >= b.x0 && px < b.x1 && py >= b.y0 && py < b.y1 && (best === null || b.z >= best.z)) best = b;
  }
  return best === null ? background : best.color;
}

/** A fixture under construction. */
export class Fixture {
  /** @param {string} name @param {string[]} header comment lines */
  constructor(name, header) {
    this.name = name;
    this.header = header;
    this.lines = [];
    this.asserts = 0;
  }

  note(text) {
    this.lines.push("");
    for (const line of text.split("\n")) this.lines.push(`  # ${line}`);
    return this;
  }

  step(frames, dt = DT60) {
    this.lines.push(`  { step = ${String(frames)}, dt = ${String(dt)} },`);
    return this;
  }

  press(key) {
    this.lines.push(`  { press = "${key}" },`);
    return this;
  }

  release(key) {
    this.lines.push(`  { release = "${key}" },`);
    return this;
  }

  /** press, one frame, release, one frame */
  tap(key, dt = DT60) {
    return this.press(key).step(1, dt).release(key).step(1, dt);
  }

  /** @param {string} name @param {string} tomlValue the value as TOML text */
  setInput(name, tomlValue) {
    this.lines.push(`  { set_input = { ${name} = ${tomlValue} } },`);
    return this;
  }

  /** Expects pixel (px, py) to have the colour the oracle computes for `boxes`. */
  expect(boxes, background, px, py, tolerance = 2) {
    const color = colorAt(boxes, background, px, py);
    this.lines.push(
      `  { expect_pixel = { x = ${String(px)}, y = ${String(py)}, color = "${color}", tolerance = ${String(tolerance)} } },`,
    );
    this.asserts += 1;
    return this;
  }

  /** Expects pixel (px, py) to have exactly this colour (for models that compute colours themselves). */
  expectColor(px, py, color, tolerance = 2) {
    this.lines.push(
      `  { expect_pixel = { x = ${String(px)}, y = ${String(py)}, color = "${color}", tolerance = ${String(tolerance)} } },`,
    );
    this.asserts += 1;
    return this;
  }

  /** Expects every listed pixel. @param {Array<[number, number]>} points */
  expectAll(boxes, background, points) {
    for (const [px, py] of points) this.expect(boxes, background, px, py);
    return this;
  }

  toml() {
    if (this.asserts === 0) throw new Error(`fixture '${this.name}' asserts nothing`);
    const header = this.header.map((line) => `# ${line}`.trimEnd()).join("\n");
    const body = this.lines.join("\n").replace(/^\n/, "");
    return `${header}\nname = ${JSON.stringify(this.name)}\nsteps = [\n${body}\n]\n`;
  }
}

/** Writes `fixtures` (file base name -> Fixture) to `<repo>/benchmarks/tasks/<task>/mtek-tests/`. */
export function writeFixtures(task, fixtures) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  const directory = join(repo, "benchmarks", "tasks", task, "mtek-tests");
  mkdirSync(directory, { recursive: true });
  for (const [base, fixture] of Object.entries(fixtures)) {
    writeFileSync(join(directory, `${base}.test.toml`), fixture.toml());
    process.stdout.write(`wrote ${task}/mtek-tests/${base}.test.toml (${String(fixture.asserts)} pixel checks)\n`);
  }
}
