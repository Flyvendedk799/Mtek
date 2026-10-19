// The baseline side (decision 0108): the same bounded loop over the TypeScript + three.js project of a task, validated layer by
// layer, with the documentation counted like the context export. The candidate runner is a scripted stand-in (no tsc, no
// bundler, no browser); the real one is `baseline-integration.test.ts`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { baselineDocs, baselineRequiredNames, BaselineValidator } from "../src/baseline-side.ts";
import { ToolError } from "../src/errors.ts";
import { baselineSide, mtekSide, sideByName } from "../src/side.ts";
import { loadTask } from "../src/task.ts";
import { Workspace } from "../src/workspace.ts";
import { FakeBaseline } from "./baseline-helpers.ts";
import { editTask, harness, REPO_ROOT, reply, tempDir, validateRecord } from "./helpers.ts";

const SET_SPEED = "<<<FILE src/main.ts\n<<<SEARCH\n  let speed = 1;\n===\n  let speed = -1;\n>>>REPLACE\n";
const TYPE_ERROR = "<<<FILE src/main.ts\n<<<SEARCH\n  let speed = 1;\n===\n  let speed = TYPE_ERROR;\n>>>REPLACE\n";
const FIX_TYPE_ERROR = "<<<FILE src/main.ts\n<<<SEARCH\n  let speed = TYPE_ERROR;\n===\n  let speed = -1;\n>>>REPLACE\n";

function candidate(task = editTask()): { workspace: Workspace; set: (text: string) => void } {
  const workspace = baselineSide.createWorkspace(task, tempDir(), "candidate");
  return { workspace, set: (text) => workspace.write("src/main.ts", text) };
}

async function validate(options: { gpu?: boolean; crash?: boolean }, edit?: (text: string) => string) {
  const task = editTask();
  const { workspace, set } = candidate(task);
  if (edit !== undefined) set(edit(workspace.read("src/main.ts") ?? ""));
  try {
    const runner = new FakeBaseline(options);
    const result = await new BaselineValidator(task, { runner, script: "run-candidate.ts" }).validate({
      projectDir: workspace.projectDir,
      outDir: join(workspace.root, "out"),
      requiredSymbols: baselineSide.requiredSymbols(task),
    });
    return { result, runner };
  } finally {
    workspace.dispose();
  }
}

describe("the baseline workspace", () => {
  it("is the task's baseline starter with a tsconfig that resolves, and none of the task's fixtures", () => {
    const task = editTask();
    const { workspace } = candidate(task);
    try {
      expect(workspace.kind).toBe("baseline");
      expect(workspace.sourceFiles()).toEqual(["src/main.ts"]);
      const config = JSON.parse(workspace.read("tsconfig.json") ?? "{}") as { extends: string; include: string[] };
      expect(config.include).toEqual(["src"]);
      expect(config.extends).toMatch(/baselines\/support\/tsconfig\.base\.json$/);
      expect(config.extends).not.toMatch(/[A-Za-z]:/); // no machine path
      expect(workspace.read("tests/negative.test.toml")).toBeUndefined();
    } finally {
      workspace.dispose();
    }
  });

  it("refuses a task that has no baseline project", () => {
    const task = { ...editTask(), baselineDir: join(tempDir(), "missing") };
    expect(() => baselineSide.createWorkspace(task, tempDir(), "x")).toThrow(/no baseline project/);
  });
});

describe("the baseline's required names", () => {
  it("are the leaf names that the reference baseline declares as strings", () => {
    expect(baselineRequiredNames(editTask())).toEqual(["Cube", "Marker"]);
  });

  it("leave out what exists only in Mtek (a scene state) and keep what the reference names", () => {
    const task = loadTask(join(REPO_ROOT, "benchmarks", "tasks", "interaction-09"));
    expect(task.requiredSymbols).toContain("Demo.power");
    expect(baselineRequiredNames(task)).toEqual(["Stone", "Power"]);
    expect(baselineRequiredNames(loadTask(join(REPO_ROOT, "benchmarks", "tasks", "maintenance-06")))).toEqual([]);
  });
});

describe("the documentation", () => {
  it("is the checked-in reference with LF line endings, counted in bytes, and never truncated", () => {
    const docs = baselineDocs(24_000);
    expect(docs.text).not.toContain("\r");
    expect(docs.bytes).toBe(Buffer.byteLength(docs.text, "utf8"));
    expect(docs.compilerVersion).toBe("three@0.186.1");
    expect(docs.truncated).toBeNull();
    expect(docs.text).toContain("startTask");
    expect(() => baselineDocs(1000)).toThrow(ToolError);
  });
});

