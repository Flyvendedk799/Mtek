// The two sides of the benchmark comparison (spec/ai-and-benchmarks.md section 6.4, decision 0108).
//
// A trial runs ONE task on ONE side: `mtek` (the Mtek project of the task, validated by the real compiler) or
// `baseline` (the TypeScript + three.js project of the same task, validated by the TypeScript compiler, the
// bundler and the task's own fixtures in a browser). Both sides go through the same bounded generate, validate,
// repair loop, the same edit format and the same budgets; they differ only in what is specific to the
// technology: the project's files, the documentation the model is given (whose tokens are counted), the wording
// of the system prompt, and the validator. A side is chosen per trial and is part of the recorded condition.
import type { CommandRunner } from "./commands.ts";
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

export function sideByName(name: string): Side {
  if (name === "mtek") return mtekSide;
  if (name === "baseline") return baselineSide;
  throw new Error(`unknown side '${name}' (mtek | baseline)`);
}

