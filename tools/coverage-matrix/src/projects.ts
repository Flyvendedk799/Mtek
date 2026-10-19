// The programs the matrix is derived from: the examples and the positive fixtures, each compiled by the
// real `mtek` and read as facts (`facts.ts`).
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { irFacts, manifestFacts, type FactSet } from "./facts.ts";
import { parseJson, isObject, arr, str } from "./json.ts";
import { mapLimit, concurrency, run, type Runner } from "./tools.ts";

export type ProjectKind = "demonstration" | "example" | "fixture";

export interface Project {
  /** Repository-relative path with `/`, the name the matrix shows. */
  id: string;
  kind: ProjectKind;
  dir: string;
}

/**
 * The three release demonstrations (decision 0002): each is a program of its own, and the matrix
 * asserts that each exercises something the other two do not. `examples/pulse-cube` is the program
 * of M0 to M3 and is not one (decision 0002); it is listed as an example and, like a fixture, may
 * name a feature as covered.
 */
export const DEMONSTRATIONS: readonly string[] = ["examples/material-configurator", "examples/physics-playground", "examples/modular-scene"];
export const OTHER_EXAMPLES: readonly string[] = ["examples/pulse-cube", "examples/product-configurator"];

/** Directories that hold positive fixtures: projects (a directory with `mtek.toml`) that must check. */
export const FIXTURE_ROOTS: readonly string[] = [
  "tests/semantics/pass",
  "tests/codegen",
  "tests/assets/pass",
  "tests/assets/inspect",
  "tests/modules",
  "tests/browser/fixtures",
];

const SKIPPED = new Set(["node_modules", ".out", "expected", "dist", "target"]);

function findProjects(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  if (existsSync(join(dir, "mtek.toml"))) out.push(dir);
  for (const name of readdirSync(dir).sort()) {
    if (SKIPPED.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) findProjects(path, out);
  }
}

function posix(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

/** The examples, then the fixture projects below the fixture roots, each once, in a fixed order. */
export function discover(root: string): Project[] {
  const projects: Project[] = [];
  const seen = new Set<string>();
  const push = (dir: string, kind: ProjectKind): void => {
    const id = posix(root, dir);
    if (seen.has(id)) return;
    seen.add(id);
    projects.push({ id, kind, dir });
  };
  for (const id of DEMONSTRATIONS) push(resolve(root, id), "demonstration");
  for (const id of OTHER_EXAMPLES) push(resolve(root, id), "example");
  for (const fixtureRoot of FIXTURE_ROOTS) {
    const dirs: string[] = [];
    findProjects(resolve(root, fixtureRoot), dirs);
    for (const dir of dirs) push(dir, "fixture");
  }
  return projects;
}

export interface Analysed extends Project {
  /** Whether the program checks without errors: only such a program is a positive fixture. */
  ok: boolean;
  /** Why it is not (the first error line), or why its manifest is missing. */
  note: string | null;
  ir: FactSet;
  manifest: FactSet;
  uses: FactSet;
}

export interface Tools {
  mtek: string;
  uses: string;
  run?: Runner;
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  return line.trim().slice(0, 200);
}

/** Compile every project and read its facts. Never throws for a project that does not compile. */
export async function analyse(root: string, projects: readonly Project[], tools: Tools): Promise<Analysed[]> {
  const runner = tools.run ?? run;
  const scratch = mkdtempSync(join(tmpdir(), "mtek-coverage-"));
  try {
    const analysed = await mapLimit(projects, concurrency(), async (project, index): Promise<Analysed> => {
      const base: Analysed = { ...project, ok: false, note: null, ir: new Set(), manifest: new Set(), uses: new Set() };
      const inspected = await runner(tools.mtek, ["inspect", "--ir", "--format", "json", project.dir], { cwd: root });
      if (inspected.code !== 0) {
        base.note = firstLine(inspected.stderr || inspected.stdout) || `mtek inspect exited with ${String(inspected.code)}`;
        return base;
      }
      base.ok = true;
      base.ir = irFacts(parseJson(inspected.stdout, `the IR of ${project.id}`));
      const out = join(scratch, String(index));
      const built = await runner(tools.mtek, ["build", "--out", out, project.dir], { cwd: root });
      const manifestPath = join(out, "program.manifest.json");
      if (built.code === 0 && existsSync(manifestPath)) {
        base.manifest = manifestFacts(parseJson(readFileSync(manifestPath, "utf8"), `the manifest of ${project.id}`));
      } else {
        base.note = `no manifest: ${firstLine(built.stderr || built.stdout)}`;
      }
      return base;
    });
    const usable = analysed.filter((project) => project.ok);
    const uses = await runner(tools.uses, [], { cwd: root, input: usable.map((project) => project.dir).join("\n") + "\n" });
    const answers = parseJson(uses.stdout, "the output of coverage-uses");
    if (!isObject(answers)) throw new Error("coverage-uses printed no object");
    for (const project of usable) {
      const answer = answers[project.dir];
      if (!isObject(answer)) throw new Error(`coverage-uses has no answer for ${project.id}`);
      const error = str(answer, "error");
      if (error !== undefined) {
        project.ok = false;
        project.note = `coverage-uses: ${error}`;
        continue;
      }
      for (const feature of arr(answer, "features")) if (typeof feature === "string") project.uses.add(feature);
    }
    return analysed;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Every fact of a project, from all three sources. */
export function allFacts(project: Analysed): FactSet {
  return new Set([...project.ir, ...project.manifest, ...project.uses]);
}
