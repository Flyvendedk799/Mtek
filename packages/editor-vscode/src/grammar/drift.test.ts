// The grammar must not drift from the language. Four sources are compared:
//   - `spec/grammar.ebnf` (what the generator reads),
//   - the compiler's own lists (`KEYWORDS`, `RESERVED_WORDS`, `PUNCTUATION` of the lexer),
//   - `mtek grammar export --format ebnf` (the grammar model of decision 0073, a test of the
//     compiler keeps it equal to the file; checked here too, through the real binary),
//   - `mtek context` (the registry's names, for `builtins.ts`),
// and the committed `syntaxes/mtek.tmLanguage.json` against a regeneration.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { IGrammar } from "vscode-textmate";
import { BUILTINS } from "./builtins.ts";
import { parseGrammarSource } from "./ebnf.ts";
import type { GrammarSource } from "./ebnf.ts";
import { generateGrammar, renderGrammar } from "./generate.ts";
import {
  GRAMMAR_PATH,
  REPO_ROOT,
  loadGrammar,
  mtekBinary,
  scopesOf,
  tokenizeText,
} from "./testing.ts";

const ebnfText = readFileSync(join(REPO_ROOT, "spec", "grammar.ebnf"), "utf8");
const source: GrammarSource = parseGrammarSource(ebnfText);

/** The first string literal of every entry of `pub const NAME ... ];` in the lexer's token table. */
function rustList(name: string): string[] {
  const text = readFileSync(
    join(REPO_ROOT, "crates", "mtek-compiler", "src", "syntax", "token.rs"),
    "utf8",
  );
  const start = text.indexOf(`pub const ${name}:`);
  if (start < 0) throw new Error(`token.rs has no \`${name}\``);
  const end = text.indexOf("\n];", start);
  const out: string[] = [];
  for (const line of text.slice(start, end).split("\n").slice(1)) {
    const match = /^\s*\(?"((?:[^"\\]|\\.)*)"/.exec(line);
    if (match !== null) out.push(match[1] ?? "");
  }
  return out;
}

const sorted = (list: readonly string[]): string[] => [...list].sort();

describe("spec/grammar.ebnf and the compiler's lexer", () => {
  it("lists the same keywords", () => {
    expect(sorted(source.keywords)).toEqual(sorted(rustList("KEYWORDS")));
  });

  it("lists the same reserved words", () => {
    expect(sorted(source.reserved)).toEqual(sorted(rustList("RESERVED_WORDS")));
  });

  it("lists the same punctuation and operators, the bitwise ones included", () => {
    expect(sorted([...source.punctuation, ...source.bitwise])).toEqual(
      sorted(rustList("PUNCTUATION")),
    );
  });

  it("is what `mtek grammar export --format ebnf` prints", () => {
    const printed = execFileSync(mtekBinary(), ["grammar", "export", "--format", "ebnf"], {
      encoding: "utf8",
    });
    expect(printed).toBe(ebnfText);
  });
});

describe("builtins.ts and the registry", () => {
  it("names exactly what `mtek context` says the compiler supports", () => {
    const entry = join(REPO_ROOT, "examples", "pulse-cube", "src", "main.mtek");
    const context = JSON.parse(
      execFileSync(mtekBinary(), ["context", "--entry", entry, "--max-bytes", "10000000"], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      }),
    ) as { supported: { features: string[] } };
    const rows = (kind: string): string[] =>
      context.supported.features
        .filter((feature) => feature.startsWith(`${kind}:`))
        .map((feature) => feature.slice(kind.length + 1));
    const dotted = (list: readonly { namespace: string; name: string }[]): string[] =>
      list.map(({ namespace, name }) => `${namespace}.${name}`);

    expect(sorted(BUILTINS.types)).toEqual(sorted(rows("type")));
    expect(sorted(BUILTINS.schemas)).toEqual(sorted(rows("schema")));
    expect(sorted(BUILTINS.enums)).toEqual(sorted(rows("enum")));
    expect(sorted(BUILTINS.namespaces)).toEqual(sorted(rows("namespace")));
    expect(sorted(BUILTINS.events)).toEqual(sorted(rows("event")));
    expect(sorted(BUILTINS.sceneObjects)).toEqual(sorted(rows("scene-object")));
    const functions = rows("function");
    expect(sorted(BUILTINS.functions)).toEqual(sorted(functions.filter((f) => !f.includes("."))));
    expect(sorted(dotted(BUILTINS.namespaceFunctions))).toEqual(
      sorted(functions.filter((f) => f.includes("."))),
    );
    expect(sorted(dotted(BUILTINS.namespaceValues))).toEqual(sorted(rows("value")));
  });
});

describe("the committed grammar", () => {
  it("is what scripts/gen-grammar.ts generates", () => {
    expect(readFileSync(GRAMMAR_PATH, "utf8")).toBe(renderGrammar(generateGrammar(source, BUILTINS)));
  });

  describe("covers every token of the language", () => {
    let grammar: IGrammar;
    beforeAll(async () => {
      grammar = await loadGrammar();
    });

    it("scopes each keyword by what it is", () => {
      for (const word of source.keywords) {
        const scopes = scopesOf(tokenizeText(grammar, word), word);
        expect(scopes.length, word).toBeGreaterThan(0);
        expect(
          scopes.some((s) => /^(keyword|storage|constant\.language|variable\.language)\./.test(s)),
          `${word}: ${scopes.join(" ")}`,
        ).toBe(true);
      }
    });

    it("scopes each reserved word as illegal", () => {
      for (const word of source.reserved) {
        const scopes = scopesOf(tokenizeText(grammar, word), word);
        expect(scopes.some((s) => s.startsWith("invalid.illegal.reserved-word.")), word).toBe(true);
      }
    });

    it("scopes each punctuation and operator token (and the illegal bitwise ones) with a scope of its own", () => {
      for (const token of [...source.punctuation, ...source.bitwise]) {
        // between two names, so that no rule that looks at the line start or end decides
        const text = `a ${token} b`;
        const scopes = scopesOf(tokenizeText(grammar, text), token);
        expect(
          scopes.some((s) => /^(keyword\.operator|punctuation|invalid\.illegal\.operator)\./.test(s)),
          `${token}: ${scopes.join(" ")}`,
        ).toBe(true);
      }
    });
  });
});
