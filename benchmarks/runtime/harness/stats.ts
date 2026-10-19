// Distribution statistics of the runtime benchmark (decision 0095). Pure functions, used by the measurement page and the
// report generator alike, so the numbers in the report are computed by the code the tests exercise.

/**
 * The nearest-rank percentile: for `n` samples sorted ascending, the sample of rank `ceil(p / 100 * n)` (1-based).
 * It returns an observed value, never an interpolated one, and is monotone in `p`. `p` is in (0, 100].
 */
export function percentileSorted(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) throw new RangeError("percentile of no samples");
  if (!(p > 0 && p <= 100)) throw new RangeError(`percentile ${String(p)} is outside (0, 100]`);
  const rank = Math.max(1, Math.ceil((p / 100) * n - 1e-9));
  return sorted[Math.min(n, rank) - 1] as number;
}

export interface Summary {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

export function summarize(samples: ArrayLike<number>): Summary {
  const n = samples.length;
  if (n === 0) throw new RangeError("summary of no samples");
  const sorted = Float64Array.from(samples as ArrayLike<number>).sort();
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += sorted[i] as number;
  return {
    count: n,
    min: sorted[0] as number,
    max: sorted[n - 1] as number,
    mean: sum / n,
    p50: percentileSorted(sorted, 50),
    p95: percentileSorted(sorted, 95),
    p99: percentileSorted(sorted, 99),
  };
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("median of no values");
  const sorted = Float64Array.from(values).sort();
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** `100 * (value / reference - 1)`: how many percent `value` is above (positive) or below (negative) `reference`. */
export function percentOver(value: number, reference: number): number {
  if (!(reference > 0)) throw new RangeError("the reference must be positive");
  return 100 * (value / reference - 1);
}

/** Rounds to `digits` decimals for printing (never for comparing). */
export function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
