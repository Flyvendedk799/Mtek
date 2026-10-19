// The small statistics of the benchmark report (decision 0108). Everything is a pure function of its input, and the
// bootstrap uses a fixed pseudo-random sequence, so a report computed twice from the same records is the same text.

/** A sorted copy. */
function sorted(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

/** The quantile `q` (0 to 1) by linear interpolation between order statistics (the default of R and NumPy, "type 7"). Null for no values. */
export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const xs = sorted(values);
  const position = (xs.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = xs[lower] as number;
  const high = xs[upper] as number;
  return low + (high - low) * (position - lower);
}

export interface Spread {
  n: number;
  median: number | null;
  q1: number | null;
  q3: number | null;
}

/** The median and the interquartile range (first and third quartile) of `values`. */
export function spread(values: readonly number[]): Spread {
  return { n: values.length, median: quantile(values, 0.5), q1: quantile(values, 0.25), q3: quantile(values, 0.75) };
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** mulberry32: a 32-bit generator, enough for resampling and exactly reproducible. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One task's totals on one side: what the ratio of tokens per completed task is made of. */
export interface TaskTotals {
  tokens: number;
  completed: number;
  valid: number;
}

export interface RatioInterval {
  /** Tokens per completed task of the first side divided by that of the second; null when either is undefined. */
  point: number | null;
  /** The percentile interval over resampled task sets; null when fewer than 20 resamples had both sides defined. */
  low: number | null;
  high: number | null;
  /** Resamples in which a side completed nothing (their ratio is undefined and they are left out of the interval). */
  undefinedResamples: number;
  resamples: number;
}

function perCompleted(totals: readonly TaskTotals[]): number | null {
  const completed = sum(totals.map((t) => t.completed));
  return completed === 0 ? null : sum(totals.map((t) => t.tokens)) / completed;
}

export const BOOTSTRAP_RESAMPLES = 4000;
export const BOOTSTRAP_SEED = 20261019;
/** An interval over fewer tasks than this says nothing: the resampled sets would be few and almost equal. */
export const MIN_TASKS_FOR_INTERVAL = 5;

/**
 * The ratio of tokens per completed task, `first / second`, over the same tasks, and its 95 % percentile interval from a
 * bootstrap over TASKS (a task with its trials is the unit that is resampled, because trials of one task are not independent).
 * `first[i]` and `second[i]` are the same task.
 */
export function ratioInterval(first: readonly TaskTotals[], second: readonly TaskTotals[], resamples = BOOTSTRAP_RESAMPLES, seed = BOOTSTRAP_SEED): RatioInterval {
  if (first.length !== second.length) throw new Error("ratioInterval: the two sides must list the same tasks");
  const a = perCompleted(first);
  const b = perCompleted(second);
  const point = a === null || b === null ? null : a / b;
  const random = mulberry32(seed);
  const n = first.length;
  const ratios: number[] = [];
  let undefinedResamples = 0;
  if (n > 0) {
    for (let r = 0; r < resamples; r += 1) {
      const pickedFirst: TaskTotals[] = [];
      const pickedSecond: TaskTotals[] = [];
      for (let i = 0; i < n; i += 1) {
        const index = Math.floor(random() * n);
        pickedFirst.push(first[index] as TaskTotals);
        pickedSecond.push(second[index] as TaskTotals);
      }
      const x = perCompleted(pickedFirst);
      const y = perCompleted(pickedSecond);
      if (x === null || y === null) undefinedResamples += 1;
      else ratios.push(x / y);
    }
  }
  const enough = ratios.length >= 20 && n >= MIN_TASKS_FOR_INTERVAL;
  return {
    point,
    low: enough ? quantile(ratios, 0.025) : null,
    high: enough ? quantile(ratios, 0.975) : null,
    undefinedResamples,
    resamples: n > 0 ? resamples : 0,
  };
}
