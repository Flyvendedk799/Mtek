// The harness against the real `mtek` binary (built by `npm run build`; CI's node job builds it before
// the unit tests). Nothing here needs a GPU or a browser: `mtek test` is made NOT-RUN on purpose with
// an unusable Node (`MTEK_NODE`), which is itself the NOT-RUN path of decision 0074 end to end. If no
// binary exists the tests are skipped and vitest says so; they are not silently green.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ContextBuilder } from "../src/context-builder.ts";
import { createMtekRunner, findMtek } from "../src/commands.ts";
import { loadTask } from "../src/task.ts";
import { Validator } from "../src/validator.ts";
import { Workspace } from "../src/workspace.ts";
import { REPO_ROOT, tempDir, validateRecord } from "./helpers.ts";
import { createReplayClient } from "../src/adapters/replay.ts";
import { MemoryRecorder } from "../src/recorder.ts";
import { RepairLoop } from "../src/repair-loop.ts";
import { steppingClock } from "../src/clock.ts";

const mtek = findMtek();
const tasksDir = join(REPO_ROOT, "benchmarks", "tasks");
const taskIds = ["scene-rendering-01", "interaction-01", "shader-bridge-01", "maintenance-01"];

describe.skipIf(mtek === null)("against the real compiler", () => {
  const unusableNode = join(tempDir("ai-eval-nonode-"), "no-such-node");
  const runner = createMtekRunner(mtek ?? "mtek", { MTEK_NODE: unusableNode });

  async function validate(taskId: string, project: string | null, edit?: (projectDir: string) => void) {
    const task = loadTask(join(tasksDir, taskId));
    const scratch = tempDir("ai-eval-int-");
    const workspace = Workspace.create(task, scratch, "w", project === null ? {} : { from: join(task.dir, ...project.split("/")) });
    edit?.(workspace.projectDir);
    return new Validator(runner).validate({ projectDir: workspace.projectDir, outDir: join(workspace.root, "out"), requiredSymbols: task.requiredSymbols });
  }

  it.each(taskIds)("the reference solution of %s parses, checks and builds, declares its required symbols and is NOT-RUN here, never a pass", async (id) => {
    const result = await validate(id, "reference/mtek");
    expect(result.toolError).toBeNull();
    expect(result.layers.parse.outcome).toBe("pass");
    expect(result.layers.check.outcome).toBe("pass");
    expect(result.layers.build.outcome).toBe("pass");
    expect(result.requiredSymbols).toMatchObject({ outcome: "pass", missing: [] });
    expect(result.layers.start).toMatchObject({ outcome: "not-run", notRun: "environment" });
    expect(result.layers.tests).toMatchObject({ outcome: "not-run", notRun: "environment" });
    expect(result.verdict).toBe("not-run");
    expect(result.testReport?.status).toBe("not-run");
    expect(result.testReport?.fixtures.length).toBeGreaterThan(0);
    expect(result.compilerVersion).toMatch(/^\d/);
    // no machine path in the recorded reason
    expect(result.layers.tests.reason).not.toMatch(/[A-Za-z]:[\\/]/);
  }, 60_000);

  it("the starter of maintenance-01 fails check with exactly the diagnostics its task.toml predicts, and still declares the required symbols", async () => {
    const result = await validate("maintenance-01", null);
    expect(result.layers.parse.outcome).toBe("pass");
    expect(result.layers.check.outcome).toBe("fail");
    expect(result.diagnostics.map((d) => d.code).sort()).toEqual(["MTEK-E3102", "MTEK-E5001"]);
    expect(result.layers.build.notRun).toBe("skipped");
    expect(result.requiredSymbols).toMatchObject({ outcome: "pass", missing: [] });
    expect(result.verdict).toBe("fail");
  }, 60_000);

  it("a syntax error fails parse and check", async () => {
    const result = await validate("interaction-01", "reference/mtek", (dir) => {
      const file = join(dir, "src", "main.mtek");
      writeFileSync(file, readFileSync(file, "utf8").replace("angle += speed * dt;", "angle += speed * dt"));
    });
    expect(result.layers.parse.outcome).toBe("fail");
    expect(result.layers.check.outcome).toBe("fail");
    expect(result.diagnostics[0]).toMatchObject({ code: "MTEK-E1003", phase: "parse" });
  }, 60_000);

  it("a 'repair' that deletes a required entity checks and builds, and is caught by the required symbols", async () => {
    const result = await validate("interaction-01", "reference/mtek", (dir) => {
      const file = join(dir, "src", "main.mtek");
      const source = readFileSync(file, "utf8");
      const start = source.indexOf("        entity Marker {");
      expect(start).toBeGreaterThan(0);
      // delete the nested entity Marker, the way a model might to get rid of an error
      const end = source.indexOf("        }\n", start) + "        }\n".length;
      writeFileSync(file, source.slice(0, start) + source.slice(end));
    });
    expect(result.layers.check.outcome).toBe("pass");
    expect(result.layers.build.outcome).toBe("pass");
    expect(result.requiredSymbols).toMatchObject({ outcome: "fail", missing: ["Demo.Cube.Marker"] });
    expect(result.verdict).toBe("fail");
  }, 60_000);

  it("the ContextBuilder returns the compiler's own document for a task's project and symbols", async () => {
    const task = loadTask(join(tasksDir, "interaction-01"));
    const context = await new ContextBuilder(runner).build({ projectDir: task.projectDir, symbols: task.requiredSymbols, maxBytes: 24000 });
    expect(context.contextFormat).toBe(1);
    expect(context.bytes).toBeLessThanOrEqual(24000);
    const document = JSON.parse(context.text) as { symbols: { name: string }[] };
    expect(document.symbols.map((s) => s.name)).toEqual(expect.arrayContaining(task.requiredSymbols));
    // a cold task's stub has no symbols to ask for, and the context is still produced
    const cold = loadTask(join(tasksDir, "scene-rendering-01"));
    expect((await new ContextBuilder(runner).build({ projectDir: cold.projectDir, symbols: [], maxBytes: 24000 })).contextFormat).toBe(1);
  }, 60_000);

  it("runs a whole trial with the real compiler and ends NOT-RUN, not success, when the tests cannot run", async () => {
    const task = loadTask(join(tasksDir, "interaction-01"));
    const reference = readFileSync(join(task.dir, "reference", "mtek", "src", "main.mtek"), "utf8");
    // the model answers with the reference solution as a whole file; for this edit task that is refused,
    // so ask for exactly the change with search/replace blocks computed from the starter and the reference.
    const starter = readFileSync(join(task.projectDir, "src", "main.mtek"), "utf8");
    expect(reference).not.toBe(starter);
    const scratch = tempDir("ai-eval-trial-");
    const recorder = new MemoryRecorder("int");
    const reply = `<<<FILE src/main.mtek\n<<<SEARCH\n${starter.replace(/\n$/, "")}\n===\n${reference.replace(/\n$/, "")}\n>>>REPLACE\n`;
    const client = createReplayClient([{ text: reply, finish: "stop", usage: { inputTokens: 1, outputTokens: 1 } }]);
    const loop = new RepairLoop({ runner, recorder, clock: steppingClock(), scratchRoot: scratch, runDir: tempDir("ai-eval-run-") });
    const result = await loop.run({ task, client, trialKind: "unconstrained", trialIndex: 0, temperature: 0 });
    expect(result.outcome).toBe("not-run");
    expect(result.final?.layers.build.outcome).toBe("pass");
    for (const record of recorder.records) expect(validateRecord(record), JSON.stringify(record).slice(0, 100)).toEqual([]);
  }, 120_000);

  it("a candidate holds the writable sources and, apart from them, the task's fixtures in tests/", () => {
    const task = loadTask(join(tasksDir, "interaction-01"));
    const workspace = Workspace.create(task, tempDir("ai-eval-int-"), "w");
    expect(workspace.sourceFiles()).toEqual(["mtek.toml", "src/main.mtek"]);
    expect(existsSync(join(workspace.projectDir, "tests", "rotation.test.toml"))).toBe(true);
  });
});
