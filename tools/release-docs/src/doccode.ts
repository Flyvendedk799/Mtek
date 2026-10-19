// Every Mtek code block of the documentation is compiled by a test (decision 0117).
//
// A fenced block names what it is in its info string, `LANG KEY=VALUE FLAG ...`:
//
//   ```mtek                       a whole program: `mtek check` reports no error and no warning, and `mtek fmt --check`
//                                 finds it canonical. A program without a `scene` is compiled with an empty scene added.
//   ```mtek wrong=MTEK-E5070      a program that is intentionally wrong: the errors are exactly the codes listed
//                                 (comma separated); a warning is listed with `warn=MTEK-W5101` instead.
//   ```mtek wrap=scene            a fragment: the lines are put inside a scene that has a camera. `wrap=entity` puts them
//                                 inside an entity of such a scene, `wrap=update` inside `update(dt: f32) { ... }` of the
//                                 scene (the statements may use `dt`). Fragments are not held to the formatter.
//   ```mtek from=PATH             a part of a file of the repository (the examples): the text must occur in that file,
//                                 which the compiler's own suites compile. Written by `{{example}}` and `{{excerpt}}`.
//   ```mtek project=ID file=PATH  a file of a project built up through the page. The project is compiled after every
//                                 block that writes `src/main.mtek`. `diff project=ID [file=PATH]` edits the file the
//                                 way the getting-started walkthrough does: the ` ` and `-` lines must occur exactly once.
//   ```toml manifest              an `mtek.toml`: `mtek check` accepts it, with a scene `Demo` that has the states `tint: color`,
//                                 `speed: f32` and `levels: array<f32, 2>`; `wrong=MTEK-E9001` says it must not.
//   ```toml from=PATH             a part of a file of the repository.
//
// Any other language (`text`, `console`, `sh`, `json`) is not checked, but every fence needs one.
// The models and textures of `tests/assets/pass/assets_supported` are present in every project as `models/` and `textures/`.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { run, type Runner } from "../../coverage-matrix/src/tools.ts";
import { mismatch, type Mismatch } from "./model.ts";

export const ASSET_FIXTURE_DIR = "tests/assets/pass/assets_supported";
const HIDDEN_CAMERA = "camera Main {\n        position: vec3(0.0, 2.0, 5.0);\n        target: vec3(0.0, 0.0, 0.0);\n    }";

export interface Fence {
  /** The page, repository-relative. */
  page: string;
  /** 1-based line of the opening fence. */
  line: number;
  lang: string;
  attrs: Map<string, string>;
  flags: Set<string>;
  body: string;
}

/** Split an info string into the language, `key=value` pairs and bare flags. */
export function parseInfo(info: string): { lang: string; attrs: Map<string, string>; flags: Set<string> } {
  const tokens = info.trim().split(/\s+/).filter((t) => t !== "");
  const lang = tokens.shift() ?? "";
  const attrs = new Map<string, string>();
  const flags = new Set<string>();
  for (const token of tokens) {
    const eq = token.indexOf("=");
    if (eq > 0) attrs.set(token.slice(0, eq), token.slice(eq + 1));
    else flags.add(token);
  }
  return { lang, attrs, flags };
}

/** The fenced blocks of a page. A fence of four or more backticks may contain fences of three. */
export function extractFences(page: string, text: string): Fence[] {
  const fences: Fence[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const open = /^(`{3,})(.*)$/.exec(lines[i] ?? "");
    if (open === null) continue;
    const ticks = open[1] ?? "```";
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && !new RegExp(`^${ticks}\\s*$`).test(lines[j] ?? "")) {
      body.push(lines[j] ?? "");
      j++;
    }
    fences.push({ page, line: i + 1, ...parseInfo(open[2] ?? ""), body: body.join("\n") });
    i = j;
  }
  return fences;
}

