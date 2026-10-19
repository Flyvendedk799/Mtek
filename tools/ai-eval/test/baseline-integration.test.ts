// The real baseline runner (`benchmarks/baselines/support/test/run-candidate.ts`) on the real tasks: the TypeScript compiler and the
// bundler, in a candidate workspace made the way a trial makes it (inside node_modules/.cache of the repository, so that three and
// the support module resolve). The browser layers are skipped, so no GPU is needed; the browser run is exercised by
// `MTEK_AI_EVAL_BROWSER=1` (it needs a WebGPU adapter and takes the GPU).
import { cpSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProgramRunner } from "../src/commands.ts";
import { BaselineValidator } from "../src/baseline-side.ts";
import { baselineSide } from "../src/side.ts";
import { loadTask } from "../src/task.ts";
import { REPO_ROOT, tempDir } from "./helpers.ts";

const taskDir = (id: string): string => join(REPO_ROOT, "benchmarks", "tasks", id);

async function validateIn(id: string, source: "reference" | "starter", edit?: (text: string) => string, skipBrowser = true) {
  const task = loadTask(taskDir(id));
  const workspace = baselineSide.createWorkspace(task, tempDir(), `it-${id}-${source}-${String(Date.now())}`);
  try {
    if (source === "reference") {
      cpSync(join(task.dir, "reference", "baseline", "src"), join(workspace.projectDir, "src"), { recursive: true });
    }
    if (edit !== undefined) workspace.write("src/main.ts", edit(workspace.read("src/main.ts") ?? ""));
    const validator = new BaselineValidator(task, { runner: createProgramRunner(process.execPath), skipBrowser });
    return await validator.validate({ projectDir: workspace.projectDir, outDir: join(workspace.root, "out"), requiredSymbols: baselineSide.requiredSymbols(task) });
  } finally {
    workspace.dispose();
  }
}

describe("the baseline runner on real tasks (no browser)", () => {
  it("passes parse, check and build for a reference solution and leaves the browser layers NOT-RUN, so the verdict is not a pass", async () => {
    const result = await validateIn("interaction-01", "reference");
    expect(result.toolError).toBeNull();
    expect(result.layers.parse.outcome).toBe("pass");
    expect(result.layers.check.outcome).toBe("pass");
    expect(result.layers.build.outcome).toBe("pass");
    expect(result.layers.start).toMatchObject({ outcome: "not-run", notRun: "environment" });
    expect(result.layers.tests.outcome).toBe("not-run");
    expect(result.requiredSymbols.outcome).toBe("pass");
    expect(result.verdict).toBe("not-run");
    expect(result.compilerVersion).toMatch(/^typescript@\d/);
  }, 120_000);

  it("reports the exact TypeScript errors of the maintenance starter, with the compiler's own wording", async () => {
    const result = await validateIn("maintenance-01", "starter");
    expect(result.layers.parse.outcome).toBe("pass");
    expect(result.layers.check.outcome).toBe("fail");
    expect(result.layers.build).toMatchObject({ outcome: "not-run", notRun: "skipped" });
    expect(result.diagnostics.map((d) => d.code)).toEqual(["TS2561", "TS2345"]);
    expect(String(result.diagnostics[0]?.["rendered"])).toMatch(/^src\/main\.ts\(12,60\): error TS2561: .*colour/);
    expect(result.verdict).toBe("fail");
  }, 120_000);

  it("calls a syntax error a parse error and an unresolved import a check error (the compiler sees it before the bundler can)", async () => {
    const syntax = await validateIn("interaction-01", "reference", (t) => `${t}\nconst = ;\n`);
    expect(syntax.layers.parse.outcome).toBe("fail");
    expect(syntax.layers.check.outcome).toBe("fail");
    const build = await validateIn("interaction-01", "reference", (t) => `import { nothing } from "./nowhere";\nvoid nothing;\n${t}`);
    expect(build.layers.check.outcome).toBe("fail"); // the compiler already reports the unresolved module
    expect(build.diagnostics[0]?.code).toBe("TS2307");
  }, 120_000);

  it("catches a deleted named object even though the project still type-checks", async () => {
    const result = await validateIn("interaction-01", "reference", (t) => t.replaceAll('"Marker"', '"Other"'));
    expect(result.layers.check.outcome).toBe("pass");
    expect(result.requiredSymbols.outcome).toBe("fail");
    expect(result.requiredSymbols.missing).toEqual(["Marker"]);
    expect(result.verdict).toBe("fail");
  }, 120_000);
});

describe.skipIf(process.env["MTEK_AI_EVAL_BROWSER"] !== "1")("the baseline runner in a browser (needs a WebGPU adapter and the GPU lock)", () => {
  it("passes every fixture for a reference solution, and fails the starter's behaviour fixture", async () => {
    const reference = await validateIn("interaction-01", "reference", undefined, false);
    expect(reference.toolError).toBeNull();
    expect(reference.verdict).toBe("pass");
    expect(reference.testReport?.fallbackAdapter).toBe(false);
    const starter = await validateIn("interaction-01", "starter", undefined, false);
    expect(starter.layers.start.outcome).toBe("pass");
    expect(starter.layers.tests.outcome).toBe("fail");
    expect(starter.verdict).toBe("fail");
  }, 300_000);
});
