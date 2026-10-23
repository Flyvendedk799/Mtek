// M4 guardrail (blueprint, M4 milestone): "Do not declare broad glTF support from one hand-picked file." The documented profile is
// the table of spec/assets.md section 3; this is a CONSISTENCY test, not a claim of support: it reads the table and checks that
// every way the table says a file can be unsupported has at least one failing fixture under tests/assets/fail/, named for the
// diagnostic code it triggers, whose expectation file lists that code. That the compiler really rejects each fixture with
// exactly those diagnostics is checked by `cargo test --workspace` (crates/mtek-compiler/tests/fixtures.rs); the one supported
// model (the chair) and the supported fixtures prove nothing about files the table does not describe.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./environment.ts";

const SPEC = readFileSync(join(REPO_ROOT, "spec", "assets.md"), "utf8");
const FAIL_DIR = join(REPO_ROOT, "tests", "assets", "fail");

interface Row {
  readonly area: string;
  readonly supported: string;
  readonly otherwise: string;
}

/** The rows of the table of section 3, without the header and the separator. */
function profileRows(): Row[] {
  const start = SPEC.indexOf("## 3. The static GLB profile");
  const end = SPEC.indexOf("\n## 4.", start);
  if (start < 0 || end < 0) throw new Error("section 3 of spec/assets.md was not found");
  const rows: Row[] = [];
  for (const line of SPEC.slice(start, end).split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 3) throw new Error(`a row of the profile table does not have three cells: ${line}`);
    const [area, supported, otherwise] = cells as [string, string, string];
    if (area === "Area" || /^-+$/.test(area)) continue;
    rows.push({ area, supported, otherwise });
  }
  return rows;
}

const codesIn = (text: string): string[] => [...new Set(text.match(/E\d{4}/g) ?? [])];

/** The fixture directories of tests/assets/fail named for `code` (`E7016` -> `e7016_*`). */
function fixturesFor(code: string): string[] {
  const prefix = `${code.toLowerCase()}_`;
  return readdirSync(FAIL_DIR).filter((name) => name.startsWith(prefix));
}

/** The codes an `expected.diag.json` lists (`MTEK-E7016` -> `E7016`). */
function expectedCodes(fixture: string): string[] {
  const file = join(FAIL_DIR, fixture, "expected.diag.json");
  expect(existsSync(file), `${fixture} has an expected.diag.json`).toBe(true);
  const diagnostics = JSON.parse(readFileSync(file, "utf8")) as Array<{ code: string }>;
  return diagnostics.map((d) => d.code.replace(/^MTEK-/, ""));
}

describe("the documented GLB profile and its failing fixtures (spec/assets.md section 3)", () => {
  const rows = profileRows();

  it("reads the table: the thirteen areas of the profile", () => {
    expect(rows.map((row) => row.area)).toEqual([
      "Container",
      "Size",
      "Extensions",
      "Primitive mode",
      "Attributes",
      "Indices",
      "Accessors",
      "Materials",
      "Images",
      "Samplers",
      "Node transforms",
      "Animations, skins",
      "Cameras, `extras`, unreferenced scenes",
    ]);
  });

  it("names a diagnostic code for every area that can be unsupported, except two that are documented as having none here", () => {
    const withoutCode = rows.filter((row) => codesIn(row.otherwise).length === 0);
    // "Node transforms": the rule and its code E7013 are in section 2.1 (the table points there); the last row is not inspected.
    expect(withoutCode.map((row) => row.area)).toEqual(["Node transforms", "Cameras, `extras`, unreferenced scenes"]);
    expect(withoutCode[0]?.otherwise).toContain("§2.1");
    expect(SPEC).toMatch(/`E7013` is reported when the world matrix is not affine/);
    expect(withoutCode[1]?.supported).toContain("not inspected");
    // Every row that does name codes says what it supports as well.
    for (const row of rows) expect(row.supported.length, row.area).toBeGreaterThan(0);
  });

  const documented = [...new Set([...rows.flatMap((row) => codesIn(row.otherwise)), "E7013"])].sort();

  it("lists the codes the table and section 2.1 document", () => {
    expect(documented).toEqual([
      "E7001", "E7002", "E7003", "E7004", "E7005", "E7006", "E7007", "E7008", "E7009", "E7011", "E7013",
      "E7014", "E7015", "E7016", "E7017", "E7018", "E7019", "E7025",
    ]);
  });

  for (const code of documented) {
    it(`${code} has a failing fixture whose expected diagnostics include it`, () => {
      const fixtures = fixturesFor(code);
      expect(fixtures.length, `a fixture under tests/assets/fail/ named ${code.toLowerCase()}_*`).toBeGreaterThanOrEqual(1);
      for (const fixture of fixtures) {
        expect(expectedCodes(fixture), `${fixture} expects ${code}`).toContain(`${code}`);
      }
    });
  }

  it("has a failing fixture for each row's every code, so no row of the table rests on another row's fixture", () => {
    for (const row of rows) {
      for (const code of codesIn(row.otherwise)) {
        expect(fixturesFor(code).length, `${row.area}: ${code}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("has fixtures for the specific features the guardrail is about: normal texture, extension, skin, cubic-spline animation, sparse accessor, wrong mode", () => {
    for (const name of ["e7016_normal_texture", "e7004_required_extension", "e7019_skin", "e7019_cubic_spline", "e7011_sparse_accessor", "e7006_mode_lines"]) {
      expect(existsSync(join(FAIL_DIR, name, "expected.diag.json")), name).toBe(true);
    }
  });

  it("documents the supported set as a list, not as a general claim", () => {
    // The profile says "static" and "v0.1" and lists what is supported; nothing in it promises glTF in general.
    expect(SPEC).toContain("Do not declare broad glTF support from one file (blueprint M4 guardrail)");
    expect(SPEC).not.toMatch(/full glTF support|supports glTF 2\.0 in general/i);
  });
});
