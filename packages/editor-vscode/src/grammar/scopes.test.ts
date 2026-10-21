// Focused scope assertions: what a theme will see for the constructs of the lexical grammar.
import { beforeAll, describe, expect, it } from "vitest";
import type { IGrammar } from "vscode-textmate";
import { loadGrammar, scopesOf, tokenizeText } from "./testing.ts";

let grammar: IGrammar;
beforeAll(async () => {
  grammar = await loadGrammar();
});

const scopes = (text: string, token: string): readonly string[] =>
  scopesOf(tokenizeText(grammar, text), token);
const has = (list: readonly string[], prefix: string): boolean =>
  list.some((scope) => scope === prefix || scope.startsWith(`${prefix}.`));

describe("comments", () => {
  it("scopes a line comment, and a documentation comment apart from it", () => {
    expect(has(scopes("// plain", " plain"), "comment.line.double-slash")).toBe(true);
    expect(has(scopes("/// the doc", " the doc"), "comment.line.documentation")).toBe(true);
  });

  it("makes four or more slashes an ordinary comment (spec/language.md 1.5)", () => {
    const list = scopes("//// banner", "// banner");
    expect(has(list, "comment.line.double-slash")).toBe(true);
    expect(has(list, "comment.line.documentation")).toBe(false);
  });

  it("keeps a nested block comment a comment to its outer end", () => {
    const text = "/* outer /* inner */ still outer */ let x = 1;\nfn ok() {}";
    const lines = tokenizeText(grammar, text);
    const first = lines[0];
    expect(first).toBeDefined();
    const still = first?.tokens.find((t) => t.text.includes("still outer"));
    expect(still && has(still.scopes, "comment.block")).toBe(true);
    // after the outer `*/` the code is code again
    expect(has(scopesOf(lines, "let"), "keyword")).toBe(true);
  });

  it("carries a block comment across lines and ends it at the matching close", () => {
    const text = "/* a\n  /* b\n  */ c\n  */\nfn";
    const lines = tokenizeText(grammar, text);
    for (const line of lines.slice(0, 4)) {
      expect(line.tokens.every((t) => has(t.scopes, "comment.block")), JSON.stringify(line.line)).toBe(true);
    }
    expect(has(scopesOf(lines, "fn"), "keyword")).toBe(true);
  });

  it("treats `/**/` and `/***/` as comments that close at once", () => {
    for (const text of ["/**/ let", "/***/ let"]) {
      expect(has(scopesOf(tokenizeText(grammar, text), "let"), "keyword"), text).toBe(true);
    }
  });

  it("does not start a comment inside a string", () => {
    const list = scopes('"a // b /* c"', "a // b /* c").join(" ");
    expect(list).not.toContain("comment");
  });
});

describe("keywords", () => {
  it("scopes control keywords, declaration keywords, modifiers and the rest as keywords", () => {
    const text = "export cpu fn f() { if a { return; } else { break; } }\nscene S { state x: f32 = 1.0; }";
    const lines = tokenizeText(grammar, text);
    for (const word of ["if", "return", "else", "break", "scene", "state"]) {
      expect(has(scopesOf(lines, word), "keyword"), word).toBe(true);
    }
    for (const word of ["export", "cpu"]) {
      expect(has(scopesOf(lines, word), "storage.modifier"), word).toBe(true);
    }
    expect(has(scopesOf(tokenizeText(grammar, "fn f() {}"), "fn"), "keyword.other.declaration")).toBe(true);
    expect(has(scopesOf(tokenizeText(grammar, "import { A } from \"./a.mtek\";"), "import"), "keyword.control.import")).toBe(true);
  });

  it("scopes `true`, `false` and `self` as language constants and variables", () => {
    expect(has(scopes("let a = true;", "true"), "constant.language.boolean")).toBe(true);
    expect(has(scopes("let a = false;", "false"), "constant.language.boolean")).toBe(true);
    expect(has(scopes("self.x", "self"), "variable.language.self")).toBe(true);
  });

  it("does not take a keyword out of a longer name", () => {
    expect(has(scopes("let format = 1;", "format"), "keyword")).toBe(false);
    expect(has(scopes("let inner = 1;", "inner"), "keyword")).toBe(false);
    expect(has(scopes("a.iffy", "iffy"), "keyword")).toBe(false);
  });

  it("scopes a reserved word as illegal", () => {
    expect(has(scopes("let loop = 1;", "loop"), "invalid.illegal.reserved-word")).toBe(true);
    expect(has(scopes("compute f() {}", "compute"), "invalid.illegal.reserved-word")).toBe(true);
  });

  it("scopes the names a declaration introduces", () => {
    expect(has(scopes("fn double(x: f32) -> f32 {}", "double"), "entity.name.function")).toBe(true);
    expect(has(scopes("scene Demo {}", "Demo"), "entity.name.type.scene")).toBe(true);
    expect(has(scopes("const SPEED: f32 = 1.0;", "SPEED"), "variable.other.constant")).toBe(true);
    expect(has(scopes("let angle: f32 = 1.0;", "angle"), "variable.other.declaration")).toBe(true);
  });

  it("accepts `material` as a field name (decision 0023)", () => {
    const lines = tokenizeText(grammar, "material: Pbr {};");
    expect(has(scopesOf(lines, "material"), "variable.other.property")).toBe(true);
    expect(has(scopes("material Pulse {}", "material"), "keyword")).toBe(true);
  });
});

