// The RepairLoop (spec/ai-and-benchmarks.md section 4.1, decision 0077): one trial of one task under
// one condition. Generate, apply the edit to a scratch copy, validate every layer, and on failure send
// localized feedback and ask again, until the candidate passes everything, `maxRepairs` repairs are
// used, or a budget runs out. Everything is recorded; nothing is dropped.
//
// Rules this loop keeps (each has a unit test with the replay client):
//   - success is every layer passing AND the required declarations existing; syntax validity, a clean
//     build or a mounted program alone is never success;
//   - a truncated, refused, cancelled or failed generation ends the trial as a failure; it is never
//     silently repaired or retried;
//   - an edit that does not apply under the exact-match rule is rejected, recorded, and counts as a
//     repair round;
//   - a layer that could not run on this machine (no GPU) ends the trial `not-run`, never `success`;
//   - a constrained trial never runs unconstrained: without the capability it ends `unavailable`.
import { join } from "node:path";
import { sha256Hex, canonicalJson, type Json } from "./canonical.ts";
import { BudgetTracker, type BudgetStop } from "./budget.ts";
import { ContextBuilder, type BuiltContext } from "./context-builder.ts";
import type { Clock } from "./clock.ts";
import type { CommandRunner } from "./commands.ts";
import { applyEdits, defaultEditPolicy, parseModuleReply, parseReply, type EditPolicy, type ParsedReply } from "./editor.ts";
import { ConfigError, ToolError } from "./errors.ts";
import { defaultGrammarCapability, GRAMMAR_UNAVAILABLE_MESSAGE, type GrammarCapability, type TrialKind } from "./grammar.ts";
import {
  requestHash,
  ZERO_USAGE,
  type ChatMessage,
  type GenerateRequest,
  type GenerateResult,
  type ModelClient,
  type Usage,
} from "./model-client.ts";
import type { GenerationOutcome, TrialOutcome, TrialReason, Verdict } from "./outcomes.ts";
import { initialPrompt, PROMPT_VERSION, rejectionPrompt, systemPrompt, validationPrompt, type PromptText, type TestFeedback } from "./prompts.ts";
import type { Condition, Recorder, TrialEndRecord } from "./recorder.ts";
import { projectEntry } from "./context-builder.ts";
import type { TaskSpec } from "./task.ts";
import { Validator, type ValidationResult } from "./validator.ts";
import { Workspace } from "./workspace.ts";

export const DEFAULT_CONTEXT_MAX_BYTES = 24_000;

interface Started {
  iso: string;
  ms: number;
}

export interface TrialConfig {
  task: TaskSpec;
  client: ModelClient;
  trialKind: TrialKind;
  /** The index among the repetitions of this condition. */
  trialIndex: number;
  /** `null` sends no sampling parameter (and is recorded as such). */
  temperature: number | null;
  stop?: readonly string[];
  seed?: number;
  /** Default: the task's `max_repairs`. */
  maxRepairs?: number;
  /** Input plus output tokens over the whole trial; default none. */
  maxTotalTokens?: number | null;
  contextMaxBytes?: number;
  testFeedback?: TestFeedback;
  policy?: EditPolicy;
}

export interface LoopDeps {
  runner: CommandRunner;
  recorder: Recorder;
  clock: Clock;
  /** Where scratch copies of the project are made; removed after the trial unless `keepScratch`. */
  scratchRoot: string;
  /** The run directory. When given, the final candidate of every trial is preserved below it. */
  runDir?: string | null;
  grammar?: GrammarCapability;
  keepScratch?: boolean;
  /** Aborts the trial's model calls (a Ctrl-C of the CLI). */
  signal?: AbortSignal;
  validator?: Validator;
}

export interface TrialResult {
  trialId: string;
  outcome: TrialOutcome;
  reason: TrialReason | null;
  message: string | null;
  calls: number;
  repairsUsed: number;
  firstAttempt: ValidationResult | null;
  final: ValidationResult | null;
  usage: Usage;
}

