// The prompts of the loop. Everything the model sees is built here from the task, the compiler's own
// context and the compiler's own diagnostics; nothing is hand-tuned per task. `PROMPT_VERSION` is part
// of the recorded condition: a change to any wording below bumps it and creates a new condition.
//
// Each builder returns the text and the size in characters of each section, so the recorder can
// attribute prompt size to instructions, context, project files, diagnostics, test feedback and the
// rest (spec 6.4). Sizes are characters, not tokens: token attribution belongs to the analysis, which
// has the provider's own counts per call.
import { renderDiagnostics } from "./diagnostics.ts";
import type { EditPolicy, EditRejection } from "./editor.ts";
import type { BuiltContext } from "./context-builder.ts";
import { LAYERS, type LayerResult } from "./outcomes.ts";
import type { TaskSpec } from "./task.ts";
import type { ValidationResult } from "./validator.ts";

export const PROMPT_VERSION = "1";

/** How much of the task's tests the model sees after a failure. */
export type TestFeedback = "messages" | "status-only";

export interface PromptText {
  text: string;
  /** Characters per section name. */
  sections: Record<string, number>;
}

function assemble(parts: readonly (readonly [string, string])[]): PromptText {
  const sections: Record<string, number> = {};
  for (const [name, text] of parts) sections[name] = (sections[name] ?? 0) + text.length;
  return { text: parts.map(([, text]) => text).join(""), sections };
}

/** The system prompt: the role, the edit format and the rules. */
export function systemPrompt(task: TaskSpec, policy: EditPolicy): string {
  const wholeRule =
    policy.wholeFile === "any"
      ? "To write or replace a complete file, use a WHOLE block."
      : "Existing files change only with SEARCH/REPLACE blocks. A WHOLE block may only create a new file that does not exist yet.";
  return [
    "You write and repair programs in Mtek, a small statically typed language for GPU scenes. Your work is judged by running the project's real compiler and its tests; text that merely looks right counts for nothing.",
    "",
    "Reply with edit blocks. Text outside the blocks is ignored.",
    "",
    "<<<FILE src/main.mtek",
    "<<<SEARCH",
    "        speed = -speed;",
    "===",
    "        speed = -speed * 1.5;",
    ">>>REPLACE",
    "",
    "<<<FILE src/extra.mtek",
    "<<<WHOLE",
    "...the complete file...",
    ">>>END",
    "",
    "Rules:",
    "- Marker lines start in column 0. One FILE line may be followed by several SEARCH blocks.",
    "- The SEARCH text must match the current file exactly once, character for character, indentation included. A SEARCH that matches nothing or several places is rejected and you will be asked again.",
    `- ${wholeRule}`,
    `- Only ${policy.writableDescription} can be changed.`,
    "- The project's tests are hidden and run after your edit. Do not delete, rename or hollow out a declaration to make an error go away: the declarations the task names must still exist and still do their job.",
    "- Use only what the compiler context lists as supported. Features listed under notSupported do not exist in this compiler.",
    "- When a diagnostic carries a suggestedEdit, it has been validated by the compiler; otherwise do not guess beyond what the message says.",
    "",
    task.mode === "cold"
      ? "The project is a stub. Write the program."
      : "The project exists. Change it as the task says and leave everything else as it is.",
  ].join("\n");
}

/** The first user message: the task, the compiler context and the starter's files. */
export function initialPrompt(task: TaskSpec, context: BuiltContext, files: readonly { path: string; content: string }[]): PromptText {
  const names = task.requiredSymbols.join(", ");
  const parts: [string, string][] = [
    ["task", `# Task: ${task.title}\n\n${task.prompt}\n\n`],
    ["requiredSymbols", `These declarations must exist when you are done: ${names}\n\n`],
    ["context", `# Compiler context (the output of \`mtek context\`)\n\n\`\`\`json\n${context.text.replace(/\n$/, "")}\n\`\`\`\n\n`],
    ["project", "# Project files\n\n"],
    ...files.map((file): [string, string] => ["project", `## ${file.path}\n\n\`\`\`\n${file.content.replace(/\n$/, "")}\n\`\`\`\n\n`]),
    ["instructions", "Reply with edit blocks."],
  ];
  return assemble(parts);
}

