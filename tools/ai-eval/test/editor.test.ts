import { describe, expect, it } from "vitest";
import { applyEdits, defaultEditPolicy, normalizeProjectPath, parseBlocks, parseJsonEdits, parseModuleReply, parseReply } from "../src/editor.ts";

const FILE = ["scene Demo {", "    entity Cube {", "        speed = 1;", "    }", "}", ""].join("\n");

const files = (map: Record<string, string>) => (path: string): string | undefined => map[path];
const editPolicy = defaultEditPolicy("edit");
const coldPolicy = defaultEditPolicy("cold");

function block(search: string, replace: string, file = "src/main.mtek"): string {
  return `<<<FILE ${file}\n<<<SEARCH\n${search}\n===\n${replace}\n>>>REPLACE\n`;
}

describe("parseBlocks", () => {
  it("parses the spec example", () => {
    const parsed = parseBlocks(block("        speed = -speed;", "        speed = -speed * 1.5;"));
    expect(parsed.problems).toEqual([]);
    expect(parsed.edits).toEqual([
      { kind: "replace", file: "src/main.mtek", search: "        speed = -speed;", replace: "        speed = -speed * 1.5;", index: 1 },
    ]);
  });

  it("allows several SEARCH blocks under one FILE line and several FILE lines", () => {
    const text = "<<<FILE a.mtek\n<<<SEARCH\none\n===\n1\n>>>REPLACE\n\n<<<SEARCH\ntwo\n===\n2\n>>>REPLACE\n<<<FILE b.mtek\n<<<WHOLE\nbody\n>>>END\n";
    const parsed = parseBlocks(text);
    expect(parsed.problems).toEqual([]);
    expect(parsed.edits.map((e) => [e.kind, e.file, e.index])).toEqual([
      ["replace", "a.mtek", 1],
      ["replace", "a.mtek", 2],
      ["whole", "b.mtek", 3],
    ]);
    expect(parsed.edits[2]).toMatchObject({ content: "body\n" });
  });

  it("ignores prose and code fences around the blocks", () => {
    const parsed = parseBlocks(`Sure, here is the fix:\n\`\`\`\n${block("a", "b")}\`\`\`\nDone.`);
    expect(parsed.problems).toEqual([]);
    expect(parsed.edits).toHaveLength(1);
  });

  it("normalises CRLF in the reply and nothing else", () => {
    const parsed = parseBlocks("<<<FILE a.mtek\r\n<<<SEARCH\r\n  x = 1;\r\n===\r\n  x = 2;\r\n>>>REPLACE\r\n");
    expect(parsed.edits[0]).toMatchObject({ search: "  x = 1;", replace: "  x = 2;" });
  });

  it("keeps blank lines and indentation inside a block", () => {
    const parsed = parseBlocks(block("a\n\n    b", "c\n\n  d"));
    expect(parsed.edits[0]).toMatchObject({ search: "a\n\n    b", replace: "c\n\n  d" });
  });

  it("treats a later === line as replacement text, only the first divides", () => {
    const parsed = parseBlocks("<<<FILE a.mtek\n<<<SEARCH\nx\n===\ny\n===\nz\n>>>REPLACE\n");
    expect(parsed.edits[0]).toMatchObject({ search: "x", replace: "y\n===\nz" });
  });

  it("rejects a reply with no blocks", () => {
    expect(parseBlocks("I think you should change the speed.").problems.map((p) => p.code)).toEqual(["no-edit-blocks"]);
  });

  it("reports an unterminated block (a truncated reply looks like this)", () => {
    const parsed = parseBlocks("<<<FILE a.mtek\n<<<SEARCH\nx\n===\ny\n");
    expect(parsed.edits).toEqual([]);
    expect(parsed.problems.map((p) => p.code)).toEqual(["malformed-block"]);
    expect(parsed.problems[0]?.message).toContain("not closed");
  });

  it("reports a FILE line without SEARCH or WHOLE, a missing path and stray markers", () => {
    expect(parseBlocks("<<<FILE a.mtek\nhello\n").problems[0]?.message).toContain("expected '<<<SEARCH' or '<<<WHOLE'");
    expect(parseBlocks("<<<FILE \n<<<SEARCH\nx\n===\ny\n>>>REPLACE\n").problems.some((p) => p.message.includes("needs a path"))).toBe(true);
    expect(parseBlocks(">>>REPLACE\n").problems[0]?.code).toBe("malformed-block");
    expect(parseBlocks(`${block("a", "b")}<<<WHOLE\nx\n>>>END\n`).problems.some((p) => p.code === "malformed-block")).toBe(true);
  });
});

