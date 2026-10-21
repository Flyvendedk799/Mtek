// The TextMate grammar of Mtek, generated from the lexical lists of `spec/grammar.ebnf`
// (`parseGrammarSource`) and the registry names of `builtins.ts`. Run by
// `scripts/gen-grammar.ts`; the result is committed as `syntaxes/mtek.tmLanguage.json` and a test
// regenerates it and compares.
//
// A grammar for highlighting is not a parser: where the language needs a parser to tell two
// things apart, the scope is chosen by position and by the naming conventions of
// `spec/language.md` section 3.3 (PascalCase names are types, SCREAMING_SNAKE_CASE names are
// constants), and the decision record 0090 lists what that makes wrong. Everything the lexer
// itself decides (comments, strings and their escapes, numbers, colours, keywords, operators) is
// scoped exactly as the lexer reads it, and what the lexer rejects is scoped `invalid.illegal`.
import type { Builtins } from "./builtins.ts";
import type { GrammarSource } from "./ebnf.ts";

export interface TmRule {
  name?: string;
  match?: string;
  begin?: string;
  end?: string;
  captures?: Record<string, { name: string }>;
  beginCaptures?: Record<string, { name: string }>;
  endCaptures?: Record<string, { name: string }>;
  patterns?: TmRule[];
  include?: string;
}

export interface TmGrammar {
  information_for_contributors: string[];
  name: string;
  scopeName: string;
  fileTypes: string[];
  patterns: TmRule[];
  repository: Record<string, TmRule>;
}

/** The scope suffix every scope of this grammar ends in. */
const LANG = "mtek";

/** Keywords that steer control flow. */
const CONTROL = ["break", "continue", "else", "for", "if", "in", "match", "return", "while"];
/** Keywords that start a declaration or a member. */
const DECLARATION = [
  "const",
  "entity",
  "enum",
  "fn",
  "let",
  "material",
  "on",
  "param",
  "prefab",
  "scene",
  "state",
  "struct",
  "var",
  "bind",
];
const MODIFIER = ["cpu", "export"];
const IMPORT = ["import"];
const SELF = ["self"];
const BOOLEAN = ["true", "false"];

/** Declaration keywords followed by the name they declare, and the scope of that name. */
const DECLARES_NAME: Record<string, string> = {
  fn: `entity.name.function.${LANG}`,
  struct: `entity.name.type.struct.${LANG}`,
  enum: `entity.name.type.enum.${LANG}`,
  material: `entity.name.type.material.${LANG}`,
  scene: `entity.name.type.scene.${LANG}`,
  entity: `entity.name.type.entity.${LANG}`,
  prefab: `entity.name.type.prefab.${LANG}`,
  const: `variable.other.constant.declaration.${LANG}`,
  let: `variable.other.declaration.${LANG}`,
  var: `variable.other.declaration.${LANG}`,
  state: `variable.other.declaration.${LANG}`,
  param: `variable.other.declaration.${LANG}`,
};

const OPERATOR_SCOPES: Record<string, string> = {
  "->": `keyword.operator.arrow.${LANG}`,
  "=>": `keyword.operator.arrow.${LANG}`,
  "..": `keyword.operator.range.${LANG}`,
  "==": `keyword.operator.comparison.${LANG}`,
  "!=": `keyword.operator.comparison.${LANG}`,
  "<=": `keyword.operator.comparison.${LANG}`,
  ">=": `keyword.operator.comparison.${LANG}`,
  "<": `keyword.operator.comparison.${LANG}`,
  ">": `keyword.operator.comparison.${LANG}`,
  "&&": `keyword.operator.logical.${LANG}`,
  "||": `keyword.operator.logical.${LANG}`,
  "!": `keyword.operator.logical.${LANG}`,
  "=": `keyword.operator.assignment.${LANG}`,
  "+=": `keyword.operator.assignment.compound.${LANG}`,
  "-=": `keyword.operator.assignment.compound.${LANG}`,
  "*=": `keyword.operator.assignment.compound.${LANG}`,
  "/=": `keyword.operator.assignment.compound.${LANG}`,
  "+": `keyword.operator.arithmetic.${LANG}`,
  "-": `keyword.operator.arithmetic.${LANG}`,
  "*": `keyword.operator.arithmetic.${LANG}`,
  "/": `keyword.operator.arithmetic.${LANG}`,
  "%": `keyword.operator.arithmetic.${LANG}`,
  ",": `punctuation.separator.comma.${LANG}`,
  ";": `punctuation.terminator.statement.${LANG}`,
  ":": `punctuation.separator.colon.${LANG}`,
  ".": `punctuation.accessor.${LANG}`,
  "{": `punctuation.section.braces.${LANG}`,
  "}": `punctuation.section.braces.${LANG}`,
  "(": `punctuation.section.parens.${LANG}`,
  ")": `punctuation.section.parens.${LANG}`,
  "[": `punctuation.section.brackets.${LANG}`,
  "]": `punctuation.section.brackets.${LANG}`,
};

