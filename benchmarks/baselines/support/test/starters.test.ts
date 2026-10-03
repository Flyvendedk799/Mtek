// The baseline starters are what a model is given. They must be genuine TypeScript projects, except
// that the maintenance starter contains exactly the two errors its task describes (a wrong vector
// dimension and an unknown field). The Playwright side checks the behaviour; this checks the types.
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const BENCHMARKS = resolve(import.meta.dirname, "..", "..", "..");
const HOLDOUT_TASKS = readdirSync(join(BENCHMARKS, "holdout"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

function diagnosticsOf(projectDir: string): { code: number; file: string; message: string }[] {
  const configPath = join(projectDir, "tsconfig.json");
  const config = ts.getParsedCommandLineOfConfigFile(configPath, undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    },
  });
  if (config === undefined) throw new Error(`cannot read ${configPath}`);
  const program = ts.createProgram({ rootNames: config.fileNames, options: config.options });
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => ({
    code: diagnostic.code,
    file: diagnostic.file === undefined ? "" : diagnostic.file.fileName.slice(BENCHMARKS.length + 1).replaceAll("\\", "/"),
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  }));
}

describe("baseline starters", () => {
  it.each(["scene-rendering-01", "interaction-01", "shader-bridge-01"])("%s starter type-checks", (task) => {
    expect(diagnosticsOf(join(BENCHMARKS, "tasks", task, "baseline"))).toEqual([]);
  });

  it.each(HOLDOUT_TASKS)("holdout task %s: starter type-checks", (task) => {
    expect(diagnosticsOf(join(BENCHMARKS, "holdout", task, "baseline"))).toEqual([]);
  });

  it("the maintenance starter has exactly the two errors of its task", () => {
    const diagnostics = diagnosticsOf(join(BENCHMARKS, "tasks", "maintenance-01", "baseline"));
    expect(diagnostics.map(({ file }) => file)).toEqual([
      "tasks/maintenance-01/baseline/src/main.ts",
      "tasks/maintenance-01/baseline/src/main.ts",
    ]);
    // An unknown field: `colour` is not a property of the material parameters.
    expect(diagnostics.some(({ message }) => message.includes("'colour'") && message.includes("does not exist"))).toBe(true);
    // A wrong vector dimension: a Vector2 where a Vector3 is required (no `z`).
    expect(diagnostics.some(({ message }) => message.includes("Vector2") && message.includes("'z'"))).toBe(true);
  });

  it.each(["scene-rendering-01", "interaction-01", "shader-bridge-01", "maintenance-01"])(
    "%s reference type-checks",
    (task) => {
      expect(diagnosticsOf(join(BENCHMARKS, "tasks", task, "reference", "baseline"))).toEqual([]);
    },
  );

  it.each(HOLDOUT_TASKS)("holdout task %s: reference type-checks", (task) => {
    expect(diagnosticsOf(join(BENCHMARKS, "holdout", task, "reference", "baseline"))).toEqual([]);
  });
}, 120_000);
