// The two sides of the benchmark comparison (spec/ai-and-benchmarks.md section 6.4, decision 0108).
//
// A trial runs ONE task on ONE side: `mtek` (the Mtek project of the task, validated by the real compiler) or
// `baseline` (the TypeScript + three.js project of the same task, validated by the TypeScript compiler, the
// bundler and the task's own fixtures in a browser). Both sides go through the same bounded generate, validate,
// repair loop, the same edit format and the same budgets; they differ only in what is specific to the
// technology: the project's files, the documentation the model is given (whose tokens are counted), the wording
// of the system prompt, and the validator. A side is chosen per trial and is part of the recorded condition.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256Hex } from "./canonical.ts";
import { repoRoot, type CommandRunner } from "./commands.ts";
import type { BuiltContext } from "./context-builder.ts";
import { ContextBuilder } from "./context-builder.ts";
import type { Clock } from "./clock.ts";
import { baselineEditPolicy, defaultEditPolicy, type EditPolicy } from "./editor.ts";
import { initialPrompt, systemPrompt, BASELINE_PROMPT_VERSION, PROMPT_VERSION, baselineInitialPrompt, baselineSystemPrompt, type PromptText } from "./prompts.ts";
import type { TaskSpec } from "./task.ts";
import { Validator, type ValidateInput, type ValidationResult } from "./validator.ts";
import { Workspace, type WorkspaceKind } from "./workspace.ts";
import { baselineDocs, baselineRequiredNames, baselineScratchRoot, BaselineValidator } from "./baseline-side.ts";

export type SideKind = WorkspaceKind;

/** Validates one candidate: every layer on its own (spec 1). */
export interface CandidateValidator {
  validate(input: ValidateInput): Promise<ValidationResult>;
}

export interface SideDeps {
  /** Runs `mtek`. */
  runner: CommandRunner;
  clock: Clock;
  /** Runs `node` (the baseline's candidate runner). Default: the real one. */
  programRunner?: CommandRunner;
}

export interface Side {
  readonly kind: SideKind;
  /** The name of the condition's side in trial ids and reports: `mtek`, `baseline`, or `mtek-guide` for Mtek with a document added. */
  readonly label: string;
  /**
   * What the model is given to learn the technology from, as part of the recorded condition: `context-export` (the compiler's
   * context and nothing else), `context-export+docs/language-guide.md:<hash>` (a document added), `baseline-reference:<hash>`.
   */
  documentationId(): string;
  readonly promptVersion: string;
  /** False for a side that has no grammar-constrained mode (the baseline: spec 6.4 lists constrained for Mtek only). */
  readonly supportsConstrained: boolean;
  createWorkspace(task: TaskSpec, scratchRoot: string, name: string): Workspace;
  policy(task: TaskSpec): EditPolicy;
  /** The names a candidate must still declare (the Mtek compiler's names; for the baseline, the three.js object and material names). */
  requiredSymbols(task: TaskSpec): string[];
  /** The documentation the model gets, built once per trial; its size is the documentation overhead of the side. */
  buildContext(task: TaskSpec, workspace: Workspace, deps: { runner: CommandRunner; maxBytes: number }): Promise<BuiltContext>;
  systemPrompt(task: TaskSpec, policy: EditPolicy): string;
  initialPrompt(task: TaskSpec, context: BuiltContext, files: readonly { path: string; content: string }[]): PromptText;
  createValidator(task: TaskSpec, deps: SideDeps): CandidateValidator;
}

/** The Mtek side: exactly what the harness did before there was a baseline (decision 0077). */
export const mtekSide: Side = {
  kind: "mtek",
  label: "mtek",
  documentationId: () => "context-export",
  promptVersion: PROMPT_VERSION,
  supportsConstrained: true,
  createWorkspace: (task, scratchRoot, name) => Workspace.create(task, scratchRoot, name),
  policy: (task) => defaultEditPolicy(task.mode),
  requiredSymbols: (task) => [...task.requiredSymbols],
  buildContext: (task, workspace, deps) =>
    new ContextBuilder(deps.runner).build({
      projectDir: workspace.projectDir,
      symbols: task.mode === "edit" ? task.requiredSymbols : [],
      maxBytes: deps.maxBytes,
    }),
  systemPrompt: (task, policy) => systemPrompt(task, policy),
  initialPrompt: (task, context, files) => initialPrompt(task, context, files),
  createValidator: (_task, deps) => new Validator(deps.runner, { clock: deps.clock }),
};

