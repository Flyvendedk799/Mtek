// Makes a run record machine-neutral before it is committed as evidence.
//
//   npm run evidence:sanitize -- <in.json> <out.json>
//
// Playwright's JSON report (and anything else written during a run) contains absolute paths of the
// machine that produced it: the checkout, the results directory, the Node binary. This tool
// rewrites every string (and every key) of a JSON document so that
//
//   - a path under the repository root becomes a repo-relative POSIX path (`tests/browser/specs`),
//     whichever slash spelling it used and wherever the checkout (or worktree) was;
//   - a path under the results directory becomes `<results>/...`;
//   - any other absolute path (temp directories, the Node binary, home directories) becomes
//     `<external>`.
//
// Nothing else changes: numbers, timestamps, durations, ids, statuses and annotations pass through
// untouched, because the document is a run record. The repository root is inferred from the
// report's `config.configFile` (the directory above `tests/browser/playwright.config.ts`), and the
// results directory from the JSON reporter's `outputFile`; this tool's own checkout is always a
// root too. It uses only Node built-ins, and runs under Node 24's built-in type stripping.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The checkout this tool lives in: `tests/browser/support/` is three levels below the root. */
const OWN_REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");

export const EXTERNAL_PLACEHOLDER = "<external>";
export const RESULTS_PLACEHOLDER = "<results>";

export interface SanitizeOptions {
  /** Additional repository roots to rewrite to repo-relative paths. */
  readonly repoRoots?: readonly string[];
  /** The results directory, when it cannot be inferred from the report. */
  readonly resultsDir?: string;
}

/** Characters that end a path inside running text. */
const TOKEN_END = String.raw`\s"'<>|*?(),;\[\]{}`;

/** POSIX directories whose absolute paths are machine-specific (a bare `/bridge.html` is a URL path). */
const POSIX_ROOTS = "home|Users|tmp|var|private|root|opt|mnt|run|usr|workspace|__w|builds";

const WINDOWS_PATH = String.raw`[A-Za-z]:[\\/]`;
const WHOLE_PATH = new RegExp(String.raw`^(?:${WINDOWS_PATH}|/(?:${POSIX_ROOTS})/)[^\r\n]*$`);
const EXTERNAL_TOKEN = new RegExp(
  String.raw`(?<![\w.-])(?:${WINDOWS_PATH}|/(?:${POSIX_ROOTS})/)[^${TOKEN_END}]*`,
  "g",
);

/** A directory whose paths are rewritten: to repo-relative paths (`label` null) or to `<label>/...`. */
interface Rule {
  /** The directory with forward slashes and no trailing slash. */
  readonly root: string;
  readonly placeholder: string | null;
}