describe("the baseline validator", () => {
  it("passes a correct candidate on every layer and the required names", async () => {
    const { result, runner } = await validate({}, (t) => t.replace("let speed = 1;", "let speed = -1;"));
    expect(result.verdict).toBe("pass");
    expect(Object.values(result.layers).map((l) => l.outcome)).toEqual(["pass", "pass", "pass", "pass", "pass"]);
    expect(result.requiredSymbols).toMatchObject({ outcome: "pass", checked: ["Cube", "Marker"], missing: [] });
    expect(result.compilerVersion).toBe("typescript@6.0.3");
    expect(result.commands).toHaveLength(1);
    expect(runner.calls[0]?.args).toContain("--fixtures");
  });

  it("fails the tests layer, not the others, for a wrong candidate, and keeps the failure message", async () => {
    const { result } = await validate({});
    expect(result.verdict).toBe("fail");
    expect(result.layers.check.outcome).toBe("pass");
    expect(result.layers.start.outcome).toBe("pass");
    expect(result.layers.tests.outcome).toBe("fail");
    expect(result.testReport?.fixtures[0]?.failure?.kind).toBe("expectation");
  });

  it("records a type error as check, with the compiler's own line, and skips what follows", async () => {
    const { result } = await validate({}, (t) => t.replace("let speed = 1;", "let speed: number = TYPE_ERROR;"));
    expect(result.layers.parse.outcome).toBe("pass");
    expect(result.layers.check).toMatchObject({ outcome: "fail" });
    expect(result.layers.build).toMatchObject({ outcome: "not-run", notRun: "skipped" });
    expect(result.diagnostics[0]?.["rendered"]).toMatch(/^src\/main\.ts\(\d+,5\): error TS2322/);
  });

  it("records a syntax error as parse and check", async () => {
    const { result } = await validate({}, (t) => t.replace("let speed = 1;", "let speed = SYNTAX_ERROR"));
    expect(result.layers.parse.outcome).toBe("fail");
    expect(result.layers.check.outcome).toBe("fail");
  });

  it("records a bundler failure as build", async () => {
    const { result } = await validate({}, (t) => `${t}\n// BUILD_ERROR\n`);
    expect(result.layers.build.outcome).toBe("fail");
    expect(result.diagnostics[0]).toMatchObject({ code: "BASELINE-BUILD", phase: "build" });
    expect(result.layers.start.outcome).toBe("not-run");
  });

  it("records an application that does not start as start, and the tests as skipped", async () => {
    const { result } = await validate({}, (t) => `${t}\n// MOUNT_ERROR\n`);
    expect(result.layers.start.outcome).toBe("fail");
    expect(result.layers.tests).toMatchObject({ outcome: "not-run", notRun: "skipped" });
  });

  it("is NOT-RUN without a GPU, never a pass", async () => {
    const { result } = await validate({ gpu: false }, (t) => t.replace("let speed = 1;", "let speed = -1;"));
    expect(result.verdict).toBe("not-run");
    expect(result.layers.start).toMatchObject({ outcome: "not-run", notRun: "environment" });
    expect(result.layers.tests).toMatchObject({ outcome: "not-run", notRun: "environment" });
  });

  it("treats a crash of the runner as a failure of the tool chain, not of the candidate", async () => {
    const { result } = await validate({ crash: true });
    expect(result.verdict).toBe("error");
    expect(result.toolError).toMatch(/exited with 3/);
  });

  it("fails a candidate that deleted a named object even when it type-checks and passes", async () => {
    const { result } = await validate({}, (t) => t.replace('marker.name = "Marker";', "").replace("let speed = 1;", "let speed = -1;"));
    expect(result.requiredSymbols).toMatchObject({ outcome: "fail", missing: ["Marker"] });
    expect(result.verdict).toBe("fail");
  });
});

