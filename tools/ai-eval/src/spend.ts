// The spend guard of the benchmark runs (decision 0108).
//
// Money is a budget of the experiment like tokens are: a ledger file OUTSIDE the repository
// (default `<home>/gate-m7/ai-spend.json`, named with `--spend-ledger`) accumulates the cost of
// every call, computed from the provider's own usage report, and persists across runs, phases and
// agents. Before every call the guard reserves the WORST case of that call (the whole input at the
// dearest input price, plus `max_tokens` of output at the output price) and refuses the call when the
// ledger total, the reservations of calls in flight and that worst case would exceed the cap given to
// the run. After the call the reservation is replaced by the real cost.
//
// A refused call is never a success and never silently dropped: the loop records the call as
// `budget-exceeded` (budget `spend`) and ends the trial `unfinished` with the reason `budget-spend`.
//
// Prices are USD per million tokens and deliberately conservative: when the provider does not say
// how much of the input was cached, all of it is charged at the uncached price; a cache write is
// charged at the 5-minute write price; a call that failed without a usable answer (an abort, a
// timeout after the request was sent) is charged its worst case because it may have been billed.
// A call that the provider answered with an HTTP error status is billed nothing by the provider and
// charged nothing here; nor is a call that failed with a connection error and no response at all
// (`transport: "connection"`, decision 0124: the ledger notes it 'no response: not charged').
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { GenerateOptions, GenerateRequest, GenerateResult, ModelClient, Usage } from "./model-client.ts";

export interface Pricing {
  /** Uncached input, USD per million tokens. */
  inputPerMTok: number;
  /** Writing the prompt cache (5-minute lifetime), USD per million tokens. */
  cacheWritePerMTok: number;
  /** Reading the prompt cache, USD per million tokens. */
  cacheReadPerMTok: number;
  outputPerMTok: number;
}

/** Claude Haiku 4.5: $1 / $5 per million input / output tokens; cache writes 1.25x and reads 0.1x the input price. */
const HAIKU_4_5: Pricing = { inputPerMTok: 1, cacheWritePerMTok: 1.25, cacheReadPerMTok: 0.1, outputPerMTok: 5 };

/**
 * The prices the guard knows. A model that is not here cannot be run with a ledger: an unknown price
 * would make the guard a pretence.
 */
export const PRICING: Readonly<Record<string, Pricing>> = {
  "claude-haiku-4-5-20251001": HAIKU_4_5,
  "claude-haiku-4-5": HAIKU_4_5,
};

export class SpendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpendError";
  }
}

export function pricingFor(model: string): Pricing {
  const pricing = PRICING[model];
  if (pricing === undefined) throw new SpendError(`no price is known for the model '${model}': add it to PRICING in tools/ai-eval/src/spend.ts before running it with a spend cap`);
  return pricing;
}

const MILLION = 1_000_000;

/**
 * The cost of one call from the provider's usage report. `inputTokens` is the whole input (uncached +
 * cache writes + cache reads), `cachedInputTokens` the reads, `cacheWriteInputTokens` the writes. An
 * unreported part is charged at the dearest applicable price (uncached, or the write price when the
 * call asked for caching); an unreported total is not guessed here (the caller charges the worst case).
 */
export function costUsd(model: string, usage: Usage, options: { cachingRequested?: boolean } = {}): number | null {
  const price = pricingFor(model);
  if (usage.inputTokens === null || usage.outputTokens === null) return null;
  const reads = usage.cachedInputTokens ?? 0;
  const writes = usage.cacheWriteInputTokens ?? 0;
  const uncached = Math.max(0, usage.inputTokens - reads - writes);
  // When caching was asked for and the provider did not report writes, every uncached token might have been a write.
  const uncachedRate = options.cachingRequested === true && usage.cacheWriteInputTokens === undefined ? price.cacheWritePerMTok : price.inputPerMTok;
  return (uncached * uncachedRate + writes * price.cacheWritePerMTok + reads * price.cacheReadPerMTok + usage.outputTokens * price.outputPerMTok) / MILLION;
}

/** An upper bound of the tokens of a request from its length: three characters per token would be typical, two and a half is safe. */
export function estimateInputTokens(request: Pick<GenerateRequest, "system" | "messages">): number {
  const chars = request.system.length + request.messages.reduce((sum, message) => sum + message.content.length, 0);
  return Math.ceil(chars / 2.5);
}

/** The most one call can cost: the whole estimated input at the dearest input price and `maxOutputTokens` of output. */
export function worstCaseUsd(model: string, request: Pick<GenerateRequest, "system" | "messages" | "maxOutputTokens">): number {
  const price = pricingFor(model);
  const inputRate = Math.max(price.inputPerMTok, price.cacheWritePerMTok);
  return (estimateInputTokens(request) * inputRate + request.maxOutputTokens * price.outputPerMTok) / MILLION;
}

