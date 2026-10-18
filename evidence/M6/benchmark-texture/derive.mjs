// Derives the fixture `mtek-tests/scene.test.toml` of the benchmark task scene-rendering-11 (decision 0089) from the
// scene its prompt describes, with an independent CPU model. Nothing here reads a reference solution or runs a browser.
//
//   node evidence/M6/benchmark-texture/derive.mjs [--map] [--write FILE]
//
// The model (all f64):
//   - the picture is `make-swatch.mjs`'s TEXELS (sRGB bytes), 4 x 4, row 0 at the top;
//   - three flat squares lie in the plane y = 0, centred at (cx, 0, 0), side 2.4; the picture's top edge is the edge
//     with the smaller z and its left edge the one with the smaller x (the prompt says so: it reads upright and
//     unmirrored from the camera's side). That is the picture coordinate (u, v) = ((x - cx) / side + 1/2,
//     (z - cz) / side + 1/2) with v growing towards the camera;
//   - Plain: the picture once, `nearest` filtering. Tiled: the picture twice across and twice down (coordinates times 2,
//     repeat), `nearest`. Smooth: the picture once, linear filtering between texel centres, clamped;
//   - the surfaces are unlit: a pixel shows the colour of the texture sample, decoded from sRGB to linear (the texels are
//     sRGB), filtered in linear light, and encoded to sRGB again by the target (the CPU sampler of
//     `tests/browser/support/texture-reference.ts`, whose sRGB handling is checked against hand-evaluated values);
//   - the camera is the look-at perspective camera of the prompt; the target is 128 x 128 and the pixel (x, y) has its
//     centre at (x + 1/2, y + 1/2).
// Expected pixels come from rays through pixel centres intersected with the plane y = 0 (the inverse of "project the texel
// centres through the camera"); every selected pixel for a texel centre is then confirmed against the FORWARD projection
// of that texel centre (the view and projection matrices of spec/runtime-abi.md section 8.3, `m1-reference.ts`).
//
// A pixel is only chosen when it is robust: the nine points of radius `margin` (a square ring) around its centre must hit the
// same panel and, for the `nearest` panels, the same texel (so neither rasterisation rules nor the precision of the
// interpolated coordinate decide the texel); for the `linear` panel the expected value is computed at the exact coordinate
// of the pixel centre.
import { writeFileSync } from "node:fs";
import { projectionMatrix, transform4, viewMatrix } from "../../../tests/browser/support/m1-reference.ts";
import { encodePixel, sampleReference } from "../../../tests/browser/support/texture-reference.ts";
import { TEXELS, bytesOf } from "./make-swatch.mjs";

export const SIZE = 128;

/** The scene of the prompt. */
export const SCENE = {
  clear: "#1b2430",
  camera: { position: [0, 11, 3], target: [0, 0, 0], fovY: 0.72, near: 0.1, far: 1000 },
  side: 3.6,
  panels: [
    { name: "Plain", cx: -2, cz: -2, tile: 1, filter: "nearest", address: "repeat" },
    { name: "Tiled", cx: 0, cz: 2, tile: 2, filter: "nearest", address: "repeat" },
    { name: "Smooth", cx: 2, cz: -2, tile: 1, filter: "linear", address: "clamp" },
  ],
};

const TEXTURE = {
  width: 4,
  height: 4,
  texels: TEXELS.flat().map((hex) => [...bytesOf(hex), 255]),
  colorSpace: "srgb",
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a) => mul(a, 1 / Math.hypot(...a));
const hex = (rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

const forward = normalize(sub(SCENE.camera.target, SCENE.camera.position));
const right = normalize(cross(forward, [0, 1, 0]));
const up = cross(right, forward);
const tanHalf = Math.tan(SCENE.camera.fovY / 2);

/** What the ray through the pixel position (px, py), in pixel units, hits: { panel, u, v } or null (the clear colour). */
export function cast(px, py) {
  const ndcX = (px / SIZE) * 2 - 1;
  const ndcY = 1 - (py / SIZE) * 2;
  const direction = add(forward, add(mul(right, ndcX * tanHalf), mul(up, ndcY * tanHalf)));
  const origin = SCENE.camera.position;
  if (direction[1] >= 0) return null;
  const t = -origin[1] / direction[1];
  const point = add(origin, mul(direction, t));
  for (const panel of SCENE.panels) {
    const u = (point[0] - panel.cx) / SCENE.side + 0.5;
    const v = (point[2] - panel.cz) / SCENE.side + 0.5;
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) return { panel, u, v };
  }
  return null;
}

/** The expected bytes of a hit. */
export function colourOf(hit) {
  if (hit === null) return bytesOf(SCENE.clear);
  const { panel, u, v } = hit;
  return encodePixel(sampleReference(TEXTURE, panel.filter, panel.address, u * panel.tile, v * panel.tile));
}