describe("applyEdits: the exact-match rule", () => {
  it("applies a search that matches exactly once", () => {
    const parsed = parseBlocks(block("        speed = 1;", "        speed = -speed;"));
    const outcome = applyEdits(parsed, files({ "src/main.mtek": FILE }), editPolicy);
    expect(outcome.rejected).toEqual([]);
    expect(outcome.applied).toEqual([{ index: 1, file: "src/main.mtek", kind: "replace" }]);
    expect(outcome.files.get("src/main.mtek")).toBe(FILE.replace("speed = 1;", "speed = -speed;"));
  });

  it("rejects a search that matches nothing and says where the first line is", () => {
    const parsed = parseBlocks(block("speed = 1;\n    }\n    }", "x"));
    const outcome = applyEdits(parsed, files({ "src/main.mtek": FILE }), editPolicy);
    expect(outcome.applied).toEqual([]);
    expect(outcome.files.size).toBe(0);
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.rejected[0]).toMatchObject({ code: "search-not-found", file: "src/main.mtek", index: 1 });
    expect(outcome.rejected[0]?.message).toContain("first line (trimmed) does occur at line 3");
  });

  it("is exact: a different case, spacing or indentation inside the text does not match", () => {
    const apply = (search: string) => applyEdits(parseBlocks(block(search, "x")), files({ "src/main.mtek": FILE }), editPolicy);
    expect(apply("Speed = 1;").rejected[0]?.code).toBe("search-not-found");
    expect(apply("speed  = 1;").rejected[0]?.code).toBe("search-not-found");
    expect(apply("entity Cube {\n  speed = 1;").rejected[0]?.code).toBe("search-not-found"); // two spaces, the file has eight
    // The match is on the text as a substring, so a search that is a part of a line matches that part.
    expect(apply("speed = 1").rejected).toEqual([]);
  });

  it("rejects a search that matches several places, with the count and the lines", () => {
    const twice = "a = 1;\nb = 2;\na = 1;\n";
    const outcome = applyEdits(parseBlocks(block("a = 1;", "a = 3;")), files({ "src/main.mtek": twice }), editPolicy);
    expect(outcome.rejected[0]).toMatchObject({ code: "search-ambiguous", matches: 2 });
    expect(outcome.rejected[0]?.message).toContain("lines 1, 3");
    expect(outcome.files.size).toBe(0);
  });

  it("counts overlapping matches as several", () => {
    const outcome = applyEdits(parseBlocks(block("aa", "b")), files({ "src/main.mtek": "aaa\n" }), editPolicy);
    expect(outcome.rejected[0]).toMatchObject({ code: "search-ambiguous", matches: 2 });
  });

  it("rejects an empty search", () => {
    const outcome = applyEdits(parseBlocks("<<<FILE src/main.mtek\n<<<SEARCH\n===\nx\n>>>REPLACE\n"), files({ "src/main.mtek": FILE }), editPolicy);
    expect(outcome.rejected[0]?.code).toBe("empty-search");
  });

  it("allows an empty replacement (a deletion of the matched text)", () => {
    const outcome = applyEdits(parseBlocks("<<<FILE src/main.mtek\n<<<SEARCH\n        speed = 1;\n===\n>>>REPLACE\n"), files({ "src/main.mtek": FILE }), editPolicy);
    expect(outcome.rejected).toEqual([]);
    expect(outcome.files.get("src/main.mtek")).toBe(FILE.replace("        speed = 1;", ""));
  });

  it("applies the edits of one reply in order, each against the file as the earlier ones left it", () => {
    const text = `${block("speed = 1;", "speed = 2;")}${block("speed = 2;", "speed = 3;")}`;
    const outcome = applyEdits(parseBlocks(text), files({ "src/main.mtek": FILE }), editPolicy);
    expect(outcome.rejected).toEqual([]);
    expect(outcome.files.get("src/main.mtek")).toContain("speed = 3;");
  });

  it("is atomic: one rejected edit means nothing is applied, and every rejection is reported", () => {
    const text = `${block("speed = 1;", "speed = 2;")}${block("nope", "x")}${block("also nope", "y")}`;
    const outcome = applyEdits(parseBlocks(text), files({ "src/main.mtek": FILE }), editPolicy);
    expect(outcome.applied).toEqual([]);
    expect(outcome.files.size).toBe(0);
    expect(outcome.rejected.map((r) => [r.index, r.code])).toEqual([[2, "search-not-found"], [3, "search-not-found"]]);
  });

  it("rejects a reply that changes nothing", () => {
    const outcome = applyEdits(parseBlocks(block("speed = 1;", "speed = 1;")), files({ "src/main.mtek": FILE }), editPolicy);
    expect(outcome.rejected.map((r) => r.code)).toEqual(["no-change"]);
  });

  it("rejects an edit of a file that does not exist", () => {
    const outcome = applyEdits(parseBlocks(block("a", "b", "src/other.mtek")), files({ "src/main.mtek": FILE }), editPolicy);
    expect(outcome.rejected[0]).toMatchObject({ code: "file-not-found", file: "src/other.mtek" });
  });
});