export function trialIdOf(task: TaskSpec, kind: TrialKind, index: number): string {
  return `${task.id}--${kind}--${String(index).padStart(2, "0")}`;
}

/** The condition of a trial and its id: the hash of everything that identifies it (spec 4.2). */
export function conditionOf(config: TrialConfig, replyFormat: "edit-blocks" | "module"): { condition: Condition; id: string } {
  const task = config.task;
  const condition: Condition = {
    provider: config.client.provider,
    model: config.client.model,
    temperature: config.temperature,
    maxOutputTokens: task.budgets.maxOutputTokens,
    stop: config.stop === undefined ? null : [...config.stop],
    seed: config.seed ?? null,
    promptVersion: PROMPT_VERSION,
    testFeedback: config.testFeedback ?? "messages",
    contextMaxBytes: config.contextMaxBytes ?? DEFAULT_CONTEXT_MAX_BYTES,
    maxRepairs: config.maxRepairs ?? task.budgets.maxRepairs,
    maxWallSeconds: task.budgets.maxWallSeconds,
    maxTotalTokens: config.maxTotalTokens ?? null,
    trialKind: config.trialKind,
    replyFormat,
  };
  return { condition, id: sha256Hex(canonicalJson(condition as unknown as Json)) };
}

function generationOf(result: GenerateResult): GenerationOutcome {
  switch (result.finish) {
    case "stop":
      return "completed";
    case "length":
      return "truncated";
    case "refusal":
      return "refused";
    case "cancelled":
      return "cancelled";
    case "error":
      return "backend-error";
  }
}

const GENERATION_REASONS: Record<Exclude<GenerationOutcome, "completed" | "budget-exceeded">, TrialReason> = {
  truncated: "generation-truncated",
  refused: "generation-refused",
  cancelled: "generation-cancelled",
  "backend-error": "generation-error",
};

export class RepairLoop {
  private readonly deps: LoopDeps;
  private readonly validator: Validator;
  private readonly contextBuilder: ContextBuilder;

  constructor(deps: LoopDeps) {
    this.deps = deps;
    this.validator = deps.validator ?? new Validator(deps.runner, { clock: deps.clock });
    this.contextBuilder = new ContextBuilder(deps.runner);
  }

  async run(config: TrialConfig): Promise<TrialResult> {
    const { task, client, trialKind } = config;
    const { recorder, clock } = this.deps;
    if (config.seed !== undefined && !client.capabilities.seed) {
      throw new ConfigError(`the client '${client.provider}' cannot apply a seed; run without one (a seed that is recorded but not applied would be a false record)`);
    }
    const trialId = trialIdOf(task, trialKind, config.trialIndex);
    const policy = config.policy ?? defaultEditPolicy(task.mode);
    const started: Started = { iso: clock.iso(), ms: clock.nowMs() };

    // Constrained trials: ask for the capability first, and never fall back to unconstrained.
    let grammar: { grammar: string; backend: string; replyFormat: "edit-blocks" | "module" } | null = null;
    let unavailable: string | null = null;
    if (trialKind === "constrained") {
      const check = await (this.deps.grammar ?? defaultGrammarCapability).check(client);
      if (!check.available) unavailable = check.reason;
      else if (!client.capabilities.grammar) unavailable = `the client '${client.provider}' does not forward grammars`;
      else grammar = { grammar: check.grammar, backend: check.backend, replyFormat: check.replyFormat };
    }
    const replyFormat = grammar?.replyFormat ?? "edit-blocks";
    const { condition, id: conditionId } = conditionOf(config, replyFormat);

    if (unavailable !== null) {
      recorder.record({
        type: "trial-start",
        trialId,
        taskId: task.id,
        category: task.category,
        mode: task.mode,
        trialKind,
        trial: config.trialIndex,
        condition,
        conditionId,
        grammar: null,
        compilerVersion: null,
        contextSha256: null,
        contextBytes: null,
        contextTruncated: null,
        startedAt: started.iso,
      });
      const message = `${GRAMMAR_UNAVAILABLE_MESSAGE}: ${unavailable}`;
      return this.finish(trialId, null, started, {
        outcome: "unavailable",
        reason: "grammar-unavailable",
        message,
        calls: 0,
        repairsUsed: 0,
        firstAttempt: null,
        final: null,
        usage: ZERO_USAGE,
      });
    }

    const workspace = Workspace.create(task, this.deps.scratchRoot, trialId);
    try {
      return await this.trial(config, trialId, policy, condition, conditionId, replyFormat, grammar, workspace, started);
    } finally {
      if (this.deps.keepScratch !== true) workspace.dispose();
    }
  }