/** The class of a hit that must not change within the margin: the panel only. */
function panelKeyOf(hit) {
  return hit === null ? "clear" : hit.panel.name;
}

/** The class of a hit that must not change within the margin: the panel and, for `nearest`, the texel cell. */
function keyOf(hit) {
  if (hit === null) return "clear";
  const { panel, u, v } = hit;
  if (panel.filter === "linear") return panel.name;
  return `${panel.name} ${Math.floor(u * panel.tile * 4)},${Math.floor(v * panel.tile * 4)}`;
}

const RING = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];
/** The largest radius (in 0.25 pixel steps, at most 3) at which the ring of 8 points around the centre has the centre's key. */
function marginOf(x, y, classify) {
  const key = classify(cast(x + 0.5, y + 0.5));
  let best = 0;
  for (let r = 0.25; r <= 3; r += 0.25) {
    if (RING.some(([dx, dy]) => classify(cast(x + 0.5 + dx * r, y + 0.5 + dy * r)) !== key)) break;
    best = r;
  }
  return { key, margin: best };
}

const viewProjection = (() => {
  const view = viewMatrix({ position: SCENE.camera.position, target: SCENE.camera.target, projection: { kind: "perspective", fovY: SCENE.camera.fovY, near: SCENE.camera.near, far: SCENE.camera.far } });
  const projection = projectionMatrix({ kind: "perspective", fovY: SCENE.camera.fovY, near: SCENE.camera.near, far: SCENE.camera.far }, 1);
  return { view, projection };
})();

/** The pixel position of a world point by the matrices of the runtime ABI (not by the ray model above). */
export function project(point) {
  const eye = transform4(viewProjection.view, point, 1);
  const clip = transform4(viewProjection.projection, eye.slice(0, 3), eye[3]);
  return { x: ((clip[0] / clip[3] + 1) / 2) * SIZE, y: ((1 - clip[1] / clip[3]) / 2) * SIZE };
}

/** The world point of the picture coordinate (u, v) of a panel (before tiling). */
const worldOf = (panel, u, v) => [panel.cx + (u - 0.5) * SCENE.side, 0, panel.cz + (v - 0.5) * SCENE.side];

/** The pixel of `candidates` (cells with the wanted key) nearest to `(sx, sy)`. */
function nearestTo(candidates, sx, sy) {
  let best = null;
  let bestDistance = Infinity;
  for (const c of candidates) {
    const d = Math.hypot(c.x + 0.5 - sx, c.y + 0.5 - sy);
    if (d < bestDistance) {
      bestDistance = d;
      best = c;
    }
  }
  return best === null ? null : { ...best, distance: bestDistance };
}

function survey() {
  const cells = [];
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      // `margin`: to the nearest texel or panel boundary; `panelMargin`: to the border of the panel (or of the clear colour) only.
      cells.push({ x, y, ...marginOf(x, y, keyOf), panelMargin: marginOf(x, y, panelKeyOf).margin });
    }
  }
  return cells;
}

/** Farthest-point sampling of `count` cells. */
function spread(pool, count, taken = []) {
  const picked = [];
  const rest = pool.slice();
  while (picked.length < count && rest.length > 0) {
    const anchors = [...taken, ...picked];
    let bestIndex = 0;
    let bestDistance = -1;
    for (const [index, cell] of rest.entries()) {
      const d = anchors.length === 0 ? cell.margin : Math.min(...anchors.map((a) => Math.hypot(a.x - cell.x, a.y - cell.y)));
      if (d > bestDistance) {
        bestDistance = d;
        bestIndex = index;
      }
    }
    picked.push(rest.splice(bestIndex, 1)[0]);
  }
  return picked;
}

