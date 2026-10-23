import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  auditCodes,
  readCatalogue,
  readFixtureCodes,
  type CatalogueEntry,
  type DiagnosticFixture,
  type Exceptions,
} from "../src/diagnostics.ts";
import { REPO_ROOT, tempDir } from "./helpers.ts";

const entry = (code: string, mark: CatalogueEntry["mark"] = null): CatalogueEntry => ({ code, title: `title of ${code}`, trigger: "", mark });
const fixture = (file: string): DiagnosticFixture => ({ file, fixture: file, suite: "semantics-fail", messages: [] });
const none: Exceptions = { notYetImplemented: [], reserved: [], unreachable: [], coveredElsewhere: [] };
const read = (files: Record<string, string>) => (path: string) => files[path] ?? null;

describe("readCatalogue", () => {
  it("reads the rows of the catalogue with their marks", () => {
    const root = tempDir();
    mkdirSync(join(root, "spec"));
    writeFileSync(
      join(root, "spec", "diagnostics.md"),
      [
        "| Code | Title | Trigger |",
        "|---|---|---|",
        '| <a id="mtek-e3001"></a>E3001 | type mismatch (general) | expected/actual set |',
        '| <a id="mtek-e5901"></a>E5901 | scene switching not supported | **Reserved:** no construct |',
        '| <a id="mtek-w0030"></a>W0030 | naming convention | **Not implemented:** the lint |',
        "| (E7032–E7099) | further asset codes | reserved |",
        "",
      ].join("\r\n"),
    );
    expect(readCatalogue(root)).toEqual([
      { code: "E3001", title: "type mismatch (general)", trigger: "expected/actual set", mark: null },
      { code: "E5901", title: "scene switching not supported", trigger: "**Reserved:** no construct", mark: "reserved" },
      { code: "W0030", title: "naming convention", trigger: "**Not implemented:** the lint", mark: "not-implemented" },
    ]);
  });

  it("reads the real catalogue: every code once, in the shape of the specification", () => {
    const codes = readCatalogue(REPO_ROOT).map((e) => e.code);
    expect(codes.length).toBeGreaterThan(150);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[EW]\d{4}$/);
  });
});

describe("readFixtureCodes", () => {
  it("finds the codes of the real fixture suites, with the fixture and the message", () => {
    const codes = readFixtureCodes(REPO_ROOT);
    const e3001 = codes.get("MTEK-E3001") ?? [];
    expect(e3001.length).toBeGreaterThan(3);
    expect(e3001.every((f) => f.messages.length > 0)).toBe(true);
    // lexer, parser golden, semantic and asset fixtures are all read
    expect(codes.get("MTEK-E0005")?.[0]?.suite).toBe("syntax-lex");
    expect(codes.get("MTEK-E1010")?.some((f) => f.suite === "syntax-ast")).toBe(true);
    expect(codes.get("MTEK-E7001")?.[0]?.suite).toBe("assets-fail");
    expect(codes.get("MTEK-W2010")?.some((f) => f.suite === "semantics-pass")).toBe(true);
  }, 30_000);
});

describe("auditCodes", () => {
  const catalogue = [entry("E1001"), entry("E1002"), entry("W0030", "not-implemented"), entry("E8001")];
  const fixtures = new Map<string, DiagnosticFixture[]>([["MTEK-E1001", [fixture("tests/syntax/fail/a.diag.json")]]]);

  it("lists a code with no fixture, no named test and no mark as uncovered", () => {
    const audit = auditCodes(catalogue, fixtures, none, read({}));
    expect(audit.uncovered).toEqual(["E1002", "W0030", "E8001"]);
    expect(audit.coverage.get("E1001")?.kind).toBe("fixture");
  });

  it("accepts a reserved code that the catalogue marks, a named test that names the code, and nothing else", () => {
    const exceptions: Exceptions = {
      ...none,
      reserved: [{ code: "W0030", reason: "not built", test: null }],
      coveredElsewhere: [{ code: "E8001", reason: "a runtime code", test: "a.test.ts" }],
    };
    const audit = auditCodes(catalogue, fixtures, exceptions, read({ "a.test.ts": "expect(code).toBe('E8001')" }));
    expect(audit.problems).toEqual([]);
    expect(audit.uncovered).toEqual(["E1002"]);
    expect(audit.coverage.get("W0030")).toMatchObject({ kind: "reserved" });
    expect(audit.coverage.get("E8001")).toMatchObject({ kind: "covered-elsewhere" });
  });

  it("reports a test file that is missing or does not name the code", () => {
    const exceptions: Exceptions = {
      ...none,
      coveredElsewhere: [
        { code: "E8001", reason: "r", test: "missing.test.ts" },
        { code: "E1002", reason: "r", test: "other.test.ts" },
      ],
    };
    const audit = auditCodes(catalogue, fixtures, exceptions, read({ "other.test.ts": "nothing" }));
    expect(audit.problems).toContain("E8001: the test file missing.test.ts does not exist");
    expect(audit.problems).toContain("E1002: other.test.ts does not name it");
  });

  it("reports a reservation the catalogue does not mark, and a mark with no reservation", () => {
    const unmarked = auditCodes([entry("E1002")], new Map(), { ...none, reserved: [{ code: "E1002", reason: "r", test: null }] }, read({}));
    expect(unmarked.problems.join("\n")).toContain("E1002 is listed as reserved, but its row in spec/diagnostics.md carries no");
    const marked = auditCodes([entry("E1002", "reserved")], new Map(), { ...none, coveredElsewhere: [{ code: "E1002", reason: "r", test: "t" }] }, read({ t: "E1002" }));
    expect(marked.problems.join("\n")).toContain("E1002 is marked reserved in the catalogue but is listed as coveredElsewhere");
  });

  it("reports an entry that went stale because the code gained a fixture", () => {
    const exceptions: Exceptions = { ...none, reserved: [{ code: "E1001", reason: "r", test: null }] };
    const audit = auditCodes([entry("E1001", "reserved")], fixtures, exceptions, read({}));
    expect(audit.problems.join("\n")).toContain("E1001 now has a fixture");
    expect(audit.problems.join("\n")).toContain("the catalogue still marks it reserved");
  });

  it("refuses codes that are listed twice, unknown codes and anything still waiting for an implementation", () => {
    const exceptions: Exceptions = {
      notYetImplemented: [{ code: "E1002", reason: "M9", test: null }],
      reserved: [{ code: "E1002", reason: "r", test: null }, { code: "E9999", reason: "r", test: null }],
      unreachable: [],
      coveredElsewhere: [],
    };
    const audit = auditCodes([entry("E1002", "reserved")], new Map(), exceptions, read({}));
    const text = audit.problems.join("\n");
    expect(text).toContain("E1002 is listed in notYetImplemented and reserved");
    expect(text).toContain("E9999, which is not a catalogue code");
    expect(text).toContain("M7 requires the list to be empty");
  });

  it("refuses a fixture that expects a code the catalogue does not have", () => {
    const audit = auditCodes([entry("E1001")], new Map([["MTEK-E1234", [fixture("x")]], ["MTEK-E1001", [fixture("y")]]]), none, read({}));
    expect(audit.problems.join("\n")).toContain("a fixture expects MTEK-E1234, which is not a catalogue code");
  });
});