/** The baseline side: TypeScript + three.js r186 with the support module, version-correct documentation counted like the context export. */
export const baselineSide: Side = {
  kind: "baseline",
  label: "baseline",
  documentationId: () => `baseline-reference:${baselineDocs(Number.MAX_SAFE_INTEGER).sha256.slice(0, 12)}`,
  promptVersion: BASELINE_PROMPT_VERSION,
  supportsConstrained: false,
  // The scratch root is shared by every process that runs a baseline trial on this checkout, so the directory name carries the process and a nonce.
  createWorkspace: (task, _scratchRoot, name) => Workspace.create(task, baselineScratchRoot(), `${name}-${String(process.pid)}-${Math.random().toString(36).slice(2, 8)}`, { kind: "baseline" }),
  policy: (task) => baselineEditPolicy(task.mode),
  requiredSymbols: (task) => baselineRequiredNames(task),
  buildContext: (_task, _workspace, deps) => Promise.resolve(baselineDocs(deps.maxBytes)),
  systemPrompt: (task, policy) => baselineSystemPrompt(task, policy),
  initialPrompt: (task, context, files) => baselineInitialPrompt(task, context, files, baselineRequiredNames(task)),
  createValidator: (task, deps) => new BaselineValidator(task, { clock: deps.clock, ...(deps.programRunner === undefined ? {} : { runner: deps.programRunner }) }),
};

/** The documents of `docs/` that a Mtek condition may add to the context (the files a user of the language reads). */
export const MTEK_EXTRA_DOCS = ["docs/language-guide.md", "docs/getting-started.md", "docs/language-reference.md"] as const;

/**
 * The Mtek side with documents added after the compiler's context, as a second condition (decision 0108): the context export
 * alone gives a cold-start task no schema and no example, so "what does Mtek cost when its own guide is in the prompt" is a
 * different question from "what does the agent contract alone cost". The documents are repository files, read as checked in
 * (LF line endings), counted in the documentation bytes and hashed into the condition.
 */
export function mtekSideWithDocs(paths: readonly string[], root: string = repoRoot()): Side {
  if (paths.length === 0) return mtekSide;
  const label = `mtek-${paths.map((path) => (path.split("/").pop() ?? path).replace(/\.md$/, "").replace(/^language-/, "")).join("+")}`;
  const documents = paths.map((path) => {
    if (!(MTEK_EXTRA_DOCS as readonly string[]).includes(path)) throw new Error(`'${path}' is not a document that can be added (${MTEK_EXTRA_DOCS.join(", ")})`);
    const text = readFileSync(join(root, ...path.split("/")), "utf8").replaceAll("\r\n", "\n");
    return { name: `Document: ${path}`, text, path };
  });
  const hash = sha256Hex(documents.map((d) => d.text).join("\u0000")).slice(0, 12);
  return {
    ...mtekSide,
    label,
    documentationId: () => `context-export+${paths.join("+")}:${hash}`,
    buildContext: async (task, workspace, deps) => {
      const context = await mtekSide.buildContext(task, workspace, deps);
      const extra = documents.reduce((sum, d) => sum + Buffer.byteLength(d.text, "utf8"), 0);
      return {
        ...context,
        bytes: context.bytes + extra,
        sha256: sha256Hex(`${context.sha256}${hash}`),
        appendix: documents.map(({ name, text }) => ({ name, text })),
      };
    },
  };
}

/** `mtek`, `baseline`, or `mtek-guide`, `mtek-getting-started`, `mtek-reference`: Mtek with that document of `docs/` added to the context. */
export function sideByName(name: string, root: string = repoRoot()): Side {
  if (name === "mtek") return mtekSide;
  if (name === "baseline") return baselineSide;
  const extra = MTEK_EXTRA_DOCS.find((path) => `mtek-${(path.split("/").pop() ?? path).replace(/\.md$/, "").replace(/^language-/, "")}` === name);
  if (extra !== undefined) return mtekSideWithDocs([extra], root);
  throw new Error(`unknown side '${name}' (mtek | baseline | mtek-guide | mtek-getting-started | mtek-reference)`);
}

