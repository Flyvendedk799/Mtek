/**
 * The loop budget of untrusted previews (`spec/ai-and-benchmarks.md` section 5, decision 0075).
 *
 * A `--mode preview` build starts every loop iteration of generated CPU code with
 * `if (--budget.n < 0) { rt.budgetExceeded(spanId); }`, where `budget` is `ctx.budget`, the counter the world
 * resets at the start of every frame (and before `init`) to `manifest.preview.loopBudget`. Mtek has no
 * recursion and no exceptions a program could catch, so a loop iteration is the only way CPU code
 * runs for long, and counting iterations bounds a frame.
 *
 * `while` (decision 0144) is bounded in every build, not only previews: one `while` statement runs at most
 * {@link WHILE_ITERATION_CAP} iterations each time it is reached, and the next one calls `rt.whileLimit(spanId)`,
 * which fails the frame like the budget (`E8080`, naming the `while`). The throw unwinds the handler, the frame and the
 * tick; the application reports `E8080` at the loop (`spanId`), stops the scene and shows the overlay.
 */

/** `ctx.budget`: iterations left in this frame. A plain object so generated code can read it into a local once. */
export interface LoopBudget {
  n: number;
}

/** Thrown by {@link budgetExceeded}; the frame loop and the mount turn it into `E8080`. */
export class ExecutionBudgetExceeded extends Error {
  /** The manifest span of the loop that spent the last iteration. */
  readonly spanId: number;
  /** True when a `while` ran past its own cap ({@link whileLimit}), not past the preview budget. */
  readonly whileCap: boolean;

  constructor(spanId: number, whileCap = false) {
    super(whileCap ? "while iteration cap exceeded" : "execution budget exceeded");
    this.name = "ExecutionBudgetExceeded";
    this.spanId = spanId;
    this.whileCap = whileCap;
  }
}

/** Iterations one `while` statement may run each time it is reached (`WHILE_ITERATION_CAP` of the compiler). */
export const WHILE_ITERATION_CAP = 1_000_000;

/** `rt.whileLimit(spanId)`: a `while` reached iteration {@link WHILE_ITERATION_CAP} + 1. Never returns. */
export function whileLimit(spanId: number): never {
  throw new ExecutionBudgetExceeded(spanId, true);
}

/** `rt.budgetExceeded(spanId)`, called by the check at the head of a loop body. Never returns. */
export function budgetExceeded(spanId: number): never {
  throw new ExecutionBudgetExceeded(spanId);
}
