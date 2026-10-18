// The Editor (spec/ai-and-benchmarks.md section 4.3, decision 0077): parses a model reply into edits
// and applies them to the files of a scratch copy of the project under the exact-match rule.
//
// Reply format (blocks):
//
//   <<<FILE src/main.mtek
//   <<<SEARCH
//           speed = -speed;
//   ===
//           speed = -speed * 1.5;
//   >>>REPLACE
//
//   <<<FILE src/extra.mtek
//   <<<WHOLE
//   ...the complete file...
//   >>>END
//
// Marker lines start in column 0 and nothing follows them but the path of `<<<FILE`. Text outside the
// blocks (prose, code fences) is ignored. A FILE line may be followed by several SEARCH blocks.
// The closing marker of a whole-file block, `>>>END`, is this record's choice (the spec leaves it open).
//
// Rules, each of which produces a structured rejection that is recorded and returned to the model
// (a rejected reply is a repair round):
//   - A SEARCH text must match the current file exactly once (overlapping matches count); none or
//     several is a rejection. An empty SEARCH is a rejection. There is no fuzzy matching.
//   - Only files the policy makes writable may change; whole-file blocks only where the policy allows.
//   - A reply is applied atomically: if any edit is rejected, no edit is applied.
//   - A reply that changes nothing is rejected (`no-change`).
// The only normalisation is `\r\n` to `\n` in the reply itself (a transport artefact; project files
// are LF, `.gitattributes`).

export type EditFormat = "blocks" | "json" | "module";

export type Edit =
  | { kind: "replace"; file: string; search: string; replace: string; index: number }
  | { kind: "whole"; file: string; content: string; index: number };

export type EditRejectionCode =
  | "no-edit-blocks"
  | "malformed-block"
  | "json-invalid"
  | "path-invalid"
  | "path-not-allowed"
  | "file-not-found"
  | "empty-search"
  | "search-not-found"
  | "search-ambiguous"
  | "whole-file-not-allowed"
  | "empty-whole-file"
  | "no-change";

export interface EditRejection {
  /** The 1-based position of the edit in the reply, or null for a problem of the reply as a whole. */
  index: number | null;
  file: string | null;
  code: EditRejectionCode;
  /** Addressed to the model: says what was wrong and what to do. */
  message: string;
  /** For `search-ambiguous`: how many places matched. */
  matches?: number;
}

export interface AppliedEdit {
  index: number;
  file: string;
  kind: "replace" | "whole-replace" | "whole-create";
}

export interface ParsedReply {
  format: EditFormat;
  edits: Edit[];
  problems: EditRejection[];
}

/** Which files a model may change and how. */
export interface EditPolicy {
  isWritable(path: string): boolean;
  /** `any`: a whole-file block may replace or create a writable file. `create-only`: only create one that does not exist. */
  wholeFile: "any" | "create-only";
  /** Said to the model when `isWritable` refuses a path. */
  writableDescription: string;
}

/** The files of a Mtek project that a model may change: the project file and the sources. Never `tests/`, assets or anything else. */
export function isProjectSource(path: string): boolean {
  return path === "mtek.toml" || /^src\/(?:[^/]+\/)*[^/]+\.mtek$/.test(path);
}

/** Cold tasks are authored from nothing, so whole files are fine; edit tasks change existing files by search and replace only. */
export function defaultEditPolicy(mode: "cold" | "edit"): EditPolicy {
  return {
    isWritable: isProjectSource,
    wholeFile: mode === "cold" ? "any" : "create-only",
    writableDescription: "mtek.toml and the .mtek files under src/",
  };
}

const FILE = "<<<FILE ";
const SEARCH = "<<<SEARCH";
const WHOLE = "<<<WHOLE";
const DIVIDER = "===";
const END_REPLACE = ">>>REPLACE";
const END_WHOLE = ">>>END";