describe("applyEdits: which files and which blocks", () => {
  it("lets only mtek.toml and the .mtek sources change", () => {
    for (const path of ["tests/negative.test.toml", "dist/app.js", "src/main.txt", "assets/a.glb", "../outside.mtek"]) {
      const outcome = applyEdits(parseBlocks(block("a", "b", path)), files({ [path]: "a" }), coldPolicy);
      expect(outcome.rejected[0]?.code, path).toMatch(/path-not-allowed|path-invalid/);
      expect(outcome.files.size).toBe(0);
    }
    expect(applyEdits(parseBlocks(block("a", "b", "mtek.toml")), files({ "mtek.toml": "a" }), editPolicy).rejected).toEqual([]);
    expect(applyEdits(parseBlocks(block("a", "b", "src/deep/er/x.mtek")), files({ "src/deep/er/x.mtek": "a" }), editPolicy).rejected).toEqual([]);
  });

  it("rejects paths that leave the project", () => {
    for (const path of ["/etc/passwd", "C:\\x.mtek", "src\\main.mtek", "src/../mtek.toml", "./src/main.mtek", "src//main.mtek", ""]) {
      expect(normalizeProjectPath(path), path).toBeNull();
    }
    expect(normalizeProjectPath("src/main.mtek")).toBe("src/main.mtek");
  });

  it("allows a whole-file block to replace a file in a cold task", () => {
    const outcome = applyEdits(parseBlocks("<<<FILE src/main.mtek\n<<<WHOLE\nscene Demo {\n}\n>>>END\n"), files({ "src/main.mtek": FILE }), coldPolicy);
    expect(outcome.rejected).toEqual([]);
    expect(outcome.applied).toEqual([{ index: 1, file: "src/main.mtek", kind: "whole-replace" }]);
    expect(outcome.files.get("src/main.mtek")).toBe("scene Demo {\n}\n");
  });

  it("allows a whole-file block to create a file in any task", () => {
    const outcome = applyEdits(parseBlocks("<<<FILE src/extra.mtek\n<<<WHOLE\nx\n>>>END\n"), files({ "src/main.mtek": FILE }), editPolicy);
    expect(outcome.applied).toEqual([{ index: 1, file: "src/extra.mtek", kind: "whole-create" }]);
  });

  it("rejects a whole-file block that would replace an existing file of an edit task", () => {
    const outcome = applyEdits(parseBlocks("<<<FILE src/main.mtek\n<<<WHOLE\nscene Demo {\n}\n>>>END\n"), files({ "src/main.mtek": FILE }), editPolicy);
    expect(outcome.rejected[0]).toMatchObject({ code: "whole-file-not-allowed", file: "src/main.mtek" });
    expect(outcome.files.size).toBe(0);
  });

  it("rejects an empty whole-file block", () => {
    const outcome = applyEdits(parseBlocks("<<<FILE src/extra.mtek\n<<<WHOLE\n>>>END\n"), files({}), coldPolicy);
    expect(outcome.rejected[0]?.code).toBe("empty-whole-file");
  });

  it("tells the model what is allowed", () => {
    const outcome = applyEdits(parseBlocks(block("a", "b", "tests/x.toml")), files({}), editPolicy);
    expect(outcome.rejected[0]?.message).toContain("mtek.toml and the .mtek files under src/");
  });
});

describe("the other reply formats", () => {
  it("parses the JSON transport", () => {
    const json = JSON.stringify({ edits: [{ file: "src/main.mtek", search: "speed = 1;", replace: "speed = 2;" }] });
    for (const text of [json, `\`\`\`json\n${json}\n\`\`\``]) {
      const parsed = parseReply(text);
      expect(parsed.format).toBe("json");
      const outcome = applyEdits(parsed, files({ "src/main.mtek": FILE }), editPolicy);
      expect(outcome.rejected).toEqual([]);
      expect(outcome.files.get("src/main.mtek")).toContain("speed = 2;");
    }
  });

  it("rejects JSON that is not the edit schema", () => {
    expect(parseJsonEdits("{ not json").problems[0]?.code).toBe("json-invalid");
    expect(parseJsonEdits('{"edits": 3}').problems[0]?.code).toBe("json-invalid");
    expect(parseJsonEdits('{"edits": [{"file": "a", "search": "b"}]}').problems[0]?.code).toBe("json-invalid");
    expect(parseJsonEdits('{"edits": []}').problems[0]?.code).toBe("no-edit-blocks");
  });

  it("treats a module reply as the whole new content of the entry file, fences removed", () => {
    const parsed = parseModuleReply("```mtek\nscene Demo {\n}\n```", "src/main.mtek");
    expect(parsed.edits).toEqual([{ kind: "whole", file: "src/main.mtek", content: "scene Demo {\n}\n", index: 1 }]);
    expect(applyEdits(parseModuleReply("   \n", "src/main.mtek"), files({}), coldPolicy).rejected[0]?.code).toBe("empty-whole-file");
  });
});
