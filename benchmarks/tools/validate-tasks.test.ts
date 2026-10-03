import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeHoldoutHash, formatHashFile } from "./hash-holdout.mjs";
import { validateBenchmarks } from "./validate-tasks.mjs";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mtek-validate-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function put(path: string, content: string): void {
  const file = join(root, ...path.split("/"));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function taskToml(id: string, extra = ""): string {
  const category = id.startsWith("holdout") ? "scene-rendering" : id.slice(0, -3);
  return `id = "${id}"
category = "${category}"
mode = "edit"
title = "A title"
prompt = """Do the thing."""
required_symbols = ["Demo.Cube"]
mtek_side_status = "unverified-until-M6"
${extra}
[budgets]
max_repairs = 3
max_output_tokens = 4000
max_wall_seconds = 300
`;
}

const FIXTURE = `name = "pixel"
steps = [
  { step = 1, dt = 0.016666668 },
  { press = "Space" },
  { set_input = { tint = "#ff8800" } },
  { expect_pixel = { x = 64, y = 64, color = "#6b5cff", tolerance = 2 } },
]
`;

const SOURCE = "scene Demo {\n    entity Cube {}\n}\n";

/** Writes a complete, valid task directory below `base` (benchmarks/tasks or benchmarks/holdout). */
function writeTask(base: string, id: string, extraToml = ""): void {
  const dir = `${base}/${id}`;
  put(`${dir}/task.toml`, taskToml(id, extraToml));
  put(`${dir}/mtek/mtek.toml`, '[project]\nname = "x"\n');
  put(`${dir}/mtek/src/main.mtek`, SOURCE);
  put(`${dir}/mtek-tests/a.test.toml`, FIXTURE);
  put(`${dir}/baseline/src/main.ts`, "export {};\n");
  put(`${dir}/baseline-tests/a.spec.ts`, "export {};\n");
  put(`${dir}/reference/mtek/mtek.toml`, '[project]\nname = "x"\n');
  put(`${dir}/reference/mtek/src/main.mtek`, `// UNVERIFIED: not compiled yet.\n${SOURCE}`);
  put(`${dir}/reference/baseline/src/main.ts`, "export {};\n");
}

/** A valid repository: one task, one holdout task, a matching hash and the .gitattributes rule. */
function writeValidRepo(): void {
  writeTask("benchmarks/tasks", "interaction-01");
  writeTask("benchmarks/holdout", "holdout-01");
  put(".gitattributes", "* text=auto eol=lf\nbenchmarks/holdout/** text eol=lf\n");
  put("spec/readme.md", "design material\n");
  writeFileSync(join(root, "benchmarks", "holdout.sha256"), formatHashFile(computeHoldoutHash(join(root, "benchmarks", "holdout"))));
}

function errorsOf(): string[] {
  return validateBenchmarks(root).errors;
}

describe("validateBenchmarks", () => {
  it("accepts a complete repository and reports it in sorted, path-free lines", () => {
    writeValidRepo();
    const { errors, lines } = validateBenchmarks(root);
    expect(errors).toEqual([]);
    expect(lines[0]).toBe("benchmarks: 1 task, 1 holdout task");
    expect(lines.slice(1, 3)).toEqual([
      "  holdout-01  scene-rendering  edit  mtek_side_status=unverified-until-M6",
      "  interaction-01  interaction  edit  mtek_side_status=unverified-until-M6",
    ].sort());
    expect(lines.join("\n")).not.toContain(root);
    expect(lines.at(-1)).toMatch(/^holdout id scan: \d+ files/);
  });

  it("rejects unknown and missing task.toml keys, bad values and a wrong id", () => {
    writeValidRepo();
    put("benchmarks/tasks/interaction-01/task.toml", `id = "interaction-02"
category = "intraction"
mode = "warm"
title = ""
prompt = "x"
colour = 1
mtek_side_status = "verified?"
required_symbols = []
[budgets]
max_repairs = -1
max_output_tokens = 0
`);
    const errors = errorsOf();
    for (const expected of [
      "unknown key 'colour'",
      "id 'interaction-02' must equal the directory name 'interaction-01'",
      "'category' must be one of scene-rendering, interaction, shader-bridge, maintenance",
      "'mode' must be one of cold, edit",
      "'title' must be a non-empty string",
      "'mtek_side_status' must be one of",
      "'required_symbols' must be a non-empty array",
      "[budgets]: missing key 'max_wall_seconds'",
      "'max_repairs' must be a non-negative integer",
      "'max_output_tokens' must be a positive integer",
    ]) {
      expect(errors.some((error) => error.includes(expected)), expected).toBe(true);
    }
  });

  it("requires the id of a task to start with its category and of a holdout to be holdout-NN", () => {
    writeValidRepo();
    put("benchmarks/tasks/interaction-01/task.toml", taskToml("interaction-01").replace('category = "interaction"', 'category = "maintenance"'));
    expect(errorsOf().some((error) => error.includes("must start with its category 'maintenance'"))).toBe(true);
    writeValidRepo();
    mkdirSync(join(root, "benchmarks", "holdout", "other-01"), { recursive: true });
    put("benchmarks/holdout/other-01/task.toml", taskToml("other-01"));
    expect(errorsOf().some((error) => error.includes("a holdout id must look like holdout-NN"))).toBe(true);
  });

  it("rejects a duplicate id across tasks and holdout", () => {
    writeValidRepo();
    writeTask("benchmarks/holdout", "interaction-01");
    expect(errorsOf().some((error) => error.includes("id 'interaction-01' is already used by benchmarks/tasks/interaction-01"))).toBe(true);
  });

  it("requires the six parts of the format and their entry files", () => {
    writeValidRepo();
    rmSync(join(root, "benchmarks/tasks/interaction-01/baseline-tests"), { recursive: true });
    rmSync(join(root, "benchmarks/tasks/interaction-01/reference/mtek"), { recursive: true });
    rmSync(join(root, "benchmarks/tasks/interaction-01/baseline/src/main.ts"));
    const errors = errorsOf();
    expect(errors).toContain("benchmarks/tasks/interaction-01/baseline-tests/: missing directory");
    expect(errors).toContain("benchmarks/tasks/interaction-01/reference/mtek/: missing directory");
    expect(errors).toContain("benchmarks/tasks/interaction-01/baseline/src/main.ts: missing file");
    expect(errors).toContain("benchmarks/tasks/interaction-01/reference/mtek/src/main.mtek: missing file");
  });

  it("requires the UNVERIFIED header on Mtek reference sources while unverified", () => {
    writeValidRepo();
    put("benchmarks/tasks/interaction-01/reference/mtek/src/main.mtek", SOURCE);
    expect(errorsOf().some((error) => error.includes("reference/mtek/src/main.mtek: the first line must be an '// UNVERIFIED"))).toBe(true);
  });

  it("checks that required symbols appear in the reference and, for edit tasks, in the starter", () => {
    writeValidRepo();
    put("benchmarks/tasks/interaction-01/mtek/src/main.mtek", "scene Demo {}\n");
    put("benchmarks/tasks/interaction-01/reference/mtek/src/main.mtek", "// UNVERIFIED\nscene Other {}\n");
    const errors = errorsOf();
    expect(errors.some((error) => error.includes("interaction-01/mtek: required symbol 'Demo.Cube'"))).toBe(true);
    expect(errors.some((error) => error.includes("interaction-01/reference/mtek: required symbol 'Demo.Cube'"))).toBe(true);
  });

  it("rejects fixtures with unknown steps, bad pixels, parse errors and no assertion", () => {
    writeValidRepo();
    put("benchmarks/tasks/interaction-01/mtek-tests/bad.test.toml", `name = "x"
steps = [
  { step = 0, dt = 0.0 },
  { tap = "Space" },
  { expect_pixel = { x = 128, y = 3, color = "#fff", tolerance = 300 } },
  { press = "A", release = "A" },
]
`);
    put("benchmarks/tasks/interaction-01/mtek-tests/empty.test.toml", 'name = "x"\nsteps = [ { step = 1, dt = 0.01 } ]\n');
    put("benchmarks/tasks/interaction-01/mtek-tests/broken.test.toml", "name = \n");
    put("benchmarks/tasks/interaction-01/mtek-tests/notes.md", "x\n");
    const errors = errorsOf().join("\n");
    for (const expected of [
      "bad.test.toml step 1: step must be a positive integer",
      "bad.test.toml step 1: dt must be a positive number",
      "bad.test.toml step 2: unknown step 'tap'",
      "expect_pixel.x must be an integer in 0..127",
      'expect_pixel.color must be "#rrggbb"',
      "expect_pixel.tolerance must be an integer in 0..255",
      "bad.test.toml step 4: a step has exactly one action key",
      "empty.test.toml: the fixture asserts nothing",
      "broken.test.toml: line 1:",
      "notes.md: only *.test.toml fixtures belong here",
    ]) {
      expect(errors, expected).toContain(expected);
    }
  });

  it("fails when a holdout id appears in spec/, tools/, packages/ or benchmarks/tools/", () => {
    writeValidRepo();
    put("spec/ai.md", "see holdout-01 for an example\n");
    put("packages/x/src/a.ts", "// holdout-01\n");
    put("tools/note.txt", "holdout-01");
    put("benchmarks/tools/x.mjs", "// holdout-01\n");
    put("packages/x/node_modules/dep/index.js", "holdout-01\n"); // skipped on purpose
    const errors = errorsOf();
    expect([...errors].sort()).toEqual([
      "benchmarks/tools/x.mjs: mentions the holdout id 'holdout-01' (holdout ids must not appear in design material)",
      "packages/x/src/a.ts: mentions the holdout id 'holdout-01' (holdout ids must not appear in design material)",
      "spec/ai.md: mentions the holdout id 'holdout-01' (holdout ids must not appear in design material)",
      "tools/note.txt: mentions the holdout id 'holdout-01' (holdout ids must not appear in design material)",
    ].sort());
  });

  it("does not flag the tasks themselves or the benchmarks README for naming a holdout", () => {
    writeValidRepo();
    put("benchmarks/README.md", "holdout-01 exists\n");
    expect(errorsOf()).toEqual([]);
  });

  it("fails when the holdout tree no longer matches holdout.sha256", () => {
    writeValidRepo();
    put("benchmarks/holdout/holdout-01/mtek/src/main.mtek", `${SOURCE}// edited\n`);
    expect(errorsOf().some((error) => error.startsWith("benchmarks/holdout.sha256: recorded "))).toBe(true);
  });

  it("fails when holdout.sha256 is missing or malformed", () => {
    writeValidRepo();
    rmSync(join(root, "benchmarks", "holdout.sha256"));
    expect(errorsOf().some((error) => error.startsWith("benchmarks/holdout.sha256: missing"))).toBe(true);
    put("benchmarks/holdout.sha256", "abc\n");
    expect(errorsOf().some((error) => error.includes("expected 64 lowercase hex digits"))).toBe(true);
  });

  it("fails when there is no holdout task or the .gitattributes rule is gone", () => {
    writeValidRepo();
    put(".gitattributes", "* text=auto eol=lf\n");
    expect(errorsOf().some((error) => error.startsWith(".gitattributes: missing the line"))).toBe(true);
    rmSync(join(root, "benchmarks", "holdout"), { recursive: true });
    mkdirSync(join(root, "benchmarks", "holdout"));
    expect(errorsOf().some((error) => error.includes("no holdout task"))).toBe(true);
  });

  it("accepts optional starter_diagnostics only as MTEK-E codes", () => {
    writeValidRepo();
    writeTask("benchmarks/tasks", "maintenance-01", 'starter_diagnostics = ["MTEK-E3102", "MTEK-E5001"]');
    expect(errorsOf()).toEqual([]);
    writeTask("benchmarks/tasks", "maintenance-01", 'starter_diagnostics = ["E3102"]');
    expect(errorsOf().some((error) => error.includes("'starter_diagnostics' must be an array of codes"))).toBe(true);
  });
});
