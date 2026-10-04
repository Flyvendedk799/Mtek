// Checks the WGSL citations of tests/semantics/numeric/tolerances.json against the current W3C WGSL
// specification [S5] (task M2-08, decision 0043): every quote must appear verbatim in the spec text (HTML
// superscripts are written as `^` in the quotes; `[…]` marks an omission), and every anchor must be the
// heading of the cited section number. Needs the network, so it is not part of `npm run check`:
//
//   node scripts/check-wgsl-quotes.mjs            (fetches https://www.w3.org/TR/WGSL/)
//   node scripts/check-wgsl-quotes.mjs wgsl.html  (a saved copy)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SPEC_URL = "https://www.w3.org/TR/WGSL/";
const tolerancesPath = fileURLToPath(new URL("../tests/semantics/numeric/tolerances.json", import.meta.url));

const html = process.argv[2] === undefined
  ? await (await fetch(SPEC_URL)).text()
  : readFileSync(process.argv[2], "utf8");

const entities = (text) =>
  text
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&");
const normalise = (text) => text.replace(/\|/g, " ").replace(/\s+/g, " ").trim();
// Block-level tags separate words; inline tags (<a>, <var>, <sup>, …) do not.
const blocks = /<\/?(?:p|li|ul|ol|h\d|div|pre|dt|dd|dl|br|tr|td|th|table|thead|tbody|section|blockquote)\b[^>]*>/gi;
const specText = normalise(entities(html.replace(blocks, " ").replace(/<[^>]+>/g, "")));
const status = /<time class="dt-updated" datetime="([^"]+)"/.exec(html)?.[1] ?? "unknown date";

const tolerances = JSON.parse(readFileSync(tolerancesPath, "utf8"));
const problems = [];
let count = 0;
const check = (where, citation) => {
  count++;
  const heading = new RegExp(`data-level="${citation.section.replace(/\./g, "\\.")}" id="${citation.anchor}"`);
  if (!heading.test(html)) problems.push(`${where}: no heading ${citation.section} with anchor #${citation.anchor}`);
  let from = 0;
  for (const part of citation.quote.split("[…]").map((p) => normalise(p.replace(/\^/g, ""))).filter((p) => p !== "")) {
    const at = specText.indexOf(part, from);
    if (at < 0) {
      problems.push(`${where}: quote not found: ${JSON.stringify(part)}`);
      return;
    }
    from = at + part.length;
  }
};
for (const rule of tolerances.rules) check(`rule ${rule.id}`, rule);
for (const entry of tolerances.entries) for (const citation of entry.cite) check(entry.key, citation);

console.log(`WGSL of ${status}: ${count} citations checked, ${problems.length} problems`);
for (const problem of problems) console.log(`  ${problem}`);
process.exitCode = problems.length === 0 ? 0 : 1;
