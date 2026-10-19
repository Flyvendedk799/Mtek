// Budgets of a trial (spec/ai-and-benchmarks.md section 4.1: "stops after maxRepairs or when budgets
// are exhausted (tokens, wall-clock)"). Checked before every model call; the wall-clock budget also
// aborts a call that is in flight (`AbortSignal`).
import type { Clock } from "./clock.ts";
import type { Usage } from "./model-client.ts";
import { addUsage, ZERO_USAGE } from "./model-client.ts";

export interface BudgetLimits {
  /** Repair rounds after the first generation (default 3, spec 4.1). */
  maxRepairs: number;
  /** The cap of one reply (`max_output_tokens` of the task). */
  maxOutputTokensPerCall: number;
  maxWallMs: number;
  /** Input plus output tokens over all calls of the trial; null means no such budget. */
  maxTotalTokens: number | null;
}

/** `spend` is the money cap of the spend guard (decision 0108). */
export type BudgetStop = "wall-clock" | "total-tokens" | "spend";

export class BudgetTracker {
  readonly limits: BudgetLimits;
  private readonly clock: Clock;
  private startedMs = 0;
  private spent: Usage = ZERO_USAGE;
  private calls = 0;

  constructor(limits: BudgetLimits, clock: Clock) {
    this.limits = limits;
    this.clock = clock;
  }

  start(): void {
    this.startedMs = this.clock.nowMs();
  }

  elapsedMs(): number {
    return Math.max(0, this.clock.nowMs() - this.startedMs);
  }

  remainingMs(): number {
    return Math.max(0, this.limits.maxWallMs - this.elapsedMs());
  }

  record(usage: Usage): void {
    this.spent = addUsage(this.spent, usage);
    this.calls += 1;
  }

  get usage(): Usage {
    return this.spent;
  }

  get callCount(): number {
    return this.calls;
  }

  /** Why no further call may be made, or null when one may. */
  exhausted(): BudgetStop | null {
    if (this.remainingMs() <= 0) return "wall-clock";
    const { maxTotalTokens } = this.limits;
    if (maxTotalTokens !== null && this.spent.inputTokens !== null && this.spent.outputTokens !== null) {
      if (this.spent.inputTokens + this.spent.outputTokens >= maxTotalTokens) return "total-tokens";
    }
    return null;
  }

  /** True when a token budget is set but the provider's usage is unknown, so the budget cannot be enforced. */
  tokenBudgetUnenforceable(): boolean {
    return this.limits.maxTotalTokens !== null && (this.spent.inputTokens === null || this.spent.outputTokens === null);
  }
}