export interface LedgerEntry {
  at: string;
  runId: string;
  model: string;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteInputTokens: number | null;
  outputTokens: number | null;
  usd: number;
  /** Why the charge is not the plain cost of the reported usage, when it is not. */
  note: string | null;
}

interface Reservation {
  id: string;
  usd: number;
  at: string;
}

interface LedgerFile {
  schemaVersion: 1;
  /** The sum of `entries[].usd`, kept redundantly so a reader and the guard can cross-check it. */
  totalUsd: number;
  reservations: Reservation[];
  entries: LedgerEntry[];
}

export const DEFAULT_LEDGER_PATH = join(homedir(), "gate-m7", "ai-spend.json");
/** A reservation older than this is a call that never reported back (a crashed process); it stops counting then. */
const RESERVATION_TTL_MS = 15 * 60 * 1000;
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_STALE_MS = 30_000;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** The ledger file with a lock directory around every read-modify-write, so parallel processes cannot lose a charge. */
export class SpendLedger {
  readonly path: string;
  private readonly now: () => number;

  constructor(path: string = DEFAULT_LEDGER_PATH, now: () => number = () => Date.now()) {
    this.path = path;
    this.now = now;
    mkdirSync(dirname(path), { recursive: true });
  }

  private withLock<T>(action: () => T): T {
    const lock = `${this.path}.lock`;
    const deadline = this.now() + LOCK_TIMEOUT_MS;
    for (;;) {
      try {
        mkdirSync(lock);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        try {
          const age = this.now() - (existsSync(lock) ? Number(readFileSync(join(lock, "t"), "utf8")) : 0);
          if (age > LOCK_STALE_MS) rmSync(lock, { recursive: true, force: true });
        } catch {
          // the holder is writing its timestamp or has just left: try again
        }
        if (this.now() > deadline) throw new SpendError(`the spend ledger lock ${lock} could not be taken within ${String(LOCK_TIMEOUT_MS)} ms`);
        sleepSync(25);
      }
    }
    try {
      writeFileSync(join(lock, "t"), String(this.now()));
      return action();
    } finally {
      rmSync(join(lock, "t"), { force: true });
      try {
        rmdirSync(lock);
      } catch {
        // already gone
      }
    }
  }

  private load(): LedgerFile {
    if (!existsSync(this.path)) return { schemaVersion: 1, totalUsd: 0, reservations: [], entries: [] };
    const value = JSON.parse(readFileSync(this.path, "utf8")) as LedgerFile;
    if (value.schemaVersion !== 1 || typeof value.totalUsd !== "number" || !Array.isArray(value.entries) || !Array.isArray(value.reservations)) {
      throw new SpendError(`${this.path} is not a spend ledger of schema version 1`);
    }
    const sum = value.entries.reduce((acc, entry) => acc + entry.usd, 0);
    if (Math.abs(sum - value.totalUsd) > 1e-9) throw new SpendError(`${this.path}: totalUsd (${String(value.totalUsd)}) does not equal the sum of its entries (${String(sum)}); refusing to run on a ledger that was edited`);
    return value;
  }