function toForwardSlashes(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** `root` as a regular expression source that accepts either slash spelling. */
function rootSource(root: string): string {
  return root.split("/").map(escapeRegExp).join(String.raw`[\\/]`);
}

function replaceRoot(text: string, rule: Rule, whole: boolean): string {
  // Inside a string that is a single path the remainder may contain spaces; inside running text
  // it ends at the first separator character of the prose around it.
  const rest = whole ? String.raw`[^\r\n]*` : `[^${TOKEN_END}]*`;
  const flags = /^[A-Za-z]:/.test(rule.root) ? "gi" : "g";
  const pattern = new RegExp(`(?<![\\w.-])${rootSource(rule.root)}(?![\\w.-])((?:[\\\\/]${rest})?)`, flags);
  return text.replace(pattern, (_match, tail: string) => {
    const relative = toForwardSlashes(tail).replace(/^\//, "");
    if (rule.placeholder === null) return relative === "" ? "." : relative;
    return relative === "" ? rule.placeholder : `${rule.placeholder}/${relative}`;
  });
}

function rewriteString(text: string, rules: readonly Rule[]): string {
  const whole = WHOLE_PATH.test(text);
  let out = text;
  for (const rule of rules) out = replaceRoot(out, rule, whole);
  return whole && WHOLE_PATH.test(out) ? EXTERNAL_PLACEHOLDER : out.replace(EXTERNAL_TOKEN, EXTERNAL_PLACEHOLDER);
}

function rewriteValue(value: unknown, rules: readonly Rule[]): unknown {
  if (typeof value === "string") return rewriteString(value, rules);
  if (Array.isArray(value)) return (value as unknown[]).map((entry) => rewriteValue(entry, rules));
  if (typeof value === "object" && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) copy[rewriteString(key, rules)] = rewriteValue(entry, rules);
    return copy;
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** `path` without its last `suffix` (case-insensitive, either slash spelling), or `undefined`. */
function stripSuffix(path: unknown, suffix: string): string | undefined {
  if (typeof path !== "string") return undefined;
  const normal = toForwardSlashes(path);
  const at = normal.length - suffix.length;
  if (at <= 0 || normal.slice(at).toLowerCase() !== suffix.toLowerCase()) return undefined;
  return normal.slice(0, at);
}

/** The roots a report describes itself with: the checkout and the results directory. */
function inferRoots(report: unknown): { repoRoots: string[]; resultsDir: string | undefined } {
  const config = asRecord(asRecord(report)?.["config"]);
  const repoRoots: string[] = [];
  for (const root of [
    stripSuffix(config?.["configFile"], "/tests/browser/playwright.config.ts"),
    stripSuffix(config?.["rootDir"], "/tests/browser/specs"),
  ]) {
    if (root !== undefined) repoRoots.push(root);
  }
  let resultsDir: string | undefined;
  const reporters = config?.["reporter"];
  if (Array.isArray(reporters)) {
    for (const entry of reporters as unknown[]) {
      const outputFile = asRecord(Array.isArray(entry) ? (entry as unknown[])[1] : undefined)?.["outputFile"];
      if (typeof outputFile === "string") {
        const normal = toForwardSlashes(outputFile);
        const slash = normal.lastIndexOf("/");
        if (slash > 0) resultsDir = normal.slice(0, slash);
        break;
      }
    }
  }
  return { repoRoots, resultsDir };
}

/** Returns a sanitised deep copy of a parsed JSON document. */
export function sanitizeReport(report: unknown, options: SanitizeOptions = {}): unknown {
  const inferred = inferRoots(report);
  const rules: Rule[] = [];
  for (const root of [...inferred.repoRoots, ...(options.repoRoots ?? []), OWN_REPO_ROOT]) {
    rules.push({ root: toForwardSlashes(root), placeholder: null });
  }
  const resultsDir = options.resultsDir ?? inferred.resultsDir;
  if (resultsDir !== undefined) rules.push({ root: toForwardSlashes(resultsDir), placeholder: RESULTS_PLACEHOLDER });
  // The most specific directory wins (a results directory may live inside the checkout).
  const unique = new Map(rules.map((rule) => [`${rule.root.toLowerCase()}|${rule.placeholder ?? ""}`, rule]));
  const ordered = [...unique.values()].sort((a, b) => b.root.length - a.root.length);
  return rewriteValue(report, ordered);
}

/** Sanitises JSON text; keeps the two-space indentation and the final newline of the input. */
export function sanitizeReportText(text: string, options: SanitizeOptions = {}): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`not valid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const body = JSON.stringify(sanitizeReport(parsed, options), null, 2);
  return text.endsWith("\n") ? `${body}\n` : body;
}

function main(args: readonly string[]): number {
  const [input, output, ...extra] = args;
  if (input === undefined || output === undefined || extra.length > 0) {
    process.stderr.write("usage: npm run evidence:sanitize -- <in.json> <out.json>\n");
    return 2;
  }
  let text: string;
  try {
    text = readFileSync(input, "utf8");
  } catch (error) {
    process.stderr.write(`cannot read ${input}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  let sanitized: string;
  try {
    sanitized = sanitizeReportText(text);
  } catch (error) {
    process.stderr.write(`${input}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  writeFileSync(output, sanitized);
  process.stdout.write(`sanitized ${input} -> ${output}\n`);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
