// The grammar over the whole `.mtek` corpus of the repository (everything but benchmarks/holdout/):
// no tokenizer crash, every line is covered by tokens, no line is abandoned for taking too long.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { IGrammar } from "vscode-textmate";
import { REPO_ROOT, corpusFiles, loadGrammar, tokenizeText } from "./testing.ts";

/** Directories whose sources are valid Mtek: nothing in them may be scoped `invalid.illegal`. */
const VALID_SOURCES = [
  "examples/",
  "benchmarks/tasks/",
  "tests/syntax/pass/",
  "tests/browser/",
  "tests/codegen/",
  "tests/modules/",
];

describe("the grammar over the corpus", () => {
  let grammar: IGrammar;
  const files = corpusFiles();
  beforeAll(async () => {
    grammar = await loadGrammar();
  });

  it("finds the corpus (examples, tests, benchmark tasks) and not the holdout", () => {
    expect(files.length).toBeGreaterThan(900);
    for (const directory of ["examples/", "tests/syntax/", "tests/semantics/", "benchmarks/tasks/"]) {
      expect(files.some((file) => file.startsWith(directory)), directory).toBe(true);
    }
    expect(files.some((file) => file.startsWith("benchmarks/holdout/"))).toBe(false);
  });

  it("tokenizes every line of every file", () => {
    let lines = 0;
    const problems: string[] = [];
    for (const file of files) {
      const text = readFileSync(join(REPO_ROOT, file), "utf8");
      const tokenized = tokenizeText(grammar, text);
      lines += tokenized.length;
      tokenized.forEach((line, index) => {
        if (!line.covering) problems.push(`${file}:${index + 1} tokens do not cover the line`);
        if (line.stoppedEarly) problems.push(`${file}:${index + 1} tokenization stopped early`);
      });
    }
    expect(problems).toEqual([]);
    // The size of what was checked is part of the result: a corpus that shrank to nothing passes
    // nothing.
    expect(lines).toBeGreaterThan(10_000);
  });

  it("scopes nothing of a valid source as invalid", () => {
    const problems: string[] = [];
    let checked = 0;
    for (const file of files.filter((f) => VALID_SOURCES.some((prefix) => f.startsWith(prefix)))) {
      checked += 1;
      const text = readFileSync(join(REPO_ROOT, file), "utf8");
      tokenizeText(grammar, text).forEach((line, index) => {
        for (const token of line.tokens) {
          const bad = token.scopes.find((scope) => scope.startsWith("invalid.illegal"));
          if (bad !== undefined) problems.push(`${file}:${index + 1} ${JSON.stringify(token.text)} ${bad}`);
        }
      });
    }
    expect(problems.slice(0, 20)).toEqual([]);
    expect(checked).toBeGreaterThan(100);
  });
});