describe("contextual words", () => {
  it("scopes the event name after `on`", () => {
    expect(has(scopes("on key_down(Key.Space) {}", "key_down"), "entity.name.function.event")).toBe(true);
  });

  it("scopes lifecycle functions, the stage function and `camera`", () => {
    expect(has(scopes("update(dt: f32) {}", "update"), "entity.name.function.lifecycle")).toBe(true);
    expect(has(scopes("fixed_update(dt: f32) {}", "fixed_update"), "entity.name.function.lifecycle")).toBe(true);
    expect(has(scopes("fragment(input: SurfaceInput) {}", "fragment"), "entity.name.function.stage")).toBe(true);
    expect(has(scopes("camera Main { }", "camera"), "support.type.scene-object")).toBe(true);
    expect(has(scopes("camera Main { }", "Main"), "entity.name.type.object")).toBe(true);
  });

  it("scopes `shared`, `saved` and `setting` before `state` as modifiers, and nowhere else (decisions 0141, 0145, 0146)", () => {
    const lines = tokenizeText(grammar, "scene S {\n    shared saved state best: i32 = 0;\n    setting state volume: f32 = 0.5;\n}");
    for (const word of ["shared", "saved", "setting"]) {
      expect(has(scopesOf(lines, word), "storage.modifier"), word).toBe(true);
    }
    expect(has(scopes("let saved = true;", "saved"), "storage.modifier")).toBe(false);
    expect(has(scopes("setting = 1;", "setting"), "storage.modifier")).toBe(false);
    expect(has(scopes("save();", "save"), "support.function")).toBe(true);
    expect(has(scopes("clear_saved();", "clear_saved"), "support.function")).toBe(true);
  });

  it("leaves `update`, `camera` and `from` ordinary identifiers where they mean nothing", () => {
    expect(has(scopes("let update = 1;", "update"), "entity.name.function")).toBe(false);
    expect(has(scopes("let from = 1;", "from"), "keyword")).toBe(false);
    expect(has(scopes("let camera = 1;", "camera"), "support")).toBe(false);
  });

  it("scopes `from` in an import", () => {
    expect(has(scopes('import { A } from "./a.mtek";', "from"), "keyword.control.import")).toBe(true);
  });
});

