// Derives the `mtek-tests/*.test.toml` fixture of a scene/rendering task from the scene its prompt describes.
//
//   node evidence/M6/benchmark-scene-rendering/derive.mjs <task-id> [--map] [--write FILE]
//
// Output: the fixture text (stdout, or FILE). `--map` prints a map of the surfaces the oracle sees instead.
// Nothing here reads a reference solution or runs a browser: the expected colours come from oracle.mjs.
//
// Pixel choice (deterministic):
//   1. "centre of E": the projected centre of every entity with a shape, whatever is there. For an entity that is
//      visible and unobstructed that is the entity's colour; for a hidden, clipped, hidden-behind or culled entity
//      it is what the scene shows instead, which is the point of the check ("where Ghost would be").
//   2. for every surface (an entity, or one face of a box) and for the clear colour: pixels whose rays up to
//      3 pixels around them all hit the same surface ("inside", a few, spread out by farthest-point sampling), and a
//      few 1.5 to 2.25 pixels from the boundary ("near edge", inside the surface and outside it), which pins the
//      silhouette to about a pixel without depending on rasterisation rules.
import { writeFileSync } from "node:fs";
import { meta, scenes } from "./scenes.mjs";
import { colourAt, margin, prepare, project, SIZE, survey } from "./oracle.mjs";

const hex = (rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

/** Farthest-point sampling: `count` cells of `candidates`, far from each other and from `taken`. */
function farthest(candidates, count, taken = []) {
  const picked = [];
  const pool = candidates.slice();
  if (pool.length === 0) return picked;
  if (taken.length === 0) {
    pool.sort((a, b) => b.margin - a.margin || a.y - b.y || a.x - b.x);
    picked.push(pool.shift());
  }
  while (picked.length < count && pool.length > 0) {
    const anchors = [...taken, ...picked];
    let bestIndex = 0;
    let bestDistance = -1;
    for (const [index, cell] of pool.entries()) {
      const nearest = Math.min(...anchors.map((a) => Math.hypot(a.x - cell.x, a.y - cell.y)));
      if (nearest > bestDistance) {
        bestDistance = nearest;
        bestIndex = index;
      }
    }
    picked.push(pool.splice(bestIndex, 1)[0]);
  }
  return picked;
}

function chooseRegions(cells, taken) {
  const keys = [...new Set(cells.filter((c) => c.key !== "ambiguous").map((c) => c.key))].sort((a, b) =>
    a === "clear" ? -1 : b === "clear" ? 1 : a.localeCompare(b),
  );
  const regions = [];
  for (const key of keys) {
    const region = cells.filter((c) => c.key === key);
    const interior = region.filter((c) => c.margin >= 3);
    const edge = region.filter((c) => c.margin >= 1.5 && c.margin < 3);
    const wanted = key === "clear" ? 5 : Math.max(1, Math.min(5, Math.round(Math.sqrt(interior.length) / 3)));
    const inside = farthest(interior, wanted, taken);
    const near = farthest(edge, key === "clear" ? 4 : 2, [...taken, ...inside]);
    if (inside.length + near.length > 0) regions.push({ key, inside, near });
  }
  return regions;
}

/** The projected centre of every entity with a shape, as a fixture probe (see 1. above). */
function centreProbes(prepared) {
  const { scene, worlds } = prepared;
  const probes = [];
  for (const [index, entity] of scene.entities.entries()) {
    if (entity.mesh === undefined) continue;
    const m = worlds[index];
    const at = project(scene.camera, [m[12], m[13], m[14]]);
    if (!(at.depth > 0)) continue; // behind the camera: it has no pixel
    const x = Math.floor(at.x);
    const y = Math.floor(at.y);
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
    const m2 = margin(prepared, x, y);
    if (m2.key === "ambiguous" || m2.margin < 2.25) {
      console.error(`${entity.name}: the projected centre (${x}, ${y}) is too close to a boundary (margin ${m2.margin}); skipped`);
      continue;
    }
    const shows = m2.key === "clear" ? "the clear colour" : m2.key;
    const label = m2.key.split(" ")[0] === entity.name ? `centre of ${entity.name}` : `where the centre of ${entity.name} projects: ${shows}`;
    probes.push({ x, y, rgb: colourAt(prepared, x, y).rgb, label, key: m2.key });
  }
  return probes;
}

function drawMap(cells) {
  const keys = [...new Set(cells.map((c) => c.key))].sort();
  const glyph = new Map(keys.map((key, i) => [key, key === "clear" ? "." : key === "ambiguous" ? "?" : "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[i % 26]]));
  const lines = [];
  for (let y = 0; y < SIZE; y += 2) {
    let line = "";
    for (let x = 0; x < SIZE; x += 1) line += glyph.get(cells[y * SIZE + x].key);
    lines.push(line);
  }
  return `${lines.join("\n")}\n${keys.map((key) => `${glyph.get(key)} = ${key}`).join("\n")}`;
}

function emit(taskId, probes, regions, tolerance) {
  const info = meta[taskId];
  const line = (c) => `  { expect_pixel = { x = ${c.x}, y = ${c.y}, color = "${hex(c.rgb)}", tolerance = ${c.key === "clear" ? 2 : tolerance} } },`;
  const out = [
    "# Expected pixels derived from the scene of the prompt by an independent CPU ray caster",
    "# (evidence/M6/benchmark-scene-rendering/derive.mjs and oracle.mjs: f64, entry-point ray casts, no three.js and no Mtek",
    "# runtime; lit surfaces shaded with the CPU oracle of spec/materials.md section 8). Every sampled pixel lies in a",
    '# surface whose boundary is at least 3 pixels away ("inside") or 1.5 to 2.25 pixels away ("near edge"), so neither',
    "# rasterisation rules nor the tessellation of a sphere decide a value.",
    ...info.notes.map((text) => `# ${text}`),
    `name = ${JSON.stringify(info.name)}`,
    "steps = [",
    "  { step = 1, dt = 0.016666668 },",
  ];
  for (const probe of probes) {
    out.push(`  # ${probe.label}`);
    out.push(line(probe));
  }
  for (const region of regions) {
    out.push(`  # ${region.key === "clear" ? "the clear colour" : region.key}`);
    for (const c of region.inside) out.push(line(c));
    if (region.near.length > 0) out.push("  # near the boundary");
    for (const c of region.near) out.push(line(c));
  }
  out.push("]");
  return `${out.join("\n")}\n`;
}

const [taskId, ...flags] = process.argv.slice(2);
const scene = scenes[taskId];
if (scene === undefined) {
  console.error(`usage: derive.mjs <${Object.keys(scenes).join("|")}> [--map] [--write FILE]`);
  process.exit(2);
}
const prepared = prepare(scene);
const cells = survey(prepared);
if (flags.includes("--map")) {
  console.log(drawMap(cells));
} else {
  const probes = centreProbes(prepared);
  const regions = chooseRegions(cells, probes);
  const text = emit(taskId, probes, regions, meta[taskId].tolerance ?? 2);
  const at = flags.indexOf("--write");
  if (at >= 0) writeFileSync(flags[at + 1], text);
  else process.stdout.write(text);
}