  private async trial(
    config: TrialConfig,
    trialId: string,
    policy: EditPolicy,
    condition: Condition,
    conditionId: string,
    replyFormat: "edit-blocks" | "module",
    grammar: { grammar: string; backend: string; replyFormat: "edit-blocks" | "module" } | null,
    workspace: Workspace,
    started: Started,
  ): Promise<TrialResult> {
    const { task, client } = config;
    const { recorder, clock } = this.deps;
    const entry = projectEntry(workspace.projectDir);

    let context: BuiltContext | null = null;
    let contextError: string | null = null;
    try {
      context = await this.contextBuilder.build({
        projectDir: workspace.projectDir,
        symbols: task.mode === "edit" ? task.requiredSymbols : [],
        maxBytes: condition.contextMaxBytes,
      });
    } catch (error) {
      if (!(error instanceof ToolError)) throw error;
      contextError = error.message;
    }
    recorder.record({
      type: "trial-start",
      trialId,
      taskId: task.id,
      category: task.category,
      mode: task.mode,
      trialKind: config.trialKind,
      trial: config.trialIndex,
      condition,
      conditionId,
      grammar: grammar === null ? null : { backend: grammar.backend, replyFormat: grammar.replyFormat },
      compilerVersion: context?.compilerVersion ?? null,
      contextSha256: context?.sha256 ?? null,
      contextBytes: context?.bytes ?? null,
      contextTruncated: context?.truncated ?? null,
      startedAt: started.iso,
    });
    if (context === null) {
      return this.finish(trialId, workspace, started, {
        outcome: "error",
        reason: "tool-error",
        message: contextError ?? "mtek context failed",
        calls: 0,
        repairsUsed: 0,
        firstAttempt: null,
        final: null,
        usage: ZERO_USAGE,
      });
    }

    const budget = new BudgetTracker(
      {
        maxRepairs: condition.maxRepairs,
        maxOutputTokensPerCall: condition.maxOutputTokens,
        maxWallMs: condition.maxWallSeconds * 1000,
        maxTotalTokens: condition.maxTotalTokens,
      },
      clock,
    );
    budget.start();

    const system = systemPrompt(task, policy);
    const files = workspace.sourceFiles().map((path) => ({ path, content: workspace.read(path) ?? "" }));
    let prompt: PromptText = initialPrompt(task, context, files);
    const messages: ChatMessage[] = [{ role: "user", content: prompt.text }];
    const changed = new Set<string>();
    let firstAttempt: ValidationResult | null = null;
    let final: ValidationResult | null = null;
    let repairsUsed = 0;

    for (let round = 0; round <= condition.maxRepairs; round += 1) {
      const result = (partial: Omit<TrialResult, "trialId" | "calls" | "repairsUsed" | "firstAttempt" | "final" | "usage">): Promise<TrialResult> =>
        this.finish(trialId, workspace, started, {
          ...partial,
          calls: budget.callCount,
          repairsUsed,
          firstAttempt,
          final,
          usage: budget.usage,
        });

      // 1. Budgets are checked before every call.
      const stop = budget.exhausted();
      if (stop !== null) {
        this.recordBudgetStop(trialId, round, stop);
        return result({
          outcome: "failure",
          reason: stop === "wall-clock" ? "budget-wall-clock" : "budget-total-tokens",
          message: stop === "wall-clock" ? `the wall-clock budget of ${String(condition.maxWallSeconds)} s is used up` : `the token budget of ${String(condition.maxTotalTokens)} is used up`,
        });
      }

      // 2. Generate.
      const request: GenerateRequest = {
        system,
        messages: [...messages],
        maxOutputTokens: budget.limits.maxOutputTokensPerCall,
        temperature: config.temperature,
        ...(config.stop === undefined ? {} : { stop: [...config.stop] }),
        ...(config.seed === undefined ? {} : { seed: config.seed }),
        ...(grammar === null ? {} : { grammar: grammar.grammar }),
      };
      const callStarted = clock.nowMs();
      const callIso = clock.iso();
      const timeout = AbortSignal.timeout(Math.max(1, Math.ceil(budget.remainingMs())));
      const signal = this.deps.signal === undefined ? timeout : AbortSignal.any([timeout, this.deps.signal]);
      let generated: GenerateResult;
      try {
        generated = await client.generate(request, { signal });
      } catch (error) {
        generated = {
          text: "",
          usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
          finish: "error",
          error: error instanceof Error ? error.message : String(error),
        };
      }
      const generation = generationOf(generated);
      budget.record(generated.usage);
      recorder.record({
        type: "model-call",
        trialId,
        round,
        promptHash: requestHash(request),
        request: {
          system,
          messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
          maxOutputTokens: request.maxOutputTokens,
          temperature: request.temperature,
          stop: request.stop === undefined ? null : [...request.stop],
          seed: request.seed ?? null,
          grammarSha256: request.grammar === undefined ? null : sha256Hex(request.grammar),
        },
        promptSections: { system: system.length, ...prompt.sections },
        response: { text: generated.text },
        usage: generated.usage,
        finish: generated.finish,
        generation,
        error: generated.error ?? null,
        budget: null,
        startedAt: callIso,
        durationMs: Math.max(0, Math.round(clock.nowMs() - callStarted)),
      });
      if (budget.tokenBudgetUnenforceable()) {
        return result({
          outcome: "error",
          reason: "tool-error",
          message: "a token budget is set but the provider did not report token usage, so the budget cannot be enforced",
        });
      }

      // 3. Only a completed generation is used. Truncated, refused, cancelled and failed generations are failures.
      if (generation !== "completed" && generation !== "budget-exceeded") {
        const walled = generation === "cancelled" && budget.remainingMs() <= 0;
        return result({
          outcome: "failure",
          reason: walled ? "budget-wall-clock" : GENERATION_REASONS[generation],
          message: generated.error ?? `generation ${generation}`,
        });
      }

      // 4. Apply the edit to the scratch copy under the exact-match rule.
      const parsed: ParsedReply = replyFormat === "module" ? parseModuleReply(generated.text, entry) : parseReply(generated.text);
      const applied = applyEdits(parsed, (path) => workspace.read(path), policy);
      if (applied.rejected.length > 0) {
        recorder.record({
          type: "edit",
          trialId,
          round,
          format: parsed.format,
          outcome: "rejected",
          applied: [],
          rejected: applied.rejected,
          projectHash: workspace.sourcesHash(),
        });
      } else {
        for (const [path, content] of applied.files) {
          workspace.write(path, content);
          changed.add(path);
        }
        recorder.record({
          type: "edit",
          trialId,
          round,
          format: parsed.format,
          outcome: "applied",
          applied: applied.applied,
          rejected: [],
          projectHash: workspace.sourcesHash(),
        });
      }

      // 5. Validate every layer (only a candidate that changed).
      let validation: ValidationResult | null = null;
      if (applied.rejected.length === 0) {
        const validationStarted = clock.iso();
        validation = await this.validator.validate({
          projectDir: workspace.projectDir,
          outDir: join(workspace.root, "out"),
          requiredSymbols: task.requiredSymbols,
        });
        firstAttempt ??= validation;
        final = validation;
        recorder.record({
          type: "validation",
          trialId,
          round,
          projectHash: workspace.sourcesHash(),
          verdict: validation.verdict,
          layers: validation.layers,
          requiredSymbols: validation.requiredSymbols,
          diagnostics: validation.diagnostics,
          testReport: validation.testReport,
          compilerVersion: validation.compilerVersion,
          toolError: validation.toolError,
          commands: validation.commands,
          startedAt: validationStarted,
          durationMs: validation.durationMs,
        });
        const verdict: Verdict = validation.verdict;
        if (verdict === "pass") return result({ outcome: "success", reason: null, message: null });
        if (verdict === "error") return result({ outcome: "error", reason: "tool-error", message: validation.toolError });
        if (verdict === "not-run") {
          const why = (Object.values(validation.layers).find((l) => l.outcome === "not-run")?.reason ?? validation.requiredSymbols.reason) ?? "a layer could not run";
          return result({ outcome: "not-run", reason: "validation-not-run", message: `not a success: ${why}` });
        }
      }

      // 6. The candidate failed (or the edit was rejected): one repair round, if any is left.
      if (round === condition.maxRepairs) {
        return result({
          outcome: "failure",
          reason: "max-repairs",
          message: `still failing after ${String(condition.maxRepairs)} repairs`,
        });
      }
      repairsUsed += 1;
      const common = {
        round: repairsUsed,
        maxRepairs: condition.maxRepairs,
        read: (path: string) => workspace.read(path),
        changedFiles: [...changed].sort(),
      };
      prompt =
        validation === null
          ? rejectionPrompt(applied.rejected, { ...common, testFeedback: condition.testFeedback as TestFeedback, mentioned: applied.rejected.flatMap((r) => (r.file === null ? [] : [r.file])) })
          : validationPrompt(validation, { ...common, testFeedback: condition.testFeedback as TestFeedback });
      messages.push({ role: "assistant", content: generated.text }, { role: "user", content: prompt.text });
    }
    throw new Error("unreachable: the last round returns");
  }

