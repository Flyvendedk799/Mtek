// Execute every build mode through the real CLI and runtime bundle: a helper must not bring
// development-only print calls back into release/preview, and preview still budgets its loops.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const project = resolve(root, "tests/codegen/.out/cpu-modes");
const modes = ["dev", "test", "release", "preview"] as const;
type Mode = typeof modes[number];
interface Context {
  s: { after: number };
  budget: { n: number };
  random(): number;
  print(message: string): void;
}
interface Program {
  scenes: { Demo: { update(ctx: Context, dt: number): void } };
}
const programs = new Map<Mode, Program>();

beforeAll(async () => {
  mkdirSync(resolve(project, "src"), { recursive: true });
  writeFileSync(resolve(project, "mtek.toml"), '[project]\nname = "cpu-modes"\nlanguage = "0.1"\n');
  writeFileSync(resolve(project, "src/main.mtek"), `
cpu fn message() -> string {
    random();
    return "message";
}
cpu fn leaf() {
    for i in 0..2 {
        print(message());
    }
}
cpu fn wrapper() {
    leaf();
    print("wrapper");
}
scene Demo {
    camera Main {}
    state after: f32 = 0.0;
    update(dt: f32) {
        print(message());
        wrapper();
        after = random();
    }
}
`);
  for (const mode of modes) {
    const output = resolve(project, mode);
    execFileSync("cargo", ["run", "--quiet", "--locked", "-p", "mtek-cli", "--", "build", "--mode", mode, "--out", output, project], { cwd: root, stdio: "pipe" });
    cpSync(resolve(project, "src"), resolve(output, "src"), { recursive: true });
    const runtimeName = mode === "dev" || mode === "test" ? "runtime.dev.js.map" : "runtime.js.map";
    cpSync(resolve(root, "packages/runtime-web/dist", runtimeName), resolve(output, runtimeName));
    const program = await import(/* @vite-ignore */ pathToFileURL(resolve(output, "app.js")).href) as Program;
    programs.set(mode, program);
  }
}, 120_000);

function setup(mode: Mode, budget = 10): { program: Program; ctx: Context; logs: string[]; draws: () => number } {
  const program = programs.get(mode);
  if (!program) throw new Error(`missing ${mode} program`);
  const logs: string[] = [];
  let draws = 0;
  const ctx: Context = {
    s: { after: 0 },
    budget: { n: budget },
    random: () => ++draws,
    print: message => logs.push(message),
  };
  return { program, ctx, logs, draws: () => draws };
}

describe("CPU print calls in every build mode", () => {
  for (const mode of modes) {
    it(`${mode} treats direct and nested helper print calls alike`, () => {
      const { program, ctx, logs, draws } = setup(mode);
      program.scenes.Demo.update(ctx, 0);
      const development = mode === "dev" || mode === "test";
      expect(logs).toEqual(development ? ["message", "message", "message", "wrapper"] : []);
      // Release compiles out the whole print statement, including argument evaluation,
      // just as it already does for a print written directly in a lifecycle function.
      expect(draws()).toBe(development ? 4 : 1);
      expect(ctx.s.after).toBe(development ? 4 : 1);
      expect(ctx.budget.n).toBe(mode === "preview" ? 8 : 10);
    });
  }

  it("preview still enforces the budget inside a nested helper after print is removed", () => {
    const { program, ctx, logs, draws } = setup("preview", 1);
    expect(() => program.scenes.Demo.update(ctx, 0)).toThrow("execution budget exceeded");
    expect(ctx.budget.n).toBe(-1);
    expect(logs).toEqual([]);
    expect(draws()).toBe(0);
    expect(ctx.s.after).toBe(0);
  });
});
