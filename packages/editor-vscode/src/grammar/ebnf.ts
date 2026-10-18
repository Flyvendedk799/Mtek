// Reads the lexical lists the highlighter needs out of `spec/grammar.ebnf` (the text that
// `mtek grammar export --format ebnf` prints; decision 0073). Nothing else of the language is
// read from anywhere: the keywords, the reserved words, the punctuation and operators and the
// contextual words are exactly the ones of that file.

/** What the TextMate grammar generator takes from the reference grammar. */
export interface GrammarSource {
  /** The `Keyword` production, in file order. */
  readonly keywords: readonly string[];
  /** The `Reserved` production, in file order. */
  readonly reserved: readonly string[];
  /** The punctuation and operators of the lexical grammar (the first list of the comment after `Bool`). */
  readonly punctuation: readonly string[];
  /** The operators "the lexer also recognises" only to reject them with `E1901`. */
  readonly bitwise: readonly string[];
  /** The contextual words, each with the grammar rule that gives it a meaning. */
  readonly contextual: readonly ContextualWord[];
}

export interface ContextualWord {
  readonly word: string;
  /** `SceneObject`, `LifecycleFn`, `StageFn` or `Import`. */
  readonly rule: string;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** The text of one production: from its name at the start of a line to the next blank line. */
function productionBody(text: string, name: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^${name}\\s*::=`).test(line));
  if (start < 0) throw new Error(`spec/grammar.ebnf has no production \`${name}\``);
  const body: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.trim() === "") break;
    body.push(line);
  }
  return body.join("\n");
}

function quotedWords(text: string): string[] {
  return [...stripComments(text).matchAll(/'([^']+)'/g)].map((m) => m[1] ?? "");
}

/** The `/* ... *\/` comment that starts the first line after the one containing `marker`. */
function commentAfter(text: string, marker: string): string {
  const at = text.indexOf(marker);
  if (at < 0) throw new Error(`spec/grammar.ebnf has no comment \`${marker}\``);
  const open = text.indexOf("/*", at + marker.length);
  const close = text.indexOf("*/", open);
  if (open < 0 || close < 0) throw new Error(`the comment after \`${marker}\` is not closed`);
  return text.slice(open + 2, close);
}

export function parseGrammarSource(ebnf: string): GrammarSource {
  const keywords = quotedWords(productionBody(ebnf, "Keyword"));
  const reserved = quotedWords(productionBody(ebnf, "Reserved"));

  const punctuationComment = commentAfter(ebnf, "/* Punctuation and operators */");
  const split = punctuationComment.split(/The lexer also recognises/);
  if (split.length !== 2) {
    throw new Error("the punctuation comment does not say what the lexer also recognises");
  }
  const [listed, rest] = split as [string, string];
  const rejected = rest.split(/so they can be rejected/)[0] ?? "";
  const tokens = (part: string): string[] => part.split(/\s+/).filter((token) => token !== "");
  const punctuation = tokens(listed);
  const bitwise = tokens(rejected);

  const contextual: ContextualWord[] = [];
  const start = ebnf.indexOf("Contextual words");
  if (start < 0) throw new Error("spec/grammar.ebnf has no `Contextual words` comment");
  const end = ebnf.indexOf("*/", start);
  for (const line of ebnf.slice(start, end).split(/\r?\n/)) {
    const match = /^\s*((?:'[a-z_]+'(?:,\s*)?)+)\s+.*\((\w+)\)\s*$/.exec(line);
    if (match === null) continue;
    for (const word of quotedWords(match[1] ?? "")) {
      contextual.push({ word, rule: match[2] ?? "" });
    }
  }

  const source = { keywords, reserved, punctuation, bitwise, contextual };
  for (const [name, list] of Object.entries(source)) {
    if (list.length === 0) throw new Error(`nothing was read for \`${name}\` from spec/grammar.ebnf`);
  }
  return source;
}
