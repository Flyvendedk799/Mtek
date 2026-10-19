// The diagnostic codes and their negative tests (`spec/testing.md` section 3.2, decisions 0027 item 11
// and 0093).
//
// * The catalogue is `spec/diagnostics.md` section 5, which a Rust test keeps equal to
//   `crates/mtek-compiler/src/diagnostics/codes.rs`.
// * A code has a *fixture* when the expected diagnostics of some fixture contain it: the files the
//   compiler's fixture suites compare exactly (`tests/syntax/{lex,fail}/*.diag.json`, the diagnostic
//   lines of `tests/syntax/ast/*.ast`, `tests/semantics/{pass,fail,gpu}/**/expected.diag.json`,
//   `tests/assets/fail/*/expected.diag.json`). A warning cannot fail a program, so a warning's fixture is
//   a passing program whose expected diagnostics list it.
// * A code without a fixture is allowed only when `tests/semantics/code-coverage-exceptions.json` lists
//   it with its reason. A `reserved` code must be marked as such in the catalogue itself; a named test
//   file must exist and contain the code.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { isObject, parseJson, str } from "./json.ts";

export interface CatalogueEntry {
  /** `E3001`. */
  code: string;
  title: string;
  trigger: string;
  /** The marker the catalogue puts on the row, if any. */
  mark: "reserved" | "not-implemented" | null;
}

export interface DiagnosticFixture {
  /** The file with the expected diagnostics, repository-relative. */
  file: string;
  /** The fixture's name: the directory, or the source file. */
  fixture: string;
  suite: "syntax-lex" | "syntax-fail" | "syntax-ast" | "semantics-pass" | "semantics-fail" | "semantics-gpu" | "assets-fail";
  messages: string[];
}

export type Exceptional = "reserved" | "unreachable" | "covered-elsewhere";

export interface ExceptionEntry {
  code: string;
  reason: string;
  test: string | null;
}

export interface Exceptions {
  notYetImplemented: ExceptionEntry[];
  reserved: ExceptionEntry[];
  unreachable: ExceptionEntry[];
  coveredElsewhere: ExceptionEntry[];
}

function posix(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

const ROW = /^\| <a id="mtek-([a-z0-9]+)"><\/a>([EW]\d{4}) \| (.*)$/;

/** The catalogue of `spec/diagnostics.md`, in the order of the file. */
export function readCatalogue(root: string): CatalogueEntry[] {
  const text = readFileSync(join(root, "spec", "diagnostics.md"), "utf8").replace(/\r\n/g, "\n");
  const entries: CatalogueEntry[] = [];
  for (const line of text.split("\n")) {
    const match = ROW.exec(line);
    if (match === null) continue;
    const rest = (match[3] ?? "").replace(/\s*\|\s*$/, "");
    const split = rest.indexOf(" | ");
    const title = split < 0 ? rest : rest.slice(0, split);
    const trigger = split < 0 ? "" : rest.slice(split + 3);
    const mark = trigger.includes("**Reserved:**") ? "reserved" : trigger.includes("**Not implemented:**") ? "not-implemented" : null;
    entries.push({ code: match[2] ?? "", title: title.trim(), trigger: trigger.trim(), mark });
  }
  return entries;
}

function walkFiles(dir: string, accept: (name: string) => boolean, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walkFiles(path, accept, out);
    else if (accept(name)) out.push(path);
  }
}

function expectedMessages(text: string, what: string): { code: string; message: string }[] {
  const items = parseJson(text, what);
  const found: { code: string; message: string }[] = [];
  for (const item of Array.isArray(items) ? items : []) {
    const code = str(item, "code");
    if (code !== undefined) found.push({ code, message: str(item, "message") ?? "" });
  }
  return found;
}

