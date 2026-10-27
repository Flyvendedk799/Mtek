// Measures the continuous-collision lane matrix (decision 0216) on the real Rapier adapter and keeps its two outputs
// in step with the engine:
//
//   evidence/movement/ccd-lanes.json   the full matrix and the fine scan (deterministic, no absolute paths)
//   spec/physics.md                    the table between <!-- ccd-lanes:begin --> and <!-- ccd-lanes:end -->
//
//   node packages/physics-rapier/scripts/measure-ccd-lanes.ts --write   measure, then rewrite both files
//   node packages/physics-rapier/scripts/measure-ccd-lanes.ts --check   measure, then fail when a file differs
//
// (`npm run ccd:write`, `npm run ccd:check`.) The lanes run on `src/backend.ts` itself, through Node's type
// stripping, so the numbers are those of the adapter that the bundle ships.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import RAPIER from "@dimforge/rapier3d-compat";
import { rapierBackend } from "../src/backend.ts";
import { buildEvidence, formatEvidence, renderTable } from "../src/ccd-lanes.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const EVIDENCE = "evidence/movement/ccd-lanes.json";
const SPEC = "spec/physics.md";
const BEGIN = "<!-- ccd-lanes:begin -->";
const END = "<!-- ccd-lanes:end -->";

const mode = process.argv[2];
if (mode !== "--write" && mode !== "--check") {
  console.error("usage: measure-ccd-lanes.ts --write | --check");
  process.exit(2);
}

const lf = (text: string): string => text.replace(/\r\n/g, "\n");
const read = (path: string): string | undefined => {
  try {
    return lf(readFileSync(resolve(root, path), "utf8"));
  } catch {
    return undefined;
  }
};

await RAPIER.init();
const evidence = buildEvidence(rapierBackend);
const evidenceText = formatEvidence(evidence);
const table = renderTable(evidence);

const spec = read(SPEC);
if (spec === undefined) throw new Error(`${SPEC} is missing`);
const begin = spec.indexOf(BEGIN);
const end = spec.indexOf(END);
if (begin < 0 || end < begin) throw new Error(`${SPEC} has no ${BEGIN} ... ${END} block`);
const specText = `${spec.slice(0, begin + BEGIN.length)}\n${table}\n${spec.slice(end)}`;

if (mode === "--write") {
  mkdirSync(dirname(resolve(root, EVIDENCE)), { recursive: true });
  writeFileSync(resolve(root, EVIDENCE), evidenceText, "utf8");
  writeFileSync(resolve(root, SPEC), specText, "utf8");
  console.log(`wrote ${EVIDENCE} and the lane table of ${SPEC}`);
} else {
  const stale = [
    ...(read(EVIDENCE) === evidenceText ? [] : [EVIDENCE]),
    ...(spec === specText ? [] : [`${SPEC} (the ccd-lanes table)`]),
  ];
  if (stale.length > 0) {
    console.error(`ccd:check failed: ${stale.join(" and ")} differ from a fresh measurement. Run \`npm run ccd:write\` and review the change.`);
    process.exit(1);
  }
  console.log("ccd:check passed: the evidence file and the lane table match a fresh measurement");
}
