import { describe, expect, it } from "vitest";
import { parseToml, TomlError } from "./toml-subset.mjs";

/** Plain-object copy, so `toEqual` ignores the null prototype of parsed tables. */
function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("parseToml", () => {
  it("parses the task.toml example of spec/ai-and-benchmarks.md section 6.1", () => {
    const parsed = parseToml(`id = "interaction-03"
category = "interaction"          # scene-rendering | interaction | shader-bridge | maintenance
mode = "edit"
title = "Toggle rotation direction with Space"
prompt = """Make the cube reverse its rotation direction each time Space is pressed."""
required_symbols = ["Demo.Cube"]
[budgets]
max_repairs = 3
max_output_tokens = 4000
max_wall_seconds = 300
`);
    expect(plain(parsed)).toEqual({
      id: "interaction-03",
      category: "interaction",
      mode: "edit",
      title: "Toggle rotation direction with Space",
      prompt: "Make the cube reverse its rotation direction each time Space is pressed.",
      required_symbols: ["Demo.Cube"],
      budgets: { max_repairs: 3, max_output_tokens: 4000, max_wall_seconds: 300 },
    });
  });

  it("parses the fixture example of spec/tooling.md section 6", () => {
    const parsed = parseToml(`name = "space toggles direction"
steps = [
  { step = 60, dt = 0.016666668 },
  { press = "Space" }, { step = 1, dt = 0.016666668 }, { release = "Space" },
  { expect_state = { speed = -0.7 } },
  { expect_pixel = { x = 64, y = 64, color = "#6b5cff", tolerance = 2 } },
]
`);
    expect(plain(parsed)).toEqual({
      name: "space toggles direction",
      steps: [
        { step: 60, dt: 0.016666668 },
        { press: "Space" },
        { step: 1, dt: 0.016666668 },
        { release: "Space" },
        { expect_state: { speed: -0.7 } },
        { expect_pixel: { x: 64, y: 64, color: "#6b5cff", tolerance: 2 } },
      ],
    });
  });

  it("handles multi-line strings: first newline dropped, escapes, line-ending backslash", () => {
    const parsed = parseToml('prompt = """\nline one\nsays \\"hi\\" \\u00e9 \\\n   continued\n"""\n');
    expect(parsed["prompt"]).toBe('line one\nsays "hi" \u00e9 continued\n');
  });

  it("keeps quotes directly before the closing delimiter of a multi-line string", () => {
    expect(parseToml('a = """say "x"""" \n')["a"]).toBe('say "x"');
  });

  it("reads literal strings, booleans, floats with exponents, negative numbers and comments in arrays", () => {
    const parsed = parseToml(`a = 'C:\\raw'
b = true
c = false
d = 2.5e-3
e = -7
f = [
  1, # one
  2,
]
`);
    expect(plain(parsed)).toEqual({ a: "C:\\raw", b: true, c: false, d: 0.0025, e: -7, f: [1, 2] });
  });

  it("accepts CRLF line endings", () => {
    expect(plain(parseToml('a = 1\r\nb = "x"\r\n[t]\r\nc = 2\r\n'))).toEqual({ a: 1, b: "x", t: { c: 2 } });
  });

  it("does not let a key named __proto__ reach the prototype", () => {
    const parsed = parseToml("__proto__ = 1\n");
    expect(Object.keys(parsed)).toEqual(["__proto__"]);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it.each([
    ["a = 1\na = 2\n", /line 2: duplicate key 'a'/],
    ["[t]\n[t]\n", /line 2: table \[t\] is defined twice/],
    ["a = 1\n[a]\n", /already defined as a value/],
    ["[[t]]\n", /arrays of tables/],
    ["a.b = 1\n", /dotted keys/],
    ["a = 0x10\n", /unsupported number/],
    ["a = 1979-05-27\n", /unsupported number or date/],
    ["a = 007\n", /unsupported number/],
    ["a = inf\n", /expected a value/],
    ["a = 1_000\n", /unsupported number/],
    ['a = "x\n', /unterminated string/],
    ['a = "x\\q"\n', /unknown escape/],
    ['a = "\\u12"\n', /invalid \\u escape/],
    ['a = "\\ud800"\n', /not a Unicode scalar value/],
    ["a = '''x'''\n", /multi-line literal/],
    ['a = """x\n', /unterminated multi-line string/],
    ["a = [1, 2\n", /expected ',' or '\]'|expected a value/],
    ["a = { x = 1,\n y = 2 }\n", /on a single line/],
    ["a = { x = 1, x = 2 }\n", /duplicate key 'x'/],
    ["a = 1 b = 2\n", /unexpected 'b' after a value/],
    ["= 1\n", /expected a key/],
    ["a 1\n", /expected '='/],
    ["a = 1\rb = 2\n", /carriage return/],
  ])("rejects %j", (source, message) => {
    expect(() => parseToml(source)).toThrow(TomlError);
    expect(() => parseToml(source)).toThrow(message);
  });
});