export function derive() {
  const cells = survey();
  const byKey = new Map();
  for (const cell of cells) {
    if (!byKey.has(cell.key)) byKey.set(cell.key, []);
    byKey.get(cell.key).push(cell);
  }
  const steps = [];
  const problems = [];
  const push = (cell, label, tolerance, group) => {
    const hit = cast(cell.x + 0.5, cell.y + 0.5);
    steps.push({ x: cell.x, y: cell.y, rgb: colourOf(hit), tolerance, label, group });
  };

  // 1. the texel centres of the `nearest` panels: the pixel nearest to the forward projection of the texel centre
  for (const panel of SCENE.panels.filter((p) => p.filter === "nearest")) {
    const cellsPerSide = 4 * panel.tile;
    for (let row = 0; row < cellsPerSide; row += 1) {
      for (let col = 0; col < cellsPerSide; col += 1) {
        const centre = worldOf(panel, (col + 0.5) / cellsPerSide, (row + 0.5) / cellsPerSide);
        const at = project(centre);
        const candidates = (byKey.get(`${panel.name} ${col},${row}`) ?? []).filter((c) => c.margin >= 1.5);
        const pick = nearestTo(candidates, at.x, at.y);
        if (pick === null) {
          problems.push(`${panel.name} texel ${col},${row}: no pixel with a margin of 1.5`);
          continue;
        }
        // The forward projection and the ray model must agree: the ray through the chosen pixel lands inside the cell.
        const hit = cast(pick.x + 0.5, pick.y + 0.5);
        const texel = TEXELS[(row % 4)][(col % 4)];
        const expected = colourOf(hit);
        if (hex(expected) !== texel) problems.push(`${panel.name} texel ${col},${row}: the pixel (${pick.x}, ${pick.y}) shows ${hex(expected)}, the picture has ${texel}`);
        const where = panel.tile === 1 ? `texel ${col},${row} (${texel})` : `tile ${Math.floor(col / 4)},${Math.floor(row / 4)} texel ${col % 4},${row % 4} (${texel})`;
        push(pick, `${panel.name}: ${where}`, 2, panel.name);
      }
    }
  }

  // 2. the smooth panel: texel centres, the midpoints between two texel centres and the points between four, each at the
  //    pixel nearest to the forward projection of that picture coordinate, expected at the exact coordinate of the pixel
  const smooth = SCENE.panels.find((p) => p.filter === "linear");
  const inSmooth = cells.filter((c) => c.key === smooth.name && c.margin >= 1.5);
  const chosen = new Set();
  for (const [kind, rows, cols, label] of [
    ["centre", 4, 4, (c, r) => `texel ${c},${r} centre`],
    ["between two texels in a row", 4, 3, (c, r) => `between texels ${c},${r} and ${c + 1},${r}`],
    ["between two texels in a column", 3, 4, (c, r) => `between texels ${c},${r} and ${c},${r + 1}`],
    ["between four texels", 3, 3, (c, r) => `between texels ${c},${r} ${c + 1},${r} ${c},${r + 1} ${c + 1},${r + 1}`],
  ]) {
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const u = kind === "centre" || kind === "between two texels in a column" ? (c + 0.5) / 4 : (c + 1) / 4;
        const v = kind === "centre" || kind === "between two texels in a row" ? (r + 0.5) / 4 : (r + 1) / 4;
        const at = project(worldOf(smooth, u, v));
        const pick = nearestTo(inSmooth.filter((cell) => !chosen.has(`${cell.x},${cell.y}`)), at.x, at.y);
        if (pick === null || pick.distance > 1.5) {
          problems.push(`${smooth.name} ${kind} ${c},${r}: no pixel within 1.5 pixels`);
          continue;
        }
        chosen.add(`${pick.x},${pick.y}`);
        push(pick, `${smooth.name}: ${label(c, r)}`, 3, smooth.name);
      }
    }
  }

  // 2b. the outer half texels of the smooth panel: coordinates 1/16 and 15/16, where clamping gives the edge texel and wrapping would
  //     blend it with the texel on the opposite edge
  for (let k = 0; k < 4; k += 1) {
    for (const [side, u, v] of [
      ["left", 1 / 16, (k + 0.5) / 4],
      ["right", 15 / 16, (k + 0.5) / 4],
      ["top", (k + 0.5) / 4, 1 / 16],
      ["bottom", (k + 0.5) / 4, 15 / 16],
    ]) {
      const at = project(worldOf(smooth, u, v));
      const pick = nearestTo(inSmooth.filter((cell) => !chosen.has(`${cell.x},${cell.y}`)), at.x, at.y);
      if (pick === null || pick.distance > 1.5) {
        problems.push(`${smooth.name} outer ${side} ${k}: no pixel within 1.5 pixels`);
        continue;
      }
      chosen.add(`${pick.x},${pick.y}`);
      push(pick, `${smooth.name}: the outer half texel at the ${side} edge, along texel ${k}`, 3, smooth.name);
    }
  }

  // 3. near the borders of the panels: inside (margin 1.5 up to 2.5) and just outside, which pins the silhouette
  for (const panel of SCENE.panels) {
    const inside = cells.filter((c) => c.key.startsWith(panel.name) && c.margin >= 1 && c.panelMargin >= 1.5 && c.panelMargin < 2.5);
    for (const cell of spread(inside, 3, steps)) push(cell, `${panel.name}: near its border, inside`, panel.filter === "linear" ? 3 : 2, "borders");
    const outside = cells.filter((c) => c.key === "clear" && c.margin >= 1.5 && c.margin < 2.5 && nearestPanel(c) === panel.name);
    for (const cell of spread(outside, 3, steps)) push(cell, `just outside ${panel.name}`, 2, "borders");
  }

  // 4. the clear colour
  const clear = (byKey.get("clear") ?? []).filter((c) => c.margin >= 3);
  for (const cell of spread(clear, 8, steps)) push(cell, "the clear colour", 2, "clear");
  return { steps, problems };
}

