// The dependency boundary of decision 0003 and spec/ai-and-benchmarks.md section 4.1: "the language,
// compiler and runtime have no dependency on any inference provider", and no language package imports
// any adapter. This is a real check, not a convention: it reads the imports of the files and fails
// when one is wrong. `npm run lint -w @mtek/ai-eval` runs it (so `npm run check` does), and its unit
// test runs it against the repository and against synthetic trees that violate each rule.
//
//   node src/check-boundary.ts [REPO_ROOT]
//
// Rules:
//   language-package   no file of `packages/*` or `crates/*` imports `@mtek/ai-eval`, a path into
//                      `tools/ai-eval`, an adapter, or an inference provider's library, and no
//                      package.json or Cargo.toml of theirs depends on one;
//   core-adapter       no module of `tools/ai-eval/src` outside `adapters/` imports an optional
//                      adapter (`anthropic`, `openai-compatible`, `llama-cpp`) or a provider library;
//   adapter-isolation  an adapter imports no other adapter, and only the `anthropic` adapter imports
//                      the Anthropic SDK; `adapters/registry.ts` reaches the optional adapters only
//                      through dynamic `import()`;
//   optional-dependency the provider libraries are `optionalDependencies` of `tools/ai-eval`, never
//                      `dependencies`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface Violation {
  rule: "language-package" | "core-adapter" | "adapter-isolation" | "optional-dependency";
  /** Repository-relative, `/`-separated. */
  file: string;
  line: number;
  message: string;
}

export interface ImportRef {
  specifier: string;
  line: number;
  dynamic: boolean;
}

/** The optional adapters: loaded lazily by name, by `adapters/registry.ts` only. */
export const OPTIONAL_ADAPTERS = ["anthropic", "openai-compatible", "llama-cpp"] as const;
/** Every adapter module, `replay` included. */
export const ADAPTER_MODULES = ["replay", ...OPTIONAL_ADAPTERS] as const;

/** Libraries of inference providers; nothing of the language may depend on one, and the harness only optionally. */
export const PROVIDER_PACKAGES: readonly RegExp[] = [
  /^@anthropic-ai\//,
  /^anthropic$/,
  /^openai$/,
  /^@openai\//,
  /^node-llama-cpp$/,
  /^llama-cpp/,
  /^ollama$/,
  /^@google\/(?:genai|generative-ai)$/,
  /^@mistralai\//,
  /^cohere-ai$/,
];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "target", ".out", ".git"]);

/** Removes comments (so that an import in a comment is not one). Strings that contain `//` are left alone. */
function stripComments(source: string): string {
  const blocks = source.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));
  return blocks
    .split("\n")
    .map((line) => line.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n");
}

/** The module specifiers a JavaScript or TypeScript source imports, with their lines. */
export function scanImports(source: string): ImportRef[] {
  const text = stripComments(source);
  const found: ImportRef[] = [];
  const add = (specifier: string | undefined, index: number, dynamic: boolean): void => {
    if (specifier === undefined) return;
    found.push({ specifier, line: text.slice(0, index).split("\n").length, dynamic });
  };
  const patterns: [RegExp, boolean][] = [
    [/(?<![.\w$])import\s+(?:type\s+)?(?:[\w*${},\s]*?\s+from\s+)?["']([^"'\n]+)["']/g, false],
    [/(?<![.\w$])export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+["']([^"'\n]+)["']/g, false],
    [/(?<![.\w$])import\s*\(\s*["']([^"'\n]+)["']\s*\)/g, true],
    [/(?<![.\w$])require\s*\(\s*["']([^"'\n]+)["']\s*\)/g, false],
  ];
  for (const [pattern, dynamic] of patterns) {
    for (const match of text.matchAll(pattern)) add(match[1], match.index, dynamic);
  }
  return found.sort((a, b) => a.line - b.line || a.specifier.localeCompare(b.specifier));
}

const posix = (path: string): string => path.split(sep).join("/");

function walk(directory: string, visit: (file: string) => void): void {
  if (!existsSync(directory)) return;
  for (const name of readdirSync(directory).sort()) {
    if (SKIPPED_DIRECTORIES.has(name)) continue;
    const path = join(directory, name);
    if (statSync(path).isDirectory()) walk(path, visit);
    else visit(path);
  }
}

function extensionOf(file: string): string {
  const name = basename(file);
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot);
}

const isProvider = (specifier: string): boolean => PROVIDER_PACKAGES.some((pattern) => pattern.test(specifier));

/** Does the specifier name the harness or one of its adapters (by package name or by path)? */
function namesHarness(specifier: string): boolean {
  return (
    /^@mtek\/ai-eval(?:\/|$)/.test(specifier) ||
    /(?:^|\/)tools\/ai-eval(?:\/|$)/.test(specifier) ||
    /(?:^|\/)ai-eval(?:\/|$)/.test(specifier) ||
    /(?:^|\/)adapters\/(?:replay|anthropic|openai-compatible|llama-cpp|registry)(?:\.[a-z]+)?$/.test(specifier)
  );
}

function adapterOf(specifier: string): string | null {
  const match = /(?:^|\/)(replay|anthropic|openai-compatible|llama-cpp|registry)(?:\.[a-z]+)?$/.exec(specifier);
  return match?.[1] ?? null;
}