const BITWISE_SCOPE = `invalid.illegal.operator.bitwise.${LANG}`;

/** The scope of a keyword, by what the keyword does. */
export function keywordScope(word: string): string {
  if (CONTROL.includes(word)) return `keyword.control.${LANG}`;
  if (IMPORT.includes(word)) return `keyword.control.import.${LANG}`;
  if (DECLARATION.includes(word)) return `keyword.other.declaration.${LANG}`;
  if (MODIFIER.includes(word)) return `storage.modifier.${LANG}`;
  if (SELF.includes(word)) return `variable.language.self.${LANG}`;
  if (BOOLEAN.includes(word)) return `constant.language.boolean.${LANG}`;
  throw new Error(
    `the keyword \`${word}\` of spec/grammar.ebnf has no scope: classify it in generate.ts`,
  );
}

function checkWord(word: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(word)) throw new Error(`\`${word}\` is not a word`);
  return word;
}

function reEscape(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");
}

/** An alternation of whole words (the lexer's identifier alphabet bounds them). */
function words(list: readonly string[]): string {
  const sorted = [...new Set(list.map(checkWord))].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  return `(?:${sorted.join("|")})`;
}

/** Not preceded by an identifier character or a dot: the word starts a name. */
const START = "(?<![A-Za-z0-9_.])";
/** Not followed by an identifier character: the word ends a name. */
const END = "(?![A-Za-z0-9_])";
const IDENT = "[A-Za-z_][A-Za-z0-9_]*";

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