function problem(code: EditRejectionCode, message: string, file: string | null = null, index: number | null = null): EditRejection {
  return { index, file, code, message };
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

type ParserState = "outside" | "afterFile" | "afterBlock" | "search" | "replace" | "whole";

/** Parses a reply in the block format. */
export function parseBlocks(reply: string): ParsedReply {
  const lines = normalizeNewlines(reply).split("\n");
  const edits: Edit[] = [];
  const problems: EditRejection[] = [];
  let file: string | null = null;
  let state = "outside" as ParserState;
  let buffer: string[] = [];
  let search = "";
  let startLine = 0;
  const here = (line: number): string => `line ${String(line)}`;

  const open = (line: string, lineNumber: number): void => {
    // Handles a line that may start a block while no block is open.
    if (line.startsWith(FILE)) {
      const path = line.slice(FILE.length).trim();
      if (path === "") {
        problems.push(problem("malformed-block", `${here(lineNumber)}: '<<<FILE' needs a path`));
        file = null;
        state = "outside";
      } else {
        file = path;
        state = "afterFile";
      }
      return;
    }
    if (state === "afterFile" || state === "afterBlock") {
      if (line === SEARCH) {
        buffer = [];
        startLine = lineNumber;
        state = "search";
        return;
      }
      if (line === WHOLE && state === "afterFile") {
        buffer = [];
        startLine = lineNumber;
        state = "whole";
        return;
      }
      if (line.trim() === "") return;
      if (state === "afterFile") {
        problems.push(
          problem("malformed-block", `${here(lineNumber)}: expected '<<<SEARCH' or '<<<WHOLE' after '<<<FILE ${file ?? ""}'`, file),
        );
      }
      state = "outside";
    }
    if (line === SEARCH || line === WHOLE || line === END_REPLACE || line === END_WHOLE || line === DIVIDER) {
      problems.push(problem("malformed-block", `${here(lineNumber)}: '${line}' is not valid here; every block starts with '<<<FILE path'`));
    }
  };

  for (const [position, line] of lines.entries()) {
    const number = position + 1;
    switch (state) {
      case "outside":
      case "afterFile":
      case "afterBlock":
        open(line, number);
        break;
      case "search":
        if (line === DIVIDER) {
          search = buffer.join("\n");
          buffer = [];
          state = "replace";
        } else {
          buffer.push(line);
        }
        break;
      case "replace":
        if (line === END_REPLACE) {
          edits.push({ kind: "replace", file: file ?? "", search, replace: buffer.join("\n"), index: edits.length + 1 });
          buffer = [];
          state = "afterBlock";
        } else {
          buffer.push(line);
        }
        break;
      case "whole":
        if (line === END_WHOLE) {
          edits.push({ kind: "whole", file: file ?? "", content: buffer.length === 0 ? "" : `${buffer.join("\n")}\n`, index: edits.length + 1 });
          buffer = [];
          state = "afterBlock";
        } else {
          buffer.push(line);
        }
        break;
    }
  }
  if (state === "search" || state === "replace" || state === "whole") {
    const what = state === "whole" ? "<<<WHOLE" : "<<<SEARCH";
    const closer = state === "whole" ? END_WHOLE : state === "search" ? `${DIVIDER}' and '${END_REPLACE}` : END_REPLACE;
    problems.push(
      problem(
        "malformed-block",
        `the '${what}' block that starts at ${here(startLine)} is not closed with '${closer}'; the reply ended inside it`,
        file,
      ),
    );
  }
  if (edits.length === 0 && problems.length === 0) {
    problems.push(
      problem(
        "no-edit-blocks",
        "the reply contains no edit blocks; answer with '<<<FILE path' followed by '<<<SEARCH ... === ... >>>REPLACE' or '<<<WHOLE ... >>>END' blocks",
      ),
    );
  }
  return { format: "blocks", edits, problems };
}

function stripFence(text: string): string {
  const match = /^```[A-Za-z0-9_-]*\n([\s\S]*?)\n```\s*$/.exec(text.trim());
  return match?.[1] ?? text;
}

/** Parses the optional JSON transport `{ "edits": [ { "file", "search", "replace" } ] }` (spec 4.3). */
export function parseJsonEdits(reply: string): ParsedReply {
  const bad = (message: string): ParsedReply => ({ format: "json", edits: [], problems: [problem("json-invalid", message)] });
  let value: unknown;
  try {
    value = JSON.parse(stripFence(normalizeNewlines(reply)).trim());
  } catch {
    return bad("the reply is not valid JSON");
  }
  const list = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>)["edits"] : undefined;
  if (!Array.isArray(list)) return bad('the JSON must be an object with an "edits" array');
  const edits: Edit[] = [];
  const problems: EditRejection[] = [];
  for (const [position, item] of (list as unknown[]).entries()) {
    const entry = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : null;
    const keys = entry === null ? [] : Object.keys(entry).sort();
    if (entry === null || keys.join(",") !== "file,replace,search" || keys.some((key) => typeof entry[key] !== "string")) {
      problems.push(problem("json-invalid", `edit ${String(position + 1)} must be {"file", "search", "replace"}, all strings`, null, position + 1));
      continue;
    }
    edits.push({
      kind: "replace",
      file: entry["file"] as string,
      search: entry["search"] as string,
      replace: entry["replace"] as string,
      index: position + 1,
    });
  }
  if (edits.length === 0 && problems.length === 0) problems.push(problem("no-edit-blocks", 'the "edits" array is empty'));
  return { format: "json", edits, problems };
}

/** Parses a reply that is a whole module (the `module` reply format of a constrained trial): it replaces `entry`. */
export function parseModuleReply(reply: string, entry: string): ParsedReply {
  const source = stripFence(normalizeNewlines(reply));
  const content = source.trim() === "" ? "" : `${source.replace(/\s+$/, "")}\n`;
  return { format: "module", edits: [{ kind: "whole", file: entry, content, index: 1 }], problems: [] };
}