function layerLine(name: string, layer: LayerResult): string {
  const notRun = layer.outcome === "not-run" ? ` (${layer.notRun ?? "not run"})` : "";
  return `- ${name}: ${layer.outcome}${notRun}${layer.reason === null ? "" : ` - ${layer.reason}`}`;
}

export interface RepairOptions {
  round: number;
  maxRepairs: number;
  testFeedback: TestFeedback;
  /** The candidate's file content, for the localized source lines and the current files. */
  read: (path: string) => string | undefined;
  /** Files the model has changed so far, shown in full so the next SEARCH can match. */
  changedFiles: readonly string[];
}

function currentFiles(options: RepairOptions, paths: readonly string[]): [string, string][] {
  const parts: [string, string][] = [];
  for (const path of paths) {
    const content = options.read(path);
    if (content !== undefined) parts.push(["current-files", `## ${path}\n\n\`\`\`\n${content.replace(/\n$/, "")}\n\`\`\`\n\n`]);
  }
  return parts.length === 0 ? [] : [["current-files", "# Current content of the files you have changed\n\n"], ...parts];
}

/** The message after a reply whose edits were rejected: what was wrong, and the files as they are now. */
export function rejectionPrompt(rejections: readonly EditRejection[], options: RepairOptions & { mentioned: readonly string[] }): PromptText {
  const lines = rejections.map((r) => {
    const where = r.index === null ? "the reply" : `edit ${String(r.index)}`;
    return `- ${where}${r.file === null ? "" : ` (${r.file})`}: [${r.code}] ${r.message}`;
  });
  const paths = [...new Set([...options.changedFiles, ...options.mentioned])];
  return assemble([
    ["edit-errors", `Your reply was rejected and nothing was applied (repair ${String(options.round)} of ${String(options.maxRepairs)}):\n\n${lines.join("\n")}\n\n`],
    ...currentFiles(options, paths),
    ["instructions", "Reply again with edit blocks that fix this."],
  ]);
}

/** The message after a candidate that was applied but does not yet satisfy the task. */
export function validationPrompt(result: ValidationResult, options: RepairOptions): PromptText {
  // With status-only feedback the tests layer shows no reason: it names the failing expectation.
  const layerLines = LAYERS.map((name) => {
    const layer = result.layers[name];
    return layerLine(name, name === "tests" && options.testFeedback === "status-only" && layer.outcome === "fail" ? { ...layer, reason: null } : layer);
  });
  const symbols = result.requiredSymbols;
  const symbolLine = `- required declarations: ${symbols.outcome}${symbols.reason === null ? "" : ` - ${symbols.reason}`}`;
  const parts: [string, string][] = [
    [
      "layers",
      `Your edits were applied (repair ${String(options.round)} of ${String(options.maxRepairs)}), but the project is not yet right.\n\n# Result of each check\n\n${[...layerLines, symbolLine].join("\n")}\n\n`,
    ],
  ];
  if (result.diagnostics.length > 0) {
    parts.push(["diagnostics", `# Diagnostics\n\n${renderDiagnostics(result.diagnostics, options.read)}\n\n`]);
  }
  if (symbols.missing.length > 0) {
    parts.push([
      "required-symbols",
      `# Missing declarations\n\nThe task requires these declarations and they no longer exist: ${symbols.missing.join(", ")}. Restore them; removing a feature is never a fix.\n\n`,
    ]);
  }
  const failed = result.testReport?.fixtures.filter((f) => f.status === "fail") ?? [];
  if (failed.length > 0) {
    const lines = failed.map((fixture) => {
      const f = fixture.failure;
      if (f === null) return `- ${fixture.name}: failed`;
      if (options.testFeedback === "status-only") return `- ${fixture.name}: failed (${f.kind})`;
      const where = f.step === null ? "" : ` at step ${String(f.step)}`;
      const details = f.details.length === 0 ? "" : `\n${f.details.map((d) => `    ${d}`).join("\n")}`;
      return `- ${fixture.name}: ${f.kind}${where}: ${f.message}${details}`;
    });
    parts.push(["test-feedback", `# Failed tests\n\n${lines.join("\n")}\n\n`]);
  }
  parts.push(...currentFiles(options, options.changedFiles));
  parts.push(["instructions", "Reply with edit blocks that fix this."]);
  return assemble(parts);
}
