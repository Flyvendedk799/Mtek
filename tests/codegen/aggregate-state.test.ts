// State owns aggregate storage just like a mutable local. Exercise the generated static and
// dynamic prefab initializers against the real runtime helpers, including nested borrowed data.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const project = resolve(root, "tests/codegen/.out/aggregate-state");
interface Params { seed: number[]; data: { cells: number[][] } }
interface Entity { state: Record<string, unknown>; params: Readonly<Partial<Params>> }
interface Context {
  s: Record<string, unknown>;
  e: Entity[];
  random(): number;
  setCamera(): void;
  setTransform(): void;
  setVisible(): void;
  spawn(symbol: string, params: Params): void;
}
interface Program {
  scenes: { Demo: {
    init(ctx: Context): void;
    entityUpdate: ((ctx: Context, self: Entity, dt: number) => void)[];
    events: { key_down: { fn(ctx: Context, self: null): void }[] };
  } };
  prefabs: Record<string, {
    init(ctx: Context, self: Entity, params: Params): void;
    update(ctx: Context, self: Entity, dt: number): void;
  }>;
}
let program: Program;

beforeAll(async () => {
  mkdirSync(resolve(project, "src"), { recursive: true });
  writeFileSync(resolve(project, "mtek.toml"), '[project]\nname = "aggregate-state"\nlanguage = "0.1"\n');
  writeFileSync(resolve(project, "src/main.mtek"), `
struct Record {
    cells: array<array<i32, 2>, 2>;
}
cpu fn counted(value: array<i32, 2>) -> array<i32, 2> {
    random();
    return value;
}
prefab Cell {
    param seed: array<i32, 2> = [1, 2];
    param data: Record = Record { cells: [[1, 2], [3, 4]] };
    state original: array<i32, 2> = seed;
    state sibling: array<i32, 2> = seed;
    state wrapped: array<array<i32, 2>, 2> = [seed, seed];
    state direct_struct: Record = data;
    state sibling_struct: Record = data;
    state built_struct: Record = Record { cells: [seed, seed] };
    state returned: array<i32, 2> = counted(seed);
    state parameter_after: i32 = 0;
    update(dt: f32) {
        self.original[0] = 9;
        self.wrapped[0][1] = 8;
        self.direct_struct.cells[0][0] = 7;
        self.built_struct.cells[0][0] = 6;
        self.returned[0] = 5;
        self.parameter_after = seed[0] + data.cells[0][0];
    }
}
scene Demo {
    camera Main {}
    entity FixedCell: Cell {}
    on key_down(Key.Space) {
        spawn(Cell {});
    }
}
`);
  const output = resolve(project, "dist");
  execFileSync("cargo", ["run", "--quiet", "--locked", "-p", "mtek-cli", "--", "build", "--mode", "release", "--out", output, project], { cwd: root, stdio: "pipe" });
  cpSync(resolve(project, "src"), resolve(output, "src"), { recursive: true });
  cpSync(resolve(root, "packages/runtime-web/dist/runtime.js.map"), resolve(output, "runtime.js.map"));
  program = await import(/* @vite-ignore */ pathToFileURL(resolve(output, "app.js")).href) as Program;
}, 120_000);

function run(): { staticEntity: Entity; dynamicEntity: Entity; params: Params; draws: number } {
  const staticEntity: Entity = { state: {}, params: Object.freeze({}) };
  let request: { symbol: string; params: Params } | undefined;
  let draws = 0;
  const ctx: Context = {
    s: {}, e: [staticEntity], random: () => ++draws,
    setCamera() {}, setTransform() {}, setVisible() {},
    spawn(symbol, params) { request = { symbol, params }; },
  };
  const scene = program.scenes.Demo;
  scene.init(ctx);
  scene.events.key_down[0]?.fn(ctx, null);
  if (!request) throw new Error("the handler did not spawn Cell");
  const prefab = program.prefabs[request.symbol];
  if (!prefab) throw new Error("missing generated prefab");
  // The real dynamic runtime shallow-freezes the parameter record; the compiler must own
  // state storage without relying on a deep freeze or mutating this parameter record.
  const params = Object.freeze(request.params);
  const dynamicEntity: Entity = { state: {}, params };
  prefab.init(ctx, dynamicEntity, params);
  scene.entityUpdate[0]?.(ctx, staticEntity, 0);
  prefab.update(ctx, dynamicEntity, 0);
  return { staticEntity, dynamicEntity, params, draws };
}

const expected = {
  original: [9, 2], sibling: [1, 2], wrapped: [[1, 8], [1, 2]],
  direct_struct: { cells: [[7, 2], [3, 4]] },
  sibling_struct: { cells: [[1, 2], [3, 4]] },
  built_struct: { cells: [[6, 2], [1, 2]] }, returned: [5, 2], parameter_after: 2,
};

describe("aggregate state initializer ownership", () => {
  it("keeps array and struct params and sibling state independent after nested mutations", () => {
    const { dynamicEntity, params } = run();
    expect(dynamicEntity.state).toEqual(expected);
    expect(params).toEqual({ seed: [1, 2], data: { cells: [[1, 2], [3, 4]] } });
  });

  it("matches the static prefab instance and evaluates a CPU initializer once per instance", () => {
    const { staticEntity, dynamicEntity, draws } = run();
    expect(staticEntity.state).toEqual(expected);
    expect(dynamicEntity.state).toEqual(staticEntity.state);
    expect(draws).toBe(2);
  });
});