/** Every fixture that expects at least one diagnostic, by code (`MTEK-E3001`). */
export function readFixtureCodes(root: string): Map<string, DiagnosticFixture[]> {
  const byCode = new Map<string, DiagnosticFixture[]>();
  const add = (code: string, fixture: DiagnosticFixture): void => {
    const list = byCode.get(code) ?? [];
    if (!list.some((existing) => existing.file === fixture.file)) list.push(fixture);
    byCode.set(code, list);
  };
  const jsonSuites: { dir: string; suite: DiagnosticFixture["suite"]; accept: (name: string) => boolean }[] = [
    { dir: "tests/syntax/lex", suite: "syntax-lex", accept: (n) => n.endsWith(".diag.json") },
    { dir: "tests/syntax/fail", suite: "syntax-fail", accept: (n) => n.endsWith(".diag.json") },
    { dir: "tests/semantics/pass", suite: "semantics-pass", accept: (n) => n === "expected.diag.json" },
    { dir: "tests/semantics/fail", suite: "semantics-fail", accept: (n) => n === "expected.diag.json" },
    { dir: "tests/semantics/gpu", suite: "semantics-gpu", accept: (n) => n === "expected.diag.json" },
    { dir: "tests/assets/fail", suite: "assets-fail", accept: (n) => n === "expected.diag.json" },
  ];
  for (const { dir, suite, accept } of jsonSuites) {
    const files: string[] = [];
    walkFiles(resolve(root, dir), accept, files);
    for (const file of files) {
      const rel = posix(root, file);
      const fixture = rel.endsWith("expected.diag.json") ? rel.slice(0, -"/expected.diag.json".length) : rel.replace(/\.diag\.json$/, ".mtek");
      const messages = expectedMessages(readFileSync(file, "utf8"), rel);
      for (const { code, message } of messages) {
        const known = byCode.get(code)?.find((existing) => existing.file === rel);
        if (known !== undefined) known.messages.push(message);
        else add(code, { file: rel, fixture, suite, messages: [message] });
      }
    }
  }
  // The diagnostic lines of an AST golden: `; MTEK-E1010 6..9 message`.
  const asts: string[] = [];
  walkFiles(resolve(root, "tests/syntax/ast"), (n) => n.endsWith(".ast"), asts);
  for (const file of asts) {
    const rel = posix(root, file);
    for (const line of readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n")) {
      const match = /^; (MTEK-[EW]\d{4}) \S+ (.*)$/.exec(line);
      if (match === null) continue;
      const code = match[1] ?? "";
      const known = byCode.get(code)?.find((existing) => existing.file === rel);
      if (known !== undefined) known.messages.push(match[2] ?? "");
      else add(code, { file: rel, fixture: rel.replace(/\.ast$/, ".mtek"), suite: "syntax-ast", messages: [match[2] ?? ""] });
    }
  }
  return byCode;
}

function entries(value: unknown): ExceptionEntry[] {
  const list: ExceptionEntry[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    if (!isObject(item)) continue;
    list.push({ code: str(item, "code") ?? "", reason: str(item, "reason") ?? "", test: str(item, "test") ?? null });
  }
  return list;
}

export function readExceptions(root: string): Exceptions {
  const document = parseJson(readFileSync(join(root, "tests", "semantics", "code-coverage-exceptions.json"), "utf8"), "code-coverage-exceptions.json");
  const field = (name: string): ExceptionEntry[] => entries(isObject(document) ? document[name] : undefined);
  return {
    notYetImplemented: field("notYetImplemented"),
    reserved: field("reserved"),
    unreachable: field("unreachable"),
    coveredElsewhere: field("coveredElsewhere"),
  };
}

export type CodeCoverage =
  | { kind: "fixture"; fixtures: DiagnosticFixture[] }
  | { kind: Exceptional; reason: string; test: string | null }
  | { kind: "uncovered" };

export interface CodeAudit {
  catalogue: CatalogueEntry[];
  coverage: Map<string, CodeCoverage>;
  /** Codes with no fixture, no named test and no reservation: must be empty. */
  uncovered: string[];
  problems: string[];
}

