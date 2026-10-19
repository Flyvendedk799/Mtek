// The machine's GPU is shared state (adapters and devices are never used by two runs at once, spec/testing.md): a
// directory is the lock (`mkdir` is atomic on every platform). A benchmark run that shares the machine with other work
// names that directory with `--gpu-lock`; every command that opens the browser takes the lock for its duration and
// always releases it, also when the command throws or the process is interrupted.
import { mkdirSync, rmdirSync } from "node:fs";
import type { CommandResult, CommandRunner, CommandSpec } from "./commands.ts";

export interface GpuLockOptions {
  /** How long to wait for the lock before giving up (the command then fails to start, it does not run unlocked). */
  timeoutMs: number;
  pollMs: number;
}

const DEFAULTS: GpuLockOptions = { timeoutMs: 45 * 60 * 1000, pollMs: 2000 };

const held = new Set<string>();
let hooked = false;

function releaseAll(): void {
  for (const dir of held) {
    try {
      rmdirSync(dir);
    } catch {
      // already released
    }
  }
  held.clear();
}

function hook(): void {
  if (hooked) return;
  hooked = true;
  // A synchronous release is all that is possible in an exit handler; a signal ends the process after it.
  process.on("exit", releaseAll);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      releaseAll();
      process.exit(130);
    });
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Takes the lock `dir`, waiting for it; the returned function releases it (once). */
export async function acquireGpuLock(dir: string, options: Partial<GpuLockOptions> = {}): Promise<() => void> {
  const { timeoutMs, pollMs } = { ...DEFAULTS, ...options };
  hook();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(dir);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() > deadline) throw new Error(`the GPU lock ${dir} could not be taken within ${String(Math.round(timeoutMs / 1000))} s`, { cause: error });
      await sleep(pollMs);
    }
  }
  held.add(dir);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held.delete(dir);
    try {
      rmdirSync(dir);
    } catch {
      // gone already
    }
  };
}

/** Wraps a runner so that the commands for which `usesGpu` is true run under the lock. */
export function lockedRunner(inner: CommandRunner, dir: string, usesGpu: (spec: CommandSpec) => boolean, options: Partial<GpuLockOptions> = {}): CommandRunner {
  return {
    async run(spec: CommandSpec): Promise<CommandResult> {
      if (!usesGpu(spec)) return inner.run(spec);
      const release = await acquireGpuLock(dir, options);
      try {
        return await inner.run(spec);
      } finally {
        release();
      }
    },
  };
}
