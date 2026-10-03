// Re-checks `type-experiments.ts` with every `@ts-expect-error` directive blanked out (line numbers
// are preserved) and reports, per `CASE nn` comment, whether tsc rejects the statement that follows
// it. Usage: `node tools/type-experiment-report.ts` (prints a Markdown table plus a JSON summary).
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";

const root = join(import.meta.dirname, "..");
const experimentFile = resolve(root, "type-experiments.ts");

export interface CaseOutcome {
  readonly id: string;
  readonly description: string;
  readonly rejected: boolean;
  /** First line of the first diagnostic reported inside the case, or null. */
  readonly message: string | null;
  readonly code: number | null;
}

export function blankDirectives(text: string): string {
  return text.replace(/^(\s*)\/\/ @ts-expect-error.*$/gm, "$1//");
}

export function analyse(text: string, diagnostics: readonly { line: number; code: number; message: string }[]): CaseOutcome[] {
  const lines = text.split("\n");
  const starts: { id: string; description: string; line: number }[] = [];
  lines.forEach((line, index) => {
    const match = /^\s*\/\/ CASE (\d+): (.*)$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      starts.push({ id: match[1], description: match[2], line: index + 1 });
    }
  });
  return starts.map((start, index) => {
    const end = starts[index + 1]?.line ?? Number.MAX_SAFE_INTEGER;
    const hit = diagnostics.find((d) => d.line > start.line && d.line < end);
    return {
      id: start.id,
      description: start.description,
      rejected: hit !== undefined,
      message: hit?.message ?? null,
      code: hit?.code ?? null,
    };
  });
}

function run(): void {
  const configPath = join(root, "tsconfig.json");
  const config = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const original = readFileSync(experimentFile, "utf8");
  const modified = blankDirectives(original);

  const host = ts.createCompilerHost(parsed.options);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    if (resolve(fileName) === experimentFile) {
      return ts.createSourceFile(fileName, modified, languageVersion, true);
    }
    return getSourceFile(fileName, languageVersion, onError, shouldCreate);
  };
  host.readFile = (fileName) => (resolve(fileName) === experimentFile ? modified : readFile(fileName));

  const program = ts.createProgram([experimentFile], parsed.options, host);
  const sourceFile = program.getSourceFile(experimentFile);
  if (sourceFile === undefined) throw new Error("type-experiments.ts is not part of the program");
  const diagnostics = ts.getPreEmitDiagnostics(program, sourceFile).flatMap((diagnostic) => {
    if (diagnostic.file === undefined || diagnostic.start === undefined) return [];
    const line = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1;
    return [
      {
        line,
        code: diagnostic.code,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n").split("\n")[0] ?? "",
      },
    ];
  });

  const outcomes = analyse(modified, diagnostics);
  const rows = outcomes.map(
    (o) =>
      `| ${o.id} | ${o.description} | ${o.rejected ? "rejected" : "NOT rejected"} | ${
        o.rejected ? `TS${String(o.code)}: ${(o.message ?? "").replaceAll("|", "\\|")}` : "-"
      } |`,
  );
  console.log("| Case | Wrong usage | tsc | First diagnostic |");
  console.log("|---|---|---|---|");
  for (const row of rows) console.log(row);
  const rejected = outcomes.filter((o) => o.rejected).length;
  console.log(`\n${String(rejected)} of ${String(outcomes.length)} cases rejected by tsc`);
}

if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) run();