/** Parses a reply: JSON when it opens with `{` (optionally fenced), blocks otherwise. */
export function parseReply(reply: string): ParsedReply {
  const body = stripFence(normalizeNewlines(reply)).trimStart();
  return body.startsWith("{") ? parseJsonEdits(reply) : parseBlocks(reply);
}

/** A path inside the project: relative, `/`-separated, no `.` or `..` segments. Returns null when it is not one. */
export function normalizeProjectPath(path: string): string | null {
  if (path === "" || path.length > 200) return null;
  if (path.includes("\\") || path.includes(":") || path.includes("\0") || path.startsWith("/")) return null;
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  return segments.join("/");
}

function occurrences(text: string, search: string): number[] {
  const at: number[] = [];
  let from = 0;
  for (;;) {
    const found = text.indexOf(search, from);
    if (found < 0) return at;
    at.push(found);
    from = found + 1; // overlapping matches count: "aa" occurs twice in "aaa"
  }
}

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

export interface EditOutcome {
  applied: AppliedEdit[];
  rejected: EditRejection[];
  /** The new content of every file the reply changes. Empty when anything was rejected (atomic). */
  files: Map<string, string>;
}

/**
 * Applies the edits of a parsed reply to the files `read` returns. Nothing is written: the caller
 * commits `files` only when `rejected` is empty.
 */
export function applyEdits(parsed: ParsedReply, read: (path: string) => string | undefined, policy: EditPolicy): EditOutcome {
  const rejected: EditRejection[] = [...parsed.problems];
  const applied: AppliedEdit[] = [];
  const overlay = new Map<string, string>();
  const original = new Map<string, string | undefined>();
  const current = (path: string): string | undefined => overlay.get(path) ?? read(path);

  for (const edit of parsed.edits) {
    const path = normalizeProjectPath(edit.file);
    if (path === null) {
      rejected.push(problem("path-invalid", `'${edit.file}' is not a project-relative path (no absolute paths, no '..', '/' as the separator)`, edit.file, edit.index));
      continue;
    }
    if (!policy.isWritable(path)) {
      rejected.push(problem("path-not-allowed", `'${path}' may not be changed; only ${policy.writableDescription} may`, path, edit.index));
      continue;
    }
    if (!original.has(path)) original.set(path, read(path));
    const text = current(path);

    if (edit.kind === "whole") {
      if (edit.content === "") {
        rejected.push(problem("empty-whole-file", `the whole-file block for '${path}' is empty`, path, edit.index));
        continue;
      }
      if (text !== undefined && policy.wholeFile === "create-only") {
        rejected.push(
          problem(
            "whole-file-not-allowed",
            `'${path}' exists, and this task changes existing files only with '<<<SEARCH ... === ... >>>REPLACE' blocks; a '<<<WHOLE' block may only create a new file`,
            path,
            edit.index,
          ),
        );
        continue;
      }
      overlay.set(path, edit.content);
      applied.push({ index: edit.index, file: path, kind: text === undefined ? "whole-create" : "whole-replace" });
      continue;
    }

    if (text === undefined) {
      rejected.push(
        problem(
          "file-not-found",
          policy.wholeFile === "any"
            ? `'${path}' does not exist; create it with a '<<<WHOLE' block`
            : `'${path}' does not exist; a '<<<WHOLE' block may create a new file`,
          path,
          edit.index,
        ),
      );
      continue;
    }
    if (edit.search === "") {
      rejected.push(problem("empty-search", `the SEARCH text for '${path}' is empty; it must be the exact text to replace`, path, edit.index));
      continue;
    }
    const at = occurrences(text, edit.search);
    if (at.length === 0) {
      const firstLine = edit.search.split("\n")[0]?.trim() ?? "";
      const hint = firstLine !== "" && text.includes(firstLine) ? `; its first line (trimmed) does occur at line ${String(lineOf(text, text.indexOf(firstLine)))}, so check indentation and the following lines` : "";
      rejected.push(
        problem("search-not-found", `the SEARCH text matches nothing in '${path}'${hint}; it must match the current file exactly, character for character`, path, edit.index),
      );
      continue;
    }
    if (at.length > 1) {
      const lines = at.map((offset) => lineOf(text, offset)).join(", ");
      rejected.push({
        ...problem(
          "search-ambiguous",
          `the SEARCH text matches ${String(at.length)} places in '${path}' (lines ${lines}); add surrounding lines so that it matches exactly once`,
          path,
          edit.index,
        ),
        matches: at.length,
      });
      continue;
    }
    const start = at[0] ?? 0;
    overlay.set(path, text.slice(0, start) + edit.replace + text.slice(start + edit.search.length));
    applied.push({ index: edit.index, file: path, kind: "replace" });
  }

  if (rejected.length === 0) {
    const changed = [...overlay.entries()].filter(([path, content]) => original.get(path) !== content);
    if (changed.length === 0) {
      rejected.push(problem("no-change", "the edits change nothing: every file is left exactly as it was"));
    } else {
      return { applied, rejected, files: new Map(changed) };
    }
  }
  return { applied: [], rejected, files: new Map() };
}
