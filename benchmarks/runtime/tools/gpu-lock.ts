// A machine-wide mutual exclusion for GPU use, by atomic directory creation (`mkdir` fails when the directory exists).
// Several agents and test runs share one GPU; a benchmark pass must not overlap another GPU user. The directory comes
// from `MTEK_GPU_LOCK_DIR`; without it there is no lock (the pass records that none was held).
import { mkdirSync, rmdirSync } from "node:fs";

const held = new Set<string>();
let exitHandlerInstalled = false;

function releaseAll(): void {
  for (const dir of held) {
    try {
      rmdirSync(dir);
    } catch {
      // Already gone.
    }
  }
  held.clear();
}

function installExitHandler(): void {
  if (exitHandlerInstalled) return;
  exitHandlerInstalled = true;
  process.on("exit", releaseAll);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      releaseAll();
      process.exit(130);
    });
  }
}

export interface LockOutcome {
  /** The lock directory, or null when `MTEK_GPU_LOCK_DIR` is not set. */
  readonly dir: string | null;
  /** How long this process waited for the lock. */
  readonly waitedMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs `job` while holding the lock; always releases it, also when `job` throws. */
export async function withGpuLock<T>(job: (lock: LockOutcome) => Promise<T>, options: { timeoutMs?: number; pollMs?: number } = {}): Promise<T> {
  const dir = process.env["MTEK_GPU_LOCK_DIR"];
  if (dir === undefined || dir === "") return job({ dir: null, waitedMs: 0 });
  const { timeoutMs = 30 * 60_000, pollMs = 2_000 } = options;
  installExitHandler();
  const start = Date.now();
  for (;;) {
    try {
      mkdirSync(dir);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() - start > timeoutMs) throw new Error(`the GPU lock ${dir} was not released within ${String(timeoutMs / 1000)} s`, { cause: error });
      await sleep(pollMs);
    }
  }
  held.add(dir);
  try {
    return await job({ dir, waitedMs: Date.now() - start });
  } finally {
    try {
      rmdirSync(dir);
    } catch {
      // Removed by someone else; nothing left to release.
    }
    held.delete(dir);
  }
}