/** The text of a page outside its fenced blocks. */
export function proseOf(text: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const open = /^(`{3,})/.exec(line);
    if (fence === null && open !== null) {
      fence = open[1] ?? "```";
      continue;
    }
    if (fence !== null) {
      if (new RegExp(`^${fence}\\s*$`).test(line)) fence = null;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

function codesOf(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c !== "");
}

/** Normalise a diagnostic code to the `MTEK-E1234` form. */
export function fullCode(code: string): string {
  return /^MTEK-/.test(code) ? code : `MTEK-${code}`;
}

export function hasScene(source: string): boolean {
  return /^\s*(?:export\s+)?scene\s+[A-Za-z_]\w*/m.test(source);
}

export function sceneName(source: string): string | null {
  return /^\s*(?:export\s+)?scene\s+([A-Za-z_]\w*)/m.exec(source)?.[1] ?? null;
}

function indent(text: string, by: string): string {
  return text
    .split("\n")
    .map((l) => (l === "" ? l : by + l))
    .join("\n");
}

/** The source a fragment is compiled as: its lines inside a scene (or an entity of a scene) that has a camera. */
export function wrapFragment(kind: string, body: string): string {
  const inner = body.replace(/\n+$/, "");
  switch (kind) {
    case "scene":
      return `scene Demo {\n    ${HIDDEN_CAMERA}\n${indent(inner, "    ")}\n}\n`;
    case "entity":
      return `scene Demo {\n    ${HIDDEN_CAMERA}\n    entity Thing {\n${indent(inner, "        ")}\n    }\n}\n`;
    case "update":
      return `scene Demo {
    ${HIDDEN_CAMERA}
    update(dt: f32) {
${indent(inner, "        ")}
    }
}
`;
    default:
      throw new Error(`unknown wrap=${kind} (scene | entity | update)`);
  }
}

/** The source of a standalone block as it is compiled: wrapped, or with an empty scene added when it declares none. */
export function sourceOf(fence: Fence): string {
  const wrap = fence.attrs.get("wrap");
  if (wrap !== undefined) return wrapFragment(wrap, fence.body);
  const body = fence.body.replace(/\n+$/, "") + "\n";
  return hasScene(body) ? body : `${body}\nscene Docs {\n    ${HIDDEN_CAMERA}\n}\n`;
}

/** Apply a `diff` block to a file: the context and removed lines must occur exactly once together. Null when they do not. */
export function applyDiff(file: string, diff: string): string | null {
  const lines = diff.replace(/\n+$/, "").split("\n");
  const before: string[] = [];
  const after: string[] = [];
  for (const line of lines) {
    const mark = line.slice(0, 1);
    const rest = line.slice(1);
    if (mark === "-") before.push(rest);
    else if (mark === "+") after.push(rest);
    else if (mark === " ") {
      before.push(rest);
      after.push(rest);
    } else return null;
  }
  const from = before.join("\n");
  const first = file.indexOf(from);
  if (first < 0 || file.indexOf(from, first + 1) >= 0) return null;
  return file.slice(0, first) + after.join("\n") + file.slice(first + from.length);
}

interface Outcome {
  exitCode: number | null;
  /** `code` and severity of every diagnostic. */
  diagnostics: { code: string; severity: string; message: string }[];
  raw: string;
}

function toml(language: string, scene: string | null): string {
  const lines = ["[project]", 'name = "docs-check"', `language = "${language}"`, 'entry = "src/main.mtek"'];
  if (scene !== null) lines.push(`scene = "${scene}"`);
  return lines.join("\n") + "\n";
}

async function check(runner: Runner, mtek: string, dir: string): Promise<Outcome> {
  const result = await runner(mtek, ["check", "--format", "json"], { cwd: dir });
  let diagnostics: Outcome["diagnostics"] = [];
  try {
    const report = JSON.parse(result.stdout) as { diagnostics?: { code: string; severity: string; message: string }[] };
    diagnostics = (report.diagnostics ?? []).map((d) => ({ code: d.code, severity: d.severity, message: d.message }));
  } catch {
    // not a report: the raw output goes into the message
  }
  return { exitCode: result.code, diagnostics, raw: (result.stdout + result.stderr).trim() };
}

function describe(outcome: Outcome): string {
  if (outcome.diagnostics.length === 0) return outcome.raw === "" ? `exit ${String(outcome.exitCode)} and no diagnostic` : outcome.raw.slice(0, 300);
  return outcome.diagnostics
    .slice(0, 6)
    .map((d) => `${d.code} (${d.message.slice(0, 90)})`)
    .join("; ");
}

export interface CodeRun {
  root: string;
  mtek: string;
  language: string;
  runner?: Runner;
}

function where(fence: Fence): string {
  return `${fence.page} line ${String(fence.line)}`;
}

/** The findings for a block checked in `dir` (whose `mtek.toml` and `src/main.mtek` are written). */
async function judge(run_: CodeRun, fence: Fence, dir: string, fmtTarget: string | null): Promise<Mismatch[]> {
  const runner = run_.runner ?? run;
  const found: Mismatch[] = [];
  const outcome = await check(runner, run_.mtek, dir);
  const wrong = codesOf(fence.attrs.get("wrong")).map(fullCode);
  const warn = codesOf(fence.attrs.get("warn")).map(fullCode);
  const errors = outcome.diagnostics.filter((d) => d.severity === "error").map((d) => d.code);
  const warnings = outcome.diagnostics.filter((d) => d.severity === "warning").map((d) => d.code);
  if (wrong.length === 0) {
    if (errors.length > 0 || outcome.exitCode !== 0) {
      found.push(mismatch("docs/code", { where: where(fence), value: "a program that compiles" }, { where: "mtek check", value: describe(outcome) }));
    }
    const extra = [...new Set(warnings)].filter((w) => !warn.includes(w));
    if (extra.length > 0 && errors.length === 0) {
      found.push(mismatch("docs/code", { where: where(fence), value: "no warning" }, { where: "mtek check", value: `warnings ${extra.join(", ")}` }, "list an intended warning as warn=CODE"));
    }
    for (const w of warn) {
      if (!warnings.includes(w)) found.push(mismatch("docs/code", { where: where(fence), value: `warning ${w}` }, { where: "mtek check", value: describe(outcome) }));
    }
    if (fmtTarget !== null && errors.length === 0) {
      const fmt = await runner(run_.mtek, ["fmt", "--check", fmtTarget], { cwd: dir });
      if (fmt.code !== 0) {
        await runner(run_.mtek, ["fmt", fmtTarget], { cwd: dir });
        const canonical = readFileSync(join(dir, "src", "main.mtek"), "utf8");
        found.push(
          mismatch(
            "docs/code",
            { where: where(fence), value: "canonical layout (mtek fmt)" },
            { where: "mtek fmt --check", value: (fmt.stdout + fmt.stderr).trim().slice(0, 200) },
            `the formatter writes:
${canonical.slice(0, 2500)}`,
          ),
        );
      }
    }
  } else {
    const missing = wrong.filter((c) => ![...errors, ...warnings].includes(c));
    const unexpected = [...new Set(errors)].filter((c) => !wrong.includes(c));
    if (missing.length > 0 || unexpected.length > 0) {
      found.push(
        mismatch(
          "docs/code",
          { where: where(fence), value: `errors exactly ${wrong.join(", ")}` },
          { where: "mtek check", value: describe(outcome) },
          missing.length > 0 ? `missing ${missing.join(", ")}` : `unexpected ${unexpected.join(", ")}`,
        ),
      );
    }
  }
  return found;
}

function newProject(run_: CodeRun, scene: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), "mtek-docs-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "mtek.toml"), toml(run_.language, scene));
  for (const sub of ["models", "textures"]) {
    const from = join(run_.root, ASSET_FIXTURE_DIR, sub);
    if (existsSync(from)) cpSync(from, join(dir, sub), { recursive: true });
  }
  return dir;
}

