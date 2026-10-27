// Measures automatic humanoid mapping and retargeting (decision 0221) and keeps its two outputs in step with the code:
//
//   evidence/animation/humanoid-retarget.json   the mapping rows and the retarget measurements (deterministic, no absolute paths)
//   spec/animation.md                           the tables between <!-- humanoid-retarget:begin --> and <!-- humanoid-retarget:end -->
//
//   node packages/runtime-web/scripts/measure-humanoid-retarget.ts --write   measure, then rewrite both files
//   node packages/runtime-web/scripts/measure-humanoid-retarget.ts --check   measure, then fail when a file differs
//
// (`npm run humanoid:write`, `npm run humanoid:check`.) The measurements run on the sources in src/ themselves: esbuild
// bundles the evidence module (which uses the humanoid mapper and retargeter and the synthetic fixtures) for Node.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const EVIDENCE = "evidence/animation/humanoid-retarget.json";
const SPEC = "spec/animation.md";
const BEGIN = "<!-- humanoid-retarget:begin -->";
const END = "<!-- humanoid-retarget:end -->";

const mode = process.argv[2];
if (mode !== "--write" && mode !== "--check") {
  console.error("usage: measure-humanoid-retarget.ts --write | --check");
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

const bundle = await build({
  entryPoints: [resolve(root, "packages/runtime-web/src/test-support/humanoid-evidence.ts")],
  bundle: true, write: false, platform: "node", format: "esm", target: "node22", logLevel: "error",
});
const { buildEvidence, formatEvidence, renderTables } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString("base64")}`);
const evidence = buildEvidence(root);
const evidenceText: string = formatEvidence(evidence);
const table: string = renderTables(evidence);

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
  console.log(`wrote ${EVIDENCE} and the measurement tables of ${SPEC}`);
} else {
  const stale = [
    ...(read(EVIDENCE) === evidenceText ? [] : [EVIDENCE]),
    ...(spec === specText ? [] : [`${SPEC} (the humanoid-retarget tables)`]),
  ];
  if (stale.length > 0) {
    console.error(`stale: ${stale.join(", ")}\nrun: npm run humanoid:write`);
    process.exit(1);
  }
  console.log("humanoid retarget evidence is current");
}