export function generateGrammar(source: GrammarSource, builtins: Builtins): TmGrammar {
  // --- classification checks: a token the grammar has and this file does not know is an error ----
  const classified = Object.keys(OPERATOR_SCOPES);
  if (!sameSet(classified, source.punctuation)) {
    const missing = source.punctuation.filter((t) => !classified.includes(t));
    const stale = classified.filter((t) => !source.punctuation.includes(t));
    throw new Error(
      `punctuation of spec/grammar.ebnf and of generate.ts differ: unclassified [${missing.join(" ")}], no longer in the grammar [${stale.join(" ")}]`,
    );
  }
  const keywordWords = [...CONTROL, ...IMPORT, ...DECLARATION, ...MODIFIER, ...SELF, ...BOOLEAN];
  if (!sameSet(keywordWords, source.keywords)) {
    const missing = source.keywords.filter((t) => !keywordWords.includes(t));
    const stale = keywordWords.filter((t) => !source.keywords.includes(t));
    throw new Error(
      `keywords of spec/grammar.ebnf and of generate.ts differ: unclassified [${missing.join(" ")}], no longer in the grammar [${stale.join(" ")}]`,
    );
  }
  const contextual = (rule: string): string[] =>
    source.contextual.filter((c) => c.rule === rule).map((c) => c.word);
  const lifecycle = contextual("LifecycleFn");
  const stage = contextual("StageFn");
  const importWords = contextual("Import");
  const sceneObjectWords = contextual("SceneObject");
  const sharedWords = contextual("StateDecl");
  const timerWords = contextual("TimerStmt");
  for (const [rule, list] of [
    ["LifecycleFn", lifecycle],
    ["StageFn", stage],
    ["Import", importWords],
    ["SceneObject", sceneObjectWords],
    ["StateDecl", sharedWords],
    ["TimerStmt", timerWords],
  ] as const) {
    if (list.length === 0) throw new Error(`no contextual word for the rule ${rule}`);
  }
  if (!sameSet(sceneObjectWords, builtins.sceneObjects)) {
    throw new Error("the scene-object kinds of builtins.ts differ from the contextual words of the grammar");
  }

  const rules: Record<string, TmRule> = {};
  const order: string[] = [];
  const add = (name: string, rule: TmRule): void => {
    rules[name] = rule;
    order.push(name);
  };

  // --- comments ---------------------------------------------------------------------------------
  add("doc-comment", {
    name: `comment.line.documentation.${LANG}`,
    // `///` not followed by a fourth slash (spec/language.md 1.5); a lone CR is not part of a line.
    match: "(///)(?!/)[^\\r\\n]*",
    captures: { "1": { name: `punctuation.definition.comment.${LANG}` } },
  });
  add("line-comment", {
    name: `comment.line.double-slash.${LANG}`,
    match: "(//)[^\\r\\n]*",
    captures: { "1": { name: `punctuation.definition.comment.${LANG}` } },
  });
  // Block comments nest (spec/language.md 1.5): the rule includes itself.
  add("block-comment", {
    name: `comment.block.${LANG}`,
    begin: "/\\*",
    end: "\\*/",
    beginCaptures: { "0": { name: `punctuation.definition.comment.begin.${LANG}` } },
    endCaptures: { "0": { name: `punctuation.definition.comment.end.${LANG}` } },
    patterns: [{ include: "#block-comment" }],
  });

  // --- strings ----------------------------------------------------------------------------------
  add("string", {
    name: `string.quoted.double.${LANG}`,
    begin: '"',
    // A string ends at its closing quote or, unterminated (E0024), at the end of the line.
    end: '"|(?=[\\r\\n])|$',
    beginCaptures: { "0": { name: `punctuation.definition.string.begin.${LANG}` } },
    endCaptures: { "0": { name: `punctuation.definition.string.end.${LANG}` } },
    patterns: [
      {
        name: `constant.character.escape.${LANG}`,
        match: '\\\\(?:["\\\\ntr0]|u\\{[0-9A-Fa-f]{1,6}\\})',
      },
      { name: `invalid.illegal.escape.${LANG}`, match: "\\\\." },
    ],
  });

  // --- colours and numbers ----------------------------------------------------------------------
  add("color", {
    name: `constant.other.color.${LANG}`,
    match: `#(?:[0-9A-Fa-f]{8}|[0-9A-Fa-f]{6})(?![A-Za-z0-9_])`,
  });
  add("color-invalid", {
    // `#fff`, `#12345` ...: any other length is E0025.
    name: `invalid.illegal.color.${LANG}`,
    match: "#[A-Za-z0-9_]*",
  });
  add("float", {
    name: `constant.numeric.float.${LANG}`,
    match: "(?<![A-Za-z0-9_.])(?:0|[1-9][0-9]*)\\.[0-9]+(?:[eE][+-]?[0-9]+)?(?![A-Za-z0-9_])",
  });
  add("integer", {
    name: `constant.numeric.integer.${LANG}`,
    match: "(?<![A-Za-z0-9_.])(?:0|[1-9][0-9]*)(?![A-Za-z0-9_]|\\.[0-9])",
  });
  add("number-invalid", {
    // Leading zeros (E0020), hexadecimal and suffixed numbers (E0021), `1e3` (E0022): the lexer
    // rejects every number that does not match the two rules above, so does the grammar. `1.`
    // (E0022) is the same family: a point needs a digit after it, unless it starts `..`.
    name: `invalid.illegal.number.${LANG}`,
    match:
      "(?<![A-Za-z0-9_.])[0-9][A-Za-z0-9_]*(?:\\.[0-9][A-Za-z0-9_]*|\\.(?![0-9.A-Za-z_]))?",
  });

  // --- keywords and the names they declare ------------------------------------------------------
  add("reserved", {
    // Reserved for a future version (E0013): rejected wherever a name is expected, and there is no
    // syntax of v0.1 that uses them otherwise.
    name: `invalid.illegal.reserved-word.${LANG}`,
    match: `(?<![A-Za-z0-9_])${words(source.reserved)}${END}`,
  });

  add("field-named-material", {
    // `material` is a keyword that is also accepted as a field name (decision 0023).
    match: `${START}(material)(?=\\s*:)`,
    captures: { "1": { name: `variable.other.property.${LANG}` } },
  });
  add("handler", {
    // `on key_down(...)`: the event name is a registry name, not a keyword.
    match: `${START}(on)\\s+(${IDENT})`,
    captures: {
      "1": { name: keywordScope("on") },
      "2": { name: `entity.name.function.event.${LANG}` },
    },
  });
  // A reserved word after the keyword is not a name: the `reserved` rule scopes it as illegal.
  const notReserved = `(?!${words(source.reserved)}${END})`;
  for (const [keyword, nameScope] of Object.entries(DECLARES_NAME)) {
    add(`declares-${keyword}`, {
      match: `${START}(${keyword})\\s+${notReserved}(${IDENT})`,
      captures: {
        "1": { name: keywordScope(keyword) },
        "2": { name: nameScope },
      },
    });
  }
  // One rule per class of keyword; a keyword that declares a name was already matched above.
  for (const [rule, list] of [
    ["control", CONTROL],
    ["import", IMPORT],
    ["declaration", DECLARATION],
    ["modifier", MODIFIER],
    ["self", SELF],
    ["boolean", BOOLEAN],
  ] as const) {
    add(`keyword-${rule}`, {
      name: keywordScope(list[0] ?? ""),
      match: `${START}${words(list)}${END}`,
    });
  }
  // --- contextual words -------------------------------------------------------------------------
  add("scene-object", {
    match: `${START}(${words(sceneObjectWords)})\\s+(${IDENT})`,
    captures: {
      "1": { name: `support.type.scene-object.${LANG}` },
      "2": { name: `entity.name.type.object.${LANG}` },
    },
  });
  add("lifecycle", {
    match: `${START}(${words(lifecycle)})\\s*(?=\\()`,
    captures: { "1": { name: `entity.name.function.lifecycle.${LANG}` } },
  });
  add("stage", {
    match: `${START}(${words(stage)})\\s*(?=\\()`,
    captures: { "1": { name: `entity.name.function.stage.${LANG}` } },
  });
  add("import-from", {
    match: `${START}(${words(importWords)})(?=\\s*")`,
    captures: { "1": { name: `keyword.control.import.${LANG}` } },
  });
  // `shared state x: T = v;` (decision 0141), `shared saved state`, `setting state` (decisions 0145, 0146) and
  // `after(t) { }`, `every(t) { }` (decision 0142). A modifier is one when `state` follows, possibly after another.
  add("shared-state", {
    match: `${START}(${words(sharedWords)})(?=\\s+(?:(?:${words(sharedWords)})\\s+)?state\\b)`,
    captures: { "1": { name: `storage.modifier.${LANG}` } },
  });
  add("timer", {
    match: `${START}(${words(timerWords)})(?=\\s*\\()`,
    captures: { "1": { name: `keyword.control.timer.${LANG}` } },
  });

  // --- the standard library ---------------------------------------------------------------------
  const byNamespace = (list: readonly { namespace: string; name: string }[]): Map<string, string[]> => {
    const map = new Map<string, string[]>();
    for (const { namespace, name } of list) {
      map.set(namespace, [...(map.get(namespace) ?? []), name]);
    }
    return map;
  };
  for (const [namespace, names] of byNamespace(builtins.namespaceValues)) {
    add(`value-${namespace}`, {
      match: `${START}(${checkWord(namespace)})(\\.)(${words(names)})${END}`,
      captures: {
        "1": { name: `support.class.namespace.${LANG}` },
        "2": { name: `punctuation.accessor.${LANG}` },
        "3": { name: `support.constant.builtin.${LANG}` },
      },
    });
  }
  for (const [namespace, names] of byNamespace(builtins.namespaceFunctions)) {
    add(`function-${namespace}`, {
      match: `${START}(${checkWord(namespace)})(\\.)(${words(names)})\\s*(?=\\()`,
      captures: {
        "1": { name: `support.class.namespace.${LANG}` },
        "2": { name: `punctuation.accessor.${LANG}` },
        "3": { name: `support.function.builtin.${LANG}` },
      },
    });
  }
  add("namespace", {
    name: `support.class.namespace.${LANG}`,
    match: `${START}${words(builtins.namespaces)}(?=\\s*\\.)`,
  });
  add("enum", {
    name: `support.type.enum.${LANG}`,
    match: `${START}${words(builtins.enums)}${END}`,
  });
  add("builtin-function", {
    name: `support.function.builtin.${LANG}`,
    match: `${START}${words(builtins.functions)}\\s*(?=\\()`,
  });
  add("builtin-type", {
    name: `support.type.builtin.${LANG}`,
    match: `${START}${words(builtins.types)}${END}`,
  });
  add("schema", {
    name: `support.class.schema.${LANG}`,
    match: `${START}${words(builtins.schemas)}${END}`,
  });

  // --- names by position and by the naming conventions of spec/language.md 3.3 ------------------
  add("call", {
    match: `${START}(${IDENT})\\s*(?=\\()`,
    captures: { "1": { name: `entity.name.function.call.${LANG}` } },
  });
  add("constant-name", {
    name: `variable.other.constant.${LANG}`,
    match: `${START}[A-Z][A-Z0-9_]*${END}`,
  });
  add("type-name", {
    name: `entity.name.type.${LANG}`,
    match: `${START}[A-Z][A-Za-z0-9_]*${END}`,
  });
  add("field-name", {
    // A name before a colon: a field, a descriptor field, a parameter, a struct field.
    match: `${START}(${IDENT})(?=\\s*:)`,
    captures: { "1": { name: `variable.other.property.${LANG}` } },
  });
  add("member-call", {
    match: `(?<![.])(\\.)(?![.])\\s*(${IDENT})\\s*(?=\\()`,
    captures: {
      "1": { name: `punctuation.accessor.${LANG}` },
      "2": { name: `entity.name.function.member.${LANG}` },
    },
  });
  add("member", {
    match: `(?<![.])(\\.)(?![.])\\s*(${IDENT})`,
    captures: {
      "1": { name: `punctuation.accessor.${LANG}` },
      "2": { name: `variable.other.property.${LANG}` },
    },
  });
  add("identifier", {
    name: `variable.other.readwrite.${LANG}`,
    match: `(?<![A-Za-z0-9_])${IDENT}`,
  });

  // `|` between the patterns of a match arm (`A.X | A.Y => ...`, decision 0129) is a separator,
  // not the bitwise operator: the arm's `=>` follows on the same line.
  add("pattern-separator", {
    name: `punctuation.separator.pattern.${LANG}`,
    match: "\\|(?!\\|)(?=[^;{}|]*(?:\\|[^;{}|]*)*=>)",
  });
  // --- operators and punctuation: longest first, so `<=` is not `<` and `=` ---------------------
  const operatorTokens: [string, string][] = [
    ...Object.entries(OPERATOR_SCOPES),
    ...source.bitwise.map((token): [string, string] => [token, BITWISE_SCOPE]),
  ];
  const lengths = [...new Set(operatorTokens.map(([token]) => token.length))].sort((a, b) => b - a);
  for (const length of lengths) {
    const scopes = [...new Set(operatorTokens.filter(([t]) => t.length === length).map(([, s]) => s))];
    for (const scope of scopes) {
      const tokens = operatorTokens
        .filter(([t, s]) => t.length === length && s === scope)
        .map(([t]) => reEscape(t))
        .sort();
      add(`operator-${length}-${scope}`, { name: scope, match: tokens.join("|") });
    }
  }
  add("illegal-character", {
    // Anything left over is a character the lexer rejects outside strings and comments (E0005,
    // E0010): `@`, `` ` ``, `'`, `?`, `$`, `\`, non-ASCII letters.
    name: `invalid.illegal.character.${LANG}`,
    match: "[^\\sA-Za-z0-9_]",
  });

  const repository: Record<string, TmRule> = {};
  for (const name of order) {
    const rule = rules[name];
    if (rule !== undefined) repository[name] = rule;
  }
  return {
    information_for_contributors: [
      "Generated by packages/editor-vscode/scripts/gen-grammar.ts from spec/grammar.ebnf and the registry names of src/grammar/builtins.ts; do not edit by hand (npm run gen:grammar -w mtek-vscode).",
    ],
    name: "Mtek",
    scopeName: `source.${LANG}`,
    fileTypes: [LANG],
    patterns: order.map((name) => ({ include: `#${name}` })),
    repository,
  };
}

/** The committed text of the grammar: two-space JSON and one trailing newline. */
export function renderGrammar(grammar: TmGrammar): string {
  return `${JSON.stringify(grammar, null, 2)}\n`;
}