describe("a baseline trial", () => {
  const config = { side: baselineSide } as const;

  it("succeeds on the first try, records the side and the documentation, and validates against the schema", async () => {
    const h = harness([reply(SET_SPEED)], { deps: { programRunner: new FakeBaseline() } });
    const result = await h.run(config);
    expect(result.outcome).toBe("success");
    expect(result.trialId).toBe("demo-01--baseline-unconstrained--00");
    for (const line of h.recorder.lines) expect(validateRecord(JSON.parse(line) as unknown), line).toEqual([]);
    const start = h.recorder.records.find((r) => r["type"] === "trial-start");
    expect((start?.["condition"] as Record<string, unknown>)["side"]).toBe("baseline");
    expect((start?.["condition"] as Record<string, unknown>)["promptVersion"]).toBe("b1");
    expect(start?.["compilerVersion"]).toBe("three@0.186.1");
    expect(start?.["contextBytes"]).toBe(baselineDocs(24_000).bytes);
    expect(h.fake.calls).toEqual([]); // `mtek` was never run for a baseline trial
  });

  it("gives the model the TypeScript system prompt and the reference documentation, not the Mtek context", async () => {
    const h = harness([reply(SET_SPEED)], { deps: { programRunner: new FakeBaseline() } });
    await h.run(config);
    const request = h.client.requests[0];
    expect(request?.system).toContain("three.js r186");
    expect(request?.system).not.toContain("Mtek");
    const first = request?.messages[0]?.content ?? "";
    expect(first).toContain("# Reference documentation");
    expect(first).toContain("src/main.ts");
    expect(first).not.toContain("mtek context");
    expect(first).toContain("These objects must exist when you are done");
    expect(first).toContain("Cube, Marker");
  });

  it("repairs from the compiler's own diagnostics and counts the repair turn", async () => {
    const h = harness([reply(TYPE_ERROR), reply(FIX_TYPE_ERROR)], { deps: { programRunner: new FakeBaseline() } });
    const result = await h.run(config);
    expect(result.outcome).toBe("success");
    expect(result.repairsUsed).toBe(1);
    const second = h.client.requests[1]?.messages[2]?.content ?? "";
    expect(second).toContain("error TS2322");
    expect(second).toContain("src/main.ts around line");
    expect(second).toContain("- check: fail");
    for (const line of h.recorder.lines) expect(validateRecord(JSON.parse(line) as unknown), line).toEqual([]);
  });

  it("rejects an edit outside src/*.ts as the Mtek side rejects one outside its sources", async () => {
    const h = harness([reply("<<<FILE tsconfig.json\n<<<SEARCH\nsrc\n===\nlib\n>>>REPLACE\n"), reply(SET_SPEED)], { deps: { programRunner: new FakeBaseline() } });
    const result = await h.run(config);
    expect(result.outcome).toBe("success");
    const edit = h.recorder.records.find((r) => r["type"] === "edit");
    expect(edit?.["outcome"]).toBe("rejected");
    expect(JSON.stringify(edit?.["rejected"])).toContain("path-not-allowed");
  });

  it("is a different condition from the Mtek side's", async () => {
    const baseline = harness([reply(SET_SPEED)], { deps: { programRunner: new FakeBaseline() } });
    await baseline.run(config);
    const mtek = harness([reply("<<<FILE src/main.mtek\n<<<SEARCH\n        speed = 1;\n===\n        speed = -speed;\n>>>REPLACE\n")]);
    await mtek.run({ side: mtekSide });
    const id = (h: typeof baseline): unknown => h.recorder.records.find((r) => r["type"] === "trial-start")?.["conditionId"];
    expect(id(baseline)).not.toBe(id(mtek));
  });

  it("has no constrained mode and never runs one unconstrained", async () => {
    const h = harness([], { deps: { programRunner: new FakeBaseline() } });
    const result = await h.run({ ...config, trialKind: "constrained" });
    expect(result.outcome).toBe("unavailable");
    expect(result.message).toMatch(/grammar-constrained mode unavailable.*no grammar-constrained mode/);
    expect(h.client.requests).toEqual([]);
  });

  it("ends the trial not-run on a machine without a GPU", async () => {
    const h = harness([reply(SET_SPEED)], { deps: { programRunner: new FakeBaseline({ gpu: false }) } });
    expect((await h.run(config)).outcome).toBe("not-run");
  });
});

describe("sides", () => {
  it("are looked up by name", () => {
    expect(sideByName("mtek")).toBe(mtekSide);
    expect(sideByName("baseline")).toBe(baselineSide);
    expect(() => sideByName("both")).toThrow(/unknown side/);
  });

  it("have prompts that say the same rules in their own technology", () => {
    const task = editTask();
    const m = mtekSide.systemPrompt(task, mtekSide.policy(task)).split("\n").filter((l) => l.startsWith("- "));
    const b = baselineSide.systemPrompt(task, baselineSide.policy(task)).split("\n").filter((l) => l.startsWith("- "));
    expect(b).toHaveLength(m.length);
  });

  it("have the reference documentation checked in", () => {
    expect(readFileSync(join(REPO_ROOT, "benchmarks", "baselines", "docs", "reference.md"), "utf8")).toContain("three.js r186");
  });
});
