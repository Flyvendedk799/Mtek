// A pass that the machine disturbed (another process busy before or during it, `host-load.ts`) is repeated, and every attempt is
// kept in the raw results. Which attempt a statistic uses is decided by the load alone, never by the result: the first attempt
// that succeeded without disturbance, else the last successful attempt, else the last attempt.
import { isDisturbed } from "./host-load.ts";
import type { RawJob } from "./raw-types.ts";

export const MAX_ATTEMPTS = 3;

/** The attempt of one pass that counts. `attempts` are all the attempts of one (pass, run). */
export function preferredAttempt(attempts: readonly RawJob[]): RawJob {
  if (attempts.length === 0) throw new RangeError("a pass has at least one attempt");
  const sorted = [...attempts].sort((a, b) => (a.attempt ?? 1) - (b.attempt ?? 1));
  const calm = sorted.find((j) => j.status === "ok" && !isDisturbed(j.hostLoad));
  if (calm !== undefined) return calm;
  const succeeded = sorted.filter((j) => j.status === "ok");
  return (succeeded[succeeded.length - 1] ?? sorted[sorted.length - 1]) as RawJob;
}

/** Groups jobs by (pass, run), in the order the groups first appear. */
export function groupAttempts(jobs: readonly RawJob[]): RawJob[][] {
  const groups = new Map<string, RawJob[]>();
  for (const job of jobs) {
    const key = `${job.pass}#${String(job.run)}`;
    const list = groups.get(key) ?? [];
    list.push(job);
    groups.set(key, list);
  }
  return [...groups.values()];
}

/** One job per (pass, run): the attempt that counts. */
export function chooseAttempts(jobs: readonly RawJob[]): RawJob[] {
  return groupAttempts(jobs).map(preferredAttempt);
}

/** The passes whose counted attempt is still disturbed and that have attempts left. */
export function needsRetry(attempts: readonly RawJob[], maxAttempts: number = MAX_ATTEMPTS): boolean {
  const chosen = preferredAttempt(attempts);
  return isDisturbed(chosen.hostLoad) && attempts.length < maxAttempts;
}
