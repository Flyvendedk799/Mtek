// M2 exit gate, criterion 2 (task M2-12): invalid captures and CPU-only function calls from shader code are
// rejected before launch. `mtek check --format json` (the CLI built by global setup) prints exactly one report
// that is valid against spec/diagnostic.schema.json and exits 1; its diagnostics are exactly the expected ones
// of the checked-in fail fixtures (code, severity, file, byte span, message, notes), and `mtek build --mode
// test` refuses the same projects and writes no output, so there is no page to launch.
//
// - E4040: a fragment stage captures scene state, `frame.time`, an entity field or `self`, or calls a `cpu fn`.
// - E4002: a pure `fn` (and so shader code) calls a `cpu fn`, directly, through a chain, or through an import.
// - E4013, a GPU-only built-in function called from CPU code, cannot be produced by any program this build
//   accepts: every GPU-only built-in (`sample`, `lighting.pbr`) is gated to M4 and a program that calls one is
//   rejected as not implemented (E9010). That rejection is asserted below on a CPU function; the E4013 rule
//   itself is covered by the unit tests of `types/effects.rs` (`src/types/effects_tests.rs`), which run it
//   against a registry in which a built-in is made GPU-only.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { REPO_ROOT } from "../../support/environment.ts";
import { expect, test } from "../../support/fixtures.ts";
import { cliPath, runCli } from "../../support/m1-fixtures.ts";
import { SEMANTIC_FAIL_DIR } from "../../support/m2-fixtures.ts";

interface ExpectedDiagnostic {
  code: string;
  file: string;
  startByte: number;
  endByte: number;
  message: string;
  notes?: string[];
}

interface ReportDiagnostic {
  code: string;
  severity: string;
  message: string;
  notes: string[];
  source: { file: string; startByte: number; endByte: number; startLine: number; startColumn: number; endLine: number; endColumn: number } | null;
}

const schema = JSON.parse(readFileSync(join(REPO_ROOT, "spec", "diagnostic.schema.json"), "utf8")) as object;
const validateReport = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

/** 1-based line and column (in characters) of a byte offset. */
function lineColumn(text: string, byte: number): [number, number] {
  const before = Buffer.from(text, "utf8").subarray(0, byte).toString("utf8");
  const lines = before.split("\n");
  return [lines.length, (lines.at(-1) ?? "").length + 1];
}

/** The existing fail fixtures (`tests/semantics/fail/<group>/<name>`) the M2 gate relies on, and the rule each shows. */
const REJECTIONS: ReadonlyArray<{ fixture: string; rule: string }> = [
  { fixture: "materials/e4040_scene_state", rule: "a fragment captures scene state" },
  { fixture: "materials/e4040_frame_time", rule: "a fragment captures frame.time (the note says to add a param and bind it)" },
  { fixture: "materials/e4040_entity_field", rule: "a fragment captures an entity field" },
  { fixture: "materials/e4040_self", rule: "a fragment captures self" },
  { fixture: "materials/e4040_cpu_fn_call", rule: "a fragment calls a cpu fn" },
  { fixture: "materials/e4002_stage_reaches_cpu_fn_through_fn", rule: "shader code reaches a cpu fn through a pure fn" },
  { fixture: "functions/e4002_calls_cpu_fn", rule: "a pure fn calls a cpu fn" },
  { fixture: "functions/e4002_call_chain", rule: "a pure fn reaches a cpu fn through a chain" },
  { fixture: "functions/e4002_imported_cpu_fn", rule: "a pure fn calls an imported cpu fn" },
];