describe("literals", () => {
  it("scopes integers and floats, with an exponent", () => {
    expect(has(scopes("let a = 42;", "42"), "constant.numeric.integer")).toBe(true);
    expect(has(scopes("let a = 0;", "0"), "constant.numeric.integer")).toBe(true);
    expect(has(scopes("let a = 0.5;", "0.5"), "constant.numeric.float")).toBe(true);
    expect(has(scopes("let a = 2.5e-3;", "2.5e-3"), "constant.numeric.float")).toBe(true);
    expect(has(scopes("let a = 1.0E+3;", "1.0E+3"), "constant.numeric.float")).toBe(true);
  });

  it("reads `0..n` as an integer, a range and a name (a float needs a digit after the point)", () => {
    const lines = tokenizeText(grammar, "for i in 0..n {}");
    expect(has(scopesOf(lines, "0"), "constant.numeric.integer")).toBe(true);
    expect(has(scopesOf(lines, ".."), "keyword.operator.range")).toBe(true);
  });

  it("scopes what the lexer rejects as illegal numbers: leading zeros, hexadecimal, suffixes, `1e3`", () => {
    for (const bad of ["007", "0x1F", "10u32", "1.5f", "1e3", "0b101"]) {
      expect(has(scopes(`let a = ${bad};`, bad), "invalid.illegal.number"), bad).toBe(true);
    }
  });

  it("does not read digits inside a name as a number", () => {
    expect(has(scopes("let vec3 = 1;", "vec3"), "constant.numeric")).toBe(false);
    expect(has(scopes("let x2 = 1;", "x2"), "constant.numeric")).toBe(false);
  });

  it("scopes #rrggbb and #rrggbbaa colours, in either case, as constants", () => {
    for (const color of ["#6b5cff", "#6B5CFF", "#6b5cff80", "#FFFFFFFF"]) {
      expect(has(scopes(`let c = ${color};`, color), "constant.other.color"), color).toBe(true);
    }
  });

  it("scopes a colour of any other length as illegal", () => {
    for (const color of ["#fff", "#12345", "#1234567", "#12345678a", "#xyz"]) {
      expect(has(scopes(`let c = ${color};`, color), "invalid.illegal.color"), color).toBe(true);
    }
  });

  it("scopes a string and its escapes", () => {
    const lines = tokenizeText(grammar, 'let s = "a\\n\\t\\"\\\\\\0\\$\\u{1F600}\\u{41}b";');
    expect(lines[0]?.tokens.some((t) => has(t.scopes, "string.quoted.double"))).toBe(true);
    for (const escape of ["\\n", "\\t", '\\"', "\\\\", "\\0", "\\$", "\\u{1F600}", "\\u{41}"]) {
      expect(has(scopesOf(lines, escape), "constant.character.escape"), escape).toBe(true);
    }
    expect(has(scopesOf(lines, "a"), "constant.character.escape")).toBe(false);
  });

  it("scopes an escape the lexer rejects as illegal", () => {
    for (const escape of ["\\q", "\\x41", "\\u41", "\\'"]) {
      const lines = tokenizeText(grammar, `let s = "${escape}";`);
      const token = lines[0]?.tokens.find((t) => has(t.scopes, "invalid.illegal.escape"));
      expect(token, escape).toBeDefined();
    }
  });

  it("ends an unterminated string at the end of its line", () => {
    const lines = tokenizeText(grammar, 'let s = "abc\nlet t = 1;');
    expect(has(scopesOf(lines.slice(1), "let"), "keyword")).toBe(true);
  });
});

