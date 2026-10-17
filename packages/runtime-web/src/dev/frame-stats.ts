/**
 * Frame-time statistics of the development overlay (`spec/tooling.md` section 9: "frame time (ms,
 * p50/p95 over the last 120 frames)"). Development builds only: nothing under `src/dev/` is part of a
 * release runtime bundle (decision 0055).
 */

/** The number of most recent frames the percentiles are computed over. */
export const FRAME_WINDOW = 120;

/**
 * The nearest-rank percentile of an ascending list: the value at 1-based rank `ceil(p / 100 * n)`
 * (rank at least 1). `undefined` for an empty list. For `[1, 2, ..., 120]`, p50 is 60 and p95 is 114.
 */
export function nearestRank(sortedAscending: readonly number[], percent: number): number | undefined {
  const n = sortedAscending.length;
  if (n === 0) return undefined;
  const rank = Math.min(n, Math.max(1, Math.ceil((percent / 100) * n)));
  return sortedAscending[rank - 1];
}

/** A ring of the last `FRAME_WINDOW` frame times. */
export class FrameStats {
  private readonly times: number[] = [];
  private next = 0;

  /** Records one frame time in milliseconds; non-finite values are ignored. */
  push(ms: number): void {
    if (!Number.isFinite(ms)) return;
    if (this.times.length < FRAME_WINDOW) this.times.push(ms);
    else this.times[this.next] = ms;
    this.next = (this.next + 1) % FRAME_WINDOW;
  }

  /** Frames currently in the window (at most `FRAME_WINDOW`). */
  get count(): number {
    return this.times.length;
  }

  /** The nearest-rank percentile of the window; `undefined` before the first frame. */
  percentile(percent: number): number | undefined {
    return nearestRank([...this.times].sort((a, b) => a - b), percent);
  }
}