  private recordBudgetStop(trialId: string, round: number, stop: BudgetStop): void {
    this.deps.recorder.record({
      type: "model-call",
      trialId,
      round,
      promptHash: null,
      request: null,
      promptSections: null,
      response: null,
      usage: null,
      finish: null,
      generation: "budget-exceeded",
      error: null,
      budget: stop,
      startedAt: this.deps.clock.iso(),
      durationMs: 0,
    });
  }

  private finish(
    trialId: string,
    workspace: Workspace | null,
    started: Started,
    result: Omit<TrialResult, "trialId">,
  ): Promise<TrialResult> {
    const { recorder, clock, runDir } = this.deps;
    let finalProject: string | null = null;
    if (workspace !== null && runDir !== undefined && runDir !== null) {
      finalProject = `trials/${trialId}/project`;
      workspace.preserveTo(`${runDir}/${finalProject}`);
    }
    const summarize = (v: ValidationResult | null): TrialEndRecord["final"] =>
      v === null ? null : { verdict: v.verdict, layers: v.layers, requiredSymbols: v.requiredSymbols };
    recorder.record({
      type: "trial-end",
      trialId,
      outcome: result.outcome,
      reason: result.reason,
      message: result.message,
      calls: result.calls,
      repairsUsed: result.repairsUsed,
      firstAttempt: summarize(result.firstAttempt),
      final: summarize(result.final),
      totals: {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cachedInputTokens: result.usage.cachedInputTokens ?? null,
      },
      durationMs: Math.max(0, Math.round(clock.nowMs() - started.ms)),
      finalProject,
    });
    return Promise.resolve({ trialId, ...result });
  }
}

