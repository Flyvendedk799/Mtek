import { describe, expect, it } from "vitest";
import { countCodeLines } from "./count-lines.ts";

describe("countCodeLines", () => {
  it("ignores blank lines and line comments", () => {
    expect(countCodeLines("\n// a\n  // b\nconst x = 1;\n\n")).toBe(1);
  });

  it("ignores block comments, also when they span lines", () => {
    expect(countCodeLines("/* a */\n/*\n * b\n */\nlet y = 2;\n/** c */")).toBe(1);
  });

  it("counts a line with code and a trailing comment, and code after a block comment", () => {
    expect(countCodeLines("a(); // note\n/* c */ b();\n")).toBe(2);
  });

  it("handles CRLF", () => {
    expect(countCodeLines("// c\r\nz();\r\n")).toBe(1);
  });
});
