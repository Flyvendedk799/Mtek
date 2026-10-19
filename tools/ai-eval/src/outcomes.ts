// The outcome taxonomy of spec/ai-and-benchmarks.md section 1, as types. Every layer of every attempt
// is recorded on its own; no layer implies another, and a layer that did not run is `not-run`, never
// a pass.

/** Generation: how a model call ended. `budget-exceeded` is a call that was not made because a budget ran out. */
export type GenerationOutcome = "completed" | "truncated" | "refused" | "cancelled" | "backend-error" | "budget-exceeded";

/** The validation layers, in the order they run. `build` is the spec's "shader/target validation" (`mtek build` emits and validates the shaders). */
export const LAYERS = ["parse", "check", "build", "start", "tests"] as const;
export type LayerName = (typeof LAYERS)[number];

export type LayerOutcome = "pass" | "fail" | "not-run";

/**
 * Why a layer did not run: `skipped` because an earlier layer failed (nothing to learn from running
 * it), `environment` because this machine cannot run it (no GPU, no browser, no Node): the case
 * that must never be read as success.
 */
export type NotRunKind = "skipped" | "environment";

export interface LayerResult {
  outcome: LayerOutcome;
  /** For `fail` and `not-run`: what failed or why it did not run (first line, no machine paths). Null for `pass`. */
  reason: string | null;
  notRun: NotRunKind | null;
}

export const pass = (): LayerResult => ({ outcome: "pass", reason: null, notRun: null });
export const fail = (reason: string): LayerResult => ({ outcome: "fail", reason, notRun: null });
export const notRun = (kind: NotRunKind, reason: string): LayerResult => ({ outcome: "not-run", reason, notRun: kind });

export type Layers = Record<LayerName, LayerResult>;

/**
 * The verdict on one candidate. `pass` needs every layer to pass and every required symbol to exist.
 * `not-run` means nothing failed but something could not run here. `error` means the tool chain failed
 * (not the candidate).
 */
export type Verdict = "pass" | "fail" | "not-run" | "error";

/** How a trial ended. */
/** `unfinished`: the spend cap stopped the trial before it ended by itself; it is neither a success nor a failure of the model (decision 0108). */
export type TrialOutcome = "success" | "failure" | "not-run" | "error" | "unavailable" | "unfinished";

/** Why a trial that is not a success ended. */
export type TrialReason =
  | "max-repairs"
  | "budget-wall-clock"
  | "budget-total-tokens"
  | "generation-truncated"
  | "generation-refused"
  | "generation-cancelled"
  | "generation-error"
  | "validation-not-run"
  | "tool-error"
  | "grammar-unavailable"
  | "budget-spend";
