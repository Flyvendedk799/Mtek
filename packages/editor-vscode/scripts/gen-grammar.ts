// Generates `syntaxes/mtek.tmLanguage.json` from `spec/grammar.ebnf` and `src/grammar/builtins.ts`.
//
//   npm run gen:grammar   -w mtek-vscode      writes the file
//   npm run check:grammar -w mtek-vscode      regenerates in memory, fails if the file differs
//
// Runs under Node 24's built-in type stripping.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BUILTINS } from "../src/grammar/builtins.ts";
import { parseGrammarSource } from "../src/grammar/ebnf.ts";
import { generateGrammar, renderGrammar } from "../src/grammar/generate.ts";

const packageRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageRoot, "..", "..");
const grammarPath = resolve(repoRoot, "spec", "grammar.ebnf");
const outputPath = resolve(packageRoot, "syntaxes", "mtek.tmLanguage.json");

const source = parseGrammarSource(readFileSync(grammarPath, "utf8"));
const text = renderGrammar(generateGrammar(source, BUILTINS));

if (process.argv.includes("--check")) {
  let committed = "";
  try {
    committed = readFileSync(outputPath, "utf8");
  } catch {
    // reported below as a difference
  }
  if (committed !== text) {
    console.error(
      "syntaxes/mtek.tmLanguage.json is not what scripts/gen-grammar.ts generates; run `npm run gen:grammar -w mtek-vscode` and commit the result.",
    );
    process.exit(1);
  }
  console.log("syntaxes/mtek.tmLanguage.json is up to date.");
} else {
  writeFileSync(outputPath, text, "utf8");
  console.log(`wrote ${outputPath}`);
}
