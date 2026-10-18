// Reads a benchmark task (`benchmarks/tasks/<id>/`, decision 0021). The strict validation of the task
// tree is `benchmarks/tools/validate-tasks.mjs` (`npm run check:tasks`); this reads only what the
// harness needs and refuses anything it cannot use.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseToml } from "@mtek/benchmarks/toml-subset";

export interface TaskBudgets {
  /** Repair rounds after the first generation. */
  maxRepairs: number;
  /** The cap of one reply, in tokens. */
  maxOutputTokens: number;
  maxWallSeconds: number;
}

export interface TaskSpec {
  id: string;
  category: string;
  mode: "cold" | "edit";
  title: string;
  prompt: string;
  /** Names exactly as `mtek context` reports them (`Demo.Cube`, `Demo.Cube.Marker`, `Flat`). */
  requiredSymbols: string[];
  budgets: TaskBudgets;
  /** Absolute path of the task directory. */
  dir: string;
  /** `<dir>/mtek`: the starter project. */
  projectDir: string;
  /** `<dir>/mtek-tests`: the fixtures that define success. The model never sees them. */
  testsDir: string;
}

function str(table: Record<string, unknown>, key: string, where: string): string {
  const value = table[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${where}: '${key}' must be a non-empty string`);
  return value;
}

function int(table: Record<string, unknown>, key: string, where: string): number {
  const value = table[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(`${where}: '${key}' must be a non-negative integer`);
  return value;
}

export function loadTask(taskDir: string): TaskSpec {
  const dir = resolve(taskDir);
  const file = join(dir, "task.toml");
  if (!existsSync(file)) throw new Error(`${file}: not found`);
  const toml = parseToml(readFileSync(file, "utf8")) as Record<string, unknown>;
  const where = `${file}`;
  const mode = str(toml, "mode", where);
  if (mode !== "cold" && mode !== "edit") throw new Error(`${where}: 'mode' must be cold or edit`);
  const symbols = toml["required_symbols"];
  if (!Array.isArray(symbols) || symbols.length === 0 || symbols.some((s) => typeof s !== "string")) {
    throw new Error(`${where}: 'required_symbols' must be a non-empty array of strings`);
  }
  const budgets = toml["budgets"];
  if (typeof budgets !== "object" || budgets === null || Array.isArray(budgets)) throw new Error(`${where}: [budgets] is missing`);
  const budgetTable = budgets as Record<string, unknown>;
  const maxWallSeconds = int(budgetTable, "max_wall_seconds", `${where} [budgets]`);
  const maxOutputTokens = int(budgetTable, "max_output_tokens", `${where} [budgets]`);
  if (maxWallSeconds === 0 || maxOutputTokens === 0) throw new Error(`${where} [budgets]: max_wall_seconds and max_output_tokens must be positive`);
  const projectDir = join(dir, "mtek");
  const testsDir = join(dir, "mtek-tests");
  for (const required of [projectDir, testsDir]) {
    if (!existsSync(required) || !statSync(required).isDirectory()) throw new Error(`${required}: not a directory`);
  }
  return {
    id: str(toml, "id", where),
    category: str(toml, "category", where),
    mode,
    title: str(toml, "title", where),
    prompt: str(toml, "prompt", where),
    requiredSymbols: symbols as string[],
    budgets: { maxRepairs: int(budgetTable, "max_repairs", `${where} [budgets]`), maxOutputTokens, maxWallSeconds },
    dir,
    projectDir,
    testsDir,
  };
}
