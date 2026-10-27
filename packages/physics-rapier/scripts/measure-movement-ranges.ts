// Measures the operating ranges of character movement on the real Rapier adapter (decision 0215).
//
//   npm run ranges       -w @mtek/physics-rapier   writes evidence/movement/operating-ranges.json and regenerates the
//                                                  table between the movement-ranges markers of spec/physics.md
//   npm run ranges:check -w @mtek/physics-rapier   fails when either differs from a fresh run
//   node scripts/measure-movement-ranges.ts --cost  also prints the wall-clock cost of moveCharacter (never committed)
//
// Runs under Node's built-in type stripping (Node >= 22.18); CPU only, no browser. The document has no timings, absolute
// paths or clocks, and its key order is fixed, so a fresh run on the same Rapier build is byte-identical.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadBackend } from "../src/movement-harness.ts";
import { measureRanges, moveCost } from "../src/movement-ranges.ts";
import { TABLE_BEGIN, TABLE_END, renderTable } from "../src/movement-table.ts";

const root = resolve(import.meta.dirname, "..", "..", "..");
const jsonPath = resolve(root, "evidence", "movement", "operating-ranges.json");
const specPath = resolve(root, "spec", "physics.md");

const check = process.argv.includes("--check");
const cost = process.argv.includes("--cost");

const backend = await loadBackend();
const doc = measureRanges(backend);
const json = `${JSON.stringify(doc, null, 2)}\n`;
const table = renderTable(doc);

/** `spec` with the text between the markers replaced by `table`; throws when the markers are missing. */
function withTable(spec: string, table: string): string {
  const begin = spec.indexOf(TABLE_BEGIN);
  const end = spec.indexOf(TABLE_END);
  if (begin < 0 || end < begin) throw new Error(`spec/physics.md has no ${TABLE_BEGIN} ... ${TABLE_END} block`);
  return `${spec.slice(0, begin + TABLE_BEGIN.length)}\n${table}\n${spec.slice(end)}`;
}

const spec = readFileSync(specPath, "utf8");
const nextSpec = withTable(spec, table);

if (check) {
  const problems: string[] = [];
  const committed = existsSync(jsonPath) ? readFileSync(jsonPath, "utf8") : undefined;
  if (committed !== json) problems.push("evidence/movement/operating-ranges.json differs from a fresh measurement");
  if (spec !== nextSpec) problems.push("the movement-ranges table in spec/physics.md differs from the one generated from a fresh measurement");
  if (problems.length > 0) {
    console.error(`${problems.join("\n")}\nrun: npm run ranges -w @mtek/physics-rapier  (and review the change: it is a behaviour change of the adapter)`);
    process.exit(1);
  }
  console.log("movement operating ranges: committed document and spec table match a fresh measurement");
} else {
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, json, "utf8");
  writeFileSync(specPath, nextSpec, "utf8");
  console.log("wrote evidence/movement/operating-ranges.json and the table in spec/physics.md");
}

if (cost) {
  for (const shape of ["capsule", "sphere", "box"] as const) {
    const c = moveCost(backend, shape);
    console.log(`${shape}: ${c.characters} characters, ${c.calls} moveCharacter calls: ${c.microsecondsPerCall} us per call, ${c.microsecondsPerCharacterTick} us per character and tick (moves, targets and world.step)`);
  }
}
