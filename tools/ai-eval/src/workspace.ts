// The scratch copy of a task's project that candidates are applied to (spec 4.1: "applies the model's
// edit to a scratch copy of the project"). The task's own files are never touched.
//
// Layout of one workspace:
//   <scratchRoot>/<name>/project/   the candidate: the starter, plus tests/ with the task's fixtures
//
// The fixtures are copied in as `tests/*.test.toml` (decision 0021 item 3, the way `mtek test` finds
// them). They are not writable by the Editor and are never shown to the model.
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { sha256Hex } from "./canonical.ts";
import { isBaselineSource, isProjectSource } from "./editor.ts";
import type { TaskSpec } from "./task.ts";

/** Which side of the comparison a workspace holds: a Mtek project, or the TypeScript + three.js baseline project of the same task. */
export type WorkspaceKind = "mtek" | "baseline";

const SKIPPED_DIRECTORIES = new Set(["dist", "node_modules", "tests", ".git"]);

/** The `/`-separated paths of the regular files below `directory`, sorted by UTF-8 bytes; symbolic links are skipped. */
export function listFiles(directory: string, skip: ReadonlySet<string> = new Set()): string[] {
  const files: string[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!(prefix === "" && skip.has(entry.name))) walk(join(current, entry.name), path);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  };
  walk(directory, "");
  return files.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

export class Workspace {
  readonly root: string;
  readonly projectDir: string;
  readonly kind: WorkspaceKind;

  private constructor(root: string, kind: WorkspaceKind) {
    this.root = root;
    this.projectDir = join(root, "project");
    this.kind = kind;
  }

  /**
   * Copies a project and the task's fixtures into `<scratchRoot>/<name>/project`. The project is the
   * task's starter unless `from` names another (a reference solution, to validate it).
   */
  static create(task: TaskSpec, scratchRoot: string, name: string, options: { from?: string; kind?: WorkspaceKind } = {}): Workspace {
    const kind = options.kind ?? "mtek";
    const workspace = new Workspace(join(scratchRoot, name), kind);
    if (existsSync(workspace.root)) throw new Error(`${workspace.root}: already exists`);
    const source = options.from ?? (kind === "mtek" ? task.projectDir : task.baselineDir);
    if (!existsSync(source)) throw new Error(`${source}: the task has no ${kind} project`);
    mkdirSync(workspace.projectDir, { recursive: true });
    cpSync(source, workspace.projectDir, {
      recursive: true,
      filter: (entry) => {
        if (lstatSync(entry).isSymbolicLink()) return false;
        return !SKIPPED_DIRECTORIES.has(entry.slice(source.length + 1).split(/[\\/]/)[0] ?? "");
      },
    });
    const fixtures = readdirSync(task.testsDir).filter((name) => name.endsWith(".test.toml"));
    if (fixtures.length === 0) throw new Error(`${task.testsDir}: no *.test.toml fixture (a task without tests cannot succeed)`);
    if (kind === "mtek") {
      mkdirSync(join(workspace.projectDir, "tests"));
      for (const fixture of fixtures) cpSync(join(task.testsDir, fixture), join(workspace.projectDir, "tests", fixture));
    } else {
      // The baseline's fixtures are the task's own and are read from there by the runner; the candidate never holds them.
      // Its tsconfig extends the shared base by a path that is valid from the scratch location.
      const base = join(task.dir, "..", "..", "baselines", "support", "tsconfig.base.json");
      const extendsPath = relative(workspace.projectDir, base).replaceAll("\\", "/");
      const config = JSON.stringify({ extends: extendsPath, include: ["src"] }, null, 2);
      writeFileSync(join(workspace.projectDir, "tsconfig.json"), `${config}\n`, "utf8");
    }
    return workspace;
  }

  /** The content of a project file, or undefined when there is none. */
  read(path: string): string | undefined {
    const file = join(this.projectDir, ...path.split("/"));
    return existsSync(file) ? readFileSync(file, "utf8") : undefined;
  }

  /** Writes a project file, creating its directories. Callers have checked the path with the Editor's policy. */
  write(path: string, content: string): void {
    const file = join(this.projectDir, ...path.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, "utf8");
  }

  /** The files a model may change (`mtek.toml` and the `.mtek` sources; for a baseline the `.ts` files under `src/`), sorted. */
  sourceFiles(): string[] {
    return listFiles(this.projectDir, SKIPPED_DIRECTORIES).filter(this.kind === "mtek" ? isProjectSource : isBaselineSource);
  }

  /** A hash of those files and their paths: equal hashes mean the same candidate. */
  sourcesHash(): string {
    const lines = this.sourceFiles().map((path) => `${sha256Hex(this.read(path) ?? "")}  ${path}\n`);
    return sha256Hex(lines.join(""));
  }

  /** Copies the candidate (without the fixtures, which belong to the task) to `destination`, for preservation. */
  preserveTo(destination: string): void {
    mkdirSync(destination, { recursive: true });
    for (const path of listFiles(this.projectDir, SKIPPED_DIRECTORIES)) {
      const target = join(destination, ...path.split("/"));
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(this.projectDir, ...path.split("/")), target);
    }
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}