/** The name of the panel whose centre is nearest to a cell, by the forward projection (only used to label border pixels). */
function nearestPanel(cell) {
  let best = "";
  let bestDistance = Infinity;
  for (const panel of SCENE.panels) {
    const at = project([panel.cx, 0, panel.cz]);
    const d = Math.hypot(at.x - cell.x - 0.5, at.y - cell.y - 0.5);
    if (d < bestDistance) {
      bestDistance = d;
      best = panel.name;
    }
  }
  return best;
}

function drawMap() {
  const cells = survey();
  const glyph = (cell) => {
    if (cell.key === "clear") return ".";
    const letter = cell.key[0].toLowerCase();
    return cell.margin >= 1 ? letter.toUpperCase() : letter;
  };
  const lines = [];
  for (let y = 0; y < SIZE; y += 1) {
    let line = "";
    for (let x = 0; x < SIZE; x += 1) line += glyph(cells[y * SIZE + x]);
    lines.push(line);
  }
  return lines.join("\n");
}

const HEADER = [
  "# Expected pixels derived from the scene of the prompt by an independent CPU model",
  "# (evidence/M6/benchmark-texture/derive.mjs, f64; the CPU sampler of tests/browser/support/texture-reference.ts; no three.js and no",
  "# Mtek runtime). The picture is the 4 x 4 swatch.png (sRGB bytes, make-swatch.mjs); its top row lies along the far edge (smaller z) of",
  "# each panel and its left column along the smaller x. A point (x, z) of a panel of side 3.6 centred at (cx, 0, cz) has the picture",
  "# coordinate u = (x - cx) / 3.6 + 1/2, v = (z - cz) / 3.6 + 1/2 (u to the right, v towards the camera). Panels: Plain at (-2, -2), Smooth",
  "# at (2, -2), Tiled at (0, 2), all in the plane y = 0; camera (0, 11, 3) looking at the origin, vertical field of view 0.72, a 128 x 128",
  "# target. A ray through each pixel centre is intersected with the plane y = 0.",
  "# Plain: the picture once, nearest filtering: a texel is shown exactly as stored (decoding the sRGB bytes to linear and encoding them for",
  "# the sRGB target is the identity). Tiled: coordinates times 2, repeat, nearest: the picture twice across and down. Smooth: the picture",
  "# once, linear filtering (bilinear between texel centres, in linear light after decoding, so the midpoint of #bc4020 and #e0a010 is",
  "# sRGB((lin(bc) + lin(e0)) / 2) per channel = #cf7c19, not the mean of the bytes #ce7018), clamped: in the outer half texels the colour is",
  "# that of the edge texel. The expected value of every Smooth pixel is computed at the exact coordinate of its pixel centre.",
  "# Every pixel of a nearest panel is chosen so that the nine points within 1.5 pixels of its centre fall in the same texel; every Smooth",
  "# pixel lies at least 1.5 pixels inside its panel, every border pixel 1.5 to 2.5 pixels inside (or, for the clear colour, outside) a panel,",
  "# so neither rasterisation rules nor the interpolation precision of the coordinates decide a value. The texel-centre pixels are the",
  "# pixels nearest to the forward projection of the texel centres (the view and projection matrices of the runtime ABI), confirmed by the rays.",
  "# Tolerance 2 (nearest panels, clear colour) or 3 (linear filtering: hardware filter weights have limited precision).",
];

function emit({ steps }) {
  const line = (s) => `  { expect_pixel = { x = ${s.x}, y = ${s.y}, color = "${hex(s.rgb)}", tolerance = ${s.tolerance} } },`;
  const out = [...HEADER, 'name = "a textured floor: a picture shown exactly, tiled, and smoothed"', "steps = [", "  { step = 1, dt = 0.016666668 },"];
  let lastGroup = "";
  for (const s of steps) {
    if (s.group !== lastGroup) {
      out.push(`  # ${s.group === "borders" ? "borders of the panels" : s.group === "clear" ? "the clear colour" : `${s.group} panel`}`);
      lastGroup = s.group;
    }
    out.push(`  # ${s.label}`);
    out.push(line(s));
  }
  out.push("]");
  return `${out.join("\n")}\n`;
}

function main(argv) {
  if (argv.includes("--map")) {
    process.stdout.write(`${drawMap()}\n`);
    return 0;
  }
  const result = derive();
  for (const problem of result.problems) process.stderr.write(`problem: ${problem}\n`);
  const text = emit(result);
  const at = argv.indexOf("--write");
  if (at >= 0) writeFileSync(argv[at + 1], text);
  else process.stdout.write(text);
  return result.problems.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) process.exitCode = main(process.argv.slice(2));