/** Judge every catalogue code. `readText` reads a repository file (a seam for the unit tests). */
export function auditCodes(
  catalogue: readonly CatalogueEntry[],
  fixtures: ReadonlyMap<string, readonly DiagnosticFixture[]>,
  exceptions: Exceptions,
  readText: (path: string) => string | null,
): CodeAudit {
  const problems: string[] = [];
  const listed = new Map<string, { list: string; entry: ExceptionEntry }>();
  const lists: [string, Exceptional | "not-yet-implemented", ExceptionEntry[]][] = [
    ["notYetImplemented", "not-yet-implemented", exceptions.notYetImplemented],
    ["reserved", "reserved", exceptions.reserved],
    ["unreachable", "unreachable", exceptions.unreachable],
    ["coveredElsewhere", "covered-elsewhere", exceptions.coveredElsewhere],
  ];
  const known = new Set(catalogue.map((entry) => entry.code));
  for (const [name, , entriesOfList] of lists) {
    for (const entry of entriesOfList) {
      if (!known.has(entry.code)) problems.push(`${name} lists ${entry.code}, which is not a catalogue code`);
      const other = listed.get(entry.code);
      if (other !== undefined) problems.push(`${entry.code} is listed in ${other.list} and ${name}`);
      listed.set(entry.code, { list: name, entry });
      if (entry.reason.trim() === "") problems.push(`${entry.code}: ${name} gives no reason`);
      if (entry.test !== null) {
        const text = readText(entry.test);
        if (text === null) problems.push(`${entry.code}: the test file ${entry.test} does not exist`);
        else if (!text.includes(entry.code)) problems.push(`${entry.code}: ${entry.test} does not name it`);
      } else if (name === "unreachable" || name === "coveredElsewhere") {
        problems.push(`${entry.code}: ${name} names no test file`);
      }
    }
  }
  for (const entry of exceptions.notYetImplemented) {
    problems.push(`${entry.code} is listed as not yet implemented (${entry.reason}); M7 requires the list to be empty`);
  }
  const coverage = new Map<string, CodeCoverage>();
  const uncovered: string[] = [];
  for (const entry of catalogue) {
    const produced = fixtures.get(`MTEK-${entry.code}`);
    const exception = listed.get(entry.code);
    if (produced !== undefined && produced.length > 0) {
      coverage.set(entry.code, { kind: "fixture", fixtures: [...produced] });
      if (exception !== undefined) problems.push(`${entry.code} now has a fixture (${produced[0]?.file ?? ""}); remove it from ${exception.list}`);
      if (entry.mark !== null) problems.push(`${entry.code} has a fixture, but the catalogue still marks it ${entry.mark}`);
      continue;
    }
    if (exception === undefined) {
      coverage.set(entry.code, { kind: "uncovered" });
      uncovered.push(entry.code);
      continue;
    }
    const kind: Exceptional = exception.list === "reserved" ? "reserved" : exception.list === "unreachable" ? "unreachable" : "covered-elsewhere";
    coverage.set(entry.code, { kind, reason: exception.entry.reason, test: exception.entry.test });
    if (kind === "reserved" && entry.mark === null) {
      problems.push(`${entry.code} is listed as reserved, but its row in spec/diagnostics.md carries no "**Reserved:**" or "**Not implemented:**" mark`);
    }
    if (kind !== "reserved" && entry.mark !== null) {
      problems.push(`${entry.code} is marked ${entry.mark} in the catalogue but is listed as ${exception.list}, not reserved`);
    }
  }
  for (const code of fixtures.keys()) {
    if (!known.has(code.replace(/^MTEK-/, ""))) problems.push(`a fixture expects ${code}, which is not a catalogue code`);
  }
  return { catalogue: [...catalogue], coverage, uncovered, problems };
}

export function fileReader(root: string): (path: string) => string | null {
  return (path) => {
    const full = resolve(root, path);
    return existsSync(full) ? readFileSync(full, "utf8") : null;
  };
}