function expectRejected(project: string, expected: ExpectedDiagnostic[]): void {
  const source = readFileSync(join(project, "src", "main.mtek"), "utf8");
  const check = runCli(cliPath(), ["check", "--format", "json", project]);
  expect(check.status, check.stderr).toBe(1);
  expect(check.stderr, "--format json writes nothing to stderr").toBe("");
  const report = JSON.parse(check.stdout) as { diagnostics: ReportDiagnostic[]; summary: { errors: number } };
  expect(validateReport(report), JSON.stringify(validateReport.errors)).toBe(true);
  expect(report.summary.errors).toBe(expected.filter((d) => /^MTEK-E/.test(d.code)).length);
  expect(
    report.diagnostics.map((d) => ({
      code: d.code,
      file: d.source?.file,
      startByte: d.source?.startByte,
      endByte: d.source?.endByte,
      message: d.message,
      notes: d.notes,
    })),
  ).toEqual(expected.map((d) => ({ code: d.code, file: d.file, startByte: d.startByte, endByte: d.endByte, message: d.message, notes: d.notes ?? [] })));
  // Every span of the main file agrees between its byte offsets and its line/column fields.
  for (const diagnostic of report.diagnostics) {
    const span = diagnostic.source;
    if (span === null) throw new Error(`${diagnostic.code} has no span`);
    if (span.file !== "src/main.mtek") continue;
    expect([span.startLine, span.startColumn]).toEqual(lineColumn(source, span.startByte));
    expect([span.endLine, span.endColumn]).toEqual(lineColumn(source, span.endByte));
  }

  // Nothing to launch: the build is refused and no page is written.
  const scratch = mkdtempSync(join(tmpdir(), "mtek-m2-reject-"));
  try {
    const out = join(scratch, "dist");
    const build = runCli(cliPath(), ["build", "--mode", "test", "--format", "json", "--out", out, project]);
    expect(build.status).toBe(1);
    const buildReport = JSON.parse(build.stdout) as { diagnostics: ReportDiagnostic[] };
    expect(buildReport.diagnostics.map((d) => d.code)).toEqual(expected.map((d) => d.code));
    expect(existsSync(out), "no output directory").toBe(false);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

test.describe("M2 invalid captures and CPU-only calls from shader code fail before launch (mtek check --format json)", () => {
  for (const { fixture, rule } of REJECTIONS) {
    test(`${fixture}: ${rule}`, () => {
      const project = join(SEMANTIC_FAIL_DIR, ...fixture.split("/"));
      const expected = JSON.parse(readFileSync(join(project, "expected.diag.json"), "utf8")) as ExpectedDiagnostic[];
      const code = fixture.split("/").at(-1)?.slice(0, 5).toUpperCase() ?? "";
      expect(
        expected.some((d) => d.code === `MTEK-${code}`),
        `${fixture} expects ${code}`,
      ).toBe(true);
      expectRejected(project, expected);
    });
  }

  test("a GPU-only built-in called from CPU code is rejected (E9010: gated to M4; the E4013 rule is covered by the compiler's unit tests)", () => {
    const scratch = mkdtempSync(join(tmpdir(), "mtek-m2-gpu-only-"));
    try {
      mkdirSync(join(scratch, "src"));
      writeFileSync(join(scratch, "mtek.toml"), '[project]\nname = "gpu-only"\nlanguage = "0.1"\n');
      writeFileSync(join(scratch, "src", "main.mtek"), "cpu fn shade(x: f32) -> f32 {\n    return sample(x);\n}\n\nscene Demo {\n    camera Main {}\n}\n");
      const check = runCli(cliPath(), ["check", "--format", "json", scratch]);
      expect(check.status, check.stderr).toBe(1);
      const report = JSON.parse(check.stdout) as { diagnostics: ReportDiagnostic[] };
      expect(validateReport(report), JSON.stringify(validateReport.errors)).toBe(true);
      const errors = report.diagnostics.filter((d) => d.severity === "error");
      expect(errors.map((d) => d.code)).toEqual(["MTEK-E9010"]);
      expect(errors[0]?.message).toContain("`sample`");
      expect(errors[0]?.message).toContain("planned for M4");
      expect(errors[0]?.source).toMatchObject({ file: "src/main.mtek", startLine: 2 });
      const build = runCli(cliPath(), ["build", "--mode", "test", "--format", "json", "--out", join(scratch, "dist"), scratch]);
      expect(build.status).toBe(1);
      expect(existsSync(join(scratch, "dist")), "no output directory").toBe(false);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
