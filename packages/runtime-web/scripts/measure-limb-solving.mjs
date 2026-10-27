// Measures the anatomical limb solver (decision 0222) and keeps its two outputs in step with the engine:
//
//   evidence/animation/limb-solving.json   every measurement (deterministic, no absolute paths)
//   spec/animation.md                      the table between <!-- limb-solving:begin --> and <!-- limb-solving:end -->
//
//   node packages/runtime-web/scripts/measure-limb-solving.mjs --write   measure, then rewrite both files
//   node packages/runtime-web/scripts/measure-limb-solving.mjs --check   measure, then fail when a file differs
//
// (`npm run limbs:write`, `npm run limbs:check`.) The measurements run on src/scene/limb-ik.ts through SkeletonPlayer
// (bundled in memory with esbuild), so the numbers are those of the code that the runtime ships.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const EVIDENCE = "evidence/animation/limb-solving.json";
const SPEC = "spec/animation.md";
const BEGIN = "<!-- limb-solving:begin -->";
const END = "<!-- limb-solving:end -->";

const mode = process.argv[2];
if (mode !== "--write" && mode !== "--check") {
  console.error("usage: measure-limb-solving.mjs --write | --check");
  process.exit(2);
}

const lf = (text) => text.replace(/\r\n/g, "\n");
const read = (path) => {
  try {
    return lf(readFileSync(resolve(root, path), "utf8"));
  } catch {
    return undefined;
  }
};

const bundle = await build({
  entryPoints: [resolve(root, "packages/runtime-web/src/scene/limb-evidence.ts")],
  bundle: true, write: false, format: "esm", platform: "node", target: "es2022", define: { __MTEK_DEV__: "true" }, logLevel: "error",
});
const code = bundle.outputFiles[0].text;
const { buildEvidence, formatEvidence, renderTable } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

const evidence = buildEvidence();
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
  console.log(`wrote ${EVIDENCE} and the measurement table of ${SPEC}`);
} else {
  const stale = [
    ...(read(EVIDENCE) === evidenceText ? [] : [EVIDENCE]),
    ...(spec === specText ? [] : [`${SPEC} (the limb-solving table)`]),
  ];
  if (stale.length > 0) {
    console.error(`limbs:check failed: ${stale.join(" and ")} differ from a fresh measurement. Run \`npm run limbs:write\` and review the change.`);
    process.exit(1);
  }
  console.log("limbs:check passed: the evidence file and the table match a fresh measurement");
}