function manifestDependencies(json: string): { section: string; name: string }[] {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return [];
  }
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  const names: { section: string; name: string }[] = [];
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const table = record[section];
    if (typeof table === "object" && table !== null) for (const name of Object.keys(table)) names.push({ section, name });
  }
  return names;
}

export function checkBoundary(root: string): Violation[] {
  const violations: Violation[] = [];
  const rel = (file: string): string => posix(relative(root, file));

  // language-package: packages/* and crates/*
  for (const group of ["packages", "crates"]) {
    walk(join(root, group), (file) => {
      const name = basename(file);
      if (SOURCE_EXTENSIONS.has(extensionOf(file))) {
        for (const ref of scanImports(readFileSync(file, "utf8"))) {
          if (namesHarness(ref.specifier) || isProvider(ref.specifier)) {
            violations.push({ rule: "language-package", file: rel(file), line: ref.line, message: `imports '${ref.specifier}' (a language package must not import the harness, an adapter or an inference provider)` });
          }
        }
      } else if (name === "package.json") {
        for (const dep of manifestDependencies(readFileSync(file, "utf8"))) {
          if (dep.name === "@mtek/ai-eval" || isProvider(dep.name)) {
            violations.push({ rule: "language-package", file: rel(file), line: 1, message: `${dep.section} names '${dep.name}'` });
          }
        }
      } else if (name === "Cargo.toml") {
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((text, index) => {
            if (/ai-eval|anthropic|openai|llama[-_.]?cpp/i.test(text.replace(/^\s*#.*$/, ""))) {
              violations.push({ rule: "language-package", file: rel(file), line: index + 1, message: "mentions the harness or an inference provider" });
            }
          });
      }
    });
  }

  // core-adapter and adapter-isolation: tools/ai-eval/src
  const src = join(root, "tools", "ai-eval", "src");
  const adaptersDir = join(src, "adapters");
  walk(src, (file) => {
    if (!SOURCE_EXTENSIONS.has(extensionOf(file))) return;
    const inAdapters = dirname(file) === adaptersDir;
    const self = basename(file).replace(/\.[a-z]+$/, "");
    for (const ref of scanImports(readFileSync(file, "utf8"))) {
      const adapter = adapterOf(ref.specifier);
      const optionalAdapter = adapter !== null && (OPTIONAL_ADAPTERS as readonly string[]).includes(adapter);
      if (!inAdapters) {
        if (isProvider(ref.specifier)) {
          violations.push({ rule: "core-adapter", file: rel(file), line: ref.line, message: `imports the provider library '${ref.specifier}'` });
        } else if (optionalAdapter && /(?:^|\/)adapters\//.test(ref.specifier)) {
          violations.push({ rule: "core-adapter", file: rel(file), line: ref.line, message: `imports the optional adapter '${ref.specifier}'; only adapters/registry.ts loads it, lazily` });
        }
        continue;
      }
      // Inside src/adapters/.
      if (self === "registry") {
        if (optionalAdapter && !ref.dynamic) {
          violations.push({ rule: "adapter-isolation", file: rel(file), line: ref.line, message: `imports the optional adapter '${ref.specifier}' statically; use import() so it loads only when asked for` });
        }
        if (isProvider(ref.specifier)) {
          violations.push({ rule: "adapter-isolation", file: rel(file), line: ref.line, message: `imports the provider library '${ref.specifier}'` });
        }
        continue;
      }
      if (adapter !== null && ref.specifier.startsWith("./") && adapter !== self) {
        violations.push({ rule: "adapter-isolation", file: rel(file), line: ref.line, message: `the adapter '${self}' imports '${ref.specifier}'; adapters do not import each other or the registry` });
      }
      if (isProvider(ref.specifier) && !(self === "anthropic" && /^@anthropic-ai\//.test(ref.specifier))) {
        violations.push({ rule: "adapter-isolation", file: rel(file), line: ref.line, message: `the adapter '${self}' imports the provider library '${ref.specifier}'` });
      }
    }
  });

  // optional-dependency: tools/ai-eval/package.json
  const manifest = join(root, "tools", "ai-eval", "package.json");
  if (existsSync(manifest)) {
    for (const dep of manifestDependencies(readFileSync(manifest, "utf8"))) {
      if (isProvider(dep.name) && dep.section !== "optionalDependencies") {
        violations.push({ rule: "optional-dependency", file: rel(manifest), line: 1, message: `${dep.section} names the provider library '${dep.name}'; it must be an optionalDependency` });
      }
    }
  }

  return violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.message.localeCompare(b.message));
}

function main(argv: string[]): number {
  const root = argv[0] === undefined ? resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..") : resolve(argv[0]);
  const violations = checkBoundary(root);
  if (violations.length === 0) {
    process.stdout.write("ai-eval boundary: OK (no language package imports the harness, an adapter or a provider; the core imports no optional adapter)\n");
    return 0;
  }
  for (const v of violations) process.stderr.write(`${v.file}:${String(v.line)}: [${v.rule}] ${v.message}\n`);
  process.stderr.write(`ai-eval boundary: ${String(violations.length)} violation${violations.length === 1 ? "" : "s"}\n`);
  return 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