describe("operators and punctuation", () => {
  it("scopes each class of operator", () => {
    const cases: [string, string, string][] = [
      ["a -> b", "->", "keyword.operator.arrow"],
      ["a == b", "==", "keyword.operator.comparison"],
      ["a != b", "!=", "keyword.operator.comparison"],
      ["a <= b", "<=", "keyword.operator.comparison"],
      ["a >= b", ">=", "keyword.operator.comparison"],
      ["a && b", "&&", "keyword.operator.logical"],
      ["a || b", "||", "keyword.operator.logical"],
      ["!a", "!", "keyword.operator.logical"],
      ["a += b", "+=", "keyword.operator.assignment.compound"],
      ["a *= b", "*=", "keyword.operator.assignment.compound"],
      ["a = b", "=", "keyword.operator.assignment"],
      ["a % b", "%", "keyword.operator.arithmetic"],
      ["a / b", "/", "keyword.operator.arithmetic"],
    ];
    for (const [text, token, scope] of cases) {
      expect(has(scopes(text, token), scope), text).toBe(true);
    }
  });

  it("scopes the bitwise operators the lexer only recognises to reject them (E1901) as illegal", () => {
    for (const op of ["&", "|", "^", "~", "<<", ">>"]) {
      expect(has(scopes(`a ${op} b`, op), "invalid.illegal.operator.bitwise"), op).toBe(true);
    }
  });

  it("reads `/=` as one operator and `//` as a comment, not as a division", () => {
    expect(has(scopes("a /= 2.0", "/="), "keyword.operator.assignment.compound")).toBe(true);
  });

  it("scopes separators and brackets", () => {
    expect(has(scopes("f(a, b);", ","), "punctuation.separator.comma")).toBe(true);
    expect(has(scopes("f(a);", ";"), "punctuation.terminator.statement")).toBe(true);
    expect(has(scopes("{ }", "{"), "punctuation.section.braces")).toBe(true);
    expect(has(scopes("a[0]", "["), "punctuation.section.brackets")).toBe(true);
  });

  it("scopes a character that is no token of the language as illegal", () => {
    for (const ch of ["@", "?", "$", "`", "'"]) {
      expect(has(scopes(`let a = ${ch};`, ch), "invalid.illegal.character"), ch).toBe(true);
    }
  });
});

describe("the standard library", () => {
  it("scopes types, also as constructors", () => {
    expect(has(scopes("let a: f32 = 1.0;", "f32"), "support.type.builtin")).toBe(true);
    expect(has(scopes("let a = vec3(1.0, 2.0, 3.0);", "vec3"), "support.type.builtin")).toBe(true);
    expect(has(scopes("const A: array<f32, 4> = x;", "array"), "support.type.builtin")).toBe(true);
  });

  it("scopes namespaces, their functions and their values", () => {
    const lines = tokenizeText(grammar, "let q = quat.axis_angle(a, 1.0) * frame.time;");
    expect(has(scopesOf(lines, "quat"), "support.class.namespace")).toBe(true);
    expect(has(scopesOf(lines, "axis_angle"), "support.function.builtin")).toBe(true);
    expect(has(scopesOf(lines, "frame"), "support.class.namespace")).toBe(true);
    expect(has(scopesOf(lines, "time"), "support.constant.builtin")).toBe(true);
  });

  it("tells the type `color` from the namespace `color`", () => {
    expect(has(scopes("let a: color = x;", "color"), "support.type.builtin")).toBe(true);
    expect(has(scopes("let a = color.linear(1.0);", "color"), "support.class.namespace")).toBe(true);
  });

  it("scopes enum members through their enum, intrinsics by their call and schemas", () => {
    expect(has(scopes("on key_down(Key.Space) {}", "Key"), "support.type.enum")).toBe(true);
    expect(has(scopes("let a = sin(x);", "sin"), "support.function.builtin")).toBe(true);
    expect(has(scopes("mesh: Box { size: 1.0 };", "Box"), "support.class.schema")).toBe(true);
  });

  it("leaves an intrinsic's name an ordinary name when it is not called (a local may reuse it)", () => {
    expect(has(scopes("let a = length + 1.0;", "length"), "support.function")).toBe(false);
  });
});

describe("names by position and convention (spec/language.md 3.3)", () => {
  it("scopes a field name before a colon, a call, a member and a method", () => {
    expect(has(scopes("position: vec3(0.0, 1.0, 2.0);", "position"), "variable.other.property")).toBe(true);
    expect(has(scopes("let a = helper(1.0);", "helper"), "entity.name.function.call")).toBe(true);
    expect(has(scopes("let a = self.speed;", "speed"), "variable.other.property")).toBe(true);
    expect(has(scopes("Cube.body.apply_impulse(v);", "apply_impulse"), "entity.name.function.member")).toBe(true);
  });

  it("scopes SCREAMING_SNAKE_CASE as a constant and PascalCase as a type", () => {
    expect(has(scopes("let a = SPEED * 2.0;", "SPEED"), "variable.other.constant")).toBe(true);
    expect(has(scopes("let a: Light = x;", "Light"), "entity.name.type")).toBe(true);
  });
});
