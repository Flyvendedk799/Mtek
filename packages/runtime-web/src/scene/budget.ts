/**
 * The loop budget of untrusted previews (`spec/ai-and-benchmarks.md` section 5, decision 0075).
 *
 * A `--mode preview` build starts every loop iteration of generated CPU code with
 * `if (--budget.n < 0) { rt.budgetExceeded(spanId); }`, where `budget` is `ctx.budget`, the counter the world
 * resets at the start of every frame (and before `init`) to `manifest.preview.loopBudget`. Mtek has no
 * `while`, no recursion and no exceptions a program could catch, so a loop iteration is the only way CPU code
 * runs for long, and counting iterations bounds a frame. The throw unwinds the handler, the frame and the
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

  constructor(spanId: number) {
    super("execution budget exceeded");
    this.name = "ExecutionBudgetExceeded";
    this.spanId = spanId;
  }
}

/** `rt.budgetExceeded(spanId)`, called by the check at the head of a loop body. Never returns. */
export function budgetExceeded(spanId: number): never {
  throw new ExecutionBudgetExceeded(spanId);
}