  private save(file: LedgerFile): void {
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(file, null, 1)}\n`, "utf8");
    renameSync(temporary, this.path);
  }

  private live(file: LedgerFile): Reservation[] {
    const cutoff = this.now() - RESERVATION_TTL_MS;
    return file.reservations.filter((reservation) => Date.parse(reservation.at) > cutoff);
  }

  /** The money spent so far, from all runs. */
  totalUsd(): number {
    return this.withLock(() => this.load().totalUsd);
  }

  /** Spent plus reserved by calls in flight. */
  committedUsd(): number {
    return this.withLock(() => {
      const file = this.load();
      return file.totalUsd + this.live(file).reduce((sum, r) => sum + r.usd, 0);
    });
  }

  /**
   * Reserves `usd` for a call when that keeps the committed money at or below `capUsd`. Returns the
   * reservation id, or null when the cap would be exceeded (nothing is reserved then).
   */
  reserve(usd: number, capUsd: number): { id: string; committedUsd: number } | { id: null; committedUsd: number } {
    return this.withLock(() => {
      const file = this.load();
      const live = this.live(file);
      const committed = file.totalUsd + live.reduce((sum, r) => sum + r.usd, 0);
      if (committed + usd > capUsd + 1e-12) return { id: null, committedUsd: committed };
      const id = `${String(this.now())}-${Math.random().toString(36).slice(2, 10)}`;
      file.reservations = [...live, { id, usd, at: new Date(this.now()).toISOString() }];
      this.save(file);
      return { id, committedUsd: committed + usd };
    });
  }

  /** Replaces a reservation by the real charge; returns the new total. */
  settle(reservationId: string | null, entry: LedgerEntry): number {
    return this.withLock(() => {
      const file = this.load();
      file.reservations = file.reservations.filter((r) => r.id !== reservationId);
      file.entries.push(entry);
      file.totalUsd += entry.usd;
      this.save(file);
      return file.totalUsd;
    });
  }

  /** Drops a reservation without a charge (the call was not made). */
  release(reservationId: string): void {
    this.withLock(() => {
      const file = this.load();
      file.reservations = file.reservations.filter((r) => r.id !== reservationId);
      this.save(file);
    });
  }
}

export interface SpendGuardOptions {
  ledger: SpendLedger;
  /** The ceiling of the ledger total for this run, USD. */
  capUsd: number;
  runId: string;
  /** True when the client asks the provider to cache the prompt (the unreported-write case is then charged at the write price). */
  cachingRequested?: boolean;
  now?: () => string;
}

/** The running totals of a guard, recorded with the run. */
export interface SpendSummary {
  capUsd: number;
  ledgerTotalAtStartUsd: number;
  ledgerTotalNowUsd: number;
  runSpendUsd: number;
  calls: number;
  refusedCalls: number;
}

export interface SpendGuardedClient extends ModelClient {
  summary(): SpendSummary;
}

/**
 * Wraps a client so that every call is checked against the cap first and charged after. The wrapped
 * client's results carry `costUsd` and `ledgerTotalUsd`; a refused call returns `budgetStop: "spend"`
 * without reaching the provider.
 */
export function guardClient(inner: ModelClient, options: SpendGuardOptions): SpendGuardedClient {
  pricingFor(inner.model);
  if (!(options.capUsd > 0) || !Number.isFinite(options.capUsd)) throw new SpendError("the spend cap must be a positive number of USD");
  const startTotal = options.ledger.totalUsd();
  let runSpend = 0;
  let calls = 0;
  let refused = 0;
  const iso = options.now ?? ((): string => new Date().toISOString());
  const charge = (reservation: string | null, usd: number, usage: Usage | null, note: string | null): number => {
    runSpend += usd;
    return options.ledger.settle(reservation, {
      at: iso(),
      runId: options.runId,
      model: inner.model,
      inputTokens: usage?.inputTokens ?? null,
      cachedInputTokens: usage?.cachedInputTokens ?? null,
      cacheWriteInputTokens: usage?.cacheWriteInputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      usd,
      note,
    });
  };
  return {
    provider: inner.provider,
    model: inner.model,
    capabilities: inner.capabilities,
    ...(inner.promptCaching === undefined ? {} : { promptCaching: inner.promptCaching }),
    summary: () => ({
      capUsd: options.capUsd,
      ledgerTotalAtStartUsd: startTotal,
      ledgerTotalNowUsd: options.ledger.totalUsd(),
      runSpendUsd: runSpend,
      calls,
      refusedCalls: refused,
    }),
    async generate(request: GenerateRequest, generateOptions?: GenerateOptions): Promise<GenerateResult> {
      const worst = worstCaseUsd(inner.model, request);
      const reservation = options.ledger.reserve(worst, options.capUsd);
      if (reservation.id === null) {
        refused += 1;
        return {
          text: "",
          usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
          finish: "error",
          error: `spend cap reached: the ledger holds ${reservation.committedUsd.toFixed(4)} USD committed, this call could cost up to ${worst.toFixed(4)} USD and the cap is ${options.capUsd.toFixed(2)} USD`,
          budgetStop: "spend",
          ledgerTotalUsd: reservation.committedUsd,
        };
      }
      calls += 1;
      let result: GenerateResult;
      try {
        result = await inner.generate(request, generateOptions);
      } catch (error) {
        // A throw after the request left: it may have been billed.
        const total = charge(reservation.id, worst, null, "the call threw; charged its worst case");
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), { ledgerTotalUsd: total });
      }
      let usd: number | null;
      let note: string | null = null;
      if (result.httpStatus !== undefined && result.httpStatus >= 400) {
        usd = 0;
        note = `HTTP ${String(result.httpStatus)}: not billed`;
      } else if (result.finish === "error" && result.transport === "connection") {
        // Nothing was sent or nothing came back (refused, DNS, no route, connect timeout): the service cannot have billed it (decision 0124).
        usd = 0;
        note = "no response: not charged";
      } else {
        usd = costUsd(inner.model, result.usage, { cachingRequested: options.cachingRequested === true });
        const unreported = result.usage.inputTokens === null || result.usage.outputTokens === null;
        const empty = result.finish === "error" || result.finish === "cancelled";
        if (usd === null || (empty && result.usage.inputTokens === 0 && result.usage.outputTokens === 0)) {
          usd = worst;
          note = unreported ? "usage not reported; charged the worst case" : "no answer and no usage (aborted, timed out or connection lost); charged the worst case";
        }
      }
      const total = charge(reservation.id, usd, result.usage, note);
      return { ...result, costUsd: usd, ledgerTotalUsd: total };
    },
  };
}
