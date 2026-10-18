// Test support: runs the committed TextMate grammar with the same engines VS Code uses
// (`vscode-textmate` over `vscode-oniguruma`'s WebAssembly build of Oniguruma).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve, sep } from "node:path";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";
import { INITIAL, Registry, parseRawGrammar } from "vscode-textmate";
import type { IGrammar, StateStack } from "vscode-textmate";

const require = createRequire(import.meta.url);

export const PACKAGE_ROOT = resolve(import.meta.dirname, "..", "..");
export const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..");
export const GRAMMAR_PATH = join(PACKAGE_ROOT, "syntaxes", "mtek.tmLanguage.json");

let grammarPromise: Promise<IGrammar> | undefined;

/** The Mtek grammar, loaded once. */
export function loadGrammar(): Promise<IGrammar> {
  grammarPromise ??= (async () => {
    const wasm = readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm"));
    await loadWASM({ data: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) });
    const registry = new Registry({
      onigLib: Promise.resolve({
        createOnigScanner: (patterns: string[]) => new OnigScanner(patterns),
        createOnigString: (text: string) => new OnigString(text),
      }),
      loadGrammar: (scopeName: string) => {
        if (scopeName !== "source.mtek") return Promise.resolve(null);
        return Promise.resolve(
          parseRawGrammar(readFileSync(GRAMMAR_PATH, "utf8"), GRAMMAR_PATH),
        );
      },
    });
    const grammar = await registry.loadGrammar("source.mtek");
    if (grammar === null) throw new Error("the grammar source.mtek did not load");
    return grammar;
  })();
  return grammarPromise;
}

export interface LineTokens {
  readonly line: string;
  readonly tokens: readonly { readonly text: string; readonly scopes: readonly string[] }[];
  readonly stoppedEarly: boolean;
  /** The tokens cover the line from column 0 to its end without a gap or an overlap. */
  readonly covering: boolean;
}

/** Tokenises text line by line, carrying the rule stack as an editor does (lines split on CRLF, LF or CR). */
export function tokenizeText(grammar: IGrammar, text: string): LineTokens[] {
  const out: LineTokens[] = [];
  let stack: StateStack = INITIAL;
  for (const line of text.split(/\r\n|\r|\n/)) {
    const result = grammar.tokenizeLine(line, stack, 5000);
    let expected = 0;
    let covering = true;
    for (const token of result.tokens) {
      if (token.startIndex !== expected || token.endIndex < token.startIndex) covering = false;
      expected = token.endIndex;
    }
    // vscode-textmate appends a newline to the line it tokenises; the last token may end one past it.
    if (expected < line.length) covering = false;
    out.push({
      line,
      tokens: result.tokens.map((token) => ({
        text: line.slice(token.startIndex, Math.min(token.endIndex, line.length)),
        scopes: token.scopes,
      })),
      stoppedEarly: result.stoppedEarly,
      covering,
    });
    stack = result.ruleStack;
  }
  return out;
}

/** The scopes (after `source.mtek`) of the token with exactly this text, in the first line that has it. */
export function scopesOf(lines: readonly LineTokens[], tokenText: string): readonly string[] {
  for (const line of lines) {
    for (const token of line.tokens) {
      if (token.text === tokenText) return token.scopes.slice(1);
    }
  }
  throw new Error(
    `no token with the text ${JSON.stringify(tokenText)}; tokens: ${JSON.stringify(
      lines.flatMap((l) => l.tokens.map((t) => t.text)),
    )}`,
  );
}

/** Directories never part of the corpus: build output, dependencies, other checkouts, the holdout. */
const SKIPPED_DIRECTORIES = new Set([".git", ".claude", "node_modules", "target", "dist"]);
/** The benchmark holdout tasks are kept away from every tool that could learn from them. */
const HOLDOUT = "benchmarks/holdout";

/** Every `.mtek` file of the repository except `benchmarks/holdout/`, as repo-relative POSIX paths, sorted. */
export function corpusFiles(): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const rel = relative(REPO_ROOT, path).split(sep).join("/");
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name) || rel === HOLDOUT) continue;
        walk(path);
      } else if (entry.isFile() && entry.name.endsWith(".mtek")) {
        found.push(rel);
      }
    }
  };
  walk(REPO_ROOT);
  return found.sort();
}

/** The `mtek` binary `npm run build` makes (`cargo build -p mtek-cli`); a test that needs it fails without it. */
export function mtekBinary(): string {
  const exe = join(REPO_ROOT, "target", "debug", process.platform === "win32" ? "mtek.exe" : "mtek");
  if (!existsSync(exe)) {
    throw new Error(`${exe} does not exist: run \`npm run build\` (or \`cargo build -p mtek-cli\`) first`);
  }
  return exe;
}
