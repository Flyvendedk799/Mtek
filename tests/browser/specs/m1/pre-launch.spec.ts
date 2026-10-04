// M1 exit gate (task M1-21): an unknown field and a wrong vector dimension fail before launch, with
// spans. `mtek check --format json` (the CLI built by global setup) prints exactly one report that is
// valid against spec/diagnostic.schema.json and exits 1, and its diagnostics are exactly the expected
// ones of the M1-11 fail fixtures (code, file, byte span, message, notes). `mtek build --mode test`
// refuses the same projects and writes no output, so there is no page to launch.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { REPO_ROOT } from "../../support/environment.ts";
import { expect, test } from "../../support/fixtures.ts";
import { PRE_LAUNCH_FAILURES, SEMANTIC_FAIL_DIR, cliPath, runCli } from "../../support/m1-fixtures.ts";

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

/** 1-based line and column (in characters) of a byte offset of an ASCII source. */
function lineColumn(text: string, byte: number): [number, number] {
  const before = Buffer.from(text, "utf8").subarray(0, byte).toString("utf8");
  const lines = before.split("\n");
  return [lines.length, (lines.at(-1) ?? "").length + 1];
}

test.describe("M1 programs with field errors fail before launch (mtek check --format json)", () => {
  for (const name of PRE_LAUNCH_FAILURES) {
    test(`${name}: exit 1, one schema-valid report with the exact codes and spans, and no build output`, () => {
      const project = join(SEMANTIC_FAIL_DIR, name);
      const expected = JSON.parse(readFileSync(join(project, "expected.diag.json"), "utf8")) as ExpectedDiagnostic[];
      const source = readFileSync(join(project, "src", "main.mtek"), "utf8");

      const check = runCli(cliPath(), ["check", "--format", "json", project]);
      expect(check.status, check.stderr).toBe(1);
      expect(check.stderr, "--format json writes nothing to stderr").toBe("");
      const report = JSON.parse(check.stdout) as { diagnostics: ReportDiagnostic[]; summary: { errors: number } };
      expect(validateReport(report), JSON.stringify(validateReport.errors)).toBe(true);
      expect(report.summary.errors).toBe(expected.length);
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
      for (const diagnostic of report.diagnostics) {
        expect(diagnostic.severity).toBe("error");
        const span = diagnostic.source;
        if (span === null) throw new Error(`${diagnostic.code} has no span`);
        // The span's line/column fields agree with its byte offsets in the source.
        expect([span.startLine, span.startColumn]).toEqual(lineColumn(source, span.startByte));
        expect([span.endLine, span.endColumn]).toEqual(lineColumn(source, span.endByte));
      }

      // Nothing to launch: the build is refused and no page is written.
      const scratch = mkdtempSync(join(tmpdir(), "mtek-m1-prelaunch-"));
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
    });
  }
});