/** Check one standalone block. */
async function checkStandalone(run_: CodeRun, fence: Fence): Promise<Mismatch[]> {
  const source = sourceOf(fence);
  const dir = newProject(run_, sceneName(source));
  try {
    writeFileSync(join(dir, "src", "main.mtek"), source);
    const wrapped = fence.attrs.has("wrap");
    const fmtTarget = wrapped || fence.flags.has("nofmt") ? null : "src/main.mtek";
    return await judge(run_, fence, dir, fmtTarget);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Check a `toml manifest` block. */
async function checkManifest(run_: CodeRun, fence: Fence): Promise<Mismatch[]> {
  const dir = newProject(run_, "Demo");
  try {
    writeFileSync(join(dir, "mtek.toml"), fence.body.replace(/\n+$/, "") + "\n");
    writeFileSync(
      join(dir, "src", "main.mtek"),
      `scene Demo {\n    state tint: color = #6b5cff;\n    state speed: f32 = 1.0;\n    state levels: array<f32, 2> = [0.0, 0.0];\n    ${HIDDEN_CAMERA}\n}\n`,
    );
    return await judge(run_, fence, dir, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The blocks that belong to one project of a page, in page order, checked one after the other. */
async function checkProject(run_: CodeRun, fences: readonly Fence[]): Promise<Mismatch[]> {
  const found: Mismatch[] = [];
  const dir = newProject(run_, null);
  try {
    for (const fence of fences) {
      const file = fence.attrs.get("file") ?? "src/main.mtek";
      const full = join(dir, file);
      if (fence.lang === "diff") {
        const current = existsSync(full) ? readFileSync(full, "utf8") : "";
        const next = applyDiff(current, fence.body);
        if (next === null) {
          found.push(mismatch("docs/code", { where: where(fence), value: `a diff that applies to ${file}` }, { where: file, value: "the context and removed lines do not occur exactly once" }));
          return found;
        }
        writeFileSync(full, next);
      } else {
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, fence.body.replace(/\n+$/, "") + "\n");
      }
      if (file === "src/main.mtek") {
        found.push(...(await judge(run_, fence, dir, fence.flags.has("nofmt") ? null : "src")));
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return found;
}

/** Check that the text of a `from=` block occurs in the repository file it names. */
export function checkFrom(root: string, fence: Fence): Mismatch[] {
  const path = fence.attrs.get("from") ?? "";
  const full = join(root, path);
  if (!existsSync(full)) return [mismatch("docs/code", { where: where(fence), value: `a block of ${path}` }, { where: path, value: "no such file" })];
  const text = readFileSync(full, "utf8").replace(/\r\n/g, "\n");
  return text.includes(fence.body.replace(/\n+$/, ""))
    ? []
    : [mismatch("docs/code", { where: where(fence), value: `text of ${path}` }, { where: path, value: "does not contain the block" })];
}

/** What a fence has to be, without compiling anything: one finding per block that is not one of the documented forms. */
export function checkForm(fence: Fence): Mismatch[] {
  const bad = (value: string): Mismatch[] => [mismatch("docs/code-form", { where: where(fence), value }, { where: "decision 0117", value: "every fence is one of the documented forms" })];
  if (fence.lang === "") return bad("a fence without a language");
  const unknownFlag = [...fence.flags].filter((f) => f !== "nofmt" && f !== "manifest");
  if (unknownFlag.length > 0) return bad(`unknown flag ${unknownFlag.join(", ")}`);
  if (fence.lang === "mtek") {
    const known = ["from", "wrong", "warn", "wrap", "project", "file"];
    const unknown = [...fence.attrs.keys()].filter((k) => !known.includes(k));
    if (unknown.length > 0) return bad(`unknown attribute ${unknown.join(", ")}`);
    if (fence.attrs.has("wrap") && fence.attrs.has("project")) return bad("wrap together with project");
    if (fence.attrs.has("file") && !fence.attrs.has("project")) return bad("file without project");
    if (fence.attrs.has("project") && !fence.attrs.has("file") && fence.lang === "mtek") return bad("a project block without file=");
  }
  if (fence.lang === "diff" && !fence.attrs.has("project")) return bad("a diff without project=");
  if (fence.lang === "toml" && !fence.attrs.has("from") && !fence.flags.has("manifest") && !fence.attrs.has("project")) return bad("a toml block that is neither from=, manifest nor part of a project");
  return [];
}

/**
 * Compile the blocks of the pages. `pages` are repository paths and their text. Returns one finding per block that is
 * not what it claims. Blocks run a few at a time; the blocks of one project run in page order.
 */
export async function checkDocCode(run_: CodeRun, pages: readonly { path: string; text: string }[], concurrency = 6): Promise<Mismatch[]> {
  const found: Mismatch[] = [];
  const jobs: (() => Promise<Mismatch[]>)[] = [];
  for (const page of pages) {
    const projects = new Map<string, Fence[]>();
    for (const fence of extractFences(page.path, page.text)) {
      const form = checkForm(fence);
      found.push(...form);
      if (form.length > 0) continue;
      if (fence.attrs.has("from")) {
        found.push(...checkFrom(run_.root, fence));
        continue;
      }
      const project = fence.attrs.get("project");
      if (project !== undefined) {
        const list = projects.get(project) ?? [];
        list.push(fence);
        projects.set(project, list);
      } else if (fence.lang === "mtek") {
        jobs.push(() => checkStandalone(run_, fence));
      } else if (fence.lang === "toml" && fence.flags.has("manifest")) {
        jobs.push(() => checkManifest(run_, fence));
      }
    }
    for (const fences of projects.values()) jobs.push(() => checkProject(run_, fences));
  }
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const at = next++;
      const job = jobs[at];
      if (job === undefined) return;
      found.push(...(await job()));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()));
  return found;
}
